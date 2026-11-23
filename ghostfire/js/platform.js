import { Ads } from './ad-session.js';
// Граница платформы для сборки под CrazyGames: жизненный цикл SDK, реклама,
// сохранения. Игровой код никогда не обращается к SDK напрямую — он зовёт
// нейтральные методы отсюда, и на локальном хостинге те же методы работают
// через localStorage.
//
// Profile: Basic Launch by default; Full ads are explicitly gated in CONFIG.
// Leaderboards and IAP exist in the current SDK but are not configured for this game.
// Data Module is authoritative on-platform, localStorage is only for standalone use.

import { CONFIG } from './config.js';
import { Sound } from './audio.js';
import { Music } from './music.js';
import { AudioPolicy } from './audio-policy.js';
import {
  VALIDATION_LIMITS,
  isPlainObject,
  normalizePlayerData,
  normalizeWallet,
  validateCustomMap,
} from './validation.js';

const LS_PREFIX = 'ghostfire.';
const CLOUD_KEY = 'ghostfire.blob';
// Локали, где русская версия игры полезнее английской.
const RU_LOCALES = new Set(['ru', 'be', 'uk', 'kk', 'uz', 'ky', 'tg', 'tk']);

// Сколько монет даёт один ролик и как часто его можно смотреть. Реклама здесь
// не обязательна ни для чего: монеты идут за матчи, а это лишь ускорение.
const AD_COINS = 60;
const AD_COOLDOWN_MS = 120000;

let sdk = null;
let cloud = {};
let initPromise = null;
let gameplayActive = false;
let lastAdAt = 0;
let lastError = null;

function setError(code, detail = null) {
  lastError = { code, detail: detail ? String(detail?.message ?? detail) : null };
  if (detail) console.warn(`[platform] ${code}`, detail);
}

// ── хранилище ──────────────────────────────────────────────────────────────

function lsRead(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function lsWrite(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
  catch (e) { setError('local_save_failed', e); return false; }
}

/**
 * Глубокая копия только из того, что переживает JSON.
 *
 * Не путать с `serializableObject` из validation.js: та ПРОВЕРЯЕТ и возвращает
 * да/нет. Я принял её за копирующую, и в хранилище улетало булево value
 * вместо кошелька — тесты игры поймали это на первом же прогоне.
 */
function cloneSerializable(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { return undefined; }
}

function byteLength(value) {
  try { return new TextEncoder().encode(JSON.stringify(value)).length; }
  catch { return Infinity; }
}

function cloudRead() {
  if (!sdk) return null;
  try {
    const raw = sdk.data.getItem(CLOUD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { setError('cloud_read_failed', e); return null; }
}

function cloudWrite(next) {
  if (!sdk) return false;
  try { sdk.data.setItem(CLOUD_KEY, JSON.stringify(next)); return true; }
  catch (e) { setError('cloud_save_failed', e); return false; }
}

/** Save through the platform Data Module, or localStorage without an SDK. */
function persistDetailed(key, value) {
  const safe = cloneSerializable(value);
  if (safe === undefined) {
    setError('invalid_save_data');
    return { ok: false, local: false, cloud: false };
  }
  if (!sdk) {
    const localOK = lsWrite(key, safe);
    return { ok: localOK, local: localOK, cloud: false };
  }
  const localOK = false; // On-platform, Data owns guest and account saves.

  const next = { ...(isPlainObject(cloud) ? cloud : {}), [key]: safe };
  if (byteLength(next) > VALIDATION_LIMITS.cloudBytes) {
    setError('cloud_data_too_large');
    return { ok: false, local: localOK, cloud: false };
  }
  const cloudOK = cloudWrite(next);
  if (cloudOK) cloud = next;
  return { ok: cloudOK, local: localOK, cloud: cloudOK };
}

const store = (key, value) => persistDetailed(key, value).ok;

function read(key) {
  if (isPlainObject(cloud) && cloud[key] !== undefined && cloud[key] !== null) return cloud[key];
  if (sdk) return null; // Empty account must not inherit another local profile.
  return lsRead(key);
}

// ── язык ───────────────────────────────────────────────────────────────────

/**
 * Политика языка: RU для локалей RU_LOCALES, EN для остальных.
 *
 * На CrazyGames аудитория международная, поэтому неизвестный язык — английский,
 * а не русский, как в яндексовой сборке. Явный выбор игрока в настройках
 * приоритетнее любого автоопределения.
 */
function normalizeLang(value) {
  const lang = String(value || '').toLowerCase().split('-')[0];
  if (!lang) return 'en';
  return RU_LOCALES.has(lang) ? 'ru' : 'en';
}

function detectLang() {
  return normalizeLang(sdk?.user?.systemInfo?.locale);
}

// ── звук на время ролика ───────────────────────────────────────────────────

export const Platform = {
  ready: false,
  // Игровой код кое-где спрашивает, яндексовая ли это сборка: там, где речь о
  // покупках и таблицах. Здесь ответ всегда «нет», и ветки сами отключаются.
  isYandex: false,
  detectedLang: detectLang(),

  async initSDK() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const внешний = window.CrazyGames?.SDK;
      if (!внешний) {
        // Вне площадки играем на локальных заглушках — это штатный режим
        // разработки, а не отказ.
        this.ready = true;
        return false;
      }
      try {
        // Потолок ожидания обязателен: у неотвечающего SDK нет тайм-аута, и без
        // него игра зависла бы на загрузке, а не ушла на локальные данные.
        await Promise.race([
          внешний.init(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('sdk_init_timeout')), 4500)),
        ]);
        sdk = внешний;
        this.detectedLang = detectLang();
        this.isYandex = false;
        cloud = cloudRead() || {};
        try { sdk.game.loadingStart(); } catch (_) {}
        this.watchMute();
      } catch (e) {
        setError('sdk_init_failed', e);
        sdk = null;
      }
      this.ready = true;
      return !!sdk;
    })();
    return initPromise;
  },

  /**
   * Звук площадки: игрок может выключить его их кнопкой, вне нашего интерфейса.
   * Не подписаться — значит продолжать звучать после того, как игрок попросил
   * тишины, и это одна из причин, по которой игры снимают.
   */
  watchMute() {
    if (!sdk?.game?.addSettingsChangeListener) return;
    const применить = () => {
      /*
        Настройку читаем из ЖИВОГО объекта площадки, а не из ссылки, взятой при
        запуске. Ссылка теоретически может устареть — тогда мы бы вечно читали
        первоначальное значение и молча игнорировали кнопку игрока. Стоит это
        одного обращения к глобальной переменной, а цена ошибки — звук, который
        не выключается, и это одна из причин, по которым игры снимают.
      */
      const live = (typeof window !== 'undefined' && window.CrazyGames?.SDK) || sdk;
      const выкл = !!live?.game?.settings?.muteAudio;
      AudioPolicy.set('platform-mute', выкл);
    };
    применить();
    try { sdk.game.addSettingsChangeListener(применить); } catch (_) {}
  },

  /**
   * Ссылка вызова через приглашение площадки.
   *
   * `inviteLink` возвращает адрес самой игры на их домене с нашими параметрами
   * внутри — то есть трафик остаётся у них, а это единственный допустимый
   * способ делиться. Свой хостинг сюда подставлять нельзя ни при каких
   * условиях: увод трафика с площадки — прямой повод для снятия игры.
   *
   * Метод асинхронный, поэтому и наш асинхронный. Игра это переживает: экран
   * вызова уже был асинхронным, а при отказе она копирует голый код, как и до
   * появления ссылки.
   */
  async getShareUrl(code) {
    const clean = String(code || '').trim();
    if (!clean || !sdk?.game?.inviteLink) return null;
    // Потолок длины оставляем прежним: адрес с гигантским параметром обрежут
    // мессенджеры, и игрок получит битую ссылку вместо кода.
    if (clean.length > CONFIG.sharePayloadLimit) return null;
    try {
      const url = await sdk.game.inviteLink({ ghost: clean });
      return typeof url === 'string' && url ? url : null;
    } catch (e) { setError('invite_link_failed', e); return null; }
  },

  /**
   * Заход по ссылке вызова: параметр читается синхронно, как и прежде.
   *
   * Синхронность здесь не прихоть — игра спрашивает payload при построении
   * меню, до первого кадра, и асинхронный ответ пришёл бы уже после того, как
   * обычное меню нарисовано.
   */
  getLaunchPayload() {
    try {
      const value = sdk?.game?.getInviteParam?.('ghost');
      return value ? String(value) : null;
    } catch (e) { setError('invite_param_failed', e); return null; }
  },

  gameReady() {
    try { sdk?.game?.loadingStop(); } catch (e) { setError('loading_stop_failed', e); }
  },

  /** Доверенного времени нет — берём местное и не притворяемся. */
  serverTime() { return null; },

  gameplayStart() {
    if (gameplayActive) return;
    gameplayActive = true;
    if (Ads.active) return;   // во время ролика геймплея нет по определению
    try { sdk?.game?.gameplayStart(); } catch (e) { setError('gameplay_start_failed', e); }
  },

  gameplayStop() {
    if (!gameplayActive) return;
    gameplayActive = false;
    try { sdk?.game?.gameplayStop(); } catch (e) { setError('gameplay_stop_failed', e); }
  },

  // ── реклама ──────────────────────────────────────────────────────────────

  /**
   * Вознаграждаемый ролик.
   *
   * Награда выдаётся ТОЛЬКО из adFinished и ровно один раз. Отказ, закрытие и
   * блокировщик награды не дают — это требование площадки и просто честность
   * по отношению к тому, кто рекламу оплатил.
   */
  async showRewardedAd() {
    if (!this.adsAvailable()) return false;
    return Ads.request(({started, finish}) => sdk.ad.requestAd('rewarded', {
      adStarted: started, adFinished: () => finish(true), adError: () => finish(false),
    }));
  },
  async showInterstitialAd() {
    if (!this.adsAvailable() || Ads.active || Date.now() - (this._lastInterstitialAt || 0) < 180000) return false;
    this._lastInterstitialAt = Date.now();
    return Ads.request(({started, finish}) => sdk.ad.requestAd('midgame', {
      adStarted: started, adFinished: () => finish(true), adError: () => finish(false),
    }));
  },

  /** Есть ли смысл предлагать ролик прямо сейчас. */
  canWatchAdForCoins() {
    return this.adsAvailable() && !Ads.active && Date.now() - lastAdAt >= AD_COOLDOWN_MS;
  },
  // Stage is a build policy, never guessed from the presence of an SDK.
  adsAvailable() { return CONFIG.launchStage === 'full' && !!sdk?.ad?.requestAd; },
  isAdActive() { return Ads.active; },

  adCoinsAmount() { return AD_COINS; },

  /**
   * Монеты за просмотр — замена пополнению кошелька деньгами.
   *
   * Магазин скинов остаётся прежним: он всегда торговал за монеты, которые
   * выдаются за матчи. Реклама лишь ускоряет накопление и ничего не отнимает у
   * того, кто её не смотрит.
   */
  async watchAdForCoins(wallet) {
    if (!this.canWatchAdForCoins()) return { ok: false, coins: 0, wallet };
    const ок = await this.showRewardedAd('coins');
    if (!ок) return { ok: false, coins: 0, wallet };
    lastAdAt = Date.now();
    const next = normalizeWallet({ ...(isPlainObject(wallet) ? wallet : {}) });
    next.coins = (Number(next.coins) || 0) + AD_COINS;
    const saved = normalizeWallet(next);
    store('wallet', saved);
    return { ok: true, coins: AD_COINS, wallet: saved };
  },

  // ── данные игрока ────────────────────────────────────────────────────────

  async savePlayer(data) { return store('player', normalizePlayerData(data)); },
  async loadPlayer() { return normalizePlayerData(read('player')); },

  async loadWallet() { return normalizeWallet(read('wallet')); },
  async saveWallet(wallet) { return store('wallet', normalizeWallet(wallet)); },

  async saveSkin(skin) { return store('skin', cloneSerializable(skin)); },
  async loadSkin() { return read('skin'); },

  async saveCustomMap(mapData) {
    const проверенная = validateCustomMap(mapData);
    if (!проверенная) { setError('invalid_custom_map'); return false; }
    return store('customMap', проверенная);
  },
  async loadCustomMap() { return validateCustomMap(read('customMap')); },

  // No leaderboard has been configured in the portal for this port.
  hasLeaderboard() { return false; },
  async getLeaderboard() { return null; },

  async submitScore(board, score) {   // eslint-disable-line no-unused-vars
    const num = Number(score);
    if (!sdk?.user?.submitScore || !Number.isFinite(num)) return false;
    try {
      await sdk.user.submitScore({ score: Math.max(0, Math.round(num)) });
      return true;
    } catch (e) { setError('submit_score_failed', e); return false; }
  },

  /** Победы: копим у себя и отправляем накопленное num. */
  async recordWinAndSubmit(board = 'wins') {
    const previous = read('stats');
    const stats = isPlainObject(previous) ? { ...previous } : {};
    const value = Number(stats[board]);
    stats[board] = Math.min(2147483647, Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0) + 1);
    store('stats', stats);
    return this.submitScore(board, stats[board]);
  },

  /** IAP is not configured; skins use earned coins. */
  paymentsAvailable() { return false; },
  async loadPaymentCatalog() { return []; },
  /**
   * Восстанавливать нечего: покупок на площадке нет.
   *
   * Возвращаем КОШЕЛЁК, а не отчёт о проделанной работе. Вызывающий пишет
   * результат прямо в свою переменную — я вернул было объект `{restored,
   * wallet}`, и кошелёк игрока стал этим объектом, потеряв поле owned. Магазин
   * падал на первой же строке, а тест этого не поймал, потому что я подогнал
   * его под свою же неверную форму. Тест, переписанный под ошибку, не защищает
   * ни от чего.
   */
  async recoverPurchases(packs, wallet) { return normalizeWallet(wallet); },   // eslint-disable-line no-unused-vars
  /**
   * Покупка отказывает, но возвращает кошелёк БЕЗ изменений, а не пустоту.
   *
   * Вызывающий пишет `wallet = await buyCoinsPack(...)`, и `null` обнулил бы
   * кошелёк игрока прямо в памяти. Тесты игры это поймали сразу — контракт
   * важнее того, поддерживает площадка покупки или нет.
   */
  async buyCoinsPack() {
    setError('payments_unavailable');
    return normalizeWallet(read('wallet'));
  },

  getLastError() { return lastError ? { ...lastError } : null; },
  consumeLastError() { const value = this.getLastError(); lastError = null; return value; },
};
