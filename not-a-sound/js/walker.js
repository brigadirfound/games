// Ходьба от первого лица.
//
// Сознательно НЕ копия FPS-контроллера из ghostfire: там мгновенная аркадная
// скорость и распрыжка, потому что это шутер. Здесь скорость — главный игровой
// параметр, потому что от неё зависит шум, и прыжка нет вовсе: он ломал бы и
// темп, и звуковую механику.
//
// Три режима вместо одного:
//   красться  — почти бесшумно, очень медленно;
//   идти      — умеренный шум;
//   спешить   — быстро и громко.
//
// Ковёр глушит любой из них. Стоя на месте игрок бесшумен полностью — это
// единственный способ перестать существовать для соседа.

import * as THREE from 'three';
import { moveAABB } from './map.js?v=resident-devices-v32';

export const WALK = {
  sneak: 1.5,      // м/с
  walk: 3.0,
  hurry: 5.2,
  gravity: 22,
  half: 0.32,
  height: 1.7,
  eye: 1.58,
};

// Шум по режимам. Порог слышимости соседа задаётся в neighbor.js.
const NOISE = { still: 0, sneak: 0.18, walk: 0.55, hurry: 1.0 };
/**
 * Ковёр глушит шаг, но не отменяет его.
 *
 * Было 0.28, и это делало ковёр абсолютным укрытием: даже бег давал 0.28 при
 * пороге слышимости соседа 0.40, то есть на ковре можно было носиться в полной
 * тишине. В забеге это выглядело так — игрок стоит на ковре, сосед подходит на
 * три метра, теряет его и уходит, хотя игрок всё это время бежал.
 *
 * На 0.55 получается правило, которое можно объяснить одной строкой:
 *   ковёр прячет шаг и крадущегося, но бегущего не прячет.
 * Красться  0.18 × 0.55 = 0.10 — тихо (и без ковра тихо)
 * Идти      0.55 × 0.55 = 0.30 — тихо (без ковра слышно)
 * Спешить   1.00 × 0.55 = 0.55 — слышно
 */
const RUG_MUFFLE = 0.55;

/**
 * Дыхание: запас спешки.
 *
 * Без него бег был выигрышной стратегией без изъяна — самый громкий режим он же
 * самый безопасный, потому что от соседа всегда можно просто убежать. Теперь
 * спешка это четыре секунды на разрыв дистанции, а не способ передвижения.
 * Порог возврата выше нуля намеренно: иначе на пустом запасе режим мигал бы
 * туда-сюда каждый кадр.
 */
const BREATH = { max: 4.0, drain: 1.0, regenStill: 0.75, regenMove: 0.32, resume: 1.2 };

export class Walker {
  /** @param {*} opts { camera, map, rugs, onStep(noise) } */
  constructor(opts) {
    this.camera = opts.camera;
    this.map = opts.map;
    this.onStep = opts.onStep || (() => {});

    // Ковры держим множеством ключей: проверка «стою ли на ковре» идёт каждый
    // кадр, перебор массива по сотне плиток тут неуместен.
    this.rugTiles = new Set((opts.rugs || []).map(r => r.x + ',' + r.z));

    this.pos = new THREE.Vector3(2, 1, 2);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;

    this.noise = 0;
    this.mode = 'still';
    this.breath = BREATH.max;
    this._winded = false;
    this._stepPhase = 0;
  }

  /** Запас дыхания в долях от полного — для полосы в интерфейсе. */
  get breath01() { return this.breath / BREATH.max; }

  spawnAt(spawn) {
    this.pos.copy(spawn.pos);
    this.yaw = spawn.yaw || 0;
    this.vel.set(0, 0, 0);
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.35, 1.35);
  }

  onRug() {
    return this.rugTiles.has(Math.floor(this.pos.x) + ',' + Math.floor(this.pos.z));
  }

  /**
   * @param {number} dt секунды
   * @param {*} input { x, y, sneak, hurry } — x/y в диапазоне −1…1
   */
  update(dt, input) {
    const ix = input.x || 0, iy = input.y || 0;
    const len = Math.hypot(ix, iy);

    // Сбилось дыхание — спешить нельзя, пока не отдышится до порога возврата.
    if (this._winded && this.breath >= BREATH.resume) this._winded = false;
    const canHurry = !!input.hurry && !this._winded && this.breath > 0 && len >= 0.05;

    let speed = WALK.walk;
    this.mode = 'walk';
    if (input.sneak) { speed = WALK.sneak; this.mode = 'sneak'; }
    else if (canHurry) { speed = WALK.hurry; this.mode = 'hurry'; }
    if (len < 0.05) this.mode = 'still';

    if (this.mode === 'hurry') {
      this.breath = Math.max(0, this.breath - BREATH.drain * dt);
      if (this.breath === 0) this._winded = true;
    } else {
      const regen = this.mode === 'still' ? BREATH.regenStill : BREATH.regenMove;
      this.breath = Math.min(BREATH.max, this.breath + regen * dt);
    }

    // Направление от взгляда: вперёд там, куда смотрит камера.
    //
    // Знаки перекрёстных членов были противоположными, то есть вектор ввода
    // поворачивался на −yaw вместо +yaw. При взгляде вдоль ±Z это незаметно, а
    // после поворота на 90° W вёл назад, а D влево. Выглядело как «управление
    // ведёт не туда и ходить невозможно», и найти это на глаз нельзя — только
    // подстановкой, потому что в половине направлений оно работало правильно.
    //
    // Камера при рыскании yaw смотрит в (−sin, 0, −cos), вправо от неё
    // (cos, 0, −sin). Мировое направление = вправо·ix + вперёд·(−iy), потому
    // что W приходит как iy = −1. Раскрыв, получаем ровно то, что ниже.
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const nx = len > 1 ? ix / len : ix;
    const ny = len > 1 ? iy / len : iy;
    const wx = nx * cos + ny * sin;
    const wz = -nx * sin + ny * cos;

    this.vel.x = wx * speed;
    this.vel.z = wz * speed;
    this.vel.y -= WALK.gravity * dt;

    const res = moveAABB(this.map, this.pos, this.vel, dt, WALK.half, WALK.height);
    this.onGround = res.onGround;

    // Шум: режим × заглушение ковром. Стоя на месте — ноль, без исключений.
    const base = NOISE[this.mode] ?? 0;
    this.noise = this.mode === 'still' ? 0 : base * (this.onRug() ? RUG_MUFFLE : 1);

    // Шаги отмеряем по пройденному пути, а не по времени: иначе на медленном
    // ходу шаги частят, и звук расходится с картинкой.
    if (this.mode !== 'still') {
      this._stepPhase += speed * dt;
      const stride = this.mode === 'sneak' ? 1.4 : 1.0;
      if (this._stepPhase >= stride) {
        this._stepPhase = 0;
        this.onStep(this.noise);
      }
    } else {
      this._stepPhase = 0;
    }

    this.camera.position.set(this.pos.x, this.pos.y + WALK.eye, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
