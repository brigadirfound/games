// «Эхо-укрытие» — сборка сцены и игровой цикл.
//
// Что переиспользовано из студии, а не написано заново (см. LIBRARY.md):
//   map.js, textures.js — воксельная карта, коллизии, атлас (из ghostfire);
//   platform.js         — рубеж с площадкой и защита от автопоказа (скелет);
//   audio.js            — синтез звука и глушение на рекламе (скелет).
//
// Своё здесь только то, чего в студии не было: планировка квартиры, ходьба с
// тремя режимами шума, сосед со слухом и поиском пути, фонарь с зарядом.

import * as THREE from 'three';
import {STORY_NIGHTS,freePlayUnlocked,storyProgress,checkpoint,freeDifficulty,storySeeds} from './campaign.js?v=resident-devices-v32';
import { GameMap } from './map.js?v=resident-devices-v32';
import { generateApartment } from './apartment.js';
import { generateIntro, FirstNightLesson } from './intro.js?v=resident-devices-v32';
import { Walker, WALK } from './walker.js';
import { Neighbor } from './neighbor.js?v=resident-devices-v32';
import { createHunter, prepareHunter, animateHunter, disposeGroup } from './hunter.js?v=resident-devices-v32';
import { prepareSurfaces } from './textures.js?v=resident-devices-v32';
import { prepareRoomMaterials, roomMaterial } from './room-materials.js?v=resident-devices-v32';
import {prepareCarpets,createCarpets} from './carpets.js?v=resident-devices-v32';
import { inBeam, reactToLight, clearSight } from './light-sense.js?v=resident-devices-v32';
import { createApartmentDetail } from './apartment-detail.js?v=resident-devices-v32';
import { NOTES, foundNotes, observedTraces, rememberTrace, nextStoryHook, noteForNight, notePosition, createPaper, createJournal, canRead } from './story.js?v=resident-devices-v32';
import { CatchShot, scaresEnabled } from './catch-shot.js?v=resident-devices-v32';
import { createResidentTraces,prepareStoryPhoto,createArchivePiece,storyPhoto,wallPhotos } from './resident-traces.js?v=resident-devices-v32';
import {itemsForNight,rememberArchive} from './archive-items.js?v=resident-devices-v32';
import { createFurniture, tidySeats } from './furniture.js?v=resident-devices-v32';
import { Controls } from './controls.js?v=resident-devices-v32';
import { Wardrobes } from './wardrobes.js?v=resident-devices-v32';
import { NightEnding } from './night-ending.js?v=resident-devices-v32';
import { StoryOpening } from './story-opening.js?v=resident-devices-v32';
import { shouldShowOpening } from './opening-script.js?v=resident-devices-v32';
import { createBattery, createFlashlight, setFlashlightPower } from './handheld-props.js?v=resident-devices-v32';
import { playMusic, refreshMusic, watchMusic } from './music.js?v=resident-devices-v32';
import {
  initScare, prepareRecordedAudio, neighborStep, heartbeat, stingerHeard, gasp,
  ambientCreak, catchSting, screamSting, winSting, pickupSting, stopHeart, resetScare,
  playerStep, residentBreath, storySound, wardrobeSound, paperSound, endingSound, audioSnapshot
} from './scare.js?v=resident-devices-v32';

const CONFIG = {
  id: 'echo-hideout',
  // Имя таблицы обязано подходить под маску [a-zA-Z0-9] — консоль не принимает
  // ни подчёркиваний, ни дефисов. Прежнее echo_score отвергалось формой.
  leaderboard: 'echoScore',
  // Счётчик Метрики. Заведён свой на эту игру: общий на портфель смешал бы
  // события восьми проектов, и «на какой ночи отваливаются» из такой каши уже
  // не достать.
  counterId: 111522151,
};

// С какой ночи в квартире двое.
const SECOND_NEIGHBOR_FROM = 5;
/*
  Множитель за длину цепочки.

  Ночи росли в сложности, но не в цене: пятая ночь стоила столько же, сколько
  первая, и «ещё одна ночь» означало только «дольше», а не «выгоднее». Теперь
  каждая батарейка на длинной цепочке дороже, и обрыв по-настоящему жалко —
  это то самое вложение, которое игрок не хочет терять.

  Потолок на пятой ночи и ровно вдвое: дальше множитель не растёт, иначе
  рекорд превращался бы в приз за усидчивость, а не за мастерство.
*/
const CHAIN_MULT_MAX = 2;
const chainMult = n => Math.min(CHAIN_MULT_MAX, 1 + (n - 1) * 0.25);

/** Цена одной батарейки на текущей ночи. */
const batteryPoints = () => Math.round(220 * chainMult(night));

const BATTERY_MAX = 100;
const BATTERY_DRAIN = 2.2;      // в секунду: полного заряда хватает на 45 с
const BATTERY_PICKUP = 30;

/**
 * Длительность ночи.
 *
 * Счётчик раньше показывал прожитые секунды, и «НОЧЬ 7» читалось как ночь
 * длиной в семь секунд. Теперь сверху идут настоящие часы от 23:00 до 06:00,
 * а вся ночь укладывается в NIGHT_MS реального времени: одна секунда игрока —
 * одна минута в квартире.
 */
const NIGHT_MS = 420000;

/*
  Последняя минута ночи: их больше не надо слышать.

  Рассвет был просто концом таймера — ночь не заканчивалась, а обрывалась, и
  самая напряжённая её часть приходилась на середину. Теперь за FINALE_MS до
  рассвета соседи знают, где игрок, и идут напрямую: у ночи появляется
  кульминация, а у промаха — то самое «почти успел», ради которого жмут «ещё
  раз». Спрятаться в шкафу по-прежнему можно — иначе финал превратился бы в
  неизбежность, а не в задачу.
*/
const FINALE_MS = 30000;
const NIGHT_FROM = 23 * 60;      // 23:00 в минутах
const NIGHT_TO = 30 * 60;        // 06:00 следующих суток

/**
 * Сложность по номеру ночи.
 *
 * До этого каждая ночь была одинаковой, а победа просто заканчивала игру: у
 * забега не было ни роста, ни причины начинать второй. Теперь ночи идут
 * цепочкой — пережил, и сразу начинается следующая, тяжелее, а счёт копится.
 * Обрывает цепочку только поимка или рассвет.
 *
 * Насыщение к седьмой ночи: дальше расти нельзя, иначе игра становится
 * невыигрываемой, а бесконечная цепочка должна упираться в мастерство игрока,
 * а не в арифметику.
 */
function difficultyFor(night) {
  const t = Math.min(1, (night - 1) / 6);
  return {
    /*
      Скорость соседа. Верхний предел ниже спешки игрока (5.2): догонять
      бегущего он не должен никогда, иначе рвётся правило «дыхание — разрыв».

      Нижний предел опущен с 3.4 до 2.9, то есть НИЖЕ обычного шага игрока
      (3.0). Прежние 3.4 означали, что от соседа нельзя уйти пешком: anyHeard —
      и спасает только спешка, а спешка это максимальный шум. Новичок, ещё не
      знающий, что надо красться, попадал в петлю без выхода и умирал, не
      поняв за что. К седьмой ночи скорость та же, что была.
    */
    speed: 2.9 + 1.5 * t,

    /*
      Слух. Было 22 метра при квартире 24×32 — то есть он слышал шаг почти из
      любой её точки, и первая же ошибка приводила его в упор. Стало 12: слышно
      в соседних комнатах, а не через весь home. Потолок прежний.
    */
    hearRange: 12 + 16 * t,

    // Порог слуха не трогаем: 0.40 против шума шага 0.55 и шума крадущегося
    // 0.18 — то самое правило, ради которого игра и существует. Красться
    // безопасно на любой ночи, и это не должно ломаться никогда.
    hearThreshold: 0.40 - 0.10 * t,
    drain: 2.2 + 0.8 * t,             // фонарь садится быстрее
    batteries: 6 + Math.round(3 * t), // и собрать надо больше

    /*
      Фора в начале ночи: сосед не охотится первые секунды.

      Собрать батарейки — не проблема: обойти всю квартиру пешком 31 секунда
      при ночи в 210. Проблема в том, что игрока ловят раньше, чем он успевает
      понять правила. Двадцать секунд тишины на первой ночи дают освоиться;
      дальше фора тает и с четвёртой ночи её нет вовсе.
    */
    graceSec: Math.max(0, 20 - 20 * (night - 1) / 3),
  };
}

/*
  Квартира дня.

  Возвращаемость по метрикам площадки — 0,85%, нижние 20%. Причина простая: в
  игре нет ничего, что менялось бы к завтрашнему дню. Рекорд один на всё время,
  и побив его сегодня, завтра игрок приходит в ту же ситуацию.

  Зерно берётся из КАЛЕНДАРНОЙ даты, поэтому квартира у всех сегодня одна и та
  же, а завтра другая. Лидерборда на площадке нет вовсе, так что соревнование
  тут личное: сегодняшний рекорд отдельно от рекорда за всё время.

  Дата берётся местная, а не UTC: «сегодня» для игрока — это его сегодня.
  Штрафов за пропущенный день нет и не будет: череда просто начинается заново.
  Таймеры, идущие при закрытой игре, и «прогресс сгорит» — не наш инструмент.
*/
/*
  Фонари: то, что копится между заходами.

  Сложность упирается в потолок на седьмой ночи, и дальше расти нечему —
  игроку, который освоился, игра перестаёт что-либо обещать. Общее число
  собранных за всё время батареек открывает варианты луча: не сильнее, а ДРУГИЕ.

  Прямое усиление тут запрещено само собой: игра про то, что света мало, и
  фонарь, светящий вдвое дальше, ломает её же правило. Поэтому каждый вариант
  что-то отдаёт за то, что даёт.
*/
const FLASHLIGHTS = [
  { id: 0, at: 0,   color: 0xffd9a0, angle: Math.PI / 5.2, distance: 34, drain: 1.00 },
  // Узкий: видно дальше, но полоса уже — мимо неё ничего не разглядеть.
  { id: 1, at: 6,   color: 0xffe8c4, angle: Math.PI / 7.5, distance: 44, drain: 1.00 },
  // Широкий: видно вокруг, но близко, и садится быстрее.
  { id: 2, at: 24,  color: 0xffcf8a, angle: Math.PI / 3.6, distance: 26, drain: 1.15 },
  // Экономный: тусклее и ближе, зато заряда хватает заметно дольше.
  { id: 3, at: 60,  color: 0xcfe0ff, angle: Math.PI / 5.2, distance: 28, drain: 0.78 },
];

/** Какие фонари открыты при таком числе собранных за всё время батареек. */
function unlockedLights(total) {
  return FLASHLIGHTS.filter(f => total >= f.at);
}

/** Выбранный фонарь, с проверкой: закрытый выбрать нельзя даже правкой сейва. */
function currentLight() {
  const total = window.Platform.load('totalBatteries', 0) || 0;
  const want = window.Platform.load('light', 0) || 0;
  const unlocked = unlockedLights(total);
  return unlocked.find(f => f.id === want) || FLASHLIGHTS[0];
}

function todayKey() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Дневной прогресс: рекорд сегодняшней квартиры и череда дней подряд.
 *
 * Хранится вместе с остальным сохранением, читается один раз при запуске.
 * Смена даты обнуляет дневной рекорд — но не общий и не череду, если игрок
 * заходил вчера.
 */
function loadDaily() {
  const today = todayKey();
  const d = window.Platform.load('daily', null) || {};
  if (d.day === today) return d;

  // Вчера считаем по календарю, а не по «минус 86400 секунд»: перевод часов и
  // разная длина суток иначе рвут череду ни за что.
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const yesterday = yest.getFullYear() * 10000 + (yest.getMonth() + 1) * 100 + yest.getDate();

  const fresh = {
    day: today,
    best: 0,
    streak: d.day === yesterday ? (d.streak || 0) + 1 : 1,
  };
  window.Platform.save('daily', fresh);
  return fresh;
}

/** Зерно квартиры: день плюс номер ночи, чтобы ночи в забеге были разными. */
function seedForNight(n) {
  // Смешиваем простыми множителями: соседние дни не должны давать похожие
  // планировки, иначе «новая квартира» окажется вчерашней с переставленным
  // комодом.
  return ((todayKey() % 100000) * 733 + n * 9176) & 0xffff;
}

const el = id => document.getElementById(id);
const show = (id, on) => el(id).classList.toggle('hidden', !on);
// Интерфейс партии живёт в трёх узлах: полосы слева, счётчик ночи сверху и
// строка состояния снизу. Прятать их надо вместе, иначе счётчик остаётся
// висеть поверх меню.
const showHud = on => ['hud', 'hud-top', 'hud-state'].forEach(id => show(id, on));
// Урок гаснет вместе с интерфейсом: висеть поверх результата ему незачем.
const hideLesson = () => show('lesson', false);

let renderer, scene, camera, map, apartment, walker, neighbor, controls;
let detailGroup, paperMesh, worldNote, journal;
let wardrobes=null,storyCueUntil=0,storyCueKey='',noteCueShown=false;
let lessonWardrobe=null;
const nightEnding=new NightEnding();
const storyOpening=new StoryOpening();
const inspection={enabled:false};
let residentTraces;
const catchShot = new CatchShot();
let batteryMeshes = [];
let lampLights = [];
let clutterMeshes = [];
let wallArtMeshes = [];
let flashlight, ambient, playerGlow, flashModel;
let flashRaise = 0;   // 0 — убран вниз, 1 — поднят и светит
let adPending = false;   // ролик в пути: кнопка занята
let neighbors = [];      // все охотники этой ночи
let finaleOn = false;    // идёт ли последняя минута ночи
let everHurried = false; // бежал ли игрок этой ночью
let everHeard = false;   // слышали ли его этой ночью
let lastNightEarned = 0; // сколько принесла последняя ночь — для удвоения за рекламу
let doubledThisNight = false;
let lightSpec = null;    // выбранный игроком фонарь
let lesson = new FirstNightLesson(false), activeMs = 0, pressureMs = 0, attempt = 0, traceSeen = new Set();
let lessonFinishedAt = -1, lookTravel = 0, lastUnlock = -1;
function trace(name, extra = {}, once = false) {
  if (once && traceSeen.has(name)) return;
  traceSeen.add(name);
  window.Platform.goal(name, { attempt, night, runMode, seed: apartment?.seed,
    input: controls?.io.keyboard ? 'keyboard' : 'touch', locale: window.Platform.getLanguage(),
    viewport: [innerWidth, innerHeight], elapsed: Math.round(activeMs), taken,
    light: !!controls?.light, ...extra });
}
function paintTouch() {
  const touch = running && !paused && !controls.io.keyboard;
  show('touch-controls', touch);
  for (const mode of ['sneak','walk','hurry']) {
    const b = el('mode-' + mode);
    b.textContent = window.t('mode' + mode);
    b.setAttribute('aria-pressed', String(controls.touchMode === mode));
  }
  el('stick-label').textContent = window.t('moveControl');
  el('look-label').textContent = window.t('lookControl');
  el('btn-light').setAttribute('aria-label', window.t('battery'));
  el('btn-pause').setAttribute('aria-label', window.t('pauseTitle'));
  el('btn-light').classList.toggle('on', touch);
  el('btn-pause').classList.toggle('on', running && !paused);
}
function progressCopy() {
  const total = Number(window.Platform.load('totalBatteries', 0)) || 0;
  const next = FLASHLIGHTS.find(f => f.at > total);
  const progress = next ? window.t('torchProgress', { name: window.t('torchName' + next.id), n: total, all: next.at }) : window.t('torchComplete');
  return (lastUnlock >= 0 ? window.t('torchUnlocked', { name: window.t('torchName' + lastUnlock) }) + ' · ' : '') + progress;
}
let battery = BATTERY_MAX;
let taken = 0;
let running = false;
let heardFlashUntil = 0;
let lastFrame = 0;
let paused = false;
let night = 1;            // номер ночи в текущей цепочке
let runMode='story';
const isStoryNight=n=>runMode==='story'&&night===n;
const isStoryFinal=()=>isStoryNight(STORY_NIGHTS);
let chainScore = 0;       // счёт, накопленный за пережитые ночи
let usedRevive = false;   // вознаграждаемая реклама даётся раз на цепочку
let tuning = null;        // числа сложности этой ночи

// ── сцена ─────────────────────────────────────────────────────────────────

/**
 * Создание рендерера с отступлением.
 *
 * Контекст WebGL доступен не всегда: выключено аппаратное ускорение, драйвер в
 * чёрном списке браузера, исчерпан лимит контекстов из-за десятка вкладок с
 * играми. Строгие настройки в такой машине отказывают наглухо, поэтому пробуем
 * по убыванию требований — вплоть до программного рендеринга, который медленный,
 * но в тёмной воксельной квартире вполне достаточен.
 */
function createRenderer(canvas) {
  const attempts = [
    { antialias: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
    { antialias: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
    { antialias: false, precision: 'lowp', failIfMajorPerformanceCaveat: false, alpha: false },
  ];
  let last = null;
  for (const opts of attempts) {
    try { return new THREE.WebGLRenderer(Object.assign({ canvas }, opts)); }
    catch (e) { last = e; }
  }
  const err = new Error('WEBGL_UNAVAILABLE');
  err.cause = last;
  throw err;
}

function buildScene() {
  const canvas = el('view');
  renderer = createRenderer(canvas);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.88;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  // Туман скрывает дальние стены и не даёт разглядеть планировку целиком:
  // незнание, где сосед, — половина игры.
  scene.fog = new THREE.FogExp2(0x04060c, 0.055);
  scene.background = new THREE.Color(0x04060c);

  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 60);

  // Почти нулевой общий свет: видно только то, что в конусе фонаря.
  ambient = new THREE.AmbientLight(0x2a3550, 0.55);
  scene.add(ambient);

  // Слабое пятно у ног — чтобы без фонаря игрок не был полностью слеп и мог
  // хотя бы красться. Полная темнота ощущается как поломка, а не как страх.
  playerGlow = new THREE.PointLight(0x8296b5, 14, 9, 1.2);
  scene.add(playerGlow);

  flashlight = new THREE.SpotLight(0xffd9a0, 0, 34, Math.PI / 5.2, 0.35, 0.9);
  flashlight.castShadow=true;flashlight.shadow.mapSize.set(512,512);
  flashlight.shadow.bias=-.001;flashlight.shadow.normalBias=.015;
  flashlight.shadow.camera.near=.2;flashlight.shadow.camera.far=36;
  flashlight.target = new THREE.Object3D();
  scene.add(flashlight, flashlight.target);

  // Камера в сцене — обязательное условие: дети камеры рисуются только когда
  // она сама состоит в графе. Без этой строки фонарь в руке просто не виден,
  // и ошибки при этом никакой нет.
  scene.add(camera);
  flashModel = buildFlashlightModel();
  camera.add(flashModel);
  layoutFlashlight();

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    layoutFlashlight();
  });
}

/**
 * Фигура соседа. Строится кодом, приём из bagor/voxel.js.
 *
 * Раньше это были три серых ящика ростом с игрока, и в темноте они не читались
 * никак: игрок проигрывал, не увидев причины. Поэтому фигура вытянута выше
 * человеческого роста, узкая в плечах и очень тёмная — силуэт опознаётся даже
 * краем конуса фонаря.
 *
 * Глаза — единственное светящееся. Это сделано ради ответа на вопрос «где он»:
 * две тусклые точки видно раньше, чем тело, они дают направление задолго до
 * того, как станет поздно. Пугать без предупреждения дёшево; пугать тем, что
 * игрок увидел заранее и не успел, — честно.
 */
function buildNeighborMesh() { return createHunter(); }

function buildFlashlightModel() {
  const g=createFlashlight();g.scale.setScalar(.72);
  // The held prop must not cast its own shadow across the gameplay beam.
  g.traverse(m=>{if(m.isMesh){m.castShadow=false;m.receiveShadow=false;}});
  return g;
}

/**
 * Положение фонаря в кадре зависит от соотношения сторон.
 *
 * На телефоне в портретной ориентации горизонтальный угол обзора узкий, и
 * фиксированное смещение вправо уводит модель за край экрана. Считаем половину
 * видимой ширины на расстоянии модели и ставим её долей от этой величины.
 */
function layoutFlashlight() {
  if (!flashModel) return;
  const z = 0.55;
  const halfH = Math.tan((camera.fov * Math.PI / 180) / 2) * z;
  const halfW = halfH * camera.aspect;
  flashModel.position.x = Math.min(0.34, halfW * 0.62);
  // Keep the prop readable without covering the lower-right gameplay view.
  flashModel.scale.setScalar(controls?.io?.touch ? .68 : .78);
  flashModel.userData.baseY = -halfH * 0.66;
  flashModel.position.z = -z;
}

/**
 * Тёплые лампы квартиры.
 *
 * До них единственным источником света был фонарь, и вся квартира читалась
 * одинаково серой — ровно то, чего не хватало по сравнению с картинкой меню.
 * Пара тусклых тёплых пятен даёт и настроение, и ориентиры: в темноте
 * запоминаешь не планировку, а «комната с лампой».
 *
 * Ламп немного и они слабые намеренно. Яркие превратили бы хоррор в освещённую
 * квартиру, а каждый источник в Three.js — это ещё один проход по всем
 * материалам сцены.
 */
function buildLamps() {
  lampLights.forEach(l => scene.remove(l));
  lampLights = [];
  // Берём с равным шагом по списку, а не первые пять: список идёт по комнатам,
  // и срез с начала оставлял бы всю дальнюю половину квартиры без единого
  // тёплого пятна — ровно ту, куда игрок доходит позже всего.
  const all = apartment.lamps || [];
  const step = Math.max(1, Math.ceil(all.length / 5));
  for (let i = 0; i < all.length; i += step) {
    const p = all[i];
    const light = new THREE.PointLight(p.color ?? 0xffb46a, p.intensity ?? 5.5, p.distance ?? 9, 1.5);
    light.position.set(p.x, p.y, p.z);
    scene.add(light);
    lampLights.push(light);
  }
}

/**
 * Мелочь на полу.
 *
 * Отдельными моделями, а не вокселями: воксель в этой карте всегда сплошной, и
 * брошенная книга стала бы кубом, о который спотыкаешься. Здесь всё без
 * коллизий — это декорация, отвечающая на «на карте ничего не валяется».
 */
function buildClutter() {
  clutterMeshes.forEach(m => disposeGroup(m));
  clutterMeshes = [];
  const wood = roomMaterial('wood',0x4a3423);
  const paper = roomMaterial('linen',0x8d8574);
  const book = roomMaterial('linen',0x6d4526);
  const glass = new THREE.MeshLambertMaterial({ color: 0x35494a });

  for (const c of apartment.clutter || []) {
    const g = new THREE.Group();
    if (c.kind === 'books') {
      for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.2), book);
        b.position.set(i * 0.02, 0.03 + i * 0.05, i * 0.03);
        b.rotation.y = i * 0.2;
        g.add(b);
      }
    } else if (c.kind === 'papers') {
      for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.26), paper);
        p.position.set((Math.random() - 0.5) * 0.4, 0.005 + i * 0.008, (Math.random() - 0.5) * 0.4);
        p.rotation.y = Math.random() * Math.PI;
        g.add(p);
      }
    } else if (c.kind === 'chair') {
      // Опрокинутый: стоящий стул посреди комнаты выглядел бы мебелью,
      // сквозь которую можно пройти, а это хуже, чем отсутствие стула.
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.38), wood);
      seat.position.y = 0.2;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.05), wood);
      back.position.set(0, 0.2, -0.18);
      g.add(seat, back);
      for(const x of [-.14,.14])for(const z of [-.14,.14]){
        const leg=new THREE.Mesh(new THREE.BoxGeometry(.035,.35,.035),wood);
        leg.position.set(x,.005,z);g.add(leg);
      }
      g.rotation.z = Math.PI / 2.2;
      g.position.y = 0.16;
    } else if (c.kind === 'box') {
      // Open wooden crate, with an actual hollow interior and individual slats.
      const base=new THREE.Mesh(new THREE.BoxGeometry(.34,.025,.3),wood);base.position.y=.013;g.add(base);
      for(const y of [.06,.14,.22])for(const sign of [-1,1]){
        const side=new THREE.Mesh(new THREE.BoxGeometry(.34,.065,.02),wood);side.position.set(0,y,sign*.14);g.add(side);
        const end=new THREE.Mesh(new THREE.BoxGeometry(.02,.065,.26),wood);end.position.set(sign*.16,y,0);g.add(end);
      }
    } else {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.24, 7), glass);
      b.rotation.z = Math.PI / 2;
      b.position.y = 0.06;
      g.add(b);
    }
    // Пол на y = 1: без этого вся мелочь лежала на полметра ниже пола и
    // не показывалась вовсе.
    g.position.x = c.x;
    g.position.y += 1;
    g.position.z = c.z;
    g.rotation.y = c.rot;
    scene.add(g);
    clutterMeshes.push(g);
  }
}

/**
 * Картины, зеркала и часы на стенах.
 *
 * Голые стены — вторая половина того, из-за чего квартира не читалась жильём:
 * мебель у пола появилась, а на уровне глаз по-прежнему не было ничего. Взгляд
 * от первого лица большую часть времени направлен именно туда.
 *
 * Зеркало не отражает по-настоящему: настоящее отражение это второй проход
 * рендера на каждое зеркало, а их в квартире до трёх десятков. Тёмное стекло с
 * бликом отдаёт ту же роль за ноль стоимости.
 */
function buildWallArt() {
  wallArtMeshes.forEach(m => disposeGroup(m));
  wallArtMeshes = [];
  const frame = roomMaterial('wood',0x493723);
  const canvasMat = [
    new THREE.MeshLambertMaterial({ color: 0x4a4032 }),
    new THREE.MeshLambertMaterial({ color: 0x3a3a44 }),
    new THREE.MeshLambertMaterial({ color: 0x453528 }),
  ];
  const glass = new THREE.MeshLambertMaterial({ color: 0x1b2028 });
  const dial = roomMaterial('enamel',0xb0a58a);

  const placed=[],photos=wallPhotos(apartment.storyNight||night);let photoIndex=0;
  for (const a of apartment.wallArt || []) {
    // Do not fill every room with another copy of the same family portrait.
    if(a.kind!=='clock'&&photoIndex>=photos.length)continue;
    // The story display owns this patch of wall, including its framed photograph.
    if(residentTraces?.anchor&&Math.hypot(a.x-residentTraces.anchor.x,a.z-residentTraces.anchor.z)<1.35)continue;
    if(placed.some(b=>Math.abs(a.y-b.y)<(a.h+b.h)/2+.08&&Math.hypot(a.x-b.x,a.z-b.z)<(a.w+b.w)/2+.12))continue;
    placed.push(a);
    const g = new THREE.Group();
    if (a.kind === 'clock') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12), frame);
      body.rotation.x = Math.PI / 2;
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), dial);
      face.rotation.x = Math.PI / 2;
      face.position.z = 0.03;
      // Стрелки замерли на без четверти три — часы в этой квартире стоят.
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.01), frame);
      hand.position.set(0, 0.05, 0.05);
      const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.018, 0.01), frame);
      hand2.position.set(-0.04, 0, 0.05);
      g.add(body, face, hand, hand2);
    } else {
      const outer = new THREE.Mesh(new THREE.BoxGeometry(a.w, a.h, 0.05), frame);
      const inner = new THREE.Mesh(
        new THREE.BoxGeometry(a.w - 0.09, a.h - 0.09, 0.02),
        new THREE.MeshStandardMaterial({map:photos[photoIndex++],roughness:1,color:0xe8dfca}));
      inner.position.z = 0.03;
      g.add(outer, inner);
    }

    g.position.set(a.x, a.y, a.z);
    // Разворачиваем лицом от стены: нормаль приходит из планировки, иначе
    // половина рам смотрела бы внутрь стены.
    g.rotation.y = Math.atan2(a.nx, a.nz) + Math.PI;
    scene.add(g);
    wallArtMeshes.push(g);
  }
}

/**
 * Батарейки — цель партии, поэтому их видно.
 *
 * Прежние были цилиндриками в семь сантиметров с чуть тёплым материалом, и в
 * тёмной квартире игрок честно сообщал, что на карте ничего не лежит. Теперь
 * это заметный предмет со свечением и ореолом: цель, которую нельзя не найти,
 * если посветить в её сторону.
 */
function buildBatteries() {
  batteryMeshes.forEach(m => disposeGroup(m));
  batteryMeshes = [];
  for (const b of apartment.batteries) {
    const g = new THREE.Group();
    const item=runMode==='story'?itemsForNight(night)[batteryMeshes.length]:null;
    g.userData.archiveItem=item;
    const cell=runMode==='story'?createArchivePiece(batteryMeshes.length,item):createBattery();
    if(runMode!=='story')cell.rotation.z=Math.PI/2;cell.rotation.y=.28;
    cell.position.y=1.112-b.y;g.add(cell);
    // Keep a discreet search cue without a glowing sphere hiding the geometry.
    const beam=new THREE.Mesh(new THREE.CylinderGeometry(.12,.025,1.1,16,1,true),
      new THREE.MeshBasicMaterial({color:0xffca7a,transparent:true,opacity:.045,depthWrite:false,side:THREE.DoubleSide}));
    beam.position.y=.45;g.add(beam);
    const halo=new THREE.Mesh(new THREE.RingGeometry(.22,.226,40),new THREE.MeshBasicMaterial({color:0xb49b61,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide}));
    halo.rotation.x=-Math.PI/2;halo.position.y=1.006-b.y;g.add(halo);
    g.position.set(b.x, b.y, b.z);
    scene.add(g);
    batteryMeshes.push(g);
  }
}

// ── партия ────────────────────────────────────────────────────────────────

/**
 * Начать ночь.
 *
 * @param {boolean} chain продолжение цепочки: номер ночи и счёт сохраняются
 *
 * Без `chain` это новая игра с первой ночи. С ним — следующая ночь той же
 * цепочки: новая квартира, сложность выше, накопленное не сбрасывается.
 */
/**
 * Комната, наиболее удалённая от всех перечисленных точек.
 *
 * Берём максимум минимального расстояния: комната, которая далека от каждой
 * точки, а не та, что далека в сумме и при этом стоит вплотную к одной из них.
 */
function farthestRoom(apt, points) {
  let best = apt.rooms[0], bestScore = -1;
  for (const r of apt.rooms) {
    let min = Infinity;
    for (const p of points) {
      const v=p.pos||p;
      const px = v.x !== undefined ? v.x : v[0];
      const pz = v.z !== undefined ? v.z : v[2];
      if(!Number.isFinite(px)||!Number.isFinite(pz))throw new Error('Invalid enemy spawn reference');
      min = Math.min(min, Math.hypot(r.cx - px, r.cz - pz));
    }
    if (min > bestScore) { bestScore = min; best = r; }
  }
  return best;
}

let nightNoteRead=false,nightSearch=null;
function storyNote(){return runMode==='story'?NOTES.find(n=>n.night===night):null;}
function needsStoryNote(){return !!storyNote()&&!nightNoteRead;}
function nightReady(){return !apartment.batteries.length&&!needsStoryNote()&&!nightSearch;}
function spawnWorldNote(note){
  const position=residentTraces?.paperPosition||notePosition(apartment,note?.id);
  if(note&&position){worldNote={...position,id:note.id};paperMesh=createPaper(position,note.id);paperMesh.rotation.y=residentTraces?.paperRotation??.23;scene.add(paperMesh);}
}
function beginNightSearch(){
  if(night<2||runMode!=='story'||nightSearch)return;
  const mount=wardrobes?.mounts.reduce((best,w)=>!best||w.entry.distanceTo(walker.pos)<best.entry.distanceTo(walker.pos)?w:best,null);
  nightSearch={age:0,mount,origin:walker.pos.clone(),started:false};
}
function updateNightSearch(dt){
  if(!nightSearch)return;
  const s=nightSearch;s.age+=dt;
  storyCueKey=s.age<5?'searchWarning':'searchActive';storyCueUntil=activeMs+100;
  if(s.age>=5&&!s.started){
    s.started=true;stingerHeard();
    for(const n of neighbors){
      n.cancelInspection();n.stare=null;n.avoidPoint=null;n.lastHeard={x:s.origin.x,z:s.origin.z};n.heardAt=performance.now();
      n.goal=n.lastHeard;n.state='seeking';n.pauseLeft=0;
      n.path=n.findPath(Math.floor(n.pos.x),Math.floor(n.pos.z),Math.floor(s.origin.x),Math.floor(s.origin.z));
      if(wardrobes?.active&&!neighbors.some(other=>other!==n&&other.inspection?.mount===wardrobes.active))n.investigateWardrobe(wardrobes.active);
    }
  }
  if(s.age>=23){nightSearch=null;storyCueKey='searchOver';storyCueUntil=activeMs+4000;}
}

function startRun(chain,mode='story',resume=false) {
  storyOpening.finish(false);
  if((!chain&&mode==='free'&&!freePlayUnlocked(window.Platform))||(chain&&isStoryFinal()))return false;
  nightEnding.finish(false);show('ending',false);window.Sfx.setPaused?.(false);
  disposeGroup(wardrobes?.group);wardrobes=null;hideWardrobeUI();
  storyCueUntil=0;storyCueKey='';noteCueShown=false;show('story-cue',false);
  catchShot.finish(false); journal?.close(false);
  disposeGroup(residentTraces?.group);residentTraces=null;
  disposeGroup(detailGroup); disposeGroup(paperMesh); paperMesh=null; worldNote=null;
  show('btn-read',false); show('light-notice',false);
  if (map && map.mesh) disposeGroup(map.mesh);
  for (const n of neighbors) disposeGroup(n.mesh);
  neighbors = [];

  if(chain)night++;
  else {
    runMode=mode==='free'?'free':'story';const saved=resume&&runMode==='story'?storyProgress(window.Platform):{night:1,score:0};
    night=saved.night;chainScore=saved.score;usedRevive=false;
    if(runMode==='story')checkpoint(window.Platform,night,chainScore);
  }
  tuning = runMode==='free'?freeDifficulty(night):difficultyFor(night);
  if (isStoryNight(1)) Object.assign(tuning, { batteries: 3, drain: 1.2, speed: 2.2 });
  if (isStoryNight(2)) Object.assign(tuning, { batteries: 5, drain: 1.5, speed: 2.6 });
  if (isStoryNight(3)) Object.assign(tuning, { batteries: 6, drain: 1.8, speed: 2.9 });
  if(runMode==='story')Object.assign(tuning,{speed:1.65+.13*(night-1),drain:100/180,catchDelay:.65});
  controls.reset(); controls.active = true; controls.setTouchMode('sneak');
  lesson = new FirstNightLesson(isStoryNight(1));
  lessonWardrobe=null;
  activeMs = pressureMs = 0; lookTravel = 0; lessonFinishedAt = -1; lastUnlock = -1; traceSeen = new Set();
  nightNoteRead=false;nightSearch=null;
  heardFlashUntil=0;
  if (!chain) attempt++;

  apartment = runMode==='story'&&night<=3 ? generateIntro(night) : generateApartment(runMode==='story'?storySeeds[night]:seedForNight(night), { batteries: tuning.batteries });
  apartment.storyNight=runMode==='story'?night:0;
  tidySeats(apartment);
  if(runMode==='story'&&apartment.batteries.length>3){
    const items=apartment.batteries;apartment.batteries=[items[0],items[Math.floor(items.length/2)],items.at(-1)];
  }
  if(runMode==='story'&&night>1){storyCueKey='chapter'+night;storyCueUntil=10000;}
  map = new GameMap(apartment);
  map.mesh.castShadow=true;map.mesh.receiveShadow=true;
  scene.add(map.mesh);

  walker = new Walker({
    camera, map, rugs: apartment.rugs,
    onStep: noise => {
      // Шаг слышен и игроку: звук — единственная обратная связь о том,
      // насколько он шумит, потому что видеть себя со стороны он не может.
      playerStep(noise);
      // Момент «меня услышали» озвучиваем только на переходе, а не каждый шаг:
      // иначе жало звучит очередью и перестаёт что-либо значить.
      const wasSeeking = neighbors.some(n => n.state === 'seeking'||n.state === 'chase');
      // Фора первых секунд ночи: шаги звучат, но сосед их не берёт в расчёт.
      // Молча — игрок не должен знать, что ему дали поблажку.
      const grace = openingGrace();
      // Шум слышат все, кто в квартире: замереть перестаёт спасать от одного,
      // если второй уже шёл на тот же звук.
      let anyHeard = false;
      if (!grace) for (const n of neighbors) if (n.hear(noise, walker.pos)) anyHeard = true;
      if (anyHeard) {
        everHeard = true;
        trace('first_threat', { cause: 'noise' }, true);
        heardFlashUntil = performance.now() + 1200;
        if (!wasSeeking) stingerHeard();
      }
    }
  });
  walker.spawnAt(map.spawns[0]);

  const mesh = buildNeighborMesh();
  scene.add(mesh);
  neighbor = new Neighbor({ map, apartment, mesh, tuning });
  neighbors = [neighbor];

  // Story always has one Viktor. Free play adds a resident every five nights,
  // up to four: further difficulty comes from the existing gradual tuning.
  const residentCount = runMode === 'free' ? Math.min(4, 1 + Math.floor(night / 5)) : 1;
  for (let residentIndex = 1; residentIndex < residentCount; residentIndex++) {
    const farRoom = farthestRoom(apartment, [walker.pos, ...neighbors.map(n=>n.pos)]);
    const mesh2 = buildNeighborMesh();
    scene.add(mesh2);
    const second = new Neighbor({ map, apartment, mesh: mesh2, tuning });
    const spawn=second._nearestWalkable(Math.floor(farRoom.cx),Math.floor(farRoom.cz));
    if(!spawn)throw new Error('No safe second resident spawn');
    second.pos.set(spawn.x+.5, 1, spawn.z+.5);second.mesh.position.copy(second.pos);
    // Второй чуть медленнее: вдвоём они и так покрывают квартиру, а равная
    // скорость превращала бы встречу в клещи без выхода.
    second.speed = tuning.speed * 0.88;
    neighbors.push(second);
  }

  detailGroup=createApartmentDetail(apartment);scene.add(detailGroup);
  detailGroup.add(createFurniture(apartment));
  detailGroup.add(createCarpets(apartment));
  wardrobes=new Wardrobes(apartment);scene.add(wardrobes.group);
  // Replay the first-night scene on retry; the journal collection itself stays saved.
  const earlier=foundNotes(window.Platform).filter(id=>NOTES.find(n=>n.id===id)?.night<night);
  residentTraces=createResidentTraces(apartment,runMode==='story'?earlier:foundNotes(window.Platform),runMode==='story'?observedTraces(window.Platform).filter(id=>earlier.includes(id)):observedTraces(window.Platform));scene.add(residentTraces.group);
  spawnWorldNote(storyNote()||noteForNight(STORY_NIGHTS,foundNotes(window.Platform)));
  buildLamps();
  buildClutter();
  buildWallArt();
  buildBatteries();

  battery = BATTERY_MAX;
  // Фонарь этой ночи. Цвет, угол и дальность применяем к уже созданному
  // источнику: пересоздавать SpotLight каждую ночь незачем.
  lightSpec = currentLight();
  if (flashlight) {
    flashlight.color.setHex(lightSpec.color);
    flashlight.angle = lightSpec.angle;
    flashlight.distance = lightSpec.distance;
  }
  finaleOn = false;
  everHurried = false;
  everHeard = false;
  controls.light = true;
  paused = false;
  el('pause').classList.remove('on');
  resetScare();
  // Захват мыши запрашиваем прямо здесь: игрок нажал кнопку и больше никуда не
  // кликает, поэтому раньше захват не запрашивался ни разу — и обзор мышью
  // выглядел сломанным, хотя был исправен.
  controls.grabLook();
  taken = 0;
  running = true;
  lastFrame = performance.now();

  show('screen-menu', false);
  show('screen-result', false);
  show('screen-night', false);
  showHud(true);
  el('btn-pause').classList.toggle('on', !controls.io.keyboard);
  el('btn-light').classList.toggle('on', !controls.io.keyboard);

  playMusic('game');
  window.Platform.gameplayStart();
  trace('run_start');
  trace(night === 1 ? 'night_1_started' : 'night_2_or_later_started');
  paintTouch();
  updateHud(performance.now(), false);
}

/**
 * Конец партии.
 *
 * @param {'caught'|'won'|'dawn'} outcome чем всё кончилось
 *
 * Исходов стало три, потому что раньше был один: игрока ловили. Игра без
 * выигрыша — это не игра, а таймер до неизбежного, и вопрос «а смысл-то
 * какой» был совершенно справедлив.
 */
function endRun(outcome, cause) {
  if (!running) return;
  hideWardrobeUI();show('story-cue',false);resetScare();window.Sfx.setPaused?.(false);
  if(wardrobes?.active)wardrobes.exit(walker,controls);
  const seconds = Math.floor(activeMs / 1000);
  trace('night_end', { outcome, cause, duration: seconds });
  if (outcome === 'won') trace('night_' + night + '_won');
  else trace('first_death', { outcome, cause }, true);
  controls.active = false; controls.reset();
  show('touch-controls', false); show('guide', false);
  show('btn-read',false); show('light-notice',false);
  // Батарейки решают, время лишь подпирает. За доведённую до конца ночь —
  // отдельная премия: иначе собрать пять из шести и попасться было бы почти
  // так же выгодно, как собрать все.
  const earned = Math.round((taken * 220 + (outcome === 'won' ? 900 + Math.max(0, NIGHT_MS/1000 - seconds) : 0)) * chainMult(night));
  lastNightEarned = earned;

  // Ночь пережита — цепочка продолжается, но не молча.
  //
  // Раньше следующая ночь начиналась мгновенно: квартира менялась под ногами,
  // игрок не успевал понять, что победил, не мог выйти и не получал ни одной
  // законной точки для рекламы. Пауза между ночами закрывает всё три дыры:
  // «Дальше» — то самое действие игрока, которого требует п. 4.4.
  if (outcome === 'won') {
    running = false;
    window.Platform.gameplayStop();
    chainScore += earned;
    showNightBreak();
    if(isStoryFinal()){
      show('screen-night',false);show('ending',true);playMusic('game');
      nightEnding.start(()=>{
        window.Platform.save('campaignCompletedV2',true);trace('story_escaped',{letter:foundNotes(window.Platform).includes('letter')});
        el('btn-next').disabled=false;
        show('ending',false);show('screen-night',true);playMusic('menu');el('btn-night-menu').focus();
      },foundNotes(window.Platform).includes('letter'));
      return;
    }
    playMusic('menu');
    winSting();
    return;
  }

  running = false;
  window.Platform.gameplayStop();
  chainScore += earned;
  playMusic('result');

  const total = apartment.batteries.length + taken;
  const previousBest = Number(window.Platform.load('best', 0)) || 0;
  const best = window.Platform.saveBest('best', chainScore);
  const daily = loadDaily();
  if (chainScore > (daily.best || 0)) {
    daily.best = chainScore;
    window.Platform.save('daily', daily);
  }
  window.Platform.submitScore(chainScore);
  window.Platform.goal(window.Platform.EVENTS.RUN_END,
    { score: chainScore, duration: seconds, outcome, night });

  el('result-title').textContent = window.t(outcome === 'dawn' ? 'dawnTitle' : outcome === 'error' ? 'errorTitle' : 'caught');
  el('result-reason').textContent = window.t(outcome === 'dawn' ? 'dawnReason' : outcome === 'error' ? 'errorReason' : cause === 'light' ? 'lightReason' : 'moveReason');
  el('result-progress').textContent = progressCopy();
  el('result-stats').textContent =
    window.t('nightsSurvived', { n: night - 1 }) + ' · ' +
    (runMode==='story'?(window.Platform.getLanguage()==='ru'?'Архив: ':'Archive: ')+taken+'/'+total:window.t('batteriesOf', { n: taken, all: total }));
  el('result-best').textContent =
    window.t('resultScore', { n: chainScore }) + ' · ' + window.t('resultBest', { n: best }) +
    (chainScore > previousBest ? ' · ' + window.t('newBest') : '');

  // Вознаграждаемая реклама предлагается один раз за цепочку и только при
  // поимке: на рассвете продолжать нечего — ночь и так кончилась.
  const canRevive = outcome === 'caught' && !usedRevive &&
    window.Platform.hasRewarded && window.Platform.hasRewarded();
  show('btn-revive', canRevive);

  showHud(false);
  hideLesson();
  clearFloaters();
  show('screen-result', true);
  el('danger').style.opacity = '0';
  paused = false;
  el('pause').classList.remove('on');
  el('btn-pause').classList.remove('on');
  el('btn-light').classList.remove('on');
  if (document.pointerLockElement) document.exitPointerLock();
  show('btn-read',false); show('light-notice',false);
  if (outcome === 'caught' && catchShot.start(performance.now(),()=>{playMusic('result');show('screen-result',true);el('btn-retry').focus();})) {
    show('screen-result',false); playMusic('catch');screamSting();
  } else stopHeart();
  if(!catchShot.active)el('btn-retry').focus();
}

/**
 * Заслон между ночами.
 *
 * Счёт сохраняем и отправляем именно здесь, а не только на экране поражения:
 * иначе игрок, ушедший в меню после пережитой ночи, терял всё накопленное —
 * рекорд обновлялся только тем, кто попался.
 */
function showNightBreak() {
  if(runMode==='story'&&night<STORY_NIGHTS)checkpoint(window.Platform,night+1,chainScore);
  const best = window.Platform.saveBest('best', chainScore);
  const daily = loadDaily();
  if (chainScore > (daily.best || 0)) {
    daily.best = chainScore;
    window.Platform.save('daily', daily);
  }
  window.Platform.submitScore(chainScore);
  window.Platform.goal(window.Platform.EVENTS.RUN_END,
    { score: chainScore, outcome: 'won', night });

  el('night-title').textContent = window.t('nightDone', { n: night });
  el('night-stats').textContent =
    (runMode==='story'?(window.Platform.getLanguage()==='ru'?'Архив: ':'Archive: ')+taken:window.t('batteriesTaken', { n: taken })) + ' · ' +
    window.t('resultScore', { n: chainScore }) + ' · ' +
    window.t('resultBest', { n: best });
  /*
    Вехи: короткая строка о том, чем эта ночь была особенной.

    Счёт сам по себе не отвечает на вопрос «зачем мне восьмая ночь». Отвечает
    названное: «их стало двое», «он вас не слышал». Две строки максимум —
    структурная и про исполнение, — иначе экран превращается в отчёт.
  */
  const marks = [];
  if (runMode === 'free' && night === SECOND_NEIGHBOR_FROM - 1) marks.push(window.t('milestoneTwoSoon'));
  else if (runMode === 'free' && night === SECOND_NEIGHBOR_FROM) marks.push(window.t('milestoneTwo'));
  else if (night === 7 && runMode==='story') marks.push(window.t('milestoneCeiling'));
  else if (night === 3) marks.push(window.t('milestoneThird'));

  if (!everHeard) marks.push(window.t('milestoneUnheard'));
  else if (!everHurried) marks.push(window.t('milestoneNoRun'));

  el('night-milestone').textContent = marks.slice(0, 2).join(' · ');
  el('night-next').textContent = window.t(isStoryFinal()?'afterStory':runMode==='story'?'chapter'+(night+1):'freeNext', { n: night + 1 });
  el('night-story').textContent=isStoryFinal()?window.t(foundNotes(window.Platform).includes('letter')?'storyUnderstood':'storyUnfinishedNotes'):nextStoryHook(runMode==='free'?STORY_NIGHTS:night,window.Platform,window.Platform.getLanguage());
  if(isStoryFinal())el('night-title').textContent=window.t('storyEscaped');
  el('night-progress').textContent = progressCopy();
  window.Platform.save('introCompleted', true);
  // Удвоение доступно один раз за ночь и только если ночь что-то принесла.
  doubledThisNight = false;
  const canDouble = lastNightEarned > 0 &&
    window.Platform.hasRewarded && window.Platform.hasRewarded();
  show('btn-night-double', canDouble);
  el('btn-night-double').disabled = false;
  el('btn-night-double').textContent = window.t('doubleNight', { n: lastNightEarned });

  el('btn-next').textContent = window.t(isStoryFinal()?'freePlay':'nextNight');
  el('btn-next').disabled=isStoryFinal();
  el('btn-night-menu').textContent = window.t('menu');

  showHud(false);
  hideLesson();
  clearFloaters();
  show('screen-night', true);
  el('danger').style.opacity = '0';
  el('pause').classList.remove('on');
  el('btn-pause').classList.remove('on');
  el('btn-light').classList.remove('on');
  if (document.pointerLockElement) document.exitPointerLock();
  playMusic('menu');
}

/**
 * Вторая попытка за просмотр ролика.
 *
 * Награда обязана быть выдана после `onRewarded` и только после него (п. 4.5):
 * именно на этом пункте сняли «Числопад». Поэтому ночь возобновляется внутри
 * колбэка, а при отказе или ошибке игрок просто остаётся на экране результата.
 *
 * Возобновляем ТУ ЖЕ ночь с теми же батарейками — иначе это не продолжение, а
 * подарок: собранное сохраняется, сосед отброшен к своей стартовой точке,
 * фонарь заряжен.
 */
function reviveForAd() {
  if (usedRevive || adPending) return;

  /*
    Пока ролик в пути — кнопка занята и говорит об этом.

    Раньше сюда передавался только колбэк награды. Когда реклама не приходила —
    нет заполнения, блокировщик, отказ игрока, — второй колбэк вызывался с
    undefined, и не происходило ровно ничего. Игрок жал и оставался с тем же
    экраном, не понимая, сломана кнопка или он сам что-то сделал не так.
    Молчание в ответ на нажатие — худший из возможных ответов.
  */
  adPending = true;
  const btn = el('btn-revive');
  btn.disabled = true;
  btn.textContent = window.t('adLoading');

  const restore = key => {
    adPending = false;
    btn.disabled = false;
    btn.textContent = window.t(key);
    if (key === 'adFailed') setTimeout(() => { if (!usedRevive) btn.textContent = window.t('revive'); }, 2600);
  };

  // Награда — внутри onRewarded, первым аргументом. Второй колбэк лишь
  // закрывает ролик, и выдавать награду из него нельзя: он приходит и при
  // отмене просмотра.
  window.Platform.showRewarded(() => {
    usedRevive = true;
    show('screen-result', false);
    show('btn-revive', false);

    // Разводим ВСЕХ, а не только первого: воскреснуть в шаге от второго
    // соседа — это не второй шанс, а издевательство.
    for (const n of neighbors) {
      const home = n === neighbor
        ? apartment.neighborStart
        : farthestRoom(apartment, [walker.pos, apartment.neighborStart]);
      n.pos.set(home.x !== undefined ? home.x : home.cx, 1, home.z !== undefined ? home.z : home.cz);
      n.path = [];
      n.lastHeard = null;
      n.state = 'wander';
      n.pauseLeft = 1800;      // фора: он не бросается сразу
    }
    battery = BATTERY_MAX;
    controls.light = true;
    resetScare();

    running = true;
    paused = false;
    lastFrame = performance.now();
    showHud(true);
    el('btn-pause').classList.toggle('on', !controls.io.keyboard);
    el('btn-light').classList.toggle('on', !controls.io.keyboard);
    controls.grabLook();
    window.Platform.gameplayStart();
    adPending = false;
  }, granted => {
    // Ролик закрылся. Награда выдаётся только из первого колбэка, значит сюда
    // мы попадаем и после успеха, и после отказа. Молчать можно лишь в первом
    // случае — там игрок уже в игре и всё видит сам.
    if (!granted && !usedRevive) restore('adFailed');
  });

}

// ── цикл ──────────────────────────────────────────────────────────────────

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.max(0,Math.min(0.05, (now - lastFrame) / 1000));
  lastFrame = now;
  if(storyOpening.active){if(!document.hidden&&!storyOpening.suspended&&!window.Sfx._adPaused)storyOpening.update(dt,renderer,innerWidth/innerHeight);return;}
  if(nightEnding.active){if(!document.hidden&&!window.Sfx._adPaused)nightEnding.update(dt,renderer,innerWidth/innerHeight);return;}
  // На паузе кадр только рисуется. Ни сосед, ни заряд, ни таймер не идут —
  // иначе «пауза» была бы просто экраном поверх продолжающейся игры.
  if (catchShot.update(now,renderer,innerWidth/innerHeight)) return;
  if (!running || paused) { if(!paused)ambientCreak(dt,0);renderer.render(scene, camera); return; }

  if(!inspection.enabled)activeMs += dt * 1000;
  if (activeMs >= 60000) trace('first_minute', {}, true);
  const beforeLesson = lesson.stage;
  lesson.update(dt, { taken, still: walker.mode === 'still', light: controls.light && battery > 0,
    sheltered:inWardrobe(),visitPhase:neighbor?.inspection?.phase,exploring:walker.pos.x>8 });
  if (!inspection.enabled&&!openingGrace()) pressureMs += dt * 1000;
  if (beforeLesson !== lesson.stage) {
    trace('tutorial_' + lesson.stage);
    if (lesson.stage === 'sound') { storyCueKey='introSound';storyCueUntil=activeMs+3000; }
    if (lesson.stage === 'change') residentTraces?.arm('notice');
    if (lesson.stage === 'done') {
      lessonFinishedAt = activeMs;
      trace('hints_finished', {}, true);
    }
  }
  const look = controls.takeLook();
  lookTravel += Math.abs(look.x) + Math.abs(look.y);
  if (lookTravel > .15) trace('first_look', {}, true);
  if (controls.locked&&!wardrobes?.active) walker.look(look.x, look.y);

  walker.update(dt, { x: wardrobes?.active?0:controls.x, y: wardrobes?.active?0:controls.y, sneak: controls.sneak, hurry: controls.hurry });
  wardrobes?.update(dt,controls.locked?look:{x:0,y:0},walker,camera);

  if (walker.mode !== 'still') trace('first_move', {}, true);

  // Фонарь тратит заряд только когда действительно горит.
  const wants = controls.light && battery > 0;
  if (wants && !openingGrace()&&!inspection.enabled) {
    battery = Math.max(0, battery -
      (tuning ? tuning.drain : BATTERY_DRAIN) * (lightSpec ? lightSpec.drain : 1) * dt);
    if (battery === 0) {
      controls.light = false;
      window.Sfx.tone(220, 180, 'sawtooth', 0.12);
    }
  }
  // Фонарь достаётся и убирается, а не мигает.
  //
  // Мгновенное включение читается как переключатель в интерфейсе; полсекунды
  // подъёма — как действие руки. Свет нарастает вместе с подъёмом, поэтому
  // луч не появляется раньше самого фонаря.
  flashRaise += ((wants ? 1 : 0) - flashRaise) * Math.min(1, dt * 7);
  if (flashModel) {
    flashModel.visible=!wardrobes?.active;
    const base = flashModel.userData.baseY || -0.26;
    const eased = flashRaise * flashRaise * (3 - 2 * flashRaise);   // плавный старт и конец
    flashModel.position.y = base - (1 - eased) * 0.55;
    // Убранный фонарь смотрит вниз, поднятый — вперёд и чуть внутрь кадра.
    flashModel.rotation.x = (1 - eased) * 1.15;
    flashModel.rotation.y = -0.12 * eased;
    // Покачивание в такт ходьбе: неподвижная модель выдаёт, что рука не живая.
    const sway = walker.mode === 'still' ? 0 : (walker.mode === 'hurry' ? 0.02 : 0.011);
    const t = now / (walker.mode === 'hurry' ? 130 : 240);
    flashModel.position.y += Math.sin(t) * sway * eased;
    flashModel.rotation.z = Math.sin(t * 0.5) * sway * 2 * eased;
    setFlashlightPower(flashModel,eased);
  }

  flashlight.intensity = 28 * flashRaise;
  flashlight.position.copy(camera.position);
  const slitBeam=wardrobes?.beam();
  const dir = slitBeam?slitBeam.direction:new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  // Emit at the opening. The louvre must not block the entire cone at the source.
  if(slitBeam)flashlight.position.copy(slitBeam.origin);
  flashlight.angle=slitBeam?slitBeam.angle:lightSpec.angle;
  if(flashlight.shadow.camera.near!==(slitBeam?.015:.2)){
    flashlight.shadow.camera.near=slitBeam?.015:.2;flashlight.shadow.camera.updateProjectionMatrix();
    flashlight.shadow.normalBias=slitBeam?.001:.015;flashlight.shadow.bias=slitBeam?-.00002:-.001;
  }
  flashlight.target.position.copy(flashlight.position).add(dir.multiplyScalar(8));
  playerGlow.position.set(walker.pos.x, walker.pos.y + 1.2, walker.pos.z);
  playerGlow.visible=!wardrobes?.active;

  if (walker.mode === 'hurry') everHurried = true;

  const hidden = inWardrobe();
  if(!inspection.enabled)updateNightSearch(dt);
  const sense = { hidden: hidden, still: walker.mode === 'still'&&!wardrobes?.peek, light: wants, wardrobe:!!wardrobes?.active, searchingRoom:!!nightSearch?.started, neighbors };
  for (const n of neighbors) {
    if(inspection.enabled)continue;
    const learningExit = openingGrace();
    if(learningExit){n.mesh.position.copy(n.pos);continue;}
    const lit=!learningExit&&!hidden&&wants&&flashRaise>.65&&inBeam(apartment,slitBeam?.origin||camera.position,
      dir.clone().normalize(),{x:n.pos.x,y:n.pos.y+2.15,z:n.pos.z},flashlight.angle,10);
    const response=reactToLight(n,dt,lit,walker.pos);
    if(response) {trace('light_'+response,{},true);if(response==='noticed')stingerHeard();}
    if (n.update(dt, walker.pos, learningExit ? { ...sense, hidden: true } : sense)) {
      endRun('caught', wants ? 'light' : 'moving'); return;
    }
    if (n.pos.distanceTo(walker.pos) < 6) trace('first_threat', { cause: 'near' }, true);
  }

  if(!inspection.enabled)soundTheNeighbor(dt, hidden);else stopHeart();
  const event=residentTraces?.update(dt,walker.pos,camera);
  if(event?.changed){if(event.changed==='notice')lesson.changed=true;trace('resident_trace_changed',{id:event.changed});const a=residentTraces.anchor;
    const dx=a.x-walker.pos.x,dz=a.z-walker.pos.z;storySound(event.changed,(dx*Math.cos(walker.yaw)-dz*Math.sin(walker.yaw))/Math.max(1,Math.hypot(dx,dz)));}
  if(event?.noticed){if(event.noticed==='notice')lesson.noticed=true;rememberTrace(window.Platform,event.noticed);trace('resident_trace_noticed',{id:event.noticed});if(!nightSearch){storyCueKey='traceCue';storyCueUntil=activeMs+3800;}}
  if(worldNote&&!noteCueShown&&lesson.stage==='done'&&isStoryNight(1)&&canRead(apartment,walker.pos,worldNote)){
    noteCueShown=true;storyCueKey='noteCue';storyCueUntil=activeMs+4500;
  }
  el('story-cue').classList.toggle('search-announcement',['searchWarning','searchActive','searchOver'].includes(storyCueKey));
  el('story-cue').textContent=window.t(storyCueKey||'noteCue');show('story-cue',activeMs<storyCueUntil&&(!wardrobes?.active||!!nightSearch||storyCueKey==='searchOver'));
  paintWardrobeUI();
  guideToNearestBattery();
  const readable=!wardrobes?.active&&canRead(apartment,walker.pos,worldNote);
  el('btn-read').textContent=window.t(controls.io.keyboard?'readNoteKey':'readNote');
  show('btn-read',!!readable);
  const lightNoticed=neighbors.some(n=>(n.lightExposure||0)>.15);
  el('light-notice').textContent=window.t('lightNotice');show('light-notice',lightNoticed);
  if(!inspection.enabled&&!wardrobes?.active)pickUpBatteries();

  // Два способа закончить ночь помимо поимки: собрать всё или не успеть.
  if (!inspection.enabled&&nightReady()) { endRun('won'); return; }
  if (pressureMs >= NIGHT_MS) { endRun('dawn'); return; }

  // Финал: пока он идёт, каждый сосед получает свежую цель — позицию игрока.
  // Не телепорт и не ускорение: они по-прежнему идут ногами и по-прежнему
  // теряют след, если игрок успел закрыть за собой дверцу шкафа.
  const finaleLeft = NIGHT_MS - (pressureMs);
  const finale = finaleLeft <= FINALE_MS && !hidden;
  if (finale !== finaleOn) {
    finaleOn = finale;
    if (finale) stingerHeard();
  }
  if (finale) {
    for (const n of neighbors) {
      n.lastHeard = { x: walker.pos.x, z: walker.pos.z };
      n.heardAt = now;
      n.state = 'seeking';
    }
  }

  updateHud(now, hidden);
  renderer.render(scene, camera);
}

/**
 * Озвучить и показать угрозу.
 *
 * Собрано здесь, а не в соседе, по одной причине: панорама считается от взгляда
 * игрока, а сосед про взгляд ничего не знает и знать не должен. Без стороны
 * звучания вся механика слуха была односторонней — он слышал игрока, игрок его
 * нет, и проигрыш приходил ниоткуда.
 */
/**
 * Анимация одного соседа: глаза, спинные руки, наклон головы.
 *
 * Раньше это был кусок внутри озвучки и работал ровно по одному охотнику,
 * потому что охотник был один. Теперь их бывает двое, и каждому нужна своя
 * фаза: две одинаково качающиеся фигуры читаются декорацией, а не угрозой.
 *
 * Фазу разводим по идентичности объекта, а не по случайному числу: иначе она
 * менялась бы каждый кадр и движение превратилось бы в дрожь.
 */
function animateNeighbor(n, dt, chasing) {
  const u=n.mesh.userData;
  const distance=u.lastWalkPosition?u.lastWalkPosition.distanceTo(n.mesh.position):0;
  if(!u.lastWalkPosition)u.lastWalkPosition=n.mesh.position.clone();
  else u.lastWalkPosition.copy(n.mesh.position);
  const angle=Math.atan2(walker.pos.x-n.pos.x,walker.pos.z-n.pos.z)-n.mesh.rotation.y;
  const yaw=Math.max(-1.1,Math.min(1.1,Math.atan2(Math.sin(angle),Math.cos(angle))));
  animateHunter(n.mesh,activeMs/1000+neighbors.indexOf(n)*1.7,chasing,
    n.stare?.phase==='watch'?1:Math.min(1,(n.lightExposure||0)/.3),yaw,distance>.0001,distance);
  if(n.stare?.phase==='watch'){
    u.head.rotation.x=-.08;u.head.rotation.z=-.035+Math.sin(n.stare.age*.65)*.012;
  }
}

function soundTheNeighbor(dt, hidden) {
  /*
    Тревогу задаёт БЛИЖАЙШИЙ, а не первый по списку.

    Сердце, кровавая рамка и панорама шагов — про «насколько мне сейчас
    страшно», и отвечать за это должен тот, кто ближе. Считать по первому
    значило бы, что второй сосед подходит вплотную беззвучно.
  */
  let closest = neighbors[0], dist = Infinity, dx = 0, dz = 0;
  for (const n of neighbors) {
    const ax = n.pos.x - walker.pos.x, az = n.pos.z - walker.pos.z;
    const d = Math.hypot(ax, az);
    if (d < dist) { dist = d; closest = n; dx = ax; dz = az; }
  }
  if (!closest) return;
  const chasing = closest.state === 'seeking'||closest.state === 'chase'||!!nightSearch?.started;

  // Панорама — проекция направления на соседа на вектор «вправо от игрока».
  // Камера при рыскании yaw смотрит в (−sin yaw, 0, −cos yaw), значит вправо
  // это (cos yaw, 0, −sin yaw). Скалярное произведение сразу даёт −1 слева,
  // +1 справа и 0 спереди и сзади — и, в отличие от разности углов, его знак
  // можно проверить подстановкой, а не доверием к порядку слагаемых.
  const pan = dist < 0.001 ? 0
    : (dx * Math.cos(walker.yaw) - dz * Math.sin(walker.yaw)) / dist;

  // Шаги озвучиваем у каждого своей громкостью и панорамой: двое, звучащие
  // из одной точки, слышны как один, и вся польза от второго пропадает.
  for (const n of neighbors) animateNeighbor(n, dt, n.state === 'seeking'||n.state === 'chase'||!!nightSearch?.started);
  for (const n of neighbors) {
    n.stepped = false;
    if (!n.mesh.userData.footstep) continue;
    const ax = n.pos.x - walker.pos.x, az = n.pos.z - walker.pos.z;
    const d = Math.hypot(ax, az);
    const p = d < 0.001 ? 0 : (ax * Math.cos(walker.yaw) - az * Math.sin(walker.yaw)) / d;
    neighborStep(d, p, n.state === 'seeking'||n.state === 'chase'||!!nightSearch?.started,neighbors.indexOf(n),!clearSight(apartment,walker.pos,n.pos)||!!wardrobes?.active);
  }
  const exposed=clearSight(apartment,walker.pos,closest.pos)&&!hidden;
  heartbeat(hidden?Math.max(3,dist):dist);
  residentBreath(dist,pan,!clearSight(apartment,walker.pos,closest.pos)||!!wardrobes?.active);
  ambientCreak(dt,Math.max(0,1-dist/9));
  if (walker.breath01 <= 0.02) gasp();

  // Кровавая рамка по близости: тревога должна расти до поимки, а не после.
  const near = exposed ? Math.max(0, Math.min(.65, (6 - dist) / 7)) : 0;
  el('danger').style.opacity = String(near);
}

function inWardrobe() {
  return !!wardrobes?.protected&&!wantsLight();
}

function openingGrace(){
  if(!isStoryNight(1))return activeMs<2200&&walker.pos.distanceTo(map.spawns[0].pos)<2;
  // At most six seconds, only in the spawn room. Exploring immediately ends protection.
  return isStoryNight(1) && activeMs<6000 && walker.pos.x<8 && taken<2;
}

function hideWardrobeUI(){for(const id of ['btn-wardrobe','btn-peek','closet-hint'])show(id,false);}
function paintWardrobeUI(){
  const inside=!!wardrobes?.active,near=wardrobes?.nearby(walker.pos);
  el('stick').style.visibility=inside?'hidden':'';el('pace').style.visibility=inside?'hidden':'';
  show('btn-wardrobe',inside||!!near);show('btn-peek',inside);show('closet-hint',inside);
  el('btn-wardrobe').textContent=(controls.io.keyboard?'C · ':'')+window.t(inside?'wardrobeExit':'wardrobeEnter');
  el('btn-peek').textContent=(controls.io.keyboard?'Q · ':'')+window.t(wardrobes?.peek?'wardrobeClose':'wardrobePeek');
  const visitor=neighbors.find(n=>n.inspection&&n.pos.distanceTo(walker.pos)<5);
  const hint=visitor?.inspection.phase==='listen'?'wardrobeListening':visitor?.inspection.phase==='leave'?'wardrobeLeaving':'wardrobeSafe';
  el('closet-hint').textContent=window.t(wantsLight()?'wardrobeLight':wardrobes?.peek?'wardrobeRisk':hint);
}
function toggleWardrobe(){
  if(!running||paused)return;
  const leaving=!!wardrobes?.active;
  const changed=leaving?wardrobes.exit(walker,controls):wardrobes?.enter(walker,controls);
  if(changed){
    wardrobeSound(!leaving);trace(leaving?'wardrobe_exit':'wardrobe_enter');
    if(!leaving&&!openingGrace())for(const n of neighbors){
      const w=wardrobes.active,close=n.pos.distanceTo(w.entry)<6&&clearSight(apartment,n.pos,w.entry);
      const following=(n.state==='seeking'||n.state==='chase')&&n.goal&&Math.hypot(n.goal.x-w.entry.x,n.goal.z-w.entry.z)<3.5;
      if((close||following)&&!neighbors.some(other=>other!==n&&other.inspection?.mount===w))n.investigateWardrobe(w);
    }
    paintWardrobeUI();
  }
}
function togglePeek(){if(!running||paused||!wardrobes?.active)return;wardrobes.peek=!wardrobes.peek;wardrobeSound(wardrobes.peek);paintWardrobeUI();}

/**
 * Метка направления на первой ночи.
 *
 * Сначала я пускал столб ближайшей батарейки СКВОЗЬ стены. Задумывалось как
 * объяснение цели без слов, а читалось как ошибка отрисовки: свет, пробивающий
 * стену, ломает саму фикцию игры про темноту, и владелец сообщил об этом как о
 * баге. Это и был баг — не в коде, а в решении.
 *
 * Теперь направление даёт экранная метка: она очевидно часть интерфейса, а не
 * мира, поэтому ничего не ломает. Позиция берётся проекцией мировой точки, а
 * если батарейка behind или за краем — метка прижимается к краю экрана и
 * показывает, куда повернуться.
 *
 * Живёт только на первой ночи и только до первой поднятой: дальше правило
 * понято, и подсказка превращается в подпорку.
 */
function guideToNearestBattery() {
  const mark = el('guide');
  if (!mark) return;
  const guiding = (isStoryNight(1)||needsStoryNote()&&!apartment.batteries.length||!!nightSearch) && running && !paused && !wardrobes?.active && lesson.stage !== 'sound';
  if (!guiding) { mark.classList.add('hidden'); return; }

  let nearest = null, best = Infinity;
  for (const m of batteryMeshes) {
    const d = m.position.distanceTo(walker.pos);
    if (d < best) { best = d; nearest = m; }
  }
  let label='distance';
  if(lesson.stage==='note'&&worldNote){nearest={position:new THREE.Vector3(worldNote.x,worldNote.y,worldNote.z)};label='guideNote';}
  if(lesson.stage==='change'){
    if(!lesson.changed){mark.classList.add('hidden');return;}
    nearest={position:residentTraces.anchor};label='guideLamp';
  }
  if(lesson.stage==='hide'&&lessonWardrobe){nearest={position:lessonWardrobe.entry.clone().setY(2)};label='guideWardrobe';}
  if(needsStoryNote()&&!apartment.batteries.length&&worldNote){nearest={position:new THREE.Vector3(worldNote.x,worldNote.y,worldNote.z)};label='guideNote';}
  if(nightSearch?.mount){nearest={position:nightSearch.mount.entry.clone().setY(2)};label='guideWardrobe';}
  if (!nearest) { mark.classList.add('hidden'); return; }
  best=nearest.position.distanceTo(walker.pos);

  const v = nearest.position.clone();
  if(label==='distance')v.y += 1.2;
  v.project(camera);

  const behind = v.z > 1;
  // За спиной знак x у проекции переворачивается: без этого метка уезжает в
  // противоположную сторону и уводит игрока не туда.
  let x = (behind ? -v.x : v.x) * 0.5 + 0.5;
  let y = (behind ? 1 : -v.y * 0.5 + 0.5);

  const pad = 46;
  const px = Math.min(window.innerWidth - pad, Math.max(pad, x * window.innerWidth));
  const py = Math.min(window.innerHeight - pad, Math.max(pad, y * window.innerHeight));

  mark.style.left = px + 'px';
  mark.style.top = py + 'px';
  mark.textContent = window.t(label, { n: Math.round(best) });
  mark.classList.remove('hidden');
}

/**
 * Всплывающее число от точки в мире.
 *
 * Мировая точка проецируется камерой в экранную: число обязано вылететь
 * оттуда, где событие произошло, иначе связи с действием не возникает и это
 * просто цифра в углу. Точки позади камеры отбрасываем — спроецированные, они
 * оказываются в зеркальном месте экрана и выглядят ошибкой.
 */
function floatPoints(worldPos, text, big) {
  const layer = el('floaters');
  if (!layer) return;
  const v = worldPos.clone();
  v.project(camera);
  if (v.z > 1) return;                       // за спиной
  const x = (v.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-v.y * 0.5 + 0.5) * window.innerHeight;

  const node = document.createElement('div');
  node.className = 'floater' + (big ? ' big' : '');
  node.textContent = text;
  node.style.left = x + 'px';
  node.style.top = y + 'px';
  layer.appendChild(node);
  // Убираем по концу анимации, а не по таймеру: длительность задана в CSS, и
  // два числа рассинхронизировались бы при первой же правке стиля.
  node.addEventListener('animationend', () => node.remove());
}

/** Снести все всплывающие числа: конец ночи, пауза, меню. */
function clearFloaters() {
  const layer = el('floaters');
  if (layer) layer.textContent = '';
}

function pickUpBatteries() {
  for (let i = batteryMeshes.length - 1; i >= 0; i--) {
    const m = batteryMeshes[i];
    if (m.position.distanceTo(walker.pos) > 1.1) continue;
    if(runMode==='free')battery = Math.min(BATTERY_MAX, battery + BATTERY_PICKUP);
    taken++;
    if(runMode==='story')rememberArchive(window.Platform,m.userData.archiveItem?.id);
    trace('pickup');
    trace('first_pickup', {}, true);
    // 220 — та же цена, что начисляется в конце ночи. Показать её здесь значит
    // связать награду с действием, а не с итоговой таблицей.
    floatPoints(m.position, runMode==='story'?(m.userData.archiveItem?.[window.Platform.getLanguage()==='ru'?'ru':'en'].title||'Archive'):'+' + batteryPoints());
    // Копится за всё время, а не за забег: это и открывает фонари.
    const totalBatteries = (Number(window.Platform.load('totalBatteries', 0)) || 0) + 1;
    window.Platform.save('totalBatteries', totalBatteries);
    const unlocked = FLASHLIGHTS.find(f => f.at === totalBatteries);
    if (unlocked) { lastUnlock = unlocked.id; trace('unlock', { id: unlocked.id }); }
    pickupSting();
    disposeGroup(m);
    batteryMeshes.splice(i, 1);
    // Из данных карты тоже: по длине этого списка игра понимает, что цель
    // ночи выполнена, и он же показывается в задаче сверху.
    apartment.batteries.splice(i, 1);
  }
}

/** Одна полоса: подпись, число и длина заливки. */
function gauge(id, caption, value01) {
  const pct = Math.max(0, Math.min(1, value01));
  el('cap-' + id).textContent = caption;
  el('val-' + id).textContent = Math.round(pct * 100) + '%';
  el('bar-' + id).style.width = (pct * 100) + '%';
  return pct;
}

function wantsLight() { return controls.light && battery > 0; }

function updateHud(now, hidden) {
  const seconds = Math.floor((pressureMs) / 1000);
  // Часы вместо счётчика секунд: «НОЧЬ 7» читалось как ночь длиной в семь
  // секунд, и это была единственная информация о времени, которая у игрока
  // была. Теперь видно и который час, и сколько ночи осталось.
  const t01 = Math.min(1, (pressureMs) / NIGHT_MS);
  const minutes = Math.floor(NIGHT_FROM + (NIGHT_TO - NIGHT_FROM) * t01) % (24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  const left = apartment.batteries.length;
  // Множитель показываем, только когда он есть: «×1» ничего не сообщает.
  const mult = chainMult(night);
  el('hud-top').textContent = window.t(runMode==='free'?'freeNight':'nightTime') + ' ' + night + '   ·   ' + (window.Platform.getLanguage()==='ru'?'ВРЕМЯ ':'TIME ') + hh + ':' + mm +
    '   ·   ' + (runMode==='story'?(window.Platform.getLanguage()==='ru'?'АРХИВ ':'ARCHIVE ')+taken+'/'+(taken+left):window.t('goalBatteries', { n: taken, all: taken + left })) +
    (mult > 1 ? '   ·   ×' + mult : '');
  if(runMode==='story')el('hud-top').textContent+=' · '+window.t(nightNoteRead?'nightNoteDone':'nightNoteMissing');

  const bat = gauge('battery', window.t('battery'), battery / BATTERY_MAX);
  const bre = gauge('breath', window.t('breath'), walker.breath01);
  // Шум — то, что слышит сосед, а не то, как игрок двигается. Показываем ровно
  // ту величину, которая идёт в его порог: иначе полоса врала бы на ковре.
  gauge('noise', window.t('noise'), walker.noise);

  // Мигание только на действительно опасных остатках: мигающий постоянно
  // интерфейс перестают замечать.
  el('g-battery').classList.toggle('low', bat > 0 && bat < 0.2);
  el('g-breath').classList.toggle('low', bre < 0.15);

  let state;
  let alarm = false;
  // Урок показывается своим узлом в центре, а не подменяет строку состояния:
  // строку игрок не замечал вовсе.
  const lessonVisible = !wardrobes?.active && activeMs>=storyCueUntil && isStoryNight(1) && (lesson.stage !== 'done' || activeMs - lessonFinishedAt < 4000);
  const lessonEl = el('lesson');
  if (lessonEl) {
    if (lessonVisible) {
      const key={sound:'introSound',note:'introNote',change:lesson.changed?'introChanged':'introLookAway',hide:controls.io.keyboard?'introShelter':'introShelterTouch'}[lesson.stage];
      lessonEl.textContent=window.t(key||(lesson.stage==='move'?(controls.io.keyboard?'introMove':'introMoveTouch'):(controls.io.keyboard?'introDone':'introDoneTouch')));
    }
    show('lesson', lessonVisible);
  }

  if (now < heardFlashUntil) { state = window.t('heard'); alarm = true; }
  else if (hidden) state = window.t('inWardrobe');
  else if(nightSearch?.started){state=window.t('searchDanger');alarm=true;}
  else if(neighbors.some(n=>n.stare?.phase==='watch')){state=window.t('stareWarning');alarm=true;}
  else if (neighbors.some(n => n.state === 'seeking'||n.state === 'chase')) { state = window.t('searching'); alarm = true; }
  else if (walker.mode === 'still') state = window.t(wantsLight() ? 'standingLit' : 'safeDark');
  else if (walker.mode === 'sneak') state = window.t('sneaking');
  else if (walker.mode === 'hurry') state = window.t('hurrying');
  else state = window.t('walking');
  if (walker.onRug() && walker.mode !== 'still') state += ' · ' + window.t('onRug');
  el('btn-light').classList.toggle('off', !(controls.light && battery > 0));
  el('hud-state').textContent = state;
  el('hud-state').classList.toggle('alarm', alarm);
}

// ── экраны ────────────────────────────────────────────────────────────────

function paintResidentSettings(){
  el('btn-journal').textContent=window.t('journal')+' · '+foundNotes(window.Platform).length+'/7';
  el('btn-pause-journal').textContent=window.t('journal');
  el('btn-scares').textContent=window.t(scaresEnabled()?'scaresOn':'scaresOff');
  el('btn-scares').setAttribute('aria-pressed',String(scaresEnabled()));
}
function readNearbyNote(){
  if(!running||paused||wardrobes?.active||!canRead(apartment,walker.pos,worldNote))return;
  if(worldNote.id==='notice')lesson.read=true;
  residentTraces?.arm(worldNote.id);
  if(worldNote.id===storyNote()?.id){nightNoteRead=true;beginNightSearch();}
    journal?.open(worldNote.id);disposeGroup(paperMesh);paperMesh=null;worldNote=null;show('btn-read',false);
    // Reading the current page reveals any missed earlier pages in the same stack.
    const next=noteForNight(runMode==='free'?STORY_NIGHTS:night,foundNotes(window.Platform));
    if(next)spawnWorldNote(next);
}
function paintMenu() {
  el('btn-opening').textContent=window.Platform.getLanguage()==='ru'?'Посмотреть вступление':'Watch opening';
  paintResidentSettings();
  el('menu-title').textContent = window.t('gameTitle');
  // Логотип свой на каждую локаль: название переведено, значит и начертание
  // должно меняться вместе с языком, иначе английский игрок видит кириллицу.
  const logo = el('menu-logo');
  logo.src = 'assets/ui/logo-' + (window.Platform.getLanguage() === 'en' ? 'en' : 'ru') + '.png';
  logo.alt = window.t('gameTitle');
  el('menu-sub').textContent = window.t('gameSubtitle');
  el('menu-goal').textContent = window.t('goalLine');
  el('rule-noise').textContent = window.t('ruleNoise');
  el('rule-light').textContent = window.t('ruleLight');
  el('rule-hide').textContent = window.t('ruleHide');
  // Рекорд показываем, только когда он есть: «Рекорд ночи: 0» перед первой
  // партией ничего не сообщает и лишь занимает строку.
  const best = window.Platform.load('best', 0) || 0;
  const daily = loadDaily();
  // Две строки, а не одна: общий рекорд говорит «кто я вообще», дневной —
  // «что у меня сегодня». Второе и есть причина зайти завтра.
  const parts = [];
  if (best > 0) parts.push(window.t('bestLine', { n: best }));
  parts.push(window.t('dailyLine', { n: daily.best || 0 }));
  if (daily.streak > 1) parts.push(window.t('streakDays', { n: daily.streak }));
  el('menu-best').textContent = parts.join(' · ');
  const progress=storyProgress(window.Platform),unlockedFree=freePlayUnlocked(window.Platform);
  el('btn-play').textContent = window.t(unlockedFree?'replayStory':progress.night>1?'resumeStory':'play',{n:progress.night});
  el('btn-free').textContent=window.t('freePlay');el('btn-free').disabled=!unlockedFree;
  el('free-hint').textContent=window.t(unlockedFree?'freeAvailable':'freeLocked');
  // Фонари: кнопка появляется только когда открыт больше одного.
  const unlocked = unlockedLights(window.Platform.load('totalBatteries', 0) || 0);
  const active = currentLight();
  const torch = el('btn-torch');
  show('btn-torch', true);
  torch.disabled = unlocked.length < 2;
  el('menu-progress').textContent = progressCopy();
  torch.textContent = window.t('torchName' + active.id) + ' · ' + (FLASHLIGHTS.findIndex(light=>light.id===active.id)+1) + '/' + FLASHLIGHTS.length;

  el('menu-hint').textContent = controls.io.keyboard ? window.t('hintKeyboard') : window.t('hintTouch');
  // Значки вместо надписей: подпись остаётся в aria-label, чтобы кнопка не
  // потеряла смысл для скринридера и для игрока, который её задержал пальцем.
  const en = window.Platform.getLanguage() === 'en';
  el('menu-help-title').textContent = en ? 'Controls and rules' : 'Управление и правила';
  el('btn-sound').classList.toggle('off', !window.Sfx.enabled);
  el('btn-sound').setAttribute('aria-label',
    window.Sfx.enabled ? window.t('soundOn') : window.t('soundOff'));
  el('btn-lang').setAttribute('aria-label', window.t('languageSwitch'));
  el('flag-ru').style.display = en ? 'block' : 'none';
  el('flag-en').style.display = en ? 'none' : 'block';
  el('btn-retry').textContent = window.t('retry');
  el('btn-revive').textContent = window.t('revive');
  el('btn-menu').textContent = window.t('menu');
}

function openMenu() {
  storyOpening.finish(false);
  nightEnding.finish(false);show('ending',false);hideWardrobeUI();show('story-cue',false);window.Sfx.setPaused?.(false);
  catchShot.finish(false);journal?.close(false);show('btn-read',false);show('light-notice',false);
  controls.active = false; controls.reset();
  hideLesson(); show('guide', false); show('touch-controls', false);
  show('screen-result', false);
  show('screen-night', false);
  showHud(false);
  show('screen-menu', true);
  paintMenu();
  playMusic('menu');
  window.Platform.goal(window.Platform.EVENTS.MENU_OPEN);
}

/**
 * Встать на паузу.
 *
 * Esc при захваченном указателе браузеру не отдать: он съедает клавишу сам и
 * освобождает мышь. Поэтому пауза висит на потере захвата, а не на клавише —
 * для игрока это неотличимо, он жмёт Esc и получает меню.
 *
 * Раньше здесь была просьба кликнуть, а игра продолжала идти: сосед ходил,
 * заряд тратился, и вернуться в неё игрок мог уже проигравшим.
 */
function setPaused(on) {
  if (!running || paused === on || (!on && journal?.opened)) return;
  if(!on&&(document.hidden||(!controls.io.keyboard&&innerHeight>innerWidth)))return;
  paused = on;
  window.Sfx.setPaused?.(on);
  controls.active = !on; controls.reset();
  paintTouch();
  if (on) { hideWardrobeUI();show('story-cue',false);hideLesson(); show('guide', false); show('btn-read',false); show('light-notice',false); }
  trace(on ? 'pause' : 'resume');
  el('pause').classList.toggle('on', on);
  paintPause();
  if (on) {
    window.Platform.gameplayStop();
    stopHeart();
    el('danger').style.opacity = '0';
    if (document.pointerLockElement) document.exitPointerLock();
  } else {
    // Время кадра сбрасываем: без этого первый кадр после паузы получит dt за
    // всё время простоя и телепортирует игрока вместе с соседом.
    lastFrame = performance.now();
    window.Platform.gameplayStart();
    controls.grabLook();
  }
  refreshMusic();
}

function paintPause() {
  paintResidentSettings();
  el('pause-title').textContent = window.t('pauseTitle');
  el('pause-hint').textContent = controls.io.keyboard ? window.t('pauseHint') : '';
  el('btn-resume').textContent = window.t('resume');
  el('btn-quit').textContent = window.t('menu');
  el('btn-pause-sound').textContent = window.Sfx.enabled ? window.t('soundOn') : window.t('soundOff');
}

/**
 * Заслон «поверните телефон».
 *
 * Портрет для этой игры нерабочий: зоны управления сжимаются до пальца, а
 * обзор по горизонтали урезан вдвое. Партию при этом ставим на паузу —
 * продолжать вслепую хуже, чем остановиться.
 */
function refreshOrientation() {
  const needTurn = !controls.io.keyboard && innerHeight > innerWidth;
  el('rotate-copy').textContent = window.t('rotate');
  el('rotate').classList.toggle('on', needTurn);
  if (needTurn && running && !paused) setPaused(true);
  if(needTurn&&storyOpening.active)storyOpening.setSuspended(true);
}

function startNextNight(){
  if(storyOpening.active)return;
  if(runMode!=='story'||isStoryFinal()){isStoryFinal()?startRun(false,'free'):startRun(true);return;}
  show('screen-night',false);stopHeart();playMusic('opening');window.Sfx.setPaused?.(false);
  startRun(true);
}
function startOpening(preview=false) {
  if(storyOpening.active)return;
  running=false;paused=false;controls.active=false;controls.reset();
  window.Platform.gameplayStop();stopHeart();showHud(false);hideLesson();show('guide',false);show('touch-controls',false);
  show('screen-menu',false);show('screen-result',false);show('screen-night',false);
  if(document.pointerLockElement)document.exitPointerLock();
  playMusic('opening');window.Sfx.setPaused?.(false);
  storyOpening.start(()=>{
    window.Platform.save('storyOpeningV1',true);
    if(preview)openMenu();else startRun(false,'story',!freePlayUnlocked(window.Platform));
  },preview);
  storyOpening.setSuspended(false);refreshOrientation();
}

function playStory(){
  const resume=!freePlayUnlocked(window.Platform);
  if(shouldShowOpening(window.Platform,resume))startOpening();else startRun(false,'story',resume);
}

/**
 * Выход в меню из паузы. Вынесено из обработчика намеренно.
 *
 * Тело обработчика разрослось, и опись мест показа рекламы перестала видеть
 * рядом с вызовом след ввода — сообщала «следа ввода рядом нет». Само правило
 * п. 4.4 при этом не нарушалось: `showInterstitial` отказывает без недавнего
 * жеста игрока. Но подсказка, которая шумит на исправном коде, быстро
 * перестаёт что-либо значить, поэтому проще держать обработчик коротким.
 */
function quitToMenu() {
  trace('run_abandoned');
  paused = false;
  running = false;
  el('pause').classList.remove('on');
  el('btn-pause').classList.remove('on');
  el('btn-light').classList.remove('on');
  showHud(false);
  window.Platform.gameplayStop();
  window.Platform.showInterstitial('pause', () => openMenu());
}

function wireScreens() {
  el('opening-next').addEventListener('click',()=>storyOpening.advance());
  el('opening-skip').addEventListener('click',()=>storyOpening.skip());
  el('opening-pause').addEventListener('click',()=>{if(document.hidden||(!controls.io.keyboard&&innerHeight>innerWidth))return;storyOpening.setSuspended(!storyOpening.suspended);window.Sfx.setPaused?.(storyOpening.suspended);});
  el('btn-opening').addEventListener('click',()=>startOpening(true));
  journal=createJournal({getState:()=>({running,paused}),pause:setPaused,trace,onClose:paperSound});
  el('btn-journal').addEventListener('click',()=>journal.open());
  el('btn-pause-journal').addEventListener('click',()=>journal.open());
  el('btn-read').addEventListener('click',readNearbyNote);
  el('btn-wardrobe').addEventListener('click',toggleWardrobe);
  el('btn-peek').addEventListener('click',togglePeek);
  el('ending-next').addEventListener('click',()=>nightEnding.advance());
  el('btn-scares').addEventListener('click',()=>{window.Platform.save('scares',!scaresEnabled());paintResidentSettings();});
  window.addEventListener('keydown',e=>{
    if(storyOpening.active){
      if(e.code==='Escape'&&!e.repeat){e.preventDefault();if(!controls.io.keyboard&&innerHeight>innerWidth)return;storyOpening.setSuspended(!storyOpening.suspended);window.Sfx.setPaused?.(storyOpening.suspended);}
      return;
    }
    if(catchShot.active){if(e.code==='Escape'&&!e.repeat)catchShot.skip(performance.now());return;}
    if(nightEnding.active){if(['KeyF','Enter','Escape'].includes(e.code)&&!e.repeat){e.preventDefault();nightEnding.advance();}return;}
    if(e.code==='KeyC'&&!e.repeat)toggleWardrobe();
    if(e.code==='KeyQ'&&!e.repeat)togglePeek();
    if(e.code==='KeyR'&&!e.repeat)readNearbyNote();
  });

  el('btn-play').addEventListener('click', () => { trace('play_clicked'); playStory(); });
  el('btn-free').addEventListener('click',()=>startRun(false,'free'));
  for (const mode of ['sneak','walk','hurry']) el('mode-' + mode).addEventListener('click', () => {
    if (!running || paused) return;
    controls.setTouchMode(mode); paintTouch(); trace('movement_mode', { mode });
  });
  window.addEventListener('input-touch', paintTouch);
  const suspendOpening=()=>{if(storyOpening.active){storyOpening.setSuspended(true);window.Sfx.setPaused?.(true);}};
  window.addEventListener('blur', () => { if (running) setPaused(true);suspendOpening(); });
  document.addEventListener('visibilitychange', () => { if(document.hidden){if(running)setPaused(true);suspendOpening();} });

  // Тач: захвата указателя нет и Esc нет — нужна видимая кнопка.
  el('btn-pause').addEventListener('click', () => setPaused(true));
  // Фонарь на тач-вводе. До этой кнопки погасить свет можно было только
  // клавишей F, то есть на телефоне игра шла без главного способа уцелеть.
  el('btn-light').addEventListener('click', () => {
    if (!running || paused) return;
    controls.toggleLight();
  });
  el('btn-resume').addEventListener('click', () => setPaused(false));
  el('btn-quit').addEventListener('click', quitToMenu);
  el('btn-pause-sound').addEventListener('click', () => {
    window.Sfx.toggle();
    refreshMusic();
    paintPause();
  });

  // Потеря захвата во время партии — это и есть Esc игрока.
  addEventListener('resize', refreshOrientation);
  addEventListener('orientationchange', refreshOrientation);
  window.addEventListener('platform-language', refreshOrientation);
  refreshOrientation();

  window.addEventListener('look-lock', e => {
    if (running && controls.io.keyboard && !(e.detail && e.detail.locked)) setPaused(true);
  });

  // Реклама висит на кнопках, уводящих с экрана результата, — и только там.
  // Появление экрана действием игрока не считается, именно за это снимают
  // игры с публикации (п. 4.4).
  el('btn-revive').addEventListener('click', reviveForAd);
  el('btn-retry').addEventListener('click', () =>
    { trace('retry_clicked'); startRun(false,runMode,runMode==='story'); });
  el('btn-menu').addEventListener('click', () =>
    window.Platform.showInterstitial('menu', () => openMenu()));

  // Заслон между ночами. Ролик показываем по нажатию «Дальше», а не по
  // появлению экрана: показ без действия игрока — прямое нарушение п. 4.4.
  el('btn-next').addEventListener('click', () =>
    window.Platform.showInterstitial('night', () => startNextNight()));
  /*
    Удвоение счёта ночи. Награда — строго внутри onRewarded: при закрытии
    ролика без просмотра не начисляется ничего. Второй колбэк обязателен —
    без него отказ рекламы выглядел бы как сломанная кнопка, что уже было
    с воскрешением.
  */
  el('btn-night-double').addEventListener('click', () => {
    if (doubledThisNight) return;
    const btn = el('btn-night-double');
    btn.disabled = true;
    btn.textContent = window.t('adLoading');
    const restore = key => {
      btn.disabled = false;
      btn.textContent = window.t(key, { n: lastNightEarned });
      if (key === 'adFailed') {
        setTimeout(() => { if (!doubledThisNight) btn.textContent = window.t('doubleNight', { n: lastNightEarned }); }, 2600);
      }
    };
    window.Platform.showRewarded(() => {
      doubledThisNight = true;
      chainScore += lastNightEarned;
      const best = window.Platform.saveBest('best', chainScore);
      el('night-stats').textContent =
        (runMode==='story'?(window.Platform.getLanguage()==='ru'?'Архив: ':'Archive: ')+taken:window.t('batteriesTaken', { n: taken })) + ' · ' +
        window.t('resultScore', { n: chainScore }) + ' · ' +
        window.t('resultBest', { n: best });
      btn.disabled = true;
      btn.textContent = window.t('doubleDone');
    }, granted => { if (!granted && !doubledThisNight) restore('adFailed'); });
  });

  el('btn-night-menu').addEventListener('click', () =>
    window.Platform.showInterstitial('menu', () => openMenu()));

  el('btn-torch').addEventListener('click', () => {
    const unlocked = unlockedLights(window.Platform.load('totalBatteries', 0) || 0);
    const i = unlocked.findIndex(f => f.id === currentLight().id);
    const next = unlocked[(i + 1) % unlocked.length];
    window.Platform.save('light', next.id);
    paintMenu();
  });

  el('btn-sound').addEventListener('click', () => {
    window.Sfx.toggle();
    refreshMusic();
    paintMenu();
  });

  el('btn-lang').addEventListener('click', () => {
    window.Platform.setLanguage(window.Platform.getLanguage() === 'ru' ? 'en' : 'ru');
    paintMenu();
  });
}

// ── запуск ────────────────────────────────────────────────────────────────

async function boot() {
  await window.Platform.init({
    id: CONFIG.id,
    leaderboard: CONFIG.leaderboard,
    counterId: CONFIG.counterId,
  });
  window.Platform.isPlaying = () => running && !paused;
  window.Platform.goalOnce(window.Platform.EVENTS.SESSION_START);

  window.Sfx.init();
  window.Sfx.enabled = window.Platform.load('sound', true) !== false;
  initScare();
  prepareRecordedAudio();
  watchMusic();
  window.I18N.applyDocument();

  await Promise.all([prepareHunter(),prepareSurfaces(),prepareRoomMaterials(),prepareStoryPhoto(),prepareCarpets()]);
  buildScene();
  controls = new Controls(el('view'));
  wireScreens();
  openMenu();

  // Загрузочный экран площадки снимаем, только когда игра действительно
  // готова: ранний ready() показывает игроку пустой экран.
  window.Platform.loadingReady();
  trace('game_loaded');
  el('preloader').classList.add('hidden');

  requestAnimationFrame(frame);
}

/**
 * Показать причину прямо на загрузочном экране.
 *
 * Раньше сбой в boot() оставлял вечный спиннер: игрок видел «Загрузка…» и не
 * получал ни одного намёка, а разработчик — только рассказ «ничего не
 * запустилось». Молчаливое зависание нарушает то же правило, что и молчащий
 * сторож: отказ обязан быть громким.
 */
function showBootFailure(err) {
  const copy = el('preloader-copy');
  const spin = el('spin');
  if (spin) spin.style.display = 'none';
  if (!copy) return;

  copy.style.whiteSpace = 'pre-wrap';
  copy.style.maxWidth = '32em';
  copy.style.lineHeight = '1.6';

  const message = String((err && err.message) || err || '');

  // Отсутствие WebGL — не поломка игры, а состояние машины игрока. Показывать
  // ему трассировку стека нельзя: он не разработчик, а на модерации такой
  // экран читается как неработающая игра.
  if (message === 'WEBGL_UNAVAILABLE' || /webgl/i.test(message)) {
    copy.style.color = '#cfe0ea';
    copy.textContent = window.t('noWebgl') + '\n\n' + window.t('noWebglHelp');
    return;
  }

  copy.style.color = '#d08a34';
  copy.textContent = window.t('loadFailed') + '\n\n' + window.t('loadFailedHelp');
  console.error('Game loading failed:', err);
}

/**
 * Ошибка во время партии — это не сбой загрузки.
 *
 * Перехватчик писал в загрузочный экран всегда. Пока игра грузится, это верно;
 * но после старта преloader уже скрыт, и текст уходил в невидимый узел: игрок
 * оставался в наполовину сломанной партии без единого слова, а мы — без следа.
 * По статистике площадки такие падения есть: 0,65% партий.
 *
 * Теперь ошибка в партии честно её заканчивает — тем же путём, что поимка.
 * Игрок получает экран результата с накопленным счётом вместо застывшей игры,
 * а не теряет всё, что успел собрать.
 */
function handleRuntimeError(err) {
  if (!running) return showBootFailure(err);
  console.error('[game] ошибка во время партии:', err);
  try { endRun('error'); }
  catch (_) { showBootFailure(err); }
}

// Ловим и то, что упало вне boot(): необработанные отказы промисов и ошибки
// загрузки модулей сюда же, иначе они остаются только в консоли.
addEventListener('error', e => handleRuntimeError(e.error || e.message));
addEventListener('unhandledrejection', e => handleRuntimeError(e.reason));

boot().catch(showBootFailure);

// Отладочная ручка для автопроверок: только на локальном хосте.
if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
  window.__echo = {
    state: () => ({ running, paused, night, battery, taken, runMode,
      light: controls && controls.light, raise: +flashRaise.toFixed(3),
      mode: walker && walker.mode }),
    controls: () => controls,
    lesson: () => ({ stage: lesson.stage, activeMs }),
    scene: () => scene,
    // Ручной рендер нужен автопроверкам: в скрытой вкладке requestAnimationFrame
    // не тикает, и замерить яркость кадра иначе невозможно.
    render: () => renderer.render(scene, camera),
    lights: () => ({
      ambient: ambient.intensity,
      glow: playerGlow.intensity,
      flash: flashlight.intensity,
      fog: scene.fog.density,
    }),
    walker: () => walker,
    neighbor: () => neighbor,
    neighbors:()=>neighbors,
    apartment: () => apartment,
    story:()=>({note:worldNote,found:foundNotes(window.Platform),catchActive:catchShot.active,nightNoteRead,search:nightSearch&&{age:nightSearch.age,started:nightSearch.started}}),
    traces:()=>residentTraces,
    wardrobes:()=>wardrobes,
    audio:audioSnapshot,
    ending:()=>({active:nightEnding.active,time:nightEnding.time}),
    previewSunlight:()=>{
      if(!nightEnding.active||nightEnding.phase!=='light')return;
      nightEnding.update(1,renderer,innerWidth/innerHeight);nightEnding.advance();
      nightEnding.update(5.3,renderer,innerWidth/innerHeight);nightEnding.advance();
      nightEnding.advance();nightEnding.update(3.6,renderer,innerWidth/innerHeight);
      nightEnding.update(5.8,renderer,innerWidth/innerHeight);
    },
    startRun, endRun,
    inspect:{
      opening(){if(!window.Platform.debug)return;nightEnding.finish(false);storyOpening.finish(false);startOpening(true);},
      start(chapter,enabled=true){
        if(!window.Platform.debug)return false;
        const n=Math.max(1,Math.min(7,Math.floor(Number(chapter)||1)));
        inspection.enabled=!!enabled;window.Platform.save('campaignV2',{version:2,night:n,score:0});
        startRun(false,'story',true);lesson.stage='done';hideLesson();return true;
      },
      room(index){
        if(!window.Platform.debug||!running)return false;const r=apartment.rooms[index];if(!r)return false;
        const cells=[];for(let z=r.z0;z<=r.z1;z++)for(let x=r.x0;x<=r.x1;x++)if(apartment.wallGrid[z]?.[x]===false&&!apartment.occupied.has(z+','+x))cells.push({x:x+.5,z:z+.5});
        cells.sort((a,b)=>Math.hypot(a.x-r.cx,a.z-r.cz)-Math.hypot(b.x-r.cx,b.z-r.cz));
        if(!cells.length)return false;if(wardrobes?.active)wardrobes.exit(walker,controls);
        walker.pos.set(cells[0].x,1,cells[0].z);walker.pitch=0;return true;
      },
      light(value){if(window.Platform.debug)ambient.intensity=Math.max(.55,Math.min(3,Number(value)||.55));},
      resume(){if(window.Platform.debug){setPaused(false);controls.grabLook();}},
      finale(){if(!window.Platform.debug)return;window.Platform.save('notesV1',NOTES.map(n=>n.id));this.start(7,true);endRun('won');},
      position:()=>walker?({night,room:apartment.rooms.findIndex(r=>walker.pos.x>=r.x0&&walker.pos.x<=r.x1+1&&walker.pos.z>=r.z0&&walker.pos.z<=r.z1+1),x:+walker.pos.x.toFixed(2),y:+walker.pos.y.toFixed(2),z:+walker.pos.z.toFixed(2),yaw:+walker.yaw.toFixed(3),pitch:+walker.pitch.toFixed(3)}):null
    },
    startOpening,
    opening:()=>({active:storyOpening.active,phase:storyOpening.phase,time:storyOpening.time,suspended:storyOpening.suspended}),
  };
}
