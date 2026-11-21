// Service worker: watches the active tab, judges it against the goal, drives the goose.
import { DEEP_VOICE, ESCALATION, MODELS, type VoiceKind } from "./config";
import { speak } from "./gemini";
import { gooseLine, judgePage, managerReview, planGoal, setPlan, type GoalPlan, type Page } from "./judge";
import type { ToContent, ToBackground } from "./messages";

type Settings = { goal?: string; apiKey?: string; active?: boolean };
type TabState = {
  offCount: number;
  lastOnGoalUrl?: string;
  lastUrl?: string;
  lastCheck: number;
  recent: string[]; // short verdict history shown to the manager
};

const tabs = new Map<number, TabState>();
const inFlight = new Set<number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const settings = () => chrome.storage.local.get(["goal", "apiKey", "active"]) as Promise<Settings>;
const stateFor = (id: number) => {
  if (!tabs.has(id)) tabs.set(id, { offCount: 0, lastCheck: 0, recent: [] });
  return tabs.get(id)!;
};
const send = (tabId: number, msg: ToContent) => chrome.tabs.sendMessage(tabId, msg).catch(() => {});

async function log(entry: Record<string, unknown>) {
  const { log = [] } = (await chrome.storage.local.get("log")) as { log?: unknown[] };
  log.push({ t: Date.now(), ...entry });
  await chrome.storage.local.set({ log: log.slice(-200) });
}

const checkable = (url?: string) => !!url && /^https?:/.test(url);

// Paint over the goose and its speech bubble so the judge only sees the page.
type Rects = { dpr: number; viewportW: number; boxes: { x: number; y: number; w: number; h: number }[] };
async function maskOverlay(dataUrl: string, rects?: Rects): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  if (!rects?.boxes.length) return dataUrl.split(",")[1];
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const s = bitmap.width / rects.viewportW; // screenshot px per CSS px
  for (const b of rects.boxes) {
    // Fill with the page color just above the box so the patch blends in.
    const sy = Math.max(0, Math.floor((b.y - 4) * s));
    const [r, g, bl] = ctx.getImageData(Math.min(bitmap.width - 1, Math.floor((b.x + b.w / 2) * s)), sy, 1, 1).data;
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    ctx.fillRect(b.x * s, b.y * s, b.w * s, b.h * s);
  }
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.6 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Session-wide memory (survives the service worker sleeping): every page judged on-track + the plan.
type OnGoal = { url: string; title: string; t: number; p: number };
type Session = { plan?: GoalPlan; onGoal?: OnGoal[] };
const getSession = async () => ((await chrome.storage.local.get("session")).session ?? {}) as Session;
const updateSession = async (patch: Partial<Session>) =>
  chrome.storage.local.set({ session: { ...(await getSession()), ...patch } });

// ---- deep voice: generated once, cached in storage, played instantly ----
const voiceKey = (text: string) => `voice:${DEEP_VOICE.voice}:${text}`;
async function voiceFor(text: string): Promise<string | undefined> {
  const k = voiceKey(text);
  const cached = (await chrome.storage.local.get(k))[k] as string | undefined;
  if (cached) return cached;
  const { apiKey } = await settings();
  if (!apiKey) return;
  const audio = await speak(apiKey, MODELS.tts, text, DEEP_VOICE.style, DEEP_VOICE.voice);
  await chrome.storage.local.set({ [k]: audio });
  return audio;
}
const prewarmVoices = () =>
  Promise.allSettled(Object.values(DEEP_VOICE.lines).flat().map((line) => voiceFor(line)));

// "Same page" for return purposes: origin + path (+ the video id on YouTube).
function pageKey(url: string) {
  try {
    const u = new URL(url);
    const v = u.hostname.endsWith("youtube.com") && u.pathname === "/watch" ? `?v=${u.searchParams.get("v")}` : "";
    return `${u.origin}${u.pathname.replace(/\/$/, "")}${v}`;
  } catch {
    return url;
  }
}

async function rememberOnGoal(url: string, title: string, p: number) {
  const s = await getSession();
  const list = (s.onGoal ?? []).filter((e) => pageKey(e.url) !== pageKey(url));
  list.push({ url, title, t: Date.now(), p });
  await updateSession({ onGoal: list.slice(-30) });
}

// The planner may be missing (session started before an update, or planning failed): plan on demand.
let planning: Promise<GoalPlan | undefined> | undefined;
async function ensurePlan(): Promise<GoalPlan | undefined> {
  const s = await getSession();
  if (s.plan) return s.plan;
  const { goal, apiKey, active } = await settings();
  if (!goal || !apiKey || !active) return;
  planning ??= planGoal(apiKey, goal)
    .then(async (plan) => {
      setPlan(plan);
      await updateSession({ plan });
      await log({ reason: "plan", ...plan });
      return plan;
    })
    .catch(async (e) => {
      await log({ reason: "plan", error: String(e) });
      return undefined;
    })
    .finally(() => (planning = undefined));
  return planning;
}

type Return =
  | { kind: "switch"; tabId: number; windowId: number; url: string; title: string }
  | { kind: "navigate"; url: string; title: string }
  | { kind: "eaten" };

// Pick where "back to work" is: the most recent verified on-goal page (switching to its tab if it's still
// open, so you keep your place), else the planner's home page. Never chrome:// pages or the distraction itself.
async function chooseReturn(distractionTabId: number, distractionUrl: string): Promise<Return> {
  const bad = pageKey(distractionUrl);
  const s = await getSession();
  const candidates = (s.onGoal ?? [])
    .filter((e) => checkable(e.url) && pageKey(e.url) !== bad)
    .sort((a, b) => b.t - a.t);
  if (candidates.length) {
    const open = await chrome.tabs.query({});
    for (const c of candidates) {
      const tab = open.find((t) => t.id !== distractionTabId && t.url && pageKey(t.url) === pageKey(c.url));
      if (tab?.id) return { kind: "switch", tabId: tab.id, windowId: tab.windowId, url: c.url, title: tab.title || c.title };
    }
    return { kind: "navigate", url: candidates[0].url, title: candidates[0].title };
  }
  const plan = await ensurePlan();
  if (plan?.home_url && checkable(plan.home_url) && pageKey(plan.home_url) !== bad) {
    return { kind: "navigate", url: plan.home_url, title: new URL(plan.home_url).hostname.replace(/^www\./, "") };
  }
  return { kind: "eaten" };
}

async function startSession() {
  prewarmVoices(); // in parallel with planning; ~3s per line, all at once
  const { goal, apiKey } = await settings();
  tabs.clear();
  await chrome.storage.local.set({ session: {} });
  setPlan(undefined);
  if (!goal || !apiKey) return;
  try {
    const plan = await planGoal(apiKey, goal);
    setPlan(plan);
    await updateSession({ plan });
    await log({ reason: "plan", ...plan });
  } catch (e) {
    await log({ reason: "plan", error: String(e) });
  }
}

// Restore the plan if the service worker was restarted mid-session.
getSession().then((s) => setPlan(s.plan));

async function check(tabId: number, reason: string) {
  if (inFlight.has(tabId)) return;
  const { goal, apiKey, active } = await settings();
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab || !tab.active || !checkable(tab.url)) return;
  if (!active || !goal || !apiKey) return send(tabId, { type: "idle" });

  const st = stateFor(tabId);
  if (tab.url === st.lastUrl && Date.now() - st.lastCheck < 5000) return; // de-dupe bursts
  inFlight.add(tabId);
  try {
    send(tabId, { type: "thinking" });
    // Never hide the goose (that made it flash). Instead, paint over it in the screenshot.
    const rects: Rects | undefined = await chrome.tabs
      .sendMessage(tabId, { type: "rects" } satisfies ToContent)
      .catch(() => undefined);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 60 });
    const screenshot = await maskOverlay(dataUrl, rects).catch(() => dataUrl.split(",")[1]);
    const page: Page = { url: tab.url!, title: tab.title ?? "", screenshot };
    ensurePlan(); // no-op if already planned

    const v = await judgePage(apiKey, goal, page);
    st.lastUrl = tab.url;
    st.lastCheck = Date.now();
    await log({ reason, url: page.url, title: page.title, ...v });
    st.recent = [...st.recent, `${v.onTask ? "on-track" : "off-track"} (p=${v.p.toFixed(2)}) "${page.title}"`].slice(-5);

    if (v.onTask) {
      st.offCount = 0;
      st.lastOnGoalUrl = page.url;
      await rememberOnGoal(page.url, page.title, v.p);
      send(tabId, { type: "happy" });
      return;
    }

    st.offCount++;
    let level = st.offCount >= ESCALATION.eat ? 3 : st.offCount >= ESCALATION.warn ? 2 : 1;
    let managerNote: string | undefined;

    if (level === 3) {
      // The Manager signs off before the goose eats anything.
      const state = await chrome.tabs.sendMessage(tabId, { type: "pageState" } satisfies ToContent).catch(() => ({ editing: false }));
      const dest = await chooseReturn(tabId, page.url);
      const review = await managerReview(apiKey, goal, page, {
        recent: st.recent,
        editing: !!state?.editing,
        destination: dest.kind === "eaten" ? undefined : { url: dest.url, title: dest.title },
      }).catch((e) => ({ action: "warn" as const, reason: `Manager unavailable (${String(e).slice(0, 60)}); warning only.`, source: "rule" as const }));
      await log({ ...review, why: review.reason, reason: "manager", url: page.url, title: page.title });
      if (review.action === "leave") {
        st.offCount = 0;
        send(tabId, { type: "happy" });
        return;
      }
      if (review.action === "warn") {
        level = 2;
        st.offCount = ESCALATION.warn; // stay at warning; the manager re-reviews next time
        managerNote = review.reason;
      }
    }

    const line = level >= 2 ? await gooseLine(apiKey, goal, page, level).catch(() => "HONK.") : "";
    send(tabId, { type: "angry", level, line, why: v.reason, manager: managerNote });

    // Keep the pressure on: re-check soon while off track.
    clearTimeout(timers.get(tabId));
    if (level < 3) timers.set(tabId, setTimeout(() => check(tabId, "recheck"), ESCALATION.recheckMs));
  } catch (e) {
    console.warn("[goose] check failed", e);
    await log({ reason, error: String(e) });
  } finally {
    inFlight.delete(tabId);
  }
}

async function recheckActive(reason: string) {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (t?.id) {
    stateFor(t.id).lastCheck = 0;
    check(t.id, reason);
  }
}

// ---- triggers ----
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) stateFor(tabId).lastUrl = undefined; // URL changed (incl. YouTube SPA nav): allow a fresh check
  if (info.status === "complete" || info.url) setTimeout(() => check(tabId, "navigate"), 1500);
});
chrome.tabs.onActivated.addListener(({ tabId }) => setTimeout(() => check(tabId, "activate"), 500));
chrome.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));
chrome.alarms.create("tick", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) {
    stateFor(tab.id).lastCheck = 0;
    check(tab.id, "tick");
  }
});

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, reply) => {
  const tabId = sender.tab?.id;
  if (msg.type === "eaten" && tabId) {
    (async () => {
      const st = stateFor(tabId);
      st.offCount = 0;
      const { goal = "" } = await settings();
      const ate = sender.tab?.title || sender.tab?.url || "";
      const dest = await chooseReturn(tabId, sender.tab?.url ?? "");
      const short = (x: string, n = 60) => (x.length > n ? x.slice(0, n - 1) + "…" : x);
      const eatenPage = (back?: { url: string; title: string }) =>
        chrome.runtime.getURL(
          `eaten.html?${new URLSearchParams({ goal, ate, ...(back ? { back: back.url, backTitle: back.title } : {}) })}`,
        );
      await log({ reason: "eaten", url: sender.tab?.url, redirect: dest.kind === "eaten" ? "eaten page" : dest.url });

      if (dest.kind === "switch") {
        // Keep your place: jump to the tab you were working in; the distraction tab becomes the eaten page.
        await chrome.tabs.update(dest.tabId, { active: true });
        await chrome.windows.update(dest.windowId, { focused: true }).catch(() => {});
        await chrome.tabs.update(tabId, { url: eatenPage(dest) });
        send(dest.tabId, { type: "welcomeBack", text: `Back to “${short(dest.title)}”. This is where you were working.` });
      } else if (dest.kind === "navigate") {
        await chrome.storage.local.set({
          justAte: { t: Date.now(), text: `Back to “${short(dest.title)}”. That's where your goal lives.` },
        });
        await chrome.tabs.update(tabId, { url: dest.url });
      } else {
        await chrome.tabs.update(tabId, { url: eatenPage() });
      }
    })();
  }
  if (msg.type === "voice") {
    (async () => {
      const { active } = await settings();
      if (!active && !msg.test) return reply(null);
      const pool = DEEP_VOICE.lines[msg.kind as VoiceKind];
      const text = pool[Math.floor(Math.random() * pool.length)];
      const audio = await voiceFor(text).catch(() => undefined);
      reply(audio ? { text, audio } : null);
    })();
    return true; // async reply
  }
  if (msg.type === "start") startSession().then(() => recheckActive("start"));
  if (msg.type === "recheck") recheckActive("manual");
});
