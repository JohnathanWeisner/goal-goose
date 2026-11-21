// Standalone preview of the goose (no extension needed): node build.mjs, then open dist/preview.html.
import { createStage, Goose, HALFTONE, type Action, type Mood } from "./goose";

const SIZE = 520;
const canvas = document.querySelector<HTMLCanvasElement>("#c")!;
const stage = createStage(canvas, SIZE);
const goose = new Goose();
stage.scene.add(goose.root);

const actions: Action[] = ["hop", "peck", "preen", "flap", "spin", "dance", "shake", "nod", "honk", "stretch", "burp", "wiggle", "lookAround", "sneeze", "land"];
const moods: Mood[] = ["idle", "nap", "sit", "think", "stare", "warn", "gulp", "held", "dizzy", "happy"];
const bar = document.querySelector("#controls")!;
const button = (label: string, fn: () => void) => {
  const b = document.createElement("button");
  b.textContent = label;
  b.onclick = fn;
  bar.appendChild(b);
};
for (const a of actions) button(a, () => goose.play(a));
bar.appendChild(document.createElement("br"));
for (const m of moods) button(`mood: ${m}`, () => (goose.mood = m));
bar.appendChild(document.createElement("br"));
button("walk", () => (goose.speed = goose.speed ? 0 : 1));
button("face left", () => (goose.facing = -1));
button("face viewer", () => (goose.facing = 0));
button("face right", () => (goose.facing = 1));

canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  goose.setLook((e.clientX - r.left - r.width / 2) / r.width * 2, (e.clientY - r.top - r.height * 0.3) / r.height * 2);
});

let last = performance.now();
(function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  goose.velocityX = goose.speed * 120 * (goose.facing || 1);
  goose.update(dt);
  stage.render();
  requestAnimationFrame(frame);
})(last);
(window as any).goose = goose;
(window as any).halftone = HALFTONE;
