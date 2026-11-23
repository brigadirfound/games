// Редактор скинов: цвета тела/пушек/эффектов с живым 3D-превью.
// Пишет тот же формат, что skins/default.json. Задел под донат-магазин.
import * as THREE from 'three';
import { buildWeaponModel } from './weapons.js';
import { tileCanvas, onAtlasReady, getSkinSurface, scaleBoxUV } from './textures.js';
import { FIGURE_PARTS, partArt } from './figure.js';
import {
  ALLOWED_IMAGE_TYPES,
  ART_SIZE,
  MAX_IMAGE_BYTES,
  MASK_PRESETS,
  boxMaterials,
  imageToArt,
  sanitizeArt,
} from './face.js';
import { t, localizedName } from './i18n.js';
import { Platform } from './platform.js';

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const MAX_CUSTOM_PARTS = 64;

const FIELDS = [
  { path: 'body.head', label: 'partHead', panel: 'skin-body' },
  { path: 'body.torso', label: 'partTorso', panel: 'skin-body' },
  { path: 'body.arms', label: 'partArms', panel: 'skin-body' },
  { path: 'body.legs', label: 'partLegs', panel: 'skin-body' },
  { path: 'weapons.pistol.body', label: 'partBody', panel: 'skin-pistol' },
  { path: 'weapons.pistol.grip', label: 'partGrip', panel: 'skin-pistol' },
  { path: 'weapons.pistol.accent', label: 'partAccent', panel: 'skin-pistol' },
  { path: 'weapons.smg.body', label: 'partBody', panel: 'skin-smg' },
  { path: 'weapons.smg.grip', label: 'partGrip', panel: 'skin-smg' },
  { path: 'weapons.smg.accent', label: 'partAccent', panel: 'skin-smg' },
  { path: 'weapons.ar.body', label: 'partBody', panel: 'skin-ar' },
  { path: 'weapons.ar.grip', label: 'partGrip', panel: 'skin-ar' },
  { path: 'weapons.ar.accent', label: 'partAccent', panel: 'skin-ar' },
  { path: 'weapons.shotgun.body', label: 'partBody', panel: 'skin-shotgun' },
  { path: 'weapons.shotgun.grip', label: 'partWood', panel: 'skin-shotgun' },
  { path: 'weapons.shotgun.accent', label: 'partAccent', panel: 'skin-shotgun' },
  { path: 'weapons.sniper.body', label: 'partBody', panel: 'skin-sniper' },
  { path: 'weapons.sniper.grip', label: 'partGrip', panel: 'skin-sniper' },
  { path: 'weapons.sniper.accent', label: 'partAccent', panel: 'skin-sniper' },
  { path: 'weapons.railgun.body', label: 'partBody', panel: 'skin-railgun' },
  { path: 'weapons.railgun.grip', label: 'partGrip', panel: 'skin-railgun' },
  { path: 'weapons.railgun.accent', label: 'partGlow', panel: 'skin-railgun' },
  { path: 'tracer', label: 'partTracer', panel: 'skin-fx' },
  { path: 'railTracer', label: 'partRailTracer', panel: 'skin-fx' },
  { path: 'ghostTint', label: 'partGhostTint', panel: 'skin-fx' },
];

const PANEL_IDS = [...new Set(FIELDS.map((field) => field.panel))];
const MODEL_KEYS = ['pistol', 'shotgun', 'railgun', 'smg', 'ar', 'sniper'];
const get = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);
const set = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((target, key) => (target[key] ??= {}), obj)[last] = value;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function safeTriplet(value, min, max) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const result = value.map(Number);
  return result.every((number) => Number.isFinite(number) && number >= min && number <= max)
    ? result
    : null;
}

function sanitizeModels(models) {
  if (!models || typeof models !== 'object' || Array.isArray(models)) return undefined;
  const result = {};
  for (const key of MODEL_KEYS) {
    const parts = models[key];
    if (!Array.isArray(parts) || parts.length > MAX_CUSTOM_PARTS) continue;
    const safe = [];
    for (const part of parts) {
      const size = safeTriplet(part?.size, 0.01, 4);
      const pos = safeTriplet(part?.pos, -8, 8);
      const color = typeof part?.color === 'string' &&
        (['body', 'grip', 'accent'].includes(part.color) || COLOR_RE.test(part.color))
        ? part.color
        : null;
      if (size && pos && color) safe.push({ size, pos, color });
    }
    if (safe.length) result[key] = safe;
  }
  return Object.keys(result).length ? result : undefined;
}

/*
  Что вообще можно рисовать и с какой крупностью клетки.

  Раньше редактор знал только про лицо и торс, а всё остальное молча выбрасывал:
  открыть купленный скин, ничего не тронуть и сохранить — значило потерять уши,
  затылок, спину, рукав и штанину. Крупность у каждого куска своя и повторяет
  ту, в которой кусок нарисован: рукав в восемь клеток, лицо в тридцать две.
  Пережимать всё под одну сетку тоже нельзя — лицо теряло бы половину деталей
  просто оттого, что его открыли.
*/
const ART_PIECES = [
  { key: 'face', size: 32, label: 'skinTargetFace' },
  { key: 'torso', size: 32, label: 'skinTargetTorso' },
  { key: 'ear', size: 16, label: 'skinTargetEar' },
  { key: 'headBack', size: 16, label: 'skinTargetHeadBack' },
  { key: 'torsoBack', size: 24, label: 'skinTargetTorsoBack' },
  { key: 'arm', size: 8, label: 'skinTargetArm' },
  { key: 'leg', size: 8, label: 'skinTargetLeg' },
];
const ART_SIZE_BY_KEY = Object.fromEntries(ART_PIECES.map((p) => [p.key, p.size]));

function toEditorArt(art, key) {
  return sanitizeArt(art, ART_SIZE_BY_KEY[key] ?? ART_SIZE);
}

function normalizeSkin(source, fallback) {
  const result = clone(fallback);
  for (const field of FIELDS) {
    const value = get(source, field.path);
    if (typeof value === 'string' && COLOR_RE.test(value)) set(result, field.path, value.toLowerCase());
  }
  // Рисунок берём ТОЛЬКО из источника: подмешивать сюда куски запасного скина
  // значило бы, что стёртое ухо возвращается само.
  result.art = {};
  for (const piece of ART_PIECES) {
    if (source?.art?.[piece.key]) result.art[piece.key] = toEditorArt(source.art[piece.key], piece.key);
  }
  // Лицо и одежда должны существовать всегда: с них начинается рисование.
  for (const key of ['face', 'torso']) result.art[key] ??= toEditorArt(null, key);
  const models = sanitizeModels(source?.models);
  if (models) result.models = models;
  else delete result.models;
  return result;
}

function disposeObject(root, disposed = {}) {
  const geometries = disposed.geometries ??= new WeakSet();
  const materials = disposed.materials ??= new WeakSet();
  const textures = disposed.textures ??= new WeakSet();
  root?.traverse?.((object) => {
    if (object.geometry && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose?.();
    }
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture && !textures.has(value)) {
          textures.add(value);
          value.dispose();
        }
      }
      material.dispose?.();
    }
  });
  return disposed;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    const timer = setTimeout(() => finish(new Error('image timeout')), 10_000);
    const finish = (error) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(image);
    };
    image.onload = () => finish();
    image.onerror = () => finish(new Error('image decode failed'));
    image.src = url;
  });
}

/** Вертикальный градиент вместо ровной заливки за спиной персонажа. */
function buildStageSky() {
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#151c2e');
  gradient.addColorStop(0.6, '#2a3550');
  gradient.addColorStop(1, '#4a5a76');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/*
  Текстура витрины из общего атласа.

  Раньше тайл забирался картинкой по data-URL один раз при сборке сцены, и
  витрина навсегда оставалась с процедурными тайлами по шестнадцать пикселей.
  Теперь холст остаётся у нас: когда испечённый атлас догрузится, мы
  перерисуем его на месте и скажем текстуре обновиться.
*/
function stageTexture(name, color, repeat) {
  const canvas = tileCanvas(name, color, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.repeat.set(repeat, repeat);
  onAtlasReady(() => { tileCanvas(name, color, 256, canvas); texture.needsUpdate = true; });
  return texture;
}

/** Подиум и кольцо блоков: персонажу нужна сцена, а не две заливки. */
function buildSkinStage() {
  const group = new THREE.Group();
  const podium = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 0.4, 5.2),
    new THREE.MeshLambertMaterial({ map: stageTexture('stone', '#6a7484', 3) }),
  );
  podium.position.y = -0.2;
  podium.receiveShadow = true;
  group.add(podium);

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 0.24, 6.4),
    new THREE.MeshLambertMaterial({ map: stageTexture('metal', '#3a4553', 4) }),
  );
  rim.position.y = -0.42;
  rim.receiveShadow = true;
  group.add(rim);

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(60, 0.5, 60),
    new THREE.MeshLambertMaterial({ map: stageTexture('grass_dirt', '#3f6b2e', 30) }),
  );
  ground.position.y = -0.75;
  ground.receiveShadow = true;
  group.add(ground);

  // Кольцо блоков разной высоты — глубина кадра при вращении превью.
  const pillarMaterial = new THREE.MeshLambertMaterial({ map: stageTexture('crate', '#8a6a45', 1) });
  const pillarGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const height = 0.6 + ((i * 7) % 5) * 0.45;   // без Math.random: вид стабилен
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.scale.set(0.9, height, 0.9);
    pillar.position.set(Math.cos(angle) * 5.6, height / 2 - 0.5, Math.sin(angle) * 5.6);
    group.add(pillar);
  }
  return group;
}

/** Инициализирует редактор и возвращает контроллер жизненного цикла. */
export async function initSkinEditor(status) {
  const canvas = document.getElementById('skin-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  /*
    Витрина показывает то же, что арена, поэтому и настройки те же.

    Раньше здесь не было теней вовсе: персонаж висел над подиумом без
    единой точки касания, и объём читался только по граням. Своя тень —
    первое, чего ищет взгляд, когда смотрит на фигуру.
  */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#232a33');
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  camera.position.set(0, 1.6, 4.2);
  camera.lookAt(0, 1, 0);
  scene.add(new THREE.HemisphereLight('#bcd4e8', '#3a3348', 0.78));
  const sun = new THREE.DirectionalLight('#fff4d6', 2.4);
  sun.position.set(3.4, 5, 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4; sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4; sun.shadow.camera.bottom = -4;
  sun.shadow.camera.far = 20;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight('#8fb4dd', 0.5);
  fill.position.set(-3, 2.4, -2.6);
  scene.add(sun, fill);
  // Раньше персонаж крутился между серым фоном и зелёной плитой, а половина
  // пушек тонула в этой плите. Теперь это блочная витрина: подиум, кольцо
  // блоков вокруг и градиентное небо — те же тайлы, что в самой игре.
  const stage = buildSkinStage();
  scene.add(stage);
  scene.background = buildStageSky();
  scene.fog = new THREE.Fog('#20283a', 14, 30);

  const defaultResponse = await fetch('skins/default.json');
  if (!defaultResponse.ok) throw new Error(`default skin: HTTP ${defaultResponse.status}`);
  const defaultSkin = await defaultResponse.json();
  let skin = normalizeSkin((await Platform.loadSkin()) ?? defaultSkin, defaultSkin);
  // Модель уже стоит лицом к камере, поэтому стартовый угол нулевой. Важно
  // другое: угол переживает пересборку — раньше смена маски или цвета сбрасывала
  // поворот, и персонаж внезапно оказывался спиной.
  const FRONT_ANGLE = 0;
  let previewAngle = FRONT_ANGLE;
  let preview = new THREE.Group();
  preview.rotation.y = previewAngle;
  scene.add(preview);

  let disposed = false;
  let raf = 0;
  let lastFrame = performance.now();
  let rebuildRequested = true;
  let paintingPointer = null;
  let eraser = false;
  const cleanups = [];
  const retired = new Map();
  const disposedResources = {};
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    cleanups.push(() => target.removeEventListener(type, handler, options));
  };

  const retire = (group) => {
    scene.remove(group);
    disposeObject(group, disposedResources);
    // GLTF-клоны могут добавиться в holder после удаления. Пока страница жива,
    // повторно осматриваем retired-группу и освобождаем поздние материалы.
    retired.set(group, performance.now() + 30_000);
  };
  const drainRetired = (force = false) => {
    const now = performance.now();
    for (const [group, deadline] of retired) {
      disposeObject(group, disposedResources);
      if (force || now >= deadline) retired.delete(group);
    }
  };

  function rebuild() {
    const oldPreview = preview;
    preview = new THREE.Group();
    preview.rotation.y = previewAngle;
    scene.add(preview);
    retire(oldPreview);

    // Та же карта поверхности и та же плотность, что у бойца на арене:
    // витрина обязана показывать скин ровно таким, каким его увидят в бою.
    const part = (width, height, depth, color, x, y, z) => {
      const mesh = new THREE.Mesh(
        scaleBoxUV(new THREE.BoxGeometry(width, height, depth), Math.max(width, height, depth), true),
        new THREE.MeshLambertMaterial({ color, map: getSkinSurface(skin.id) }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x, y, z);
      preview.add(mesh);
    };
    const artPart = (width, height, depth, color, art, x, y, z) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        boxMaterials((hex) => new THREE.MeshLambertMaterial({ color: hex }), color, art),
      );
      mesh.position.set(x, y, z);
      preview.add(mesh);
    };

    const body = skin.body;
    // Те же детали, что в бою: список общий, витрина не может соврать.
    for (const d of FIGURE_PARTS) {
      const рисунок = partArt(d, skin.art);
      const f = рисунок ? artPart : part;
      if (рисунок) f(d.size[0], d.size[1], d.size[2], body[d.color], рисунок, d.pos[0], d.pos[1], d.pos[2]);
      else f(d.size[0], d.size[1], d.size[2], body[d.color], d.pos[0], d.pos[1], d.pos[2]);
    }

    // Витрина: пушки стоят по дуге на уровне пояса и смотрят наружу. Сетка
    // 3×2 уводила нижний ряд под пол.
    [0, 1, 2, 3, 4, 5].forEach((id) => {
      const weapon = buildWeaponModel(id, skin);
      weapon.scale.setScalar(1);
      const angle = -Math.PI * 0.62 + (id / 5) * Math.PI * 1.24;
      const radius = 2.05;
      weapon.position.set(Math.sin(angle) * radius, 1.02, Math.cos(angle) * radius);
      weapon.rotation.y = angle + Math.PI / 2;
      preview.add(weapon);
    });
    const tracer = (color, y) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.04, 2.4),
        new THREE.MeshBasicMaterial({ color }),
      );
      mesh.position.set(1.6, y, 0);
      mesh.rotation.y = 0.4;
      preview.add(mesh);
    };
    tracer(skin.tracer, 1.7);
    tracer(skin.railTracer, 1.85);
  }

  const requestRebuild = () => { rebuildRequested = true; };

  function buildForm() {
    for (const id of PANEL_IDS) document.getElementById(id).replaceChildren();
    for (const field of FIELDS) {
      const row = document.createElement('div');
      row.className = 'crow';
      const label = document.createElement('span');
      label.dataset.i18n = field.label;
      label.textContent = t(field.label);
      const input = document.createElement('input');
      input.type = 'color';
      input.value = get(skin, field.path);
      input.addEventListener('input', () => {
        set(skin, field.path, input.value);
        requestRebuild();
      });
      row.append(label, input);
      document.getElementById(field.panel).append(row);
    }
  }

  const pixCanvas = document.getElementById('pix-canvas');
  const pixContext = pixCanvas.getContext('2d', { willReadFrequently: false });
  const target = () => document.getElementById('pix-target').value;
  const getArt = () => {
    skin.art ??= {};
    skin.art[target()] = toEditorArt(skin.art[target()], target());
    return skin.art[target()];
  };

  // Сетка подстраивается под кусок: у рукава восемь клеток, у лица тридцать две.
  function drawPixels() {
    const art = getArt();
    const n = art.size;
    const cell = pixCanvas.width / n;
    for (let i = 0; i < n * n; i++) {
      const x = (i % n) * cell;
      const y = Math.floor(i / n) * cell;
      pixContext.fillStyle = ((i % n) + Math.floor(i / n)) % 2 ? '#252b33' : '#2c333d';
      pixContext.fillRect(x, y, cell, cell);
      if (art.pixels[i]) {
        pixContext.fillStyle = art.pixels[i];
        pixContext.fillRect(x, y, cell, cell);
      }
    }
  }

  function paintAt(event) {
    const art = getArt();
    const n = art.size;
    const rect = pixCanvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / rect.width * n);
    const y = Math.floor((event.clientY - rect.top) / rect.height * n);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const color = eraser ? null : document.getElementById('pix-color').value;
    if (art.pixels[y * n + x] === color) return;
    art.pixels[y * n + x] = color;
    drawPixels();
    requestRebuild();
  }

  const endPainting = (event) => {
    if (event.pointerId !== paintingPointer) return;
    paintingPointer = null;
    if (pixCanvas.hasPointerCapture?.(event.pointerId)) pixCanvas.releasePointerCapture(event.pointerId);
  };
  listen(pixCanvas, 'pointerdown', (event) => {
    if (paintingPointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    paintingPointer = event.pointerId;
    pixCanvas.setPointerCapture?.(event.pointerId);
    paintAt(event);
  });
  listen(pixCanvas, 'pointermove', (event) => {
    if (event.pointerId === paintingPointer) paintAt(event);
  });
  listen(pixCanvas, 'pointerup', endPainting);
  listen(pixCanvas, 'pointercancel', endPainting);
  listen(pixCanvas, 'lostpointercapture', endPainting);

  /*
    Основа скина — купленный или стандартный.

    Раньше редактор всегда стартовал с «Стандарта», и «свой скин» приходилось
    собирать с нуля, даже если человек только что купил «Золото» и хотел лишь
    убрать корону. Теперь основой может стать любой скин из уже купленных:
    берём его целиком — цвета, оружие, все куски рисунка — и правим.

    Список строится по кошельку: предлагать за основу то, что не куплено,
    значило бы отдавать содержимое магазина даром.
  */
  const baseSelect = document.getElementById('skin-base');
  if (baseSelect) {
    const каталог = new Map([['default', { name: t('skinDefault'), skin: defaultSkin }]]);
    try {
      const shopResponse = await fetch('skins/shop.json');
      if (shopResponse.ok) {
        const wallet = await Platform.loadWallet();
        const куплено = new Set(Array.isArray(wallet?.owned) ? wallet.owned : []);
        for (const item of (await shopResponse.json()).skins ?? []) {
          if (!куплено.has(item.id)) continue;
          каталог.set(item.id, { name: localizedName('skin', item.id), skin: item.skin });
        }
      }
    } catch { /* магазин недоступен — остаётся стандарт */ }
    baseSelect.replaceChildren();
    for (const [id, { name }] of каталог) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      // Подписи собраны кодом, а не разметкой: помечаем, чтобы смена языка
      // в редакторе переписала и их — иначе список застыл бы на русском.
      option.dataset.skinName = id;
      baseSelect.append(option);
    }
    listen(baseSelect, 'change', () => {
      const выбран = каталог.get(baseSelect.value);
      if (!выбран) return;
      skin = normalizeSkin(выбран.skin, defaultSkin);
      buildForm();
      drawPixels();
      requestRebuild();
      status(t('skinBaseTaken', выбран.name));
    });
  }

  const targetSelect = document.getElementById('pix-target');
  const eraserButton = document.getElementById('pix-eraser');
  const clearButton = document.getElementById('pix-clear');
  listen(targetSelect, 'change', drawPixels);
  listen(eraserButton, 'click', () => {
    eraser = !eraser;
    eraserButton.classList.toggle('active', eraser);
    eraserButton.textContent = t(eraser ? 'eraserOn' : 'eraserOff');
  });
  listen(clearButton, 'click', () => {
    getArt().pixels.fill(null);
    drawPixels();
    requestRebuild();
  });

  const presetsBox = document.getElementById('pix-presets');
  presetsBox.replaceChildren();
  for (const [name, art] of Object.entries(MASK_PRESETS)) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.style.flex = '1 1 45%';
    button.dataset.i18n = name;
    button.textContent = t(name);
    listen(button, 'click', () => {
      targetSelect.value = 'face';
      skin.art.face = sanitizeArt(art, ART_SIZE_BY_KEY.face);
      drawPixels();
      requestRebuild();
    });
    presetsBox.append(button);
  }

  const upload = document.getElementById('pix-upload');
  listen(upload, 'change', async () => {
    const file = upload.files?.[0];
    upload.value = '';
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      status(t('imageUnsupported'), false);
      return;
    }
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
      status(t('imageTooLarge'), false);
      return;
    }
    try {
      const image = await loadImage(file);
      if (disposed) return;
      skin.art[target()] = imageToArt(image, ART_SIZE_BY_KEY[target()] ?? ART_SIZE);
      drawPixels();
      requestRebuild();
      status(t(target() === 'face' ? 'imageOnFace' : 'imageOnTorso'));
    } catch {
      status(t('imageLoadFailed'), false);
    }
  });

  const saveButton = document.getElementById('btn-skin-save');
  const resetButton = document.getElementById('btn-skin-reset');
  listen(saveButton, 'click', async () => {
    saveButton.disabled = true;
    try {
      if (!(await Platform.saveSkin(skin))) {
        status(t('skinSaveFailed'), false);
        return;
      }
      const wallet = await Platform.loadWallet();
      if (Array.isArray(wallet?.owned) && wallet.owned.includes('custom')) {
        wallet.equipped = 'custom';
        if (!(await Platform.saveWallet(wallet))) {
          status(t('skinEquipFailed'), false);
          return;
        }
        status(t('skinApplied'));
      } else {
        status(t('skinDraftSaved'), false);
      }
    } finally {
      saveButton.disabled = false;
    }
  });
  listen(resetButton, 'click', async () => {
    const replacement = normalizeSkin(defaultSkin, defaultSkin);
    resetButton.disabled = true;
    try {
      if (!(await Platform.saveSkin(replacement))) {
        status(t('skinSaveFailed'), false);
        return;
      }
      skin = replacement;
      buildForm();
      drawPixels();
      requestRebuild();
      status(t('skinReset'));
    } finally {
      resetButton.disabled = false;
    }
  });

  function resize() {
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement.clientWidth);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  listen(window, 'resize', resize);

  const relocalize = () => {
    document.querySelectorAll('#panel-skin [data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    eraserButton.textContent = t(eraser ? 'eraserOn' : 'eraserOff');
    document.querySelectorAll('#skin-base [data-skin-name]').forEach((option) => {
      option.textContent = option.dataset.skinName === 'default'
        ? t('skinDefault')
        : localizedName('skin', option.dataset.skinName);
    });
  };

  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    if (rebuildRequested) {
      rebuildRequested = false;
      rebuild();
    }
    drainRetired();
    const delta = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    previewAngle += delta * 0.36;
    preview.rotation.y = previewAngle;
    renderer.render(scene, camera);
  }

  buildForm();
  drawPixels();
  resize();
  raf = requestAnimationFrame(frame);

  return {
    relocalize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      for (const cleanup of cleanups.splice(0)) cleanup();
      retire(preview);
      preview = null;
      drainRetired(true);
      disposeObject(stage, disposedResources);
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
