// Kawaii goose: an original rigged three.js model (bone skeleton + skinned neck), physically based
// "animated film" look, and spring-driven animation so every transition blends smoothly.
// Design reference: docs/goose-concept.jpg (generated with Nano Banana during the hackathon).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export type Mood = "idle" | "nap" | "sit" | "think" | "stare" | "warn" | "gulp" | "held" | "dizzy" | "happy";
export type Action =
  | "hop" | "peck" | "preen" | "flap" | "spin" | "dance" | "shake" | "nod" | "honk" | "stretch" | "burp" | "wiggle"
  | "lookAround" | "sneeze" | "land";
export type Expression = "normal" | "happy" | "squint" | "sleep" | "surprised" | "dizzy";

// ---------------------------------------------------------------- stage (renderer, lights, camera)
// Tuned for speed: standard materials, no real-time shadow map (baked blob shadow instead),
// capped pixel ratio. The look stays soft thanks to environment lighting + 3-point lights.
export function createStage(canvas: HTMLCanvasElement, size: number) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();

  // Three-point lighting: warm key, cool fill, bright rim.
  const key = new THREE.DirectionalLight(0xfff0dc, 2.4);
  key.position.set(-3, 6, 5);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6);
  fill.position.set(4, 2, 4);
  const rim = new THREE.DirectionalLight(0xfff6e8, 1.8);
  rim.position.set(1.5, 4, -6);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xffffff, 0xd9cbb5, 0.4));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  // Framed so the tallest pose (hop + full neck stretch, ~5.6 units) never clips.
  camera.position.set(0, 2.7, 13.2);
  camera.lookAt(0, 2.25, 0);
  return { renderer, scene, camera, render: () => renderer.render(scene, camera) };
}

// Soft blob shadow baked into a tiny texture (much cheaper than a shadow map).
const shadowTexture = (() => {
  if (typeof document === "undefined") return null; // e.g. the Node animation test
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, "rgba(60,40,30,0.38)");
  grad.addColorStop(1, "rgba(60,40,30,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// ---------------------------------------------------------------- materials
// A touch of warm emissive fakes the soft light-through-feathers look without costly sheen.
const M = {
  feather: new THREE.MeshStandardMaterial({ color: 0xfffaf3, roughness: 0.68, emissive: 0x2a1e14, emissiveIntensity: 0.35 }),
  wing: new THREE.MeshStandardMaterial({ color: 0xf4ece0, roughness: 0.72, emissive: 0x2a1e14, emissiveIntensity: 0.3 }),
  beak: new THREE.MeshStandardMaterial({ color: 0xff8418, roughness: 0.32 }),
  beakDark: new THREE.MeshStandardMaterial({ color: 0xe8700f, roughness: 0.38 }),
  feet: new THREE.MeshStandardMaterial({ color: 0xff8418, roughness: 0.45 }),
  eye: new THREE.MeshPhysicalMaterial({ color: 0x14100f, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
  sparkle: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
  line: new THREE.MeshBasicMaterial({ color: 0x1d1716 }),
  scarf: new THREE.MeshStandardMaterial({ color: 0xa82320, roughness: 0.92 }),
  tassel: new THREE.MeshStandardMaterial({ color: 0x7e1715, roughness: 0.92 }),
  blush: new THREE.MeshBasicMaterial({ color: 0xff8fa0, transparent: true, opacity: 0.55, depthWrite: false }),
  shadow: new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }),
};

function part(geo: THREE.BufferGeometry, mat: THREE.Material) {
  return new THREE.Mesh(geo, mat);
}

// ---------------------------------------------------------------- springs (smooth, physical transitions)
type Channel =
  | "bodyY" | "squash" | "lean" | "twist" | "neckBend" | "neckStretch" | "headTilt" | "headTurn" | "headPitch"
  | "jaw" | "wingL" | "wingR" | "legL" | "legR" | "tail" | "sit" | "scarf" | "blush" | "yaw";
type Pose = Record<Channel, number>;
const REST: Pose = {
  bodyY: 0, squash: 1, lean: 0, twist: 0, neckBend: 0, neckStretch: 1, headTilt: 0, headTurn: 0, headPitch: 0,
  jaw: 0, wingL: 0, wingR: 0, legL: 0, legR: 0, tail: 0, sit: 0, scarf: 0, blush: 0.55, yaw: 0,
};
// [stiffness, damping ratio]: lower stiffness = more follow-through; ratio < 1 = slight overshoot.
const SPRING: Record<Channel, [number, number]> = {
  bodyY: [260, 0.7], squash: [320, 0.45], lean: [160, 0.75], twist: [200, 0.8], neckBend: [150, 0.7],
  neckStretch: [220, 0.5], headTilt: [110, 0.6], headTurn: [95, 0.7], headPitch: [110, 0.65], jaw: [420, 0.8],
  wingL: [300, 0.55], wingR: [300, 0.55], legL: [420, 0.9], legR: [420, 0.9], tail: [70, 0.35], sit: [120, 0.9],
  scarf: [45, 0.3], blush: [60, 1], yaw: [80, 0.85],
};
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const DUR: Record<Action, number> = {
  hop: 0.75, peck: 1.3, preen: 2.0, flap: 1.1, spin: 1.0, dance: 3.4, shake: 0.9, nod: 1.0, honk: 0.8,
  stretch: 1.9, burp: 1.2, wiggle: 1.3, lookAround: 2.4, sneeze: 1.3, land: 0.5,
};

// ---------------------------------------------------------------- the goose
export class Goose {
  readonly root = new THREE.Group();
  mood: Mood = "idle";
  facing = 0; // -1 left, 0 toward viewer, 1 right
  speed = 0; // 0..1, set by the walker; drives stride smoothly
  velocityX = 0; // px/s, for secondary motion

  private look = new THREE.Vector2();
  private hips = new THREE.Bone();
  private spine = new THREE.Bone();
  private neck1 = new THREE.Bone();
  private neck2 = new THREE.Bone();
  private headBone = new THREE.Bone();
  private jawBone = new THREE.Bone();
  private wingBoneL = new THREE.Bone();
  private wingBoneR = new THREE.Bone();
  private legBoneL = new THREE.Bone();
  private legBoneR = new THREE.Bone();
  private tailBone = new THREE.Bone();
  readonly skeleton: THREE.Skeleton;

  private scarfTails: THREE.Object3D[] = [];
  private blob!: THREE.Mesh;
  petting = false; // set while the cursor strokes the goose
  private eyes = {} as Record<Expression, THREE.Group[]>;
  private brows: THREE.Mesh[] = [];
  private blushMat = M.blush;

  private x: Pose = { ...REST };
  private v: Pose = Object.fromEntries(Object.keys(REST).map((k) => [k, 0])) as Pose;
  private t = 0;
  private phase = 0;
  private walkW = 0;
  private actions: { name: Action; t: number; dur: number }[] = [];
  private expression: Expression = "normal";
  private shownExpr: Expression = "normal";
  private exprSwitchAt = 0;
  private exprOverride?: { e: Expression; until: number };
  private blinkAt = 2;

  constructor() {
    const b = this;
    b.hips.position.set(0, 0.6, 0);
    b.spine.position.set(0, 0.45, 0);
    b.neck1.position.set(0, 0.55, 0.05);
    b.neck2.position.set(0, 0.2, 0.03);
    b.headBone.position.set(0, 0.18, 0.02);
    b.jawBone.position.set(0, 0.38, 0.74);
    b.wingBoneL.position.set(0.97, 0.28, 0.02);
    b.wingBoneR.position.set(-0.97, 0.28, 0.02);
    b.legBoneL.position.set(0.36, -0.12, 0.1);
    b.legBoneR.position.set(-0.36, -0.12, 0.1);
    b.tailBone.position.set(0, 0.3, -0.85);
    b.hips.add(b.spine, b.legBoneL, b.legBoneR, b.tailBone);
    b.spine.add(b.neck1, b.wingBoneL, b.wingBoneR);
    b.neck1.add(b.neck2);
    b.neck2.add(b.headBone);
    b.headBone.add(b.jawBone);
    this.skeleton = new THREE.Skeleton([
      b.hips, b.spine, b.neck1, b.neck2, b.headBone, b.jawBone, b.wingBoneL, b.wingBoneR, b.legBoneL, b.legBoneR, b.tailBone,
    ]);
    this.root.add(b.hips);

    // Body: chubby egg
    const body = part(new THREE.SphereGeometry(1, 40, 28), M.feather);
    body.scale.set(1.02, 0.95, 0.92);
    body.position.y = 0.42;
    b.hips.add(body);

    // Tail tuft
    const tail = part(new THREE.SphereGeometry(0.3, 20, 14), M.feather);
    tail.scale.set(0.9, 0.7, 1.5);
    tail.rotation.x = -0.6;
    b.tailBone.add(tail);

    this.addSkinnedNeck();

    // Head: big round chibi head
    const head = part(new THREE.SphereGeometry(0.98, 40, 28), M.feather);
    head.scale.set(1, 0.96, 0.95);
    head.position.y = 0.55;
    b.headBone.add(head);

    // Beak
    const upper = part(new THREE.SphereGeometry(0.3, 24, 14), M.beak);
    upper.scale.set(1.05, 0.42, 0.9);
    upper.position.set(0, 0.43, 0.9);
    b.headBone.add(upper);
    const lower = part(new THREE.SphereGeometry(0.24, 24, 14), M.beakDark);
    lower.scale.set(0.95, 0.35, 0.85);
    lower.position.set(0, -0.02, 0.15);
    b.jawBone.add(lower);

    // Face
    for (const side of [1, -1]) {
      this.addEye(side);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), this.blushMat);
      blush.scale.set(1.3, 0.75, 1);
      blush.position.set(side * 0.6, 0.34, 0.79);
      blush.rotation.y = side * 0.58;
      b.headBone.add(blush);
      const brow = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), M.line);
      brow.rotation.z = Math.PI / 2 + side * -0.45;
      brow.position.set(side * 0.36, 0.98, 0.84);
      brow.visible = false;
      b.headBone.add(brow);
      this.brows.push(brow);
    }

    // Stubby wings
    for (const [bone, side] of [[b.wingBoneL, 1], [b.wingBoneR, -1]] as const) {
      const w = part(new THREE.SphereGeometry(0.5, 24, 16), M.wing);
      w.scale.set(0.42, 0.95, 0.8);
      w.position.set(side * 0.05, -0.2, 0);
      w.rotation.z = side * 0.25;
      bone.add(w);
    }

    // Legs + webbed feet
    for (const bone of [b.legBoneL, b.legBoneR]) {
      const leg = part(new THREE.CapsuleGeometry(0.085, 0.3, 6, 16), M.feet);
      leg.position.y = -0.2;
      const foot = part(new THREE.SphereGeometry(0.26, 20, 10), M.feet);
      foot.scale.set(1, 0.3, 1.25);
      foot.position.set(0, -0.42, 0.14);
      bone.add(leg, foot);
    }

    // Knit scarf with swinging tails
    const scarf = part(new THREE.TorusGeometry(0.62, 0.2, 14, 40), M.scarf);
    scarf.rotation.x = Math.PI / 2 - 0.12;
    scarf.position.set(0, 0.62, 0.05);
    b.spine.add(scarf);
    for (const [x, rz, len] of [[0.28, 0.08, 0.72], [0.52, 0.34, 0.58]] as const) {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 0.62, 0.68);
      pivot.userData.rz = rz;
      const piece = part(new THREE.CapsuleGeometry(0.15, len - 0.25, 6, 16), M.scarf);
      piece.scale.z = 0.5;
      piece.position.y = -len / 2;
      for (let i = -1; i <= 1; i++) {
        const tassel = part(new THREE.SphereGeometry(0.05, 8, 6), M.tassel);
        tassel.position.set(i * 0.07, -len / 2 - 0.06, 0);
        piece.add(tassel);
      }
      pivot.add(piece);
      b.spine.add(pivot);
      this.scarfTails.push(pivot);
    }

    // Baked soft shadow on the ground (stays on the ground while the body hops)
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), M.shadow);
    this.blob.rotation.x = -Math.PI / 2;
    this.blob.position.set(0.25, 0.01, 0.15);
    this.root.add(this.blob);

    this.setExpressionNow("normal");
  }

  private addSkinnedNeck() {
    const h = 1.2;
    const geo = new THREE.CylinderGeometry(0.5, 0.62, h, 28, 8, true);
    geo.translate(0, h / 2, 0);
    const pos = geo.attributes.position;
    const idx: number[] = [];
    const wts: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / h; // skeleton indices: 2 neck1, 3 neck2, 4 head
      if (y < 0.5) idx.push(2, 3, 0, 0), wts.push(1 - y / 0.5, y / 0.5, 0, 0);
      else idx.push(3, 4, 0, 0), wts.push(1 - (y - 0.5) / 0.5, (y - 0.5) / 0.5, 0, 0);
    }
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(idx, 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(wts, 4));
    const neck = new THREE.SkinnedMesh(geo, M.feather);
        neck.frustumCulled = false;
    this.root.updateMatrixWorld(true);
    neck.position.copy(this.neck1.getWorldPosition(new THREE.Vector3()));
    this.root.add(neck);
    neck.updateMatrixWorld(true);
    neck.bind(this.skeleton);
  }

  private addEye(side: number) {
    const add = (e: Expression, g: THREE.Group) => {
      g.position.set(side * 0.38, 0.62, 0.85);
      g.rotation.y = side * 0.32;
      this.headBone.add(g);
      (this.eyes[e] ??= []).push(g);
    };
    const glossy = (scale = 1) => {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 16), M.eye);
      ball.scale.set(0.9, 1.08, 0.5);
      const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 12), M.sparkle);
      s1.position.set(side * -0.05, 0.08, 0.1);
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), M.sparkle);
      s2.position.set(side * 0.06, -0.07, 0.1);
      g.add(ball, s1, s2);
      g.scale.setScalar(scale);
      return g;
    };
    const arc = (flip: boolean) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.034, 12, 32, Math.PI), M.line);
      if (flip) m.rotation.z = Math.PI;
      g.add(m);
      return g;
    };
    add("normal", glossy());
    add("surprised", glossy(1.25));
    add("happy", arc(false));
    add("sleep", arc(true));
    const squint = new THREE.Group();
    for (const dir of [1, -1]) {
      const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.16, 4, 8), M.line);
      bar.rotation.z = Math.PI / 2 + side * dir * 0.5;
      bar.position.set(side * 0.03, dir * 0.045, 0);
      squint.add(bar);
    }
    add("squint", squint);
    const dizzy = new THREE.Group();
    for (const r of [0.16, 0.09]) dizzy.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.024, 8, 32), M.line));
    add("dizzy", dizzy);
  }

  // ---------------------------------------------------------------- public API
  setLook(x: number, y: number) {
    this.look.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }
  express(e: Expression, ms = 1500) {
    this.exprOverride = { e, until: this.t + ms / 1000 };
  }
  play(name: Action) {
    // Restarting the same action blends from its current state instead of stacking it.
    this.actions = this.actions.filter((a) => a.name !== name);
    this.actions.push({ name, t: 0, dur: DUR[name] });
  }
  isPlaying(name?: Action) {
    return name ? this.actions.some((a) => a.name === name) : this.actions.length > 0;
  }

  // ---------------------------------------------------------------- per-frame
  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const target: Pose = { ...REST };
    let expr: Expression = "normal";
    let brows = false;

    // Locomotion blends in/out with speed; stride phase advances continuously (no pops).
    this.walkW += (Math.min(1, this.speed) - this.walkW) * Math.min(1, dt * 6);
    this.phase += dt * (5 + 7 * this.walkW) * Math.min(1, this.walkW * 3);
    const w = this.walkW;
    const s = Math.sin(this.phase * 2);
    target.legL = s * 0.6 * w;
    target.legR = -s * 0.6 * w;
    target.twist = s * 0.14 * w;
    target.lean = 0.1 * w;
    target.bodyY = Math.abs(s) * 0.1 * w;
    target.headTilt = s * 0.06 * w;
    target.wingL = target.wingR = (0.12 + Math.abs(s) * 0.12) * w;

    // Base mood
    switch (this.mood) {
      case "nap":
        expr = "sleep";
        Object.assign(target, { neckBend: 0.35, neckStretch: 0.82, headTilt: 0.28, sit: 1 });
        target.squash = 1 + Math.sin(t * 1.6) * 0.03;
        break;
      case "sit":
        target.sit = 1;
        target.squash = 1 + Math.sin(t * 2) * 0.015;
        break;
      case "think":
        target.headTilt += 0.32 + Math.sin(t * 2.2) * 0.05;
        target.headPitch = -0.12;
        break;
      case "stare":
        expr = "normal";
        brows = true;
        Object.assign(target, { neckStretch: 1.12, headPitch: 0.08, lean: target.lean + 0.1 });
        break;
      case "warn":
        expr = "squint";
        brows = true;
        target.neckStretch = 1.25;
        target.lean += 0.18;
        target.jaw = Math.max(0, Math.sin(t * 16)) * 0.45;
        target.wingL = target.wingR = 0.6 + Math.sin(t * 22) * 0.4;
        target.squash = 1.06;
        break;
      case "gulp":
        expr = "squint";
        target.neckStretch = 1.35 + Math.sin(t * 9) * 0.15;
        target.jaw = 0.6;
        target.headPitch = -0.3;
        break;
      case "held":
        expr = "surprised";
        target.legL = Math.sin(t * 18) * 0.7;
        target.legR = -Math.sin(t * 18) * 0.7;
        target.wingL = target.wingR = 0.8 + Math.sin(t * 20) * 0.5;
        target.squash = 0.93;
        break;
      case "dizzy":
        expr = "dizzy";
        target.headTilt = Math.sin(t * 5) * 0.3;
        target.twist = Math.sin(t * 5) * 0.15;
        break;
      case "happy":
        expr = "happy";
        target.blush = 0.95;
        target.bodyY += Math.abs(Math.sin(t * 6)) * 0.08;
        target.wingL = target.wingR = 0.35 + Math.sin(t * 12) * 0.2;
        break;
      default:
        target.squash = 1 + Math.sin(t * 2) * 0.012;
        target.headTilt += Math.sin(t * 0.9) * 0.05;
    }

    // Being petted: melt into the hand (happy eyes, blush, head tilted into the cursor, little wiggle).
    if (this.petting && !["held", "gulp"].includes(this.mood)) {
      expr = "happy";
      brows = false;
      target.blush = 1;
      target.headTilt += 0.28 * (this.look.x >= 0 ? 1 : -1);
      target.neckStretch = Math.min(target.neckStretch, 0.92);
      target.squash *= 1.03;
      target.tail = Math.sin(t * 14) * 0.35;
      target.wingL = target.wingR = Math.max(target.wingL, 0.15);
    }

    if (!["nap", "held", "gulp"].includes(this.mood)) {
      target.headTurn += this.look.x * 0.55;
      target.headPitch += -this.look.y * 0.25;
    }

    // Actions: each one builds its own pose and is cross-faded in/out with an eased weight.
    for (const a of this.actions) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const weight = smoothstep(0, 0.12, a.t) * (1 - smoothstep(a.dur - 0.18, a.dur, a.t));
      const q: Pose = { ...target };
      const e = this.actionPose(a.name, a.t, k, q);
      for (const c of Object.keys(target) as Channel[]) target[c] += (q[c] - target[c]) * weight;
      if (e && weight > 0.5) expr = e;
    }
    this.actions = this.actions.filter((a) => a.t < a.dur);

    if (this.exprOverride && t < this.exprOverride.until) expr = this.exprOverride.e;

    // Secondary motion targets
    target.scarf = THREE.MathUtils.clamp(-this.velocityX * 0.0016, -0.6, 0.6);
    target.tail += THREE.MathUtils.clamp(this.velocityX * 0.001, -0.4, 0.4);
    target.yaw = this.facing * 0.95;

    this.integrate(target, dt);
    this.applyRig();
    this.updateExpression(expr, brows);
  }

  // Each action returns an optional expression and writes its pose into q.
  private actionPose(name: Action, at: number, k: number, q: Pose): Expression | void {
    const bell = Math.sin(k * Math.PI);
    switch (name) {
      case "hop": {
        // Anticipation crouch → launch → airborne → landing squash
        if (k < 0.22) {
          q.squash = 0.8;
          q.bodyY -= 0.12;
        } else if (k < 0.82) {
          const air = Math.sin(((k - 0.22) / 0.6) * Math.PI);
          q.bodyY += air * 0.95;
          q.squash = 1.12;
          q.wingL = q.wingR = 0.9;
          q.legL = q.legR = -0.4;
        } else q.squash = 0.82;
        return "happy";
      }
      case "land":
        q.squash = 0.78 + k * 0.22;
        return "surprised";
      case "peck": {
        const pk = Math.max(0, Math.sin(k * Math.PI * 3));
        q.neckBend = pk * 1.1;
        q.headPitch += pk * 0.5;
        q.lean += bell * 0.25;
        return;
      }
      case "preen":
        q.headTurn = Math.sin(k * Math.PI) * 1.3;
        q.neckBend = bell * 0.4;
        q.headPitch += bell * 0.4;
        q.wingL = bell * 0.5 + Math.sin(at * 20) * 0.1 * bell;
        return "happy";
      case "flap":
        q.wingL = q.wingR = 0.5 + Math.sin(at * 26) * 0.7;
        q.bodyY += bell * 0.15;
        return;
      case "spin":
        q.twist += k * Math.PI * 2;
        q.bodyY += bell * 0.3;
        return "happy";
      case "dance": {
        const beat = Math.sin(at * 9);
        q.twist += beat * 0.35;
        q.headTilt = -beat * 0.25;
        q.bodyY += Math.abs(beat) * 0.18;
        q.wingL = Math.max(0, beat) * 1.1;
        q.wingR = Math.max(0, -beat) * 1.1;
        q.legL = beat * 0.3;
        q.legR = -beat * 0.3;
        q.blush = 1;
        return "happy";
      }
      case "shake":
        q.twist += Math.sin(at * 45) * 0.18 * bell;
        q.squash *= 1 + bell * 0.06;
        return;
      case "nod":
        q.headPitch += Math.sin(k * Math.PI * 4) * 0.25;
        return "happy";
      case "honk":
        q.neckStretch = Math.max(q.neckStretch, 1 + bell * 0.45);
        q.jaw = Math.max(q.jaw, bell * 0.7);
        q.lean += bell * 0.2;
        q.wingL = q.wingR = Math.max(q.wingL, bell * 0.8);
        return this.mood === "warn" ? "squint" : "surprised";
      case "stretch":
        q.neckStretch = 1 + bell * 0.55;
        q.wingL = q.wingR = bell * 1.2;
        q.jaw = bell * 0.4;
        return k > 0.2 && k < 0.8 ? "sleep" : undefined;
      case "burp":
        q.squash *= 1 + bell * 0.12;
        q.jaw = bell * 0.5;
        q.headPitch -= bell * 0.2;
        return "happy";
      case "wiggle":
        q.twist += Math.sin(at * 18) * 0.2;
        q.tail = Math.sin(at * 24) * 0.6;
        q.blush = 1;
        return "happy";
      case "lookAround":
        q.headTurn = Math.sin(k * Math.PI * 2) * 0.9;
        q.headPitch += Math.sin(k * Math.PI * 4) * 0.08;
        return;
      case "sneeze":
        if (k < 0.6) {
          q.headPitch = -0.35 * (k / 0.6);
          q.neckStretch = 1 + 0.2 * (k / 0.6);
          return "sleep";
        }
        q.headPitch = 0.5 * (1 - k);
        q.jaw = 0.5 * (1 - k);
        q.squash = 0.9;
        return "squint";
    }
  }

  private integrate(target: Pose, dt: number) {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (const c of Object.keys(target) as Channel[]) {
      const [k, zeta] = SPRING[c];
      const damp = 2 * zeta * Math.sqrt(k);
      let x = this.x[c];
      let v = this.v[c];
      for (let i = 0; i < steps; i++) {
        v += (k * (target[c] - x) - damp * v) * h;
        x += v * h;
      }
      // Safety: a bad value (NaN/∞) would make the whole goose vanish; snap that channel back to rest.
      if (!Number.isFinite(x) || !Number.isFinite(v)) {
        x = REST[c];
        v = 0;
      }
      this.x[c] = x;
      this.v[c] = v;
    }
  }

  private applyRig() {
    const p = this.x;
    const sitDrop = p.sit * 0.3;
    this.hips.position.y = 0.6 + p.bodyY - sitDrop;
    const sq = Math.max(0.6, p.squash);
    this.hips.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); // volume-preserving squash & stretch
    this.hips.rotation.set(p.lean, p.twist, 0);
    this.neck1.rotation.x = p.neckBend * 0.6;
    this.neck2.rotation.x = p.neckBend * 0.4;
    const ns = Math.max(0.6, p.neckStretch);
    this.neck1.scale.y = this.neck2.scale.y = ns;
    this.headBone.scale.y = 1 / (ns * ns); // keep the head round while the neck stretches
    this.headBone.rotation.set(p.headPitch, p.headTurn, p.headTilt);
    this.jawBone.rotation.x = Math.max(0, p.jaw);
    this.wingBoneL.rotation.z = p.wingL;
    this.wingBoneR.rotation.z = -p.wingR;
    this.legBoneL.rotation.x = p.legL;
    this.legBoneR.rotation.x = p.legR;
    const legScale = 1 - Math.min(1, p.sit) * 0.85; // tuck feet smoothly when sitting
    this.legBoneL.scale.y = this.legBoneR.scale.y = Math.max(0.05, legScale);
    this.tailBone.rotation.y = p.tail;
    this.scarfTails.forEach((s, i) => (s.rotation.z = s.userData.rz + p.scarf * (1 + i * 0.4)));
    this.blushMat.opacity = THREE.MathUtils.clamp(p.blush, 0, 1);
    this.root.rotation.y = p.yaw;
    this.blob.scale.setScalar(Math.max(0.45, 1 - Math.max(0, p.bodyY) * 0.45));
  }

  // Expressions change behind a quick blink so eyes never "pop" between shapes.
  private updateExpression(expr: Expression, brows: boolean) {
    const t = this.t;
    if (expr === "normal" && t > this.blinkAt) {
      if (t > this.blinkAt + 0.11) this.blinkAt = t + 2 + Math.random() * 3.5;
      else expr = "sleep";
    }
    if (expr !== this.expression) {
      this.expression = expr;
      this.exprSwitchAt = t + 0.07;
      if (this.shownExpr !== "sleep" && expr !== "sleep") this.setExpressionNow("sleep");
    }
    if (t >= this.exprSwitchAt && this.shownExpr !== this.expression) this.setExpressionNow(this.expression);
    this.brows.forEach((b) => (b.visible = brows));
  }

  private setExpressionNow(e: Expression) {
    this.shownExpr = e;
    for (const [key, groups] of Object.entries(this.eyes)) groups.forEach((g) => (g.visible = key === e));
  }
}
