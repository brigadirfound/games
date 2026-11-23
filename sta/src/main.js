import { Game, migrateLegacySave, hasAnySave } from './game.js';
import { Settings } from './settings.js';
import { PauseMenu } from './pausemenu.js';
import { MODELS } from './models.js';
import { CAR_BY_ID } from './vehicle.js';
import { HUD } from './hud.js';
import { Intro } from './intro.js';
import { preloadHero } from './hero-model.js';
import { preloadNpcs } from './npc-model.js';
import { preloadVehicleTextures } from './vehicle-materials.js';
import { preloadAircraft } from './aircraft-models.js';

const canvas = document.getElementById('view');
const hudRoot = document.getElementById('hud');
const startScreen = document.getElementById('start');
const startBtn = document.getElementById('start-btn');
const loadBtn = document.getElementById('load-btn');
const loading = document.getElementById('loading');
const pauseScreen = document.getElementById('pause');
const fpsEl = document.getElementById('fps');

let game = null, hud = null, intro = null, pauseMenu = null;
// Настройки читаются до создания игры: они нужны и на титульном экране.
const settings = new Settings();
let running = false;
let last = performance.now();
let frames = 0, fpsTimer = 0;


function escapeHtml(t) {
  return String(t).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Понятный экран вместо голого «Error creating WebGL context».
function showWebGLHelp(details) {
  const info = (details && details.info) || {};
  const причина = info.reason ? `<div class="why">Браузер сообщил: ${escapeHtml(info.reason)}</div>` : '';
  loading.innerHTML = `
    <b>Не удалось запустить 3D-графику</b>
    <div class="why">Игре нужен WebGL, но браузер его не выдал.
      WebGL2: <b>${info.webgl2 ? 'есть' : 'нет'}</b> ·
      WebGL1: <b>${info.webgl1 ? 'есть' : 'нет'}</b></div>
    ${причина}
    <div class="fix">Что помогает чаще всего:
      <ol>
        <li>Chrome: открой <code>chrome://settings/system</code> и включи
            «Использовать аппаратное ускорение», затем перезапусти браузер.</li>
        <li>Проверь <code>chrome://gpu</code> — строка WebGL2 должна быть
            «Hardware accelerated» или хотя бы «Software only».</li>
        <li>Firefox: в <code>about:config</code> поставь
            <code>webgl.disabled = false</code>.</li>
        <li>Открой страницу в обычном окне (не в режиме инкогнито с блокировками)
            и отключи расширения, которые ограничивают Canvas/WebGL.</li>
        <li>Если сидишь по удалённому рабочему столу или в виртуалке —
            видеоускорение там часто отключено; попробуй локальный браузер.</li>
      </ol>
    </div>
    <button id="retry-btn">ПОПРОБОВАТЬ СНОВА</button>`;
  const rb = document.getElementById('retry-btn');
  if (rb) rb.addEventListener('click', () => location.reload());
}

/**
 * Готовые .glb-модели (машины, деревья, мусор) грузятся ДО создания Game:
 * игра строит город и трафик синхронно, дожидаться моделей ей уже негде.
 * Провал загрузки — не повод падать: без моделей всё строится из боксов,
 * как раньше, поэтому глушим ошибку и просто пишем в консоль.
 */
async function loadModels() {
  try {
    const r = await fetch('./models.json');
    if (!r.ok) throw new Error('models.json: HTTP ' + r.status);
    const m = await r.json();
    // Для машин добавляем потолки по ширине и высоте из CAR_TYPES: длину
    // модель получает точную, а разлёт пропорций ограничиваем, иначе один
    // «пузатый» кузов выбивается из ряда (см. calibrate в models.js).
    const entries = [...(m.vehicles || []).filter(entry => CAR_BY_ID[entry.slot] || entry.slot === 'police' || entry.slot === 'tank'), ...(m.props || [])]
      .filter(e => !/^tree[1-6]$/.test(e.slot)) // UrbanTrees supplies the complete tree family locally.
      .map((e) => {
      const t = CAR_BY_ID[e.slot] || (e.slot === 'police' ? CAR_BY_ID.sedan : null);
      // У двухколёсных CAR_TYPES.h — высота седла, по которой физика сажает
      // водителя, а вовсе не высота силуэта: у мотоцикла есть ещё руль, а он
      // выше седла почти вдвое. Потолок 0.94 м резал модель до 1.6 м длины,
      // скутер вообще складывался до 78 см — игрушка под ногами прохожих.
      // Ширину ограничиваем как всем: вширь мотоцикл разъезжаться не должен.
      const bike = !!(t && t.bike);
      return {
        slot: e.slot, url: './' + (e.renderOut || e.out), orient: !!e.orient, fitZ: e.fitZ, fitY: e.fitY,
        maxX: t ? t.w * 1.25 : undefined,
        maxY: t ? (bike ? undefined : t.h * 1.35) : undefined,
      };
    });
    const n = await MODELS.preload(entries);
    if (MODELS.failed.length) console.warn('[models] не загрузились:', MODELS.failed);
    console.log(`[models] готово: ${n} из ${entries.length}`);
  } catch (e) {
    console.warn('[models] пропускаем, играем на боксах:', e.message);
  }
}

async function boot() {
  try {
    // Переносим старый однослотовый сейв до того, как что-либо прочитает слоты.
    migrateLegacySave();
    loading.textContent = 'Загрузка моделей…';
    await Promise.all([loadModels(), preloadVehicleTextures(), preloadAircraft()]);
    await preloadHero();
    await preloadNpcs();
    loading.textContent = 'Генерация города…';
    hud = new HUD(hudRoot);
    game = new Game(canvas, hud);
    game.settings = settings;
    settings.applyAll(game);
    pauseMenu = new PauseMenu(pauseScreen, game);
    window.__game = game;
    loading.style.display = 'none';
    document.getElementById('start-actions').style.display = 'flex';
    if (hasAnySave()) loadBtn.classList.remove('state-disabled');
    if (new URLSearchParams(location.search).has('transportTest')) {
      const { installTransportTest } = await import('./transport-test-ui.js' + new URL(import.meta.url).search);
      installTransportTest(game, () => {
        running = true; startScreen.style.display = 'none'; pauseMenu.close();
      }, () => { pauseMenu.close(); game.paused = false; beginPlay(false); });
    }
  } catch (e) {
    console.error(e);
    if (e.message === 'WEBGL_UNAVAILABLE') { showWebGLHelp(e.details); return; }
    loading.innerHTML = '<b>Ошибка запуска</b><br>' + escapeHtml(e.message)
      + '<br><span class="hint">Подробности — в консоли браузера (F12).</span>';
  }
}

function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.05) dt = 0.05;
  if (dt < 0) dt = 0;
  if (!running || !game) return;

  frames++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    fpsEl.textContent = Math.round(frames / fpsTimer) + ' FPS';
    frames = 0; fpsTimer = 0;
  }

  const input = game.input;
  if (input.actHit('pause')) togglePause();

  if (!game.paused) {
    // global hotkeys
    if (input.actHit('job') && !game.gameOver) {
      if (game.missions.sideJob) game.missions.endSideJob('Отменено');
      else {
        const inCar = !!game.player.inVehicle;
        const carJobs = ['taxi', 'courier', 'ambulance'];
        game.jobPick = game.jobPick || 0;
        game.missions.startSideJob(inCar ? carJobs[game.jobPick % carJobs.length] : 'vigilante');
      }
    }
    if (input.actHit('jobType')) { game.jobPick = (game.jobPick || 0) + 1;
      game.showMessage('ТИП ПОДРАБОТКИ: ' + ['ТАКСИ','КУРЬЕР','СКОРАЯ'][game.jobPick % 3], 1.4); }
    if (input.actHit('skipTutorial') && game.tutorial) game.tutorial.skip();
    if (input.actHit('save')) game.save();
    if (input.actHit('load')) game.load();
    if (input.actHit('mute')) {
      const on = !settings.get('sound');
      settings.set('sound', on, game);
      game.showMessage(on ? 'ЗВУК ВКЛ' : 'ЗВУК ВЫКЛ', 1);
    }
    if (input.actHit('map')) {
      // Клавиша и настройка — одно и то же: иначе выбор зума не переживёт перезапуск.
      const steps = [80, 135, 210];
      const next = steps[(steps.indexOf(settings.get('minimapZoom')) + 1) % steps.length];
      settings.set('minimapZoom', next, game);
    }

    game.update(dt);
    hud.update(game, dt);
  } else {
    game.input.endFrame();
  }
  game.render();
}

function togglePause() {
  if (!game || game.gameOver) return;
  game.paused = !game.paused;
  if (game.paused) {
    document.exitPointerLock && document.exitPointerLock();
    pauseMenu.open();
  } else {
    // Экран паузы теперь настоящее меню, а не «клик где угодно, чтобы выйти» —
    // единственный путь назад в игру - Esc/P, и он обязан вернуть управление мышью.
    pauseMenu.close();
    game.input.requestLock();
    game.audio.resume();
  }
}

function beginPlay(withLoad) {
  running = true;
  game.audio.init();
  game.audio.resume();
  if (game.radio) game.radio.init();
  game.input.requestLock();
  if (withLoad) game.load();
  last = performance.now();
}

function startGame(withLoad) {
  startScreen.style.display = 'none';
  // Ролик показываем только в новой игре: при загрузке сейва игрок уже в теме.
  if (withLoad) { beginPlay(true); return; }
  intro = new Intro(() => { intro = null; beginPlay(false); });
  // Цикл запускаем ТОЛЬКО после preload+start: иначе первый кадр видит
  // active === false и цикл умирает, не начавшись.
  intro.preload().then(() => {
    intro.start();
    let prev = performance.now();
    const tick = (now) => {
      if (!intro || !intro.active) return;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      if (game.input.hit('Escape')) { intro.skip(); game.input.endFrame(); return; }
      intro.update(dt, game.input);
      game.input.endFrame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

const creditsBtn = () => document.getElementById('credits-btn');
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'credits-btn' && game) {
    game.dismissCredits();
    game.input.requestLock();
  }
});

startBtn.addEventListener('click', () => startGame(false));
loadBtn.addEventListener('click', () => {
  if (!loadBtn.classList.contains('state-disabled')) startGame(true);
});

// «Управление» / «Настройки» с титульного экрана — то же меню паузы, город
// к этому моменту уже сгенерирован (boot() создаёт Game до показа титула),
// поэтому данные настоящие; закрывается обратно на титул, а не в геймплей.
function openTitlePanel(tab) {
  startScreen.style.display = 'none';
  pauseMenu.open(tab, { standalone: true, onClose: () => { startScreen.style.display = ''; } });
}
document.getElementById('open-controls-btn').addEventListener('click', () => openTitlePanel('controls'));
document.getElementById('open-settings-btn').addEventListener('click', () => openTitlePanel('settings'));

document.addEventListener('pointerlockchange', () => {
  if (!game || !running) return;
  if (!document.pointerLockElement && !game.gameOver && !game.paused) {
    game.paused = true;
    pauseMenu.open();
  }
});

// prevent browser shortcuts stealing our keys
window.addEventListener('keydown', (e) => {
  if (['F5', 'F9', 'Tab', 'Space'].includes(e.code) || e.key === 'F5' || e.key === 'F9') {
    if (running) e.preventDefault();
  }
});

requestAnimationFrame(loop);
setTimeout(boot, 50);
