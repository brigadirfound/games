// Точка входа. Порядок загрузки: платформа → язык → кошелёк → UI → цикл →
// loadingReady (сигнал «играбельно» после того, как меню реально видно).
import { Game } from './game.js';
import { Sound } from './audio.js';
import { Platform } from './platform.js';
import { Wallet, Daily, AdBonus } from './economy.js';
import { setLang } from './i18n.js';
import { UI } from './ui.js';
import { T } from './tuning.js';

const canvas = document.getElementById('game-canvas');
const preFill = document.getElementById('pre-fill');
const setProgress = (p) => { preFill.style.width = `${Math.round(p * 100)}%`; };

const game = new Game(canvas);

/* HUD: данные каждый кадр */
const el = {
  hpMe: document.querySelector('#hp-me i'),
  hpFoe: document.querySelector('#hp-foe i'),
  hpMeWrap: document.getElementById('hp-me-wrap'),
  hpFoeWrap: document.getElementById('hp-foe-wrap'),
  score: document.querySelector('#score .me'),
  scoreFoe: document.querySelector('#score .foe'),
  timer: document.getElementById('timer'),
  abilities: {
    hook: document.getElementById('ability-hook'),
    dash: document.getElementById('ability-dash'),
    trap: document.getElementById('ability-trap'),
  },
};

// Полоса вспыхивает, когда здоровье убавилось: попадание должно читаться и в HUD,
// а не только по звуку — при отъезде камеры фигурки мелкие.
const lastHp = { me: null, foe: null };
const pulse = (node) => {
  node.classList.remove('hurt');
  void node.offsetWidth;           // перезапуск анимации
  node.classList.add('hurt');
};

game.onHud = (d) => {
  if (lastHp.me !== null && d.hp < lastHp.me) pulse(el.hpMeWrap);
  if (lastHp.foe !== null && d.foeHp < lastHp.foe) pulse(el.hpFoeWrap);
  lastHp.me = d.hp; lastHp.foe = d.foeHp;

  el.hpMe.style.width = `${(d.hp / d.hpMax) * 100}%`;
  el.hpFoe.style.width = `${(d.foeHp / d.foeHpMax) * 100}%`;
  el.hpFoeWrap.classList.toggle('low', d.foeLow);
  el.score.textContent = d.score[0];
  el.scoreFoe.textContent = d.score[1];
  el.timer.textContent = Math.ceil(d.time);
  for (const key of ['hook', 'dash', 'trap']) {
    const node = el.abilities[key];
    const p = Math.max(0, Math.min(1, d.cd[key]));
    node.querySelector('.cool').style.setProperty('--p', p.toFixed(3));
    node.querySelector('.cdnum').textContent = p > 0 ? Math.ceil(d.cdSec[key]) : '';
    node.classList.toggle('ready', p === 0);
  }
};

/* Кнопки способностей мышью: cast в текущую точку прицела */
for (const [key, node] of Object.entries(el.abilities)) {
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;   // тач обслуживает mobile.js
    e.preventDefault();
    game.input.cast(key);
  });
}

/* Звук создаётся по первому жесту — требование браузеров */
function unlockAudio() {
  Sound.unlock();
  removeEventListener('pointerdown', unlockAudio);
  removeEventListener('keydown', unlockAudio);
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);

/*
  Звук обязан замолкать, когда игру не видно.

  Прежний обработчик жил в game.js и ставил на паузу только бой: в меню он не
  срабатывал вовсе, а звук не глушил никогда. Модератор поймал это дважды —
  при сворачивании окна и при переходе на другую вкладку (п. 1.3).

  pagehide нужен отдельно: при уходе по ссылке и при выгрузке вкладки в фон на
  мобильных visibilitychange приходит не всегда.
*/
document.addEventListener('visibilitychange', () => {
  Sound.block('hidden', document.hidden);
});
addEventListener('pagehide', () => Sound.block('hidden', true));
addEventListener('pageshow', () => Sound.block('hidden', document.hidden));
addEventListener('blur', () => Sound.block('blur', true));
addEventListener('focus', () => Sound.block('blur', false));
addEventListener('platform-audio', e => Sound.block('sdk-mute', e.detail));
addEventListener('platform-pause', e => Sound.block('sdk', e.detail));

/*
  Страница не должна прокручиваться во время игры (п. 1.10.2).

  Одного overflow: hidden не хватило. Экраны меню объявлены overflow-y: auto, и
  когда содержимое помещается целиком, колесу нечего прокручивать — событие
  уходит выше, и прокручивается страница площадки под игрой. Именно это и
  попало на запись модератора: игра стоит на месте, а страница едет.

  Поэтому колесо и протяжку гасим всегда, кроме случая, когда указатель правда
  стоит над экраном, которому есть что прокручивать. preventDefault отменяет
  только действие браузера — стик и кнопки свои события получают по-прежнему.
*/
function scrollableUnder(node) {
  for (let el = node; el && el !== document.body; el = el.parentElement) {
    if (el.classList && el.classList.contains('screen') && el.scrollHeight > el.clientHeight + 1) return true;
  }
  return false;
}
addEventListener('wheel', (e) => { if (!scrollableUnder(e.target)) e.preventDefault(); }, { passive: false });
addEventListener('touchmove', (e) => { if (!scrollableUnder(e.target)) e.preventDefault(); }, { passive: false });

async function boot() {
  setProgress(0.2);
  await Platform.init();
  setProgress(0.5);

  // язык: SDK → браузер; ручной выбор игрока имеет приоритет после первого автоопределения
  let lang = Platform.getLanguage();
  try { lang = localStorage.getItem('bagor.langOverride') || lang; } catch { /* нет localStorage */ }
  setLang(lang);

  await Wallet.load();
  await Daily.load();
  await AdBonus.load();
  setProgress(0.75);

  const ui = new UI(game);
  await ui.init();
  setProgress(1);

  game.start();

  const pre = document.getElementById('preloader');
  pre.classList.add('done');
  setTimeout(() => pre.remove(), 400);
  requestAnimationFrame(() => requestAnimationFrame(() => Platform.loadingReady()));

  // отладочный доступ из консоли браузера
  window.__bagor = { game, ui, T, Wallet, Sound };
}

boot();
