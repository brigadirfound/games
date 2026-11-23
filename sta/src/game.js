import * as THREE from 'three';
import { Input } from './input.js';
import { CameraRig, CAM_LABELS } from './camera.js';
import { Sky } from './sky.js';
import { DAY_LENGTH, sampleDay } from './day-cycle.js';
import { createRenderer } from './glcontext.js';
import { EffectSystem } from './effects.js';
import { PostFX } from './postfx.js';
import { Tutorial } from './tutorial.js';
import { AudioEngine } from './audio.js';
import { City, CITY, gridToWorld, DISTRICTS } from './city.js';
import { Vehicle, CAR_TYPES, CAR_BY_ID, TANK_TYPE } from './vehicle.js';
import { setupVehicleEnvironment } from './vehicle-materials.js';
import { Character, Pedestrian, GANGS, SKIN, randomLook, PLAYER_LOOK } from './character.js';
import { TrafficAI, PoliceAI, CopAI } from './ai.js';
import { WEAPONS, WEAPON_ORDER, buildWeaponMesh, makeInventory } from './weapons.js';
import { WeaponState } from './weapon-state.js';
import { WeaponPresentation } from './weapon-presentation.js';
import { traceSolids, traceSphere } from './weapon-ballistics.js';
import { MissionManager, STORY } from './missions.js';
import { Radio } from './radio.js';
import { ProgressSystem, PACKAGE_TOTAL, PROPERTIES, TURF_DISTRICTS } from './progress.js';
import { PoliceHelicopter } from './helicopter.js';
import { mapSnapshot } from './mapdata.js';
import {
  clamp, lerp, smoothstep, angleLerp, angleDiff, rand, randInt, pick,
} from './physics.js';

const MAX_TRAFFIC = 38;
const MAX_PEDS = 72;
const STREAM_RADIUS = 210;
// ------------------------------------------------------------------ saves
export const SAVE_SLOTS = 3;
const SAVE_PREFIX = 'liberty-save-';
const LAST_SLOT_KEY = 'liberty-last-slot';
const LEGACY_KEY = 'liberty-save';

function readLastSlot() {
  try {
    const n = parseInt(localStorage.getItem(LAST_SLOT_KEY), 10);
    return Number.isInteger(n) && n >= 0 && n < SAVE_SLOTS ? n : 0;
  } catch (e) { return 0; }   // приватный режим: localStorage может бросать
}

// Однослотовый сейв старых версий переезжает в первый слот, чтобы игрок
// не потерял прохождение при обновлении. Делать это надо ДО первого чтения
// слотов, иначе экран загрузки покажет пустоту там, где сейв есть.
export function migrateLegacySave() {
  try {
    const old = localStorage.getItem(LEGACY_KEY);
    if (!old) return false;
    if (!localStorage.getItem(SAVE_PREFIX + '0')) localStorage.setItem(SAVE_PREFIX + '0', old);
    localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch (e) { return false; }
}

// Шапка для сейва, записанного до появления слотов. Процент прохождения
// без живого мира не посчитать, поэтому он остаётся неизвестным.
function legacyMeta(d) {
  const idx = (d.missions && d.missions.storyIndex) || 0;
  const done = idx >= STORY.length;
  const next = done ? null : STORY[idx];
  return {
    savedAt: null,
    act: done ? 0 : (next ? next.act : 1),
    mission: next ? next.title : null,
    money: d.money || 0,
    completion: null,
    playTime: Math.round((d.stats && d.stats.playTime) || 0),
    district: '',
  };
}

export function hasAnySave() {
  try {
    for (let i = 0; i < SAVE_SLOTS; i++) if (localStorage.getItem(SAVE_PREFIX + i)) return true;
  } catch (e) { /* приватный режим */ }
  return false;
}

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.time = 0;
    this.clockTime = 8 * 3600; // start 08:00
    this.paused = false;
    this.gameOver = false;

    // Контекст с деградацией: antialias/high-performance доступны не везде,
    // и жёсткий вызов ронял игру с «Error creating WebGL context».
    const gl = createRenderer(canvas);
    this.renderer = gl.renderer;
    this.glMode = gl.mode;
    this.lowSpec = gl.degraded;
    // На слабом контексте не раздуваем разрешение и убираем мягкие тени.
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, gl.degraded ? 1 : 1.8));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = gl.degraded ? THREE.BasicShadowMap : THREE.PCFSoftShadowMap;

    // Драйвер может отобрать контекст (спящий режим, переключение GPU).
    // Без этого игра молча превращается в чёрный экран.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.paused = true;
      const el = document.getElementById('hud-msg');
      if (el) {
        el.textContent = 'ГРАФИКА ПЕРЕЗАПУСКАЕТСЯ…';
        el.style.opacity = '1';
      }
      console.warn('[GL] контекст потерян, ждём восстановления');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.paused = false;
      console.warn('[GL] контекст восстановлен');
    }, false);

    this.scene = new THREE.Scene();
    setupVehicleEnvironment(this.renderer, this.scene);
    this.skyColor = new THREE.Color(0x8fa8bd);
    this.scene.background = this.skyColor.clone();
    // Линейный туман 130–430 м давал ровно то, на что жаловались: до 130 м
    // воздуха нет вообще, дальше он нарастает прямой и упирается в стену.
    // Экспоненциальный садится на дальний план мягко и чуть заметно трогает
    // средний — это и есть воздушная перспектива, из-за которой сцена
    // читается глубокой, а не вырезанной из картона.
    this.scene.fog = new THREE.FogExp2(this.skyColor.clone(), 0.0020);
    // 0.0028 было настроено по виду с улицы и оказалось слишком плотным для
    // панорамы: с четырёхсот метров город размывало в белое, и силуэт, ради
    // которого всё и делалось, пропадал. 0.0020 сохраняет воздух вблизи и
    // оставляет читаемым дальний план.
    this.fogBase = 0.0020;

    this.camera = new THREE.PerspectiveCamera(68, 1, 0.15, 1000);
    this.cam = new CameraRig(this, this.camera);

    this.setupLights();
    this.sky = new Sky(this.scene);
    this.fx = new EffectSystem(this.scene);
    this.post = new PostFX(this.renderer, this.scene, this.camera);
    this.flash = 0;
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.city = new City(this.scene);

    this.vehicles = [];
    this.traffic = [];
    this.peds = [];
    this.police = [];
    this.copsOnFoot = [];
    this.particles = [];
    this.projectiles = [];
    this.pickups = [];

    this.wanted = 0;
    this.wantedDecay = 0;
    this.money = 0;
    this.kills = 0;
    this.stats = { distance: 0, jumps: 0, carsWrecked: 0, missions: 0, bestCombo: 0, playTime: 0 };
    // Слот, в который уходит быстрое сохранение и из которого грузит F9.
    this.lastSlot = readLastSlot();
    this.shakeScale = 1;   // настройка «тряска камеры»
    // Фильтры маркеров миникарты/карты — реестр в settings.js применяет
    // сюда значения при загрузке; здесь только безопасные значения по умолчанию
    // на случай кода, который создаёт Game в обход Settings (тесты, отладка).
    this.mapFilters = {
      missions: true, packages: true, property: true, rampage: true,
      service: true, heli: true, gangs: true, garage: true,
    };
    this.inventory = makeInventory();
    this.weaponState = new WeaponState(this.inventory);
    this.weapon = 'pistol';
    this.shootCd = 0;
    this.msgT = 0; this.msg = '';
    this.copSpawnCd = 3;
    this.spawnGrace = 2.5;
    this.runOverCd = 0;
    this.armor = 0;
    this.weather = 'clear';
    this.weatherT = rand(60, 140);
    this.rainParticles = null;

    this.helicopters = [];
    this.homeStash = {};
    this.endgame = false;
    this.completionShown = false;
    this.creditsActive = false;
    this.mount = null;              // идущая анимация посадки/высадки
    this.airTime = 0;
    this.airStartX = 0; this.airStartZ = 0;

    this.setupPlayer();
    this.setupWeaponModel();
    this.populate();
    this.progress = new ProgressSystem(this);
    this.missions = new MissionManager(this);
    this.radio = new Radio(this.audio);
    this.tutorial = new Tutorial(this);
    this.setupRain();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // ---------------- setup ----------------
  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xbcd4e6, 0x4a4438, 0.85);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.15);
    sun.position.set(90, 140, 60);
    sun.castShadow = true;
    // Чёткость тени = размер карты / охват области. Было 2048 на 230 м —
    // 11 см на тексель, тень от человека размазывалась в пятно. Ужимаем
    // охват до 140 м (дальше тени всё равно не разглядеть — там туман и
    // мелкий масштаб) и поднимаем карту: ~4.6 см на тексель, втрое резче.
    // Дальность подняли, когда слияние фасадов освободило втрое больше
    // бюджета: тени обрывались в 70 метрах от игрока, и на открытой площади
    // или с моста это било в глаза. 110 м охвата при карте 4096 дают
    // 5.4 см на тексель — чуть мягче прежних 4.6, но видно в полтора раза
    // дальше. Каскадов у нас нет, поэтому это компромисс одной карты.
    sun.shadow.mapSize.set(4096, 4096);
    const d = 110;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 10; sun.shadow.camera.far = 430;
    // При мелком тексел-размере обычный bias уже даёт «висящие» тени,
    // поэтому основную работу отдаём normalBias — он смещает по нормали
    // и не отрывает тень от подошв.
    sun.shadow.bias = -0.0002;
    sun.shadow.normalBias = 0.035;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  setupPlayer() {
    const start = { x: gridToWorld(5) + 10, z: gridToWorld(5) + 10 };
    this.player = new Character(this.city, start.x, start.z, { ...PLAYER_LOOK });
    this.player.isPlayer = true;
    this.scene.add(this.player.mesh);
  }

  setupWeaponModel() {
    this.weaponModels = {};
    this.weaponHolder = new THREE.Group();
    // Оружие крепим К КИСТИ, а не к корпусу: раньше ствол висел в воздухе
    // с фиксированным смещением и не следовал за анимацией руки.
    const hand = this.player.arms[0].hand;
    hand.add(this.weaponHolder);
    this.weaponHolder.position.set(0, -0.06, 0.10);
    this.weaponHolder.rotation.set(Math.PI / 2, 0, 0);
    this.weaponView = new WeaponPresentation(this);
    this.refreshWeaponModel();
  }

  refreshWeaponModel() {
    this.weaponState.cancelReload();
    this.reloadLock = 0; this.player.reloadT = 0;
    this.weaponState.loaded(this.weapon);
    this.weaponView.select(this.weapon);
  }

  setupRain() {
    // rain as short falling streaks (line segments), not square dots
    const count = 2600;
    this.rainCount = count;
    const pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = rand(-48, 48), y = rand(0, 52), z = rand(-48, 48);
      pos[i * 6] = x;     pos[i * 6 + 1] = y;       pos[i * 6 + 2] = z;
      // Капля — короткий штрих, а не полутораметровая палка: длина 1.5 м
      // читалась как падающие рейки, особенно вблизи.
      pos[i * 6 + 3] = x + 0.07; pos[i * 6 + 4] = y - 0.42; pos[i * 6 + 5] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xaecadd, transparent: true, opacity: 0.42 });
    this.rainParticles = new THREE.LineSegments(geo, mat);
    this.rainParticles.visible = false;
    this.rainParticles.frustumCulled = false;
    this.scene.add(this.rainParticles);

    // Брызги от капель по земле: раньше дождь просто пролетал сквозь асфальт.
    const sCount = 260;
    this.splashCount = sCount;
    const spos = new Float32Array(sCount * 6);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
    const smat = new THREE.LineBasicMaterial({
      color: 0xd6e6f2, transparent: true, opacity: 0.5 });
    this.splashes = new THREE.LineSegments(sgeo, smat);
    this.splashes.visible = false;
    this.splashes.frustumCulled = false;
    this.scene.add(this.splashes);
    this.splashState = [];
    for (let i = 0; i < sCount; i++) {
      this.splashState.push({ x: 0, z: 0, t: Math.random() * 0.4, life: 0.4 });
    }
  }

  populate() {
    for (let i = 0; i < MAX_TRAFFIC; i++) this.spawnTrafficCar(true);
    for (let i = 0; i < MAX_PEDS; i++) this.spawnPed(true);
    // Populate nearby parks immediately; the ordinary streaming cap still applies.
    const nearbyParks = this.city.parks.filter(p => this.distToPlayer(p.x,p.z)<150);
    let visitor = 0;
    for (const park of nearbyParks) for (let n=0;n<3;n++) {
      const ped=this.peds[visitor++];
      if(!ped) break;
      const spot=park.walkLoop[n];
      ped.x=spot.x;ped.z=spot.z;ped.y=this.city.groundHeightAt(ped.x,ped.z);
      ped.parkRoute=park.walkLoop;ped.parkIndex=n;
      ped.target=park.walkLoop[(n+1)%4];ped.syncMesh();
    }
    for (let i = 0; i < 14; i++) {
      const p = this.city.randomRoadPoint();
      const alongX = Math.abs((p.z + CITY.HALF) / CITY.SPACING - Math.round((p.z + CITY.HALF) / CITY.SPACING)) < 0.001;
      const side = i % 2 ? 1 : -1;
      const curb = CITY.ROAD_W/2-1.4;
      const v = this.spawnParkedCar(p.x+(alongX?0:side*curb),p.z+(alongX?side*curb:0));
      v.heading = alongX ? -side*Math.PI/2 : side>0?0:Math.PI;
      v.updateMesh();
    }
    for (let i = 0; i < 10; i++) this.spawnWeaponPickup();
    const tank = this.spawnParkedCar(-266, -306, 'tank');
    tank.heading = 0; tank.unique = true; tank.updateMesh();
  }

  // ---------------- spawning ----------------
  attachVehicleHooks(v) {
    v.onCrash = (impact) => {
      if (this.distToPlayer(v.x, v.z) < 70) this.audio.crash(clamp(impact / 14, 0.2, 1.4));
      this.spawnSparks(v.x, v.z, 1.1);
      if (this.player.inVehicle === v) this.shake(clamp(impact / 28, 0.1, 0.6));
    };
    v.onDestroyed = () => {
      this.explode(v.x, v.z);
      this.stats.carsWrecked++;
      if (this.missions) this.missions.onVehicleDestroyed(v);
      if (v.driverAI) this.removeAIOf(v);
      if (this.player.inVehicle === v) {
        this.showMessage('МАШИНА ГОРИТ!\nВЫПРЫГИВАЙ', 2);
      }
    };
    v.onBurnOut = () => {
      if (this.player.inVehicle === v) this.exitVehicle(true);
      this.explode(v.x, v.z);
      this.destroyVehicle(v);
    };
    // Предупреждение перед детонацией: раньше машина просто взрывалась,
    // и игрок не успевал выскочить.
    v.onBurnTick = (left) => {
      if (this.player.inVehicle !== v) return;
      const beat = left < 1.6 ? 0.18 : left < 3 ? 0.34 : 0.6;
      v._warnCd = (v._warnCd || 0) - 1 / 60;
      if (v._warnCd > 0) return;
      v._warnCd = beat;
      this.audio.beep(left < 1.6 ? 1180 : 820, 0.06, 0.3, 'square');
      this.shake(0.12);
      if (!v._warnShown || left < 1.7) {
        v._warnShown = true;
        this.showMessage(left < 1.7 ? 'ВЗРЫВ! ЖМИ F!' : 'ГОРИТ! ВЫСКАКИВАЙ — F', 1.1);
      }
    };
    v.onRamp = () => {
      this.stats.jumps++;
      if (this.player.inVehicle === v) {
        this.money += 50;
        this.showMessage('КРУТОЙ ПРЫЖОК! +$50', 1.6);
        this.audio.beep(1000, 0.15, 0.25);
      }
    };
  }

  spawnParkedCar(x, z, typeId) {
    const type = typeId === 'tank' ? TANK_TYPE : typeId ? CAR_BY_ID[typeId] : this.pickTrafficType();
    const v = new Vehicle(this.city, { x, z, type, heading: Math.round(rand(0, 3)) * Math.PI / 2 });
    this.attachVehicleHooks(v);
    if (this._headlightsOn) v.setHeadlights(true);
    this.scene.add(v.mesh);
    this.vehicles.push(v);
    return v;
  }

  removeAIOf(v) {
    this.traffic = this.traffic.filter((a) => a.v !== v);
    this.police = this.police.filter((a) => a.v !== v);
    v.driverAI = null;
  }

  pickTrafficType() {
    // weighted so the streets read as a real city, not a supercar showroom
    const table = [
      ['sedan', 20], ['coupe', 12], ['taxi', 9],
      ['van', 8], ['pickup', 8], ['suv', 9],
      ['muscle', 5], ['bike', 5], ['scooter', 4], ['sport', 4],
      ['truck', 3], ['bus', 3], ['roadster', 2],
      ['ambul', 1], ['fire', 1],
      ['compact', 6], ['wagon', 5], ['garbage', 1], ['schoolbus', 1], ['tow', 1], ['postvan', 2],
    ];
    let total = 0;
    for (const [, w] of table) total += w;
    let r = Math.random() * total;
    for (const [id, w] of table) { r -= w; if (r <= 0) return CAR_BY_ID[id]; }
    return CAR_BY_ID.sedan;
  }

  spawnTrafficCar(anywhere = false) {
    if (this.traffic.length >= MAX_TRAFFIC) return;
    let p = null;
    for (let i = 0; i < 20; i++) {
      const c = this.city.randomRoadPoint();
      const d = this.distToPlayer(c.x, c.z);
      if (anywhere ? d > 25 : (d > 55 && d < STREAM_RADIUS)) { p = c; break; }
    }
    if (!p) return;
    const v = new Vehicle(this.city, { x: p.x, z: p.z, type: this.pickTrafficType() });
    this.attachVehicleHooks(v);
    const ai = new TrafficAI(this.city, v);
    const tp = ai.targetPoint();
    v.heading = Math.atan2(tp.x - v.x, tp.z - v.z);
    v.updateMesh();
    v.driverAI = ai;
    if (this._headlightsOn) v.setHeadlights(true);
    this.scene.add(v.mesh);
    this.vehicles.push(v);
    this.traffic.push(ai);
    return v;
  }

  spawnPed(anywhere = false, force = false) {
    if (this.peds.length >= MAX_PEDS) {
      if (!force) return null;
      // make room: drop the farthest ordinary pedestrian
      let far = null, fd = -1;
      for (const q of this.peds) {
        if (q.isMissionTarget) continue;
        const d = this.distToPlayer(q.x, q.z);
        if (d > fd) { fd = d; far = q; }
      }
      if (far) {
        this.scene.remove(far.mesh);
        this.peds = this.peds.filter((x) => x !== far);
      } else return null;
    }
    let p = null;
    for (let i = 0; i < 20; i++) {
      const activities = this.city.life?.activitySpots || [];
      const c = !force && !anywhere && activities.length && Math.random()<0.22
        ? pick(activities) : this.city.randomSidewalkPoint();
      if (this.city.blockedAt(c.x,c.z,0.42)) continue;
      const d = this.distToPlayer(c.x, c.z);
      if (anywhere ? d > 20 : (d > 38 && d < STREAM_RADIUS)) { p = c; break; }
    }
    if (!p) p = force ? this.city.randomSidewalkPoint() : null;
    if (!p) return null;
    const district = this.city.districtAtWorld(p.x, p.z);
    const gang = GANGS.find((g) => g.turf === district);
    let opts = randomLook();
    // Район виден по толпе: в деловом центре чаще костюмы, на промзоне —
    // спецовки. Дешевле любой декорации и сразу говорит, где ты находишься.
    if ((district === 'commercial' || district === 'downtown') && Math.random() < 0.5) opts.outfit = 'suit';
    else if (district === 'industrial' && Math.random() < 0.4) {
      opts.outfit = 'worker'; opts.hairStyle = 'cap';
    }
    if (gang && Math.random() < 0.4) {
      // Банда — это форма: цвета общие, а типаж и причёска у каждого свои.
      opts = randomLook({
        shirt: gang.shirt, pants: gang.pants, gang: gang.id,
        armed: Math.random() < 0.5,
        outfit: pick(['casual', 'jacket', 'hoodie', 'track']),
      });
    }
    const ped = new Pedestrian(this.city, p.x, p.z, opts);
    if (p.park) {
      ped.parkRoute=p.park.walkLoop;ped.parkIndex=0;ped.target=ped.parkRoute[0];
    }
    this.scene.add(ped.mesh);
    this.peds.push(ped);
    return ped;
  }

  spawnPoliceCar() {
    let p = null;
    for (let i = 0; i < 25; i++) {
      const c = this.city.randomRoadPoint();
      const d = this.distToPlayer(c.x, c.z);
      if (d > 65 && d < 185) { p = c; break; }
    }
    if (!p) return;
    const lvl = Math.floor(this.wanted);
    const type = lvl >= 4 && Math.random() < 0.4 ? CAR_BY_ID.van : CAR_BY_ID.sedan;
    const v = new Vehicle(this.city, { x: p.x, z: p.z, police: true, type });
    this.attachVehicleHooks(v);
    v.heading = Math.atan2(this.playerX() - v.x, this.playerZ() - v.z);
    v.updateMesh();
    const ai = new PoliceAI(this.city, v);
    v.driverAI = ai;
    if (this._headlightsOn) v.setHeadlights(true);
    this.scene.add(v.mesh);
    this.vehicles.push(v);
    this.police.push(ai);
  }

  spawnCopOnFoot(x, z, swat = false) {
    // Форма — это узнаваемость: у полиции фуражка, у спецназа шлем и очки.
    // Оба комплекта широкие в плечах, чтобы читаться в толпе с первого кадра.
    const c = new Character(this.city, x, z, swat
      ? { role:'swat', shirt: 0x1a1f2a, pants: 0x14161c, hair: 0x101014, health: 140,
          outfit: 'jacket', build: 'broad', hairStyle: 'beanie', hat: 0x101319,
          glasses: true, skin: pick(SKIN) }
      : { role:'police', shirt: 0x1b3a6b, pants: 0x14243f, hair: 0x2a1c12, health: 100,
          outfit: 'jacket', build: 'broad', hairStyle: 'cap', hat: 0x14213c,
          skin: pick(SKIN) });
    c.isCop = true;
    this.scene.add(c.mesh);
    this.copsOnFoot.push(new CopAI(this.city, c, { swat }));
  }

  spawnWeaponPickup(id, x, z) {
    const weaponId = id || pick(['uzi', 'shotgun', 'rifle', 'rocket', 'ak47', 'm4a1', 'armor', 'health', 'cash']);
    let pos;
    if (x !== undefined) pos = { x, z };
    else {
      pos = this.city.randomSidewalkPoint();
      if (this.distToPlayer(pos.x, pos.z) < 30) return;
    }

    const colors = { uzi: 0xcccccc, shotgun: 0x8a6a3a, rifle: 0x4a6a3a, rocket: 0x3a5a2a, armor: 0x3a7acc, health: 0xdd3344, cash: 0x3ac05a };
    const g = new THREE.Group();
    if (weaponId === 'armor') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.75, 0.25), new THREE.MeshBasicMaterial({ color: colors.armor }));
      g.add(m);
    } else if (weaponId === 'health') {
      const m1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.22), new THREE.MeshBasicMaterial({ color: colors.health }));
      const m2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), new THREE.MeshBasicMaterial({ color: colors.health }));
      g.add(m1); g.add(m2);
    } else if (weaponId === 'cash') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.12), new THREE.MeshBasicMaterial({ color: colors.cash }));
      g.add(m);
    } else {
      const wm = buildWeaponMesh(weaponId);
      if (wm) {
        wm.rotation.z = Math.PI / 2; wm.rotation.y = rand(0, Math.PI * 2); g.add(wm);
        g.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(wm);
        wm.position.y -= bounds.min.y;
        g.userData.groundWeapon = true;
      }
    }
    const floor = this.city.groundHeightAt(pos.x, pos.z);
    g.position.set(pos.x, g.userData.groundWeapon ? floor + .02 : floor + 1.1, pos.z);
    this.scene.add(g);
    this.pickups.push({ id: weaponId, x: pos.x, z: pos.z, mesh: g, spin: rand(0, 6) });
  }

  // ---------------- helpers ----------------
  get camYaw() { return this.cam.yaw; }
  set camYaw(v) { this.cam.yaw = v; }
  get camPitch() { return this.cam.pitch; }
  set camPitch(v) { this.cam.pitch = v; }

  playerX() { return this.player.inVehicle ? this.player.inVehicle.x : this.player.x; }
  playerZ() { return this.player.inVehicle ? this.player.inVehicle.z : this.player.z; }
  distToPlayer(x, z) { return Math.hypot(x - this.playerX(), z - this.playerZ()); }
  // opts: { tone: 'neutral'|'success'|'fail'|'arrest', eyebrow, sub }.
  // Без opts.sub поведение старое — первый перевод строки делит текст
  // на заголовок/подзаголовок, так работали все существующие вызовы.
  showMessage(text, secs = 2.5, opts = {}) {
    // Старая версия терпела undefined/нестроку молча — часть кода (в т.ч. тесты)
    // на это полагается, оставляем ту же терпимость.
    text = text == null ? '' : String(text);
    if (opts.sub !== undefined) {
      this.msg = text;
      this.msgSub = opts.sub;
    } else {
      const nl = text.indexOf(String.fromCharCode(10));
      this.msg = nl >= 0 ? text.slice(0, nl) : text;
      this.msgSub = nl >= 0 ? text.slice(nl + 1) : '';
    }
    this.msgEyebrow = opts.eyebrow || '';
    this.msgTone = opts.tone || 'neutral';
    this.msgT = secs;
  }
  shake(a) {
    const s = a * this.shakeScale;
    this.cam.addShake(s);
    this.hud.shake(s);
  }

  get weaponDef() { return WEAPONS[this.weapon]; }
  get ammo() { return this.inventory[this.weapon]; }

  addWanted(n) {
    const before = Math.floor(this.wanted);
    this.wanted = clamp(this.wanted + n, 0, 6);
    this.wantedDecay = 14;
    if (Math.floor(this.wanted) > before) {
      this.audio.beep(520, 0.15, 0.22, 'square');
      if (Math.floor(this.wanted) >= 4) this.showMessage('ПОДКРЕПЛЕНИЕ SWAT!', 2);
    }
  }

  addMoney(n) {
    this.money = Math.max(0, this.money + n);
  }

  // ---------------- combat ----------------
  switchWeapon(dir) {
    const owned = WEAPON_ORDER.filter((w) => this.weaponState.owned(w));
    let i = owned.indexOf(this.weapon);
    if (i < 0) i = 0;
    i = (i + dir + owned.length) % owned.length;
    this.weapon = owned[i];
    this.refreshWeaponModel();
    this.audio.beep(700, 0.06, 0.15, 'square');
  }

  selectWeapon(id) {
    if (!WEAPONS[id] || !this.weaponState.owned(id)) return;
    this.weapon = id;
    this.refreshWeaponModel();
  }

  playerAttack() {
    const w = this.weaponDef;
    if (!w) return;
    if (this.player.dead || this.player.inVehicle || this.mount || this.paused) return;
    if (w.melee) return this.playerMelee();
    if (!this.weaponState.fire(this.weapon)) {
      if (!this.weaponState.reload) {
        if (!this.startReload()) { this.showMessage('НЕТ ПАТРОНОВ', 1); this.audio.beep(140, .025, .07); }
        this.shootCd = .2;
      }
      return;
    }
    this.player.reloadT = 0; this.reloadLock = 0;
    this.weaponView.shot();
    this.shootCd = w.rate;
    this.audio.shot(w.vol, w.tone);
    const kick = { pistol: 0.018, uzi: 0.009, shotgun: 0.05, rifle: 0.038, rocket: 0.06 }[w.id] || 0.016;
    this.cam.addRecoil(-kick, rand(-kick * 0.4, kick * 0.4));
    this.player.addRecoil(kick * 9);
    this.shake(w.id === 'rocket' ? 0.5 : w.id === 'shotgun' ? 0.28 : 0.1);

    const muzzle = this.getWeaponMuzzle();
    this.spawnMuzzleFlash(muzzle.x, muzzle.y, muzzle.z);
    if (w.projectile) { this.fireRocket(); this.addWanted(w.wantedPerHit); return; }

    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) this.fireHitscan(w);
    this.scarePedsNear(this.player.x, this.player.z, 22);
    this.addWanted(w.wantedPerHit);
  }

  startReload() {
    if (this.player.dead || this.player.inVehicle || this.mount || !this.weaponState.startReload(this.weapon)) return false;
    this.aimingDownSights = false; this.player.aiming = false;
    this.player.reload(this.weaponDef.reload); this.reloadLock = this.weaponDef.reload;
    this.audio.weaponMechanism?.('out');
    return true;
  }

  updateWeaponState(dt) {
    if (this.player.dead || this.player.inVehicle || this.mount) this.weaponState.cancelReload();
    for (const event of this.weaponState.tick(dt)) this.audio.weaponMechanism?.(event);
    const reload = this.weaponState.reload;
    this.reloadLock = reload ? reload.duration - reload.elapsed : 0;
    this.player.reloadT = this.reloadLock;
    this.player.reloadDur = reload?.duration || this.weaponDef.reload || 1;
  }

  getWeaponMuzzle() {
    const muzzle = this.weaponView.muzzle(new THREE.Vector3());
    const origin = new THREE.Vector3(this.player.x, this.player.mesh.position.y + 1.4 - this.player.crouch * .3, this.player.z);
    const direction = muzzle.clone().sub(origin), distance = direction.length();
    if (distance > .001) {
      direction.divideScalar(distance);
      const boxes = this.city.nearbyColliders(origin.x, origin.z, distance + 2, []);
      const clear = traceSolids(origin, direction, distance, boxes);
      if (clear < distance) muzzle.copy(origin).addScaledVector(direction, Math.max(0, clear - .025));
    }
    return muzzle;
  }

  fireHitscan(w) {
    // Truthful aiming: the ray starts at the CAMERA and follows exactly where
    // the crosshair points. The tracer is then drawn from the hand to the hit
    // point, so the visuals match without breaking accuracy.
    this.camera.updateMatrixWorld(true);
    const ray = this.cam.getAimRay();
    const spread = (w.spread || 0) * (this.aimingDownSights ? 0.3 : 1)
      * (this.player.crouch > 0.5 ? 0.6 : 1)
      * (this.player.speed > 4.5 ? 1.7 : 1);

    let dx = ray.dir.x, dy = ray.dir.y, dz = ray.dir.z;
    if (spread > 0) {
      dx += rand(-spread, spread);
      dy += rand(-spread, spread) * 0.7;
      dz += rand(-spread, spread);
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    const ox = ray.origin.x, oy = ray.origin.y, oz = ray.origin.z;
    // ignore anything between the camera and the player in third person
    const selfDist = this.cam.isFirstPerson
      ? 0.4
      : Math.hypot(ox - this.player.x, oz - this.player.z) + 0.9;

    const maxD = w.range + selfDist;
    const flat = Math.hypot(dx, dz) || 1e-5;
    const fdx = dx / flat, fdz = dz / flat;
    const slope = dy / flat;              // world-y gained per horizontal metre

    const boxes = [];
    this.city.nearbyColliders(ox, oz, maxD, boxes);
    const rayStart = new THREE.Vector3(ox + fdx * selfDist, oy + slope * selfDist, oz + fdz * selfDist);
    let hitDist = selfDist + traceSolids(rayStart, { x: dx, y: dy, z: dz }, (maxD - selfDist) / flat, boxes) * flat;
    // ground plane
    if (slope < -1e-4) {
      const gd = -oy / slope;
      if (gd > selfDist && gd < hitDist) hitDist = gd;
    }
    if (hitDist === Infinity) hitDist = maxD;

    let target = null;
    // Небольшая помощь прицеливания по людям: допуск шире у бедра и почти
    // отсутствует при прицельной стрельбе — иначе стрельба «в упор мимо»
    // выглядит как пропавшие попадания.
    const assist = this.aimingDownSights ? 1.06 : 1.22;
    const check = (ex, ey, ez, r, hgt, ent, soft = 1) => {
      const rx = ex - ox, rz = ez - oz;
      const along = rx * fdx + rz * fdz;
      if (along < selfDist || along > hitDist) return;
      if (Math.abs(rx * fdz - rz * fdx) > r * soft) return;
      const yAt = oy + slope * along;
      if (yAt < ey - 0.3 || yAt > ey + hgt) return;
      hitDist = along; target = ent;
    };

    // Хитбокс человека: раньше 0.75 м радиуса и 1.9 м высоты — пули в плечо и в
    // макушку не засчитывались, особенно на бегу и по диагонали.
    // Радиус чуть шире плеч, верх — выше головы.
    for (const p of this.peds) if (!p.dead) check(p.x, p.mesh.position.y, p.z, .43, 1.95, { kind: 'ped', obj: p }, assist);
    for (const c of this.copsOnFoot) if (!c.c.dead) check(c.c.x, c.c.mesh.position.y, c.c.z, .46, 1.95, { kind: 'cop', obj: c.c }, assist);
    for (const v of this.vehicles) if (!v.destroyed) check(v.x, v.y, v.z, v.radius, v.type.h + 1.6, { kind: 'car', obj: v });
    for (const h of this.helicopters) if (!h.dead) check(h.x, h.y - 2.5, h.z, 4.4, 5.5, { kind: 'heli', obj: h });

    let hx = ox + fdx * hitDist;
    let hz = oz + fdz * hitDist;
    let hy = oy + slope * hitDist;
    const muzzle = this.getWeaponMuzzle();
    const shotDirection = new THREE.Vector3(hx, hy, hz).sub(muzzle), shotDistance = shotDirection.length();
    shotDirection.normalize();
    const blocked = traceSolids(muzzle, shotDirection, shotDistance,
      this.city.nearbyColliders(muzzle.x, muzzle.z, shotDistance + 2, []));
    if (blocked < shotDistance - .02) {
      target = null;
      hx = muzzle.x + shotDirection.x * blocked; hy = muzzle.y + shotDirection.y * blocked; hz = muzzle.z + shotDirection.z * blocked;
    }
    this.spawnTracer(muzzle.x, muzzle.y, muzzle.z, hx, hy, hz);

    if (!target) { this.spawnSparks(hx, hz, 0.4, hy); return; }

    if (target.kind === 'ped' || target.kind === 'cop') {
      const obj = target.obj;
      const head = hy > obj.mesh.position.y + 1.45;
      const dmg = head ? w.dmg * 2.6 : w.dmg;
      const died = obj.damage(dmg);
      this.spawnBlood(obj.x, obj.z, hy);
      if (target.kind === 'ped') {
        if (died) {
          this.kills++;
          this.addWanted(1.1);
          if (head) { this.addMoney(50); this.showMessage('ХЕДШОТ +$50', 1.2); }
          if (obj.cash) this.addMoney(obj.cash);
          this.scarePedsNear(obj.x, obj.z, 26);
          this.provokeGang(obj);
          this.missions.onKill(obj);
          if (obj.gang) this.progress.addTurf(this.city.districtAtWorld(obj.x, obj.z), 3.5);
        } else if (head) this.showMessage('В ГОЛОВУ!', 0.8);
      } else if (died) { this.kills++; this.addWanted(1.5); }
    } else if (target.kind === 'heli') {
      this.spawnSparks(target.obj.x, target.obj.z, 0.9, target.obj.y - 1);
      if (target.obj.damage(w.dmg)) {
        this.kills++; this.addWanted(1.2);
        this.showMessage('ВЕРТОЛЁТ СБИТ!', 2);
      }
    } else {
      target.obj.health -= w.dmg * 0.6;
      this.spawnSparks(hx, hz, 0.6, hy);
      if (target.obj.health <= 0 && !target.obj.destroyed) {
        target.obj.destroyed = true; target.obj.burning = 2;
        target.obj.onDestroyed && target.obj.onDestroyed();
      }
    }
  }

  spawnMuzzleFlash(x, y, z) {
    this.fx.muzzle(x, y, z, 1.15);
    this.flash = Math.max(this.flash, 0.05);
  }

  fireRocket() {
    const ray = this.cam.getAimRay();
    const m = new THREE.Group(), warhead = buildWeaponMesh('rocket').getObjectByName('warhead').clone(true);
    warhead.position.z = -.75; m.add(warhead);
    m.position.copy(this.getWeaponMuzzle());
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ray.dir);
    this.scene.add(m);
    this.projectiles.push({
      mesh: m, x: m.position.x, z: m.position.z, y: m.position.y,
      vx: ray.dir.x * 44, vy: ray.dir.y * 44, vz: ray.dir.z * 44, life: 4,
    });
  }

  playerMelee() {
    const w = WEAPONS.fist;
    this.shootCd = w.rate;
    // В движении бьём ногой — приём сильнее, но с большей задержкой.
    const kicking = this.player.speed > 3.2 && !this.player.airborne;
    if (kicking) { this.player.kick(); this.shootCd = w.rate * 1.5; }
    else this.player.punch();
    const dmgMul = kicking ? 1.6 : 1;
    this.audio.beep(kicking ? 140 : 180, 0.08, 0.18, 'triangle');
    const ang = this.cam.yaw;
    const hx = this.player.x + Math.sin(ang) * 1.2;
    const hz = this.player.z + Math.cos(ang) * 1.2;

    for (const p of this.peds) {
      if (p.dead) continue;
      if (Math.hypot(p.x - hx, p.z - hz) < 1.5) {
        const died = p.damage(w.dmg * dmgMul);
        this.audio.crash(0.3);
        this.spawnBlood(p.x, p.z);
        p.scare(this.player.x, this.player.z);
        this.addWanted(w.wantedPerHit);
        if (died) {
          this.kills++;
          if (p.cash) this.addMoney(p.cash);
          this.provokeGang(p);
          this.missions.onKill(p);
        }
        return;
      }
    }
    for (const c of this.copsOnFoot) {
      if (c.c.dead) continue;
      if (Math.hypot(c.c.x - hx, c.c.z - hz) < 1.5) {
        if (c.c.damage(w.dmg * dmgMul)) { this.kills++; this.addWanted(1.5); }
        this.addWanted(0.6);
        this.spawnBlood(c.c.x, c.c.z);
        return;
      }
    }
  }

  provokeGang(ped) {
    if (!ped.gang) return;
    for (const p of this.peds) {
      if (p.gang === ped.gang && p.armed && !p.dead) {
        if (Math.hypot(p.x - ped.x, p.z - ped.z) < 45) p.hostile = true;
      }
    }
  }

  policeShoot(sx, sz, tx, tz, dmg = 9) {
    this.enemyShoot(sx, sz, tx, tz, dmg);
  }

  enemyShoot(sx, sz, tx, tz, dmg = 8) {
    const shooter = [...this.peds, ...this.copsOnFoot.map(cop => cop.c)]
      .find(actor => !actor.dead && Math.hypot(actor.x - sx, actor.z - sz) < .5);
    const holder = shooter && this.weaponView.npcs.get(shooter);
    const id = holder?.children[0]?.userData.weaponId || 'pistol';
    if (shooter) {
      if (shooter.reloadT > 0) return;
      if (shooter._weaponReloading) { shooter._weaponMagazine = WEAPONS[id].capacity; shooter._weaponReloading = false; }
      shooter._weaponMagazine ??= WEAPONS[id].capacity;
      if (shooter._weaponMagazine <= 0) { shooter.reload(WEAPONS[id].reload); shooter._weaponReloading = true; return; }
      shooter._weaponMagazine--; shooter._weaponRecoil = 1;
    }
    this.audio.shot(0.16, 1.1);
    const dx = tx - sx + rand(-1.5, 1.5), dz = tz - sz + rand(-1.5, 1.5);
    const muzzle = holder?.children[0]?.getObjectByName('muzzle')?.getWorldPosition(new THREE.Vector3())
      || new THREE.Vector3(sx, this.city.groundHeightAt(sx, sz) + 1.3, sz);
    const aim = new THREE.Vector3(sx + dx, this.player.mesh.position.y + 1.15, sz + dz);
    const direction = aim.clone().sub(muzzle), distance = direction.length(); direction.normalize();
    const clear = traceSolids(muzzle, direction, distance, this.city.nearbyColliders(sx, sz, distance + 2, []));
    aim.copy(muzzle).addScaledVector(direction, clear);
    this.spawnTracer(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.y, aim.z);
    this.spawnMuzzleFlash(muzzle.x, muzzle.y, muzzle.z);
    if (clear >= distance - .02 && Math.random() < 0.42) {
      const p = this.player;
      if (p.inVehicle) {
        p.inVehicle.health -= rand(3, 7);
        if (p.inVehicle.health <= 0 && !p.inVehicle.destroyed) {
          p.inVehicle.destroyed = true; p.inVehicle.burning = 3;
          p.inVehicle.onDestroyed();
        }
      } else {
        this.damagePlayer(rand(dmg * 0.6, dmg * 1.4));
      }
    }
  }

  damagePlayer(n) {
    if (this.gameOver || this.spawnGrace > 0) return;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, n * 0.7);
      this.armor -= absorbed;
      n -= absorbed;
    }
    this.player.health -= n;
    this.hud.flashDamage();
    if (this.player.health <= 0) {
      this.player.health = 0;
      this.onPlayerDeath();
    }
  }

  onPlayerDeath() {
    this.gameOver = true;
    this.weaponState.cancelReload(); this.reloadLock = 0; this.player.reloadT = 0;
    // Смерть посреди посадки: анимацию бросаем, иначе она продолжит двигать
    // тело по своей траектории поверх сцены падения.
    this.mount = null;
    this.audio.engine(false);
    this.audio.siren(false);
    this.audio.skid(false);
    // Высаживаем из машины, если умер за рулём — иначе тело останется скрыто
    // внутри кузова (mesh.visible=false в машине) и падать будет некому.
    if (this.player.inVehicle) this.exitVehicle(true);
    this.player.die();
    this.deathT = 0;
    this.deathScreenShown = false;
    this._deathCamAngle = rand(0, Math.PI * 2);
  }

  // GTA-style смерть: тело падает и раскидывает руки-ноги (Character.animateDeath
  // уже это умел, но update() выходил раньше, чем успевал его вызвать — экран
  // «ТЫ ПОГИБ» перекрывал ещё стоящего персонажа мгновенно). Камера медленно
  // поднимается и смотрит на тело сверху, только потом появляется экран,
  // и через паузу — авто-возрождение; R/Enter пропускает ожидание.
  updateDeathSequence(dt) {
    this.deathT += dt;
    this.player.animate(dt);
    this.player.syncMesh();

    const px = this.player.x, pz = this.player.z;
    const fallT = Math.min(1, this.deathT / 2.2);
    const ease = fallT * fallT * (3 - 2 * fallT);
    const radius = lerp(4.5, 9, ease);
    const height = lerp(2.2, 12, ease);
    this.camera.position.set(
      px + Math.cos(this._deathCamAngle) * radius, height, pz + Math.sin(this._deathCamAngle) * radius);
    this.camera.lookAt(px, 0.6, pz);

    if (!this.deathScreenShown && this.deathT > 2.4) {
      this.deathScreenShown = true;
      this.hud.showGameOver(this);
    }
    if (this.deathScreenShown && (this.deathT > 2.4 + 5 || this.input.actHit('respawn'))) {
      this.respawn();
    }
  }

  respawn() {
    this.gameOver = false;
    this.mount = null;
    this.player.health = 100;
    if (this.player.inVehicle) {
      const v = this.player.inVehicle;
      v.driver = null;
      this.player.inVehicle = null;
      this.player.mesh.visible = true;
      this.audio.engine(false);
    }
    // respawn at owned property if you have one, else nearest hospital
    let p = null;
    if (this.progress && this.progress.owned.length) {
      const pm = this.progress.propertyMarkers.find((m) => this.progress.owned.includes(m.def.id));
      if (pm) p = { x: pm.x + rand(-3, 3), z: pm.z + rand(3, 6) };
    }
    if (!p) {
      const h = this.city.nearestLocation('hospital', this.playerX(), this.playerZ());
      p = h ? { x: h.loc.x + rand(-4, 4), z: h.loc.z + rand(3, 7) } : this.city.randomSidewalkPoint();
    }
    this.player.x = p.x; this.player.z = p.z;
    // Полный подъём на ноги: сброс одной оси поворота оставлял героя лежать,
    // если он умер лицом вниз или навзничь.
    this.player.revive();
    this.player.health = 100;
    this.armor = 0;
    this.wanted = 0;
    const fee = this.progress && this.progress.owned.length ? 200 : 500;
    this.addMoney(-Math.min(this.money, fee));
    this.inventory = makeInventory();
    this.selectWeapon('pistol');
    const restored = this.applyHomeStash();
    if (restored.length) this.showMessage('ЗАПАС ИЗ УБЕЖИЩА:\n' + restored.join(', '), 2.5);
    for (const h of this.helicopters) this.scene.remove(h.mesh);
    this.helicopters = [];
    for (const c of this.copsOnFoot) this.scene.remove(c.c.mesh);
    this.copsOnFoot = [];
    for (const a of [...this.police]) this.destroyVehicle(a.v);
    this.police = [];
    this.missions.onPlayerDeath();
    this.spawnGrace = 3;
    this.runOverCd = 0;
    this.hud.hideGameOver();
    this.showMessage('БОЛЬНИЦА\n-$500', 2.5);
  }

  bust() {
    this.wanted = 0;
    this.addMoney(-Math.min(this.money, 300));
    this.inventory = makeInventory();
    this.selectWeapon('pistol');
    // Арест уносит игрока к участку в этом же кадре — высаживаем мгновенно
    // и снимаем незаконченную посадку, иначе она доиграет уже у участка.
    this.mount = null;
    if (this.player.inVehicle) this.exitVehicle(false, true);
    const st = this.city.nearestLocation('police', this.playerX(), this.playerZ());
    const p = st ? { x: st.loc.x + rand(-4, 4), z: st.loc.z + rand(3, 7) } : this.city.randomSidewalkPoint();
    this.player.x = p.x; this.player.z = p.z;
    this.player.health = 100;
    this.player.syncMesh();
    for (const c of this.copsOnFoot) this.scene.remove(c.c.mesh);
    this.copsOnFoot = [];
    for (const a of [...this.police]) this.destroyVehicle(a.v);
    this.police = [];
    this.missions.onPlayerDeath();
    this.spawnGrace = 3;
    this.showMessage('АРЕСТ', 2.5, { tone: 'arrest', sub: '-$300' });
    this.audio.beep(300, 0.5, 0.3, 'square');
  }

  destroyVehicle(v) {
    this.scene.remove(v.mesh);
    this.vehicles = this.vehicles.filter((x) => x !== v);
    this.removeAIOf(v);
    if (this.player.inVehicle === v) {
      this.player.inVehicle = null;
      this.player.mesh.visible = true;
    }
  }

  scarePedsNear(x, z, r) {
    for (const p of this.peds) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < r) p.scare(x, z, d);
    }
  }

  // ---------------- effects ----------------
  spawnTracer(x1, y1, z1, x2, y2, z2) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, y1, z1), new THREE.Vector3(x2, y2, z2)]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffe08a, transparent: true, opacity: 0.9 }));
    this.scene.add(line);
    this.particles.push({ mesh: line, life: 0.07, maxLife: 0.07, kind: 'tracer' });
  }

  spawnSparks(x, z, scale = 1, y = null) {
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09 * scale, 4, 3),
        new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
      m.position.set(x + rand(-0.4, 0.4), y !== null ? y + rand(-0.2, 0.2) : rand(0.4, 1.4), z + rand(-0.4, 0.4));
      this.scene.add(m);
      this.particles.push({ mesh: m, life: 0.4, maxLife: 0.4, kind: 'spark',
        vx: rand(-4, 4), vy: rand(2, 6), vz: rand(-4, 4) });
    }
  }

  spawnBlood(x, z, y = null) {
    this.fx.bloodSplat(x, z);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 4, 3),
        new THREE.MeshBasicMaterial({ color: 0x8b1a1a }));
      m.position.set(x + rand(-0.3, 0.3), y !== null ? y + rand(-0.15, 0.15) : rand(0.8, 1.5), z + rand(-0.3, 0.3));
      this.scene.add(m);
      this.particles.push({ mesh: m, life: 0.6, maxLife: 0.6, kind: 'spark',
        vx: rand(-2, 2), vy: rand(1, 3), vz: rand(-2, 2) });
    }
  }

  spawnSmoke(x, y, z) {
    this.fx.smoke(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), rand(2.0, 3.4), rand(1.3, 2.1));
  }

  explode(x, z, power = 1, height = this.city.groundHeightAt(x, z)) {
    this.audio.crash(1.8);
    this.audio.explosion();
    this.fx.explosion(x, height, z, power);
    const d = this.distToPlayer(x, z);
    this.flash = Math.max(this.flash, clamp((22 - d) / 22, 0, 1) * 0.45 * power);

    for (let i = 0; i < 18; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32),
        new THREE.MeshBasicMaterial({ color: pick([0xff8a2a, 0xffd24a, 0x4a4a4a]) }));
      m.position.set(x, height + 1.4, z);
      this.scene.add(m);
      this.particles.push({ mesh: m, life: rand(0.6, 1.3), maxLife: 1.3, kind: 'debris',
        vx: rand(-12, 12), vy: rand(4, 14), vz: rand(-12, 12) });
    }
    for (let i = 0; i < 5; i++) this.spawnSmoke(x, height + 1.5, z);

    const R = 10 * power;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - x, (v.y || 0) + v.type.h / 2 - height, v.z - z);
      if (d < R && !v.destroyed) {
        v.health -= (R - d) * 10;
        if (v.health <= 0) { v.destroyed = true; v.burning = 2.5; v.onDestroyed && v.onDestroyed(); }
      }
    }
    for (const p of this.peds) {
      if (!p.dead && Math.hypot(p.x - x, p.mesh.position.y + 1 - height, p.z - z) < R * 0.8) {
        p.die(); this.kills++; this.missions.onKill(p);
      }
    }
    for (const c of this.copsOnFoot) {
      if (!c.c.dead && Math.hypot(c.c.x - x, c.c.mesh.position.y + 1 - height, c.c.z - z) < R * 0.8) { c.c.die(); this.kills++; }
    }
    for (const h of this.helicopters) {
      if (h.dead) continue;
      if (Math.hypot(h.x - x, h.y - height, h.z - z) < R * 1.4) {
        if (h.damage(160)) { this.kills++; this.showMessage('ВЕРТОЛЁТ СБИТ!', 2); }
      }
    }
    const playerHeight = this.player.inVehicle ? (this.player.inVehicle.y || 0) + 1 : this.player.mesh.position.y + 1;
    const dp = Math.hypot(this.playerX() - x, playerHeight - height, this.playerZ() - z);
    if (dp < R * 0.9) this.damagePlayer((R * 0.9 - dp) * 8);
    this.scarePedsNear(x, z, 45);
    this.missions.onExplosion(x, z);
    this.addWanted(0.7);
    this.shake(0.6);
  }

  // ---------------- vehicles ----------------
  tryEnterVehicle() {
    let best = null, bestD = 4.5;
    for (const v of this.vehicles) {
      if (v.destroyed) continue;
      const d = Math.hypot(v.x - this.player.x, v.z - this.player.z) - v.radius;
      if (d < bestD) { bestD = d; best = v; }
    }
    if (!best) return;
    // Угон происходит в момент рывка двери, а не когда игрок уже за рулём:
    // водителя выбрасывают сразу, розыск включается сразу.
    if (best.driverAI) {
      this.removeAIOf(best);
      // Водителя ВЫТАСКИВАЕМ: он появляется у своей двери, шатается и
      // убегает. Раньше рядом просто возникал случайный прохожий — и он
      // никак не был связан с тем, кого было видно за рулём.
      this.ejectDriver(best);
      this.addWanted(best.isPolice ? 1.5 : 0.9);
      this.showMessage('УГОН', 1.2);
    }
    best.driver = 'player';           // машина занята с этой секунды
    best.sirenOn = false;
    this.audio.resume();
    this.scarePedsNear(best.x, best.z, 12);
    this.beginMount(best, 'in');
  }

  /**
   * Выбросить водителя из машины.
   *
   * Внешность берём с самой машины (driverLook), поэтому из-за руля
   * выходит ровно тот человек, которого было видно через стекло. Ставим
   * его у ЕГО двери, а не в случайной точке рядом, и даём шатнуться —
   * иначе выброшенный водитель просто телепортируется на тротуар.
   */
  ejectDriver(v) {
    const side = this.nearSide(v);
    const d = this.doorPoint(v, -side);      // выходит с противоположной от игрока стороны
    const look = v.driverLook || randomLook();
    const ped = new Pedestrian(this.city, d.x, d.z, look);
    ped.heading = v.heading + side * Math.PI / 2;
    ped._groundVis = undefined;
    ped.syncMesh();
    ped.stagger();
    ped.scare(v.x, v.z);
    this.scene.add(ped.mesh);
    this.peds.push(ped);
    if (v.dummyDriver) { v.dummyDriver.visible = false; }
    v.driverLook = null;
    return ped;
  }

  /** Игрок оказывается за рулём — конец анимации посадки. */
  seatPlayer(v) {
    this.player.inVehicle = v;
    v.driver = 'player';
    this.player.mesh.visible = false;
    this.missions.onEnterVehicle(v);
  }

  // ------- анимация посадки и высадки -------
  //
  // Точку двери приходится считать из габаритов кузова: размеченного узла
  // двери нет ни в одной модели, авторы экспортируют машину одним куском.
  // Зато счёт по габаритам работает одинаково и для готовых моделей, и для
  // процедурных, и переживает замену любой модели на другую.
  /**
   * Точка у двери. sign выбирает борт: +1 — водительский, −1 — противоположный.
   *
   * Садиться всегда через водительскую дверь нельзя: если игрок подошёл с
   * другого борта, прямая от него до двери проходит сквозь кузов, и человек
   * въезжает в машину насквозь. Заходим с той стороны, где стоим.
   */
  doorPoint(v, sign = 1) {
    const side = v.heading + Math.PI / 2;
    const out = (v.type.w / 2 + 0.5) * sign;
    const along = v.type.bike ? 0 : (v.doors.find(door => door.side === sign)?.hinge.userData.doorAlong ?? v.type.l * 0.1);
    return {
      x: v.x + Math.sin(side) * out + Math.sin(v.heading) * along,
      z: v.z + Math.cos(side) * out + Math.cos(v.heading) * along,
    };
  }

  /** С какого борта машины стоит игрок. */
  nearSide(v) {
    const side = v.heading + Math.PI / 2;
    const d = (this.player.x - v.x) * Math.sin(side) + (this.player.z - v.z) * Math.cos(side);
    return d >= 0 ? 1 : -1;
  }

  seatPoint(v) {
    const side = v.heading + Math.PI / 2;
    const bike = !!v.type.bike;
    const lat = bike ? 0 : v.type.w * 0.2;
    const along = bike ? 0 : (v.doors[0]?.hinge.userData.doorAlong ?? v.type.l * 0.1);
    return {
      x: v.x + Math.sin(side) * lat + Math.sin(v.heading) * along,
      z: v.z + Math.cos(side) * lat + Math.cos(v.heading) * along,
      y: (v.y || 0) + (bike ? (v.type.scooter ? 0.62 : 0.72) : (v.doors[0]?.hinge.userData.seatHeight ?? v.type.h * 0.42)),
    };
  }

  /**
   * Углы суставов «сидит за рулём».
   *
   * Одни и те же числа нужны и езде (poseRider), и анимации посадки. Держать
   * их в двух местах нельзя: в момент, когда посадка кончается и начинается
   * управление, тело дёрнулось бы на разницу между двумя наборами.
   */
  seatTargets(v, lean = 0, fast = 0) {
    const bike = !!v.type.bike;
    return {
      lean,
      hipsX: bike ? 0.16 + fast * 0.34 : 0.06,
      hipsZ: lean * (bike ? 0.30 : 0.10),
      chestX: bike ? 0.10 + fast * 0.16 : 0.04,
      chestY: lean * 0.12,
      headX: bike ? -0.12 - fast * 0.10 : 0,
      shoulderX: bike ? -1.15 : -1.0,
      shoulderY: bike ? 0.30 : 0.22,
      shoulderZ: 0.10,
      elbowX: bike ? -0.42 : -0.72,
      hipX: bike ? -0.95 : -1.15,
      hipZ: bike ? 0.26 : 0.12,
      kneeX: bike ? 1.25 : 1.05,
      footX: bike ? -0.25 : -0.15,
    };
  }

  /** Наложить позу сидящего с весом k: 0 — стоит прямо, 1 — сидит. */
  applySeated(pl, T, k) {
    pl.hips.rotation.x = T.hipsX * k;
    pl.hips.rotation.z = T.hipsZ * k;
    pl.chest.rotation.x = T.chestX * k;
    pl.chest.rotation.y = T.chestY * k;
    pl.headPivot.rotation.x = T.headX * k;
    pl.headPivot.rotation.z = 0;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const a = pl.arms[i];
      a.shoulder.rotation.x = T.shoulderX * k;
      a.shoulder.rotation.y = s * T.shoulderY * k;
      a.shoulder.rotation.z = (s * T.shoulderZ - T.lean * 0.10) * k;
      a.elbow.rotation.x = T.elbowX * k;
      const l = pl.legs[i];
      l.hip.rotation.x = T.hipX * k;
      l.hip.rotation.z = s * T.hipZ * k;
      l.knee.rotation.x = T.kneeX * k;
      l.foot.rotation.x = T.footX * k;
    }
  }

  beginMount(v, dir) {
    const bike = !!v.type.bike;
    this.mount = {
      v, dir, t: 0,
      dur: dir === 'in' ? (bike ? 0.46 : 1.05) : (bike ? 0.38 : 1.0),
      // Борт выбирается один раз на входе: если пересчитывать каждый кадр,
      // на пороге он начнёт переключаться и игрока будет мотать вокруг машины.
      sign: dir === 'in' ? this.nearSide(v) : 1,
      x0: this.player.x, z0: this.player.z, h0: this.player.heading,
    };
    v.setDoor(this.mount.sign, true);
  }

  /** Аварийный выход: машина исчезла посреди анимации — ставим игрока рядом. */
  abortMount() {
    const m = this.mount;
    this.mount = null;
    const pl = this.player;
    if (m && m.v) {
      m.v.setDoor(m.sign, false);
      const d = this.doorPoint(m.v, m.sign);
      pl.x = d.x; pl.z = d.z;
    }
    pl.inVehicle = null;
    pl.y = 0;
    pl.mesh.visible = true;
    pl.mesh.rotation.set(0, pl.heading, 0);
    pl.hips.position.y = 0.92;
    if (m && m.v) this.applySeated(pl, this.seatTargets(m.v), 0);
    pl._groundVis = undefined;
    pl.syncMesh();
  }

  updateMount(dt) {
    const m = this.mount;
    const v = m.v;
    const pl = this.player;
    // Машину могло разнести взрывом или выгрузить из мира прямо во время
    // посадки — тогда анимации некуда идти.
    if (!v || v.destroyed || !this.vehicles.includes(v)) { this.abortMount(); return; }

    m.t += dt;
    const p = clamp(m.t / m.dur, 0, 1);
    const ease = (u) => u * u * (3 - 2 * u);
    const door = this.doorPoint(v, m.sign);
    const seat = this.seatPoint(v);
    const faceIn = v.heading - m.sign * Math.PI / 2;    // лицом к машине
    const faceOut = v.heading + m.sign * Math.PI / 2;   // лицом от машины
    const T = this.seatTargets(v);

    // На мотоцикле и в кабриолете водителя видно всегда, и посадка кончается
    // ровно той позой, которую дальше держит poseRider. В закрытый салон всё
    // иначе: человек ростом 1.75 м не влезает в кабину высотой 1.3 м стоя —
    // он обязан сложиться. Поэтому туда не поднимаемся на высоту сиденья, а
    // приседаем и пригибаемся, и на последних процентах тело гаснет: дальше
    // его всё равно не видно из салона.
    const openTop = !!(v.type.bike || v.type.convertible);
    let x, z, y, head, k = 0, duck = 0;

    if (m.dir === 'in') {
      // Первая часть — дойти до двери и развернуться к машине, вторая —
      // занырнуть на сиденье. Разделены, иначе игрок въезжает в кузов боком.
      const SPLIT = 0.42;
      if (p < SPLIT) {
        const a = ease(p / SPLIT);
        x = lerp(m.x0, door.x, a); z = lerp(m.z0, door.z, a);
        head = angleLerp(m.h0, faceIn, a);
        y = 0;
        pl.walkPhase += dt * 9;    // ноги переставляются, а не едут юзом
      } else {
        const b = ease((p - SPLIT) / (1 - SPLIT));
        x = lerp(door.x, seat.x, b); z = lerp(door.z, seat.z, b);
        head = angleLerp(faceIn, v.heading, b);
        // В закрытый салон не поднимаемся, а проваливаемся: ноги уходят ниже
        // уровня дороги, зато голова уходит под линию крыши. Ноги в этот
        // момент внутри кузова, наружу их не видно.
        y = openTop ? seat.y * b : -0.26 * b;
        k = b;
        duck = b;
      }
    } else {
      const b = 1 - ease(v.type.bike ? p : clamp((p - .32) / .68, 0, 1));
      x = lerp(door.x, seat.x, b); z = lerp(door.z, seat.z, b);
      head = angleLerp(faceOut, v.heading, b);
      y = openTop ? seat.y * b : 0;
      k = b;
      duck = b;
    }

    pl.x = x; pl.z = z; pl.y = y;
    pl.heading = head;
    pl.speed = 0;
    pl.aiming = false;
    pl.airborne = false;
    // Внутри закрытого салона тело прячем: наружу оно всё равно не читается,
    // а сквозь стекло и крышу лезло бы углами.
    pl.mesh.visible = !this.cam.isFirstPerson && !(!openTop && k > 0.8);
    pl.mesh.position.set(x, y, z);
    pl.mesh.rotation.set(0, head, 0);

    this.applySeated(pl, T, k);
    if (k > 0) {
      // Пригибание: без него человек «втекает» в машину с прямой спиной,
      // как манекен на рельсе. В закрытый салон складываемся вчетверо
      // глубже — там просто нет места на рост во весь.
      const deep = openTop ? 0.14 : 0.62;
      const fold = openTop ? 0.30 : 1.05;
      pl.hips.position.y = 0.92 - duck * deep;
      pl.chest.rotation.x += duck * fold;
      pl.headPivot.rotation.x -= duck * (openTop ? 0.22 : 0.55);
      pl.legs[0].knee.rotation.x += duck * 0.35;
    } else {
      pl.hips.position.y = 0.92;
      pl.animate(dt);
    }

    if (p >= 1) {
      v.setDoor(m.sign, false);
      this.mount = null;
      if (m.dir === 'in') {
        this.seatPlayer(v);
      } else {
        pl.y = 0;
        pl.mesh.visible = true;
        this.applySeated(pl, T, 0);
        pl.hips.position.y = 0.92;
        // Сглаженную высоту земли снимаем: игрок телепортировался от сиденья
        // к двери, и старое значение протащило бы его сквозь бордюр.
        pl._groundVis = undefined;
        pl.syncMesh();
      }
    }
  }

  // Посадка водителя на открытом транспорте: тело следует за машиной,
  // руки на руле, ноги на подножках, корпус кренится в поворот.
  poseRider(v, dt) {
    const pl = this.player;
    const bike = !!v.type.bike;
    pl.x = v.x; pl.z = v.z;
    pl.heading = v.heading;
    pl.speed = 0;
    pl.aiming = false;
    pl.idleAnim = 0;
    pl.airborne = false;

    const seatY = bike ? (v.type.scooter ? 0.62 : 0.72) : v.type.h * 0.42;
    pl.y = (v.y || 0) + seatY;
    pl.mesh.position.set(v.x, pl.y, v.z);
    pl.mesh.rotation.set(0, v.heading, 0);

    const lean = clamp(-(v.steer || 0) * clamp(Math.abs(v.speed) / 18, 0, 1), -1, 1);
    const fast = clamp(Math.abs(v.speed) / v.type.topSpeed, 0, 1);
    const k = Math.min(1, dt * 10);
    const to = (o, key, val) => { o[key] = o[key] + (val - o[key]) * k; };
    // Цели те же, что кончает анимация посадки, — иначе на стыке рывок.
    const T = this.seatTargets(v, lean, fast);

    // корпус: пригибается на скорости, кренится в поворот
    to(pl.hips.rotation, 'x', T.hipsX);
    to(pl.hips.rotation, 'z', T.hipsZ);
    pl.hips.position.y = 0.92;
    to(pl.chest.rotation, 'x', T.chestX);
    to(pl.chest.rotation, 'y', T.chestY);
    to(pl.headPivot.rotation, 'x', T.headX);
    to(pl.headPivot.rotation, 'z', 0);

    // руки вперёд на руль
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const a = pl.arms[i];
      to(a.shoulder.rotation, 'x', T.shoulderX);
      to(a.shoulder.rotation, 'y', sgn * T.shoulderY);
      to(a.shoulder.rotation, 'z', sgn * T.shoulderZ - lean * 0.10);
      to(a.elbow.rotation, 'x', T.elbowX);
    }
    // ноги: на байке подобраны и разведены, в машине согнуты к педалям
    for (let i = 0; i < 2; i++) {
      const sgn = i === 0 ? 1 : -1;
      const l = pl.legs[i];
      to(l.hip.rotation, 'x', T.hipX);
      to(l.hip.rotation, 'z', sgn * T.hipZ);
      to(l.knee.rotation, 'x', T.kneeX);
      to(l.foot.rotation, 'x', T.footX);
    }
  }

  /**
   * Выход из машины.
   *
   * Обычный выход проигрывается анимацией: игрок выбирается через дверь и
   * разворачивается от машины. Мгновенный нужен там, где анимации некуда
   * играть: взрыв, смерть, арест, загрузка сейва — игрока в тот же кадр
   * уносит в другое место, и анимация ехала бы поверх.
   *
   * Урон отделён от мгновенности: за прыжок из горящей машины бьёт, а за
   * арест и загрузку сейва бить не за что.
   */
  exitVehicle(forced = false, instant = forced) {
    const v = this.player.inVehicle;
    if (!v) return;
    this.lastCar = v;                 // метка «где я бросил тачку»
    v.driver = null;
    this.player.inVehicle = null;
    this.player.mesh.visible = true;
    this.player.y = 0;                // сбрасываем посадочную высоту райдера
    this.player.mesh.rotation.set(0, this.player.heading, 0);
    this.audio.engine(false);
    this.audio.skid(false);

    if (!instant && !v.destroyed && this.vehicles.includes(v)) {
      this.player.heading = v.heading;
      this.beginMount(v, 'out');
      return;
    }

    const side = v.heading + Math.PI / 2;
    this.player.x = v.x + Math.sin(side) * (v.type.w / 2 + 1.0);
    this.player.z = v.z + Math.cos(side) * (v.type.w / 2 + 1.0);
    this.player.heading = v.heading;
    this.player.hips.position.y = 0.92;
    this.applySeated(this.player, this.seatTargets(v), 0);
    this.player._groundVis = undefined;
    this.player.syncMesh();
    if (forced) this.damagePlayer(10);
  }

  // ---------------- world systems ----------------
  updateDayNight(dt) {
    this.clockTime = (this.clockTime + dt * (86400 / DAY_LENGTH)) % 86400;
    const h = this.clockTime / 3600;
    const {night,dusk,sun:solar}=sampleDay(h);
    const dayCol = new THREE.Color(0xa2b6c2);
    const duskCol = new THREE.Color(0xc18b68);
    const nightCol = new THREE.Color(0x263348);
    const sky = dayCol.clone().lerp(nightCol, night);
    sky.lerp(duskCol, dusk * 0.55 * (1 - night * 0.6));

    this.scene.fog.color.copy(sky);
    this.scene.background = null;   // painted skybox handles it now

    // Ночь была освещена как пасмурный день: полусфера 0.55 плюс заливка
    // 0.45 плюс «луна» 0.34 — бетон читался белым в 23:00, и вся работа
    // с окнами, витринами, фонарями и фарами пропадала впустую. Теперь
    // общий свет ночью почти гаснет, а сцену держат искусственные
    // источники — ради этого они и делались.
    this.sun.intensity = lerp(1.55, 0.12, night);
    // Цвета ведём непрерывно. Тернарники по порогу (night > 0.6) меняли
    // оттенок солнца одним кадром — на рассвете это видно как щелчок.
    const sunWarm = new THREE.Color(0xfff0d8);
    const sunDusk = new THREE.Color(0xffb070);
    const sunMoon = new THREE.Color(0x9db4dc);
    const sunC = sunWarm.clone().lerp(sunDusk, dusk * 0.85).lerp(sunMoon, night);
    this.sun.color.copy(sunC);

    this.hemi.intensity = lerp(1.05, 0.38, night);
    this.hemi.color.copy(new THREE.Color(0xbcd4e6).lerp(new THREE.Color(0x5a6c8c), night));
    this.hemi.groundColor.copy(new THREE.Color(0x4a4438).lerp(new THREE.Color(0x1e232c), night));
    if (!this.streetFill) {
      this.streetFill = new THREE.PointLight(0xffd9a0, 0, 26, 2.0);
      this.scene.add(this.streetFill);
    }
    // Единственная поблажка играбельности: тёплое пятно вокруг игрока,
    // чтобы в тёмном переулке было видно, куда идёшь.
    //
    // Сила в ФИЗИЧЕСКИХ единицах: у точечного источника с decay 2 освещённость
    // падает как intensity/d². Прежние 0.45 давали на восьми метрах 0.007 —
    // этот источник просто никогда ничего не освещал, хотя комментарий рядом
    // обещал «сильную заливку». Нужны десятки, а не десятые доли.
    // 38 на 42 метра разливало вокруг игрока световое озеро на пол-улицы
    // и спорило со светом фар и витрин. Нужен тесный тёплый круг под ноги.
    this.streetFill.intensity = night * 20;
    // Светит со стороны камеры, а не строго сверху: источник над макушкой
    // освещал темя и плечи, а всё, что игрок реально видит перед собой,
    // включая собственную спину, оставалось чёрным силуэтом.
    this.streetFill.position.set(
      lerp(this.playerX(), this.camera.position.x, 0.4), 5.5,
      lerp(this.playerZ(), this.camera.position.z, 0.4));

    // Continuous light trajectory. It passes below the horizon while the
    // hemisphere fill carries twilight; no fixed 30-metre vertical clamp.
    const illumination=1-night;
    this.sun.intensity=1.55*illumination;
    this.sunDir={x:solar.x*180,y:solar.y*180,z:solar.z*180};
    this.nightFactor = night;
    this.duskFactor = dusk;
    const wantLights = night > 0.35 || this.weather === 'fog' || this.weather === 'rain';
    if (this._headlightsOn !== wantLights) {
      this._headlightsOn = wantLights;
      for (const v of this.vehicles) v.setHeadlights(wantLights);
    }
    // Порог был 0.05 — двадцать ступеней на весь рассвет, и окна гасли
    // заметными скачками. Обновление стоит несколько сотен записей в
    // материалы, его можно делать на порядок чаще.
    if (this._lastNightStep === undefined || Math.abs(night - this._lastNightStep) > 0.004) {
      this._lastNightStep = night;
      this.city.setNight(night);
    }
    this.city.viewPosition = this.camera.position;
    this.city.updateDetails(dt, this.time, night);
  }

  updateWeather(dt) {
    this.weatherT -= dt;
    if (this.weatherT <= 0) {
      this.weather = pick(['clear', 'clear', 'clear', 'rain', 'fog']);
      this.weatherT = rand(70, 180);
      if (this.weather === 'rain') this.showMessage('НАЧАЛСЯ ДОЖДЬ', 2);
      if (this.weather === 'fog') this.showMessage('ТУМАН', 2);
    }
    // Дождь набирает и теряет силу плавно. Раньше частицы включались одним
    // кадром — стена воды возникала из ничего. Порог 0.02, чтобы при почти
    // нулевой силе не гонять геометрию впустую.
    this._fogAmt = (this._fogAmt || 0) + ((this.weather === 'fog' ? 1 : 0) - (this._fogAmt || 0)) * (1-Math.exp(-dt/12));
    const raining = this.weather === 'rain';
    this._rainAmt = (this._rainAmt || 0) + ((raining ? 1 : 0) - (this._rainAmt || 0)) * Math.min(1, dt * 0.35);
    const amt = this._rainAmt;
    this.rainParticles.visible = amt > 0.02;
    this.rainParticles.material.opacity = 0.42 * amt;
    if (this.splashes) this.splashes.material.opacity = 0.5 * amt;
    if (amt > 0.02) {
      const px = this.playerX(), pz = this.playerZ();
      this.rainParticles.position.set(px, 0, pz);
      const arr = this.rainParticles.geometry.attributes.position.array;
      const fall = 48 * dt;
      for (let i = 0; i < this.rainCount; i++) {
        const o = i * 6;
        arr[o + 1] -= fall;
        arr[o + 4] -= fall;
        if (arr[o + 4] < 0) {
          const x = rand(-48, 48), y = rand(46, 54), z = rand(-48, 48);
          arr[o] = x;        arr[o + 1] = y;
          arr[o + 2] = z;    arr[o + 3] = x + 0.07;
          arr[o + 4] = y - 0.42; arr[o + 5] = z;
        }
      }
      this.rainParticles.geometry.attributes.position.needsUpdate = true;

      // всплески на асфальте: короткие вертикальные штрихи, живут 0.4 с
      this.splashes.visible = amt > 0.05;
      const sarr = this.splashes.geometry.attributes.position.array;
      for (let i = 0; i < this.splashCount; i++) {
        const st = this.splashState[i];
        st.t -= dt;
        if (st.t <= 0) {
          st.x = px + rand(-26, 26);
          st.z = pz + rand(-26, 26);
          st.t = st.life = rand(0.18, 0.42);
        }
        const k = st.t / st.life;              // 1 -> 0 по мере затухания
        const h = 0.55 * k;
        const o = i * 6;
        sarr[o] = st.x;      sarr[o + 1] = 0.02;     sarr[o + 2] = st.z;
        sarr[o + 3] = st.x;  sarr[o + 4] = 0.02 + h; sarr[o + 5] = st.z;
      }
      this.splashes.geometry.attributes.position.needsUpdate = true;
    } else if (this.splashes) {
      this.splashes.visible = false;
    }

    // мокрый асфальт: дорога темнеет и «блестит», трава тоже темнеет
    // amt уже сглажен выше; второй фильтр поверх него только удваивал
    // задержку — асфальт продолжал блестеть спустя десяток секунд после дождя.
    this._wet = amt;
    if (this.city.setWetness) this.city.setWetness(this._wet);
    // живая вода, покачивание лодок, маяк
    this.city.updateWater(dt, this.nightFactor || 0);
    this.city.updateWaterfront(this.time, this.nightFactor || 0);

    // Плотность дымки: ясно — лёгкая, дождь — заметнее, туман — стена.
    // Цель ведём к целевой плавно, чтобы смена погоды не щёлкала.
    // Ночью город слегка «дышит»: дымка гуще, дальние кварталы тонут в
    // зареве вместо того, чтобы висеть чёткими силуэтами до горизонта.
    const base = this.fogBase * (1 + (this.nightFactor || 0) * 0.45);
    const target = lerp(lerp(base, 0.0052, amt),0.0135,this._fogAmt);
    this.scene.fog.density = lerp(this.scene.fog.density, target, Math.min(1, dt * 0.6));
    this.gripMul = 1 - 0.18 * amt;
  }

  updateLocations(dt) {
    const px = this.playerX(), pz = this.playerZ();
    for (const loc of this.city.locations) {
      loc.cooldown = Math.max(0, loc.cooldown - dt);
      const d = Math.hypot(loc.x - px, loc.z - pz);
      if (d > loc.radius || loc.cooldown > 0) continue;

      if (loc.type === 'spray' && this.player.inVehicle) {
        const v = this.player.inVehicle;
        const cost = 100;
        if (this.money >= cost && (v.health < v.maxHealth || this.wanted > 0)) {
          this.addMoney(-cost);
          v.repair();
          this.wanted = 0;
          loc.cooldown = 6;
          this.showMessage("PAY'N'SPRAY\nРемонт и сброс розыска -$100", 2.5);
          this.audio.beep(760, 0.2, 0.25);
        }
      } else if (loc.type === 'ammu' && !this.player.inVehicle) {
        const price = { pistol: 100, uzi: 400, shotgun: 600, rifle: 900, rocket: 2000, ak47: 1100, m4a1: 1250, armor: 300 };
        if (this.input.actHit('interact')) {
          const menu = ['pistol', 'uzi', 'shotgun', 'rifle', 'rocket', 'ak47', 'm4a1', 'armor'];
          const item = menu[this.shopIndex % menu.length];
          const cost = price[item];
          if (this.money >= cost) {
            this.addMoney(-cost);
            if (item === 'armor') this.armor = 100;
            else {
              this.inventory[item] += WEAPONS[item].pickup;
              this.selectWeapon(item);
            }
            this.showMessage(`КУПЛЕНО: ${item === 'armor' ? 'БРОНЯ' : WEAPONS[item].name}\n-$${cost}`, 2);
            this.audio.beep(900, 0.15, 0.25);
          } else this.showMessage('НЕ ХВАТАЕТ ДЕНЕГ', 1.5);
          loc.cooldown = 0.4;
        }
      } else if (loc.type === 'hospital' && !this.player.inVehicle) {
        if (this.player.health < 100 && this.money >= 50) {
          this.addMoney(-50);
          this.player.health = 100;
          loc.cooldown = 5;
          this.showMessage('ЛЕЧЕНИЕ -$50', 2);
          this.audio.beep(880, 0.2, 0.25);
        }
      }
    }
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.spin += dt * 2;
      if (!p.mesh.userData.groundWeapon) {
        p.mesh.rotation.y = p.spin;
        p.mesh.position.y = this.city.groundHeightAt(p.x, p.z) + 1.1 + Math.sin(p.spin * 1.5) * .15;
      }
      if (this.player.inVehicle) continue;
      if (Math.hypot(p.x - this.player.x, p.z - this.player.z) < 1.6
        && Math.abs(this.player.mesh.position.y - this.city.groundHeightAt(p.x, p.z)) < 1.4) {
        if (p.id === 'armor') { this.armor = 100; this.showMessage('БРОНЯ', 1.4); }
        else if (p.id === 'health') { this.player.health = Math.min(100, this.player.health + 45); this.showMessage('АПТЕЧКА', 1.4); }
        else if (p.id === 'cash') { const c = randInt(80, 350); this.addMoney(c); this.showMessage(`+$${c}`, 1.4); }
        else {
          this.inventory[p.id] += WEAPONS[p.id].pickup;
          this.selectWeapon(p.id);
          this.showMessage(WEAPONS[p.id].name, 1.4);
        }
        this.audio.beep(1050, 0.14, 0.25);
        this.scene.remove(p.mesh);
        this.pickups.splice(i, 1);
      }
    }
    if (this.pickups.length < 12 && Math.random() < dt * 0.4) this.spawnWeaponPickup();
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      let nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, ny = p.y + (p.vy || 0) * dt;
      let hit = p.life <= 0;

      const boxes = [];
      this.city.nearbyColliders(p.x, p.z, Math.hypot(nx - p.x, nz - p.z) + 3, boxes);
      const segment = new THREE.Vector3(nx - p.x, ny - p.y, nz - p.z), distance = segment.length();
      segment.normalize();
      const start = { x: p.x, y: p.y, z: p.z };
      let clear = traceSolids(start, segment, distance, boxes);
      for (const vehicle of this.vehicles) if (!vehicle.destroyed)
        clear = traceSphere(start, segment, clear, { x: vehicle.x, y: (vehicle.y || 0) + vehicle.type.h / 2, z: vehicle.z }, vehicle.radius);
      for (const actor of [...this.peds, ...this.copsOnFoot.map(cop => cop.c)]) if (!actor.dead)
        clear = traceSphere(start, segment, clear, { x: actor.x, y: actor.mesh.position.y + 1, z: actor.z }, .7);
      for (const helicopter of this.helicopters) if (!helicopter.dead)
        clear = traceSphere(start, segment, clear, helicopter, 3.8);
      if (clear < distance) { nx = p.x + segment.x * clear; ny = p.y + segment.y * clear; nz = p.z + segment.z * clear; hit = true; }
      if (ny <= this.city.groundHeightAt(nx, nz)) { ny = this.city.groundHeightAt(nx, nz); hit = true; }

      p.x = nx; p.z = nz; p.y = ny;
      p.mesh.position.set(nx, ny, nz);
      if (Math.random() < 0.6) this.spawnSmoke(nx, p.y, nz);

      if (hit) {
        this.explode(nx, nz, 1.4, ny);
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // ---------------- main update ----------------
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h);
  }

  update(dt) {
    this.time += dt;
    this.stats.playTime += dt;
    const input = this.input;

    if (this.gameOver) {
      this.updateDeathSequence(dt);
      input.endFrame();
      return;
    }

    input.pollGamepad();
    this.cam.handleMouse(input.mouseDX, input.mouseDY);

    if (input.actHit('camera') || input.padHit(3)) {
      this.showMessage(this.cam.cycle(), 1.5);
      this.audio.beep(760, 0.06, 0.14, 'square');
    }

    // Во время посадки клавиша не слушается: повторное нажатие иначе
    // запускало бы вторую анимацию поверх первой.
    if ((input.actHit('enter') || input.padHit(2)) && !this.mount) {
      if (this.player.inVehicle) this.exitVehicle();
      else this.tryEnterVehicle();
    }
    if (input.act('horn') && this.player.inVehicle) {
      this.hornCd = (this.hornCd || 0) - dt;
      if (this.hornCd <= 0) { this.hornCd = 0.45; this.audio.horn(); }
    }
    if (input.wheel !== 0) this.switchWeapon(input.wheel > 0 ? 1 : -1);
    if (input.actHit('nextWeapon') || input.padHit(5)) this.switchWeapon(1);
    if (input.padHit(4)) this.switchWeapon(-1);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      if (input.hit('Digit' + i)) this.selectWeapon(WEAPON_ORDER[i - 1]);
    }
    this.shopIndex = this.shopIndex || 0;
    if (input.actHit('shopNext')) { this.shopIndex++; this.audio.beep(600, 0.05, 0.12); }
    if (input.actHit('radio')) this.cycleRadio(1);
    if (input.actHit('reload')) {
      if (this.player.inVehicle) this.cycleRadio(1);
      else this.startReload();
    }
    this.updateWeaponState(dt);

    const prevX = this.playerX(), prevZ = this.playerZ();

    if (this.mount) this.updateMount(dt);
    else if (this.player.inVehicle) this.updateDriving(dt);
    else this.updateOnFoot(dt);

    this.stats.distance += Math.hypot(this.playerX() - prevX, this.playerZ() - prevZ);

    this.city.updateTrafficLights(dt);
    this.updateAI(dt);
    this.updateHelicopters(dt);
    this.progress.updatePackages(dt);
    this.progress.updateProperties(dt);
    this.progress.updateRampages(dt);
    this.updateStunts(dt);
    this.updateRadio(dt);
    this.updateWanted(dt);
    this.missions.update(dt);
    this.updateParticles(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updateLocations(dt);
    this.updateStreaming(dt);
    this.updateDayNight(dt);
    this.updateWeather(dt);
    this.fx.update(dt);
    this.tutorial.update(dt);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    this.cam.update(dt);
    this.sky.update(this.clockTime / 3600, this.nightFactor || 0,
      this.sunDir || { x: 90, y: 140, z: 60 }, this.camera.position,
      this.time, Math.max(this._rainAmt || 0, this._fogAmt || 0));

    const px = this.playerX(), pz = this.playerZ();
    const sd = this.sunDir || { x: 90, y: 140, z: 60 };
    this.sun.position.set(px + sd.x, sd.y, pz + sd.z);
    this.sun.target.position.set(px, 0, pz);

    this.spawnGrace = Math.max(0, this.spawnGrace - dt);
    this.msgT = Math.max(0, this.msgT - dt);
    input.endFrame();
  }

  updateOnFoot(dt) {
    const input = this.input;
    const ax = input.axis();
    const aiming = input.aimDown() && !this.weaponState.reload && this.weapon !== 'fist';
    const sprint = input.act('sprint') && !aiming;
    const crouching = input.act('crouch') && !this.player.airborne;

    this.player.crouch = lerp(this.player.crouch, crouching ? 1 : 0, Math.min(1, dt * 10));
    this.aimingDownSights = aiming;
    this.player.aiming = aiming;

    let speed = sprint ? 6.5 : 3.4;
    if (aiming) speed *= 0.42;
    if (crouching) speed *= 0.45;
    if (this.player.airborne) speed *= 0.85;

    // movement is always camera-relative
    const cy = this.cam.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy);
    // right = forward × up, otherwise A and D are swapped
    const rx = -Math.cos(cy), rz = Math.sin(cy);
    const dx = fx * ax.y + rx * ax.x;
    const dz = fz * ax.y + rz * ax.x;

    // in first person or while aiming the body faces the camera (strafing)
    const strafe = aiming || this.cam.isFirstPerson;
    this.player.aimHeading = cy;
    this.player.aimPitch = -this.cam.pitch;
    this.player.move(dt, dx, dz, speed, { strafe });
    if (strafe) {
      this.player.heading = angleLerp(this.player.heading, cy, Math.min(1, dt * 18));
      this.player.syncMesh();
    }

    if (input.actHit('jump') && this.player.jump()) {
      this.audio.beep(320, 0.06, 0.1, 'triangle');
    }

    // Пыль и следы из-под ног. Шаг ловится по фазе ходьбы (см. stepped в
    // character.js), поэтому облачко появляется ровно там, где нога встала,
    // а не по таймеру рядом с игроком.
    const pl = this.player;
    if (pl.stepped) {
      const side = pl.stepped * 0.16;
      const fx = Math.sin(pl.heading), fz = Math.cos(pl.heading);
      const sxp = pl.x + fz * side, szp = pl.z - fx * side;
      const бег = pl.speed > 4.6;
      // Пыль поднимает только бег: от спокойного шага её в городе не бывает,
      // а на каждом шаге она превращалась бы в дымовую завесу за игроком.
      if (бег) this.fx.footDust(sxp, szp, rand(0.4, 0.6));
    }

    // Урон от жёсткого приземления: раньше можно было прыгать с любой
    // высоты без последствий.
    const imp = this.player.landImpact || 0;
    if (imp > 0) {
      this.player.landImpact = 0;
      // Приземление всегда выбивает пыль, даже шагом.
      this.fx.footDust(pl.x, pl.z, clamp(0.5 + imp * 0.05, 0.5, 1.4));
      if (imp > 15) {
        const dmg = Math.round((imp - 15) * 4.5);
        if (dmg > 0) {
          this.damagePlayer(dmg);
          this.player.stagger();
          this.shake(clamp(imp / 45, 0.15, 0.6));
          this.audio.crash(clamp(imp / 30, 0.2, 0.8));
        }
      }
    }

    // hide own body in first person so it doesn't block the view
    this.player.mesh.visible = !this.cam.isFirstPerson;
    this.weaponHolder.visible = true;

    this.shootCd -= dt;
    const w = this.weaponDef;
    const wantFire = w.auto ? input.fireDown() : input.fireHit();
    if (wantFire && this.shootCd <= 0) this.playerAttack();

    this.audio.engine(false);
    this.audio.skid(false);

    this.runOverCd = Math.max(0, this.runOverCd - dt);
    if (this.runOverCd <= 0) {
      for (const v of this.vehicles) {
        if (Math.abs(v.speed) < 5) continue;
        if (Math.hypot(v.x - this.player.x, v.z - this.player.z) < v.radius + 0.6) {
          this.damagePlayer(clamp((Math.abs(v.speed) - 4) * 1.8, 4, 34));
          this.shake(0.45);
          this.runOverCd = 1.1;
          const ang = Math.atan2(this.player.x - v.x, this.player.z - v.z);
          this.player.x += Math.sin(ang) * 2.2;
          this.player.z += Math.cos(ang) * 2.2;
          this.player.syncMesh();
          break;
        }
      }
    }

    if (this.wanted >= 1) {
      for (const c of this.copsOnFoot) {
        if (!c.c.dead && Math.hypot(c.c.x - this.player.x, c.c.z - this.player.z) < 2.2) {
          this.bust();
          break;
        }
      }
    }
  }

  updateDriving(dt) {
    const input = this.input;
    const v = this.player.inVehicle;
    const axes = input.driveAxes();
    let throttle = axes.throttle;
    let steer = axes.steer;
    const hand = input.act('handbrake') || input.padDown(0);
    // На мотоцикле и в кабриолете водителя видно: раньше тело пряталось
    // всегда, и байк ехал «сам по себе».
    const openTop = !!(v.type.bike || v.type.convertible);
    this.player.mesh.visible = openTop && !this.cam.isFirstPerson;
    if (openTop) this.poseRider(v, dt);

    if (this.gripMul && this.gripMul < 1) steer *= 1.08;
    v.drive(dt, throttle, steer, hand);

    const rpm = clamp(Math.abs(v.speed) / v.type.topSpeed, 0.05, 1);
    this.audio.engine(true, rpm, 0.15 + rpm * 0.13, v.isBike ? 1.5 : 1);
    const drifting = v.skidding || (hand && Math.abs(v.speed) > 6);
    this.audio.skid(drifting);

    // rubber on the road + tyre smoke
    this.skidCd = (this.skidCd || 0) - dt;
    if (drifting && this.skidCd <= 0) {
      this.skidCd = 0.045;
      const bx = Math.cos(v.heading) * v.type.w * 0.42;
      const bz = -Math.sin(v.heading) * v.type.w * 0.42;
      this.fx.skidMark(v.x + bx, v.z + bz, v.heading);
      this.fx.skidMark(v.x - bx, v.z - bz, v.heading);
      if (Math.random() < 0.5) this.fx.smoke(v.x, 0.35, v.z, rand(1.2, 2.0), 0.85);
    }
    // wrecked cars leak and smoke
    if (v.destroyed) {
      this.oilCd = (this.oilCd || 0) - dt;
      if (this.oilCd <= 0 && Math.abs(v.speed) > 1) { this.oilCd = 0.6; this.fx.oilStain(v.x, v.z); }
    }

    if (v.destroyed && Math.random() < dt * 12) this.spawnSmoke(v.x, 1.2, v.z);

    if (Math.abs(v.speed) > 4) {
      for (const p of this.peds) {
        if (p.dead) continue;
        if (Math.hypot(p.x - v.x, p.z - v.z) < v.radius + 0.5 && Math.abs(v.y - p.y) < 1.6) {
          p.die(); this.kills++;
          this.addWanted(1.2);
          this.spawnBlood(p.x, p.z);
          this.audio.crash(0.7);
          this.shake(0.25);
          v.speed *= 0.93;
          this.scarePedsNear(p.x, p.z, 28);
          this.missions.onKill(p);
        }
      }
      for (const cop of this.copsOnFoot) {
        const c = cop.c;
        if (c.dead) continue;
        if (Math.hypot(c.x - v.x, c.z - v.z) < v.radius + 0.5) {
          c.die(); this.kills++; this.addWanted(1.6);
          this.spawnBlood(c.x, c.z);
        }
      }
    }
  }

  updateAI(dt) {
    const ctx = {
      player: this.player,
      vehicles: this.vehicles,
      wanted: Math.floor(this.wanted),
      policeShoot: (sx, sz, tx, tz, d) => this.policeShoot(sx, sz, tx, tz, d),
      enemyShoot: (sx, sz, tx, tz, d) => this.enemyShoot(sx, sz, tx, tz, d),
      honk: (x, z) => { if (this.distToPlayer(x, z) < 45) this.audio.horn(0.1); },
    };

    for (const a of this.traffic) a.update(dt, ctx);
    for (const a of this.police) a.update(dt, ctx);
    for (const a of this.copsOnFoot) a.update(dt, ctx);
    for (const p of this.peds) p.update(dt, ctx);

    for (let i = 0; i < this.vehicles.length; i++) {
      const a = this.vehicles[i];
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const b = this.vehicles[j];
        if (Math.abs(a.x - b.x) > 9 || Math.abs(a.z - b.z) > 9) continue;
        const rel = Vehicle.separate(a, b);
        if (rel > 9) {
          this.audio.crash(clamp(rel / 18, 0.2, 1));
          this.spawnSparks((a.x + b.x) / 2, (a.z + b.z) / 2, 1);
          if (this.player.inVehicle === a || this.player.inVehicle === b) this.shake(0.35);
        }
        for (const c of [a, b]) {
          if (c.health <= 0 && !c.destroyed) { c.destroyed = true; c.burning = 2.5; c.onDestroyed(); }
        }
      }
    }

    for (const v of this.vehicles) v.update(dt);

    let sirenNear = false;
    for (const a of this.police) {
      if (!a.v.destroyed && this.distToPlayer(a.v.x, a.v.z) < 75) { sirenNear = true; break; }
    }
    this.audio.siren(sirenNear && this.wanted >= 1);
  }

  updateWanted(dt) {
    if (this.wanted > 0) {
      this.wantedDecay -= dt;
      if (this.wantedDecay <= 0) {
        this.wanted = Math.max(0, this.wanted - dt * 0.13);
        if (this.wanted < 0.05) this.wanted = 0;
      }
    }

    const lvl = Math.floor(this.wanted);
    const desiredCars = lvl === 0 ? 0 : Math.min(7, lvl + 1);
    this.copSpawnCd -= dt;
    if (this.copSpawnCd <= 0) {
      this.copSpawnCd = clamp(4.2 - lvl * 0.55, 1.0, 4.2);
      const alive = this.police.filter((a) => !a.v.destroyed);
      if (alive.length < desiredCars) this.spawnPoliceCar();
      const aliveCops = this.copsOnFoot.filter((c) => !c.c.dead).length;
      if (lvl >= 2 && aliveCops < lvl * 2) {
        for (const a of this.police) {
          if (Math.abs(a.v.speed) < 4 && this.distToPlayer(a.v.x, a.v.z) < 45) {
            this.spawnCopOnFoot(a.v.x + rand(-2.5, 2.5), a.v.z + rand(-2.5, 2.5), lvl >= 4);
            break;
          }
        }
      }
    }

    if (lvl === 0) {
      for (const a of [...this.police]) {
        if (this.distToPlayer(a.v.x, a.v.z) > 95) this.destroyVehicle(a.v);
        else a.v.sirenOn = false;
      }
      for (const c of [...this.copsOnFoot]) {
        if (this.distToPlayer(c.c.x, c.c.z) > 85) {
          this.scene.remove(c.c.mesh);
          this.copsOnFoot = this.copsOnFoot.filter((x) => x !== c);
        }
      }
    }
    this.copsOnFoot = this.copsOnFoot.filter((c) => {
      if (c.c.dead && this.distToPlayer(c.c.x, c.c.z) > 60) { this.scene.remove(c.c.mesh); return false; }
      return true;
    });
  }

  updateStreaming(dt) {
    for (const v of [...this.vehicles]) {
      if (v === this.player.inVehicle || v.isMissionTarget || (v.unique && !v.destroyed)) continue;
      const d = this.distToPlayer(v.x, v.z);
      if (d > STREAM_RADIUS + 100 || (v.destroyed && v.burning <= 0 && d > 70)) this.destroyVehicle(v);
    }
    for (const p of [...this.peds]) {
      if (p.isMissionTarget && !p.dead) continue;   // never despawn live objectives
      const d = this.distToPlayer(p.x, p.z);
      // Трупы рядом с игроком копились вечно: раньше их убирали только
      // с дистанции >60 м. Теперь тело лежит ~24 с и плавно растворяется.
      if (p.dead) {
        p.corpseT = (p.corpseT || 0) + dt;
        const fade = p.corpseT - 20;
        if (fade > 0) {
          const a = Math.max(0, 1 - fade / 4);
          p.mesh.traverse((o) => {
            if (o.isMesh && o.material) {
              if (!o.material.transparent) { o.material.transparent = true; }
              o.material.opacity = a;
            }
          });
        }
        if (p.corpseT > 24) {
          this.scene.remove(p.mesh);
          this.peds = this.peds.filter((x) => x !== p);
          continue;
        }
      }
      if (d > STREAM_RADIUS + 70 || (p.dead && d > 60)) {
        this.scene.remove(p.mesh);
        this.peds = this.peds.filter((x) => x !== p);
      }
    }
    if (Math.random() < dt * 5) this.spawnTrafficCar();
    if (Math.random() < dt * 7) this.spawnPed();
  }

  updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const t = p.life / p.maxLife;
      if (p.kind === 'spark' || p.kind === 'debris') {
        p.vy -= 22 * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        if (p.mesh.position.y < 0.1) { p.mesh.position.y = 0.1; p.vy *= -0.35; p.vx *= 0.6; p.vz *= 0.6; }
        if (p.kind === 'debris') p.mesh.rotation.x += dt * 8;
      } else if (p.kind === 'blast') {
        const s = 1 + (1 - t) * 2.3;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = t;
      } else if (p.kind === 'smoke') {
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.mesh.scale.setScalar(1 + (1 - t) * 1.6);
        p.mesh.material.opacity = t * 0.5;
      } else if (p.kind === 'tracer') {
        p.mesh.material.opacity = t;
      }
    }
  }

  // ---------------- helicopters ----------------
  updateHelicopters(dt) {
    const ctx = {
      policeShoot: (sx, sz, tx, tz, d) => this.policeShoot(sx, sz, tx, tz, d),
    };
    for (let i = this.helicopters.length - 1; i >= 0; i--) {
      const h = this.helicopters[i];
      if (!h.update(dt, ctx)) this.helicopters.splice(i, 1);
    }
    if (!this.helicopters.some((h) => !h.dead)) this.audio.rotor(false);

    const lvl = Math.floor(this.wanted);
    const want = lvl >= 5 ? 2 : lvl >= 4 ? 1 : 0;
    const alive = this.helicopters.filter((h) => !h.dead).length;
    this.heliSpawnCd = (this.heliSpawnCd || 0) - dt;
    if (alive < want && this.heliSpawnCd <= 0) {
      this.heliSpawnCd = 8;
      const a = rand(0, Math.PI * 2);
      this.helicopters.push(new PoliceHelicopter(
        this, this.playerX() + Math.cos(a) * 90, this.playerZ() + Math.sin(a) * 90));
      this.showMessage('ВЕРТОЛЁТ В ВОЗДУХЕ!', 2);
    }
    if (lvl === 0) {
      for (const h of [...this.helicopters]) {
        if (!h.dead && this.distToPlayer(h.x, h.z) > 130) {
          this.scene.remove(h.mesh);
          this.helicopters = this.helicopters.filter((x) => x !== h);
        }
      }
    }
  }

  // ---------------- insane stunts ----------------
  updateStunts(dt) {
    const v = this.player.inVehicle;
    if (!v) { this.airTime = 0; return; }
    if (v.airborne) {
      if (this.airTime === 0) { this.airStartX = v.x; this.airStartZ = v.z; }
      this.airTime += dt;
    } else if (this.airTime > 0.45) {
      const dist = Math.hypot(v.x - this.airStartX, v.z - this.airStartZ);
      this.progress.registerStunt(dist, this.airTime);
      this.stats.jumps++;
      this.airTime = 0;
    } else this.airTime = 0;
  }

  // ---------------- radio ----------------
  updateRadio(dt) {
    if (!this.radio || !this.audio.ctx) return;
    const inCar = !!this.player.inVehicle;
    const duck = this.wanted >= 3 ? 0.55 : 1;
    this.radio.enabled = inCar && !this.creditsActive;
    this.radio.setDuck(duck);
    this.radio.update();
  }

  cycleRadio(dir) {
    if (!this.radio) return;
    const st = dir > 0 ? this.radio.next() : this.radio.prev();
    this.showMessage(st.name, 1.4);
    this.audio.beep(700, 0.05, 0.12, 'square');
  }

  // ---------------- 100% completion ----------------
  mapSnapshot() { return mapSnapshot(this); }

  completionPercent() {
    const p = this.progress;
    const parts = [
      this.missions.storyIndex / STORY.length,
      p.packagesFound / PACKAGE_TOTAL,
      p.owned.length / PROPERTIES.length,
      p.rampagesDone.length / Math.max(1, p.rampageSpots.length),
      p.turfOwned / TURF_DISTRICTS.length,
    ];
    const weights = [0.42, 0.2, 0.14, 0.12, 0.12];
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += Math.min(1, parts[i]) * weights[i];
    return Math.round(total * 100);
  }

  checkEndgame() {
    const pct = this.completionPercent();
    if (pct >= 100 && !this.completionShown) {
      this.completionShown = true;
      this.showMessage('100% ПРОЙДЕНО!\nТы легенда этого города.', 7);
      this.addMoney(100000);
      this.audio.beep(880, 0.2, 0.3);
      setTimeout(() => this.audio && this.audio.beep(1320, 0.3, 0.3), 200);
      setTimeout(() => this.audio && this.audio.beep(1760, 0.4, 0.3), 420);
    }
  }

  onCampaignComplete() {
    this.endgame = true;
    this.creditsActive = true;
    this.audio.siren(false);
    this.audio.rotor(false);
    for (const h of this.helicopters) this.scene.remove(h.mesh);
    this.helicopters = [];
    for (const a of [...this.police]) this.destroyVehicle(a.v);
    this.police = [];
    for (const c of this.copsOnFoot) this.scene.remove(c.c.mesh);
    this.copsOnFoot = [];
    this.wanted = 0;
    this.hud.showCredits(this);
  }

  dismissCredits() {
    this.creditsActive = false;
    this.hud.hideCredits();
    this.showMessage('СВОБОДНАЯ ИГРА\nГород полностью открыт', 4);
  }

  // ---------------- safehouse ----------------
  applyHomeStash() {
    const got = [];
    for (const k of ['uzi', 'shotgun', 'rifle', 'rocket', 'ak47', 'm4a1']) {
      if (this.homeStash[k]) {
        this.inventory[k] = Math.max(this.inventory[k], this.homeStash[k]);
        got.push(WEAPONS[k].name);
      }
    }
    if (this.homeStash.armor) { this.armor = 100; got.push('БРОНЯ'); }
    if (this.progress.ownedProperty('mansion_sub')) {
      for (const k of ['uzi', 'shotgun', 'rifle', 'rocket', 'ak47', 'm4a1']) this.inventory[k] = Math.max(this.inventory[k], 150);
      this.armor = 100;
      got.push('АРСЕНАЛ ОСОБНЯКА');
    } else if (this.progress.ownedProperty('loft_down')) {
      this.armor = 100;
      got.push('БРОНЯ ЛОФТА');
    }
    return got;
  }

  render() {
    if (this.contextLost) return;      // в потерянном контексте рисовать нельзя
    const skinDt = Math.max(0, Math.min(.1, this.time - (this._skinTime ?? this.time)));
    this._skinTime = this.time;
    this.player.skin?.update(skinDt, this);
    for(const ped of this.peds) ped.skin?.update(skinDt);
    for(const cop of this.copsOnFoot) cop.c.skin?.update(skinDt);
    this.weaponView.update(skinDt);
    const v = this.player.inVehicle;
    const speed01 = v ? clamp(Math.abs(v.speed) / v.type.topSpeed, 0, 1) : 0;
    this.post.setState({
      time: this.time,
      speed01: speed01 * speed01,
      damage: this.hud ? this.hud.damageFlash * 0.8 : 0,
      night: this.nightFactor || 0,
      dusk: this.duskFactor || 0,
      flash: this.flash,
      weather: this.weather,
      // Дождь нарастает плавно, а грейд раньше смотрел на строку `weather`
      // и переключался мгновенно. Отдаём ту же сглаженную величину.
      wet: this._wet || 0,
      fog: this._fogAmt || 0,
      wanted: Math.floor(this.wanted),
    });
    this.post.render();
    this.weaponView.render();
  }

  // ---------------- save / load ----------------
  // Слотов три, каждый лежит отдельным ключом. Так запись в один слот
  // физически не может испортить остальные, а список для экрана загрузки
  // читается по одному слоту за раз.
  slotKey(i) { return `${SAVE_PREFIX}${i}`; }

  // Шапка слота — то, что покажет экран загрузки. Считаем в момент записи:
  // восстанавливать её потом из полного сейва дороже и хрупче.
  saveMeta() {
    const done = this.missions.storyIndex >= STORY.length;
    const next = done ? null : STORY[this.missions.storyIndex];
    const d = this.city.districtAtWorld(this.playerX(), this.playerZ());
    return {
      savedAt: Date.now(),
      act: done ? 0 : (next ? next.act : 1),      // 0 — кампания пройдена
      mission: next ? next.title : null,
      money: this.money,
      completion: this.completionPercent(),
      playTime: Math.round(this.stats.playTime || 0),
      district: (DISTRICTS[d] && DISTRICTS[d].name) || '',
    };
  }

  serializeSave() {
    return {
      meta: this.saveMeta(),
      money: this.money, kills: this.kills, stats: this.stats,
      inventory: this.inventory, weapon: this.weapon, armor: this.armor,
      magazines: { ...this.weaponState.magazines },
      health: this.player.health, x: this.player.x, z: this.player.z,
      y: this.player.inVehicle ? 0 : this.player.y,
      clockTime: this.clockTime, missions: this.missions.serialize(),
      progress: this.progress.serialize(), radio: this.radio ? this.radio.index : 1,
      homeStash: this.homeStash, completionShown: this.completionShown,
      endgame: this.endgame,
    };
  }

  // Заголовки всех слотов: null — слот пуст. Битый слот тоже отдаём как null,
  // иначе одна испорченная запись роняет весь экран загрузки.
  listSaves() {
    const out = [];
    for (let i = 0; i < SAVE_SLOTS; i++) {
      let meta = null;
      try {
        const raw = localStorage.getItem(this.slotKey(i));
        if (raw) {
          const d = JSON.parse(raw);
          // У сейвов старых версий шапки нет — собираем её из самих данных,
          // иначе перенесённый слот покажется на экране загрузки пустым.
          meta = d.meta || legacyMeta(d);
        }
      } catch (e) { meta = null; }
      out.push(meta);
    }
    return out;
  }

  saveToSlot(i = this.lastSlot) {
    if (i < 0 || i >= SAVE_SLOTS) return false;
    try {
      localStorage.setItem(this.slotKey(i), JSON.stringify(this.serializeSave()));
      this.lastSlot = i;
      localStorage.setItem(LAST_SLOT_KEY, String(i));
      this.showMessage(`СОХРАНЕНО — СЛОТ ${i + 1}`, 1.5);
      return true;
    } catch (e) { this.showMessage('ОШИБКА СОХРАНЕНИЯ', 1.5); return false; }
  }

  deleteSlot(i) {
    try { localStorage.removeItem(this.slotKey(i)); return true; }
    catch (e) { return false; }
  }

  save() { return this.saveToSlot(this.lastSlot); }
  load() { return this.loadSlot(this.lastSlot); }

  loadSlot(i = this.lastSlot) {
    try {
      const raw = localStorage.getItem(this.slotKey(i));
      if (!raw) { this.showMessage('НЕТ СОХРАНЕНИЯ', 1.5); return false; }
      const d = JSON.parse(raw);
      this.money = d.money || 0;
      this.kills = d.kills || 0;
      this.stats = Object.assign(this.stats, d.stats || {});
      this.inventory = Object.assign(makeInventory(), d.inventory || {});
      this.inventory.fist = Infinity;
      this.weaponState = new WeaponState(this.inventory, d.magazines || {});
      this.armor = d.armor || 0;
      this.player.health = d.health || 100;
      // Загрузка ставит игрока в сохранённую точку — анимации высадки тут
      // играть негде, а недоигранная посадка утащила бы его обратно к машине.
      this.mount = null;
      if (this.player.inVehicle) this.exitVehicle(false, true);
      this.player.x = d.x || 0; this.player.z = d.z || 0;
      this.player.y = Number.isFinite(d.y) ? Math.max(0, Math.min(200, d.y)) : 0;
      this.player.jumpVy = 0;
      this.player.airborne = this.player.y > .001;
      this.player.wasAirborne = this.player.airborne;
      this.player._groundVis = undefined;
      this.player.syncMesh();
      this.clockTime = d.clockTime || 8 * 3600;
      this.selectWeapon(d.weapon || 'pistol');
      this.missions.deserialize(d.missions);
      this.progress.deserialize(d.progress);
      this.homeStash = d.homeStash || {};
      this.completionShown = !!d.completionShown;
      this.endgame = !!d.endgame;
      if (this.radio && typeof d.radio === 'number') this.radio.setStation(d.radio);
      this.wanted = 0;
      this.lastSlot = i;
      try { localStorage.setItem(LAST_SLOT_KEY, String(i)); } catch (e) { /* приватный режим */ }
      this.showMessage('ЗАГРУЖЕНО', 1.5);
      return true;
    } catch (e) { this.showMessage('ОШИБКА ЗАГРУЗКИ', 1.5); return false; }
  }
}
