// An original low-poly goose built from three.js primitives, with procedural animation.
import * as THREE from "three";

export type GooseMode = "wander" | "nap" | "think" | "stare" | "warn" | "honk" | "gulp";

const WHITE = 0xf7f5ef;
const ORANGE = 0xff8c1a;
const BLACK = 0x161616;
const SCARF = 0xd7263d;

const toon = (color: number) => new THREE.MeshToonMaterial({ color });

export class Goose {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private lowerBeak!: THREE.Mesh;
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private wingL!: THREE.Mesh;
  private wingR!: THREE.Mesh;
  private eyes: THREE.Mesh[] = [];
  private t = 0;
  mode: GooseMode = "wander";
  walking = false;

  constructor() {
    // Body
    const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), toon(WHITE));
    torso.scale.set(1.35, 0.85, 0.9);
    this.body.add(torso);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 10), toon(WHITE));
    tail.position.set(-1.35, 0.25, 0);
    tail.rotation.z = Math.PI / 2.6;
    this.body.add(tail);

    // Wings
    const wingGeo = new THREE.SphereGeometry(0.7, 14, 10);
    this.wingL = new THREE.Mesh(wingGeo, toon(0xe9e6dc));
    this.wingL.scale.set(1.25, 0.55, 0.25);
    this.wingL.position.set(-0.1, 0.15, 0.82);
    this.wingR = this.wingL.clone();
    this.wingR.position.z = -0.82;
    this.body.add(this.wingL, this.wingR);

    // Neck (stack of spheres so it can bend/stretch)
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.32 - i * 0.015, 12, 10), toon(WHITE));
      seg.position.set(i * 0.12, i * 0.32, 0);
      this.neck.add(seg);
    }
    this.neck.position.set(0.95, 0.45, 0);

    // Scarf (the goose's signature accessory)
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.11, 8, 18), toon(SCARF));
    scarf.rotation.x = Math.PI / 2;
    scarf.position.set(0.95, 0.55, 0);
    const tassel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.08), toon(SCARF));
    tassel.position.set(0.7, 0.3, 0.3);
    tassel.rotation.z = 0.4;
    this.body.add(scarf, tassel);

    // Head
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), toon(WHITE));
    skull.scale.set(1.15, 0.95, 0.9);
    this.head.add(skull);
    const upperBeak = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 10), toon(ORANGE));
    upperBeak.rotation.z = -Math.PI / 2;
    upperBeak.position.set(0.62, 0.02, 0);
    this.lowerBeak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 10), toon(0xe5760f));
    this.lowerBeak.rotation.z = -Math.PI / 2;
    this.lowerBeak.position.set(0.56, -0.1, 0);
    this.head.add(upperBeak, this.lowerBeak);
    for (const z of [0.3, -0.3]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), toon(BLACK));
      eye.position.set(0.22, 0.12, z);
      this.eyes.push(eye);
      this.head.add(eye);
    }
    this.head.position.set(0.55, 1.6, 0);
    this.neck.add(this.head);
    this.body.add(this.neck);

    // Legs
    for (const [leg, z] of [
      [this.legL, 0.35],
      [this.legR, -0.35],
    ] as const) {
      const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), toon(ORANGE));
      shin.position.y = -0.35;
      const foot = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.12, 3), toon(ORANGE));
      foot.position.set(0.12, -0.72, 0);
      foot.rotation.z = -Math.PI / 2;
      foot.scale.set(1, 1, 1.6);
      leg.add(shin, foot);
      leg.position.set(0.1, -0.65, z);
      this.root.add(leg);
    }

    this.root.add(this.body);
  }

  update(dt: number) {
    this.t += dt;
    const t = this.t;
    const m = this.mode;

    // Defaults
    let neckTilt = 0;
    let headTilt = 0;
    let beakOpen = 0;
    let bodyBob = 0;
    let neckStretch = 1;

    if (this.walking) {
      const s = Math.sin(t * 9);
      this.legL.rotation.z = s * 0.5;
      this.legR.rotation.z = -s * 0.5;
      this.body.rotation.x = s * 0.06; // waddle
      bodyBob = Math.abs(s) * 0.06;
      headTilt = Math.sin(t * 9) * 0.08;
    } else {
      this.legL.rotation.z = this.legR.rotation.z = 0;
      this.body.rotation.x = 0;
    }

    switch (m) {
      case "nap":
        neckTilt = -0.9;
        headTilt = -0.4;
        bodyBob = Math.sin(t * 1.5) * 0.03;
        this.eyes.forEach((e) => (e.scale.y = 0.15));
        break;
      case "think":
        headTilt = 0.35 + Math.sin(t * 2) * 0.05;
        break;
      case "stare":
        neckStretch = 1.08;
        headTilt = -0.1;
        break;
      case "warn":
        neckStretch = 1.12;
        beakOpen = Math.max(0, Math.sin(t * 14)) * 0.35;
        break;
      case "honk":
        neckTilt = -0.25;
        neckStretch = 1.25;
        beakOpen = 0.6;
        this.wingL.rotation.x = Math.sin(t * 30) * 0.5;
        this.wingR.rotation.x = -Math.sin(t * 30) * 0.5;
        break;
      case "gulp":
        neckStretch = 1 + Math.abs(Math.sin(t * 6)) * 0.2;
        beakOpen = Math.max(0, Math.sin(t * 6)) * 0.5;
        break;
      default:
        headTilt += Math.sin(t * 1.3) * 0.06; // idle look-around
    }
    if (m !== "nap") this.eyes.forEach((e) => (e.scale.y = Math.sin(t * 0.7) > 0.985 ? 0.15 : 1)); // blink
    if (m !== "honk") this.wingL.rotation.x = this.wingR.rotation.x = 0;

    this.neck.rotation.z = neckTilt;
    this.neck.scale.y = neckStretch;
    this.head.rotation.z = headTilt;
    this.lowerBeak.rotation.z = -Math.PI / 2 - beakOpen;
    this.body.position.y = bodyBob;
  }
}
