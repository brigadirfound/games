import * as THREE from 'three';
import { personGeometry as sculpt, HEAD_PROFILE } from './person-geometry.js';
import { attachHero } from './hero-model.js';
import { attachNpc } from './npc-model.js';
import { moveCharacterBody, terrainHeight } from './character-collision.js';
import { clamp, lerp, angleLerp, rand, pick } from './physics.js';

export const SKIN = [0xf0c8a0, 0xd9a273, 0xa9714b, 0x7a4f31, 0xf3d5b5, 0x8d5a3b];
const SHIRT = [0x2f5aa8, 0xb03b3b, 0x2f8a52, 0xd8b23a, 0x8b3a8b, 0x2b2b30, 0xdedede, 0x2f7f8f];
const PANTS = [0x2a2f3a, 0x3a2f2a, 0x1f1f26, 0x4a4a52, 0x2f3f2f];
const HAIR = [0x2a1c12, 0x120e0a, 0x5a3a1e, 0x7a6a4a, 0x38200f];

// ---------------------------------------------------------------------------
// Кэш геометрии и материалов.
//
// Материалы и неподвижные детали разделяются между персонажами.
// Формованная геометрия тела кэшируется отдельно в person-geometry.js.
// Мутировать кэшированное нельзя: ни один участок кода не красит персонажей
// на лету, и так и должно остаться.
// ---------------------------------------------------------------------------
const MAT_CACHE = new Map();

function mat(color, rough, metal = 0) {
  const k = `${color}|${rough}|${metal}`;
  let m = MAT_CACHE.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    MAT_CACHE.set(k, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Типажи. Рост и ширина задаются масштабом корня — это ноль лишних отрисовок,
// а силуэт в толпе меняется сильнее любой детали. Полнота отдельно, иначе у
// плотного человека вместе с животом раздувались бы и кисти рук.
// ---------------------------------------------------------------------------
export const BUILDS = {
  avg:   { h: 1.00, w: 1.00, girth: 1.00 },
  slim:  { h: 1.03, w: 0.90, girth: 0.86 },
  heavy: { h: 0.96, w: 1.14, girth: 1.34 },
  tall:  { h: 1.12, w: 0.98, girth: 0.94 },
  short: { h: 0.87, w: 1.04, girth: 1.10 },
  broad: { h: 1.04, w: 1.12, girth: 1.12 },
};

export const OUTFITS = ['casual', 'jacket', 'hoodie', 'suit', 'worker', 'dress', 'track'];
export const HAIRSTYLES = ['short', 'buzz', 'bald', 'long', 'pony', 'cap', 'beanie', 'afro'];

const VEST = 0xd8e83a;   // сигнальный жилет
const HI_TRIM = 0xe8e8f0;

/** Случайная внешность прохожего: типаж, одежда, причёска, мелочи. */
export function randomLook(extra = {}) {
  const r = Math.random();
  const outfit = r < 0.30 ? 'casual' : r < 0.46 ? 'jacket' : r < 0.60 ? 'hoodie'
    : r < 0.72 ? 'suit' : r < 0.80 ? 'worker' : r < 0.90 ? 'dress' : 'track';
  return {
    skin: pick(SKIN),
    shirt: pick(SHIRT),
    pants: pick(PANTS),
    hair: pick(HAIR),
    build: pick(['avg', 'avg', 'slim', 'heavy', 'tall', 'short', 'broad']),
    outfit,
    hairStyle: outfit === 'worker' ? 'cap' : pick(HAIRSTYLES),
    beard: Math.random() < 0.22,
    glasses: Math.random() < 0.14,
    bag: Math.random() < 0.18,
    ...extra,
  };
}

/**
 * Главный герой. Внешность зафиксирована и намеренно контрастная: камера
 * почти всегда за спиной, поэтому герой обязан читаться со спины — тёмная
 * куртка с бордовыми рукавами не повторяется больше ни у кого в городе.
 */
export const PLAYER_LOOK = {
  skin: 0xe8b98d, shirt: 0x1b1f2b, pants: 0x232733, hair: 0x18120c,
  build: 'avg', outfit: 'jacket', hairStyle: 'short',
  sleeves: 0x8a2b2f, beard: true, glasses: false, bag: false, hero: true,
};

export const GANGS = [
  { id: 'reds',   name: 'Багровые', shirt: 0x8c1f28, pants: 0x1e1e24, turf: 'industrial' },
  { id: 'blues',  name: 'Синдикат', shirt: 0x1f3f8c, pants: 0x20242c, turf: 'docks' },
  { id: 'greens', name: 'Ямайцы',   shirt: 0x1f7a3a, pants: 0x2a2a1f, turf: 'suburb' },
];

// ---------------------------------------------------------------------------
// Jointed body: limbs pivot from shoulders/hips so animation reads properly.
// Hierarchy: root > [hips > legs] , [chest > head, shoulders > upperArm > foreArm > hand]
// ---------------------------------------------------------------------------
export function buildPerson(opts = {}) {
  const root = new THREE.Group();
  const skinC = opts.skin ?? pick(SKIN);
  const shirtC = opts.shirt ?? pick(SHIRT);
  const pantsC = opts.pants ?? pick(PANTS);
  const hairC = opts.hair ?? pick(HAIR);
  const outfit = opts.outfit || 'casual';
  const style = opts.hairStyle || 'short';
  const b = BUILDS[opts.build] || BUILDS.avg;

  // Кожа/ткань/обувь по-разному ловят свет: коже — мягкий блик, ткани —
  // почти никакого, обуви — заметный (кожзам темнее и глянцевее ткани).
  const skinMat = mat(skinC, 0.55);
  const shirtMat = mat(shirtC, 0.88);
  const pantsMat = mat(pantsC, 0.88);
  const hairMat = mat(hairC, 0.92);
  const shoeMat = mat(0x1a1a1e, 0.72);
  const darkMat = mat(0x15151a, 0.6);
  // Рукава: у куртки, худи, костюма и спецовки предплечье закрыто тканью,
  // у остальных — голая кожа. Именно это сильнее всего меняет силуэт.
  const sleeveC = opts.sleeves ?? shirtC;
  const sleeved = outfit === 'jacket' || outfit === 'hoodie'
    || outfit === 'suit' || outfit === 'worker' || outfit === 'track';
  const sleeveMat = sleeved ? mat(sleeveC, 0.88) : skinMat;
  const dress = outfit === 'dress';
  const legMat = dress ? skinMat : pantsMat;

  root.scale.set(b.w, b.h, b.w);

  const mk = (geo, m, cast = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = cast;
    return mesh;
  };

  // ---- torso ----
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const pelvis = mk(sculpt([{ rows: [[-.13,.16,.10],[ -.07,.215,.135],[.07,.21,.135],[.15,.18,.11]] }]), dress ? shirtMat : pantsMat);
  pelvis.position.y = 0.02;
  pelvis.scale.set(b.girth, 1, b.girth);
  hips.add(pelvis);

  if (dress) {
    // Юбка держится на тазе: она должна качаться вместе с корпусом,
    // а не ездить по ногам, которые двигаются каждая сама по себе.
    const skirt = mk(sculpt([{rows:[[-.17,.285,.195],[0,.275,.18],[.17,.255,.155]],power:.8}]), shirtMat);
    skirt.position.y = -0.18;
    skirt.scale.set(b.girth, 1, b.girth);
    hips.add(skirt);
  }

  const chest = new THREE.Group();
  chest.position.y = 0.2;
  hips.add(chest);

  // Воротник и капюшон того же цвета, что и корпус, поэтому вплавлены прямо
  // в его геометрию — на толпе это разница между 18 и 20 вызовами отрисовки
  // на человека.
  const torsoParts = [{ rows: [[-.26,.19,.12],[-.20,.20,.125],[-.05,.205,.135],
    [.10,.255,.155],[.20,.26,.14],[.25,.18,.11],[.28,.085,.075]], power:.85 }];
  if (outfit === 'jacket' || outfit === 'track') {
    torsoParts.push({ rows:[[.24,.11,.09],[.30,.095,.085]], z:-.012 });
  }
  if (outfit === 'hoodie') {
    torsoParts.push({ w: 0.34, h: 0.24, d: 0.16, y: 0.31, z: -0.11 });
  }
  if (outfit === 'suit') {
    torsoParts.push({ w: 0.25, h: 0.08, d: 0.2, y: 0.25 });
  }
  const torso = mk(sculpt(torsoParts), shirtMat);
  torso.position.y = 0.24;
  torso.scale.set(b.girth, 1, b.girth);
  chest.add(torso);

  // Clothing follows the torso itself, including girth and first-person hiding.
  // Small raised seams remain geometry so they read under moving city light.
  if (opts.hero || outfit === 'jacket' || outfit === 'track') {
    const trim = mk(sculpt([
      {rows:[[-.255,.195,.126],[-.22,.199,.128]],power:.85},
      {w:.017,h:.40,d:.013,y:-.018,z:.139},
      {w:.105,h:.015,d:.016,x:-.118,y:-.12,z:.112,rz:.24},
      {w:.105,h:.015,d:.016,x:.118,y:-.12,z:.112,rz:-.24},
    ]), mat(0x11151d,.94));
    torso.add(trim);
    if(opts.hero) {
      const stitching = mk(sculpt([
        {w:.018,h:.040,d:.012,y:.135,z:.155},
        {w:.105,h:.030,d:.013,x:-.116,y:.105,z:.145},
        {w:.30,h:.009,d:.010,y:.14,z:-.155},
      ]),mat(0x999b9f,.65),false);
      torso.add(stitching);
    }
  }

  if (outfit === 'suit') {
    // Светлая рубашка с галстуком — единственный способ отличить костюм от
    // просто тёмной футболки на расстоянии.
    const shirtFront = mk(sculpt([{rows:[[-.08,.035,.008,.145],[.12,.075,.008,.155],
      [.22,.07,.008,.13],[.26,.055,.008,.10]]}]), mat(HI_TRIM, 0.8));
    torso.add(shirtFront);
    const tie=mk(sculpt([{w:.031,h:.21,d:.014,y:.055,z:.166}]),mat(0x582630,.9));
    torso.add(tie);
  }

  if (outfit === 'worker') {
    const vest = mk(sculpt([{rows:[[-.23,.208,.139],[-.05,.218,.147],[.10,.268,.169],
      [.20,.271,.152],[.25,.19,.123],[.27,.10,.09]],power:.85}]), mat(VEST, 0.9));
    torso.add(vest);
  }

  if (opts.bag) {
    const bag = mk(sculpt([{w:.30,h:.38,d:.20}]), mat(0x2c3038, 0.85));
    bag.position.set(0, 0.26, -0.2 * b.girth);
    chest.add(bag);
  }

  const neck = mk(sculpt([{rows:[[-.07,.072,.07],[.06,.065,.065]]}]), skinMat);
  neck.position.y = 0.53;
  chest.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.y = 0.58;
  chest.add(headPivot);

  // Skull, jaw, nose and ears form one skin mesh; eyes follow its curved face.
  const head = mk(sculpt([
    { rows:HEAD_PROFILE,segments:16,power:.83 },
    { w:.039,h:.082,d:.049,y:.162,z:.112,rx:-.16 },
    { w:.047,h:.030,d:.041,y:.135,z:.139 },
    { w:.037,h:.068,d:.041,x:-.123,y:.159,z:-.008 },
    { w:.037,h:.068,d:.041,x:.123,y:.159,z:-.008 },
  ]), skinMat);
  headPivot.add(head);

  // Глаза, рот и оправа очков — одинаково тёмные, сливаются в одну деталь.
  const faceParts = [
    { w:.023,h:.014,d:.012,x:-.052,y:.193,z:.109 },
    { w:.023,h:.014,d:.012,x:.052,y:.193,z:.109 },
    { w:.059,h:.009,d:.012,y:.083,z:.111 },
  ];
  if (opts.glasses) {
    faceParts.push({ w:.18,h:.012,d:.014,y:.2,z:.12 });
    faceParts.push({ w:.075,h:.044,d:.016,x:-.052,y:.193,z:.12 });
    faceParts.push({ w:.075,h:.044,d:.016,x:.052,y:.193,z:.12 });
  }
  const face = mk(sculpt(faceParts), darkMat, false);
  headPivot.add(face);

  // Причёска, брови и борода — всё волосяное одним мешем.
  const capped = style === 'cap' || style === 'beanie';
  const hairParts = [
    { w:.058,h:.013,d:.016,x:-.055,y:.22,z:.106,rz:-.09 },
    { w:.058,h:.013,d:.016,x:.055,y:.22,z:.106,rz:.09 },
  ];
  const top = capped ? 'buzz' : style;
  const crop = {rows:[[.245,.113,.102,-.018],[.28,.115,.11,-.019],
    [.325,.09,.085,-.023],[.351,.025,.030,-.03]],segments:16};
  if (top === 'short') hairParts.push({shell:'hair'});
  else if (top === 'buzz') hairParts.push(crop);
  else if (top === 'afro') {
    hairParts.push({w:.32,h:.25,d:.30,y:.30,z:-.02});
    for(let i=0;i<8;i++) hairParts.push({w:.11,h:.13,d:.11,
      x:Math.sin(i*Math.PI/4)*.12,y:.29+(i%2)*.045,z:Math.cos(i*Math.PI/4)*.11-.02});
  }
  else if (top === 'long') {
    hairParts.push(crop,{w:.275,h:.34,d:.16,y:.16,z:-.093});
  } else if (top === 'pony') {
    hairParts.push(crop,{w:.095,h:.26,d:.10,y:.20,z:-.161,rx:.23});
  }
  // 'bald' — только брови
  if (opts.beard) {
    hairParts.push({shell:'beard'},
      {w:.067,h:.012,d:.022,y:.104,z:.111});
  }
  const hair = mk(sculpt(hairParts), hairMat);
  headPivot.add(hair);

  if (capped) {
    const hatC = opts.hat ?? (outfit === 'worker' ? VEST : shirtC);
    const hatParts = style === 'cap'
      ? [{ w: 0.31, h: 0.1, d: 0.31, y: 0.34 }, { w: 0.27, h: 0.035, d: 0.14, y: 0.305, z: 0.2 }]
      : [{ w: 0.32, h: 0.17, d: 0.32, y: 0.36 }];
    const hat = mk(sculpt(hatParts), mat(hatC, 0.85));
    headPivot.add(hat);
  }

  // ---- arms: upper -> fore -> hand ----
  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * .265 * b.girth, 0.44, 0);
    chest.add(shoulder);

    const upper = mk(sculpt([{rows:[[-.17,.066,.068],[-.08,.079,.083],
      [.075,.092,.09],[.14,.075,.075],[.19,.035,.04]]}]), sleeved ? sleeveMat : shirtMat);
    upper.position.y = -0.15;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    shoulder.add(elbow);

    const fore = mk(sculpt([{rows:[[-.15,.047,.05],[-.10,.051,.056],
      [.045,.071,.072],[.14,.066,.068],[.18,.034,.036]]}]), sleeveMat);
    fore.position.y = -0.14;
    elbow.add(fore);
    if (sleeved) {
      const cuff = mk(sculpt([{rows:[[-.285,.049,.052],[-.24,.052,.058]]}]), darkMat);
      elbow.add(cuff);
    }

    const hand = new THREE.Group();
    hand.position.y = -0.28;
    elbow.add(hand);
    const palm = mk(sculpt([{w:.085,h:.14,d:.056,y:-.033},
      {w:.038,h:.077,d:.038,x:-side*.041,y:-.018,z:.018,rz:-side*.35}]), skinMat);
    hand.add(palm);

    arms.push({ shoulder, elbow, hand, side });
  }

  // ---- legs: thigh -> shin -> foot ----
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, -0.06, 0);
    hips.add(hip);

    const thigh = mk(sculpt([{rows:[[-.22,.078,.082],[-.13,.09,.093],
      [.09,.114,.117],[.20,.10,.10],[.24,.055,.065]]}]), legMat);
    thigh.position.y = -0.2;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -0.4;
    hip.add(knee);

    const shin = mk(sculpt([{rows:[[-.20,.065,.065],[-.13,.067,.075],
      [.015,.086,.10,-.012],[.15,.08,.086],[.22,.042,.045]]}]), legMat);
    shin.position.y = -0.19;
    knee.add(shin);

    const foot = mk(sculpt([{rows:[[-.045,.085,.146,.018],[-.012,.089,.148,.018],
      [.034,.079,.125,.011],[.075,.059,.074,-.032]],power:.65}]), shoeMat);
    foot.position.set(0, -0.42, 0.05);
    knee.add(foot);
    if (opts.hero) {
      const sole = mk(sculpt([{rows:[[-.046,.086,.148,.018],[-.025,.09,.149,.018]],power:.65},
        ...[0,.028,.056].map(z=>({w:.085,h:.007,d:.012,y:.052,z:z-.015}))]),mat(0xaeb0ab,.9));
      foot.add(sole);
    }

    legs.push({ hip, knee, foot, side });
  }

  return { group: root, hips, chest, headPivot, arms, legs, torso, head };
}

/**
 * Водитель для машины: та же фигура, что ходит по улицам, но посаженная
 * и ЗАПЕЧЁННАЯ в пару мешей.
 *
 * За рулём раньше сидели два бокса — торс и голова. Рядом с прохожими, у
 * которых есть лица, причёски и одежда, это читалось грубо, а при угоне
 * «водитель» выпрыгивал совсем другим человеком. Сажать полноценного
 * персонажа как есть тоже нельзя: восемнадцать мешей на каждого из
 * тридцати восьми водителей — это сотни лишних вызовов отрисовки на
 * фигуры, которые не двигаются. Поэтому позу применяем один раз, а потом
 * складываем всё по материалам.
 */
export function buildDriver(opts, bike = false) {
  opts = opts || randomLook();
  const b = buildPerson(opts);

  b.hips.rotation.x = bike ? 0.16 : 0.06;
  b.chest.rotation.x = bike ? 0.10 : 0.04;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? 1 : -1;
    const a = b.arms[i];
    a.shoulder.rotation.x = bike ? -1.15 : -1.0;
    a.shoulder.rotation.y = s * (bike ? 0.30 : 0.22);
    a.shoulder.rotation.z = s * 0.10;
    a.elbow.rotation.x = bike ? -0.42 : -0.72;
    const l = b.legs[i];
    l.hip.rotation.x = bike ? -0.95 : -1.15;
    l.hip.rotation.z = s * (bike ? 0.26 : 0.12);
    l.knee.rotation.x = bike ? 1.25 : 1.05;
    l.foot.rotation.x = bike ? -0.25 : -0.15;
    // В закрытой машине ног не видно никогда — не платим за них.
    if (!bike) { l.hip.visible = false; }
  }

  const driver = { ...b, mesh:b.group, speed:0, inVehicle:true, driverBike:bike };
  const skin = attachNpc(driver, opts);
  if(skin) for(let i=0;i<30;i++)skin.update(1/30);
  const root = b.group;
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o.parent, скрыт = false;
    while (p && p !== root) { if (!p.visible) { скрыт = true; break; } p = p.parent; }
    if (скрыт) return;
    const g = o.geometry.clone();
    if(o.isSkinnedMesh){
      const vertex=new THREE.Vector3();
      for(let i=0;i<g.attributes.position.count;i++){
        o.getVertexPosition(i,vertex);g.attributes.position.setXYZ(i,vertex.x,vertex.y,vertex.z);
      }
      g.computeVertexNormals();
      g.deleteAttribute('skinIndex');g.deleteAttribute('skinWeight');
    }
    g.applyMatrix4(inv.clone().multiply(o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });

  const out = new THREE.Group();
  out.userData.npcModel = opts.npcModel;
  out.scale.copy(root.scale);
  for (const [m, geos] of byMat) {
    const merged = geos.length === 1 ? geos[0] : mergeIndexed(geos);
    if (geos.length > 1) geos.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = true;
    out.add(mesh);
  }
  return out;
}

/** Слияние индексированных геометрий с одинаковым набором атрибутов. */
function mergeIndexed(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    const src = g.index.array;
    for (let i = 0; i < src.length; i++) idx[io + i] = src[i] + vo;
    io += src.length;
    vo += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
export class Character {
  constructor(city, x, z, opts = {}) {
    this.city = city;
    const b = buildPerson(opts);
    this.mesh = b.group;
    this.hips = b.hips;
    this.chest = b.chest;
    this.headPivot = b.headPivot;
    this.arms = b.arms;
    this.legs = b.legs;
    this.torso = b.torso;
    this.skin = opts.hero ? attachHero(this, opts) : attachNpc(this, opts);

    this.x = x; this.z = z; this.y = 0;
    this.heading = rand(-Math.PI, Math.PI);
    this.radius = 0.42;
    this.speed = 0;
    this.walkPhase = 0;
    this.stepped = 0;      // 1/-1 в кадре касания ноги, иначе 0
    this.maxHealth = opts.health || 100;
    this.health = this.maxHealth;
    this.dead = false;
    this.inVehicle = null;
    this.aimHeading = 0;
    this.aimPitch = 0;
    this.aiming = false;
    this.punchT = 0;
    this.recoil = 0;
    this.hurtT = 0;
    this.ragdoll = 0;
    this.jumpVy = 0;
    this.airborne = false;
    this.crouch = 0;
    this.breathe = rand(0, 6);
    // --- новые анимационные состояния ---
    this.strafeAmt = 0;      // -1 влево / +1 вправо, для боковой походки
    this.landT = 0;          // приседание при приземлении
    this.reloadT = 0;        // перезарядка
    this.fidgetT = rand(3, 9); // таймер до следующей «фишки» в простое
    this.idleAnim = 0;       // 1 — размять шею, 2 — поправить куртку
    this.idleP = 0;
    this.deathKind = 0;      // вариант падения
    this.wasAirborne = false;
    this.vy0 = 0;
    this.kickT = 0;          // удар ногой
    this.punchCombo = 0;     // 0 — левая, 1 — правая, 2 — хук
    this.staggerT = 0;       // отшатывание от сильного удара
    this.cheerT = 0;         // жест победы
    this.handsUpT = 0;       // руки вверх (анимация испуга)
    this.exhausted = 0;      // отдышка после долгого бега
    this.sprintTime = 0;
    this._boxes = [];
    this.mesh.position.set(x, 0, z);
  }

  // ---------------- movement ----------------
  move(dt, dx, dz, maxSpeed, opts = {}) {
    const len = Math.hypot(dx, dz);
    if (len > 1e-4) {
      dx /= len; dz /= len;
      if (!opts.strafe) {
        this.heading = angleLerp(this.heading, Math.atan2(dx, dz), Math.min(1, dt * 14));
      }
      this.speed = maxSpeed;
    } else {
      this.speed *= 0.72;
      dx = 0; dz = 0;
    }

    moveCharacterBody(this, dt, dx * maxSpeed, dz * maxSpeed);

    this.moveDir = { x: dx, z: dz };
    // насколько движение идёт вбок относительно взгляда — для боковой походки
    if (len > 1e-4) {
      const rx = -Math.cos(this.heading), rz = Math.sin(this.heading);
      this.strafeAmt = clamp(dx * rx + dz * rz, -1, 1);
    } else {
      this.strafeAmt *= 0.8;
    }
    // фиксируем момент касания земли, чтобы проиграть присед
    if (this.wasAirborne && !this.airborne) this.landT = 0.32;
    this.wasAirborne = this.airborne;
    if (this.airborne) this.vy0 = Math.min(this.vy0, this.jumpVy);
    this.animate(dt, maxSpeed);
    this.syncMesh();
  }

  jump() {
    if (this.airborne || this.dead) return false;
    this.airborne = true;
    this.jumpVy = 6.2;
    this.vy0 = 0;
    return true;
  }

  reload(dur = 0.9) { this.reloadT = dur; this.reloadDur = dur; }

  // ---------------- animation ----------------
  animate(dt, maxSpeed = 4) {
    if (this.dead) { this.animateDeath(dt); return; }

    const a = this.arms, l = this.legs;
    const spd = this.speed;
    const running = spd > 4.6;
    const moving = spd > 0.25;

    // --- таймеры новых анимаций ---
    this.landT = Math.max(0, this.landT - dt);
    this.reloadT = Math.max(0, this.reloadT - dt);
    this.kickT = Math.max(0, this.kickT - dt);
    this.staggerT = Math.max(0, this.staggerT - dt);
    this.cheerT = Math.max(0, this.cheerT - dt);
    this.handsUpT = Math.max(0, this.handsUpT - dt);
    // долгий спринт копит усталость, на месте — отдышка
    if (running) this.sprintTime = Math.min(9, this.sprintTime + dt);
    else this.sprintTime = Math.max(0, this.sprintTime - dt * 0.7);
    this.exhausted = clamp((this.sprintTime - 3.5) / 5.5, 0, 1);
    const busy = this.punchT > 0 || this.kickT > 0 || this.reloadT > 0
      || this.staggerT > 0 || this.cheerT > 0 || this.handsUpT > 0;
    if (moving || this.aiming || this.airborne || busy) {
      this.idleAnim = 0; this.idleP = 0; this.fidgetT = rand(4, 10);
    } else {
      this.fidgetT -= dt;
      if (this.fidgetT <= 0 && !this.idleAnim) {
        this.idleAnim = 1 + Math.floor(Math.random() * 2);
        this.idleP = 0;
      }
      if (this.idleAnim) {
        this.idleP += dt / 1.5;
        if (this.idleP >= 1) { this.idleAnim = 0; this.idleP = 0; this.fidgetT = rand(6, 13); }
      }
    }
    const rate = running ? 9.5 : 6.4;
    const prevPhase = this.walkPhase;
    this.walkPhase += dt * rate * clamp(spd / (running ? 6.4 : 3.2), 0.2, 1.6);
    this.breathe += dt;
    // Касание ноги о землю — это переход walkPhase через кратное π: там
    // синус меняет знак, то есть одна нога сменила другую. Считаем шаги
    // здесь, а не по таймеру, иначе пыль и следы разъезжаются с ногами.
    this.stepped = 0;
    if (spd > 0.6 && !this.airborne) {
      const a = Math.floor(prevPhase / Math.PI);
      const b = Math.floor(this.walkPhase / Math.PI);
      if (b !== a) this.stepped = ((b % 2) + 2) % 2 === 0 ? 1 : -1;
    }

    const amp = clamp(spd / 3.2, 0, 1) * (running ? 1.25 : 1);
    const sw = Math.sin(this.walkPhase);
    const sw2 = Math.sin(this.walkPhase * 2);

    // --- legs ---
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const swing = sw * s * amp;
      if (this.airborne) {
        // tuck legs mid-air
        l[i].hip.rotation.x = lerp(l[i].hip.rotation.x, -0.5 + s * 0.25, Math.min(1, dt * 10));
        l[i].knee.rotation.x = lerp(l[i].knee.rotation.x, 0.9, Math.min(1, dt * 10));
      } else {
        l[i].hip.rotation.x = swing * 0.85;
        // knee only bends backwards, and mostly on the back-swing
        l[i].knee.rotation.x = Math.max(0, -swing) * 1.15 + amp * 0.1;
        l[i].foot.rotation.x = -Math.max(0, -swing) * 0.5;
      }
      // удар ногой: правая нога выбрасывается вперёд
      if (this.kickT > 0 && i === 1) {
        const kp = Math.sin((1 - this.kickT / 0.38) * Math.PI);
        l[i].hip.rotation.x = -kp * 1.5;
        l[i].knee.rotation.x = (1 - kp) * 1.0;
        l[i].foot.rotation.x = -kp * 0.4;
      }
      // приседание при приземлении — обе ноги подгибаются
      if (this.landT > 0) {
        const k = Math.sin((this.landT / 0.32) * Math.PI) * 0.75;
        l[i].hip.rotation.x -= k * 0.5;
        l[i].knee.rotation.x += k * 0.9;
      }
      // боковой шаг: ноги расходятся/скрещиваются
      const st = Math.abs(this.strafeAmt) > 0.35 ? this.strafeAmt : 0;
      l[i].hip.rotation.z = lerp(l[i].hip.rotation.z,
        st * (i === 0 ? 0.3 : -0.16) * amp, Math.min(1, dt * 9));
    }

    // --- hips bob / lean ---
    const bob = moving ? Math.abs(sw2) * 0.045 * amp : Math.sin(this.breathe * 1.6) * 0.008;
    const landDip = this.landT > 0 ? Math.sin((this.landT / 0.32) * Math.PI) * 0.17 : 0;
    this.hips.position.y = 0.92 + bob - this.crouch * 0.22 - landDip
      + (this.airborne ? 0.05 : 0);
    this.hips.rotation.z = moving ? sw * 0.045 * amp : 0;
    // наклон вперёд растёт со скоростью, а не переключается ступенькой
    const leanTarget = clamp(spd / 6.4, 0, 1) * 0.16 + landDip * 0.5;
    this.hips.rotation.x = lerp(this.hips.rotation.x, leanTarget, Math.min(1, dt * 8));

    // --- chest counter-rotation ---
    this.chest.rotation.y = lerp(this.chest.rotation.y, moving ? -sw * 0.12 * amp : 0, Math.min(1, dt * 10));

    // --- arms ---
    this.punchT = Math.max(0, this.punchT - dt);
    this.recoil = Math.max(0, this.recoil - dt * 4.5);

    if (this.staggerT > 0) {
      // отшатнулся от удара: корпус назад, руки прикрывают голову
      const sp = Math.sin((this.staggerT / 0.45) * Math.PI);
      a[0].shoulder.rotation.set(-2.0 * sp, -0.5 * sp, 0.4 * sp);
      a[0].elbow.rotation.x = -1.9 * sp;
      a[1].shoulder.rotation.set(-2.0 * sp, 0.5 * sp, -0.4 * sp);
      a[1].elbow.rotation.x = -1.9 * sp;
      this.chest.rotation.x = -sp * 0.35;
      this.headPivot.rotation.x = -sp * 0.3;
    } else if (this.cheerT > 0) {
      // жест победы: руки вверх, лёгкие подскоки
      const cp = Math.min(1, (1.3 - this.cheerT) * 4);
      const wob = Math.sin(this.cheerT * 14) * 0.16;
      a[0].shoulder.rotation.set(-2.7 * cp, -0.35, 0.5 + wob);
      a[0].elbow.rotation.x = -0.35;
      a[1].shoulder.rotation.set(-2.7 * cp, 0.35, -0.5 - wob);
      a[1].elbow.rotation.x = -0.35;
      this.headPivot.rotation.x = -0.22 * cp;
    } else if (this.handsUpT > 0) {
      // паника: руки над головой, мелкая тряска
      const shake = Math.sin(this.handsUpT * 22) * 0.2;
      a[0].shoulder.rotation.set(-2.9, -0.3 + shake, 0.45);
      a[0].elbow.rotation.x = -0.9;
      a[1].shoulder.rotation.set(-2.9, 0.3 - shake, -0.45);
      a[1].elbow.rotation.x = -0.9;
      this.headPivot.rotation.z = shake * 0.7;
    } else if (this.kickT > 0) {
      // при пинке руки идут в контрбаланс
      const kp = Math.sin((1 - this.kickT / 0.38) * Math.PI);
      a[0].shoulder.rotation.set(-0.9 * kp, -0.4 * kp, 0.3);
      a[0].elbow.rotation.x = -0.8;
      a[1].shoulder.rotation.set(0.5 * kp, 0.3 * kp, -0.3);
      a[1].elbow.rotation.x = -0.5;
      this.chest.rotation.y = kp * 0.3;
    } else if (this.reloadT > 0) {
      // перезарядка: левая рука уходит к поясу за магазином и возвращается
      const rp = 1 - this.reloadT / (this.reloadDur || 0.9);
      const fetch = Math.sin(clamp(rp, 0, 1) * Math.PI);
      a[0].shoulder.rotation.set(-Math.PI / 2 + 0.15, -0.1, 0.1);
      a[0].elbow.rotation.x = -0.3;
      a[1].shoulder.rotation.set(-0.35 - fetch * 0.75, 0.5 + fetch * 0.3, -0.3);
      a[1].elbow.rotation.x = -1.5 - fetch * 0.7;
      this.chest.rotation.y = lerp(this.chest.rotation.y, -0.16, Math.min(1, dt * 10));
      this.headPivot.rotation.x = fetch * 0.28;
    } else if (this.punchT > 0) {
      const p = Math.sin((1 - this.punchT / 0.28) * Math.PI);
      // 0 — левый прямой, 1 — правый прямой, 2 — хук сбоку
      const lead = this.punchCombo === 1 ? 1 : 0;
      const off = lead === 0 ? 1 : 0;
      const sgn = lead === 0 ? -1 : 1;
      if (this.punchCombo === 2) {
        a[lead].shoulder.rotation.set(-1.15 * p, sgn * 1.15 * p, sgn * 0.5 * p);
        a[lead].elbow.rotation.x = -1.25 + p * 0.45;
        this.chest.rotation.y = sgn * p * 0.65;
      } else {
        a[lead].shoulder.rotation.set(-p * 1.75, sgn * p * 0.35, 0);
        a[lead].elbow.rotation.x = -(1 - p) * 1.1;
        this.chest.rotation.y = sgn * p * 0.4;
      }
      a[off].shoulder.rotation.set(-0.5 + p * 0.3, -sgn * 0.2, 0);
      a[off].elbow.rotation.x = -1.3;
    } else if (this.aiming) {
      // both hands forward on the weapon, torso turned into the shot
      const pitch = clamp(this.aimPitch, -0.7, 0.7);
      const kick = this.recoil * 0.5;
      a[0].shoulder.rotation.set(-Math.PI / 2 + pitch + kick, -0.18, 0.12);
      a[0].elbow.rotation.x = -0.12;
      a[1].shoulder.rotation.set(-Math.PI / 2 + pitch + kick * 0.7, 0.34, -0.22);
      a[1].elbow.rotation.x = -0.55;
      this.chest.rotation.y = lerp(this.chest.rotation.y, -0.22, Math.min(1, dt * 12));
      this.headPivot.rotation.x = pitch * 0.5;
    } else if (this.idleAnim === 1) {
      // размять шею: голова по кругу, плечи чуть вверх
      const ip = this.idleP * Math.PI * 2;
      this.headPivot.rotation.z = Math.sin(ip) * 0.3;
      this.headPivot.rotation.x = -Math.cos(ip) * 0.16;
      for (let i = 0; i < 2; i++) {
        const s2 = i === 0 ? 1 : -1;
        a[i].shoulder.rotation.x = lerp(a[i].shoulder.rotation.x, -0.12, Math.min(1, dt * 6));
        a[i].shoulder.rotation.z = s2 * (0.06 + Math.sin(ip) * 0.05);
        a[i].elbow.rotation.x = -0.2;
      }
    } else if (this.idleAnim === 2) {
      // поправить куртку: обе руки коротко дёргают лацканы
      const ip = Math.sin(this.idleP * Math.PI);
      a[0].shoulder.rotation.set(-0.55 * ip, -0.3 * ip, 0.25);
      a[0].elbow.rotation.x = -1.5 * ip - 0.2;
      a[1].shoulder.rotation.set(-0.55 * ip, 0.3 * ip, -0.25);
      a[1].elbow.rotation.x = -1.5 * ip - 0.2;
      this.chest.rotation.y = lerp(this.chest.rotation.y, 0, Math.min(1, dt * 8));
    } else {
      const armSwing = -sw * amp * (running ? 1.05 : 0.72);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        a[i].shoulder.rotation.x = armSwing * s;
        a[i].shoulder.rotation.z = s * (0.06 + amp * 0.05);
        a[i].shoulder.rotation.y = 0;
        // elbows bend more when running
        a[i].elbow.rotation.x = -(running ? 0.85 : 0.22) - Math.max(0, armSwing * s) * 0.35;
      }
      this.headPivot.rotation.x = lerp(this.headPivot.rotation.x, running ? 0.1 : 0, Math.min(1, dt * 6));
      // отдышка: чем дольше бежал, тем заметнее вздымаются плечи
      if (this.exhausted > 0.05 && !moving) {
        const br = Math.sin(this.breathe * 5.2) * this.exhausted;
        for (let i = 0; i < 2; i++) {
          a[i].shoulder.rotation.x += br * 0.22;
          a[i].elbow.rotation.x -= Math.abs(br) * 0.35;
        }
        this.chest.rotation.x += this.exhausted * 0.14 + br * 0.05;
        this.headPivot.rotation.x += this.exhausted * 0.12;
      }
    }

    // hurt flinch
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      const f = this.hurtT / 0.25;
      this.chest.rotation.x = -f * 0.3;
      this.headPivot.rotation.z = f * 0.25;
    } else {
      this.chest.rotation.x = lerp(this.chest.rotation.x, this.aiming ? 0.06 : 0, Math.min(1, dt * 8));
      this.headPivot.rotation.z = lerp(this.headPivot.rotation.z, 0, Math.min(1, dt * 8));
    }
  }

  animateDeath(dt) {
    this.ragdoll = Math.min(1, this.ragdoll + dt * 3.4);
    const t = this.ragdoll;
    const ease = t * t * (3 - 2 * t);
    const k = Math.min(1, dt * 6);

    if (this.deathKind === 1) {
      // на колени, потом лицом вперёд
      const knee = Math.min(1, ease * 1.8);
      this.mesh.rotation.z = 0;
      this.mesh.rotation.x = -ease * (Math.PI / 2) * 0.98;
      this.mesh.position.y = ease * 0.26;
      this.hips.rotation.x = -knee * 0.5 + ease * 0.2;
      for (const l of this.legs) {
        l.hip.rotation.x = lerp(l.hip.rotation.x, knee * 0.9, k);
        l.knee.rotation.x = lerp(l.knee.rotation.x, knee * 1.5, k);
      }
      for (const a of this.arms) {
        a.shoulder.rotation.x = lerp(a.shoulder.rotation.x, -0.2 * ease, k);
        a.elbow.rotation.x = lerp(a.elbow.rotation.x, -0.15 * ease, k);
      }
      return;
    }

    if (this.deathKind === 2) {
      // опрокидывается назад, руки разлетаются
      this.mesh.rotation.z = 0;
      this.mesh.rotation.x = ease * (Math.PI / 2) * 0.96;
      this.mesh.position.y = ease * 0.3;
      this.hips.rotation.x = -ease * 0.25;
      for (const l of this.legs) {
        l.hip.rotation.x = lerp(l.hip.rotation.x, 0.4 * ease, k);
        l.knee.rotation.x = lerp(l.knee.rotation.x, 0.3 * ease, k);
      }
      for (let i = 0; i < this.arms.length; i++) {
        const s = i === 0 ? 1 : -1;
        this.arms[i].shoulder.rotation.x = lerp(this.arms[i].shoulder.rotation.x, -1.5 * ease, k);
        this.arms[i].shoulder.rotation.z = lerp(this.arms[i].shoulder.rotation.z, s * 0.8 * ease, k);
        this.arms[i].elbow.rotation.x = lerp(this.arms[i].elbow.rotation.x, -0.2 * ease, k);
      }
      return;
    }

    // 0 — падение на бок (базовый вариант)
    this.mesh.rotation.z = ease * (Math.PI / 2) * this.deathSide;
    this.mesh.position.y = ease * 0.30;
    this.hips.rotation.x = ease * 0.3;
    for (const l of this.legs) {
      l.hip.rotation.x = lerp(l.hip.rotation.x, -0.35 * ease, k);
      l.knee.rotation.x = lerp(l.knee.rotation.x, 0.55 * ease, k);
    }
    for (const a of this.arms) {
      a.shoulder.rotation.x = lerp(a.shoulder.rotation.x, -0.5 * ease, k);
      a.elbow.rotation.x = lerp(a.elbow.rotation.x, -0.3 * ease, k);
    }
  }

  punch() {
    // чередуем удары: левая, правая, хук — серия читается как комбо
    this.punchT = 0.28;
    this.punchCombo = (this.punchCombo + 1) % 3;
  }

  kick() { if (!this.airborne) this.kickT = 0.38; }
  stagger() { this.staggerT = 0.45; }
  cheer() { this.cheerT = 1.3; }
  panic(dur = 2.2) { this.handsUpT = dur; }
  addRecoil(amount = 1) { this.recoil = Math.min(1.4, this.recoil + amount); }

  syncMesh() {
    // Тротуар — это приподнятый бокс, а физика персонажа всегда считала
    // землю плоской: человек ходил «утопленным» в бордюр по колено.
    // Поднимаем меш на высоту поверхности, не трогая саму физику — прыжки,
    // падение с высоты и коллизии продолжают работать как работали.
    // Сглаживание нужно, чтобы на кромке бордюра не было щелчка.
    // Высоту берём по ВСЕЙ подошве, а не по одной точке в центре.
    // Человек шириной 0.84 м, стоя вплотную к кромке, центром ещё на
    // дороге, а плечом и ногой уже над тротуаром — по центральной пробе
    // он оставался внизу, и бордюр резал ему голени. Стоим на самой
    // высокой земле под собой, как в жизни.
    const gh = terrainHeight(this.city, this.x, this.z, this.radius * .85);
    // Сглаживание оставляем СЛАБЫМ и только против дрожания: сам подъём
    // на бордюр теперь заложен в groundHeightAt как функция положения.
    // Прежний лерп 0.25 был единственным сглаживанием ступени и отставал
    // от движения — из-за него ноги уходили в бордюр.
    this._groundVis = this._groundVis === undefined
      ? gh : this._groundVis + (gh - this._groundVis) * 0.6;
    this.mesh.position.set(this.x, this.y + this._groundVis, this.z);
    if (!this.dead) this.mesh.rotation.y = this.heading;
  }

  // hand position in world space (weapon muzzle origin)
  getHandWorld(out = new THREE.Vector3()) {
    this.mesh.updateMatrixWorld(true);
    this.arms[0].hand.getWorldPosition(out);
    // safety: if the rig hasn't been placed yet, fall back to chest height
    if (!isFinite(out.x) || Math.hypot(out.x - this.x, out.z - this.z) > 3) {
      out.set(this.x, this.y + 1.25, this.z);
    }
    return out;
  }

  damage(n) {
    if (this.dead) return false;
    this.health -= n;
    this.hurtT = 0.25;
    // сильный удар отшатывает, слабый — только вздрагивание
    if (n >= 25) this.staggerT = Math.max(this.staggerT, 0.45);
    if (this.health <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.ragdoll = 0;
    this.deathSide = Math.random() < 0.5 ? 1 : -1;
    // 0 — на бок, 1 — на колени лицом вниз, 2 — навзничь
    const r = Math.random();
    this.deathKind = r < 0.5 ? 0 : (r < 0.78 ? 1 : 2);
    this.aiming = false;
  }

  /**
   * Поднять персонажа обратно на ноги.
   *
   * Возрождение раньше сбрасывало только mesh.rotation.z — ось падения на бок.
   * Но варианты смерти 1 и 2 (лицом вниз и навзничь) кладут тело через
   * rotation.x, а поза суставов остаётся от последнего кадра агонии в любом
   * из трёх вариантов. В итоге ожившего героя ставили в точку возрождения
   * лежащим. Отменять надо всё, что тронула animateDeath, поэтому сброс
   * живёт здесь, рядом с самой анимацией, а не в game.js.
   */
  revive() {
    this.dead = false;
    this.ragdoll = 0;
    this.deathKind = 0;
    this.mesh.rotation.set(0, this.heading, 0);
    this.hips.rotation.set(0, 0, 0);
    this.chest.rotation.set(0, 0, 0);
    this.headPivot.rotation.set(0, 0, 0);
    for (const l of this.legs) { l.hip.rotation.set(0, 0, 0); l.knee.rotation.set(0, 0, 0); }
    for (const a of this.arms) {
      a.shoulder.rotation.set(0, 0, 0);
      a.elbow.rotation.set(0, 0, 0);
    }
    this.hurtT = 0; this.staggerT = 0; this.recoil = 0;
    this.aiming = false; this.walkPhase = 0;
    this.y = 0; this.jumpVy = 0; this.airborne = false;
    this.wasAirborne = false; this.vy0 = 0; this.landT = 0;
    this.punchT = 0; this.kickT = 0; this.cheerT = 0; this.handsUpT = 0;
    // Высота земли сглаживается между кадрами; после телепорта старое значение
    // тянуло бы персонажа сквозь бордюр — снимаем, чтобы встало сразу.
    this._groundVis = undefined;
    this.syncMesh();
  }
}

// ---------------------------------------------------------------------------
export class Pedestrian extends Character {
  constructor(city, x, z, opts = {}) {
    // Прохожий без явной внешности получает случайную: иначе толпа, созданная
    // не через spawnPed (свидетели угона, миссии), выходила бы в одинаковых
    // футболках и с одной причёской на всех.
    super(city, x, z, opts.outfit ? opts : randomLook(opts));
    this.target = city.sidewalkPointNear(x, z);
    this.state = 'walk';
    this.baseSpeed = rand(1.5, 2.5);
    this.panicT = 0;
    this.gang = opts.gang || null;
    this.armed = !!opts.armed;
    this.shootCd = rand(0.6, 2.2);
    this.hostile = false;
    this.cash = Math.random() < 0.35 ? Math.floor(rand(5, 60)) : 0;
    this.idleT = 0;
    this.chatT = rand(4, 20);
    this.cowerT = 0;            // сидит на корточках, закрыв голову
    this.freezeT = 0;           // замер на месте с поднятыми руками
    this.braveT = 0;            // «зевака»: смотрит, потом убегает
    this.sprintPanic = false;   // паническое ускорение при выстреле в упор
  }

  update(dt, ctx) {
    if (this.dead) { this.animate(dt); this.syncMesh(); return; }
    let speed = this.baseSpeed;

    if (this.hostile && this.armed) {
      const p = ctx.player;
      const tx = p.inVehicle ? p.inVehicle.x : p.x;
      const tz = p.inVehicle ? p.inVehicle.z : p.z;
      const d = Math.hypot(tx - this.x, tz - this.z);
      if (d < 42) {
        this.aiming = d < 30;
        if (d > 12) this.move(dt, tx - this.x, tz - this.z, 3.4);
        else {
          this.heading = Math.atan2(tx - this.x, tz - this.z);
          this.move(dt, 0, 0, 0);
        }
        this.shootCd -= dt;
        if (d < 30 && this.shootCd <= 0) {
          this.shootCd = rand(1.0, 2.4);
          this.addRecoil(0.8);
          ctx.enemyShoot(this.x, this.z, tx, tz, 8);
        }
        return;
      }
      this.aiming = false;
    }

    // --- испуг: несколько разных реакций вместо одного бегства ---
    if (this.state === 'cower') {
      this.cowerT -= dt;
      this.crouch = Math.min(1, this.crouch + dt * 6);
      this.handsUpT = Math.max(this.handsUpT, 0.3);
      if (this.cowerT <= 0) { this.state = 'walk'; }
      this.move(dt, 0, 0, 0);
      return;
    }
    if (this.state === 'freeze') {
      this.freezeT -= dt;
      this.handsUpT = Math.max(this.handsUpT, 0.3);
      if (this.freezeT <= 0) {
        // отмер — и сразу наутёк
        this.state = 'flee'; this.panicT = 2.6;
      }
      this.move(dt, 0, 0, 0);
      return;
    }
    if (this.state === 'brave') {
      // зевака: пару секунд глазеет на источник шума, затем убегает
      this.braveT -= dt;
      if (this.braveT <= 0) { this.state = 'flee'; this.panicT = 3; this.handsUpT = 0.8; }
      this.move(dt, 0, 0, 0);
      return;
    }
    this.crouch = Math.max(0, this.crouch - dt * 4);

    if (this.state === 'flee') {
      this.panicT -= dt;
      speed = this.baseSpeed * (this.sprintPanic ? 3.1 : 2.4);
      if (this.panicT <= 0) this.state = 'walk';
    }

    for (const v of ctx.vehicles) {
      if (Math.abs(v.speed) < 6) continue;
      if (Math.hypot(v.x - this.x, v.z - this.z) < 12) {
        this.state = 'flee'; this.panicT = 2.5; this.handsUpT = 0.9;
        this.target = { x: this.x + (this.x - v.x) * 3, z: this.z + (this.z - v.z) * 3 };
        break;
      }
    }

    // idle pauses make crowds feel alive
    if (this.state === 'walk') {
      this.idleT -= dt;
      if (this.idleT > 0) { this.move(dt, 0, 0, 0); return; }
      if (Math.random() < dt * 0.05) { this.idleT = rand(1.2, 3.5); return; }
    }

    let dx = this.target.x - this.x, dz = this.target.z - this.z;
    if (Math.hypot(dx, dz) < 2) {
      if (this.state === 'flee') this.state = 'walk';
      // Цель — на своей стороне улицы. Раньше бралась случайная точка по
      // всему городу, и путь по прямой к ней резал проезжую часть: толпа
      // постоянно выходила под машины.
      if (this.parkRoute && this.parkRoute.some(p => Math.hypot(p.x-this.x,p.z-this.z)<14)) {
        this.parkIndex = ((this.parkIndex || 0) + 1) % this.parkRoute.length;
        this.target = this.parkRoute[this.parkIndex];
        this.idleT = rand(0.5, 3);
      } else {
        this.parkRoute = null;
        this.target = this.city.sidewalkPointNear(this.x, this.z);
      }
      dx = this.target.x - this.x; dz = this.target.z - this.z;
    }
    this.move(dt, dx, dz, speed);
  }

  // Реакция на выстрел/взрыв рядом. Тип реакции случайный, но зависит от
  // дистанции: чем ближе источник, тем чаще паника и приседание.
  scare(x, z, dist = null) {
    if (this.hostile) return;
    if (this.state === 'cower' || this.state === 'freeze') return; // уже в шоке
    this.idleT = 0;
    const d = dist === null ? Math.hypot(this.x - x, this.z - z) : dist;
    const close = d < 10;
    const r = Math.random();
    // повернуться лицом к источнику — общее для всех реакций
    this.heading = Math.atan2(x - this.x, z - this.z);

    if (r < (close ? 0.22 : 0.14)) {
      // 1) сжаться на месте, закрыв голову руками
      this.state = 'cower';
      this.cowerT = rand(2.2, 4.0);
      this.handsUpT = this.cowerT;
    } else if (r < (close ? 0.38 : 0.28)) {
      // 2) замереть с поднятыми руками, потом рвануть
      this.state = 'freeze';
      this.freezeT = rand(0.7, 1.6);
      this.handsUpT = this.freezeT + 1.0;
    } else if (!close && r > 0.92) {
      // 3) зевака: издалека сначала глазеет
      this.state = 'brave';
      this.braveT = rand(1.0, 2.2);
    } else {
      // 4) бегство; вблизи — паническим спринтом с криком
      this.state = 'flee';
      this.panicT = close ? 5 : 4;
      this.sprintPanic = close && Math.random() < 0.6;
      this.handsUpT = this.sprintPanic ? 1.8 : 1.2;
      this.target = { x: this.x + (this.x - x) * 4, z: this.z + (this.z - z) * 4 };
    }
  }
}
