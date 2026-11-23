// Все экраны и связка «игра ↔ платформа ↔ кошелёк».
// Правила, которые здесь соблюдаются:
//  - rewarded-кнопки только с маркером 📺 (i18n.rewardedLabel) и только если
//    реклама реально доступна (Platform.isRewardedAvailable);
//  - interstitial ПОСЛЕ показа результата матча (placement 'match_result');
//  - пауза всегда «ПАУЗА» + «Продолжить»; недоступные фичи скрыты, не заглушены.
import { Platform } from './platform.js';
import { Sound } from './audio.js';
import { Wallet, matchReward, Daily, dailyTask, DAILY_BONUS, AdBonus, AD_BONUS, CONSOLATION } from './economy.js';
import { SKINS, HOOK_SKINS, skinById, customSkin, CUSTOM_ID, CUSTOM_PRICE } from './skins.js';
import { skinPreview, hookPreview, disposePreviews } from './preview.js';
import { BOT_LEVELS } from './bot.js';

// Экраны, на которых играет меню-трек. pause/round/match сюда не входят:
// это оверлеи поверх идущего матча, музыку они переключать не должны.
const MENU_MUSIC_SCREENS = new Set(['menu', 'levels', 'shop', 'settings', 'howto', 'leaders']);
import { t, setLang, getLang, rewardedLabel, gameTitle } from './i18n.js';
import { MobileControls, IS_TOUCH } from './mobile.js';
import { T } from './tuning.js';

const $ = (id) => document.getElementById(id);

/**
 * Монета рисуется SVG, а не эмодзи 🪙: эмодзи берётся из системного шрифта и на
 * Windows, Android и iOS выглядит по-разному — та же болезнь, что была у глифов
 * способностей. Цвет наследуется от текста, поэтому монета всегда в тон подписи.
 */
const COIN = '<svg class="coin-i" viewBox="0 0 16 16" aria-hidden="true">'
  + '<rect x="5" y="1" width="6" height="14"/><rect x="3" y="3" width="10" height="10"/>'
  + '<rect x="1" y="5" width="14" height="6"/>'
  + '<rect class="coin-face" x="6" y="6" width="4" height="4"/></svg>';

/** Имена игроков в таблице лидеров приходят извне — в innerHTML только экранированными. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export class UI {
  constructor(game) {
    this.game = game;
    this.settings = { muted: false, aimMode: 'drag' };
    this.levelIndex = 0;
    this.usedCooldownReset = false;   // rewarded «сброс кулдаунов» — раз за матч
    this.usedDouble = false;          // rewarded «удвоить» — раз за экран результата
    this.usedConsolation = false;     // rewarded «утешение» — раз за проигранный матч
    this.screens = ['menu', 'levels', 'shop', 'settings', 'howto', 'pause', 'round', 'match', 'leaders'];
    this.lbAvailable = false;         // кнопка «Лидеры» скрыта, пока таблица недоступна
    this.stats = { totalWins: 0 };

    this.mobile = new MobileControls({
      input: game.input,
      settings: this.settings,
      getFighters: () => game.sim?.fighters ?? [],
      setAimVisible: (v) => { game.aimVisible = v; },
    });
  }

  async init() {
    const saved = await Platform.loadPlayer('settings', null);
    if (saved) Object.assign(this.settings, saved);
    Sound.setMuted(this.settings.muted);

    // звук глушится на время любой рекламы и возвращается ровно один раз (п. 4.7)
    Platform.configure({
      onAdOpen: () => { this._adActive = true; Sound.block('ad', true); this._requestPause(); },
      onAdClose: () => { this._adActive = false; Sound.block('ad', false); },
    });

    this.stats = await Platform.loadPlayer('stats', { totalWins: 0 });
    this.lbAvailable = await Platform.isLeaderboardAvailable();
    this._myId = Platform.playerId();

    this._wireGame();
    this._wireKeys();
    $('pause-button').addEventListener('click', () => this._requestPause());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this._requestPause(); });
    addEventListener('blur', () => this._requestPause());
    addEventListener('platform-pause', e => { this._sdkPaused = e.detail; if (e.detail) this._requestPause(); });
    this.refreshTexts();
    this.show('menu');
  }

  saveSettings() { Platform.savePlayer('settings', this.settings); }

  /* ------------------------------------------------------------- навигация */

  show(name) {
    // GL-контекст превью нужен только внутри магазина — отпускаем при уходе
    if (this.current === 'shop' && name !== 'shop') disposePreviews();
    for (const s of this.screens) $(`screen-${s}`)?.classList.toggle('hidden', s !== name);
    $('hud').classList.toggle('hidden', name !== null);
    this.current = name;
    // Экраны матча (pause, round, match) музыку не переключают: игрок всё ещё в бою.
    if (MENU_MUSIC_SCREENS.has(name)) Sound.music('menu');
    if (name) this['_' + name]?.();
    const training = $('training-guide');
    if (training) training.hidden = name !== null || !this.game.training;
  }

  hideAll() {
    for (const s of this.screens) $(`screen-${s}`)?.classList.add('hidden');
    this.current = null;
  }

  toast(text) {
    const node = $('toast');
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => node.classList.remove('show'), 1800);
  }

  refreshTexts() {
    document.title = gameTitle();
    $('hp-me-label').textContent = t('you');
    $('hp-foe-label').textContent = t('rival');
    $('hint').textContent = IS_TOUCH ? t('controlsTouch') : t('controlsDesktop');
    // подписи клавиш на кнопках способностей тоже локализуются: раньше «ЛКМ/ПКМ»
    // были зашиты в разметку и оставались кириллицей в английской версии (п. 8.2.3)
    $('key-hook').textContent = t('keyHook');
    $('key-dash').textContent = t('keyDash');
    $('key-trap').textContent = t('keyTrap');
    $('pause-button').setAttribute('aria-label', t('pause'));
  }

  /* ------------------------------------------------------------ связь с игрой */

  _wireGame() {
    const g = this.game;

    g.onBanner = (kind, n) => {
      if (kind === 'countdown') this._banner(String(n), 'accent', 700);
      else if (kind === 'fight') { this._banner(t('countdownFight'), 'accent', 800); Platform.gameplayStart(); }
      else if (kind === 'cooldownReset') this._banner(t('cooldownResetDone'), 'reward', 1400);
    };

    g.onRoundEnd = ({ winner, score }) => {
      Platform.gameplayStop();
      this.mobile.setEnabled(false);
      this._roundResult = { winner, score };
      this.show('round');
    };

    g.onMatchEnd = async (result) => {
      Platform.gameplayStop();
      this.mobile.setEnabled(false);
      this._matchResult = result;
      this.usedDouble = false;
      this.usedConsolation = false;

      const level = BOT_LEVELS[result.levelIndex];
      this._reward = matchReward({ ...result, coinMult: level.coinMult });
      if (this._reward.total > 0) {
        await Wallet.add(this._reward.total);
        Sound.coin();
      }
      if (result.playerWon) this._submitWins();
      if (result.playerWon) {
        this.stats.defeated ||= [];
        if (!this.stats.defeated.includes(result.levelIndex)) {
          this.stats.defeated.push(result.levelIndex);
          await Wallet.add(60);
          this._firstClear = true;
          Platform.savePlayer('stats', this.stats);
        } else this._firstClear = false;
      } else this._firstClear = false;
      this.show('match');
      // Рекламу здесь НЕ показываем: п. 4.4 в трактовке модерации требует
      // пользовательского действия, автопоказ на экране результата — причина
      // отказа у соседнего проекта. Показ висит на кнопках экрана результата.
    };
  }

  async _submitWins() {
    const stats = this.stats ?? await Platform.loadPlayer('stats', { totalWins: 0 });
    stats.totalWins = (stats.totalWins || 0) + 1;
    this.stats = stats;                       // меню показывает счётчик без перезагрузки
    await Platform.savePlayer('stats', stats);
    const { CONFIG } = await import('./config.js');
    Platform.submitScore({ board: CONFIG.leaderboard, score: stats.totalWins });
  }

  _banner(text, cls, ms) {
    const b = $('banner');
    b.textContent = text;
    b.className = `show ${cls}`;
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => { b.className = cls; }, ms);
  }

  _wireKeys() {
    addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (this.current === 'pause') this._resumeFromPause();
      else if (this.game.phase === 'play' || this.game.phase === 'countdown') {
        this._requestPause();
      }
    });
  }

  _startMatch(levelIndex) {
    if (Platform.isPaused()) return;
    Sound.music('game');
    this.levelIndex = levelIndex;
    this.usedCooldownReset = false;
    this.hideAll();
    $('hud').classList.remove('hidden');
    this.refreshTexts();
    this.game.startMatch(levelIndex, Wallet.data.equipped, Wallet.data.hook, Wallet.data.hues);
    this.mobile.setEnabled(true);
  }

  _resumeFromPause() {
    if (document.hidden || this._adActive || this._sdkPaused || Platform.isPaused()) return;
    this.hideAll();
    $('hud').classList.remove('hidden');
    this.game.resume();
    this.mobile.setEnabled(true);
    Sound.block('manual', false);
    if (this.game.phase === 'play') Platform.gameplayStart();
    if (this.game.training) $('training-guide').hidden = false;
  }

  _requestPause() {
    if (!['play', 'countdown', 'paused'].includes(this.game.phase)) return;
    this.game.pause(); this.mobile.setEnabled(false);
    Platform.gameplayStop(); Sound.block('manual', true); this.show('pause');
  }

  /* ---------------------------------------------------------------- экраны */

  _btn(label, cls, onClick) {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', async () => {
      if (b.disabled || this._adActive) return;
      b.disabled = true;
      try { Sound.unlock(); Sound.click(); await onClick(); }
      finally { b.disabled = false; }
    });
    return b;
  }

  _menu() {
    Sound.block('manual', false);
    Platform.gameplayStop();
    const root = $('screen-menu');
    root.innerHTML = '';
    // Эмблема без текста, название — живой текст: так оно переключается вместе
    // с языком, а не остаётся русским в англоязычной версии (п. 8.2.3)
    const emblem = document.createElement('img');
    emblem.className = 'emblem';
    emblem.src = 'assets/ui/emblem.png';
    emblem.alt = '';
    root.append(emblem);

    const logo = document.createElement('div');
    logo.className = 'logo';
    logo.innerHTML = `${t('logo')}<b>${t('logoSub')}</b>`;
    root.append(logo);

    const coins = document.createElement('div');
    coins.className = 'sub';
    const wins = this.stats?.totalWins || 0;
    coins.innerHTML = `${t('coins')}: <span class="coins">${COIN} ${Wallet.data.coins}</span>`
      + (wins > 0 ? ` · ${t('statsWins')}: <span class="coins">${wins}</span>` : '');
    root.append(coins);

    // испытание дня: причина заглянуть завтра. Выполненное не прячем —
    // видно, что засчитано, и до следующего дня повторно не начислится
    const task = dailyTask();
    const done = Daily.isDone();
    const card = document.createElement('div');
    card.className = 'card pick static';
    card.style.maxWidth = '460px';
    card.innerHTML = `
      <div>
        <div class="name">${t('dailyTitle')}</div>
        <div class="desc">${t('task' + task.id[0].toUpperCase() + task.id.slice(1))}</div>
      </div>
      <span class="${done ? 'stars' : 'coins'}">${done ? '✓ ' + t('dailyDone') : `${COIN} +${DAILY_BONUS}`}</span>`;
    root.append(card);

    // Бонус дня за просмотр: ещё один повод зайти завтра. Кнопки нет, если
    // реклама недоступна или бонус уже забран — не показываем заглушенное.
    // Держим его рядом с карточкой испытания дня: это единый ежедневный блок,
    // а основное действие «Играть» идёт сразу после него.
    if (AdBonus.isReady() && Platform.isRewardedAvailable()) {
      const bonusBtn = this._btn(rewardedLabel(t('adBonus', { n: AD_BONUS })), 'reward', async () => {
        const { rewarded } = await Platform.showRewardedAd();
        if (rewarded) {
          await AdBonus.take();
          await Wallet.add(AD_BONUS);
          Sound.coin();
          this.toast(t('bought'));
          this._menu();
        } else this.toast(t('adUnavailable'));
      });
      root.append(bonusBtn);
    }

    root.append(this._btn(t('play'), 'primary', () => this.show('levels')));
    root.append(this._btn(getLang() === 'ru' ? 'Тренировка' : 'Practice', '', () => this._training()));

    // недоступные фичи скрываем, а не глушим
    if (this.lbAvailable) root.append(this._btn(t('leaders'), '', () => this.show('leaders')));
    root.append(this._btn(t('shop'), '', () => this.show('shop')));
    root.append(this._btn(t('howto'), '', () => this.show('howto')));
    root.append(this._btn(t('settings'), '', () => this.show('settings')));
  }

  /**
   * Таблица лидеров. Счёт — выигранные матчи (CONFIG.leaderboard).
   * Экран собирается сразу, список догружается: сеть может отвечать долго,
   * и «Назад» должна работать всё это время. Имя может быть пустым, если игрок
   * не открыл профиль — тогда показываем нейтральное «Игрок», без домыслов.
   */
  async _leaders() {
    const root = $('screen-leaders');
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = t('leadersTitle');
    root.append(h);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = t('leadersHint');
    root.append(sub);

    const list = document.createElement('div');
    list.style.width = '100%';
    list.style.maxWidth = '460px';
    const status = document.createElement('div');
    status.className = 'sub';
    status.textContent = t('leadersLoading');
    list.append(status);
    root.append(list);
    root.append(this._btn(t('back'), '', () => this.show('menu')));

    const { CONFIG } = await import('./config.js');
    const entries = await Platform.getLeaderboard({ board: CONFIG.leaderboard, limit: 10 });
    if (this.current !== 'leaders') return;        // игрок уже ушёл — не трогаем DOM

    list.innerHTML = '';
    if (entries === null) { status.textContent = t('leadersUnavailable'); list.append(status); return; }
    if (!entries.length) { status.textContent = t('leadersEmpty'); list.append(status); return; }

    for (const e of entries) {
      const row = document.createElement('div');
      row.className = 'card pick static' + (e.player?.uniqueID && e.player.uniqueID === this._myId ? ' me' : '');
      const name = (e.player?.publicName || '').trim() || t('leadersAnon');
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; min-width:0">
          <span class="rank">${e.rank}</span>
          <span class="name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(name)}</span>
        </div>
        <span class="stars">${Number(e.score) || 0}</span>`;
      list.append(row);
    }
  }

  _training() {
    if (Platform.isPaused()) return;
    this.hideAll(); $('hud').classList.remove('hidden');
    let guide = $('training-guide');
    if (!guide) { guide = document.createElement('div'); guide.id = 'training-guide'; document.body.append(guide); }
    const ru = getLang() === 'ru';
    const messages = ru ? [
      '1/5 · Пройди немного по льду: WASD или левый стик.',
      '2/5 · Попади багром в оранжевую цель: ЛКМ или кнопка багра.',
      '3/5 · Брось багор в торос прямо перед тобой — он притянет тебя.',
      '4/5 · Укажи направление и сделай рывок: ПКМ / пробел или кнопка стрелки.',
      '5/5 · Поставь ледяную ловушку: Q или кнопка снежинки.'
    ] : [
      '1/5 · Move across the ice: WASD or the left stick.',
      '2/5 · Hook the orange target: left click or the hook button.',
      '3/5 · Hook the ice ridge ahead to pull yourself towards it.',
      '4/5 · Aim and dash: right click / Space or the arrow button.',
      '5/5 · Place an ice trap: Q or the snowflake button.'
    ];
    this.game.startTraining(step => { guide.textContent = messages[step]; guide.hidden = false; }, () => {
      this.game.abandonMatch(); this.mobile.setEnabled(false); guide.hidden = true;
      this.settings.trained = true; this.saveSettings(); this.show('levels');
      Platform.gameplayStop(); this.toast(ru ? 'Готово! Теперь попробуй дуэль с Юнгой.' : 'Ready! Try a duel with the Deckhand.');
    });
    Sound.block('manual', false); Sound.music('game');
    this.mobile.setEnabled(true); Platform.gameplayStart();
  }

  _levels() {
    const root = $('screen-levels');
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = t('chooseRival');
    root.append(h);
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = `${t('rivalHint')} · ${t('matchTo', { n: T.match.winsToTake })}`;
    root.append(sub);

    BOT_LEVELS.forEach((L, i) => {
      const card = document.createElement('div');
      card.className = 'card pick';
      // портрет декоративен — имя стоит рядом, поэтому alt пустой
      card.innerHTML = `
        <img class="portrait" src="assets/ui/rival_${L.id}.jpg" alt="">
        <div class="who">
          <div class="name">${L.name[getLang()]}${this.stats.defeated?.includes(i) ? ' ✓' : ''}</div>
          <div class="desc">${t('reward')}: <span class="coins">${COIN} ×${L.coinMult}</span>${!this.stats.defeated?.includes(i) ? (getLang() === 'ru' ? ' · Первая победа +60' : ' · First victory +60') : ''}</div>
        </div>
        <div class="stars">${'★'.repeat(L.id)}${'☆'.repeat(5 - L.id)}</div>`;
      card.addEventListener('click', () => { Sound.click(); this._startMatch(i); });
      root.append(card);
    });

    root.append(this._btn(t('back'), 'ghost', () => this.show('menu')));
  }

  _shop() {
    const root = $('screen-shop');
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = t('shop');
    root.append(h);

    const coins = document.createElement('div');
    coins.className = 'sub';
    coins.innerHTML = `${t('coins')}: <span class="coins">${COIN} ${Wallet.data.coins}</span>`;
    root.append(coins);

    // Два слота: облик бойца и облик багра. Они независимы, поэтому монеты есть
    // куда тратить и после выкупа одежды.
    const section = (title) => {
      const s = document.createElement('div');
      s.className = 'sub section';
      s.textContent = title;
      root.append(s);
    };

    const row = ({ img, name, state, onPick, sel }) => {
      const card = document.createElement('div');
      card.className = `card pick${sel ? ' sel' : ''}`;
      // превью — настоящая модель, отрисованная движком (js/preview.js)
      card.innerHTML = `
        <img class="portrait skin" src="${img}" alt="">
        <div class="who"><div class="name">${name}</div>
        <div class="desc">${state}</div></div>`;
      card.addEventListener('click', () => { Sound.click(); onPick(); });
      root.append(card);
      return card;
    };

    section(t('shopFighter'));
    for (const skin of SKINS) {
      const owned = Wallet.owns(skin.id);
      const equipped = Wallet.data.equipped === skin.id;
      row({
        img: skinPreview(skin), name: skin.name[getLang()], sel: equipped,
        state: equipped ? t('skinEquipped') : owned ? t('skinOwned') : `${COIN} ${skin.price}`,
        onPick: () => {
          if (equipped) return;
          if (owned) Wallet.equip(skin.id);
          else if (Wallet.buy(skin.id)) { Sound.coin(); this.toast(t('bought')); }
          else { this.toast(t('notEnough')); return this._shop(); }
          this._shop();
        },
      });
    }

    // «Свой цвет»: платный слот, дальше игрок сам крутит три тона
    {
      const owned = Wallet.owns(CUSTOM_ID);
      const equipped = Wallet.data.equipped === CUSTOM_ID;
      const skin = customSkin(Wallet.data.hues);
      const card = row({
        img: skinPreview(skin), name: skin.name[getLang()], sel: equipped,
        state: equipped ? t('skinEquipped') : owned ? t('skinOwned') : `${COIN} ${CUSTOM_PRICE}`,
        onPick: () => {
          if (equipped) return;
          if (owned) Wallet.equip(CUSTOM_ID);
          else if (Wallet.buy(CUSTOM_ID)) { Sound.coin(); this.toast(t('bought')); }
          else { this.toast(t('notEnough')); return this._shop(); }
          this._shop();
        },
      });

      if (owned) {
        const box = document.createElement('div');
        box.className = 'card hues';
        const labels = [t('hueCoat'), t('hueHat'), t('hueAccent')];
        box.innerHTML = labels.map((l, i) => `
          <label class="huerow">
            <span>${l}</span>
            <input type="range" min="0" max="359" value="${Wallet.data.hues[i]}" data-h="${i}">
          </label>`).join('');
        // тянем ползунок — перерисовываем превью, отпускаем — сохраняем в кошелёк
        const apply = (save) => {
          const hues = [...box.querySelectorAll('input')].map((el) => Number(el.value));
          Wallet.data.hues = hues;
          if (save) Wallet.setHues(hues);
          card.querySelector('.portrait').src = skinPreview(customSkin(hues), true);
        };
        box.addEventListener('input', () => apply(false));
        box.addEventListener('change', () => { apply(true); Sound.click(); });
        root.append(box);
      }
    }

    section(t('shopGaff'));
    for (const skin of HOOK_SKINS) {
      const owned = Wallet.ownsHook(skin.id);
      const equipped = Wallet.data.hook === skin.id;
      row({
        img: hookPreview(skin), name: skin.name[getLang()], sel: equipped,
        state: equipped ? t('skinEquipped') : owned ? t('skinOwned') : `${COIN} ${skin.price}`,
        onPick: () => {
          if (equipped) return;
          if (owned) Wallet.equipHook(skin.id);
          else if (Wallet.buyHook(skin.id)) { Sound.coin(); this.toast(t('bought')); }
          else { this.toast(t('notEnough')); return this._shop(); }
          this._shop();
        },
      });
    }

    root.append(this._btn(t('back'), 'ghost', () => this.show('menu')));
  }

  _settings() {
    const root = $('screen-settings');
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = t('settings');
    root.append(h);

    const rows = document.createElement('div');
    rows.className = 'card';
    root.append(rows);

    const addRow = (label, valueLabel, onClick) => {
      const row = document.createElement('div');
      row.className = 'rowline';
      row.innerHTML = `<span>${label}</span>`;
      const b = this._btn(valueLabel, 'ghost', onClick);
      b.style.minWidth = '150px';
      row.append(b);
      rows.append(row);
    };

    addRow(t('sound'), this.settings.muted ? t('off') : t('on'), () => {
      this.settings.muted = !this.settings.muted;
      Sound.setMuted(this.settings.muted);
      this.saveSettings();
      this._settings();
    });

    addRow(t('language'), getLang() === 'ru' ? 'Русский' : 'English', () => {
      const next = getLang() === 'ru' ? 'en' : 'ru';
      setLang(next);
      try { localStorage.setItem('bagor.langOverride', next); } catch { /* приватный режим */ }
      this.refreshTexts();
      this._settings();
    });

    if (IS_TOUCH) {
      addRow(t('aimMode'), this.settings.aimMode === 'drag' ? t('aimModeDrag') : t('aimModeTap'), () => {
        this.settings.aimMode = this.settings.aimMode === 'drag' ? 'tap' : 'drag';
        this.saveSettings();
        this._settings();
      });
      const hint = document.createElement('div');
      hint.className = 'sub';
      hint.textContent = this.settings.aimMode === 'drag' ? t('aimModeDragHint') : t('aimModeTapHint');
      root.append(hint);
    }

    root.append(this._btn(t('back'), 'ghost', () => this.show('menu')));
  }

  _howto() {
    const root = $('screen-howto');
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = t('howto');
    root.append(h);

    const items = [
      ['⚓', 'hookName', 'hookDesc'],
      ['»', 'dashName', 'dashDesc'],
      ['❄', 'trapName', 'trapDesc'],
      ['✦', 'finishName', 'finishDesc'],
      ['◉', 'holeName', 'holeDesc'],
      ['〜', 'iceName', 'iceDesc'],
    ];
    for (const [glyph, nameKey, descKey] of items) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="name">${glyph} ${t(nameKey)}</div><div class="desc">${t(descKey)}</div>`;
      root.append(card);
    }

    const controls = document.createElement('div');
    controls.className = 'sub';
    controls.textContent = IS_TOUCH ? t('controlsTouch') : t('controlsDesktop');
    root.append(controls);

    root.append(this._btn(t('back'), 'ghost', () => this.show('menu')));
  }

  _pause() {
    const root = $('screen-pause');
    root.innerHTML = '';
    const h = document.createElement('h2');
    h.textContent = t('pause');
    root.append(h);
    root.append(this._btn(t('resume'), 'primary', () => this._resumeFromPause()));
    root.append(this._btn(t('quitMatch'), '', () => {
      this.game.abandonMatch();
      Platform.gameplayStop();
      this.show('menu');
    }));
  }

  _round() {
    const root = $('screen-round');
    root.innerHTML = '';
    const { winner, score } = this._roundResult;
    const h = document.createElement('h2');
    h.textContent = winner === 0 ? t('roundWin') : winner === 1 ? t('roundLose') : t('roundDraw');
    h.style.color = winner === 0 ? 'var(--accent)' : winner === 1 ? 'var(--accent2)' : 'var(--text)';
    root.append(h);

    const sc = document.createElement('div');
    sc.className = 'logo';
    sc.style.fontSize = 'clamp(40px, 9vw, 72px)';
    sc.innerHTML = `<span style="color:var(--accent)">${score[0]}</span> : <span style="color:var(--accent2)">${score[1]}</span>`;
    root.append(sc);

    // Every round starts with ready abilities: no paid reset of an already-zero timer.

    root.append(this._btn(t('nextRound'), 'primary', () => {
      this.hideAll();
      $('hud').classList.remove('hidden');
      this.game.startRound();
      this.mobile.setEnabled(true);
    }));
  }

  _match() {
    const root = $('screen-match');
    root.innerHTML = '';
    const { playerWon, score, levelIndex } = this._matchResult;

    const h = document.createElement('h2');
    h.textContent = playerWon ? t('matchWin') : t('matchLose');
    h.style.color = playerWon ? 'var(--accent)' : 'var(--accent2)';
    h.style.fontSize = 'clamp(34px, 8vw, 56px)';
    root.append(h);
    if (this._firstClear) {
      const reward = document.createElement('p');
      reward.className = 'coins';
      reward.textContent = getLang() === 'ru' ? 'Новый соперник побеждён: +60 монет' : 'New rival defeated: +60 coins';
      root.append(reward);
    }

    // портрет соперника: видно, кого именно одолел (или кому проиграл)
    const foe = document.createElement('div');
    foe.className = 'foecard';
    foe.innerHTML = `
      <img class="portrait" src="assets/ui/rival_${BOT_LEVELS[levelIndex].id}.jpg" alt="">
      <div>
        <div class="name">${BOT_LEVELS[levelIndex].name[getLang()]}</div>
        <div class="desc">${t('score')}: ${score[0]} : ${score[1]}</div>
      </div>`;
    root.append(foe);

    if (playerWon && this._reward.total > 0) {
      const box = document.createElement('div');
      box.className = 'card';
      let html = '';
      for (const line of this._reward.lines) {
        const label = t(line.key) + (line.mult ? ` ×${line.mult}` : '') + (line.x2 ? ' ×2' : '');
        html += `<div class="rowline"><span>${label}</span><span class="coins">+${line.value}</span></div>`;
      }
      html += `<div class="rowline total"><span>${t('rewardTotal')}</span><span class="coins" id="reward-total">${COIN} ${this._reward.total}</span></div>`;
      box.innerHTML = html;
      root.append(box);

      if (!this.usedDouble && Platform.isRewardedAvailable()) {
        const doubleBtn = this._btn(rewardedLabel(t('doubleCoins')), 'reward', async () => {
          const { rewarded } = await Platform.showRewardedAd();
          if (rewarded) {
            this.usedDouble = true;
            await Wallet.add(this._reward.total);
            $('reward-total').innerHTML = `${COIN} ${this._reward.total * 2}`;
            doubleBtn.remove();
            Sound.coin();
          } else this.toast(t('adUnavailable'));
        });
        root.append(doubleBtn);
      }
    }

    // Утешение за поражение: раньше проигравшему не предлагалось ничего, хотя
    // именно тут желание посмотреть рекламу максимально. Сумма меньше слабейшей
    // победы, поэтому проигрывать ради монет невыгодно.
    if (!playerWon && !this.usedConsolation && Platform.isRewardedAvailable()) {
      const consoleBtn = this._btn(rewardedLabel(t('consolation', { n: CONSOLATION })), 'reward', async () => {
        const { rewarded } = await Platform.showRewardedAd();
        if (rewarded) {
          this.usedConsolation = true;
          await Wallet.add(CONSOLATION);
          Sound.coin();
          this.toast(t('bought'));
          consoleBtn.remove();
        } else this.toast(t('adUnavailable'));
      });
      root.append(consoleBtn);
    }

    // Реклама привязана к действию игрока (п. 4.4); кулдаун и список мест — в platform.js
    root.append(this._btn(t('rematch'), 'primary', async () => {
      await Platform.showInterstitial({ placement: 'match_result' });
      this._startMatch(levelIndex);
    }));
    root.append(this._btn(t('toMenu'), '', async () => {
      await Platform.showInterstitial({ placement: 'match_result' });
      this.show('menu');
    }));
  }
}
