// On-page goose: renders the kawaii 3D goose, its behaviors and interactions, and the eat-and-redirect.
import { createStage, Goose, type Action, type Mood } from "./goose";
import type { ToBackground, ToContent } from "./messages";

if (window.top === window && !document.getElementById("goal-goose-host")) main();

function main() {
  const SIZE = 260; // canvas px around the goose (room for hops and neck stretches)
  const STREAK_MS = 3 * 60_000; // celebrate every 3 min on track

  // ---- overlay (shadow DOM keeps page CSS out) ----
  const host = document.createElement("div");
  host.id = "goal-goose-host";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .goose { position:fixed; left:0; bottom:0; width:${SIZE}px; height:${SIZE}px; pointer-events:auto;
        cursor:grab; touch-action:none; will-change:transform; }
      .goose.held { cursor:grabbing; }
      .bubble { position:fixed; bottom:${SIZE - 18}px; max-width:270px; padding:10px 14px; border-radius:16px;
        background:#fffdf8; color:#2a2220; font:600 14px/1.35 ui-rounded,system-ui,sans-serif;
        box-shadow:0 6px 22px rgba(60,30,20,.22); border:2px solid #2a2220;
        opacity:0; transform:translateY(8px) scale(.96); transition:opacity .25s ease, transform .3s cubic-bezier(.3,1.6,.5,1); }
      .bubble.show { opacity:1; transform:none; }
      .bubble.deep { background:#141110; color:#f3ece4; border-color:#141110; font:700 15px/1.3 Georgia,serif;
        font-style:italic; letter-spacing:.06em; text-transform:uppercase; }
      .fx { position:fixed; font:700 22px system-ui; pointer-events:none; animation:float 1.6s ease-out forwards; }
      @keyframes float { 0%{opacity:0; transform:translate(0,0) scale(.5)} 15%{opacity:1; transform:translate(var(--dx),-14px) scale(1.1)}
        100%{opacity:0; transform:translate(calc(var(--dx)*2),-90px) scale(.9)} }
    </style>
    <canvas class="goose"></canvas>
    <div class="bubble"></div>`;
  document.documentElement.appendChild(host);
  const canvas = shadow.querySelector("canvas")!;
  const bubble = shadow.querySelector<HTMLDivElement>(".bubble")!;

  const stage = createStage(canvas, SIZE);
  const goose = new Goose();
  stage.scene.add(goose.root);

  // ---- state ----
  let x = 40 + Math.random() * 200; // left edge of canvas, px
  let y = 0; // height above ground, px
  let vx = 0;
  let vy = 0;
  let targetX = x;
  let level = 0; // 0 on track, 1 stare, 2 warn, 3 eat
  let busy = false; // eat sequence
  let held = false;
  let idleTimer = 2;
  let moodUntil = 0; // timed moods (nap/sit/happy/dizzy) end here
  let onTrackSince = Date.now();
  let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 };

  const setMood = (m: Mood, ms = 0) => {
    goose.mood = m;
    moodUntil = ms ? performance.now() + ms : 0;
  };
  const play = (a: Action) => goose.play(a);
  const headPos = () => ({ x: x + SIZE / 2, y: innerHeight - y - SIZE * 0.78 });

  const say = (text: string, ms = 5000, deep = false) => {
    if (!text) return;
    bubble.classList.toggle("deep", deep);
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout((say as any).t);
    (say as any).t = setTimeout(() => bubble.classList.remove("show"), ms);
  };

  function fx(symbol: string, n = 1, color = "") {
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const el = document.createElement("div");
        el.className = "fx";
        el.textContent = symbol;
        const h = headPos();
        el.style.left = `${h.x + (Math.random() - 0.5) * 60}px`;
        el.style.top = `${h.y - 20}px`;
        el.style.setProperty("--dx", `${(Math.random() - 0.5) * 30}px`);
        if (color) el.style.color = color;
        shadow.appendChild(el);
        setTimeout(() => el.remove(), 1700);
      }, i * 160);
    }
  }

  // ---- sounds (synthesized, no audio files) ----
  let audio: AudioContext | undefined;
  function honk(pitch = 1, vol = 0.45) {
    try {
      audio ??= new AudioContext();
      const ctx = audio;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(430 * pitch, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(310 * pitch, ctx.currentTime + 0.32);
      f.type = "bandpass";
      f.frequency.value = 950 * pitch;
      f.Q.value = 2.2;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);
      o.connect(f).connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    } catch {
      /* autoplay blocked until the user interacts with the page */
    }
  }
  const tinyHonk = () => honk(1.45, 0.18);

  // The goose drops the cute act: a deep movie-trailer voice (Gemini TTS, pre-generated per session).
  let speaking = false;
  async function deepVoice(kind: "warn" | "eat" | "idle"): Promise<void> {
    if (speaking) return;
    const res: { text: string; audio: string } | null = await chrome.runtime
      .sendMessage({ type: "voice", kind } satisfies ToBackground)
      .catch(() => null);
    if (!res) return;
    speaking = true;
    const prevMood = goose.mood;
    setMood("stare");
    goose.facing = 0;
    say(res.text, 4000, true);
    try {
      audio ??= new AudioContext();
      const bytes = Uint8Array.from(atob(res.audio), (c) => c.charCodeAt(0));
      const buf = await audio.decodeAudioData(bytes.buffer);
      const src = audio.createBufferSource();
      src.buffer = buf;
      src.connect(audio.destination);
      src.start();
      await sleep(buf.duration * 1000 + 300);
    } catch {
      await sleep(2200); // audio blocked: the subtitle still lands the joke
    }
    speaking = false;
    if (goose.mood === "stare" && !level) setMood(prevMood === "stare" ? "idle" : prevMood);
  }

  // ---- idle behavior scheduler (only when calm) ----
  const IDLE: [number, () => void][] = [
    [34, () => (targetX = Math.random() * (innerWidth - SIZE))],
    [10, () => play("peck")],
    [9, () => play("preen")],
    [9, () => play("lookAround")],
    [7, () => setMood("sit", 6000 + Math.random() * 6000)],
    [7, () => {
      setMood("nap", 9000 + Math.random() * 8000);
      fx("💤");
    }],
    [6, () => play("stretch")],
    [5, () => play("shake")],
    [4, () => {
      play("sneeze");
      setTimeout(() => tinyHonk(), 800);
    }],
    [4, () => play("flap")],
    [3, () => play("dance")],
    [2, () => deepVoice("idle")],
  ];
  function idleTick(dt: number) {
    if (level || busy || held || goose.isPlaying()) return;
    if (moodUntil && performance.now() > moodUntil) setMood("idle");
    if (goose.mood !== "idle") {
      if (goose.mood === "nap" && Math.random() < dt * 0.25) fx("z", 1, "#8a7f9a");
      return;
    }
    idleTimer -= dt;
    if (idleTimer > 0) return;
    idleTimer = 3 + Math.random() * 5;
    let r = Math.random() * IDLE.reduce((s, [w]) => s + w, 0);
    for (const [w, fn] of IDLE) if ((r -= w) <= 0) return fn();
  }

  // ---- main loop: physics-y walking with acceleration, so starts/stops ease in and out ----
  let last = performance.now();
  let lastAngryAt = 0;
  let frameNo = 0;
  function frame(now: number) {
    requestAnimationFrame(frame);
    if (document.hidden) return; // no work in background tabs
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const maxX = innerWidth - SIZE;

    // Calm down by itself if no new "off track" verdict arrives for a while.
    if (level && !busy && performance.now() - lastAngryAt > 20_000) {
      level = 0;
      setMood("idle");
    }
    goose.petting = performance.now() - lastPetAt < 350;

    idleTick(dt);

    if (!held) {
      // Horizontal: accelerate toward target, brake smoothly near it (arrive behavior).
      const canWalk = !["nap", "sit", "dizzy"].includes(goose.mood) || level > 0 || busy;
      const maxSpeed = busy ? 330 : level > 0 ? 190 : 85;
      const dx = canWalk ? targetX - x : 0;
      const desired = Math.sign(dx) * Math.min(maxSpeed, Math.abs(dx) * 2.2);
      vx += (desired - vx) * Math.min(1, dt * 5);
      x += vx * dt;
      // Vertical: gravity after being dropped
      if (y > 0 || vy !== 0) {
        vy -= 2600 * dt;
        y += vy * dt;
        if (y <= 0) {
          const impact = -vy;
          y = 0;
          vy = 0;
          play("land");
          if (impact > 1100) {
            setMood("dizzy", 2200);
            fx("💫", 2);
            tinyHonk();
          }
        }
      }
    }
    x = Math.max(0, Math.min(maxX, x));
    goose.speed = Math.min(1, Math.abs(vx) / 120);
    goose.velocityX = vx;
    goose.facing = Math.abs(vx) > 25 ? Math.sign(vx) : 0;

    // Head follows the cursor (or the target while eating)
    const h = headPos();
    goose.setLook((lastPointer.x - h.x) / 600, (lastPointer.y - h.y) / 400);

    canvas.style.transform = `translate3d(${x}px, ${-y}px, 0)`;
    bubble.style.left = `${Math.max(8, Math.min(innerWidth - 280, x + SIZE / 2 - 50))}px`;
    bubble.style.bottom = `${y + SIZE - 18}px`;

    // Celebrate focus streaks
    if (!level && !busy && Date.now() - onTrackSince > STREAK_MS) {
      onTrackSince = Date.now();
      play("dance");
      fx("✨", 3);
      say(["Look at you go!", "Focused goose approves.", "Great streak. Keep honking along!"][Math.floor(Math.random() * 3)], 3500);
    }

    goose.update(dt);
    // Render at 30 fps when nothing much is happening (napping/sitting, standing still), 60 otherwise.
    const calm = !held && !busy && Math.abs(vx) < 5 && !goose.isPlaying() && !goose.petting && ["nap", "sit"].includes(goose.mood);
    if (!calm || frameNo++ % 2 === 0) stage.render();
  }
  requestAnimationFrame(frame);

  // ---- pointer interactions: pet, click, drag & drop ----
  let down: { x: number; y: number; t: number } | undefined;
  let dragOffset = { x: 0, y: 0 };
  let clicks: number[] = [];
  let petDistance = 0;
  let petCount = 0;
  let lastPetAt = 0;
  canvas.addEventListener("pointerleave", () => (lastPetAt = 0));

  addEventListener("pointermove", (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
  }, { passive: true });

  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    dragOffset = { x: e.clientX - x, y: innerHeight - e.clientY - y };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (down && !held && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8 && !busy) {
      held = true;
      canvas.classList.add("held");
      setMood("held");
      tinyHonk();
    }
    if (held) {
      const nx = e.clientX - dragOffset.x;
      vx = (nx - x) / 0.016;
      x = nx;
      y = Math.max(0, innerHeight - e.clientY - dragOffset.y);
      vy = 0;
      return;
    }
    // Petting: stroking the cursor over the goose (works any time it isn't eating)
    if (!down && !busy) {
      lastPetAt = performance.now();
      if (goose.mood === "nap") setMood("idle");
      petDistance += Math.hypot(e.movementX, e.movementY);
      if (petDistance > 110) {
        petDistance = 0;
        fx(Math.random() < 0.8 ? "💗" : "✨");
        petCount++;
        if (petCount % 6 === 0) {
          play("wiggle");
          tinyHonk();
          say(["*happy honk*", "More pets, please.", "Okay, okay, I forgive you."][Math.floor(Math.random() * 3)], 1800);
        }
      }
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    canvas.releasePointerCapture(e.pointerId);
    if (held) {
      held = false;
      canvas.classList.remove("held");
      setMood("idle");
      vy = 0;
      if (y < 4) play("land");
      targetX = x;
      down = undefined;
      return;
    }
    down = undefined;
    // Clicks: 1 = hop, 2 = spin, 4+ quickly = annoyed. Any click also asks for a re-check.
    const now = performance.now();
    clicks = [...clicks.filter((c) => now - c < 1200), now];
    if (level) return chrome.runtime.sendMessage({ type: "recheck" } satisfies ToBackground);
    if (clicks.length >= 4) {
      clicks = [];
      goose.express("squint", 1800);
      play("shake");
      fx("💢");
      honk(1.1, 0.3);
      say(["Personal space!", "HONK. I'm working here.", "Touch the textbook, not the goose."][Math.floor(Math.random() * 3)], 2500);
    } else if (clicks.length === 2) {
      play("spin");
    } else {
      setMood("idle");
      play("hop");
      tinyHonk();
    }
  });

  // ---- reactions to what you're doing on the page ----
  let lastKeyNod = 0;
  addEventListener("keydown", () => {
    const now = performance.now();
    if (level || busy || now - lastKeyNod < 6000) return;
    lastKeyNod = now;
    if (goose.mood === "nap") return;
    play("nod");
  }, { passive: true });

  let lastScrollY = scrollY;
  let lastScrollReact = 0;
  addEventListener("scroll", () => {
    const now = performance.now();
    const d = Math.abs(scrollY - lastScrollY);
    lastScrollY = scrollY;
    if (d > 500 && now - lastScrollReact > 4000 && !busy && !held) {
      lastScrollReact = now;
      goose.express("surprised", 900);
      if (goose.mood === "nap") setMood("idle");
    }
  }, { passive: true });

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
    targetX = Math.max(0, Math.min(innerWidth - SIZE, r.left + r.width / 2 - SIZE / 2));
    setMood("warn");
    play("honk");
    honk();
    await sleep(700);
    play("honk");
    honk(0.95);
    await sleep(Math.min(1600, Math.abs(targetX - x) * 4 + 300));
    if (target instanceof HTMLVideoElement) target.pause();
    const beakX = x + SIZE / 2;
    const beakY = innerHeight - y - SIZE * 0.62;
    target.style.transition = "transform 1.15s cubic-bezier(.6,-0.35,.7,1), opacity 1.15s, filter 1.15s";
    target.style.transformOrigin = `${beakX - r.left}px ${beakY - r.top}px`;
    setMood("gulp");
    requestAnimationFrame(() => {
      target.style.transform = "scale(0.02) rotate(28deg)";
      target.style.opacity = "0.15";
      target.style.filter = "blur(2px)";
    });
    await sleep(1300);
    setMood("idle");
    play("burp");
    await deepVoice("eat");
    chrome.runtime.sendMessage({ type: "eaten" } satisfies ToBackground);
  }

  // After being sent back here, the goose greets you.
  chrome.storage.local.get("justAte").then(({ justAte }) => {
    if (justAte && Date.now() - justAte < 15_000) {
      chrome.storage.local.remove("justAte");
      setTimeout(() => {
        play("burp");
        fx("✨", 2);
        say(["Much better. Back to work!", "That was delicious. Focus time.", "Burp. You're welcome."][Math.floor(Math.random() * 3)], 3500);
      }, 900);
    }
  });

  // ---- messages from the background worker ----
  chrome.runtime.onMessage.addListener((msg: ToContent, _s, reply) => {
    switch (msg.type) {
      case "rects": {
        // Where the goose and bubble are, so the background can mask them out of the screenshot.
        const boxes = [canvas.getBoundingClientRect()];
        if (bubble.classList.contains("show")) boxes.push(bubble.getBoundingClientRect());
        reply({ dpr: devicePixelRatio, viewportW: innerWidth, boxes: boxes.map(({ x, y, width: w, height: h }) => ({ x, y, w, h })) });
        return;
      }
      case "idle":
        if (!busy) {
          level = 0;
          setMood("nap", 20000);
        }
        break;
      case "thinking":
        if (!busy && !level && goose.mood === "idle") {
          setMood("think", 2500);
          fx("❔");
        }
        break;
      case "happy":
        if (level > 0) {
          say("Good. Back on track.", 2500);
          play("nod");
          onTrackSince = Date.now();
        }
        if (!busy) {
          level = 0;
          if (goose.mood === "stare" || goose.mood === "warn") setMood("idle");
        }
        break;
      case "angry":
        if (busy) break;
        level = msg.level;
        lastAngryAt = performance.now();
        targetX = innerWidth / 2 - SIZE / 2; // come front and center
        onTrackSince = Date.now();
        if (msg.level === 1) {
          setMood("stare");
          fx("❗");
        }
        if (msg.level === 2) {
          setMood("warn");
          play("honk");
          honk();
          fx("💢");
          say(msg.line, 2600);
          setTimeout(() => level === 2 && !busy && deepVoice("warn"), 2700);
        }
        if (msg.level >= 3) {
          say(msg.line || "HONK.", 4000);
          eat();
        }
        break;
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
