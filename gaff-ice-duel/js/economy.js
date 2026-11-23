// Монеты и кошелёк. Награда зависит от сложности соперника, поэтому фарм
// самого слабого бота бессмысленнее честной игры.
import { Platform } from './platform.js';
import { CONFIG } from './config.js';
import { SKINS, HOOK_SKINS, CUSTOM_ID, CUSTOM_PRICE } from './skins.js';

// Замер: матч идёт 2.4–3.9 минуты. При прежних 8/22/15 полчаса игры давали
// 400–600 монет, и первый скин за 250 выкупался минут за пятнадцать. Урезано
// примерно вдвое, чтобы за полчаса набирался ровно первый скин, а не половина
// каталога. Дневные источники (испытание, бонус за просмотр) НЕ резались:
// они начисляются раз в сутки и делают возвращение выгоднее гринда.
const BASE = 5;
const PER_DIFFICULTY = 12;
const CLEAN_SWEEP = 10;      // матч выигран всухую 3:0
export const DAILY_BONUS = 40;   // задание дня: заметно, но меньше победы над сильным ботом

function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Задание дня. Условия считаются по итогу матча — симуляция о них не знает,
 * поэтому баланс боя и тесты не затрагиваются.
 */
export const DAILY_TASKS = [
  { id: 'win', check: (r) => r.playerWon },
  { id: 'sweep', check: (r) => r.playerWon && r.score[1] === 0 },
  { id: 'strong', check: (r) => r.playerWon && r.levelIndex >= 2 },
  { id: 'comeback', check: (r) => r.playerWon && r.score[1] >= 2 },
];

/**
 * Выбор задания детерминирован датой, а не случаен: иначе перезаход в игру
 * перекатывал бы задание, пока не выпадет полегче. Плюс у всех игроков в один
 * день задание одно и то же — это то, что вообще делает «дневное» дневным.
 */
export function dailyTask(day = today()) {
  let h = 0;
  for (let i = 0; i < day.length; i++) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  return DAILY_TASKS[h % DAILY_TASKS.length];
}

/**
 * Награды за просмотр рекламы. Обе намеренно меньше слабейшей победы (≈30 монет),
 * чтобы смотреть рекламу не было выгоднее, чем играть.
 */
export const CONSOLATION = 12;   // за проигранный матч, один раз за матч
                                 // (меньше слабейшей победы = 17, иначе выгоднее сливать)
export const AD_BONUS = 50;      // бонус дня из меню, один раз в сутки

/** Бонус дня за просмотр: отдельный ключ, чтобы не мешаться с испытанием. */
export const AdBonus = {
  data: { day: null },

  async load() {
    const saved = await Platform.loadPlayer('adbonus', null);
    if (saved && typeof saved === 'object') this.data = { day: saved.day ?? null };
    return this.data;
  },

  isReady() { return this.data.day !== today(); },

  take() {
    this.data = { day: today() };
    return Platform.savePlayer('adbonus', this.data);
  },
};

export const Daily = {
  data: { day: null, done: false },

  async load() {
    const saved = await Platform.loadPlayer('daily', null);
    if (saved && typeof saved === 'object') {
      this.data = { day: saved.day ?? null, done: Boolean(saved.done) };
    }
    return this.data;
  },

  /** Наступил новый день — задание снова доступно. */
  isDone() { return this.data.day === today() && this.data.done; },

  complete() {
    this.data = { day: today(), done: true };
    return Platform.savePlayer('daily', this.data);
  },
};

export const Wallet = {
  data: {
    coins: CONFIG.startCoins, owned: ['default'], equipped: 'default',
    hooks: ['steel'], hook: 'steel', hues: [205, 25, 45], lastWinDay: null,
  },

  async load() {
    const saved = await Platform.loadPlayer('wallet', null);
    if (saved && typeof saved === 'object') {
      this.data = {
        coins: Number(saved.coins) || 0,
        owned: Array.isArray(saved.owned) && saved.owned.length ? saved.owned : ['default'],
        equipped: saved.equipped ?? 'default',
        // старые сохранения не знают про облик багра — подставляем базовый
        hooks: Array.isArray(saved.hooks) && saved.hooks.length ? saved.hooks : ['steel'],
        hook: saved.hook ?? 'steel',
        hues: Array.isArray(saved.hues) && saved.hues.length === 3
          ? saved.hues.map((h) => Math.max(0, Math.min(359, Number(h) || 0)))
          : [205, 25, 45],
        lastWinDay: saved.lastWinDay ?? null,
      };
      // облик мог быть надет, но не куплен (правка каталога) — откатываем
      if (!this.data.owned.includes(this.data.equipped)) this.data.equipped = 'default';
      if (!this.data.hooks.includes(this.data.hook)) this.data.hook = 'steel';
    }
    return this.data;
  },

  save() { return Platform.savePlayer('wallet', this.data); },

  add(amount) {
    this.data.coins = Math.max(0, this.data.coins + Math.round(amount));
    return this.save();
  },

  owns(id) { return this.data.owned.includes(id); },

  canBuy(id) {
    const skin = SKINS.find((s) => s.id === id);
    return Boolean(skin) && !this.owns(id) && this.data.coins >= skin.price;
  },

  /** Сохранить выбранные тона «своего цвета». */
  setHues(hues) {
    this.data.hues = hues.map((h) => Math.max(0, Math.min(359, Math.round(h))));
    return this.save();
  },

  buy(id) {
    // «свой цвет» покупается как обычный облик, но лежит не в каталоге SKINS
    const skin = id === CUSTOM_ID ? { price: CUSTOM_PRICE } : SKINS.find((s) => s.id === id);
    if (!skin || this.owns(id) || this.data.coins < skin.price) return false;
    this.data.coins -= skin.price;
    this.data.owned.push(id);
    this.data.equipped = id;
    this.save();
    return true;
  },

  equip(id) {
    if (!this.owns(id)) return false;
    this.data.equipped = id;
    this.save();
    return true;
  },

  /* --------------------------------------------------- облик багра (свой слот) */

  ownsHook(id) { return this.data.hooks.includes(id); },

  buyHook(id) {
    const skin = HOOK_SKINS.find((s) => s.id === id);
    if (!skin || this.ownsHook(id) || this.data.coins < skin.price) return false;
    this.data.coins -= skin.price;
    this.data.hooks.push(id);
    this.data.hook = id;
    this.save();
    return true;
  },

  equipHook(id) {
    if (!this.ownsHook(id)) return false;
    this.data.hook = id;
    this.save();
    return true;
  },
};

/**
 * Разбор награды за матч — возвращает строки для экрана результата,
 * чтобы игрок видел, за что именно начислено.
 */
export function matchReward({ playerWon, score, levelIndex, coinMult }) {
  if (!playerWon) return { total: 0, lines: [] };

  const lines = [];
  lines.push({ key: 'rewardBase', value: BASE });
  const diff = Math.round(PER_DIFFICULTY * coinMult);
  lines.push({ key: 'rewardDiff', value: diff, mult: coinMult });

  let total = BASE + diff;
  if (score[1] === 0) { lines.push({ key: 'rewardClean', value: CLEAN_SWEEP }); total += CLEAN_SWEEP; }

  const day = today();
  const firstToday = Wallet.data.lastWinDay !== day;
  if (firstToday) {
    lines.push({ key: 'rewardFirst', value: total, x2: true });
    total *= 2;
    Wallet.data.lastWinDay = day;
  }

  // Задание дня — плоский бонус ПОВЕРХ удвоения: иначе первая победа за день
  // раздувала бы его вдвое и он перевешивал бы саму награду за матч.
  const task = dailyTask(day);
  if (!Daily.isDone() && task.check({ playerWon, score, levelIndex })) {
    lines.push({ key: 'rewardDaily', value: DAILY_BONUS, task: task.id });
    total += DAILY_BONUS;
    Daily.complete();
  }

  return { total, lines, levelIndex };
}
