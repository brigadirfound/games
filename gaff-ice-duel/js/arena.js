// Арена: описание площадки (данные) и коллизии (чистые функции).
// СПЕЦИАЛЬНО без импорта THREE: этот файл вместе с sim.js должен считаться
// в Node (тесты, а в онлайне — на хосте), где рендера нет вообще.
// Меш площадки живёт в arenamesh.js.
import { T } from './tuning.js';

/**
 * Раскладка площадки. Строго симметрична поворотом на 180° — иначе один из
 * бойцов получает преимущество ещё до первого броска. Ни одна полынья не лежит
 * вплотную к спавну: сползти в неё на первых секундах нельзя.
 * Центральная полынья — главная угроза и главная награда: затащить туда
 * противника выгоднее, чем просто ударить.
 */
export const ARENA = {
  radius: T.arena.radius,
  holes: [
    { x: 0, z: 0, r: 2.2 },
    { x: 7.0, z: 4.5, r: 2.0 },
    { x: -7.0, z: -4.5, r: 2.0 },
  ],
  // Низкие укрытия-торосы: AABB по XZ + высота (крюк в них застревает)
  toros: [
    { x: -6.5, z: 6.0, w: 4.0, d: 2.4, h: 2.2 },
    { x: 6.5, z: -6.0, w: 4.0, d: 2.4, h: 2.2 },
  ],
  spawns: [
    { x: 0, z: -13 },
    { x: 0, z: 13 },
  ],
};

/* ---------------------------------------------------------------- коллизии */

export function insideArena(x, z, margin = 0) {
  return Math.hypot(x, z) <= ARENA.radius - margin;
}

/** Возвращает полынью под точкой либо null. Небольшой внутренний отступ,
 *  чтобы боец «цеплялся» за край, а не проваливался кончиком пикселя. */
export function holeAt(x, z, margin = 0.3) {
  for (const h of ARENA.holes) {
    if (Math.hypot(x - h.x, z - h.z) < h.r - margin) return h;
  }
  return null;
}

function torosOverlap(t, x, z, pad) {
  return Math.abs(x - t.x) < t.w / 2 + pad && Math.abs(z - t.z) < t.d / 2 + pad;
}

/** Тело бойца внутри тороса? (используется и как «крюк застрял») */
export function torosAt(x, z, pad = 0) {
  for (const t of ARENA.toros) if (torosOverlap(t, x, z, pad)) return t;
  return null;
}

/**
 * Выталкивает точку из торосов и из-за края арены. Мутирует p ({x,z}).
 * Возвращает true, если позиция правилась — вызывающий гасит скорость.
 */
export function resolveCollision(p, radius = T.move.radius) {
  let touched = false;

  const t = torosAt(p.x, p.z, radius);
  if (t) {
    // выталкиваем по оси наименьшего проникновения — без «залипания» в углах
    const dx = p.x - t.x, dz = p.z - t.z;
    const pushX = t.w / 2 + radius - Math.abs(dx);
    const pushZ = t.d / 2 + radius - Math.abs(dz);
    if (pushX < pushZ) p.x += Math.sign(dx || 1) * pushX;
    else p.z += Math.sign(dz || 1) * pushZ;
    touched = true;
  }

  const len = Math.hypot(p.x, p.z);
  const max = ARENA.radius - radius;
  if (len > max) {
    p.x = (p.x / len) * max;
    p.z = (p.z / len) * max;
    touched = true;
  }
  return touched;
}

/**
 * Перемещение точки на (dx,dz) мелкими подшагами с разрешением коллизии на каждом.
 * Нужно для быстрых движений (рывок, подтяг): одиночный большой шаг заводит бойца
 * глубоко внутрь тороса, и выталкивание по оси наименьшего проникновения даёт
 * заметный «щелчок» вбок. Мелкий подшаг => мелкое проникновение => боец скользит
 * вдоль препятствия. На коротких шагах (обычный ход) поведение не меняется.
 * Мутирует p. Возвращает true, если хоть раз касались препятствия.
 */
export function sweepCollision(p, dx, dz, radius = T.move.radius) {
  const startX = p.x, startZ = p.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
  let touched = false;
  for (let i = 0; i < steps; i++) {
    p.x += dx / steps; p.z += dz / steps;
    if (resolveCollision(p, radius)) touched = true;
  }
  // скольжение вдоль препятствия не должно разгонять: итоговый сдвиг за тик
  // не больше задуманного (иначе угол тороса «выстреливает» бойцом)
  const gone = Math.hypot(p.x - startX, p.z - startZ);
  if (touched && gone > dist && gone > 1e-6) {
    const k = dist / gone;
    p.x = startX + (p.x - startX) * k;
    p.z = startZ + (p.z - startZ) * k;
    resolveCollision(p, radius);
  }
  return touched;
}

/**
 * Трассировка крюка по отрезку: что первым мешает пролёту.
 * Возвращает { kind: 'toros'|'edge', x, z } или null, если путь свободен.
 * Шаг мелкий (0.25 м) — крюк не проскакивает сквозь тонкий торос.
 */
export function traceHook(fromX, fromZ, dirX, dirZ, maxDist) {
  const stepLen = 0.25;
  const steps = Math.ceil(maxDist / stepLen);
  for (let i = 1; i <= steps; i++) {
    const d = Math.min(i * stepLen, maxDist);
    const x = fromX + dirX * d, z = fromZ + dirZ * d;
    if (torosAt(x, z, 0)) {
      // отступаем на пол-шага назад, чтобы якорь был на поверхности, а не внутри
      return { kind: 'toros', x: x - dirX * stepLen * 0.5, z: z - dirZ * stepLen * 0.5, dist: d };
    }
    if (!insideArena(x, z, 0.2)) {
      return { kind: 'edge', x: x - dirX * stepLen * 0.5, z: z - dirZ * stepLen * 0.5, dist: d };
    }
  }
  return null;
}
