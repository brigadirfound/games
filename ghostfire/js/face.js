// Пиксель-арт на персонаже: маска/лицо на голове, одежда на торсе.
// Формат в скине: skin.art = { face: {size, pixels}, torso: {size, pixels} },
// pixels — массив size*size из "#hex" или null (null = базовый цвет части тела).
// Текстура собирается кодом через CanvasTexture — внешних файлов нет.
import * as THREE from 'three';

export const ART_SIZE = 16;
export const MAX_ART_SIZE = 32;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;
export const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Возвращает безопасную копию арта с ограниченным размером и цветами. */
export function sanitizeArt(art, fallbackSize = ART_SIZE) {
  const requested = Number(art?.size);
  const size = Number.isInteger(requested) && requested >= 1 && requested <= MAX_ART_SIZE
    ? requested
    : fallbackSize;
  const source = Array.isArray(art?.pixels) ? art.pixels : [];
  const pixels = new Array(size * size).fill(null);
  const count = Math.min(source.length, pixels.length);
  for (let i = 0; i < count; i++) {
    const color = source[i];
    pixels[i] = typeof color === 'string' && COLOR_RE.test(color) ? color.toLowerCase() : null;
  }
  return { size, pixels };
}

/** Собирает текстуру из пиксель-арта поверх базового цвета. null, если арта нет. */
export function artToTexture(art, baseColor) {
  if (!art || !Array.isArray(art.pixels)) return null;
  const safe = sanitizeArt(art);
  if (!safe.pixels.some(Boolean)) return null;
  const size = safe.size;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, size, size);
  safe.pixels.forEach((p, i) => {
    if (!p) return;
    ctx.fillStyle = p;
    ctx.fillRect(i % size, Math.floor(i / size), 1, 1);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;   // жёсткие пиксели — стиль игры
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/*
  Порядок материалов куба в THREE: +X, -X, +Y, -Y, +Z, -Z.

  Перед бойца смотрит в -Z, то есть индекс 5. Остальные пять граней раньше были
  просто заливкой, и боец с любой стороны, кроме лица, оставался гладким
  кубом — ровно то, что читалось как «плоско».
*/
export const FACE_INDEX = Object.freeze({ right: 0, left: 1, top: 2, bottom: 3, back: 4, front: 5 });

/**
 * Поворот рисунка на четверть оборота.
 *
 * Нужен кисти от первого лица: рукав нарисован горизонтальными полосами под
 * ВЕРТИКАЛЬНУЮ руку бойца, а предплечье во вьюмодели вытянуто вдоль взгляда.
 * Без поворота манжета и налокотник легли бы полосами вдоль руки, а не поперёк.
 */
export function rotateArt(art) {
  const { size, pixels } = sanitizeArt(art);
  const out = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[x * size + (size - 1 - y)] = pixels[y * size + x];
  }
  return { size, pixels: out };
}

/** Зеркальная копия рисунка: ухо на левой грани должно смотреть наружу. */
function отразить(art) {
  const safe = sanitizeArt(art);
  const { size, pixels } = safe;
  const out = new Array(size * size).fill(null);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) out[y * size + (size - 1 - x)] = pixels[y * size + x];
  }
  return { size, pixels: out };
}

/**
 * Материалы для куба с артом на гранях.
 *
 * art — либо один рисунок (тогда он ложится на перед, как было), либо набор
 * по граням: { front, back, left, right, top, bottom }. Ключ side задаёт обе
 * боковые сразу, причём левая зеркалится.
 *
 * makeMat(hex) — фабрика базового материала (у призрака она даёт прозрачность/тинт).
 */
export function boxMaterials(makeMat, baseColor, art) {
  const набор = art && (art.front || art.back || art.side || art.left ||
                        art.right || art.top || art.bottom)
    ? art
    : { front: art };

  const материал = (кусок, зеркалить = false) => {
    if (!кусок) return null;
    const tex = artToTexture(зеркалить ? отразить(кусок) : кусок, baseColor);
    if (!tex) return null;
    const m = makeMat('#ffffff'); // белая база, чтобы цвет не перекрашивал текстуру
    m.map = tex;
    return m;
  };

  const грани = [
    материал(набор.right ?? набор.side),
    материал(набор.left ?? набор.side, Boolean(набор.side) && !набор.left),
    материал(набор.top),
    материал(набор.bottom),
    материал(набор.back),
    материал(набор.front),
  ];
  if (грани.every((m) => !m)) return makeMat(baseColor);
  const заливка = makeMat(baseColor);
  return грани.map((m) => m ?? заливка);
}

/** Индексы граней, на которых у детали есть рисунок: их UV нельзя растягивать. */
export function artFaceIndices(art) {
  if (!art) return [];
  if (!(art.front || art.back || art.side || art.left || art.right || art.top || art.bottom)) {
    return [FACE_INDEX.front];
  }
  const out = [];
  if (art.right || art.side) out.push(FACE_INDEX.right);
  if (art.left || art.side) out.push(FACE_INDEX.left);
  if (art.top) out.push(FACE_INDEX.top);
  if (art.bottom) out.push(FACE_INDEX.bottom);
  if (art.back) out.push(FACE_INDEX.back);
  if (art.front) out.push(FACE_INDEX.front);
  return out;
}

/** Уменьшает произвольную картинку до пиксель-арта size×size. */
export function imageToArt(img, size = 16) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_ART_SIZE) {
    throw new RangeError(`Pixel-art size must be between 1 and ${MAX_ART_SIZE}`);
  }
  const sourceWidth = Number(img?.naturalWidth ?? img?.videoWidth ?? img?.width);
  const sourceHeight = Number(img?.naturalHeight ?? img?.videoHeight ?? img?.height);
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) ||
      sourceWidth < 1 || sourceHeight < 1 ||
      sourceWidth > MAX_IMAGE_DIMENSION || sourceHeight > MAX_IMAGE_DIMENSION) {
    throw new RangeError(`Image dimensions must be between 1 and ${MAX_IMAGE_DIMENSION}px`);
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size).data;
  const pixels = [];
  for (let i = 0; i < size * size; i++) {
    const a = data[i * 4 + 3];
    if (a < 96) { pixels.push(null); continue; }
    const hex = '#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join('');
    pixels.push(hex);
  }
  return { size, pixels };
}

// ---------- готовые маски ----------
// Рисуются кодом на прозрачном холсте 16×16 и снимаются в массив пикселей.

function draw(fn) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const R = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  fn(R);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  const pixels = [];
  for (let i = 0; i < 256; i++) {
    if (data[i * 4 + 3] < 96) { pixels.push(null); continue; }
    pixels.push('#' + [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]
      .map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  return { size: 16, pixels };
}

// Ключи — идентификаторы словаря, а не подписи: при выборе пресета копируется
// только рисунок, имя нигде не сохраняется, поэтому переименование безопасно.
export const MASK_PRESETS = {
  maskSkull: draw(R => {
    R(2, 1, 12, 11, '#e8e8e0');
    R(4, 12, 8, 3, '#e8e8e0');
    R(3, 4, 4, 4, '#111'); R(9, 4, 4, 4, '#111');   // глазницы
    R(7, 8, 2, 3, '#111');                            // нос
    R(4, 12, 1, 3, '#999'); R(6, 12, 1, 3, '#999'); R(8, 12, 1, 3, '#999'); R(10, 12, 1, 3, '#999'); // зубы
  }),
  maskRobot: draw(R => {
    R(1, 2, 14, 12, '#8a95a5');
    R(2, 5, 12, 3, '#ff2222');                        // визор
    R(4, 10, 8, 2, '#333');                           // решётка
    R(5, 10, 1, 2, '#777'); R(7, 10, 1, 2, '#777'); R(9, 10, 1, 2, '#777');
    R(0, 6, 1, 4, '#556'); R(15, 6, 1, 4, '#556');    // уши
  }),
  maskNinja: draw(R => {
    R(0, 0, 16, 16, '#1a1d24');
    R(2, 5, 12, 3, '#f0d0b0');                        // прорезь
    R(3, 6, 2, 1, '#111'); R(11, 6, 2, 1, '#111');    // глаза
    R(0, 2, 16, 1, '#c02030');                        // повязка
  }),
  maskDemon: draw(R => {
    R(1, 3, 14, 12, '#a01818');
    R(0, 0, 3, 4, '#e8c84a'); R(13, 0, 3, 4, '#e8c84a'); // рога
    R(3, 6, 3, 2, '#ffe040'); R(10, 6, 3, 2, '#ffe040'); // глаза
    R(5, 11, 6, 2, '#111');
    R(5, 10, 1, 1, '#fff'); R(10, 10, 1, 1, '#fff');  // клыки
  }),
  maskSmile: draw(R => {
    R(1, 1, 14, 14, '#ffd935');
    R(4, 5, 2, 3, '#111'); R(10, 5, 2, 3, '#111');
    R(3, 10, 1, 1, '#111'); R(12, 10, 1, 1, '#111');
    R(4, 11, 8, 1, '#111');
  }),
  maskClown: draw(R => {
    R(2, 2, 12, 12, '#f0f0f0');
    R(0, 0, 4, 4, '#30a030'); R(12, 0, 4, 4, '#30a030'); R(6, 0, 4, 3, '#30a030'); // волосы
    R(4, 6, 2, 2, '#2040c0'); R(10, 6, 2, 2, '#2040c0');
    R(7, 8, 2, 2, '#e02020');                          // нос
    R(4, 11, 8, 2, '#e02020');                         // рот
  }),
};
