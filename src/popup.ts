declare const __DEV_API_KEY__: string;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const goalEl = $<HTMLTextAreaElement>("goal");
const keyEl = $<HTMLInputElement>("key");
const toggle = $<HTMLButtonElement>("toggle");
const statusEl = $<HTMLDivElement>("status");
const logEl = $<HTMLDivElement>("log");

async function render() {
  const s = (await chrome.storage.local.get(["goal", "apiKey", "active", "log"])) as any;
  goalEl.value = s.goal ?? "";
  keyEl.value = s.apiKey ?? "";
  toggle.textContent = s.active ? "Stop session" : "Start session";
  toggle.className = s.active ? "stop" : "";
  statusEl.textContent = s.active ? `Watching. Goal: "${s.goal}"` : s.apiKey ? "Idle." : "Add your Gemini API key below.";
  logEl.innerHTML = "";
  for (const e of (s.log ?? []).slice(-12).reverse()) {
    const d = document.createElement("div");
    d.textContent = e.error
      ? `⚠️ ${e.error}`
      : e.reason === "eaten"
        ? `🍽️ ate ${e.url}`
        : `${e.onTask ? "✅" : "❌"} ${e.title || e.url} · ${e.source} p=${(e.p ?? 0).toFixed(2)} · ${e.ms}ms`;
    logEl.appendChild(d);
  }
}

keyEl.addEventListener("change", () => chrome.storage.local.set({ apiKey: keyEl.value.trim() }));
goalEl.addEventListener("change", () => chrome.storage.local.set({ goal: goalEl.value.trim() }));
toggle.addEventListener("click", async () => {
  const s = (await chrome.storage.local.get(["active", "apiKey"])) as any;
  const apiKey = keyEl.value.trim() || s.apiKey || __DEV_API_KEY__;
  await chrome.storage.local.set({ goal: goalEl.value.trim(), apiKey, active: !s.active });
  await render();
  chrome.runtime.sendMessage({ type: "recheck" });
});

render();
