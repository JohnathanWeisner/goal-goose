// The page a distraction tab becomes after the goose eats it.
const q = new URLSearchParams(location.search);
const set = (id: string, text: string) => (document.getElementById(id)!.textContent = text);

const ate = q.get("ate");
if (ate) set("ate", `Nom: ${ate}`);
set("goal", q.get("goal") ? `Your goal: ${q.get("goal")}` : "You were supposed to be working.");

const back = q.get("back");
if (back && /^https?:/.test(back)) {
  const a = document.getElementById("back") as HTMLAnchorElement;
  a.href = back;
  a.textContent = `Back to “${q.get("backTitle") || new URL(back).hostname}”`;
  a.hidden = false;
  set("hint", "The goose already switched you to that tab.");
} else {
  set("hint", "Open something that helps with your goal. The goose will be watching.");
}
