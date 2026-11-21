// Animation stress test: plays every action/mood back-to-back and checks the rig never breaks. Run: pnpm test:anim
import * as THREE from "three";
import { Goose, type Action, type Mood } from "../src/goose";
const g = new Goose();
const actions: Action[] = ["hop","peck","preen","flap","spin","dance","shake","nod","honk","stretch","burp","wiggle","lookAround","sneeze","land"];
const moods: Mood[] = ["idle","nap","sit","think","stare","warn","gulp","held","dizzy","happy"];
let bad = 0, minScale = Infinity, maxScale = 0;
const box = new THREE.Box3();
let minH = Infinity, maxH = 0;
for (let f = 0; f < 60 * 60; f++) {
  if (f % 37 === 0) g.play(actions[(f / 37) % actions.length | 0]);
  if (f % 90 === 0) g.mood = moods[(f / 90) % moods.length | 0];
  if (f % 120 === 0) { g.speed = g.speed ? 0 : 1; g.facing = [-1, 0, 1][f % 3]; g.velocityX = g.speed * 150; }
  g.setLook(Math.sin(f / 50), Math.cos(f / 70));
  g.update(1 / 60);
  g.root.updateMatrixWorld(true);
  g.root.traverse((o) => {
    const e = o.matrixWorld.elements;
    if (e.some((v) => !Number.isFinite(v))) bad++;
    if ((o as any).isBone) { const s = new THREE.Vector3().setFromMatrixScale(o.matrixWorld); minScale = Math.min(minScale, s.x, s.y, s.z); maxScale = Math.max(maxScale, s.x, s.y, s.z); }
  });
  box.setFromObject(g.root); const h = box.max.y - box.min.y; minH = Math.min(minH, h); maxH = Math.max(maxH, h);
}
console.log({ frames: 3600, nonFiniteMatrices: bad, boneScaleRange: [minScale.toFixed(3), maxScale.toFixed(3)], heightRange: [minH.toFixed(2), maxH.toFixed(2)] });
