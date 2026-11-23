// Мобильное управление: стик слева (движение) и крупные кнопки способностей
// справа. Два режима наведения, переключаются в настройках:
//   drag — зажать кнопку и потянуть: на арене рисуется линия броска;
//   tap  — нажать кнопку, затем коснуться точки на арене.
// Короткий тап по кнопке в режиме drag = автонаведение на соперника.
import { T } from './tuning.js';

export const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

const STICK_MAX = 58;      // радиус отклонения стика, px
const DRAG_DEAD = 14;      // ниже этого — считаем коротким тапом (автонаведение)
const DRAG_FULL = 96;      // протяжка, соответствующая максимальной дальности

export class MobileControls {
  constructor({ input, settings, getFighters, setAimVisible }) {
    this.input = input;
    this.settings = settings;           // { aimMode: 'drag' | 'tap' }
    this.getFighters = getFighters;     // () => [я, соперник] из симуляции
    this.setAimVisible = setAimVisible;
    this.enabled = false;

    this._stickId = null;
    this._stickCenter = { x: 0, y: 0 };
    this._aimId = null;
    this._armed = null;                 // способность, ожидающая точку (режим tap)
    this._dragAbility = null;

    if (IS_TOUCH) {
      document.body.classList.add('is-touch');
      this._blockBrowserGestures();
    }
    this._bindStick();
    this._bindAbilities();
    this._bindArenaTap();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this._cancelAim(); this._stickId = null;
      this.input.setMove(0, 0);
      const base = document.getElementById('stick-base');
      if (base) base.style.display = 'none';
    }
  }

  /** Пинч-зум и двойной тап ломают управление двумя пальцами — глушим. */
  _blockBrowserGestures() {
    document.addEventListener('touchmove', (e) => {
      if (e.touches.length > 1) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      if (now - lastTap < 300) e.preventDefault();
      lastTap = now;
    }, { passive: false });
  }

  /* ------------------------------------------------------------------ стик */

  _bindStick() {
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');
    if (!zone) return;

    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this._stickId !== null) return;
      this._stickId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      this._stickCenter = { x: e.clientX, y: e.clientY };
      base.style.display = 'block';
      base.style.left = `${e.clientX - 66}px`;
      base.style.top = `${e.clientY - 66}px`;
      knob.style.left = '37px';
      knob.style.top = '37px';
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      const dx = e.clientX - this._stickCenter.x;
      const dy = e.clientY - this._stickCenter.y;
      const len = Math.hypot(dx, dy);
      const k = len > STICK_MAX ? STICK_MAX / len : 1;
      knob.style.left = `${37 + dx * k}px`;
      knob.style.top = `${37 + dy * k}px`;
      // экранный «верх» — это -Z мира, камера не вращается
      this.input.setMove(
        Math.max(-1, Math.min(1, dx / STICK_MAX)),
        Math.max(-1, Math.min(1, dy / STICK_MAX)),
      );
    });

    const end = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      base.style.display = 'none';
      this.input.setMove(0, 0);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------ кнопки способностей */

  _bindAbilities() {
    for (const ability of ['hook', 'dash', 'trap']) {
      const node = document.getElementById(`ability-${ability}`);
      if (!node) continue;

      node.addEventListener('pointerdown', (e) => {
        if (!this.enabled || e.pointerType !== 'touch') return;
        e.preventDefault();
        if (this.settings.aimMode === 'tap') {
          // режим tap: кнопка только «взводит» способность
          this._armed = this._armed === ability ? null : ability;
          this._paintArmed();
          return;
        }
        this._dragAbility = ability;
        this._aimId = e.pointerId;
        this._dragStart = { x: e.clientX, y: e.clientY };
        node.setPointerCapture(e.pointerId);
        node.classList.add('armed');
        this._aimFromDrag(0, 0);
        this.setAimVisible(true);
      });

      node.addEventListener('pointermove', (e) => {
        if (e.pointerId !== this._aimId) return;
        this._aimFromDrag(e.clientX - this._dragStart.x, e.clientY - this._dragStart.y);
      });

      const release = (e) => {
        if (e.pointerId !== this._aimId) return;
        const dx = e.clientX - this._dragStart.x;
        const dy = e.clientY - this._dragStart.y;
        if (Math.hypot(dx, dy) < DRAG_DEAD) this._aimAtRival();
        else this._aimFromDrag(dx, dy);
        this.input.cast(this._dragAbility);
        this._cancelAim();
      };
      node.addEventListener('pointerup', release);
      node.addEventListener('pointercancel', () => this._cancelAim());
    }
  }

  /** Тап по арене в режиме tap: точка = цель взведённой способности. */
  _bindArenaTap() {
    const canvas = document.getElementById('game-canvas');
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.pointerType !== 'touch') return;
      const p = this.input.screenToGround(e.clientX, e.clientY);
      if (!p) return;
      this.input.aimAt(p.x, p.z);
      if (this.settings.aimMode === 'tap' && this._armed) {
        this.input.cast(this._armed);
        this._armed = null;
        this._paintArmed();
      }
    });
  }

  _paintArmed() {
    for (const ability of ['hook', 'dash', 'trap']) {
      document.getElementById(`ability-${ability}`)?.classList.toggle('armed', this._armed === ability);
    }
    this.setAimVisible(Boolean(this._armed));
  }

  /** Протяжка пальцем → точка на арене: направление то же, длина масштабируется. */
  _aimFromDrag(dx, dy) {
    const me = this.getFighters()[0];
    if (!me) return;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) { this.input.aimAt(me.x, me.z - 1); return; }
    const range = this._dragAbility === 'hook' ? T.hook.range
      : this._dragAbility === 'dash' ? T.dash.dist : T.trap.castRange;
    const dist = Math.min(range, (len / DRAG_FULL) * range);
    this.input.aimAt(me.x + (dx / len) * dist, me.z + (dy / len) * dist);
  }

  /** Короткий тап — целимся в соперника: на мелком экране это честнее пальца. */
  _aimAtRival() {
    const [me, foe] = this.getFighters();
    if (!me) return;
    if (foe && foe.hp > 0) this.input.aimAt(foe.x, foe.z);
    else this.input.aimAt(me.x, me.z - 5);
  }

  _cancelAim() {
    this._aimId = null;
    this._dragAbility = null;
    this._armed = null;
    this.setAimVisible(false);
    for (const ability of ['hook', 'dash', 'trap']) {
      document.getElementById(`ability-${ability}`)?.classList.remove('armed');
    }
  }
}
