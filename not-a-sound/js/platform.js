/** CrazyGames HTML5 v3 adapter. This build targets Basic Launch:
 * lifecycle and saves remain available, all ad requests are disabled.
 * Language: saved choice, SDK user.systemInfo.locale, then English.
 * Local playtest events stay on localhost in a bounded sessionStorage buffer.
 */
(function () {
  'use strict';

  const CONFIG = {
    id: 'echo-hideout',
    launchStage: 'basic',

    /*
      Места полноэкранной рекламы. Список закрытый по требованию площадки:
      реклама не может прерывать активный геймплей и не ставится на
      навигационные кнопки — меню, настройки, магазин.
    */
    /*
      Метка 'menu' была в коде, но не в списке — и оба вызова возврата в меню
      молча получали отказ. Возврат в меню это законный перерыв и явное
      действие игрока, а от частоты защищает кулдаун, поэтому метка добавлена,
      а не вычеркнута из вызовов.
    */
    interstitialPlacements: ['result', 'night', 'menu'],

    interstitialCooldownMs: 180000,

    // Показ обязан быть следствием действия игрока. Требование есть у обеих
    // площадок, и цена ошибки одинаковая — снятие игры.
    gestureWindowMs: 1500,

    initTimeoutMs: 4500
  };

  /*
    События телеметрии.

    Список оставлен целиком, хотя отправлять их некуда: игра зовёт `goal()` в
    полутора десятках мест, и вырезать вызовы значит переписывать игру ради
    порта. Появится аналитика — правится один метод.
  */
  const EVENTS = {
    FIRST_RUN: 'first_run', SESSION_START: 'session_start', MENU_OPEN: 'menu_open',
    RUN_START: 'run_start', RUN_END: 'run_end', TUTORIAL_STEP: 'tutorial_step',
    TUTORIAL_DONE: 'tutorial_done', RETURN_DAY: 'return_day',
    REWARDED_OFFER: 'rewarded_offer', REWARDED_CLICK: 'rewarded_click',
    REWARDED_DONE: 'rewarded_done', INTERSTITIAL: 'interstitial',
    PURCHASE: 'purchase', UNLOCK: 'unlock', LEVEL_UP: 'level_up',
    LEADERBOARD_OPEN: 'leaderboard_open'
  };

  const русский = t => /^(ru|be|uk|kk)/.test(t);

  const Platform = {
    sdk: null,
    language: 'ru',
    EVENTS,

    _ready: false,
    _loadingSent: false,
    _adActive: false,
    _playing: false,
    _lastInterstitial: 0,
    _lastGestureAt: 0,
    _once: new Set(),

    /**
     * Подъём площадки. Не падает и не ждёт вечно: игра обязана запуститься даже
     * когда SDK недоступен — локально, в редакторе, при блокировщике.
     */
    async init(cfg) {
      Object.assign(CONFIG, cfg || {});
      this._watchGestures();
      this._detectLanguage();

      const внешний = window.CrazyGames && window.CrazyGames.SDK;
      if (!внешний) {
        console.warn('[Platform] SDK не найден — локальный режим');
        this._ready = true;
        return this;
      }
      try {
        // Инициализация асинхронная, ждать её обязательно. Потолок нужен
        // потому, что зависший SDK иначе оставит игрока на экране загрузки.
        await Promise.race([
          внешний.init(),
          new Promise((_, нет) => setTimeout(() => нет(new Error('init timeout')), CONFIG.initTimeoutMs))
        ]);
        this.sdk = внешний;
        this._detectLanguage();
        try { внешний.game.loadingStart(); } catch (_) {}
        this._watchMute();
      } catch (e) {
        console.warn('[Platform] SDK не поднялся:', e && e.message);
      }
      this._ready = true;
      return this;
    },

    /*
      Кнопка звука на стороне площадки.

      У неё своя кнопка над игрой, и её значение обязано перебивать наш
      внутриигровой переключатель: игрок выключил звук на сайте — значит звука
      нет. Читаем текущее состояние сразу и подписываемся на изменения; звук
      глушит `audio.js` по событию, платформенный слой сам ничего не трогает.

      Отдельная галочка в форме подачи заявляет ровно это умение, и ставить её
      без реализации нельзя: проверяющий нажмёт кнопку и услышит игру.
    */
    _watchMute() {
      const применить = () => {
        let выкл = false;
        try { выкл = !!(this.sdk && this.sdk.game.settings && this.sdk.game.settings.muteAudio); } catch (_) {}
        window.dispatchEvent(new CustomEvent('platform-mute', { detail: { muted: выкл } }));
      };
      применить();
      try { this.sdk.game.addSettingsChangeListener(применить); } catch (_) {}
    },

    /*
      Действие игрока. Слушаем в фазе перехвата и на всём документе: реклама
      разрешена только следом за касанием, и знать о нём нужно раньше, чем
      сработает обработчик кнопки.
    */
    _watchGestures() {
      const отметить = () => { this._lastGestureAt = Date.now(); };
      for (const тип of ['pointerdown', 'mousedown', 'touchstart', 'keydown']) {
        document.addEventListener(тип, отметить, { capture: true, passive: true });
      }
    },

    // ── язык ──────────────────────────────────────────────────────────────

    _detectLanguage() {
      const сохранён = this.load('lang', null);
      if (сохранён === 'ru' || сохранён === 'en') { this.language = сохранён; return; }
      // SDK v3 locale; unsupported or absent locale falls back to English.
      this.language = русский(String(this.sdk?.user?.systemInfo?.locale || 'en').toLowerCase()) ? 'ru' : 'en';
    },

    getLanguage() { return this.language; },

    setLanguage(language) {
      this.language = language === 'ru' ? 'ru' : 'en';
      this.save('lang', this.language);
      window.dispatchEvent(new CustomEvent('platform-language'));
    },

    // ── жизненный цикл ────────────────────────────────────────────────────

    /**
     * Загрузка кончилась. Зовётся, только когда играть действительно можно:
     * ассеты, шрифты и первая сцена готовы. Ранний вызов портит площадке замер
     * времени загрузки, то есть врёт про игру.
     */
    loadingReady() {
      if (this._loadingSent) return;
      this._loadingSent = true;
      try { if (this.sdk) this.sdk.game.loadingStop(); } catch (_) {}
    },

    gameplayStart() {
      this._playing = true;
      try { if (this.sdk) this.sdk.game.gameplayStart(); } catch (_) {}
    },

    gameplayStop() {
      this._playing = false;
      try { if (this.sdk) this.sdk.game.gameplayStop(); } catch (_) {}
    },

    isPlaying() { return this._playing; },

    /** Праздник на сайте площадки. Только на настоящем достижении — иначе обесценится. */
    happytime() {
      try { if (this.sdk) this.sdk.game.happytime(); } catch (_) {}
    },

    // ── реклама ───────────────────────────────────────────────────────────

    _setAdState(paused) {
      window.dispatchEvent(new CustomEvent('platform-ad-state', { detail: { paused: !!paused } }));
    },

    _beginAd() {
      this._adActive = true;
      this.gameplayStop();
      // Звук глушит подписчик в audio.js. Требование площадки прямое:
      // «отключить звук и поставить игру на паузу при adStarted».
      this._setAdState(true);
    },

    _endAd() {
      this._adActive = false;
      this._setAdState(false);
      if (this._playing) this.gameplayStart();
    },

    _afterPlayerAction() {
      return Date.now() - this._lastGestureAt <= CONFIG.gestureWindowMs;
    },

    /**
     * Полноэкранная. Отказывает по тем же четырём причинам, что и на прежней
     * площадке: место не в списке, идёт другая реклама, не прошёл кулдаун, не
     * было действия игрока. Отказ шумит в консоли намеренно — молчаливый
     * выглядит как «реклама не работает», и его чинят, сняв проверку.
     */
    showInterstitial(placement, onClosed) {
      if (CONFIG.launchStage !== 'full') { onClosed?.(false); return; }
      const отказ = причина => {
        console.warn('[Platform] interstitial denied:', причина, '| placement:', placement);
        if (onClosed) onClosed(false);
      };

      if (!CONFIG.interstitialPlacements.includes(placement)) return отказ('placement not allowed');
      if (this._adActive) return отказ('another ad is running');
      if (Date.now() - this._lastInterstitial < CONFIG.interstitialCooldownMs) return отказ('cooldown');
      if (!this._afterPlayerAction()) return отказ('no player action — ads may not interrupt gameplay');
      if (!this.sdk) return отказ('SDK unavailable');

      let начиналась = false;
      const конец = показана => {
        if (!this._adActive) return;
        if (показана || начиналась) this._lastInterstitial = Date.now();
        this._endAd();
        if (onClosed) onClosed(!!показана);
      };

      this._beginAd();
      try {
        this.sdk.ad.requestAd('midgame', {
          adStarted: () => { начиналась = true; },
          adFinished: () => конец(true),
          // Отказ площадки штатен: блокировщик, нет заполнения, свой кулдаун.
          // Это не ошибка игры, и игрок ничего не должен заметить.
          adError: () => конец(false)
        });
      } catch (_) { конец(false); }
    },

    hasRewarded() { return CONFIG.launchStage === 'full' && !!this.sdk; },

    /**
     * Награда выдаётся ТОЛЬКО из adFinished и ровно один раз: отказ, закрытие и
     * блокировщик награды не дают. Требование обеих площадок и просто честность
     * по отношению к тому, кто рекламу оплатил.
     */
    showRewarded(onRewarded, onClosed) {
      if (this._adActive || !this.hasRewarded()) { if (onClosed) onClosed(false); return; }

      let выдана = false;
      const конец = ок => {
        if (!this._adActive) return;
        this._endAd();
        if (onClosed) onClosed(!!ок && выдана);
      };

      this._beginAd();
      try {
        this.sdk.ad.requestAd('rewarded', {
          adStarted: () => {},
          adFinished: () => {
            if (!выдана) { выдана = true; if (onRewarded) onRewarded(); }
            конец(true);
          },
          adError: () => конец(false)
        });
      } catch (_) { конец(false); }
    },

    // ── сохранения ────────────────────────────────────────────────────────

    _key(key) { return CONFIG.id + (this.debug?'_debug_':'_') + key; },

    /*
      Хранилище площадки синхронное и само переносит гостевой прогресс в
      аккаунт при входе — облачного слияния, как у Яндекса, тут нет и не нужно.
      `localStorage` остаётся вторым слоем: он работает и в локальном режиме, и
      когда модуль данных выключен в настройках игры на площадке.
    */
    save(key, value) {
      const k = this._key(key);
      const строкой = JSON.stringify(value);
      try { localStorage.setItem(k, строкой); } catch (_) {}
      try { if (this.sdk) this.sdk.data.setItem(k, строкой); } catch (_) {}
    },

    load(key, fallback) {
      const k = this._key(key);
      let сырое = null;
      try { if (this.sdk) сырое = this.sdk.data.getItem(k); } catch (_) {}
      if (сырое === null || сырое === undefined) {
        try { сырое = localStorage.getItem(k); } catch (_) {}
      }
      if (сырое === null || сырое === undefined) return fallback;
      try { return JSON.parse(сырое); } catch (_) { return fallback; }
    },

    /** Рекорд берётся максимумом: два хранилища могут разойтись. */
    saveBest(key, value) {
      const лучший = Math.max(Number(value) || 0, Number(this.load(key, 0)) || 0);
      this.save(key, лучший);
      return лучший;
    },

    // ── лидерборд, которого нет ───────────────────────────────────────────

    hasLeaderboard() { return false; },
    submitScore() { return Promise.resolve(false); },
    getLeaderboard() { return Promise.resolve(null); },

    // ── телеметрия ────────────────────────────────────────────────────────

    goal(name, params) {
      if (!name) return;
      // Отправлять некуда. В отладке видно, что событие дошло бы, — этого
      // достаточно, чтобы не потерять разметку событий при следующем порте.
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        const event = { name, ...params, build: 'resident-devices-v32', at: Date.now(),
          session: this._traceSession || (this._traceSession = Date.now().toString(36)) };
        if (!this._trace) {
          try { this._trace = JSON.parse(sessionStorage.getItem('echo-playtest-v1') || '[]'); } catch (_) { this._trace = []; }
          if (!Array.isArray(this._trace)) this._trace = [];
        }
        this._trace.push(event);
        if (this._trace.length > 600) this._trace.shift();
        try { sessionStorage.setItem('echo-playtest-v1', JSON.stringify(this._trace)); } catch (_) {}
        console.info('[goal]', name, params || '');
      }
    },

    exportPlaytest() {
      try { return JSON.parse(sessionStorage.getItem('echo-playtest-v1') || '[]'); } catch (_) { return []; }
    },

    goalOnce(name, params) {
      if (this._once.has(name)) return;
      this._once.add(name);
      this.goal(name, params);
    }
  };

  Platform.debug=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)&&new URLSearchParams(location.search).get('debug')==='1';
  window.Platform = Platform;
})();
