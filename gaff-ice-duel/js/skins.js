// Косметика: палитры бойца и крюка. Только цвета — новых 3D-файлов не нужно,
// поэтому «скин» стоит ноль байт ассетов и покупается за монеты.
export const SKINS = [
  {
    id: 'default', price: 0,
    name: { ru: 'Ледолов', en: 'Icecatcher' },
    coat: 0x2f6f8f, pants: 0x24404f, skin: 0xe8b98f, hat: 0xd8562f,
    accent: 0xffd75e, iron: 0x6b7480, rope: 0x8d6b4a,
  },
  {
    id: 'moss', price: 180,
    name: { ru: 'Тинистый', en: 'Mossback' },
    coat: 0x3f6b47, pants: 0x2b4430, skin: 0xd9a97a, hat: 0x8fbf5a,
    accent: 0xc7f06a, iron: 0x5f6b5c, rope: 0x7a6a3e,
  },
  {
    id: 'frost', price: 400,
    name: { ru: 'Стужа', en: 'Hoarfrost' },
    coat: 0xdfe9f2, pants: 0x9fb4c4, skin: 0xf0d3b4, hat: 0x6fd0e8,
    accent: 0x6fd0e8, iron: 0x9fb6c6, rope: 0xbfcedb,
  },
  {
    id: 'ember', price: 600,
    name: { ru: 'Уголёк', en: 'Ember' },
    coat: 0x4a2b2b, pants: 0x2f1d1d, skin: 0xe0a97f, hat: 0xff7b39,
    accent: 0xff9c3d, iron: 0x7a5340, rope: 0x8f4a2a,
  },
];

/**
 * Облик багра — отдельный слот. Крюк и цепь красятся только двумя полями
 * (iron — металл, rope — обмотка), поэтому облик багра не пересекается с одеждой
 * бойца и покупается независимо. Ассетов не прибавляется: те же воксели, другие цвета.
 */
export const HOOK_SKINS = [
  { id: 'steel', price: 0, name: { ru: 'Сталь', en: 'Steel' }, iron: 0x6b7480, rope: 0x8d6b4a },
  { id: 'copper', price: 200, name: { ru: 'Медянка', en: 'Copper' }, iron: 0xc0763a, rope: 0x6f5233 },
  { id: 'frost', price: 350, name: { ru: 'Иней', en: 'Rime' }, iron: 0xa8d8ea, rope: 0xdfe9f2 },
  { id: 'coal', price: 500, name: { ru: 'Смоль', en: 'Pitch' }, iron: 0x2f3540, rope: 0x9c4a2a },
];

export function hookSkinById(id) {
  return HOOK_SKINS.find((s) => s.id === id) ?? HOOK_SKINS[0];
}

export const BOT_SKIN = {
  id: 'rival',
  coat: 0x6d4b7a, pants: 0x3d2b4a, skin: 0xd6c3ad, hat: 0x3d2b4a,
  accent: 0xff6b9d, iron: 0x5a5f6b, rope: 0x6a5b4a,
};

/**
 * «Свой цвет» — платный слот, где игрок сам крутит оттенки. Хранится не палитрой,
 * а тремя тонами (0..359): так сохранение остаётся крошечным, а цвета всегда
 * получаются согласованными по яркости и насыщенности — вручную набранная палитра
 * легко выходит грязной.
 */
export const CUSTOM_ID = 'custom';
export const CUSTOM_PRICE = 800;

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}

/** Собирает облик из трёх тонов. Яркость и насыщенность заданы жёстко. */
export function customSkin(hues) {
  const [coat, hat, accent] = hues;
  return {
    id: CUSTOM_ID, price: CUSTOM_PRICE,
    name: { ru: 'Свой цвет', en: 'Custom' },
    coat: hsl(coat, 0.42, 0.42),
    pants: hsl(coat, 0.38, 0.26),
    skin: 0xe8b98f,
    hat: hsl(hat, 0.62, 0.52),
    accent: hsl(accent, 0.78, 0.62),
    iron: 0x6b7480,
    rope: 0x8d6b4a,
  };
}

export function skinById(id, hues) {
  if (id === CUSTOM_ID) return customSkin(hues ?? [205, 25, 45]);
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}
