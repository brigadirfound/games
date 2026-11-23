import * as THREE from 'three';
import { buildDriver, randomLook } from './character.js';
import { resolveCircleBoxes, clamp, rand, pick } from './physics.js';
import { TEX } from './textures.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
import { MODELS } from './models.js';
import { APPROVED_FLEET } from './approved-fleet-spec.js';
import { RETIRED_VEHICLES, rigWheels, collectDoors, animateDoors, prepareVehicleModel } from './vehicle-rig.js';
import { enhanceVehicleMaterial, microflakeTexture } from './vehicle-materials.js';

export const CAR_TYPES = [
  // id        name          w     l    h     roof  top  acc  mass grip  hp   shape
  { id: 'sedan',   name: 'Kuruma',   w: 2.0,  l: 4.4, h: 1.25, roof: 0.55, topSpeed: 31, accel: 15, mass: 1.0,  grip: 1.0,  hp: 100, shape: 'sedan' },
  { id: 'coupe',   name: 'Manana',   w: 1.95, l: 4.1, h: 1.15, roof: 0.5,  topSpeed: 37, accel: 19, mass: 0.9,  grip: 1.05, hp: 85,  shape: 'coupe' },
  { id: 'van',     name: 'Pony',     w: 2.25, l: 5.1, h: 1.85, roof: 0.9,  topSpeed: 24, accel: 10, mass: 1.6,  grip: 0.85, hp: 140, shape: 'van' },
  { id: 'pickup',  name: 'Bobcat',   w: 2.1,  l: 4.8, h: 1.4,  roof: 0.6,  topSpeed: 28, accel: 13, mass: 1.3,  grip: 0.92, hp: 120, shape: 'pickup' },
  { id: 'taxi',    name: 'Cabbie',   w: 2.0,  l: 4.4, h: 1.3,  roof: 0.55, topSpeed: 30, accel: 15, mass: 1.0,  grip: 1.0,  hp: 100, shape: 'sedan' },
  { id: 'sport',   name: 'Banshee',  w: 1.9,  l: 4.2, h: 1.0,  roof: 0.42, topSpeed: 45, accel: 26, mass: 0.85, grip: 1.15, hp: 75,  shape: 'sport', spoiler: true },
  { id: 'truck',   name: 'Linerun',  w: 2.5,  l: 7.2, h: 2.5,  roof: 1.1,  topSpeed: 21, accel: 8,  mass: 2.6,  grip: 0.7,  hp: 220, shape: 'truck' },
  { id: 'bike',    name: 'PCJ-600',  w: 0.8,  l: 2.1, h: 0.7,  roof: 0,    topSpeed: 42, accel: 27, mass: 0.3,  grip: 1.2,  hp: 45,  bike: true, shape: 'bike' },
  // ---- new ----
  { id: 'muscle',  name: 'Diablo',   w: 2.1,  l: 4.9, h: 1.12, roof: 0.46, topSpeed: 41, accel: 24, mass: 1.15, grip: 0.95, hp: 110, shape: 'muscle', spoiler: true, stripes: true },
  { id: 'suv',     name: 'Landstal', w: 2.3,  l: 5.0, h: 1.75, roof: 0.85, topSpeed: 30, accel: 14, mass: 1.7,  grip: 0.9,  hp: 165, shape: 'suv', roofrack: true },
  { id: 'ambul',   name: 'Ambulanc', w: 2.3,  l: 5.6, h: 2.05, roof: 0.95, topSpeed: 26, accel: 12, mass: 1.85, grip: 0.86, hp: 175, shape: 'van', emergency: 'ambulance' },
  { id: 'fire',    name: 'Firetruk', w: 2.6,  l: 7.6, h: 2.6,  roof: 1.0,  topSpeed: 23, accel: 9,  mass: 2.8,  grip: 0.72, hp: 250, shape: 'truck', emergency: 'fire' },
  // ---- wave 3: more distinct silhouettes ----
  { id: 'bus',     name: 'Coach',    w: 2.55, l: 9.2, h: 2.7,  roof: 1.0,  topSpeed: 22, accel: 7,  mass: 3.2,  grip: 0.68, hp: 260, shape: 'bus' },
  { id: 'roadster',name: 'Stinger',  w: 1.88, l: 4.0, h: 0.92, roof: 0.3,  topSpeed: 47, accel: 28, mass: 0.78, grip: 1.2,  hp: 65,  shape: 'roadster', convertible: true },
  { id: 'scooter', name: 'Faggio',   w: 0.72, l: 1.8, h: 0.62, roof: 0,    topSpeed: 22, accel: 14, mass: 0.22, grip: 1.1,  hp: 35,  bike: true, shape: 'bike', scooter: true },
  { id:'compact',name:'Blista',w:1.8,l:3.8,h:1.5,roof:.5,topSpeed:27,accel:5,mass:.8,grip:1.1,hp:80,shape:'sedan' },
  { id:'wagon',name:'Solair',w:2,l:4.7,h:1.5,roof:.6,topSpeed:29,accel:5,mass:1.2,grip:1,hp:115,shape:'sedan' },
  { id:'garbage',name:'Trashmaster',w:2.5,l:7.5,h:3,roof:1,topSpeed:19,accel:2.5,mass:3,grip:.7,hp:260,shape:'truck' },
  { id:'schoolbus',name:'School Bus',w:2.5,l:8,h:3,roof:1,topSpeed:22,accel:2.5,mass:3,grip:.7,hp:250,shape:'bus' },
  { id:'tow',name:'Towtruck',w:2.3,l:6.5,h:2.5,roof:1,topSpeed:24,accel:3,mass:2,grip:.8,hp:200,shape:'truck' },
  { id:'postvan',name:'Boxville',w:2.1,l:5.1,h:2,roof:.8,topSpeed:25,accel:3.8,mass:1.6,grip:.85,hp:150,shape:'van' },
].filter(type => !RETIRED_VEHICLES.includes(type.id)).map(type => ({
  ...type,
  ...APPROVED_FLEET[type.id],
  ...(type.id==='muscle'?{name:'Rancher',shape:'suv',spoiler:false,stripes:false,topSpeed:29}:{}),
  ...(type.id==='roadster'?{name:'Prairie',shape:'sedan',convertible:false,topSpeed:32}:{}),
  ...(type.id==='bike'?{name:'JAWA'}:{}),
  accel: { sedan: 5.8, coupe: 6.8, van: 3.8, pickup: 4.8, taxi: 5.6, sport: 9, truck: 2.8, bike: 9.5, muscle: 5, suv: 5, ambul: 4, fire: 2.8, bus: 2.5, roadster: 5.8, scooter: 4.5, tank: 1.8 }[type.id] ?? type.accel,
}));

export const CAR_BY_ID = Object.fromEntries(CAR_TYPES.map((t) => [t.id, t]));
export const TANK_TYPE = { id: 'tank', name: 'T-90', w: 3.75, l: 7, h: 2.7, roof: 1.0, topSpeed: 16, accel: 1.8, mass: 6.5, grip: 0.62, hp: 650, shape: 'tank', rare: true };

export const BODY_COLORS = [
  // saturated
  0xa51f32, 0x245ca6, 0x25614f, 0xd5aa36, 0x5e437d, 0xc65c27,
  0x247a83, 0x772941, 0x536440, 0xb53623, 0x32657f, 0x631c28,
  // metallic / neutral
  0x8b9199, 0xbfc7ce, 0x545c67, 0x343d49, 0x161c24, 0xebe7df,
  // pastel
  0xd9b8a0, 0xa8c4b0, 0xc0b7d8, 0xe0d2a8,
];
const RUST_COLORS = [0x6b4a32, 0x7a5a3a, 0x5c4530];


// ---- shared geometry / material caches (huge win: cars stop allocating) ----
const _geoCache = new Map();
const _matCache = new Map();

function boxGeo(w, h, d) {
  const k = `b${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}`;
  let g = _geoCache.get(k);
  if (!g) { const radius = Math.min(w, h, d) * 0.055; g = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.006, radius)); _geoCache.set(k, g); }
  return g;
}

// Для главных панелей кузова (шасси/капот/багажник/кабина) — острые грани
// BoxGeometry читались как «Лего», не машина. segments=1 — минимум, при
// котором фаска вообще существует (толще машин на экране разом, а десятки
// машин на карте держат бюджет кадра даже в софт-рендере). radius в долях
// от меньшей стороны панели, чтобы не скруглять тонкие детали в шар.
function roundedBoxGeo(w, h, d, radiusFrac = 0.10) {
  const radius = Math.min(w, h, d) * radiusFrac;
  const k = `rb${w.toFixed(3)}_${h.toFixed(3)}_${d.toFixed(3)}_${radius.toFixed(3)}`;
  let g = _geoCache.get(k);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, 2, Math.max(0.006, radius)); _geoCache.set(k, g); }
  return g;
}

function cylGeo(rt, rb, h, seg, rotZ = false) {
  const k = `c${rt.toFixed(3)}_${rb.toFixed(3)}_${h.toFixed(3)}_${seg}_${rotZ ? 1 : 0}`;
  let g = _geoCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg);
    if (rotZ) g.rotateZ(Math.PI / 2);
    _geoCache.set(k, g);
  }
  return g;
}

function lamb(color) {
  const k = `l${color}`;
  let m = _matCache.get(k);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); _matCache.set(k, m); }
  return m;
}

function basic(color) {
  const k = `x${color}`;
  let m = _matCache.get(k);
  if (!m) { m = new THREE.MeshBasicMaterial({ color }); _matCache.set(k, m); }
  return m;
}

// Кузов/стёкла/хром были плоским MeshLambertMaterial — без бликов машины
// читались как крашеный картон. Роль определяет физику поверхности:
// лак кузова, тонированное стекло, полированный хром, матовая резина.
// Без envMap, но у сцены есть направленный «солнечный» свет (game.js:196),
// его достаточно, чтобы блик на низкой roughness был виден.
function paintMat(color) {
  const k = `paint${color}`;
  let m = _matCache.get(k);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.28, roughness: 0.30, clearcoat: 0.92, clearcoatRoughness: 0.16,
      bumpMap: typeof document !== 'undefined' ? microflakeTexture() : null,
      bumpScale: 0.00035, envMapIntensity: 1.35 });
    _matCache.set(k, m);
  }
  return m;
}
function glassMatFn(color) {
  const k = `glass${color}`;
  let m = _matCache.get(k);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, metalness: 0.12, roughness: 0.075, clearcoat: 0.7, clearcoatRoughness: 0.08, envMapIntensity: 1.4 });
    _matCache.set(k, m);
  }
  return m;
}
function chromeMatFn(color) {
  const k = `chrome${color}`;
  let m = _matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, metalness: 1.0, roughness: 0.15, envMapIntensity: 1.45 }); _matCache.set(k, m); }
  return m;
}
function rubberMatFn(color) {
  const k = `rubber${color}`;
  let m = _matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, metalness: 0.0, roughness: 0.9, envMapIntensity: 0.16 }); _matCache.set(k, m); }
  return m;
}


// Merge a list of {geo, mat, pos:[x,y,z], rot?:[x,y,z]} into as few meshes as
// possible: one per material. Cuts per-car mesh count from ~18 to ~4.
function mergeParts(parts) {
  const byMat = new Map();
  for (const p of parts) {
    if (!byMat.has(p.mat)) byMat.set(p.mat, []);
    byMat.get(p.mat).push(p);
  }
  const out = [];
  const m4 = new THREE.Matrix4();
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  for (const [mat, list] of byMat) {
    let vCount = 0, iCount = 0;
    for (const p of list) {
      const vc = p.geo.attributes.position.count;
      vCount += vc;
      // RoundedBoxGeometry (vendor/) отдаёт себя не-индексированной — считаем
      // так, будто у нее по одному индексу на вершину по порядку.
      iCount += p.geo.index ? p.geo.index.count : vc;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const idx = new Uint32Array(iCount);
    let vo = 0, io = 0;
    for (const p of list) {
      e.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
      q.setFromEuler(e);
      v.set(p.pos[0], p.pos[1], p.pos[2]);
      m4.compose(v, q, one);
      const g2 = p.geo.clone().applyMatrix4(m4);
      const vcount = g2.attributes.position.count;
      pos.set(g2.attributes.position.array, vo * 3);
      nor.set(g2.attributes.normal.array, vo * 3);
      if (g2.index) {
        const gi = g2.index.array;
        for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
        io += gi.length;
      } else {
        for (let k = 0; k < vcount; k++) idx[io + k] = vo + k;
        io += vcount;
      }
      vo += vcount;
      g2.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    out.push(mesh);
  }
  return out;
}

// Мигалка: две цветные плашки, которые Vehicle по очереди гасит. Вынесена
// из buildCarMesh, потому что нужна и готовым моделям — у них мигалка либо
// вплавлена в геометрию и не мигает, либо её нет вовсе.
function makeLightbar(cA, cB, y, z) {
  const bar = new THREE.Group();
  const a = new THREE.Mesh(boxGeo(0.52, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: cA }));
  a.position.x = -0.3;
  const b = new THREE.Mesh(boxGeo(0.52, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: cB }));
  b.position.x = 0.3;
  bar.add(a); bar.add(b);
  bar.position.set(0, y, z);
  return bar;
}

export function buildCarMesh(type, color, isPolice = false, isTaxi = false, variant = {}) {
  const g = new THREE.Group();
  const emerg = type.emergency;
  const bodyColor = isPolice ? 0x1a1a22
    : isTaxi ? 0xe0b122
    : emerg === 'ambulance' ? 0xf2f2f0
    : emerg === 'fire' ? 0xb81f1f
    : color;

  // Готовая модель, если она есть для этого типа (см. models.json). Отдаём
  // ровно ту же структуру, что и процедурная сборка ниже, поэтому класс
  // Vehicle не знает, откуда взялся меш. Типы без модели (автобус, мотоцикл,
  // скорая…) продолжают строиться из боксов — это не заглушка, а рабочий путь.
  const slot = isPolice ? 'police' : type.id;
  const fromModel = MODELS.buildVehicle(slot, bodyColor);
  if (fromModel) {
    if ((isPolice || emerg) && !fromModel.group.userData.approvedFleet) {
      const colors = emerg === 'ambulance' ? [0xff3030, 0xffffff]
        : emerg === 'fire' ? [0xff2020, 0xffb020]
          : [0xff2020, 0x3050ff];
      const sz = fromModel.size;
      const bar = makeLightbar(colors[0], colors[1], (sz ? sz.y : type.h) + 0.09, 0.2);
      fromModel.group.add(bar);
      fromModel.lightbar = bar;
    }
    fromModel.wheels = rigWheels(fromModel.group, fromModel.wheels, !!type.bike);
    fromModel.doors = collectDoors(fromModel.group);
    return fromModel;
  }

  const bodyMat = paintMat(bodyColor);
  const trimMat = paintMat(variant.trim ?? 0x24262c);
  const glassMat = glassMatFn(0x16212c);
  const tireMat = rubberMatFn(0x14141a);
  const detailedTireMat = typeof document !== 'undefined' ? enhanceVehicleMaterial(tireMat, 'tire', true) : tireMat;
  const rimMat = chromeMatFn(variant.rim ?? 0xaeb3ba);
  const chromeMat = chromeMatFn(0xc8ccd2);
  const wheels = [];
  const shape = type.shape || 'sedan';
  const statics = [];   // merged at the end
  const add = (geo, mat, pos, rot) => statics.push({ geo, mat, pos, rot });

  // ---------------- motorcycle ----------------
  if (type.bike) {
    const bikeParts = type.scooter
      ? [
          // step-through frame, upright bars, little front apron
          { geo: boxGeo(0.36, 0.3, 1.05), mat: bodyMat, pos: [0, 0.6, -0.1] },
          { geo: boxGeo(0.34, 0.2, 0.42), mat: trimMat, pos: [0, 0.8, -0.34] },
          { geo: boxGeo(0.38, 0.52, 0.22), mat: bodyMat, pos: [0, 0.76, 0.5] },
          { geo: boxGeo(0.62, 0.07, 0.07), mat: chromeMat, pos: [0, 1.04, 0.52] },
          { geo: boxGeo(0.3, 0.06, 0.5), mat: trimMat, pos: [0, 0.46, 0.14] },
        ]
      : [
          { geo: boxGeo(0.42, 0.42, 1.5), mat: bodyMat, pos: [0, 0.72, 0] },
          { geo: boxGeo(0.38, 0.18, 0.6), mat: trimMat, pos: [0, 0.98, -0.25] },
          { geo: boxGeo(0.4, 0.3, 0.5), mat: bodyMat, pos: [0, 1.0, 0.35] },
          { geo: boxGeo(0.7, 0.08, 0.08), mat: chromeMat, pos: [0, 1.16, 0.72] },
          { geo: cylGeo(0.07, 0.07, 0.9, 6), mat: chromeMat, pos: [0.2, 0.5, -0.5], rot: [Math.PI / 2, 0, 0] },
        ];
    const bikeMerged = mergeParts(bikeParts);
    for (const m of bikeMerged) g.add(m);
    const frame = bikeMerged[0];
    const wr = type.scooter ? 0.26 : 0.36;
    const wg = cylGeo(wr, wr, type.scooter ? 0.13 : 0.16, 24, true);
    for (const sz of type.scooter ? [0.62, -0.6] : [0.78, -0.78]) {
      const w = new THREE.Mesh(wg, detailedTireMat);
      w.position.set(0, wr, sz); w.castShadow = true;
      g.add(w); wheels.push(w);
    }
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
    hl.position.set(0, type.scooter ? 0.9 : 1.05, type.scooter ? 0.62 : 0.95); g.add(hl);
    return { group: g, wheels: rigWheels(g, wheels, true), doors: [], lightbar: null, brakeLights: [], headLights: [hl.material], body: frame };
  }

  const W = type.w, L = type.l, H = type.h, ROOF = type.roof;

  if (shape === 'tank') {
    const trackMat = paintMat(0x30353a), rubberTrack = rubberMatFn(0x171a1d);
    add(roundedBoxGeo(W * .88, H * .46, L * .72, .12), trackMat, [0, .64, -.05]);
    for (const sx of [-1, 1]) {
      add(roundedBoxGeo(W * .22, .46, L * .82, .10), rubberTrack, [sx * W * .39, .52, -.05]);
      for (const zz of [-.28, -.05, .18]) add(cylGeo(.22, .22, .08, 16, true), chromeMat, [sx * W * .39, .52, zz * L], [0, 0, 0]);
    }
    add(roundedBoxGeo(W * .52, .48, L * .38, .14), trackMat, [0, 1.02, -.12]);
    add(cylGeo(.55, .55, .18, 20), trackMat, [0, 1.38, .05]);
    add(roundedBoxGeo(.18, .16, L * .42, .08), trackMat, [0, 1.55, L * .25]);
  }

  // ---------------- chassis ----------------
  // Самый большой и самый заметный объём машины — именно его острые рёбра
  // делали силуэт кубическим. Со скруглением здесь эффект виден больше всего.
  add(roundedBoxGeo(W, H, L), bodyMat, [0, H / 2 + 0.35, 0]);

  // sculpt the silhouette per shape
  if (shape === 'sport' || shape === 'muscle') {
    // low nose wedge
    add(boxGeo(W * 0.96, H * 0.55, L * 0.3), bodyMat, [0, H * 0.42 + 0.35, L * 0.36]);
    // side skirts
    for (const sx of [-1, 1]) {
      add(boxGeo(0.1, 0.22, L * 0.55), trimMat, [sx * (W / 2 - 0.02), 0.44, -0.1]);
    }
  }
  if (shape === 'pickup') {
    // open bed with walls
    const bedFloorY = H + 0.3;
    for (const [bw, bh, bl, bx, by, bz] of [
      [W, 0.12, L * 0.42, 0, bedFloorY, -L * 0.26],
      [0.12, 0.42, L * 0.42, -W / 2 + 0.06, bedFloorY + 0.2, -L * 0.26],
      [0.12, 0.42, L * 0.42, W / 2 - 0.06, bedFloorY + 0.2, -L * 0.26],
      [W, 0.42, 0.12, 0, bedFloorY + 0.2, -L / 2 + 0.06],
    ]) {
      add(boxGeo(bw, bh, bl), bodyMat, [bx, by, bz]);
    }
  }
  if (shape === 'suv' || shape === 'van') {
    add(boxGeo(W * 0.99, H * 0.5, L * 0.9), bodyMat, [0, H + 0.32, -L * 0.03]);
  }
  if (shape === 'hotrod') {
    // chopped rear, exposed engine block and tall air intake up front
    add(boxGeo(W * 0.9, H * 0.45, L * 0.34), bodyMat, [0, H * 0.5 + 0.35, -L * 0.3]);
    add(boxGeo(W * 0.5, 0.34, 0.6), trimMat, [0, H + 0.42, L * 0.28]);
    add(boxGeo(W * 0.32, 0.22, 0.3), chromeMat, [0, H + 0.68, L * 0.28]);
  }
  if (shape === 'buggy') {
    // open tube frame, no doors, engine hanging off the back
    add(boxGeo(W * 0.62, 0.34, 0.7), trimMat, [0, H * 0.6 + 0.35, -L * 0.36]);
    for (const sx of [-1, 1]) {
      add(boxGeo(0.09, 0.4, L * 0.5), trimMat, [sx * (W / 2 - 0.05), 0.5, 0]);
    }
  }
  if (shape === 'bus') {
    // tall slab body with a skirt; cabin handled below
    add(boxGeo(W, H * 0.62, L * 0.96), bodyMat, [0, H + 0.28, 0]);
    for (const sx of [-1, 1]) {
      add(boxGeo(0.06, 0.5, L * 0.9), trimMat, [sx * (W / 2 + 0.01), 0.62, 0]);
    }
  }
  if (shape === 'wagon') {
    // extended roofline all the way to the tail
    add(boxGeo(W * 0.94, ROOF * 0.92, L * 0.42), glassMat, [0, H + 0.35 + ROOF * 0.46, -L * 0.24]);
    add(boxGeo(W * 0.9, 0.1, L * 0.44), bodyMat, [0, H + 0.35 + ROOF * 0.92, -L * 0.24]);
  }

  // bonnet + boot: breaks up the single-slab silhouette so the low cars
  // actually read as cars in profile rather than as identical boxes
  if (['sedan', 'coupe', 'compact', 'wagon', 'taxi'].includes(shape)) {
    const deckY = H + 0.3;
    add(boxGeo(W * 0.97, 0.14, L * 0.3), bodyMat, [0, deckY, L * 0.32]);      // капот
    if (shape !== 'wagon') {
      add(boxGeo(W * 0.97, 0.14, L * 0.24), bodyMat, [0, deckY, -L * 0.35]);  // багажник
    }
    for (const sx of [-1, 1]) {                                              // подоконная линия
      add(boxGeo(0.05, 0.14, L * 0.5), trimMat, [sx * (W / 2 + 0.005), H + 0.18, -0.05]);
    }
  }

  // ---------------- cabin ----------------
  const isTruck = shape === 'truck';
  const cabinL = L * (shape === 'van' ? 0.7 : shape === 'suv' ? 0.62 : isTruck ? 0.32
    : shape === 'limo' ? 0.5 : shape === 'compact' ? 0.55
    : shape === 'bus' ? 0.9 : shape === 'wagon' ? 0.42
    : shape === 'buggy' ? 0.42 : shape === 'hotrod' ? 0.4
    : shape === 'roadster' ? 0.38 : shape === 'pickup' ? 0.36 : 0.48);
  const cabinZ = isTruck ? L / 2 - cabinL / 2 - 0.2
    : shape === 'limo' ? L * 0.22
    : shape === 'bus' ? -L * 0.02
    : shape === 'wagon' ? L * 0.06
    : shape === 'hotrod' ? -L * 0.06
    : shape === 'pickup' ? L * 0.14
    : shape === 'van' || shape === 'suv' ? 0.05 : -0.22;
  const cabinH = ROOF * (shape === 'sport' ? 0.9 : shape === 'hotrod' ? 0.8 : 1);
  if (type.convertible) {
    // raked windscreen only — open cockpit behind it
    add(boxGeo(W * 0.8, cabinH * 0.9, 0.08), glassMat,
      [0, H + 0.35 + cabinH * 0.45, cabinZ + cabinL * 0.42]);
    add(boxGeo(W * 0.7, 0.1, cabinL * 0.8), trimMat, [0, H + 0.34, cabinZ - cabinL * 0.1]);
  } else if (shape !== 'buggy') {
    // Кабину пробовал скруглить тоже — вместе с шасси это почти удвоило
    // цену рендера в софт-фоллбэке (тест «без регрессии» показал ~30мс
    // вместо ~16мс). У скруглённого бокса тут в 9 раз больше треугольников,
    // чем у плоского (сетка 3×3 на грань вместо цельной грани) — на каждую
    // машину на экране это заметно. Шасси — самый крупный объём и даёт
    // больше всего эффекта на глаз, поэтому оставляем скруглённым только его.
    add(boxGeo(W * 0.88, cabinH, cabinL), glassMat, [0, H + 0.35 + cabinH / 2, cabinZ]);
    add(boxGeo(W * 0.82, 0.1, cabinL * 0.9), bodyMat, [0, H + 0.35 + cabinH, cabinZ]);
  }

  // limo: long dark rear section
  if (shape === 'limo') {
    add(boxGeo(W * 0.9, ROOF * 0.85, L * 0.36), glassMat, [0, H + 0.35 + ROOF * 0.42, -L * 0.16]);
    add(boxGeo(W * 0.86, 0.1, L * 0.36), bodyMat, [0, H + 0.35 + ROOF * 0.85, -L * 0.16]);
  }

  // truck / fire cargo box
  if (isTruck) {
    const boxColor = emerg === 'fire' ? 0x9c1818 : 0xd8d8d0;
    const box = new THREE.Mesh(new THREE.BoxGeometry(W * 1.02, 2.3, L * 0.55), paintMat(boxColor));
    box.position.set(0, H + 0.9, -L / 2 + L * 0.28);
    box.castShadow = true;
    g.add(box);
    if (emerg === 'fire') {
      add(boxGeo(0.3, 0.18, L * 0.6), chromeMat, [0, H + 2.15, -L * 0.15]);
    }
  }

  // roof rack for the SUV
  if (type.roofrack) {
    for (const sx of [-1, 1]) {
      add(boxGeo(0.08, 0.1, cabinL * 0.85), trimMat, [sx * W * 0.32, H + 0.45 + cabinH, cabinZ]);
    }
  }

  // roll cage (buggy)
  if (type.rollcage) {
    const cageY = H + 0.35;
    for (const sx of [-1, 1]) {
      add(boxGeo(0.08, ROOF + 0.55, 0.08), trimMat, [sx * W * 0.36, cageY + (ROOF + 0.55) / 2 - 0.1, -L * 0.12]);
      add(boxGeo(0.08, ROOF + 0.35, 0.08), trimMat, [sx * W * 0.36, cageY + (ROOF + 0.35) / 2 - 0.1, L * 0.16]);
      add(boxGeo(0.08, 0.08, L * 0.32), trimMat, [sx * W * 0.36, cageY + ROOF + 0.42, 0.02]);
    }
    add(boxGeo(W * 0.76, 0.08, 0.08), trimMat, [0, cageY + ROOF + 0.42, -L * 0.12]);
    add(boxGeo(W * 0.76, 0.08, 0.08), trimMat, [0, cageY + ROOF + 0.32, L * 0.16]);
  }

  // side exhaust pipes (hot rod)
  if (type.exhaust) {
    for (const sx of [-1, 1]) {
      add(cylGeo(0.075, 0.075, L * 0.44, 6), chromeMat,
        [sx * (W / 2 + 0.04), 0.5, -L * 0.05], [Math.PI / 2, 0, 0]);
    }
  }

  // rear spoiler
  if (type.spoiler) {
    add(boxGeo(W * 0.9, 0.08, 0.34), trimMat, [0, H + 0.62, -L / 2 + 0.22]);
    for (const sx of [-1, 1]) {
      add(boxGeo(0.09, 0.24, 0.16), trimMat, [sx * W * 0.32, H + 0.5, -L / 2 + 0.22]);
    }
  }

  // racing stripes down the middle
  if (type.stripes && variant.stripe) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W * 0.22, 0.02, L * 0.96), paintMat(variant.stripe));
    stripe.position.set(0, H + 0.36, 0);
    g.add(stripe);
  }

  // ---------------- wheels ----------------
  const wr = shape === 'tank' ? 0.01 : isTruck || shape === 'bus' ? 0.55 : shape === 'suv' ? 0.5
    : shape === 'buggy' ? 0.52 : shape === 'compact' ? 0.34
    : shape === 'hotrod' ? 0.46 : 0.42;
  const tyreW = isTruck || shape === 'bus' ? 0.4
    : shape === 'buggy' ? 0.42
    : shape === 'sport' || shape === 'muscle' || shape === 'hotrod' ? 0.36 : 0.32;
  const wheelGeo = cylGeo(wr, wr, tyreW, shape === 'tank' ? 6 : 16, true);
  const wx = W / 2 - 0.04;
  const wz = L / 2 - (isTruck ? 1.5 : shape === 'limo' ? 1.5 : shape === 'bus' ? 1.8 : 1.0);
  const axles = shape === 'tank' ? [] : shape === 'limo' || isTruck || shape === 'bus'
    ? [[-1, 1], [1, 1], [-1, -1], [1, -1], [-1, -0.35], [1, -0.35]]
    : [[-1, 1], [1, 1], [-1, -1], [1, -1]];
  // wheel + hub baked into a single two-material mesh (keeps mesh count low)
  const hubGeo = cylGeo(wr * 0.55, wr * 0.55, tyreW + 0.02, 8, true);
  const wheelMerged = mergeParts([
    { geo: wheelGeo, mat: tireMat, pos: [0, 0, 0] },
    { geo: hubGeo, mat: rimMat, pos: [0, 0, 0] },
  ]);
  for (const [sx, sz] of axles) {
    const w = new THREE.Group();
    for (const part of wheelMerged) w.add(part.clone());
    w.position.set(sx * wx, wr, sz * wz);
    g.add(w); wheels.push(w);
  }

  // ---------------- lights & trim ----------------
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0 });  // per-car: toggles at night
  const headLights = [headMat];
  const brakeLights = [];
  const lg = new THREE.BoxGeometry(0.42, 0.22, 0.1);
  for (const sx of [-1, 1]) {
    const hl = new THREE.Mesh(lg, headMat);
    hl.position.set(sx * W * 0.3, 0.82, L / 2 + 0.02);
    g.add(hl);
    const tm = new THREE.MeshBasicMaterial({ color: 0x5a1010 });
    const tl = new THREE.Mesh(lg, tm);
    tl.position.set(sx * W * 0.3, 0.86, -L / 2 - 0.02);
    g.add(tl);
    brakeLights.push(tm);
  }

  // bumpers give the models a bit of chrome definition
  for (const zz of [L / 2 + 0.04, -L / 2 - 0.04]) {
    add(boxGeo(W * 0.94, 0.16, 0.12), chromeMat, [0, 0.56, zz]);
  }

  // ---------------- emergency / service livery ----------------
  let lightbar = null;
  const makeBar = (cA, cB) => {
    const bar = makeLightbar(cA, cB, H + 0.46 + cabinH, cabinZ);
    g.add(bar);
    return bar;
  };

  if (isPolice) {
    const doorMat = lamb(0xf0f0f0);
    for (const sx of [-1, 1]) {
      add(boxGeo(0.06, H * 0.7, L * 0.42), doorMat, [sx * (W / 2 + 0.01), H / 2 + 0.4, -0.2]);
    }
    lightbar = makeBar(0xff2020, 0x3050ff);
  } else if (emerg === 'ambulance') {
    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, L * 0.8), paintMat(0xd42a2a));
      band.position.set(sx * (W / 2 + 0.01), H * 0.75, 0);
      g.add(band);
    }
    lightbar = makeBar(0xff3030, 0xffffff);
  } else if (emerg === 'fire') {
    lightbar = makeBar(0xff2020, 0xffb020);
  } else if (isTaxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
    sign.position.set(0, H + 0.46 + cabinH, cabinZ);
    g.add(sign);
    // chequer band
    for (const sx of [-1, 1]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, L * 0.7), paintMat(0x1a1a1a));
      band.position.set(sx * (W / 2 + 0.01), H * 0.62, -0.1);
      g.add(band);
    }
  }

  const merged = mergeParts(statics);
  for (const m of merged) g.add(m);

  for (const [index, wheel] of wheels.entries()) wheel.name = `Wheel_${index}`;
  if (lightbar) lightbar.userData.keepVehicleRig = true;
  prepareVehicleModel(g, type.id);
  return { group: g, wheels: rigWheels(g, wheels), doors: collectDoors(g), lightbar, brakeLights, headLights, body: merged[0] };
}

export class Vehicle {
  constructor(city, opts = {}) {
    this.city = city;
    this.type = opts.type || pick(CAR_TYPES);
    this.isPolice = !!opts.police;
    this.isTaxi = !this.isPolice && this.type.id === 'taxi';
    this.color = opts.color !== undefined ? opts.color : pick(BODY_COLORS);
    if (this.isPolice) this.type = { ...this.type, ...APPROVED_FLEET.police, topSpeed: 36, accel: 7, hp: 130 };

    // cosmetic variation so no two cars look identical
    const rims = [0xaeb3ba, 0x8a8f96, 0x2a2d33, 0xd9c98a];
    this.variant = opts.variant || {
      rim: pick(rims),
      trim: Math.random() < 0.25 ? 0x101216 : 0x24262c,
      stripe: Math.random() < 0.5 ? pick([0xf0f0f0, 0x101010, 0xd8b23a]) : null,
    };
    if (opts.color === undefined && Math.random() < 0.08 && !this.isPolice && !this.type.emergency) {
      this.color = pick(RUST_COLORS);   // the odd beater
    }
    const built = buildCarMesh(this.type, this.color, this.isPolice, this.isTaxi, this.variant);
    this.mesh = built.group;
    this.wheels = built.wheels;
    this.doors = built.doors || [];
    this.lightbar = built.lightbar;
    this.brakeLights = built.brakeLights || [];
    this.headLights = built.headLights || [];
    this.sirenMaterials = built.sirenMaterials || [];
    this.headlightCone = null;
    this.bodyMesh = built.body;

    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.y = 0;
    this.vy = 0;
    this.airborne = false;
    this.heading = opts.heading || 0;
    this.roll = 0;
    this.pitch = 0;
    this.speed = 0;
    this.vx = 0; this.vz = 0;
    this.steer = 0;
    this.radius = Math.max(this.type.w, this.type.l) * 0.42;
    this.maxHealth = this.type.hp;
    this.health = this.maxHealth;
    this.destroyed = false;
    this.burning = 0;
    this.driver = null;
    this.wheelSpin = 0;
    this.skidding = false;
    this.braking = false;
    this.flashT = 0;
    this.sirenOn = false;
    this.locked = false;
    this._boxes = [];
    this.updateMesh();
  }

  get isBike() { return !!this.type.bike; }

  /**
   * Болванчик за рулём для машин трафика.
   *
   * У машин ИИ была только логика — салоны стояли пустые, а мотоциклы вообще
   * ездили сами по себе. Полноценный Character тут не нужен и дорог: в
   * закрытой машине сквозь тонированное стекло видно ровно силуэт головы и
   * плеч. У мотоцикла фигура на виду, поэтому ей добавляем ноги.
   *
   * Видимостью управляет сам Vehicle в update(): сел игрок или водителя
   * вытащили при угоне — болванчик прячется.
   */
  ensureDummyDriver() {
    if (this.dummyDriver) return this.dummyDriver;
    // За рулём сидит ТА ЖЕ фигура, что ходит по улицам (см. buildDriver):
    // раньше это были два бокса, и при угоне «водитель» выскакивал совсем
    // другим человеком, чем прохожие вокруг.
    const bike = this.isBike;
    // Внешность запоминаем НА МАШИНЕ: при угоне из неё вылезает именно тот
    // человек, которого было видно через стекло, а не случайный прохожий.
    this.driverLook = this.driverLook || randomLook(this.isPolice ? { role: 'police' } : {});
    const g = buildDriver(this.driverLook, bike);
    if (bike) {
      // на мотоцикле видно целиком
      g.position.set(0, (this.type.scooter ? .62 : .72) - 0.92, -0.05);
    } else {
      // в салоне видно голову и плечи: сажаем так, чтобы голова была
      // под линией крыши, а не торчала сквозь неё
      const h = this.type.h || 1.2;
      g.scale.setScalar(0.92);
      const cabin = this.doors[0]?.hinge.userData;
      g.position.set(-this.type.w * 0.2, (cabin?.cabinTop ? cabin.cabinTop - .06 : h * .74) - 1.72 * .92, cabin?.doorAlong ?? this.type.l * .08);
    }
    this.mesh.add(g);
    this.dummyDriver = g;
    return g;
  }

  updateMesh() {
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(this.pitch, this.heading, this.roll);
  }

  drive(dt, throttle, steerInput, handbrake) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let remaining = Math.min(dt, .1);
    while (remaining > 1e-8) {
      const step = Math.min(remaining, 1 / 120);
      this.driveStep(step, throttle, steerInput, handbrake);
      remaining -= step;
    }
  }

  driveStep(dt, throttle, steerInput, handbrake) {
    const t = this.type;
    if (this.destroyed) { throttle = 0; handbrake = true; }

    const speedFrac = Math.abs(this.speed) / t.topSpeed;
    const maxSteer = (this.isBike ? 0.72 : 0.62) * (1 - Math.min(0.62, speedFrac * 0.72));
    this.steer += (steerInput * maxSteer - this.steer) * Math.min(1, dt * 9);

    this.braking = throttle < -0.05 && this.speed > 0.5;
    const opposite = throttle * this.speed < 0 && Math.abs(this.speed) > .12;
    if (opposite) {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), Math.abs(throttle) * (t.mass > 2 ? 7 : 9.5) * dt);
    } else if (Math.abs(throttle) > .05) {
      const reverse = throttle < 0;
      const limit = reverse ? Math.min(9, t.topSpeed * .28) : t.topSpeed;
      const taper = Math.max(0, 1 - Math.pow(Math.abs(this.speed) / limit, 2));
      this.speed += throttle * t.accel * (reverse ? .65 : 1) * taper * dt;
    } else {
      const coast = .55 + this.speed * this.speed * .0018;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), coast * dt);
    }

    if (handbrake) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 24 * dt);

    const maxS = t.topSpeed * (this.destroyed ? 0.35 : 1);
    this.speed = clamp(this.speed, -Math.min(9, maxS * .28), maxS);

    if (!this.airborne) {
      // heading grows counter-clockwise, so a right turn (steer > 0) subtracts
      const turnRate = this.steer * clamp(Math.abs(this.speed) / 5, 0, 1.6) * (this.speed < 0 ? -1 : 1);
      this.heading -= turnRate * dt * 2.15;
    }

    this.skidding = handbrake && Math.abs(this.speed) > 8;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const grip = (this.skidding ? 0.86 : 0.995) * t.grip;
    const gm = 1 - Math.pow(1 - clamp(grip, 0, .9999), dt * 60);
    this.vx = this.vx * (1 - gm) + fx * this.speed * gm;
    this.vz = this.vz * (1 - gm) + fz * this.speed * gm;

    // body roll / pitch feel
    const targetRoll = -this.steer * clamp(Math.abs(this.speed) / t.topSpeed, 0, 1) * (this.isBike ? 0.55 : 0.14);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);
    if (!this.airborne) {
      const targetPitch = clamp(-throttle * 0.035 + (this.braking ? 0.05 : 0), -0.06, 0.08);
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 6);
    }

    this.integrate(dt);

    this.wheelSpin += this.speed * dt;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.userData.spin = (w.userData.spin + this.speed * dt / w.userData.radius) % (Math.PI * 2);
      w.rotation.x = w.userData.spin;
      w.userData.steering.rotation.y = w.userData.front ? -this.steer * .8 : 0;
    }
    for (const m of this.brakeLights) {
      if (m.userData.staLamp) m.emissiveIntensity = this.braking || handbrake ? 2 : .12;
      else m.color.setHex(this.braking || handbrake ? 0xff3020 : 0x5a1010);
    }
  }

  launch(power) {
    if (this.airborne) return;
    this.vy = power;
    this.airborne = true;
  }

  integrate(dt) {
    // vertical / ramp physics
    if (this.airborne || this.y > 0.001) {
      this.vy -= 26 * dt;
      this.y += this.vy * dt;
      this.pitch += (-this.vy * 0.012 - this.pitch) * Math.min(1, dt * 4);
      if (this.y <= 0) {
        const impact = -this.vy;
        this.y = 0; this.vy = 0; this.airborne = false;
        if (impact > 12) {
          this.health -= (impact - 12) * 2.4;
          this.onCrash && this.onCrash(impact * 0.7);
        }
        this.pitch = 0;
      }
    }

    // ramp launch check
    for (const r of this.city.ramps) {
      if (Math.abs(this.speed) < 12 || this.airborne) continue;
      if (Math.hypot(this.x - r.x, this.z - r.z) < r.r) {
        this.launch(clamp(Math.abs(this.speed) * 0.42, 5, 15));
        this.onRamp && this.onRamp();
        break;
      }
    }

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;
    const boxes = this.city.nearbyColliders(nx, nz, this.radius + 4, this._boxes);
    // when airborne, ignore low obstacles
    const active = this.y > 2.5 ? boxes.filter((b) => b.height > this.y) : boxes;
    const r = resolveCircleBoxes(nx, nz, this.radius, active);
    if (r.hit) {
      const impact = Math.abs(this.speed);
      if (impact > 6) {
        this.health -= (impact - 6) * 1.8;
        this.onCrash && this.onCrash(impact);
      }
      const dot = this.vx * r.nx + this.vz * r.nz;
      this.vx -= r.nx * dot * 1.25;
      this.vz -= r.nz * dot * 1.25;
      this.speed *= impact > 10 ? 0.25 : 0.72;
    }
    this.x = r.x; this.z = r.z;

    if (this.health <= 0 && !this.destroyed) {
      this.destroyed = true;
      this.burning = 4.5;
      this.onDestroyed && this.onDestroyed();
    }
    this.updateMesh();
  }

  setDoor(side, open) {
    for (const door of this.doors) if (door.side === side) door.target = open ? 1 : 0;
  }

  update(dt) {
    if (this.destroyed || Math.abs(this.speed) > 3) for (const door of this.doors) door.target = 0;
    animateDoors(this.doors, dt);
    // Болванчик за рулём есть, только пока машину ведёт ИИ: игрок садится
    // сам, а при угоне водителя выкидывает наружу отдельным пешеходом.
    if (this.driverAI && !this.driver) this.ensureDummyDriver();
    if (this.dummyDriver) this.dummyDriver.visible = !!this.driverAI && !this.driver;

    if (this.lightbar) {
      if (this.sirenOn) {
        this.flashT += dt;
        const on = Math.sin(this.flashT * 13) > 0;
        this.lightbar.children[0].visible = on;
        this.lightbar.children[1].visible = !on;
      } else {
        this.lightbar.children[0].visible = true;
        this.lightbar.children[1].visible = true;
      }
    }
    if (this.sirenMaterials.length && this.sirenOn) this.flashT += dt;
    for (const material of this.sirenMaterials) {
      const pulse = Math.sin(this.flashT * 16) > 0;
      material.emissiveIntensity = this.sirenOn && (pulse === (material.userData.staLamp === 'sirenLeft')) ? 3 : 0;
    }
    if (this.destroyed && this.burning > 0) {
      this.burning -= dt;
      this.onBurnTick && this.onBurnTick(this.burning);
      if (this.burning <= 0) this.onBurnOut && this.onBurnOut();
    }
  }

  setHeadlights(on) {
    if (this._hlOn === on) return;
    this._hlOn = on;
    for (const m of this.headLights) {
      if (m.userData.staLamp) m.emissiveIntensity = on ? 2 : 0;
      else m.color.setHex(on ? 0xfff6d0 : 0x6a6350);
    }
    if (on && !this.headlightCone && !this.isBike) {
      // Свет фар — освещённое пятно НА ДОРОГЕ, а не объёмный конус в воздухе.
      // Конус читался как луч фонарика, торчащий из бампера: в жизни столб
      // света виден только когда в воздухе взвесь (дождь, туман), а обычно
      // глаз видит именно подсвеченный кусок асфальта.
      const L = 15;
      const geo = new THREE.PlaneGeometry(6.5, L);
      geo.rotateX(-Math.PI / 2);        // кладём на землю
      geo.translate(0, 0, L / 2);       // растим вперёд от бампера
      // Аддитивное смешивание складывается с тем, что уже нарисовано:
      // при 0.75 пятно на тёмном ночном асфальте выгорало в белое.
      // Свет фар должен ЧИТАТЬСЯ, а не слепить, и он тёплый, а не белый.
      const mat = new THREE.MeshBasicMaterial({
        map: TEX.headlightPool(), color: 0xffe9c4,
        transparent: true, opacity: 0.32,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      this.headlightCone = new THREE.Mesh(geo, mat);
      // Чуть выше асфальта, иначе пятно и дорога дерутся за глубину.
      this.headlightCone.position.set(0, 0.04, this.type.l / 2);
      this.mesh.add(this.headlightCone);
    }
    if (this.headlightCone) this.headlightCone.visible = on;
  }

  repair() {
    this.health = this.maxHealth;
    this.destroyed = false;
    this.burning = 0;
    this.mesh.traverse(node => {
      if (!node.isMesh) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material.userData.vehiclePaint) material.color.setHex(this.color);
      }
    });
    if (this.bodyMesh) this.bodyMesh.material.color.setHex(this.color);
  }

  static separate(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    const minD = a.radius + b.radius;
    if (d > minD || d < 1e-5) return 0;
    if (Math.abs(a.y - b.y) > 2.2) return 0;
    const push = (minD - d) / 2;
    const nx = dx / d, nz = dz / d;
    const ma = a.type.mass, mb = b.type.mass;
    const total = ma + mb;
    a.x -= nx * push * (mb / total) * 2;
    a.z -= nz * push * (mb / total) * 2;
    b.x += nx * push * (ma / total) * 2;
    b.z += nz * push * (ma / total) * 2;
    const rel = Math.abs(a.speed - b.speed);
    if (rel > 7) {
      const dmgA = (rel - 7) * 1.1 * (mb / total) * 2;
      const dmgB = (rel - 7) * 1.1 * (ma / total) * 2;
      a.speed *= 0.55; b.speed *= 0.55;
      a.health -= dmgA; b.health -= dmgB;
    }
    a.updateMesh(); b.updateMesh();
    return rel;
  }
}

