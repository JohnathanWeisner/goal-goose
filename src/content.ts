// On-page goose: renders the 3D goose, walks it around, honks, and eats distractions.
import * as THREE from "three";
import { Goose, type GooseMode } from "./goose";
import type { ToBackground, ToContent } from "./messages";

if (window.top === window && !document.getElementById("goal-goose-host")) main();

function main() {
  const SIZE = 200; // px canvas around the goose

  // ---- overlay (shadow DOM keeps page CSS out) ----
  const host = document.createElement("div");
  host.id = "goal-goose-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .goose { position:fixed; bottom:0; width:${SIZE}px; height:${SIZE}px; pointer-events:auto; cursor:pointer; }
      .bubble { position:fixed; bottom:${SIZE - 10}px; max-width:260px; padding:10px 14px; border-radius:14px;
        background:#fff; color:#111; font:600 14px/1.35 system-ui,sans-serif; box-shadow:0 4px 18px rgba(0,0,0,.25);
        border:2px solid #111; opacity:0; transform:translateY(6px); transition:opacity .2s, transform .2s; }
      .bubble.show { opacity:1; transform:none; }
    </style>
    <canvas class="goose"></canvas>
    <div class="bubble"></div>`;
  document.documentElement.appendChild(host);
  const canvas = shadow.querySelector("canvas")!;
  const bubble = shadow.querySelector<HTMLDivElement>(".bubble")!;

  // ---- three.js scene ----
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.2, 9);
  camera.lookAt(0, 0.6, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const goose = new Goose();
  goose.root.scale.setScalar(0.95);
  scene.add(goose.root);

  // ---- movement ----
  let x = 40;
  let targetX = 40;
  let facing = 1;
  let wanderTimer = 0;
  let level = 0;
  let busy = false; // during the eat sequence

  const say = (text: string, ms = 5000) => {
    if (!text) return;
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout((say as any).t);
    (say as any).t = setTimeout(() => bubble.classList.remove("show"), ms);
  };
  const setMode = (m: GooseMode) => (goose.mode = m);

  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const maxX = innerWidth - SIZE;

    if (!busy && level === 0 && (goose.mode === "wander" || goose.mode === "nap")) {
      wanderTimer -= dt;
      if (wanderTimer <= 0) {
        if (Math.random() < 0.25) setMode("nap");
        else {
          setMode("wander");
          targetX = Math.random() * maxX;
        }
        wanderTimer = 4 + Math.random() * 6;
      }
    }
    const dx = targetX - x;
    goose.walking = Math.abs(dx) > 4 && goose.mode !== "nap";
    if (goose.walking) {
      const speed = busy ? 260 : level > 0 ? 160 : 70;
      x += Math.sign(dx) * Math.min(Math.abs(dx), speed * dt);
      facing = Math.sign(dx);
    }
    x = Math.max(0, Math.min(maxX, x));
    canvas.style.left = `${x}px`;
    bubble.style.left = `${Math.max(8, Math.min(innerWidth - 270, x + SIZE / 2 - 40))}px`;
    goose.root.rotation.y = facing > 0 ? -0.35 : Math.PI + 0.35; // three-quarter view toward the user

    goose.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- honk (synthesized, no audio files) ----
  function honk() {
    try {
      const ctx = new AudioContext();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(420, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.35);
      f.type = "bandpass";
      f.frequency.value = 900;
      f.Q.value = 2;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      o.connect(f).connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.42);
    } catch {
      /* autoplay blocked: the bubble still shows */
    }
  }

  // ---- eat the distraction ----
  function biggestTarget(): HTMLElement {
    const vids = [...document.querySelectorAll("video")].filter((v) => v.getBoundingClientRect().width > 100);
    vids.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
    return (vids[0] as HTMLElement) ?? (document.querySelector("main") as HTMLElement) ?? document.body;
  }

  async function eat() {
    if (busy) return;
    busy = true;
    const target = biggestTarget();
    const r = target.getBoundingClientRect();
    // March under the target
    targetX = Math.max(0, Math.min(innerWidth - SIZE, r.left + r.width / 2 - SIZE / 2));
    setMode("honk");
    honk();
    await sleep(900);
    honk();
    await sleep(Math.min(1500, Math.abs(targetX - x) * 4));
    if (target instanceof HTMLVideoElement) target.pause();
    // Suck the target into the beak
    const beakX = x + SIZE * (facing > 0 ? 0.75 : 0.25);
    const beakY = innerHeight - SIZE * 0.55;
    target.style.transition = "transform 1.1s cubic-bezier(.6,-0.3,.7,1), opacity 1.1s";
    target.style.transformOrigin = `${beakX - r.left}px ${beakY - r.top}px`;
    setMode("gulp");
    requestAnimationFrame(() => {
      target.style.transform = "scale(0.02) rotate(25deg)";
      target.style.opacity = "0.2";
    });
    await sleep(1300);
    say("*gulp*", 2000);
    await sleep(800);
    chrome.runtime.sendMessage({ type: "eaten" } satisfies ToBackground);
  }

  // ---- messages from the background worker ----
  chrome.runtime.onMessage.addListener((msg: ToContent, _s, reply) => {
    switch (msg.type) {
      case "hide":
        host.style.visibility = "hidden";
        requestAnimationFrame(() => requestAnimationFrame(() => reply(true)));
        return true; // async reply: background waits until hidden before screenshotting
      case "show":
        host.style.visibility = "visible";
        break;
      case "idle":
        level = 0;
        setMode("nap");
        break;
      case "thinking":
        if (!busy && level === 0) setMode("think");
        break;
      case "happy":
        if (level > 0) say("Good. Back to work.", 2500);
        level = 0;
        setMode("wander");
        break;
      case "angry":
        level = msg.level;
        targetX = innerWidth / 2 - SIZE / 2; // come front and center
        if (msg.level === 1) setMode("stare");
        if (msg.level === 2) {
          setMode("warn");
          honk();
          say(msg.line);
        }
        if (msg.level >= 3) {
          say(msg.line || "HONK.", 4000);
          eat();
        }
        break;
    }
  });

  // Click the goose to ask for an immediate re-check.
  canvas.addEventListener("click", () => chrome.runtime.sendMessage({ type: "recheck" } satisfies ToBackground));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
