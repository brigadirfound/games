import * as THREE from 'three';
import { clamp, lerp, angleLerp, angleDiff, raycastBoxes, rand } from './physics.js';

export const CAM_MODES = ['third', 'first', 'far', 'cinematic'];
export const CAM_LABELS = {
  third: 'ОТ ТРЕТЬЕГО ЛИЦА',
  first: 'ОТ ПЕРВОГО ЛИЦА',
  far: 'ДАЛЬНЯЯ',
  cinematic: 'КИНЕМАТОГРАФИЧЕСКАЯ',
};

// Handles both on-foot and in-vehicle framing, collision, aim zoom and recoil.
export class CameraRig {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.modeIndex = 0;
    this.yaw = 0;
    this.pitch = 0.16;
    this.pos = new THREE.Vector3(0, 6, 10);
    this.look = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.shake = 0;
    this.shakeDecay = 2.2;
    this.fov = 68;
    this.targetFov = 68;
    this.roll = 0;
    this.cineTimer = 0;
    this.cineAngle = 0;
    this._boxes = [];
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.aimPoint = new THREE.Vector3();
    this.sensitivity = 1;
    this.invertY = false;
    this.headBob = 0;
  }

  get mode() { return CAM_MODES[this.modeIndex]; }
  get isFirstPerson() { return this.mode === 'first'; }

  cycle() {
    this.modeIndex = (this.modeIndex + 1) % CAM_MODES.length;
    this.cineTimer = 0;
    return CAM_LABELS[this.mode];
  }

  addShake(a) { this.shake = Math.min(1.6, this.shake + a); }

  // The one direction everything agrees on: camera forward == crosshair == bullets.
  aimDir(out = new THREE.Vector3()) {
    const y = this.yaw + this.recoilYaw;
    const p = this.pitch + this.recoilPitch;
    const cp = Math.cos(p);
    return out.set(Math.sin(y) * cp, -Math.sin(p), Math.cos(y) * cp).normalize();
  }

  addRecoil(pitch, yaw = 0) {
    // Recoil must never stack past a small cone, otherwise sustained fire
    // walks the aim off the screen.
    this.recoilPitch = clamp(this.recoilPitch + pitch, -0.045, 0.045);
    this.recoilYaw = clamp(this.recoilYaw + yaw, -0.028, 0.028);
  }

  handleMouse(dx, dy) {
    const s = 0.0024 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += (this.invertY ? -dy : dy) * s * 0.86;
    const lo = this.isFirstPerson ? -0.95 : -0.35;
    const hi = this.isFirstPerson ? 1.15 : 1.12;
    this.pitch = clamp(this.pitch, lo, hi);
  }

  update(dt) {
    const g = this.game;
    const cam = this.camera;
    const inCar = !!g.player.inVehicle;
    const target = inCar ? g.player.inVehicle : g.player;
    const aiming = g.aimingDownSights && !inCar;
    const scoped = aiming && g.weaponDef.scope;

    // recoil settles back
    this.recoilPitch = lerp(this.recoilPitch, 0, Math.min(1, dt * 13));
    this.recoilYaw = lerp(this.recoilYaw, 0, Math.min(1, dt * 13));
    this.shake = Math.max(0, this.shake - dt * this.shakeDecay);

    if (this.mode === 'first') this.updateFirstPerson(dt, target, inCar, aiming, scoped);
    else if (this.mode === 'cinematic' && inCar) this.updateCinematic(dt, target);
    else this.updateThirdPerson(dt, target, inCar, aiming, scoped);

    // fov transitions
    const speedFov = inCar ? clamp(Math.abs(target.speed) * 0.13, 0, 5) : 0;
    let want = this.mode === 'far' ? 72 : 68;
    if (scoped) want = 26;
    else if (aiming) want = 56;
    else want += speedFov;
    this.targetFov = want;
    this.fov = lerp(this.fov, this.targetFov, Math.min(1, dt * 6));
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }

    // camera roll: lean into turns. Applied via rotateZ (local forward axis)
    // AFTER lookAt — assigning rotation.z directly destroys the lookAt basis
    // and flips the view upside down.
    const wantRoll = inCar ? clamp(-target.steer * clamp(Math.abs(target.speed) / 22, 0, 1) * 0.07, -0.08, 0.08) : 0;
    this.roll = lerp(this.roll, wantRoll, Math.min(1, dt * 4));
    if (Math.abs(this.roll) > 0.0005) cam.rotateZ(this.roll);
  }

  applyShake(v) {
    if (this.shake <= 0.001) return;
    const s = this.shake * 0.32;
    v.x += rand(-s, s); v.y += rand(-s, s); v.z += rand(-s, s);
  }

  // -------------------------------------------------- third person
  updateThirdPerson(dt, target, inCar, aiming, scoped) {
    const g = this.game;
    const cam = this.camera;
    const far = this.mode === 'far';

    // Auto-centre behind the car: the camera sits at focus - aimDir*dist, so
    // the yaw must MATCH the car heading (looking where the car drives).
    // Reversing gets the mirrored view.
    if (inCar && Math.abs(target.speed) > 2.5 && Math.abs(g.input.mouseDX) < 1) {
      const want = target.speed < -0.5 ? target.heading + Math.PI : target.heading;
      const rate = clamp(Math.abs(target.speed) / 26, 0.2, 1) * 2.4;
      this.yaw = angleLerp(this.yaw, want, Math.min(1, dt * rate));
      this.pitch = lerp(this.pitch, 0.16, Math.min(1, dt * 1.2));
    }

    // focus point sits at chest / roof height so a level shot travels level
    const focusY = (inCar ? 1.5 : 1.45) + (target.y || 0);
    const fx = target.x, fy = focusY, fz = target.z;

    let dist, shoulder;
    if (inCar) {
      const boost = target.type ? clamp(target.type.l * 0.28, 1.0, 2.4) : 1.2;
      dist = (far ? 10.5 : 6.6) + boost + clamp(Math.abs(target.speed) * 0.04, 0, 1.1);
      shoulder = 0;
    } else if (scoped) { dist = 0.9; shoulder = 0.26; }
    else if (aiming) { dist = 2.7; shoulder = 0.55; }
    else { dist = far ? 9.2 : 5.6; shoulder = 0.42; }

    const dir = this.aimDir(this._d || (this._d = new THREE.Vector3()));
    // right = forward × up  (forward = sin(yaw), 0, cos(yaw))
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);

    // camera sits exactly on the aim line, `dist` behind the focus point,
    // so the ray from the camera passes through the focus and stays truthful
    let dX = fx - dir.x * dist + rx * shoulder;
    let dY = fy - dir.y * dist;
    let dZ = fz - dir.z * dist + rz * shoulder;

    // keep the boom out of walls
    const boxes = g.city.nearbyColliders(fx, fz, dist + 7, this._boxes);
    const vx = dX - fx, vz = dZ - fz;
    const len = Math.hypot(vx, vz) || 1;
    const tall = boxes.filter((b) => b.height > dY - 0.6);
    const hit = raycastBoxes(fx, fz, vx / len, vz / len, len, tall);
    if (hit < len) {
      const sMax = Math.max(0.7, hit - 0.45);
      const k = sMax / len;
      dX = fx + vx * k;
      dZ = fz + vz * k;
      dY = fy - dir.y * dist * k;
    }
    // never dip below the street
    dY = Math.max(dY, 0.5);

    const lag = inCar ? (far ? 5 : 9) : (aiming ? 24 : 14);
    this.pos.x = lerp(this.pos.x, dX, Math.min(1, dt * lag));
    this.pos.y = lerp(this.pos.y, dY, Math.min(1, dt * lag));
    this.pos.z = lerp(this.pos.z, dZ, Math.min(1, dt * lag));

    const pv = this.pos.clone();
    this.applyShake(pv);
    cam.position.copy(pv);

    // Converge on a point far along the aim line measured from the FOCUS.
    // This cancels the shoulder-offset parallax: the crosshair, the camera
    // and the bullet all meet at the same place.
    const conv = 120;
    this.aimPoint.set(fx + dir.x * conv, fy + dir.y * conv, fz + dir.z * conv);
    cam.lookAt(this.aimPoint);
  }

  // -------------------------------------------------- first person
  updateFirstPerson(dt, target, inCar, aiming, scoped) {
    const g = this.game;
    const cam = this.camera;

    let ex, ey, ez;
    if (inCar) {
      // driver seat position
      const t = target.type;
      const fwd = t.bike ? 0.1 : -t.l * 0.06;
      const side = t.bike ? 0 : -t.w * 0.22;
      const sh = Math.sin(target.heading), ch = Math.cos(target.heading);
      ex = target.x + sh * fwd + ch * side;
      ez = target.z + ch * fwd - sh * side;
      ey = (target.y || 0) + (t.bike ? 1.32 : t.h + 0.72);
    } else {
      // head height with walk bob
      const spd = g.player.speed;
      this.headBob += dt * (spd > 4.6 ? 11 : 7) * clamp(spd / 3.2, 0, 1.5);
      const bob = clamp(spd / 6, 0, 1);
      const bobY = Math.sin(this.headBob * 2) * 0.045 * bob * (aiming ? 0.3 : 1);
      const bobX = Math.cos(this.headBob) * 0.035 * bob * (aiming ? 0.2 : 1);
      const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
      ex = g.player.x + rx * bobX;
      ey = 1.62 + g.player.mesh.position.y + bobY - g.player.crouch * 0.35;
      ez = g.player.z + rz * bobX;
    }

    this.pos.set(ex, ey, ez);
    const pv = this.pos.clone();
    this.applyShake(pv);
    cam.position.copy(pv);
    const dir = this.aimDir(this._d || (this._d = new THREE.Vector3()));
    this.aimPoint.set(pv.x + dir.x * 120, pv.y + dir.y * 120, pv.z + dir.z * 120);
    cam.lookAt(this.aimPoint);
  }

  // -------------------------------------------------- cinematic (car only)
  updateCinematic(dt, car) {
    const cam = this.camera;
    this.cineTimer -= dt;
    if (this.cineTimer <= 0) {
      this.cineTimer = rand(3.5, 6.5);
      this.cineAngle = rand(0, Math.PI * 2);
      this.cineHigh = Math.random() < 0.35;
    }
    const r = this.cineHigh ? 16 : 11;
    const cx = car.x + Math.cos(this.cineAngle) * r;
    const cz = car.z + Math.sin(this.cineAngle) * r;
    const cy = this.cineHigh ? 11 : 2.0;

    this.pos.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 1.6));
    const p = this.pos.clone();
    this.applyShake(p);
    cam.position.copy(p);
    this.look.lerp(new THREE.Vector3(car.x, car.y + 1, car.z), Math.min(1, dt * 8));
    cam.lookAt(this.look);
  }

  // world-space aim ray for shooting, matching what the player sees
  getAimRay() {
    this.camera.updateMatrixWorld(true);
    return { origin: this.camera.getWorldPosition(new THREE.Vector3()),
      dir: this.camera.getWorldDirection(new THREE.Vector3()) };
  }
}
