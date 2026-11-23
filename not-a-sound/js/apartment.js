// Процедурная квартира: комнаты сеткой, проходы, шкафы, ковры, батарейки.
//
// Отдаёт данные в формате `maps/*.json`, который уже умеет читать map.js из
// ghostfire — воксели с палитрой. Своей геометрии здесь нет, только раскладка.
//
// Почему сетка, а не свободный лабиринт: игроку нужен путь отступления из любой
// точки. Случайная генерация регулярно даёт тупики, а тупик в игре про
// прятки — это не сложность, это несправедливость.
//
// Дополнительно к формату карты возвращаются поля, которых map.js не знает и
// спокойно игнорирует: rugs, wardrobes, batteries, rooms. Ими пользуется игра.

const ROOMS_X = 3, ROOMS_Z = 4;
const CELL = 8;                 // клетка комнаты вместе со стеной
const WALL_H = 3;               // высота стен в блоках
const DOOR_W = 2;               // ширина прохода

// Типы палитры. Цвет тонирует нейтральный тайл из textures.js, поэтому один
// тайл обслуживает и пол, и потолок, и комод — меняется только оттенок.
//
// Раньше типов было пять, и квартира выглядела набором пустых серых коробок:
// пол, стены, потолок, ящик-шкаф. Жильё узнаётся не планировкой, а вещами в
// нём, поэтому большая часть списка ниже — мебель.
export const T = {
  FLOOR: 1,
  WALL_A: 2,        // обои: четыре тона по рядам комнат, чтобы квартира
  WALL_B: 12,       // не читалась как один бесконечный коридор
  WALL_C: 13,
  WALL_D: 14,
  CEIL: 3,
  WARDROBE: 4,
  RUG: 5,
  WOOD: 6,          // комод, стол, полка
  FABRIC: 7,        // диван, кресло
  METAL: 8,         // холодильник, плита
  BOOKS: 9,         // корешки на полке
  PLANT: 10,        // растение
  LAMP: 11,         // абажур: единственный тёплый источник кроме фонаря
  DOORFRAME: 15,    // косяк проёма
};

export const PALETTE = {
  1:  { color: '#5a4430', tex: 'planks' },    // паркет, теплее прежнего
  2:  { color: '#7a6f5c', tex: 'wallpaper' }, // обои песочные
  12: { color: '#666a5c', tex: 'wallpaper' }, // обои оливковые
  13: { color: '#645d68', tex: 'wallpaper' }, // обои лиловые
  14: { color: '#58646d', tex: 'wallpaper' }, // обои холодные
  3:  { color: '#1c2128', tex: 'concrete' },  // потолок темнее стен
  // Шкаф был оранжевым ящиком с накладным крестом — из-за него вся квартира
  // читалась складом. Тёмное вертикальное дерево выглядит мебелью, а не тарой.
  4:  { color: '#3b2a1a', tex: 'planks' },    // шкаф
  // Ковёр отличался от пола на пару тонов и той же текстурой: игрок видел в
  // интерфейсе «на ковре» и не понимал, где ковёр. Кирпич эту задачу решил, но
  // создал новую — на полу лежала кладка. Отдельный ворсовый тайл читается
  // тканью и остаётся заметным.
  5:  { color: '#7a3a38', tex: 'carpet' },    // ковёр
  6:  { color: '#4a3423', tex: 'planks' },    // дерево мебели
  7:  { color: '#2c3438', tex: 'concrete' },  // обивка: темнее дерева, иначе диван спорит с ним по светлоте
  8:  { color: '#5a6268', tex: 'metal' },     // техника: светлее — становится самым ярким пятном комнаты
  9:  { color: '#5c3a2e', tex: 'stone' },     // книги: кирпич читался буквально кирпичной кладкой
  10: { color: '#26361f', tex: 'grass' },     // зелень, приглушённая
  11: { color: '#b98a48', tex: 'concrete' },  // абажур
  15: { color: '#3a2a1c', tex: 'planks' },    // косяк
};

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

/**
 * @param {number} seed
 * @returns данные карты плюс игровые точки
 */
/**
 * Палитра этой ночи.
 *
 * PALETTE — константа, и все ночи выглядели одинаково: те же обои в тех же
 * рядах, тот же пол. Планировка менялась, а цвет — нет, и квартира читалась
 * как одна и та же комната с переставленной мебелью.
 *
 * Здесь четыре обойных тона переставляются между собой, а пол и ковёр слегка
 * уводятся по тону. Копия, а не правка общей константы: карта строится заново
 * каждую ночь и берёт цвета отсюда, а испортить константу означало бы утащить
 * вчерашний цвет в завтрашнюю квартиру.
 */
function nightPalette(rand) {
  const p = {};
  for (const k of Object.keys(PALETTE)) p[k] = { ...PALETTE[k] };

  // Перестановка обоев: тасуем сами ключи, оттенки остаются студийными.
  const ids = [2, 12, 13, 14];
  const tones = ids.map(i => PALETTE[i].color);
  for (let i = tones.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tones[i], tones[j]] = [tones[j], tones[i]];
  }
  ids.forEach((id, i) => { p[id].color = tones[i]; });

  // Пол и ковёр уводим по тону, но не по яркости: тёмный пол в игре про
  // темноту — это не атмосфера, а невозможность играть.
  p[1].color = shiftHue(PALETTE[1].color, (rand() - 0.5) * 26);
  p[5].color = shiftHue(PALETTE[5].color, (rand() - 0.5) * 40);
  return p;
}

/** Сдвиг тона в градусах, яркость и насыщенность не трогаем. */
function shiftHue(hex, deg) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2, d = max - min;
  if (d === 0) return hex;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + deg + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q;
  const conv = tt => {
    if (tt < 0) tt += 1; if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return pp + (q - pp) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return pp + (q - pp) * (2 / 3 - tt) * 6;
    return pp;
  };
  const to = v => Math.round(conv(v) * 255).toString(16).padStart(2, '0');
  return '#' + to(h + 1 / 3) + to(h) + to(h - 1 / 3);
}

export function generateApartment(seed = Date.now() & 0xffff, opts = {}) {
  const rand = rng(seed);
  // Сколько батареек нужно собрать. Параметром, а не константой: с цепочкой
  // ночей задача растёт от ночи к ночи. Больше, чем комнат, положить некуда —
  // на комнату кладётся не больше одной.
  const needBatteries = Math.max(1, Math.min(ROOMS_X * ROOMS_Z, opts.batteries || 6));

  const W = ROOMS_X * CELL + 1;
  const D = ROOMS_Z * CELL + 1;

  // Сплошная сетка стен, потом вырезаем комнаты. Так гарантированно нет дыр
  // наружу: квартира должна быть замкнутой, иначе игрок выйдет в пустоту.
  const wall = [];
  for (let z = 0; z < D; z++) {
    wall[z] = [];
    for (let x = 0; x < W; x++) wall[z][x] = true;
  }

  const rooms = [];
  for (let rz = 0; rz < ROOMS_Z; rz++) {
    for (let rx = 0; rx < ROOMS_X; rx++) {
      const x0 = rx * CELL + 1, z0 = rz * CELL + 1;
      const x1 = x0 + CELL - 2, z1 = z0 + CELL - 2;
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) wall[z][x] = false;
      rooms.push({ rx, rz, x0, z0, x1, z1, cx: (x0 + x1) / 2 + 0.5, cz: (z0 + z1) / 2 + 0.5 });
    }
  }

  /*
    Слияние комнат: иногда стены между двумя соседними нет вовсе.

    Сетка комнат жёсткая — размеры и положения одни и те же всегда, — и раньше
    от ночи к ночи менялись только проёмы да мебель. Квартира честно читалась
    как «та же самая», и владелец сказал ровно это: скучно бегать по одной
    карте. Снос целой стены между парой комнат даёт длинный зал вместо двух
    клетушек, меняет линии обзора и маршруты бегства — и стоит одного цикла.

    Сносим только вертикальные стены внутри ряда: связность от удаления стены
    может лишь вырасти, запереться негде. Пар выбираем одну–три, не повторяясь.
  */
  const merged = new Set();
  const mergeCount = pick(rand, 1, 3);
  for (let n = 0; n < mergeCount; n++) {
    // pick включает верхнюю границу: ряд 0..ROOMS_Z-1, а левая комната пары
    // не дальше предпоследней — правее неё сносить нечего.
    const rz = pick(rand, 0, ROOMS_Z - 1);
    const rx = pick(rand, 0, ROOMS_X - 2);
    const key = rz + ',' + rx;
    if (merged.has(key)) continue;
    merged.add(key);
    const wx = (rx + 1) * CELL;
    const z0 = rz * CELL + 1, z1 = z0 + CELL - 2;
    for (let z = z0; z <= z1; z++) wall[z][wx] = false;
  }

  // Проходы: вправо у каждой комнаты и вниз у одной случайной в ряду.
  // Этого достаточно для связности всей квартиры и оставляет тупиковые углы,
  // где можно спрятаться, но не запереться насмерть.
  //
  // Клетки проёмов запоминаем: мебель рядом с ними ставить нельзя, иначе
  // случайный комод перекроет единственную дорогу и получится тупик — а тупик
  // в игре про прятки это не сложность, это несправедливость.
  const doorCells = new Set();
  const markDoor = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) doorCells.add((z + dz) + ',' + (x + dx));
    }
  };
  const frames = [];   // косяки: вертикальные стойки по краям проёма

  for (let rz = 0; rz < ROOMS_Z; rz++) {
    for (let rx = 0; rx < ROOMS_X - 1; rx++) {
      // Стены уже нет — косяки рисовать не по чему.
      if (merged.has(rz + ',' + rx)) continue;
      const wx = (rx + 1) * CELL;
      const z = rz * CELL + 1 + pick(rand, 1, CELL - 3 - DOOR_W);
      for (let i = 0; i < DOOR_W; i++) { wall[z + i][wx] = false; markDoor(wx, z + i); }
      frames.push({ x: wx, z: z - 1 }, { x: wx, z: z + DOOR_W });
    }
    if (rz < ROOMS_Z - 1) {
      const rx = pick(rand, 0, ROOMS_X - 1);
      const wz = (rz + 1) * CELL;
      const x = rx * CELL + 1 + pick(rand, 1, CELL - 3 - DOOR_W);
      for (let i = 0; i < DOOR_W; i++) { wall[wz][x + i] = false; markDoor(x + i, wz); }
      frames.push({ x: x - 1, z: wz }, { x: x + DOOR_W, z: wz });
    }
  }

  const blocks = [];
  const solidAt = (x, z) => x >= 0 && z >= 0 && x < W && z < D && wall[z][x];

  // Обои разные по рядам комнат: в одинаковых комнатах теряешь счёт, где был,
  // а в игре про перемещение по тёмной квартире это половина ориентирования.
  //
  // Цвет берём от комнаты, К КОТОРОЙ стена примыкает, а не от координаты.
  // По координате дальняя стена комнаты попадала в следующий ряд и оказывалась
  // другого цвета, чем три остальные, — выглядело ошибкой сборки. Стены между
  // комнатами толщиной в две клетки, поэтому у каждой комнаты своя поверхность
  // и делить одну на двоих не приходится.
  const WALLPAPER = [T.WALL_A, T.WALL_B, T.WALL_C, T.WALL_D];
  const frameSet = new Set(frames.map(f => f.z + ',' + f.x));

  const rowOfCell = new Map();
  for (const r of rooms) {
    for (let z = r.z0; z <= r.z1; z++) {
      for (let x = r.x0; x <= r.x1; x++) rowOfCell.set(z + ',' + x, r.rz);
    }
  }
  const paperFor = (x, z) => {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const row = rowOfCell.get((z + dz) + ',' + (x + dx));
      if (row != null) return WALLPAPER[row % WALLPAPER.length];
    }
    // Клетка внутри толщи стены, её никто не видит: берём соседний ряд.
    return WALLPAPER[Math.min(ROOMS_Z - 1, Math.floor(z / CELL)) % WALLPAPER.length];
  };

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      blocks.push([x, 0, z, T.FLOOR]);                         // пол
      blocks.push([x, WALL_H + 1, z, T.CEIL]);                 // потолок
      if (!wall[z][x]) continue;
      const paper = frameSet.has(z + ',' + x) ? T.DOORFRAME : paperFor(x, z);
      for (let y = 1; y <= WALL_H; y++) blocks.push([x, y, z, paper]);
    }
  }

  // ── обстановка ─────────────────────────────────────────────────────────
  //
  // Каждая комната получает назначение и свой набор вещей. Без этого квартира
  // была шестью одинаковыми пустыми коробками: планировка есть, жилья нет.
  //
  // Занятые клетки ведём отдельно и отдаём наружу: по ним сосед строит путь
  // (иначе он ходит сквозь комоды) и по ним же отсеиваются места для батареек
  // и ковров (иначе батарейка окажется внутри холодильника).
  const occupied = new Set();
  const lamps = [];
  const okCell = (x, z) => {
    if (wall[z][x]) return false;
    if (doorCells.has(z + ',' + x)) return false;
    return !occupied.has(z + ',' + x);
  };
  const put = (x, z, y, type) => {
    blocks.push([x, y, z, type]);
    occupied.add(z + ',' + x);
  };

  /** Найти свободную клетку у стены: мебель посреди комнаты выглядит мусором. */
  function spotByWall(room, rand) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const x = pick(rand, room.x0, room.x1);
      const z = pick(rand, room.z0, room.z1);
      if (!okCell(x, z)) continue;
      const nearWall = solidAt(x - 1, z) || solidAt(x + 1, z) || solidAt(x, z - 1) || solidAt(x, z + 1);
      if (nearWall) return { x, z };
    }
    return null;
  }

  /** Клетка рядом с уже занятой, чтобы диван и комод были длиной в две-три. */
  function extend(from, rand) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => rand() - 0.5);
    for (const [dx, dz] of dirs) {
      const x = from.x + dx, z = from.z + dz;
      if (okCell(x, z)) return { x, z };
    }
    return null;
  }

  // Назначения комнат по кругу. Прихожая всегда первая — с неё игрок начинает.
  const KINDS = ['hall', 'living', 'kitchen', 'bedroom', 'study', 'living'];
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    room.kind = i === 0 ? 'hall' : KINDS[i % KINDS.length];

    const set = spot => { if (spot) return spot; return null; };

    if (room.kind === 'living') {
      // Диван из двух-трёх клеток плюс торшер рядом.
      const a = set(spotByWall(room, rand));
      if (a) {
        put(a.x, a.z, 1, T.FABRIC);
        const b = extend(a, rand);
        if (b) put(b.x, b.z, 1, T.FABRIC);
        const c = b && extend(b, rand);
        if (c && rand() < 0.6) put(c.x, c.z, 1, T.FABRIC);
      }
      const lamp = set(spotByWall(room, rand));
      if (lamp) {
        put(lamp.x, lamp.z, 1, T.WOOD);
        blocks.push([lamp.x, 2, lamp.z, T.LAMP]);
        lamps.push({ x: lamp.x + 0.5, y: 3.15, z: lamp.z + 0.5 });
      }
    } else if (room.kind === 'kitchen') {
      const fridge = set(spotByWall(room, rand));
      if (fridge) { put(fridge.x, fridge.z, 1, T.METAL); blocks.push([fridge.x, 2, fridge.z, T.METAL]); }
      const counter = set(spotByWall(room, rand));
      if (counter) {
        put(counter.x, counter.z, 1, T.WOOD);
        const b = extend(counter, rand);
        if (b) put(b.x, b.z, 1, T.WOOD);
      }
    } else if (room.kind === 'bedroom') {
      // Кровать: две клетки низкой обивки и деревянное изголовье.
      const a = set(spotByWall(room, rand));
      if (a) {
        put(a.x, a.z, 1, T.WOOD);
        const b = extend(a, rand);
        if (b) put(b.x, b.z, 1, T.FABRIC);
        const c = b && extend(b, rand);
        if (c) put(c.x, c.z, 1, T.FABRIC);
      }
      const lamp = set(spotByWall(room, rand));
      if (lamp && rand() < 0.7) {
        put(lamp.x, lamp.z, 1, T.WOOD);
        blocks.push([lamp.x, 2, lamp.z, T.LAMP]);
        lamps.push({ x: lamp.x + 0.5, y: 3.15, z: lamp.z + 0.5 });
      }
    } else if (room.kind === 'study') {
      // Стеллаж в полную высоту: он же перекрывает обзор и делает угол глухим.
      const a = set(spotByWall(room, rand));
      if (a) {
        put(a.x, a.z, 1, T.WOOD);
        blocks.push([a.x, 2, a.z, T.BOOKS]);
        const b = extend(a, rand);
        if (b) { put(b.x, b.z, 1, T.WOOD); blocks.push([b.x, 2, b.z, T.BOOKS]); }
      }
      const desk = set(spotByWall(room, rand));
      if (desk) put(desk.x, desk.z, 1, T.WOOD);
    } else {
      // Прихожая: комод и растение. Пусто, но не голо.
      const chest = set(spotByWall(room, rand));
      if (chest) put(chest.x, chest.z, 1, T.WOOD);
      const plant = set(spotByWall(room, rand));
      if (plant) { put(plant.x, plant.z, 1, T.WOOD); blocks.push([plant.x, 2, plant.z, T.PLANT]); }
    }

    // Добор мелочью. Комната шесть на шесть — это тридцать шесть клеток, и
    // тематического набора из трёх-четырёх предметов на неё не хватает:
    // получается склад с одним диваном, а не жильё. Мелочь ставится так же по
    // стенам и так же мимо проёмов, поэтому проходимость не страдает.
    const filler = [T.WOOD, T.WOOD, T.FABRIC, T.BOOKS, T.METAL];
    // Мало, но разное. На двух-четырёх предметах комната обрастала сплошным
    // кольцом одинаковых деревянных блоков по периметру — и снова читалась
    // составленными ящиками, от которых мы уходили.
    const extra = pick(rand, 1, 2);
    for (let k = 0; k < extra; k++) {
      const spot = spotByWall(room, rand);
      if (!spot) break;
      const type = filler[pick(rand, 0, filler.length - 1)];
      put(spot.x, spot.z, 1, type);

      // Мебель растёт вширь, а не вверх.
      //
      // Раньше добор с вероятностью 0.3 ставил второй блок сверху, и комната
      // заполнялась столбами в одну клетку шириной и две высотой: в кадре это
      // читалось колоннами, а не обстановкой. Настоящая мебель низкая и
      // длинная, поэтому по умолчанию тянемся в сторону.
      const wide = extend(spot, rand);
      const wideUsed = !!(wide && rand() < 0.45);
      if (wideUsed) put(wide.x, wide.z, 1, type);

      /*
        ВЕРХНИЙ БЛОК СТАВИТСЯ ТОЛЬКО НАД ЗАНЯТОЙ КЛЕТКОЙ.

        Здесь была ловушка, в которой игрок застревал намертво. Соседняя клетка
        занималась не всегда — бросок 0.45, — а блок на высоте 2 над ней
        ставился независимо от этого броска. Клетка оставалась проходимой и по
        данным карты, и для поиска пути, а игрок занимает по высоте от 1 до 2.7
        и упирался в нависший блок головой. Зайдя под него, он не мог двинуться
        ни по одной оси: свип проверяет весь объём и откатывает любое движение.

        Правило, которое нельзя нарушать: над проходимой клеткой не должно быть
        ничего ниже потолка. Проверяется в check-layout.js.
      */
      const tallPair = wideUsed && rand() < 0.22;
      if (tallPair) {
        const tall = type === T.BOOKS ? T.BOOKS : T.WARDROBE;
        blocks.push([spot.x, 2, spot.z, tall]);
        blocks.push([wide.x, 2, wide.z, tall]);
      } else if (rand() < 0.12) {
        // Лампа и шкаф в полный рост исключают друг друга: иначе два блока
        // встают в одну координату и мерцают гранями.
        blocks.push([spot.x, 2, spot.z, T.LAMP]);
        lamps.push({ x: spot.x + 0.5, y: 3.15, z: spot.z + 0.5 });
      }
    }
  }

  // Цельные ковры: прямоугольники для отрисовки, клетки для глушения шагов.
  const rugs = [], rugRects = [];
  for (const room of rooms) {
    const count = 1;
    for (let i = 0; i < count; i++) {
      const w = pick(rand, 2, 3), d = pick(rand, 2, 3);
      const x = pick(rand, room.x0, Math.max(room.x0, room.x1 - w));
      const z = pick(rand, room.z0, Math.max(room.z0, room.z1 - d));
      rugRects.push({x,z,w,d});
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const tx = x + dx, tz = z + dz;
          if (tx > room.x1 || tz > room.z1) continue;
          // Ковёр продолжается под мебелью, не распадаясь на обрезки.
          rugs.push({ x: tx, z: tz });
        }
      }
    }
  }

  // Шкафы ставим вплотную к стене: посреди комнаты они выглядят декорацией,
  // а у стены читаются как укрытие.
  const wardrobes = [];
  for (const room of rooms) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = pick(rand, room.x0, room.x1);
      const z = pick(rand, room.z0, room.z1);
      if (!okCell(x, z)) continue;
      const nearWall = solidAt(x - 1, z) || solidAt(x + 1, z) || solidAt(x, z - 1) || solidAt(x, z + 1);
      if (!nearWall) continue;
      // Шкаф — блок высотой два: игрок заходит в него, а не забирается сверху.
      put(x, z, 1, T.WARDROBE);
      blocks.push([x, 2, z, T.WARDROBE]);
      wardrobes.push({ x, z });
      break;
    }
  }

  /**
   * Клетки, куда игрок реально может дойти от точки появления.
   *
   * Проверять «клетка не занята» недостаточно: угол, обставленный с двух
   * сторон мебелью, а с двух других ограниченный стенами, свободен и при этом
   * недосягаем. В замере на двухстах планировках шесть прятали там батарейку —
   * то есть очко, которое нельзя взять, в игре, где очки дают батарейки.
   */
  const reach = new Set();
  {
    const sx = Math.floor(rooms[0].cx), sz = Math.floor(rooms[0].cz);
    const queue = [[sx, sz]];
    reach.add(sz + ',' + sx);
    while (queue.length) {
      const [x, z] = queue.shift();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, k = nz + ',' + nx;
        if (reach.has(k)) continue;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D) continue;
        if (wall[nz][nx] || occupied.has(k)) continue;
        reach.add(k);
        queue.push([nx, nz]);
      }
    }
  }

  // Шкаф, к которому не подойти, укрытием не является. Блок остаётся стоять
  // как мебель, но из списка укрытий уходит: иначе игра считала бы игрока
  // спрятавшимся рядом с местом, куда он попасть не может.
  const reachable = wardrobes.filter(w =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => reach.has((w.z + dz) + ',' + (w.x + dx))));
  wardrobes.length = 0;
  wardrobes.push(...reachable);

  // Батарейки в половине комнат: чаще — и заряд перестаёт быть ресурсом.
  const batteries = [];
  const shuffled = rooms.slice().sort(() => rand() - 0.5);
  for (const room of shuffled.slice(0, needBatteries)) {
    // Несколько попыток: с обстановкой свободных клеток стало меньше, и одна
    // попытка регулярно попадала в мебель — батарейка молча пропадала.
    for (let attempt = 0; attempt < 16; attempt++) {
      const x = pick(rand, room.x0, room.x1);
      const z = pick(rand, room.z0, room.z1);
      if (!okCell(x, z) || !reach.has(z + ',' + x)) continue;
      // y = 1.18, а не 0.5. Блок [x,y,z] занимает по высоте [y, y+1], значит
      // поверхность пола — ровно y = 1, и прежние 0.5 закапывали батарейку в
      // пол по центру. Игрок сообщал, что на карте ничего не лежит, и был прав
      // буквально: предметы были под полом.
      batteries.push({ x: x + 0.5, y: 1.18, z: z + 0.5 });
      break;
    }
  }

  /**
   * Мелочь на полу: книги, бумаги, опрокинутый стул, коробка.
   *
   * Не воксели, а отдельные модели, которые собирает игра, и намеренно без
   * коллизий: они должны валяться под ногами, а не превращать комнату в
   * полосу препятствий. Смысл ровно один — квартира должна выглядеть жилой.
   * Пустой пол между мебелью читался складом даже после того, как мебель
   * появилась.
   */
  const clutter = [];
  const JUNK = ['books', 'papers', 'chair', 'box', 'bottle'];
  for (const room of rooms) {
    const count = pick(rand, 2, 4);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const x = pick(rand, room.x0, room.x1);
        const z = pick(rand, room.z0, room.z1);
        if (!okCell(x, z) || !reach.has(z + ',' + x)) continue;
        if (clutter.some(c => c.cell === z + ',' + x)) continue;
        clutter.push({
          cell: z + ',' + x,
          kind: JUNK[pick(rand, 0, JUNK.length - 1)],
          x: x + 0.2 + rand() * 0.6,
          z: z + 0.2 + rand() * 0.6,
          rot: rand() * Math.PI * 2,
        });
        break;
      }
    }
  }

  /**
   * Картины, зеркала и часы на стенах.
   *
   * Отдельными моделями, а не вокселями: блок в этой карте всегда куб метр на
   * метр, и картина стала бы выступающим из стены ящиком. Здесь плоские рамки
   * в паре сантиметров от стены.
   *
   * Отдаём точку и нормаль — направление «от стены внутрь комнаты». Без неё
   * игра не знает, каким боком вешать раму, и половина картин смотрела бы в
   * стену.
   */
  const wallArt = [];
  const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const room of rooms) {
    const count = pick(rand, 1, 3);
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 14; attempt++) {
        const x = pick(rand, room.x0, room.x1);
        const z = pick(rand, room.z0, room.z1);
        if (doorCells.has(z + ',' + x)) continue;
        // Клетка должна быть у стены и не занята высокой мебелью: картина за
        // шкафом никому не видна.
        if (occupied.has(z + ',' + x)) continue;
        const side = SIDES.filter(([dx, dz]) => solidAt(x + dx, z + dz));
        if (!side.length) continue;
        const [nx, nz] = side[pick(rand, 0, side.length - 1)];
        const key = z + ',' + x + ',' + nx + ',' + nz;
        if (wallArt.some(a => a.key === key)) continue;
        wallArt.push({
          key,
          // Точка на грани стены: центр клетки плюс полклетки в сторону стены.
          x: x + 0.5 + nx * 0.47,
          z: z + 0.5 + nz * 0.47,
          y: 1 + 1.55 + (rand() - 0.5) * 0.3,
          nx, nz,
          kind: rand() < 0.62 ? 'picture' : (rand() < 0.6 ? 'mirror' : 'clock'),
          w: 0.5 + rand() * 0.45,
          h: 0.4 + rand() * 0.4,
        });
        break;
      }
    }
  }

  const start = rooms[0];
  const far = rooms[rooms.length - 1];

  return {
    id: 'apartment',
    name: 'apartment',
    palette: nightPalette(rand),
    blocks,
    spawns: [[start.cx, 1, start.cz, 0]],
    // Поля ниже map.js не знает и игнорирует — ими пользуется игра.
    rooms,
    rugs,
    rugRects,
    wardrobes,
    batteries,
    lamps,
    clutter,
    wallArt,
    // Клетки, занятые мебелью. По ним сосед строит путь и по ним игра решает,
    // куда нельзя класть предметы. Без этого он ходил бы сквозь комоды.
    occupied,
    neighborStart: { x: far.cx, z: far.cz },
    width: W,
    depth: D,
    wallGrid: wall,
    seed,
  };
}
