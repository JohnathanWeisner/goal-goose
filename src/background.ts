// Service worker: watches the active tab, judges it against the goal, drives the goose.
import { DEEP_VOICE, ESCALATION, MODELS, type VoiceKind } from "./config";
import { speak } from "./gemini";
import { gooseLine, judgePage, planGoal, setPlan, type GoalPlan, type Page } from "./judge";
import type { ToContent, ToBackground } from "./messages";

type Settings = { goal?: string; apiKey?: string; active?: boolean };
type TabState = { offCount: number; lastOnGoalUrl?: string; lastUrl?: string; lastCheck: number };

const tabs = new Map<number, TabState>();
const inFlight = new Set<number>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const settings = () => chrome.storage.local.get(["goal", "apiKey", "active"]) as Promise<Settings>;
const stateFor = (id: number) => {
  if (!tabs.has(id)) tabs.set(id, { offCount: 0, lastCheck: 0 });
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

// Session-wide memory (survives the service worker sleeping): last on-goal page from ANY tab + the plan.
type Session = { lastOnGoalUrl?: string; plan?: GoalPlan };
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

    const v = await judgePage(apiKey, goal, page);
    st.lastUrl = tab.url;
    st.lastCheck = Date.now();
    await log({ reason, url: page.url, title: page.title, ...v });

    if (v.onTask) {
      st.offCount = 0;
      st.lastOnGoalUrl = page.url;
      await updateSession({ lastOnGoalUrl: page.url });
      send(tabId, { type: "happy" });
      return;
    }

    st.offCount++;
    const level = st.offCount >= ESCALATION.eat ? 3 : st.offCount >= ESCALATION.warn ? 2 : 1;
    const line = level >= 2 ? await gooseLine(apiKey, goal, page, level).catch(() => "HONK.") : "";
    send(tabId, { type: "angry", level, line, why: v.reason });

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
      const session = await getSession();
      // Back to the goal: this tab's last on-goal page → any tab's → the planner's home page → previous page.
      const target = st.lastOnGoalUrl || session.lastOnGoalUrl || session.plan?.home_url;
      st.offCount = 0;
      await log({ reason: "eaten", url: sender.tab?.url, redirect: target ?? "back" });
      await chrome.storage.local.set({ justAte: Date.now() }); // the goose greets you on the next page
      if (target) chrome.tabs.update(tabId, { url: target });
      else chrome.tabs.goBack(tabId).catch(() => {});
    })();
  }
  if (msg.type === "voice") {
    (async () => {
      const { active } = await settings();
      if (!active) return reply(null);
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
