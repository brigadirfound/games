// Локальный источник намерений: клавиатура + point-and-click мышью.
// Мобильное управление (mobile.js) дописывает сюда же — через aimAt()/cast(),
// поэтому симуляция не знает, откуда пришёл инпут (и в онлайне не заметит подмены).
import * as THREE from 'three';
import { emptyIntent } from './sim.js';

const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export class LocalInput {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.enabled = false;
    this.keys = new Set();
    this.move = { x: 0, z: 0 };   // мобильный стик; клавиатура имеет приоритет
    this.aim = { x: 0, z: 0 };
    this.queue = [];
    this.intentObj = emptyIntent();
    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._hit = new THREE.Vector3();
    this._bind();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) { this.keys.clear(); this.queue.length = 0; this.move.x = 0; this.move.z = 0; }
  }

  /** Движение со стика (mobile.js). Значения в диапазоне -1..1. */
  setMove(x, z) { this.move.x = x; this.move.z = z; }

  /** Внешнее наведение (мобильный drag-aim/тап по арене). */
  aimAt(x, z) { this.aim.x = x; this.aim.z = z; }

  cast(ability) { if (this.enabled) this.queue.push(ability); }

  /** Экранные координаты → точка на льду (y=0). Возвращает false, если мимо. */
  screenToGround(clientX, clientY, out = this._hit) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    this._ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    this._ray.setFromCamera(this._ndc, this.camera);
    return this._ray.ray.intersectPlane(GROUND, out) ? out : null;
  }

  _bind() {
    addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ' || e.code === 'KeyE') this.cast('trap');
      if (e.code === 'Space') this.cast('dash');
      if (['Space', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;             // тач обслуживает mobile.js
      const p = this.screenToGround(e.clientX, e.clientY);
      if (p) this.aimAt(p.x, p.z);
    });

    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType === 'touch') return;
      const p = this.screenToGround(e.clientX, e.clientY);
      if (p) this.aimAt(p.x, p.z);
      if (e.button === 0) this.cast('hook');
      else if (e.button === 2) this.cast('dash');
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Намерение на тик. Направления экранные: W — «вверх» по экрану (-Z). */
  intent() {
    const it = this.intentObj;
    it.cast.length = 0;
    if (this.queue.length) { it.cast.push(...this.queue); this.queue.length = 0; }
    it.aim.x = this.aim.x; it.aim.z = this.aim.z;

    let x = 0, z = 0;
    if (!this.enabled) { it.move.x = 0; it.move.z = 0; return it; }
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x === 0 && z === 0) { x = this.move.x; z = this.move.z; }
    it.move.x = x; it.move.z = z;
    return it;
  }
}
