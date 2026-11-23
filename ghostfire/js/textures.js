// Атлас текстур блоков: 4×4 тайла в одной картинке, один материал на всю карту.
//
// Путей два. Процедурный рисуется кодом при старте (16×16 на тайл) и служит
// мгновенным фолбэком. Испечённый — assets/tex/atlas.png, 256 px на тайл — та
// же раскладка, но с настоящей детализацией поверхности; он подменяет собой
// процедурный, как только догрузится. UV-координаты у обоих одни и те же,
// поэтому подмена не требует ничего пересобирать.
// Тайлы нейтральных тонов: цвет из палитры карты умножается сверху (тонировка),
// поэтому один тайл обслуживает любые расцветки. Один атлас = один draw call.
import * as THREE from 'three';

export const TILE = {
  plain: 0,     // чистый белый — фолбэк для блоков без текстуры (старые UGC-карты)
  stone: 1,
  brick: 2,
  planks: 3,
  grass: 4,     // верх травы (grass_dirt: верх grass, бока/низ dirt)
  dirt: 5,
  sand: 6,
  metal: 7,     // рифлёный металл
  crate: 8,     // ящик с окантовкой
  concrete: 9,  // бетон с трещинами
  neon: 10,     // неон-панель
  glass: 11,    // полупрозрачное стекло
};

const GRID = 4;       // 4×4 тайлов
const TS = 16;        // тайл 16 px
let atlasCanvas = null;
let atlasTexture = null;

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildAtlasCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = GRID * TS;
  const ctx = c.getContext('2d');
  const at = (i) => [(i % GRID) * TS, Math.floor(i / GRID) * TS];
  const px = (ox, oy) => (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(ox + x, oy + y, w, h); };

  const tile = (i, fn) => {
    const [ox, oy] = at(i);
    ctx.save();
    fn(px(ox, oy), rng(1000 + i));
    ctx.restore();
  };

  // plain — чистый белый
  tile(TILE.plain, (P) => P(0, 0, 16, 16, '#ffffff'));

  // stone — светло-серые пятна
  tile(TILE.stone, (P, r) => {
    P(0, 0, 16, 16, '#c2c6cc');
    for (let i = 0; i < 14; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 3 | 0), 1 + (r() * 2 | 0), '#a8adb5');
    for (let i = 0; i < 6; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 2 | 0), 1, '#d8dce2');
  });

  // brick — кирпичи со швами, смещение рядов
  tile(TILE.brick, (P) => {
    P(0, 0, 16, 16, '#9a948c'); // раствор
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let col = -1; col < 3; col++) P(off + col * 8 + 1, row * 4 + 1, 7, 3, '#cfc6ba');
    }
  });

  // planks — горизонтальные доски с волокнами
  tile(TILE.planks, (P, r) => {
    P(0, 0, 16, 16, '#d6c9b2');
    for (let row = 0; row < 4; row++) {
      P(0, row * 4, 16, 1, '#a89878');
      for (let i = 0; i < 3; i++) P((r() * 15) | 0, row * 4 + 1 + (r() * 3 | 0), 2 + (r() * 3 | 0), 1, '#c4b599');
    }
    P(4, 6, 1, 1, '#8a7a5c'); P(11, 13, 1, 1, '#8a7a5c'); // сучки
  });

  // grass — шумная светлая (тонируется зелёным)
  tile(TILE.grass, (P, r) => {
    P(0, 0, 16, 16, '#d2d8c8');
    for (let i = 0; i < 22; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1 + (r() * 2 | 0), '#b8c2a4');
    for (let i = 0; i < 10; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#e4ead8');
  });

  // dirt — земля с камешками
  tile(TILE.dirt, (P, r) => {
    P(0, 0, 16, 16, '#cbb89e');
    for (let i = 0; i < 16; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 2 | 0), 1, '#b09a7c');
    for (let i = 0; i < 5; i++) P((r() * 16) | 0, (r() * 16) | 0, 2, 1, '#e0d2ba');
  });

  // sand — мелкие точки
  tile(TILE.sand, (P, r) => {
    P(0, 0, 16, 16, '#eee4c8');
    for (let i = 0; i < 20; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#d8cba8');
    for (let i = 0; i < 8; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#f8f0dc');
  });

  // metal — рифлёные горизонтальные полосы + заклёпки
  tile(TILE.metal, (P) => {
    P(0, 0, 16, 16, '#c8ccd2');
    for (let row = 0; row < 4; row++) {
      P(0, row * 4, 16, 1, '#eef1f5');
      P(0, row * 4 + 3, 16, 1, '#9aa0a8');
    }
    P(1, 1, 1, 1, '#788088'); P(14, 1, 1, 1, '#788088');
    P(1, 14, 1, 1, '#788088'); P(14, 14, 1, 1, '#788088');
  });

  // crate — доски + тёмная окантовка + диагональ
  tile(TILE.crate, (P, r) => {
    P(0, 0, 16, 16, '#d6c9b2');
    for (let row = 1; row < 4; row++) P(2, row * 4, 12, 1, '#b3a284');
    P(0, 0, 16, 2, '#94825f'); P(0, 14, 16, 2, '#94825f');
    P(0, 0, 2, 16, '#94825f'); P(14, 0, 2, 16, '#94825f');
    for (let i = 0; i < 12; i++) P(2 + i, 2 + i, 1, 1, '#a89468'); // диагональ
    void r;
  });

  // concrete — бетон с трещинами и подтёками
  tile(TILE.concrete, (P, r) => {
    P(0, 0, 16, 16, '#c9c9c6');
    let cx = 3, cy = 0;
    for (let i = 0; i < 14 && cy < 16; i++) { P(cx, cy, 1, 1, '#8f8f8c'); cy++; cx += (r() * 3 | 0) - 1; }
    for (let i = 0; i < 6; i++) P((r() * 16) | 0, (r() * 16) | 0, 2, 1 + (r() * 2 | 0), '#b8b8b4');
    P(10, 12, 4, 3, '#bebebb');
  });

  // neon — тёмная рамка, светящаяся сетка (тонируется цветом палитры)
  tile(TILE.neon, (P) => {
    P(0, 0, 16, 16, '#3a3a42');
    P(1, 1, 14, 14, '#ffffff');
    P(3, 3, 10, 10, '#4a4a54');
    P(7, 3, 2, 10, '#ffffff'); P(3, 7, 10, 2, '#ffffff');
  });

  // glass — полупрозрачное с бликами (единственный тайл с альфой)
  tile(TILE.glass, (P) => {
    const [ox, oy] = at(TILE.glass);
    ctx.clearRect(ox, oy, 16, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.fillRect(ox, oy, 16, 16);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(ox, oy, 16, 1); ctx.fillRect(ox, oy + 15, 16, 1);
    ctx.fillRect(ox, oy, 1, 16); ctx.fillRect(ox + 15, oy, 1, 16);
    for (let i = 0; i < 6; i++) { ctx.fillRect(ox + 3 + i, oy + 9 - i, 1, 1); ctx.fillRect(ox + 7 + i, oy + 12 - i, 1, 1); }
    void P;
  });

  return c;
}

export function getAtlasCanvas() {
  atlasCanvas ??= buildAtlasCanvas();
  return atlasCanvas;
}

/*
  Испечённый атлас, если он есть.

  Держим отдельной картинкой, а не девятью: карта рисуется одним мешем с одним
  материалом, то есть одним вызовом отрисовки на всю арену. Девять материалов
  превратили бы его в девять, и на телефоне это заметно.

  Фильтрация меняется вместе с картинкой. У 16-пиксельного тайла Nearest был
  осознанным приёмом — крупный честный пиксель. На 256 тот же Nearest даёт
  рябь на удалении: одна экранная точка попадает в каждый второй-третий тексель,
  и поверхность начинает кипеть при движении. Поэтому линейная фильтрация с
  мип-уровнями.
*/
let bakedImage = null;
function upgradeAtlas() {
  const img = new Image();
  img.onload = () => {
    bakedImage = img;
    if (atlasTexture) applyBaked(atlasTexture, img);
    while (ждущиеАтлас.length) ждущиеАтлас.pop()();
  };
  // Не нашёлся — остаёмся на процедурном. Игра из-за текстур падать не должна.
  img.onerror = () => {};
  img.src = 'assets/tex/atlas.png';
}

/*
  Подписка на готовность атласа.

  Нужна редакторам: они строят свои сцены из тех же тайлов, но делают это
  один раз при открытии. Без подписки редактор скинов показывал старые
  шестнадцатипиксельные тайлы, пока игрок не перезагрузит страницу — и это
  ровно то, что было видно на витрине скинов.
*/
const ждущиеАтлас = [];
export function onAtlasReady(cb) {
  if (bakedImage) cb();
  else ждущиеАтлас.push(cb);
}

/*
  Настройки текстуры под испечённый атлас.

  Вынесены отдельно, потому что применяются из двух мест: при догрузке
  картинки и при создании текстуры, когда картинка УЖЕ загрузилась. Без
  второго случая была гонка: на быстром сервере atlas.png успевал прийти
  раньше, чем карта попросит текстуру, подмена уходила в пустоту, и игра
  оставалась на процедурных тайлах по шестнадцать пикселей.
*/
function applyBaked(tex, img) {
  tex.image = img;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
}

export function getAtlas() {
  if (!atlasTexture) {
    atlasTexture = new THREE.CanvasTexture(getAtlasCanvas());
    atlasTexture.magFilter = THREE.NearestFilter;
    atlasTexture.minFilter = THREE.NearestFilter;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
    if (bakedImage) applyBaked(atlasTexture, bakedImage);
  }
  return atlasTexture;
}

// Загрузку начинаем при разборе модуля: атлас нужен и странице игры, и обоим
// редакторам, а ждать первого обращения к карте — значит показать старое.
upgradeAtlas();

/** UV-прямоугольник тайла (с учётом flipY у CanvasTexture). */
/*
  Карта поверхности бойца.

  Скины задают только цвета — голова, торс, руки, ноги. Материал умножает
  цвет скина на эту карту, поэтому ткань и пластины проступают на любом
  скине, не трогая ни одной его настройки: ни один существующий скин
  переделывать не нужно.

  Одна текстура на всех бойцов и на руки от первого лица: это один объект в
  памяти видеокарты вместо десятка одинаковых.
*/
let fighterMap = null;
/*
  Своя поверхность у каждого скина.

  Общая серая карта делала всех бойцов одинаковыми: отличался только цвет
  заливки, и с двух шагов «Золото» от «Леса» отличить было нельзя. Теперь у
  скина своя фактура — гравировка, чешуя, обсидиан — и она ложится на все
  грани, включая бока головы и торса, где раньше не было ничего.

  Файла может не быть (пользовательский скин, старая сборка) — тогда молча
  возвращаем общую карту: облик обеднеет, но ничего не сломается.
*/
const поверхности = Object.create(null);
let белыйПиксель = null;

/*
  Заглушка — белый пиксель, а не пустота.

  Текстура грузится по сети, а материал строится сразу. Пустая карта
  отрисовывается ЧЁРНЫМ: в первой версии руки и ноги у всех скинов уходили в
  чёрный, пока файл не догрузится. Белый пиксель нейтрален для умножения —
  до загрузки боец просто без фактуры, но своего цвета.
*/
function заглушка() {
  if (!белыйПиксель) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1, 1);
    белыйПиксель = c;
  }
  return белыйПиксель;
}

export function getSkinSurface(id) {
  if (!id) return getFighterMap();
  if (!поверхности[id]) {
    const t = new THREE.CanvasTexture(заглушка());
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    const img = new Image();
    img.onload = () => { t.image = img; t.needsUpdate = true; t.userData.готова = true; };
    // Нет файла — остаёмся на белом: скин просто без фактуры, но живой.
    img.onerror = () => { t.userData.готова = true; };
    img.src = `assets/skins/${id}-surface.png`;
    t.userData.готова = false;
    поверхности[id] = t;
  }
  return поверхности[id];
}

/** Готовы ли все запрошенные фактуры — нужно генератору карточек. */
export function surfacesReady() {
  return Object.values(поверхности).every((t) => t.userData.готова);
}

export function getFighterMap() {
  if (!fighterMap) {
    fighterMap = new THREE.TextureLoader().load('assets/tex/fighter-map.png');
    fighterMap.colorSpace = THREE.SRGBColorSpace;
    fighterMap.wrapS = fighterMap.wrapT = THREE.RepeatWrapping;
    fighterMap.anisotropy = 4;
  }
  return fighterMap;
}

/*
  Плотность фактуры не должна зависеть от размера детали.

  У коробки UV идут от нуля до единицы на каждой грани, то есть весь тайл
  растягивается что на торс, что на предплечье. Пластины на маленькой руке
  выходили размером с ладонь и читались как каменная кладка, а не как ткань.

  Поэтому UV умножаются на размер детали: одинаковый кусок ткани приходится
  на одинаковый кусок мира, и все части бойца выглядят одним костюмом.
*/
const ПЛОТНОСТЬ = 5;

/*
  Грань с рисунком не масштабируем.

  У коробки 24 вершины по четыре на грань, в порядке +x, -x, +y, -y, +z, -z.
  Маска и нагрудный знак ложатся на последнюю, -z (так их кладёт boxMaterials).
  Растянув UV этой грани вместе с остальными, мы размножали рисунок по ней
  десяток раз — лицо превращалось в узкую мятую полоску. Ей нужны честные
  координаты от нуля до единицы, всем прочим — плотность по размеру детали.
*/
/**
 * Растягивает UV куба под плотность фактуры, ПРОПУСКАЯ грани с рисунком.
 *
 * keepArt — либо true (пропустить переднюю грань, как было), либо список
 * индексов граней в порядке THREE: +X, -X, +Y, -Y, +Z, -Z. Пропускать надо
 * именно поштучно: рисунок обязан лежать в квадрате 0…1, иначе маска
 * размножается плиткой, а фактура на соседних гранях наоборот съёживается.
 */
export function scaleBoxUV(geo, size, keepArt = false) {
  const uv = geo.attributes.uv;
  const k = Math.max(0.35, size * ПЛОТНОСТЬ);
  const пропустить = keepArt === true ? [5] : (Array.isArray(keepArt) ? keepArt : []);
  const нельзя = new Set(пропустить);
  // На грань приходится по четыре вершины, идут они гранями подряд.
  for (let i = 0; i < uv.count; i++) {
    if (нельзя.has(Math.floor(i / 4))) continue;
    uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  }
  uv.needsUpdate = true;
  return geo;
}

export function tileUV(index) {
  const col = index % GRID, row = Math.floor(index / GRID);
  // Поле вчетверо шире прежнего: на мип-уровнях выборка захватывает соседние
  // тексели, и при 0.001 (один пиксель атласа) в край тайла затекал сосед.
  const s = 1 / GRID, pad = 0.004;
  return {
    u0: col * s + pad, v0: 1 - (row + 1) * s + pad,
    u1: (col + 1) * s - pad, v1: 1 - row * s - pad,
  };
}

/** Превью тайла с тонировкой для редактора: маленький canvas → dataURL. */
/*
  Один тайл, покрашенный цветом, на отдельном холсте.

  Отсюда берут и мелкие превью в редакторе, и текстуры витрины скинов.
  Холст можно передать свой — тогда он перерисуется на месте, и привязанная
  к нему текстура обновится без пересборки сцены.

  Имена вида grass_dirt приходят из карт: это верх травы на боках земли.
  Берём первую часть — иначе такой блок молча падал в белый запасной тайл.
*/
export function tileCanvas(texName, color, size = 34, canvas = null) {
  const базовое = String(texName ?? '').split('_')[0];
  const idx = TILE[texName] ?? TILE[базовое] ?? TILE.plain;
  const src = bakedImage ?? getAtlasCanvas();
  const ts = bakedImage ? bakedImage.width / GRID : TS;
  const c = canvas ?? document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = Boolean(bakedImage);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(src, (idx % GRID) * ts, Math.floor(idx / GRID) * ts, ts, ts, 0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

export function tilePreviewURL(texName, color, size = 34) {
  return tileCanvas(texName, color, size).toDataURL();
}
