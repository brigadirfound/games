import * as THREE from 'three';
import { SpatialHash, rand, randInt, pick, clamp } from './physics.js';
import { TEX } from './textures.js';
import { MODELS } from './models.js';
import { UrbanTrees } from './greenery.js';
import { CityLife } from './city-life.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

export const CITY = {
  N: 11,            // intersections per axis
  SPACING: 68,      // distance between road centerlines
  ROAD_W: 17,       // full road width
  SIDEWALK: 3.4,
};

CITY.SIZE = (CITY.N - 1) * CITY.SPACING;
CITY.HALF = CITY.SIZE / 2;

export function gridToWorld(i) { return i * CITY.SPACING - CITY.HALF; }

// Districts drive building height, colour and mood.
export const DISTRICTS = {
  downtown:   { name: 'ЦЕНТР',        minH: 34, maxH: 95, colors: [0x8d95a3, 0x76808f, 0x9aa3b0, 0x646d7a, 0x59616e] },
  commercial: { name: 'ДЕЛОВОЙ',      minH: 18, maxH: 46, colors: [0xa89a86, 0x94856f, 0xb3a693, 0x7d7263] },
  industrial: { name: 'ПРОМЗОНА',     minH: 9,  maxH: 22, colors: [0x6e6a63, 0x7a6f5f, 0x5d5a55, 0x857a68] },
  suburb:     { name: 'ОКРАИНА',      minH: 7,  maxH: 15, colors: [0xa89076, 0xb9a184, 0x94795e, 0xc2ae92] },
  docks:      { name: 'ПОРТ',         minH: 8,  maxH: 20, colors: [0x6a7078, 0x5c6168, 0x767d84, 0x82705c] },
};
// clean up any accidental bad hex above
DISTRICTS.downtown.colors = [0x8d95a3, 0x76808f, 0x9aa3b0, 0x646d7a, 0x59616e];
DISTRICTS.commercial.colors = [0xa89a86, 0x94856f, 0xb3a693, 0x7d7263, 0xc0b09a];

// Гладкая ступенька 0..1. Нужна везде, где раньше стояли пороги вида
// `night > 0.35`: они переключали свет по всему городу одним кадром.
const smooth01 = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

const ACCENT = [0x2b3a4a, 0x3a2b2b, 0x2f3f33, 0x4a4030, 0x243040];
// Козырьки и вывески — единственное насыщенное пятно на уровне глаз, поэтому
// палитра тут своя: приглушённые крышные акценты на витрине не читаются.
const AWNING = [0xb8342f, 0x1f6a4a, 0x2a4f8f, 0xc8952a, 0x7a2f6a, 0x2f7f8f];

// Высота бордюра. Совпадает с толщиной тротуарной плиты в buildRoads —
// если менять там, менять и здесь, иначе люди снова окажутся в асфальте.
const CURB_H = 0.3;

export const LOCATION_TYPES = {
  spray:    { label: "PAY'N'SPRAY", color: 0x33cc66, radius: 7 },
  ammu:     { label: 'GUN SHOP', color: 0xff9f2e, radius: 5.5 },
  hospital: { label: 'БОЛЬНИЦА',    color: 0xff5555, radius: 6 },
  police:   { label: 'УЧАСТОК',     color: 0x4d7fff, radius: 6 },
};

// Сколько окон реально нарисовано в ОДНОЙ плитке каждой фасадной текстуры
// (assets/facade*.jpg). Светящиеся окна ночью раньше клались по своей
// независимой сетке (шаг ~4.5 м) и никогда не совпадали с окнами на самой
// текстуре — свет висел мимо рам. Без значения здесь
// (facade_warehouse.jpg) окна не сеткой, а нарисованы вручную (ворота) —
// оверлей для неё не строим вообще.
//
// Значения сняты с текстур автокорреляцией профиля яркости, а не на глаз:
// у кирпича швы кладки темнее окон и любая пороговая считалка ловит их,
// а период сетки виден по первому выраженному пику автокорреляции.
// ПЕРЕСНИМАТЬ ПРИ КАЖДОЙ ПЕРЕРИСОВКЕ ФАСАДОВ — генератор не обязан
// повторить запрошенное число окон, и в HD-наборе оно уже разошлось.
const WINDOW_GRID = {
  'facade_concrete.jpg': [7, 6],
  'facade_glass.jpg':    [12, 8],
  'facade_brick.jpg':    [5, 4],
  'facade.jpg':          [6, 7],
  'facade_stone.jpg':    [7, 5],
  'facade_panel.jpg':    [8, 6],
};

export class City {
  constructor(scene) {
    this.scene = scene;
    this.hash = new SpatialHash(40);
    this.colliders = [];
    this.buildings = [];
    this.nodes = [];
    this.nodeGrid = [];
    this.parks = [];
    this.locations = [];
    this.lights = [];        // traffic lights
    this.ramps = [];
    this.districtGrid = [];
    this.windowMaterials = [];
    this.lampMaterials = [];
    this.billboards = [];
    this.shopWindows = [];
    this.neonStrips = [];
    this.neonSigns = [];
    this.facadeMaterials = [];
    // Детали домов копятся здесь и сливаются один раз на весь город: по
    // отдельному мешу на козырёк и парапет вышло бы несколько тысяч вызовов
    // отрисовки, а треугольников там на пару кварталов.
    this.detailGeos = [];
    this.shopGeos = [];
    // Фасады копятся по типу текстуры и сливаются в один меш на тип.
    // Дом был отдельным мешем со своим материалом — двести вызовов
    // отрисовки и двести материалов. Пока дом был одной коробкой, с этим
    // можно было жить; для силуэта из нескольких секций каждая секция
    // стоила бы ещё один вызов, и разнообразие упёрлось бы в цену.
    this.facadeGeos = {};
    this.shopBackGeos = [];
    this.build();
  }

  districtAt(i, j) {
    const gi = clamp(Math.floor(i), 0, CITY.N - 2);
    const gj = clamp(Math.floor(j), 0, CITY.N - 2);
    return this.districtGrid[gi] ? this.districtGrid[gi][gj] : 'suburb';
  }

  districtAtWorld(x, z) {
    const i = Math.floor((x + CITY.HALF) / CITY.SPACING);
    const j = Math.floor((z + CITY.HALF) / CITY.SPACING);
    return this.districtAt(i, j);
  }

  addCollider(minX, minZ, maxX, maxZ, height = 30, tag = null, minY = 0) {
    const b = { minX, minZ, maxX, maxZ, height, tag, minY };
    this.colliders.push(b);
    this.hash.insert(b);
    return b;
  }

  build() {
    this.assignDistricts();
    this.buildGround();
    this.buildRoads();
    this.buildGraph();
    this.buildBlocks();
    this.buildProps();
    this.buildParkAmenities();
    // Слияние — ПОСЛЕ всех, кто наполняет накопители. Раньше оно стояло в
    // конце buildBlocks, а buildProps работает следом: всё, что он клал в
    // detailGeos (кадки под уличными деревьями), сливалось уже впустую и
    // до сцены не доезжало.
    this.finishFacades();
    this.finishRoofProps();
    this.finishShopBacks();
    this.finishDetails();
    this.buildTrafficLights();
    this.buildLocations();
    this.buildRamps();
    this.buildDetails();
    this.buildWalls();
    this.buildWaterfront();
    this.scatterLitter();
  }

  // Набережная в порту: деревянные пирсы, сваи, мост на маленький остров
  // с маяком. Вода перестаёт быть просто фоном на горизонте.
  buildWaterfront() {
    const half = CITY.HALF;
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b5237 });
    const pileMat = new THREE.MeshLambertMaterial({ color: 0x4a3a28 });
    const steelMat = new THREE.MeshLambertMaterial({ color: 0x8d949c });
    const deckGeos = [], pileGeos = [];
    const m4 = new THREE.Matrix4();
    const push = (arr, geo, x, y, z, ry = 0) => {
      const g2 = geo.clone();
      m4.makeRotationY(ry); g2.applyMatrix4(m4);
      g2.translate(x, y, z);
      arr.push(g2);
    };

    this.piers = [];
    // три пирса, уходящие в воду с южной кромки карты
    for (const px of [-half * 0.55, 0, half * 0.55]) {
      const len = rand(46, 66), w = 9;
      const z0 = half + 6;
      const zc = z0 + len / 2;
      push(deckGeos, new THREE.BoxGeometry(w, 0.5, len), px, 0.3, zc);
      for (let t = 0; t <= len; t += 7) {
        for (const sx of [-w / 2 + 0.7, w / 2 - 0.7]) {
          push(pileGeos, new THREE.CylinderGeometry(0.35, 0.4, 4.6, 6), px + sx, -1.6, z0 + t);
        }
      }
      // ходить по пирсу можно, но с него не свалиться в текстуру: борта
      this.addCollider(px - w / 2 - 0.4, z0, px - w / 2, z0 + len, 1.1);
      this.addCollider(px + w / 2, z0, px + w / 2 + 0.4, z0 + len, 1.1);
      this.piers.push({ x: px, z: zc, w, len });
    }

    // мост на островок с маяком (северная сторона)
    const bx = -half * 0.2;
    const bz0 = -half - 4, bLen = 78;
    push(deckGeos, new THREE.BoxGeometry(11, 0.6, bLen), bx, 0.3, bz0 - bLen / 2);
    for (let t = 6; t < bLen; t += 12) {
      for (const sx of [-4.6, 4.6]) {
        push(pileGeos, new THREE.CylinderGeometry(0.4, 0.45, 5.2, 6), bx + sx, -1.9, bz0 - t);
        // перила
        push(pileGeos, new THREE.BoxGeometry(0.25, 1.5, 0.25), bx + sx, 1.3, bz0 - t);
      }
    }
    for (const sx of [-4.6, 4.6]) {
      push(deckGeos, new THREE.BoxGeometry(0.2, 0.22, bLen), bx + sx, 2.0, bz0 - bLen / 2);
    }
    this.addCollider(bx - 5.9, bz0 - bLen, bx - 5.2, bz0, 1.6);
    this.addCollider(bx + 5.2, bz0 - bLen, bx + 5.9, bz0, 1.6);

    // сам островок
    const isleZ = bz0 - bLen - 16;
    const isle = new THREE.Mesh(new THREE.CylinderGeometry(22, 26, 2.4, 20),
      new THREE.MeshLambertMaterial({ color: 0x4a5540 }));
    isle.position.set(bx, 0.1, isleZ);
    isle.receiveShadow = true;
    this.scene.add(isle);

    // маяк
    const towerH = 22;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.4, towerH, 12),
      new THREE.MeshLambertMaterial({ color: 0xe8e4dc }));
    tower.position.set(bx, towerH / 2 + 1.2, isleZ);
    tower.castShadow = true;
    this.scene.add(tower);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.6, 3.4, 12),
      new THREE.MeshLambertMaterial({ color: 0xc23b32 }));
    band.position.set(bx, towerH * 0.62, isleZ);
    this.scene.add(band);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.6, 10), lampMat);
    lamp.position.set(bx, towerH + 2.0, isleZ);
    this.scene.add(lamp);
    this.addCollider(bx - 3.4, isleZ - 3.4, bx + 3.4, isleZ + 3.4, towerH);
    this.lighthouse = { x: bx, z: isleZ, lamp, mat: lampMat, y: towerH + 2.0 };
    this.islandSpot = { x: bx, z: isleZ + 12 };

    if (deckGeos.length) {
      const deck = new THREE.Mesh(City.mergeGeos(deckGeos), woodMat);
      deck.castShadow = true; deck.receiveShadow = true;
      this.scene.add(deck);
    }
    if (pileGeos.length) {
      const piles = new THREE.Mesh(City.mergeGeos(pileGeos), pileMat);
      piles.castShadow = true;
      this.scene.add(piles);
    }

    // пришвартованные лодки у пирсов
    const boatBody = new THREE.MeshLambertMaterial({ color: 0xb8c0c8 });
    this.boats = [];
    for (const pier of this.piers) {
      for (const side of [-1, 1]) {
        // у каждого пирса всегда есть хотя бы одна лодка (side === -1),
        // вторая — по случаю: иначе набережная иногда выходила пустой
        if (side === 1 && Math.random() < 0.45) continue;
        const bxx = pier.x + side * (pier.w / 2 + 2.6);
        const bzz = pier.z + rand(-pier.len * 0.3, pier.len * 0.3);
        const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 7.4), boatBody);
        hull.position.set(bxx, -0.5, bzz);
        hull.castShadow = true;
        this.scene.add(hull);
        const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.4, 2.4), steelMat);
        cab.position.set(bxx, 0.7, bzz - 1.2);
        this.scene.add(cab);
        this.boats.push({ hull, cab, phase: rand(0, 6.3), y0: -0.5 });
      }
    }
  }

  // лёгкое покачивание лодок и мигание маяка
  updateWaterfront(t, night = 0) {
    if (this.boats) {
      for (const b of this.boats) {
        const bob = Math.sin(t * 1.2 + b.phase) * 0.16;
        b.hull.position.y = b.y0 + bob;
        b.cab.position.y = b.y0 + 1.2 + bob;
        b.hull.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.05;
        b.cab.rotation.z = b.hull.rotation.z;
      }
    }
    if (this.lighthouse) {
      const on = (Math.sin(t * 1.6) > 0.2) ? 1 : 0.15;
      this.lighthouse.mat.color.setRGB(1, 0.91 * on + 0.05, 0.66 * on + 0.05);
    }
  }

  assignDistricts() {
    const N = CITY.N;
    for (let i = 0; i < N - 1; i++) {
      this.districtGrid[i] = [];
      for (let j = 0; j < N - 1; j++) {
        const cx = (i - (N - 2) / 2) / ((N - 1) / 2);
        const cz = (j - (N - 2) / 2) / ((N - 1) / 2);
        const d = Math.hypot(cx, cz);
        let type;
        if (d < 0.32) type = 'downtown';
        else if (d < 0.62) type = 'commercial';
        else if (cx < -0.55 || cz < -0.6) type = 'industrial';
        else if (cx > 0.6 && cz > 0.45) type = 'docks';
        else type = 'suburb';
        this.districtGrid[i][j] = type;
      }
    }
  }

  buildGround() {
    const g = new THREE.PlaneGeometry(CITY.SIZE + 80, CITY.SIZE + 80);
    const m = new THREE.MeshLambertMaterial({ color: 0x2f3a2b });
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.08;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.groundMat = m;
    this.ground = mesh;

    // ---- вода вокруг острова: живая, с волнами и бликами ----
    // Раньше это было плоское статичное кольцо одного цвета.
    const wg = new THREE.RingGeometry(CITY.HALF + 38, CITY.HALF + 520, 96, 14);
    const wm = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uDeep: { value: new THREE.Color(0x123048) },
        uShallow: { value: new THREE.Color(0x2f6d8c) },
        uSun: { value: new THREE.Color(0xfff0c0) },
        uNight: { value: 0 },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          vUv = uv;
          vec3 p = position;
          // две пересекающиеся волны дают неповторяющуюся рябь
          float w = sin(p.x * 0.055 + uTime * 1.1) * 0.5
                  + sin(p.y * 0.041 - uTime * 0.8) * 0.5
                  + sin((p.x + p.y) * 0.023 + uTime * 0.5) * 0.35;
          vWave = w;
          p.z += w * 0.75;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 uDeep, uShallow, uSun;
        uniform float uTime, uNight;
        varying vec2 vUv;
        varying float vWave;
        void main() {
          float m = clamp(vWave * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(uDeep, uShallow, m * 0.75);
          // блики на гребнях волн
          float crest = smoothstep(0.55, 1.0, m);
          col += uSun * crest * 0.35 * (1.0 - uNight * 0.8);
          col *= 1.0 - uNight * 0.55;
          gl_FragColor = vec4(col, 0.94);
        }`,
    });
    const water = new THREE.Mesh(wg, wm);
    water.rotation.x = -Math.PI / 2;
    water.position.y = -1.2;
    water.frustumCulled = false;
    this.scene.add(water);
    this.waterMat = wm;
    this.water = water;
  }

  // вызывается каждый кадр из Game
  // Мокрый асфальт в дождь: дорога/тротуар темнеют и получают холодный отлив.
  setWetness(w) {
    if (this._wetApplied === undefined) {
      this._wetApplied = -1;
      this._dryRoad = this.roadMat.color.clone();
      this._dryWalk = this.walkMat.color.clone();
      this._dryGround = this.groundMat.color.clone();
    }
    // Порог был рассчитан на резкую смену погоды. Теперь дождь стихает
    // плавно, шаг за кадр — тысячные, и при пороге 0.01 обновление
    // застревало: асфальт оставался мокрым насовсем.
    if (Math.abs(w - this._wetApplied) < 0.002) return;
    this._wetApplied = w;
    this.roadMat.color.copy(this._dryRoad).multiplyScalar(1 - w * 0.42);
    this.walkMat.color.copy(this._dryWalk).multiplyScalar(1 - w * 0.3);
    this.groundMat.color.copy(this._dryGround).multiplyScalar(1 - w * 0.22);
    this.roadMat.color.b = Math.min(1, this.roadMat.color.b * (1 + w * 0.22));
  }

  updateWater(dt, night = 0) {
    if (!this.waterMat || !this.waterMat.uniforms) return;
    this.waterMat.uniforms.uTime.value += dt;
    this.waterMat.uniforms.uNight.value = night;
  }

  // ВАЖНО: переносим и uv. Раньше слияние копировало только position/normal,
  // и у дороги с тротуаром не оставалось UV вообще — текстуру наложить было
  // не на что, материал рисовался плоским цветом. Выглядело это как «текстуры
  // не подключены», хотя файлы грузились и тайлинг считался правильно: всё
  // терялось здесь, на последнем шаге.
  static mergeGeos(geos) {
    let vCount = 0, iCount = 0;
    for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : 0; }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const uv = new Float32Array(vCount * 2);
    const idx = new Uint32Array(iCount);
    let vo = 0, io = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, vo * 3);
      nor.set(g.attributes.normal.array, vo * 3);
      // Геометрия без uv (такие в наборе встречаются) не должна ломать слияние:
      // оставляем ей нули — на неё всё равно не кладут текстуру.
      if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
      const gi = g.index.array;
      for (let k = 0; k < gi.length; k++) idx[io + k] = gi[k] + vo;
      vo += g.attributes.position.count;
      io += gi.length;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }

  buildRoads() {
    const N = CITY.N, W = CITY.ROAD_W, SW = CITY.SIDEWALK;
    const len = CITY.SIZE + W;
    const roadGeos = [], walkGeos = [], lineGeos = [], crossGeos = [];

    // Плитка текстуры на дороге/тротуаре, мировых юнитов на один повтор.
    // PlaneGeometry/BoxGeometry всегда дают UV 0..1 на всю грань независимо
    // от её реального размера. Единый repeat на текстуре (было раньше) на
    // разных по форме сегментах давал то ×40, то ×0.4 повторов — на узких
    // гранях текстура схлопывалась в кашу, а mip-мапы усредняли её в плоское
    // пятно. Растягиваем UV пропорционально фактическому размеру грани —
    // так повтор текстуры одинаковый везде на одной поверхности.
    //
    // TILE_ROAD крупнее, чем казалось бы нужно: у асфальта нет своего
    // «правильного» физического размера пятна, а на обычной игровой
    // дистанции (не сверху вниз) мелкое зерно всё равно съедают mip-мапы —
    // крупная плитка держит те же самые пятна/трещины крупнее на экране,
    // и mip-уровень требуется ниже. Тротуар — TILE_WALK поменьше: плитка
    // текстуры там видимые плиты мощения, у них есть ожидаемый реальный
    // размер (соразмерно шагу), крупнить их так же сильно — исказить.
    // Тротуар: в текстуре 4x4 плиты, реальная плита ~0.9 м — отсюда 3.6 м
    // на повтор. Асфальт: своего «правильного» размера у него нет, берём
    // покрупнее, чтобы зерно на удалении не сыпалось в муар.
    const TILE_ROAD = 14;
    const TILE_WALK = 3.6;
    const retileUV = (g, sx, sz) => {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sz);
      uv.needsUpdate = true;
      return g;
    };
    const quad = (w, h, x, z, y = 0) => {
      const g = new THREE.PlaneGeometry(w, h);
      retileUV(g, w / TILE_ROAD, h / TILE_ROAD);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      return g;
    };

    for (let i = 0; i < N; i++) {
      const p = gridToWorld(i);
      roadGeos.push(quad(W, len, p, 0, 0));
      roadGeos.push(quad(len, W, 0, p, 0));
      const dash = 4.2, gap = 5.4;
      for (let t = -CITY.HALF; t < CITY.HALF; t += dash + gap) {
        let inCross = false;
        for (let k = 0; k < N; k++) {
          if (Math.abs(t + dash / 2 - gridToWorld(k)) < W / 2 + 3) { inCross = true; break; }
        }
        if (inCross) continue;
        lineGeos.push(quad(0.4, dash, p, t + dash / 2, 0.02));
        lineGeos.push(quad(dash, 0.4, t + dash / 2, p, 0.02));
      }
      // crosswalk stripes at every intersection
      for (let k = 0; k < N; k++) {
        const q = gridToWorld(k);
        for (let s = -1; s <= 1; s += 2) {
          for (let b = -3; b <= 3; b++) {
            crossGeos.push(quad(1.0, 3.4, p + b * 2.1, q + s * (W / 2 - 2.0), 0.03));
            crossGeos.push(quad(3.4, 1.0, p + s * (W / 2 - 2.0), q + b * 2.1, 0.03));
          }
        }
      }
    }

    // Тротуар: ВЕРХНЯЯ плита и ОТДЕЛЬНО вертикальная грань бордюра.
    //
    // Раньше это был единый бокс, и его боковые грани получали ту же
    // текстуру тротуарной плитки, растянутую на 30 сантиметров высоты.
    // Со стороны дороги это читалось не бордюром, а полосой-накладкой:
    // у настоящего бордюра своя фактура и свои швы, и они вертикальные.
    const kerbGeos = [];
    const TILE_KERB = 1.0;                 // один камень на метр
    const kerbFace = (len, x, z, ry) => {
      const g = new THREE.PlaneGeometry(len, CURB_H);
      retileUV(g, len / TILE_KERB, 1);
      g.rotateY(ry);
      g.translate(x, CURB_H / 2, z);
      return g;
    };
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) {
        const x0 = gridToWorld(i) + W / 2, x1 = gridToWorld(i + 1) - W / 2;
        const z0 = gridToWorld(j) + W / 2, z1 = gridToWorld(j + 1) - W / 2;
        const ww = x1 - x0 + SW * 2, wd = z1 - z0 + SW * 2;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

        const top = new THREE.PlaneGeometry(ww, wd);
        retileUV(top, ww / TILE_WALK, wd / TILE_WALK);
        top.rotateX(-Math.PI / 2);
        top.translate(cx, CURB_H, cz);
        walkGeos.push(top);

        kerbGeos.push(kerbFace(ww, cx, cz + wd / 2, 0));
        kerbGeos.push(kerbFace(ww, cx, cz - wd / 2, Math.PI));
        kerbGeos.push(kerbFace(wd, cx + ww / 2, cz, Math.PI / 2));
        kerbGeos.push(kerbFace(wd, cx - ww / 2, cz, -Math.PI / 2));
      }
    }

    // repeat здесь больше не нужен — тайлинг теперь в самих UV (retileUV выше),
    // общий на текстуре repeat умножал бы его ещё раз.
    // Дорога и тротуар уходят под острым углом почти в каждом кадре —
    // это единственные поверхности, которым анизотропия действительно нужна.
    const roadTex = TEX.load('road.jpg', { aniso: 16 });
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x9a9a9e, map: roadTex });
    // Рисованный тротуар вместо процедурного; если файла нет, TEX.load
    // молча отдаёт пустую текстуру, поэтому цвет держим светлым.
    const walkTex = TEX.load('sidewalk.jpg', { aniso: 16 });
    const walkMat = new THREE.MeshLambertMaterial({ color: 0xe8e8e2, map: walkTex });
    const lineMat = new THREE.MeshLambertMaterial({ color: 0xd8cf7a });
    const crossMat = new THREE.MeshLambertMaterial({ color: 0xcfcfc8 });

    const road = new THREE.Mesh(City.mergeGeos(roadGeos), roadMat);
    road.receiveShadow = true; this.scene.add(road);
    const walk = new THREE.Mesh(City.mergeGeos(walkGeos), walkMat);
    walk.receiveShadow = true; this.scene.add(walk);

    const kerbTex = TEX.load('kerb.jpg', { aniso: 8 });
    const kerbMat = new THREE.MeshLambertMaterial({ color: 0xbdbdb8, map: kerbTex });
    const kerb = new THREE.Mesh(City.mergeGeos(kerbGeos), kerbMat);
    kerb.receiveShadow = true; kerb.castShadow = true;
    this.scene.add(kerb);
    this.kerbMat = kerbMat;
    this.scene.add(new THREE.Mesh(City.mergeGeos(lineGeos), lineMat));
    this.scene.add(new THREE.Mesh(City.mergeGeos(crossGeos), crossMat));
    this.roadMat = roadMat; this.walkMat = walkMat;
  }

  buildGraph() {
    const N = CITY.N;
    for (let i = 0; i < N; i++) {
      this.nodeGrid[i] = [];
      for (let j = 0; j < N; j++) {
        const idx = this.nodes.length;
        this.nodes.push({ x: gridToWorld(i), z: gridToWorld(j), i, j, links: [] });
        this.nodeGrid[i][j] = idx;
      }
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const n = this.nodes[this.nodeGrid[i][j]];
        if (i > 0) n.links.push(this.nodeGrid[i - 1][j]);
        if (i < N - 1) n.links.push(this.nodeGrid[i + 1][j]);
        if (j > 0) n.links.push(this.nodeGrid[i][j - 1]);
        if (j < N - 1) n.links.push(this.nodeGrid[i][j + 1]);
      }
    }
  }

  buildBlocks() {
    const N = CITY.N, W = CITY.ROAD_W, SW = CITY.SIDEWALK;
    const grassTex = TEX.grass();
    grassTex.repeat.set(6, 6);
    const parkMat = new THREE.MeshLambertMaterial({ color: 0x788563, map: grassTex });
    this.blockRects = [];
    // Exactly twelve service lots, distributed across the city. Random fallback
    // used to overwrite an occupied block when the six-percent reserve ran out.
    const serviceLots = new Set(['1,1','1,4','1,7','3,2','3,7','5,1','5,6','7,2','7,5','8,8','8,4','4,8']);

    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) {
        const x0 = gridToWorld(i) + W / 2 + SW, x1 = gridToWorld(i + 1) - W / 2 - SW;
        const z0 = gridToWorld(j) + W / 2 + SW, z1 = gridToWorld(j + 1) - W / 2 - SW;
        const bw = x1 - x0, bh = z1 - z0;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        const dist = this.districtAt(i, j);
        this.blockRects.push({ i, j, x0, x1, z0, z1, cx, cz, district: dist });

        if (serviceLots.has(`${i},${j}`)) {
          (this.emptyLots ||= []).push({cx,cz,bw,bh});
          continue;
        }

        if ((i === 6 && j === 5) || Math.random() < (dist === 'suburb' ? 0.2 : dist === 'downtown' ? 0.07 : 0.12)) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.12, bh), parkMat);
          m.position.set(cx, 0.32, cz);
          m.receiveShadow = true;
          this.scene.add(m);
          this.parks.push({ x: cx, z: cz, w: bw, h: bh });
          continue;
        }

        const cols = bw > 40 && Math.random() < 0.65 ? 2 : 1;
        const rows = bh > 40 && Math.random() < 0.65 ? 2 : 1;
        for (let c = 0; c < cols; c++) {
          for (let r = 0; r < rows; r++) {
            const lw = bw / cols, lh = bh / rows;
            const lx = x0 + lw * (c + 0.5), lz = z0 + lh * (r + 0.5);
            const inset = rand(0.6, 2.6);
            const w = Math.max(7, lw - inset * 2);
            const d = Math.max(7, lh - inset * 2);
            this.addBuilding(lx, lz, w, d, dist);
          }
        }
      }
    }
  }

  /**
   * Бокс с цветом, записанным в вершины.
   *
   * Слить детали в один меш можно только с общим материалом, а козырьки и
   * вывески обязаны быть разного цвета — иначе улица выйдет одноцветной.
   * Цвет по вершинам решает и то, и другое разом.
   */
  static colorBox(w, h, d, x, y, z, color) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /**
   * Первый этаж и крыша.
   *
   * Дом был одной текстурированной коробкой: с уровня тротуара это глухая
   * стена без входа, а сверху — срезанный параллелепипед. Витрина с дверью
   * и козырьком даёт улице обжитость, парапет и техника на крыше убирают
   * ощущение «дом кончился, потому что закончилась текстура».
   *
   * Сторона выбирается по ближайшей дороге: витрина во двор смотреть не должна.
   */
  dressBuilding(x, z, w, d, h, districtId, tint) {
    const S = CITY.SPACING;
    const nearLine = (v) => gridToWorld(clamp(Math.round((v + CITY.HALF) / S), 0, CITY.N - 1));

    // Каждая из четырёх стен проверяется отдельно. Считать по центру дома
    // было проще, но крупный дом упирается в две-три улицы сразу, и по
    // центру он получал витрину только на одну — вдоль остальных тротуаров
    // тянулась глухая стена. Стена выходит на улицу, если дорога лежит
    // СНАРУЖИ от неё и не дальше тротуара с запасом.
    const REACH = CITY.ROAD_W / 2 + CITY.SIDEWALK + 5;
    const faces = [];
    for (const [axis, sign] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]]) {
      const wall = axis === 'z' ? z + sign * d / 2 : x + sign * w / 2;
      const line = nearLine(wall);
      const off = line - wall;
      if (Math.sign(off) !== sign) continue;       // дорога с изнанки стены
      if (Math.abs(off) > REACH) continue;         // до дороги слишком далеко
      faces.push({ axis, sign });
    }
    // Дом в глубине квартала не выходит ни на одну улицу — тогда наряжаем
    // ту сторону, что ближе всех: без входа он опять станет глухой коробкой.
    if (!faces.length) {
      const dz = z - nearLine(z), dx = x - nearLine(x);
      if (Math.abs(dz) <= Math.abs(dx)) faces.push({ axis: 'z', sign: -(Math.sign(dz) || 1) });
      else faces.push({ axis: 'x', sign: -(Math.sign(dx) || 1) });
    }

    // Куда в итоге смотрят витрины — записываем: проверить это глазами по
    // всему городу нельзя, а ошибка в знаке разворачивает их во двор целиком.
    this.shopFronts = this.shopFronts || [];

    // Всё убранство первого этажа отсчитывается от ВЕРХА ТРОТУАРА.
    // Раньше отсчёт шёл от нуля, а плита тротуара лежит на 0.3 м выше —
    // цоколь оказывался закопан в плитку, а стекло начиналось в пятнадцати
    // сантиметрах над ней. Именно это читалось как «панельки уходят под
    // текстуру асфальта».
    const G = CURB_H;

    const shoppy = districtId === 'commercial' || districtId === 'downtown';
    // Рама тёмная почти независимо от фасада. Просто притушенный оттенок
    // стены давал на светлом доме светло-серую раму, и весь первый этаж
    // сливался в одну блёклую полосу вместо витрины.
    const trim = new THREE.Color(tint).lerp(new THREE.Color(0x23262d), 0.74).getHex();
    const GF = Math.min(3.4, h * 0.55);

    for (const f of faces) {
      const alongW = f.axis === 'z' ? w : d;       // ширина этой стены
      const out = (f.axis === 'z' ? d : w) / 2;    // вынос от центра до стены
      this.shopFronts.push({
        bx: x, bz: z,
        fx: f.axis === 'z' ? x : x + f.sign * out,
        fz: f.axis === 'z' ? z + f.sign * out : z,
      });
      // Локальные координаты: u — вдоль стены, v — наружу от неё.
      const put = (uw, hh, vd, u, y, v, color, into = this.detailGeos) => {
        const g = f.axis === 'z'
          ? City.colorBox(uw, hh, vd, x + u, y, z + f.sign * (out + v), color)
          : City.colorBox(vd, hh, uw, x + f.sign * (out + v), y, z + u, color);
        into.push(g);
      };

      // цоколь во всю стену — граница между улицей и домом
      put(alongW, 0.45, 0.3, 0, G + 0.22, 0.08, trim);
      // Витрина разбита на секции. Одно стекло во всю стену ночью читалось
      // сплошной светящейся лентой вдоль квартала — не магазины, а лампа
      // дневного света. Секции по ~6 м с простенками между ними, и яркость
      // у каждой своя: часть заведений закрыта, часть работает.
      const gh = GF * 0.74;
      const units = Math.max(1, Math.round(alongW / 6));
      const span = alongW * 0.86 / units;
      const gap = 0.45;
      // Глубина выкладки. Стекло выносим вперёд на эту величину, и между
      // ним и стеной появляется место под товар. Раньше стекло лежало прямо
      // на стене и за ним была пустота — с тротуара витрина читалась чёрной
      // дырой в доме. Врезать нишу внутрь нельзя: фасад — цельный бокс.
      const BAY = 0.18;
      for (let u = 0; u < units; u++) {
        const uw = Math.max(1.2, span - gap);
        const cu = -alongW * 0.43 + span * (u + 0.5);
        // Яркость печём в вершины: свет включён у одних и выключен у других,
        // а меш всё равно остаётся один на весь город.
        const k = 0.80 + (Math.sin(x * 0.13 + z * 0.19) + 1) * 0.08;
        const col = new THREE.Color(k, k, k).getHex();
        const g = f.axis === 'z'
          ? City.colorBox(uw, gh, 0.1, x + cu, G + 0.45 + gh / 2, z + f.sign * (out + BAY), col)
          : City.colorBox(0.1, gh, uw, x + f.sign * (out + BAY), G + 0.45 + gh / 2, z + cu, col);
        this.shopGeos.push(g);

        // Начинка идёт в общий меш ДЕТАЛЕЙ, а не витрин: значит её освещает
        // сцена. Днём видно, что стоит внутри, ночью предметы превращаются
        // в тёмные силуэты на фоне горящего стекла — ровно как в жизни.
        // Заднюю стенку рисуем, а не строим: интерьер магазина коробками
        // не изобразить. Ячейка атласа выбирается случайно — по улице идут
        // разные заведения, а не один и тот же зал шесть раз подряд.
        const ry = f.axis === 'z' ? (f.sign > 0 ? 0 : Math.PI)
          : (f.sign > 0 ? Math.PI / 2 : -Math.PI / 2);
        const bx = f.axis === 'z' ? x + cu : x + f.sign * (out + 0.04);
        const bz = f.axis === 'z' ? z + f.sign * (out + 0.04) : z + cu;
        this.shopBackGeos.push(City.shopBackGeo(uw, gh, bx, G + 0.45 + gh / 2, bz, ry, Math.abs(Math.floor(x / 20 + z / 20)) % 6));
        put(uw, 0.07, BAY, cu, G + 0.44, BAY / 2, 0x3a3833);        // пол
        // Козырёк над нишей: закрывает её сверху и даёт настоящую тень
        // внутри, а не равномерную засветку от полусферы.
        put(uw + 0.1, 0.12, BAY + 0.06, cu, G + 0.45 + gh + 0.06, (BAY + 0.06) / 2, trim);
        // Один почти чёрный предмет перед рисованной стенкой — ради
        // параллакса. Цвет намеренно на грани силуэта: освещённый солнцем
        // ящик средней светлоты перекрывал нарисованный интерьер белой
        // плитой и портил ровно то, ради чего интерьер и рисовался.
        // при движении вдоль витрины он смещается относительно картинки,
        // и ниша перестаёт читаться наклейкой.
        // простенок между секциями
        if (u < units - 1) put(gap, gh + 0.2, BAY + 0.2, cu + span / 2, G + 0.45 + gh / 2, (BAY + 0.2) / 2, trim);
      }
      // рама вокруг стекла
      put(alongW, 0.3, 0.28, 0, G + 0.45 + gh + 0.15, 0.06, trim);
      // дверь с краю
      const doorU = -alongW / 2 + Math.min(2.2, alongW * 0.18);
      put(1.15, 2.15, 0.08, doorU, G + 1.07, 0.28, 0x1c1f26);
      put(1.35, 0.16, 0.3, doorU, G + 2.22, 0.28, trim);
      put(0.035, 0.34, 0.06, doorU + 0.38, G + 1.05, 0.35, 0xa3a29b);

      if (shoppy && Math.random() < 0.85) {
        // Козырёк и вывеска — единственное цветное пятно на уровне глаз.
        // Козырёк вынесен на 1.2 м: он должен класть тень на тротуар,
        // иначе на плоском фасаде его просто не замечаешь.
        const accent = pick(AWNING);
        put(alongW * 0.82, 0.16, 1.2, 0, G + GF + 0.05, 0.6, accent);
        if (Math.random() < 0.7) put(alongW * 0.55, 0.75, 0.18, 0, G + GF + 0.7, 0.09, accent);
      }
    }

  }

  /** Слить задние стенки витрин в один меш с атласом интерьеров. */
  finishShopBacks() {
    if (!this.shopBackGeos.length) return;
    const map = TEX.load('shop_interiors.jpg', { repeat: [1, 1] });
    const mat = new THREE.MeshLambertMaterial({
      map,
      // Свечение ОБЯЗАНО идти через ту же карту. Ровное свечение по всему
      // материалу поднимало и тёмные углы зала, интерьер расплющивало в
      // однородное пятно, и первый этаж переставал отличаться от окон
      // верхних. С emissiveMap светятся лампы и светлый товар, а тени
      // внутри остаются тенями.
      emissiveMap: map,
      emissive: new THREE.Color(0x000000),
    });
    this.shopInteriorMat = mat;
    const mesh = new THREE.Mesh(mergeGeometries(this.shopBackGeos, false), mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.shopBackGeos.length = 0;
  }

  /** Слить накопленные детали в два меша и отдать сцене. */
  finishDetails() {
    if (this.detailGeos.length) {
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(mergeGeometries(this.detailGeos, false), mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.detailGeos.length = 0;
    }
    if (this.shopGeos.length) {
      // Витрины ночью светятся — тем же способом, что окна верхних этажей.
      // vertexColors несёт «включён ли свет» в конкретной секции, а color
      // материала — общую яркость по времени суток; они перемножаются.
      // Стекло стало полупрозрачным: за ним теперь есть что показывать.
      // Непрозрачное имело смысл, пока витрина была просто тёмной панелью.
      const mat = new THREE.MeshBasicMaterial({
        color: 0x11151c, vertexColors: true,
        transparent: true, opacity: 0.45, depthWrite: false });
      this.shopMat = mat;
      const mesh = new THREE.Mesh(mergeGeometries(this.shopGeos, false), mat);
      this.scene.add(mesh);
      this.shopGeos.length = 0;
    }
  }

  /**
   * Коробка секции фасада для СЛИЯНИЯ.
   *
   * Тайлинг больше нельзя держать в texture.repeat, а оттенок — в
   * material.color: текстура и материал теперь одни на весь тип застройки.
   * Поэтому масштаб UV запекается в геометрию, а цвет — в вершины.
   */
  static facadeGeo(w, h, d, x, y, z, repeatX, repeatY, tint) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    // Смещение на целые плитки: маска горящих окон одна на тип застройки,
    // и без сдвига соседние дома светились бы одинаковым узором. Целое
    // число плиток — чтобы шов текстуры не поехал по стене.
    const ou = Math.floor(Math.random() * 4);
    const ov = Math.floor(Math.random() * 4);
    for (let i = 0; i < uv.count; i++) {
      // BoxGeometry: ±X faces use depth, ±Z faces use width. A shared U
      // repeat stretched side-wall windows on long, narrow buildings.
      const sideRepeat = i < 8 ? repeatX * d / w : repeatX;
      uv.setXY(i, uv.getX(i) * sideRepeat + ou, uv.getY(i) * repeatY + ov);
    }
    g.translate(x, y, z);
    const c = new THREE.Color(tint);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  }

  /**
   * Задняя стенка витрины с НАРИСОВАННЫМ интерьером.
   *
   * Коробками внутри ниши магазин не изобразить — выходят серые ящики.
   * Шесть интерьеров лежат одним атласом 3x2, поэтому все витрины города
   * остаются ОДНИМ мешем с одной текстурой. UV поджимаем внутрь ячейки:
   * без этого билинейная фильтрация и мипмапы затягивают в кадр соседний
   * магазин по краям.
   */
  static shopBackGeo(w, h, x, y, z, ry, cell) {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    const col = cell % 3, row = Math.floor(cell / 3);
    const e = 0.02;
    for (let i = 0; i < uv.count; i++) {
      const u = e + uv.getX(i) * (1 - e * 2);
      const v = e + uv.getY(i) * (1 - e * 2);
      uv.setXY(i, (col + u) / 3, (row + v) / 2);
    }
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return g;
  }

  /**
   * Геометрия из списка треугольников с цветом в вершинах.
   *
   * Набор атрибутов и индексация обязаны СОВПАДАТЬ с BoxGeometry, рядом с
   * которой это будет слито: mergeGeometries на разнородном списке молча
   * возвращает null, и падение вылезает потом в чужом месте.
   */
  static tris(list, color) {
    const g = new THREE.BufferGeometry();
    const n = list.length / 3;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(list), 3));
    const c = new THREE.Color(color);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    const idx = new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return g;
  }

  /**
   * Двускатная крыша. Порядок обхода вершин выбран так, чтобы нормали
   * смотрели наружу: при обратном обходе скат просто не рисуется.
   */
  static prism(w, h, d, x, y, z, color, alongX = true) {
    // Конёк строится вдоль X, а для дома, вытянутого по Z, призма
    // поворачивается на 90°. Поворот МЕНЯЕТ ГАБАРИТЫ МЕСТАМИ, поэтому
    // строить надо заранее наоборот: иначе у длинного узкого дома крыша
    // выходила поперёк и висела над кварталом, вылезая на половину длины.
    const bw = alongX ? w : d;
    const bd = alongX ? d : w;
    const hw = bw / 2, hd = bd / 2;
    const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
    const E = [-hw, h, 0], F = [hw, h, 0];
    const v = [];
    const t = (...p) => { for (const q of p) v.push(q[0], q[1], q[2]); };
    t(A, F, B); t(A, E, F);      // скат к -z
    t(C, E, D); t(C, F, E);      // скат к +z
    t(A, D, E);                  // торец -x
    t(B, F, C);                  // торец +x
    const g = City.tris(v, color);
    if (!alongX) g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    return g;
  }

  /** Шатёр: четыре ската к вершине. */
  static pyramid(w, h, d, x, y, z, color) {
    const hw = w / 2, hd = d / 2;
    const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
    const P = [0, h, 0];
    const v = [];
    const t = (...p) => { for (const q of p) v.push(q[0], q[1], q[2]); };
    t(A, P, B); t(C, P, D); t(D, P, A); t(B, P, C);
    const g = City.tris(v, color);
    g.translate(x, y, z);
    return g;
  }

  /**
   * Массинг: из чего складывается силуэт дома.
   *
   * Каждый дом был одним параллелепипедом с плоской крышей, и панорама
   * города читалась гистограммой. Теперь дом собирается из секций разной
   * высоты и площади, а верх получает завершение. Все секции остаются
   * ВНУТРИ исходной подошвы: вылезая за неё, они залезли бы на тротуар,
   * где стоят витрины, фонари и ходят люди.
   */
  massing(x, z, w, d, h, districtId) {
    const S = [];
    const add = (sx, sz, sw, sd, y0, sh, roof) =>
      S.push({ x: sx, z: sz, w: sw, d: sd, y0, h: sh, roof: roof || 'flat' });
    const r = Math.random();
    const small = Math.min(w, d);
    const alongX = w >= d;
    // Две секции бок о бок по длинной стороне.
    const split = (frac) => (alongX
      ? [[x - w * (1 - frac) / 2, z, w * frac, d], [x + w * frac / 2, z, w * (1 - frac), d]]
      : [[x, z - d * (1 - frac) / 2, w, d * frac], [x, z + d * frac / 2, w, d * (1 - frac)]]);

    if (districtId === 'suburb') {
      // Скатная крыша — главное, чем окраина отличается от центра. Плоские
      // семиметровые коробки читались складами, а не жильём.
      add(x, z, w, d, 0, h, small > 9 && r < 0.78 ? 'gable' : 'hip');
      return S;
    }

    if (districtId === 'industrial' || districtId === 'docks') {
      if (r < 0.4 && small > 12) {
        const ab = split(rand(0.35, 0.5));
        add(ab[0][0], ab[0][1], ab[0][2], ab[0][3], 0, h * rand(0.55, 0.8), 'flat');
        add(ab[1][0], ab[1][1], ab[1][2], ab[1][3], 0, h, Math.random() < 0.35 ? 'gable' : 'flat');
        return S;
      }
      add(x, z, w, d, 0, h, r < 0.55 ? 'gable' : 'flat');
      return S;
    }

    // Центр и деловой квартал
    if (districtId === 'downtown' && r < 0.05 && small > 16) {
      // Доминанта: стилобат, ствол, корона со шпилем. Редкая — на то и доминанта.
      const th = h * rand(1.5, 2.1);
      add(x, z, w, d, 0, h * 0.16, 'flat');
      add(x, z, w * 0.62, d * 0.62, h * 0.16, th * 0.72, 'flat');
      add(x, z, w * 0.4, d * 0.4, h * 0.16 + th * 0.72, th * 0.22, 'crown');
      return S;
    }
    if (r < 0.34 && small > 13) {
      // Уступы: классический «свадебный торт», два-три объёма вверх.
      const steps = r < 0.14 ? 3 : 2;
      let y = 0, cw = w, cd = d, left = h;
      for (let i = 0; i < steps; i++) {
        const part = i === steps - 1 ? left : left * rand(0.4, 0.6);
        add(x, z, cw, cd, y, part,
          i === steps - 1 && Math.random() < 0.4 ? 'crown' : 'flat');
        y += part; left -= part;
        cw *= rand(0.66, 0.82); cd *= rand(0.66, 0.82);
      }
      return S;
    }
    if (r < 0.54 && small > 15) {
      // Башня на стилобате: широкое основание в два-три этажа и узкий ствол.
      const ph = Math.max(6, h * rand(0.14, 0.22));
      const off = rand(-0.12, 0.12);
      add(x, z, w, d, 0, ph, 'flat');
      add(x + w * off, z + d * off, w * rand(0.5, 0.7), d * rand(0.5, 0.7),
        ph, h - ph, Math.random() < 0.35 ? 'crown' : 'flat');
      return S;
    }
    if (r < 0.7 && small > 12) {
      // Два объёма разной высоты в одной подошве.
      const ab = split(rand(0.38, 0.55));
      add(ab[0][0], ab[0][1], ab[0][2], ab[0][3], 0, h * rand(0.5, 0.78), 'flat');
      add(ab[1][0], ab[1][1], ab[1][2], ab[1][3], 0, h, 'flat');
      return S;
    }
    add(x, z, w, d, 0, h, 'flat');
    return S;
  }

  /** Завершение секции: парапет, скат, шатёр или корона. */
  roofOf(sec, tint) {
    const x = sec.x, z = sec.z, w = sec.w, d = sec.d;
    const top = sec.y0 + sec.h;
    const par = new THREE.Color(tint).multiplyScalar(0.72).getHex();
    const dark = new THREE.Color(tint).lerp(new THREE.Color(0x3a3026), 0.72).getHex();

    // Высота ската считалась от подошвы: у склада 40x40 выходила крыша в
    // восемнадцать метров на девятиметровых стенах — гигантский скат во
    // весь экран. У настоящей кровли высота от 1.5 до 5 м независимо от
    // того, насколько велик дом.
    if (sec.roof === 'gable') {
      const rh = clamp(Math.min(w, d) * rand(0.3, 0.45), 1.6, 4.8);
      this.detailGeos.push(City.prism(w + 0.5, rh, d + 0.5, x, top, z, dark, w >= d));
      return;
    }
    if (sec.roof === 'hip') {
      const rh = clamp(Math.min(w, d) * rand(0.32, 0.5), 1.6, 5.2);
      this.detailGeos.push(City.pyramid(w + 0.5, rh, d + 0.5, x, top, z, dark));
      return;
    }
    if (sec.roof === 'crown') {
      // Ступенчатая корона: три убывающих пояса и шпиль. Именно она делает
      // из прямоугольного ствола силуэт, а не обрубок.
      let cw = w, cd = d, y = top;
      for (let i = 0; i < 3; i++) {
        const th = rand(0.7, 1.4);
        this.detailGeos.push(City.colorBox(cw, th, cd, x, y + th / 2, z, i % 2 ? par : dark));
        y += th; cw *= 0.78; cd *= 0.78;
      }
      const sh = Math.min(w, d) * rand(0.8, 1.6);
      this.detailGeos.push(City.colorBox(cw * 0.3, sh, cd * 0.3, x, y + sh / 2, z, dark));
      return;
    }

    // плоская: парапет по кромке плюс техника
    const t = 0.3, ph = 0.55;
    this.detailGeos.push(City.colorBox(w, ph, t, x, top + ph / 2, z + d / 2 - t / 2, par));
    this.detailGeos.push(City.colorBox(w, ph, t, x, top + ph / 2, z - d / 2 + t / 2, par));
    this.detailGeos.push(City.colorBox(t, ph, d - t * 2, x + w / 2 - t / 2, top + ph / 2, z, par));
    this.detailGeos.push(City.colorBox(t, ph, d - t * 2, x - w / 2 + t / 2, top + ph / 2, z, par));
    // Оборудование на крыше. Серые коробки читались крышей «чем-нибудь
    // застроено», но с высоты и из вертолёта видно, что это заглушки.
    // Настоящие водонапорка, бак, антенна, тарелка и вытяжка узнаются
    // силуэтом; коробки остаются как рядовые кондиционерные блоки.
    this.roofProps = this.roofProps || [];
    const room = Math.min(w, d);
    const units = randInt(1, 3);
    for (let i = 0; i < units; i++) {
      const px = x + rand(-w / 2 + 2, w / 2 - 2);
      const pz = z + rand(-d / 2 + 2, d / 2 - 2);
      const roll = Math.random();
      if (room > 12 && roll < 0.18) {
        this.roofProps.push({ slot: 'watertower', x: px, y: top, z: pz, rot: rand(0, 6.28), s: rand(0.85, 1.15) });
      } else if (room > 9 && roll < 0.34) {
        this.roofProps.push({ slot: 'watertank', x: px, y: top, z: pz, rot: rand(0, 6.28), s: rand(0.9, 1.25) });
      } else if (roll < 0.48) {
        this.roofProps.push({ slot: 'antenna', x: px, y: top, z: pz, rot: rand(0, 6.28), s: rand(0.8, 1.3) });
      } else if (roll < 0.62) {
        this.roofProps.push({ slot: 'satdish', x: px, y: top, z: pz, rot: rand(0, 6.28), s: rand(0.9, 1.4) });
      } else if (roll < 0.76) {
        this.roofProps.push({ slot: 'roofvent', x: px, y: top, z: pz, rot: rand(0, 6.28), s: rand(0.9, 1.3) });
      } else {
        const uw = rand(1.2, Math.min(4, w * 0.3));
        const ud = rand(1.2, Math.min(4, d * 0.3));
        const uh = rand(0.8, 2.4);
        this.detailGeos.push(City.colorBox(uw, uh, ud, px, top + uh / 2, pz,
          pick([0x8d9298, 0x7a8086, 0x9aa0a6])));
      }
    }
  }

  /** Собрать оборудование крыш в инстансы: по мешу на слот. */
  finishRoofProps() {
    const list = this.roofProps || [];
    if (!list.length) return;
    const bySlot = {};
    for (const p of list) (bySlot[p.slot] = bySlot[p.slot] || []).push(p);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const slot in bySlot) {
      const parts = MODELS.bakedParts(slot);
      if (!parts) continue;                       // модель не загрузилась — просто без неё
      const items = bySlot[slot];
      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        items.forEach((p, i) => {
          q.setFromAxisAngle(yAxis, p.rot);
          m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
          inst.setMatrixAt(i, m4);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true;
        this.scene.add(inst);
      }
    }
    this.roofProps = [];
  }

  addBuilding(x, z, w, d, districtId) {
    const D = DISTRICTS[districtId] || DISTRICTS.suburb;
    const h = rand(D.minH, D.maxH) * rand(0.85, 1.1);
    const color = pick(D.colors);
    // Фасад по району и высоте: стекло — только высоткам делового центра,
    // склады — докам и промзоне, кирпич — старой малоэтажке.
    // Явная таблица весов по району и этажности. Раньше ветки if/else
    // делили одно и то же случайное число, и бетон получал 0.4% домов.
    const lowRise = h < 26;
    const TEXES = {
      warehouse: { file: 'facade_warehouse.jpg', tint: 0xf2f0e8, texH: 11 },
      glass:     { file: 'facade_glass.jpg',     tint: 0xeef2f5, texH: 13 },
      concrete:  { file: 'facade_concrete.jpg',  tint: 0xf0eee8, texH: 12 },
      brick:     { file: 'facade_brick.jpg',     tint: 0xf5ece4, texH: 9 },
      plain:     { file: 'facade.jpg',           tint: color,    texH: 9 },
      // Два новых типа добавлены против однообразия: на весь город было
      // пять текстур, и в панораме кварталы повторялись узнаваемо.
      stone:     { file: 'facade_stone.jpg',     tint: 0xf2efe6, texH: 12 },
      panel:     { file: 'facade_panel.jpg',     tint: 0xeeeae2, texH: 12 },
    };
    const WEIGHTS = {
      downtown:   lowRise ? { concrete: 3, plain: 2, brick: 2, glass: 2, stone: 3, panel: 2 }
                          : { glass: 5, concrete: 3, plain: 1, stone: 3, panel: 3 },
      commercial: lowRise ? { plain: 3, brick: 3, concrete: 2, glass: 1, stone: 2, panel: 2 }
                          : { glass: 3, concrete: 2, plain: 2, stone: 2, panel: 3 },
      industrial: lowRise ? { warehouse: 6, brick: 2, concrete: 2 }
                          : { concrete: 5, warehouse: 3, plain: 2 },
      suburb:     lowRise ? { brick: 6, plain: 3, concrete: 1 }
                          : { concrete: 4, brick: 3, plain: 3 },
      docks:      lowRise ? { warehouse: 7, concrete: 2, brick: 1 }
                          : { warehouse: 4, concrete: 4, plain: 2 },
    };
    const table = WEIGHTS[districtId] || WEIGHTS.suburb;
    let wSum = 0;
    for (const k in table) wSum += table[k];
    let roll = Math.random() * wSum;
    let key = 'plain';
    for (const k in table) { roll -= table[k]; if (roll <= 0) { key = k; break; } }
    const def = TEXES[key];
    const texName = def.file, tint = def.tint, texH = def.texH;
    const grid = WINDOW_GRID[texName];
    // Сливаем не весь город в один меш, а каждую зону отдельно: единый меш
    // на 680 метров нельзя отсечь по пирамиде видимости, и город целиком
    // уходил бы и в основной проход, и в карту теней каждый кадр.
    const bin = `${texName}|${this.regionOf(x, z)}`;
    if (!this.facadeGeos[bin]) this.facadeGeos[bin] = [];

    const sections = this.massing(x, z, w, d, h, districtId);
    for (const sec of sections) {
      const repeatX = sec.w / (grid ? grid[0] * 2.1 : texH);
      const repeatY = sec.h / (grid ? grid[1] * 3.2 : texH);
      this.facadeGeos[bin].push(City.facadeGeo(sec.w, sec.h, sec.d,
        sec.x, sec.y0 + sec.h / 2, sec.z, repeatX, repeatY, tint));
      this.roofOf(sec, tint);

      const top = sec.y0 + sec.h;
      this.addCollider(sec.x - sec.w / 2, sec.z - sec.d / 2,
        sec.x + sec.w / 2, sec.z + sec.d / 2, top);
      // По секции на запись: билборды, неон и посылки на крышах должны
      // ложиться на настоящую высоту своей секции, а не на общий максимум.
      this.buildings.push({ x: sec.x, z: sec.z, w: sec.w, d: sec.d, h: top, district: districtId });
    }

    this.dressBuilding(x, z, w, d, sections[0].h, districtId, tint);
  }

  /** Номер зоны 3x3, по которой режется слияние фасадов. */
  regionOf(x, z) {
    const t = CITY.HALF * 2;
    const i = clamp(Math.floor((x + CITY.HALF) / t * 3), 0, 2);
    const j = clamp(Math.floor((z + CITY.HALF) / t * 3), 0, 2);
    return j * 3 + i;
  }

  /** Слить накопленные фасады и окна: по мешу на корзину. */
  finishFacades() {
    const yAxis = new THREE.Vector3(0, 1, 0);
    const m4 = new THREE.Matrix4();
    const qt = new THREE.Quaternion();
    const v3 = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const col = new THREE.Color();

    for (const bin in this.facadeGeos) {
      const texName = bin.split('|')[0];
      const geos = this.facadeGeos[bin];
      if (geos.length) {
        // Ночью светятся САМИ окна на текстуре, через карту свечения,
        // построенную из этой же картинки. Раньше поверх фасада клались
        // накладные квадраты: на текстурах 512 это сходило за окна, а на
        // HD превратилось в кремовые плашки, наклеенные поверх нарисованных
        // рам и даже поверх витрин первого этажа.
        // Маска есть не у всех: у склада окна нарисованы вручную (ворота
        // и пара окошек), сетки нет — и запрос несуществующего файла давал
        // 404 в консоли на каждой загрузке.
        const litFile = WINDOW_GRID[texName] ? texName.replace('.jpg', '_lit.png') : null;
        const mat = new THREE.MeshLambertMaterial({
          map: TEX.load(texName, { repeat: [1, 1] }),
          emissiveMap: litFile
            ? TEX.load(litFile, { repeat: [1, 1], srgb: false }) : null,
          vertexColors: true,
          emissive: new THREE.Color(0x000000),
        });
        if (!litFile) mat.userData.noWindows = true;
        this.facadeMaterials.push(mat);
        const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        this.scene.add(mesh);
        geos.length = 0;
      }

    }
  }

  buildProps() {
    const N = CITY.N, W = CITY.ROAD_W;
    const m4 = new THREE.Matrix4();

    // street lamps
    // Столб — готовая модель (см. models.json), если она загрузилась; иначе
    // прежний цилиндр. А вот светящийся плафон остаётся отдельной плашкой в
    // любом случае: у модели весь фонарь нарисован одним атласным материалом,
    // и «зажечь» в нём только лампу нельзя — засветился бы весь столб.
    const lampParts = MODELS.bakedParts('streetlight');
    const LAMP_H = 5.5;                       // высота модели после калибровки
    const headGeo = new THREE.BoxGeometry(1.15, 0.22, 0.5);
    const headMat = new THREE.MeshBasicMaterial({ color: 0x4a4a44 });
    this.lampMaterials.push(headMat);
    const cap = N * N * 4;

    const poleSets = lampParts
      ? lampParts.map((part) => new THREE.InstancedMesh(part.geometry, part.material, cap))
      : [new THREE.InstancedMesh(
        new THREE.CylinderGeometry(0.13, 0.17, 7.4, 6),
        new THREE.MeshLambertMaterial({ color: 0x35353a }), cap)];
    const heads = new THREE.InstancedMesh(headGeo, headMat, cap);
    let k = 0;
    const off = W / 2 + 1.7;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const x = gridToWorld(i), z = gridToWorld(j);
        for (const [dx, dz] of [[-off, -off], [off, -off], [-off, off], [off, off]]) {
          // Модель стоит на земле (откалибрована низом в 0), цилиндр —
          // центром, поэтому высота крепления у них разная.
          m4.makeTranslation(x + dx, lampParts ? 0 : 3.7, z + dz);
          for (const set of poleSets) set.setMatrixAt(k, m4);
          m4.makeTranslation(x + dx, lampParts ? LAMP_H - 0.35 : 7.5, z + dz);
          heads.setMatrixAt(k, m4);
          k++;
        }
      }
    }
    heads.count = k; heads.instanceMatrix.needsUpdate = true;
    for (const set of poleSets) {
      set.count = k; set.instanceMatrix.needsUpdate = true;
      // Теней у столбов нет намеренно: их под пятьсот штук, каждый попадает
      // в карту теней и стоит дорого, а тень от тонкого столба почти не
      // читается. Включение уронило кадр вчетверо.
      set.castShadow = false;
      this.scene.add(set);
    }
    this.scene.add(heads);

    // trees
    // Точки собираем в список, а меши строим в самом конце (buildTrees):
    // дерево может быть как готовой моделью в несколько частей, так и
    // запасной процедурной парой «цилиндр + икосаэдр». Один список — оба пути.
    // Больше зелени: парки + аллеи вдоль улиц + густой пояс по краям карты.
    const maxTrees = this.parks.length * 16 + 900;
    const treeSpots = [];
    let t = 0;
    for (const p of this.parks) {
      const n = 12;
      for (let i = 0; i < n && t < maxTrees; i++) {
        // Four groves leave the cross paths and central square open.
        const quadrant = i % 4, rank = Math.floor(i / 4);
        const sx = quadrant % 2 ? 1 : -1, sz = quadrant < 2 ? -1 : 1;
        const x = p.x + sx * (rank === 0 ? 10 : 16) + rand(-0.6, 0.6);
        const z = p.z + sz * (rank === 2 ? 16 : 10) + rand(-0.6, 0.6);
        const s = rand(0.88, 1.15);
        treeSpots.push({ x, z, s, y: 0.38, park: true });
        this.addCollider(x - 0.3, z - 0.3, x + 0.3, z + 0.3, 3);
        t++;
      }
    }
    // --- уличное озеленение: КАДКИ, а не свободный ряд ---
    //
    // Раньше деревья сыпались вдоль тротуара со случайным шагом и вырастали
    // где придётся — в том числе вплотную к витринам. В городе дерево на
    // тротуаре стоит в отведённом месте: в бетонной кадке, через равные
    // промежутки. Так это и читается намеренным, а не самосевом.
    const half = CITY.HALF;
    const STEP = 26;                       // шаг кадок вдоль улицы
    const OFF = CITY.ROAD_W / 2 + 0.9;     // от осевой: на тротуаре у бордюра
    for (let i = 0; i < CITY.N && t < maxTrees; i++) {
      const p0 = i * CITY.SPACING - half;
      for (let k = -half + 20; k < half - 20 && t < maxTrees; k += STEP) {
        for (const [tx, tz] of [[p0 + OFF, k], [p0 - OFF, k],
                                [k, p0 + OFF], [k, p0 - OFF]]) {
          if (t >= maxTrees) break;
          if (Math.random() < 0.35) continue;              // не сплошной ряд
          if (Math.abs(tx) > half - 4 || Math.abs(tz) > half - 4) continue;
          if (this.isOnRoad(tx, tz)) continue;
          // blockedAt, а не nearbyColliders: второй отдаёт всё содержимое
          // ячейки хэша (40 м) и всегда непустой.
          if (this.blockedAt(tx, tz, 2.2)) continue;
          const y = this.groundHeightAt(tx, tz);
          // Keep the inner walking strip clear at this tree, including buildings.
          const line = v => gridToWorld(Math.round((v + CITY.HALF) / CITY.SPACING));
          const dx = tx-line(tx), dz = tz-line(tz);
          const foot = Math.abs(dx)<Math.abs(dz)
            ? {x:line(tx)+Math.sign(dx)*(CITY.ROAD_W/2+2.6),z:tz}
            : {x:tx,z:line(tz)+Math.sign(dz)*(CITY.ROAD_W/2+2.6)};
          if(this.blockedAt(foot.x,foot.z,0.45))continue;
          // сама кадка
          const pw = 1.45, ph = 0.18;
          this.detailGeos.push(City.colorBox(pw, ph, pw, tx, y + ph / 2, tz, 0x8d8b84));
          this.detailGeos.push(City.colorBox(pw - 0.35, 0.1, pw - 0.35, tx, y + ph, tz, 0x4a3f30));
          this.addCollider(tx - pw / 2, tz - pw / 2, tx + pw / 2, tz + pw / 2, y + ph);
          treeSpots.push({ x: tx, z: tz, s: rand(0.85, 1.0), street: true, y: y + ph });
          this._planters = (this._planters || 0) + 1;
          (this._planterAt = this._planterAt || []).push({ x: tx, z: tz });
          t++;
        }
      }
    }

    // --- лесополоса по периметру карты ---
    const belt = 26;                       // ширина пояса
    for (let ring = 0; ring < belt && t < maxTrees; ring += rand(3.5, 6)) {
      const r = half + 3 + ring;
      const step = rand(7, 12);
      for (let a = -r; a < r && t < maxTrees; a += step) {
        for (const [tx, tz] of [[a, -r], [a, r], [-r, a], [r, a]]) {
          if (t >= maxTrees) break;
          if (Math.random() < 0.25) continue;
          const s2 = rand(0.9, 1.7);
          const jx = tx + rand(-2.5, 2.5), jz = tz + rand(-2.5, 2.5);
          if (this.isOnRoad(jx, jz)) continue;
          treeSpots.push({ x: jx, z: jz, s: s2, y: this.groundHeightAt(jx, jz) });
          t++;
        }
      }
    }

    this.buildTrees(treeSpots);

    // Гидранты. Модель у нас скачана (CC0), а рисовался красный цилиндр —
    // рядом с моделью фонаря и урны он читался заглушкой. Ставим модель,
    // цилиндр остаётся запасным путём, если ассет не загрузился.
    const hydSpots = [];
    for (let i = 0; i < 160; i++) {
      const p = this.randomSidewalkPoint();
      hydSpots.push({ x: p.x, z: p.z, y: this.groundHeightAt(p.x, p.z), r: rand(0, 6.28) });
    }
    const hydParts = MODELS.bakedParts('hydrant');
    const hydBounds = new THREE.Box3();
    if (hydParts) {
      for (const part of hydParts) { part.geometry.computeBoundingBox(); hydBounds.union(part.geometry.boundingBox); }
    } else hydBounds.set(new THREE.Vector3(-.26,0,-.26),new THREE.Vector3(.26,.9,.26));
    for (const spot of hydSpots) {
      const transform = new THREE.Matrix4().compose(new THREE.Vector3(spot.x,spot.y,spot.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),spot.r),new THREE.Vector3(1,1,1));
      const bounds = hydBounds.clone().applyMatrix4(transform);
      this.addCollider(bounds.min.x,bounds.min.z,bounds.max.x,bounds.max.z,bounds.max.y,'hydrant',bounds.min.y);
    }
    // Свои q/one: общие объявлены ниже по функции, обращение отсюда попало
    // бы в мёртвую зону объявления.
    const hq = new THREE.Quaternion();
    const hone = new THREE.Vector3(1, 1, 1);
    const hAxis = new THREE.Vector3(0, 1, 0);
    if (hydParts) {
      for (const part of hydParts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, hydSpots.length);
        hydSpots.forEach((p, i) => {
          hq.setFromAxisAngle(hAxis, p.r);
          m4.compose(new THREE.Vector3(p.x, p.y, p.z), hq, hone);
          inst.setMatrixAt(i, m4);
        });
        inst.instanceMatrix.needsUpdate = true;
        inst.castShadow = true;
        this.scene.add(inst);
      }
    } else {
      const hydGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.9, 6);
      const hydMat = new THREE.MeshLambertMaterial({ color: 0xb03030 });
      const hyd = new THREE.InstancedMesh(hydGeo, hydMat, hydSpots.length);
      hydSpots.forEach((p, i) => {
        m4.makeTranslation(p.x, p.y + 0.45, p.z);
        hyd.setMatrixAt(i, m4);
      });
      hyd.instanceMatrix.needsUpdate = true;
      hyd.castShadow = true;
      this.scene.add(hyd);
    }
  }

  buildTrees(spots) {
    this.treeSpots = spots;
    for (const spot of spots) {
      if (spot.park) continue;
      const radius = .24 * spot.s;
      this.addCollider(spot.x-radius,spot.z-radius,spot.x+radius,spot.z+radius,
        (spot.y || 0)+4*spot.s,'tree-trunk',spot.y || 0);
    }
    this.urbanTrees = new UrbanTrees(this.scene, spots);
  }

  buildParkAmenities() {
    this.life = new CityLife(this);
  }

  /**
   * Мелочь на тротуарах: пакеты, банки, коробки, паллеты, бочки.
   *
   * Раньше улицы были стерильными — урны и конусы стояли, но валяться на
   * земле было нечему. Мусор без коллизий намеренно: игрок должен проходить
   * сквозь пакет, а не спотыкаться о него.
   *
   * Каждый вид — свой InstancedMesh, поэтому сотня предметов стоит столько же,
   * сколько десяток. Нет моделей — метод молча ничего не делает: мусор
   * приятен, но не обязателен.
   */
  scatterLitter() {
    // Light litter at the kerb; cargo only in industrial service yards.
    const KINDS = [
      {slot:'trashbag',n:45,scale:0.65},
      {slot:'boxes',n:22,scale:0.60,cargo:true},
      {slot:'crate',n:18,scale:0.75,cargo:true},
      {slot:'barrel',n:15,scale:0.85,cargo:true},
      {slot:'pallet',n:15,scale:0.85,cargo:true},
      {slot:'sodacan',n:40,scale:1.0},
      {slot:'pizzabox',n:22,scale:0.85},
    ];
    this.litterSpots=[];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);

    for (const kind of KINDS) {
      const parts = MODELS.bakedParts(kind.slot);
      if (!parts) continue;

      const spots=[];
      const yards=this.blockRects.filter(b=>['industrial','docks'].includes(b.district));
      for(let i=0;i<kind.n*25&&spots.length<kind.n;i++) {
        let x,z,rot;
        if(kind.cargo){
          if(!yards.length)break;
          const yard=yards[Math.floor(i/8)%yards.length];
          // Delivery clusters in the central service alley, aligned with buildings.
          x=yard.cx+(i%3-1)*1.4;z=yard.cz+(Math.floor(i/3)%3-1)*1.5;
          rot=(Math.floor(i/3)%2)*Math.PI/2;
        }else{
          const line=gridToWorld(randInt(0,CITY.N-1));
          const off=(CITY.ROAD_W/2+0.45)*(Math.random()<0.5?-1:1);
          const along=rand(-CITY.HALF+15,CITY.HALF-15);
          const alongX=Math.random()<0.5;
          x=alongX?along:line+off;z=alongX?line+off:along;rot=rand(0,6.28);
        }
        if(this.isOnRoad(x,z)||this.blockedAt(x,z,0.65))continue;
        if(this.parks.some(p=>Math.abs(x-p.x)<p.w/2+3.4&&Math.abs(z-p.z)<p.h/2+3.4))continue;
        if(this.litterSpots.some(p=>Math.hypot(x-p.x,z-p.z)<1.2))continue;
        const spot={x,z,rot,s:rand(0.9,1.05)*kind.scale,slot:kind.slot,cargo:!!kind.cargo};
        spots.push(spot);this.litterSpots.push(spot);
      }
      if (!spots.length) continue;

      if (kind.cargo) {
        const bounds = new THREE.Box3();
        for (const part of parts) {
          part.geometry.computeBoundingBox();
          bounds.union(part.geometry.boundingBox);
        }
        for (const spot of spots) {
          q.setFromAxisAngle(yAxis, spot.rot);
          m4.compose(new THREE.Vector3(spot.x, this.groundHeightAt(spot.x, spot.z) + .015, spot.z),
            q, new THREE.Vector3(spot.s, spot.s, spot.s));
          const world = bounds.clone().applyMatrix4(m4);
          this.addCollider(world.min.x, world.min.z, world.max.x, world.max.z,
            world.max.y, 'cargo:' + kind.slot, world.min.y);
        }
      }

      for (const part of parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
        spots.forEach((p, i) => {
          q.setFromAxisAngle(yAxis, p.rot);
          m4.compose(new THREE.Vector3(p.x, this.groundHeightAt(p.x,p.z)+0.015, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
          inst.setMatrixAt(i, m4);
        });
        inst.instanceMatrix.needsUpdate = true;
        // Мусора больше тысячи предметов — в карту теней их не пускаем:
        // тень от банки не видна, а стоимость такая же, как у здания.
        inst.castShadow = false;
        inst.receiveShadow = true;
        this.scene.add(inst);
      }
    }
  }

  buildTrafficLights() {
    const N = CITY.N, W = CITY.ROAD_W;
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
    const poleGeo = new THREE.BoxGeometry(0.2, 5.2, 0.2);
    const boxGeo = new THREE.BoxGeometry(0.5, 1.3, 0.4);
    const boxMat = new THREE.MeshLambertMaterial({ color: 0x1b1b1f });

    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        // only inner intersections get lights
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) continue;
        if ((i + j) % 2 === 1) continue; // thin them out
        const x = gridToWorld(i), z = gridToWorld(j);
        const light = {
          x, z, phase: Math.random() * 12, nsGreen: true,
          bulbs: [],
        };
        const off = W / 2 + 1.2;
        for (const [dx, dz, rot] of [[-off, -off, 0], [off, off, Math.PI]]) {
          const pole = new THREE.Mesh(poleGeo, poleMat);
          pole.position.set(x + dx, 2.6, z + dz);
          this.scene.add(pole);
          const head = new THREE.Mesh(boxGeo, boxMat);
          head.position.set(x + dx, 5.4, z + dz);
          this.scene.add(head);
          const red = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5),
            new THREE.MeshBasicMaterial({ color: 0x401010 }));
          red.position.set(x + dx, 5.8, z + dz + 0.22);
          const grn = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5),
            new THREE.MeshBasicMaterial({ color: 0x104010 }));
          grn.position.set(x + dx, 5.05, z + dz + 0.22);
          this.scene.add(red); this.scene.add(grn);
          light.bulbs.push({ red, grn, axis: 'ns' });
        }
        this.lights.push(light);
      }
    }
  }

  updateTrafficLights(dt) {
    for (const L of this.lights) {
      L.phase += dt;
      const cycle = 16;
      const p = L.phase % cycle;
      const ns = p < cycle / 2;
      if (ns !== L.nsGreen) {
        L.nsGreen = ns;
        for (const b of L.bulbs) {
          b.red.material.color.setHex(ns ? 0x401010 : 0xff2a2a);
          b.grn.material.color.setHex(ns ? 0x2aff5a : 0x104010);
        }
      }
    }
  }

  // Is a car approaching this intersection required to stop?
  lightStateAt(x, z, movingAlongZ) {
    for (const L of this.lights) {
      if (Math.abs(L.x - x) < 26 && Math.abs(L.z - z) < 26) {
        return movingAlongZ ? L.nsGreen : !L.nsGreen;
      }
    }
    return true;
  }

  buildLocations() {
    const lots = (this.emptyLots || []).slice();
    const place = (type, count) => {
      for (let n = 0; n < count; n++) {
        let spot;
        if (lots.length) spot = lots.splice(randInt(0, lots.length - 1), 1)[0];
        else throw new Error('City service lots exhausted');
        this.addLocation(type, spot.cx, spot.cz, Math.min(spot.bw, 26), Math.min(spot.bh, 26));
      }
    };
    place('spray', 4);
    place('ammu', 3);
    place('hospital', 3);
    place('police', 2);
  }

  addLocation(type, x, z, w, d) {
    const info = LOCATION_TYPES[type];
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d),
      new THREE.MeshLambertMaterial({ color: 0x3a3a40 }));
    floor.position.set(x, 0.36, z);
    floor.receiveShadow = true;
    this.scene.add(floor);

    // back wall with signage colour
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 6, 1.2),
      new THREE.MeshLambertMaterial({ color: 0x55555c }));
    wall.position.set(x, 3.2, z - d / 2 + 0.6);
    wall.castShadow = true;
    this.scene.add(wall);
    this.addCollider(x - w / 2, z - d / 2, x + w / 2, z - d / 2 + 1.2, 6);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 1.4),
      new THREE.MeshBasicMaterial({ map: TEX.sign(info.label, '#263a3e', '#eee4c8') }));
    sign.position.set(x, 4.8, z - d / 2 + 1.23);
    this.scene.add(sign);

    // A real service pavilion around the drive-in area. Its entrance and
    // activation radius stay open; the side walls have matching colliders.
    const parts = [];
    const box=(bw,bh,bd,bx,by,bz,col)=>parts.push(City.colorBox(bw,bh,bd,bx,by,bz,col));
    box(w+0.8,0.35,d+0.7,x,6.25,z,0x586364);
    for(const side of [-1,1]) {
      box(0.55,6,d,x+side*(w/2-0.275),3.2,z,0x87918d);
      this.addCollider(x+side*(w/2-0.275)-0.275,z-d/2,x+side*(w/2-0.275)+0.275,z+d/2,6.4,'service');
      box(0.7,0.5,d+0.5,x+side*w/2,5.85,z,0x34494a);
    }
    box(w,0.65,0.35,x,5.75,z+d/2,0x34494a);
    const shell=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshLambertMaterial({vertexColors:true}));
    shell.castShadow=true;shell.receiveShadow=true;this.scene.add(shell);parts.forEach(g=>g.dispose());
    const front=new THREE.Mesh(new THREE.PlaneGeometry(w*0.58,1.15),sign.material);
    front.position.set(x,5.4,z+d/2+0.2);this.scene.add(front);

    // glowing entry pad
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(info.radius, info.radius, 0.08, 24),
      new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.22 }));
    pad.position.set(x, 0.46, z + 1);
    this.scene.add(pad);

    this.locations.push({ type, x, z: z + 1, radius: info.radius, color: info.color, label: info.label, cooldown: 0 });
  }

  buildRamps() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x7a6636 });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffdd55 });
    const N = CITY.N;
    const placed = [];

    for (let n = 0; n < 8; n++) {
      // keep ramps on inner roads, away from the boundary walls
      let p = null;
      for (let tries = 0; tries < 30; tries++) {
        const i = randInt(2, N - 3);
        const j = randInt(1, N - 3);
        const t = rand(0.3, 0.7);
        const horizontal = Math.random() < 0.5;
        const c = horizontal
          ? { x: gridToWorld(j) + t * CITY.SPACING, z: gridToWorld(i), along: true }
          : { x: gridToWorld(i), z: gridToWorld(j) + t * CITY.SPACING, along: false };
        // stay clear of other ramps
        if (placed.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < 70)) continue;
        p = c; break;
      }
      if (!p) continue;
      placed.push(p);

      const w = 8, l = 13, h = 2.6;
      const angle = .22, cosine = Math.cos(angle), sine = Math.sin(angle);
      const baseY = this.groundHeightAt(p.x, p.z);
      const centerY = baseY + l / 2 * sine - h / 2 * cosine;
      // `along === true` means the road runs along X, so the ramp climbs in X
      const geo = new THREE.BoxGeometry(p.along ? l : w, h, p.along ? w : l);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, centerY, p.z);
      if (p.along) m.rotation.z = -angle; else m.rotation.x = angle;
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);

      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(p.along ? 0.6 : w * 0.9, 0.12, p.along ? w * 0.9 : 0.6), stripeMat);
      stripe.position.set(p.x, centerY + h / (2 * cosine) + .06, p.z);
      if (p.along) stripe.rotation.z = -angle; else stripe.rotation.x = angle;
      this.scene.add(stripe);

      const surfaceShift = h / 2 * sine, surfaceHalf = l / 2 * cosine;
      const rampCollider = this.addCollider(p.x + (p.along ? surfaceShift - surfaceHalf : -w / 2),
        p.z + (p.along ? -w / 2 : surfaceShift - surfaceHalf),
        p.x + (p.along ? surfaceShift + surfaceHalf : w / 2),
        p.z + (p.along ? w / 2 : surfaceShift + surfaceHalf), baseY + l * sine, 'ramp');
      rampCollider.topAt = (x, z) => clamp(centerY + h / (2 * cosine)
        - Math.tan(angle) * (p.along ? x - p.x : z - p.z), baseY, baseY + l * sine);
      rampCollider.characterOnly = true;
      this.ramps.push({ x: p.x, z: p.z, r: Math.max(w, l) * 0.55, along: p.along, height: h });
    }
  }


  // ---------------- street detail ----------------
  buildDetails() {
    const N = CITY.N, W = CITY.ROAD_W;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    // ---- billboards on rooftops and blank walls ----
    const adFiles = ['ad_soda.jpg', 'ad_motors.jpg', 'ad_burger.jpg', 'ad_club.jpg', 'ad_gun.jpg', 'ad_casino.jpg', 'ad_diner.jpg'];
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x2e2e34 });
    const tall = this.buildings.filter((b) => b.h > 16);
    for (let i = 0; i < Math.min(26, tall.length); i++) {
      const b = pick(tall);
      const tex = TEX.load(pick(adFiles), { repeat: [1, 1] });
      const bw = Math.min(b.w * 0.85, 15);
      const bh = bw * 0.5;
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh),
        new THREE.MeshBasicMaterial({ map: tex }));
      const onRoof = Math.random() < 0.55;
      const side = pick([0, 1, 2, 3]);
      if (onRoof) {
        const rot = side * Math.PI / 2;
        panel.position.set(b.x, b.h + bh / 2 + 1.2, b.z);
        panel.rotation.y = rot;
        // support legs
        for (const sx of [-1, 1]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), frameMat);
          leg.position.set(b.x + Math.cos(rot) * sx * bw * 0.4, b.h + 1.3, b.z - Math.sin(rot) * sx * bw * 0.4);
          this.scene.add(leg);
        }
      } else {
        const off = 0.12;
        const y = clamp(b.h * 0.55, 6, b.h - bh / 2 - 1);
        if (side === 0) { panel.position.set(b.x, y, b.z + b.d / 2 + off); }
        else if (side === 1) { panel.position.set(b.x + b.w / 2 + off, y, b.z); panel.rotation.y = Math.PI / 2; }
        else if (side === 2) { panel.position.set(b.x, y, b.z - b.d / 2 - off); panel.rotation.y = Math.PI; }
        else { panel.position.set(b.x - b.w / 2 - off, y, b.z); panel.rotation.y = -Math.PI / 2; }
      }
      this.scene.add(panel);
      this.billboards.push(panel);
    }

    // Ground-floor storefronts are authored once by dressBuilding.

    // ---- graffiti on industrial walls ----
    const graffColors = ['#ff4d6d', '#4dc3ff', '#ffd83d', '#8cff5a'];
    const dirty = this.buildings.filter((b) => b.district === 'industrial' || b.district === 'docks');
    for (let i = 0; i < Math.min(34, dirty.length); i++) {
      const b = pick(dirty);
      const side = randInt(0, 3);
      const dir = [[0, 1], [1, 0], [0, -1], [-1, 0]][side];
      const half = side % 2 === 0 ? b.d / 2 : b.w / 2;
      const g = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6),
        new THREE.MeshBasicMaterial({ map: TEX.graffiti(pick(graffColors)), transparent: true }));
      g.position.set(b.x + dir[0] * (half + 0.05), 2.2, b.z + dir[1] * (half + 0.05));
      g.rotation.y = Math.atan2(dir[0], dir[1]);
      this.scene.add(g);
    }

    // ---- street furniture (instanced) ----
    const furniture = [];
    const addInst = (geo, mat, count, place, collisionTag = null) => {
      if (collisionTag) geo.computeBoundingBox();
      const inst = new THREE.InstancedMesh(geo, mat, count);
      let k = 0;
      for (let i = 0; i < count; i++) {
        const t = place(i);
        if (!t) continue;
        m4.compose(new THREE.Vector3(t.x, t.y, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r || 0), one);
        inst.setMatrixAt(k++, m4);
        if (collisionTag) {
          const bounds = geo.boundingBox.clone().applyMatrix4(m4);
          this.addCollider(bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z,
            bounds.max.y, collisionTag, bounds.min.y);
        }
      }
      inst.count = k;
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      this.scene.add(inst);
      return inst;
    };

    // Высота каждого предмета отсчитывается от ЗЕМЛИ ПОД НИМ. Раньше она
    // была вписана числом в расчёте на тротуар: конус, который ставится на
    // проезжей части, висел в тридцати сантиметрах над асфальтом, а столбы
    // на тротуаре на столько же тонули.
    const gy = (x, z) => this.groundHeightAt(x, z);

    // trash bins
    addInst(new THREE.CylinderGeometry(0.33, 0.29, 0.95, 8),
      new THREE.MeshLambertMaterial({ color: 0x2f4030 }), 120, () => {
        const p = this.randomSidewalkPoint();
        return { x: p.x, y: gy(p.x, p.z) + 0.475, z: p.z, r: rand(0, 6.28) };
      }, 'bin');

    // Complete benches are placed along park paths by CityLife.

    // newspaper boxes
    addInst(new THREE.BoxGeometry(0.5, 1.0, 0.42),
      new THREE.MeshLambertMaterial({ color: 0x1f5aa8 }), 60, () => {
        const p = this.randomSidewalkPoint();
        return { x: p.x, y: gy(p.x, p.z) + 0.5, z: p.z, r: rand(0, 6.28) };
      }, 'newspaper-box');

    // traffic cones near "roadworks"
    addInst(new THREE.ConeGeometry(0.24, 0.7, 7),
      new THREE.MeshLambertMaterial({ color: 0xe0561f }), 80, () => {
        // Конусы — это «дорожные работы», им место на проезжей части.
        // Разброс ±3 м уводил их на тротуар, где конус ни к селу ни к городу.
        const p = this.randomRoadPoint();
        const x = p.x + rand(-2, 2), z = p.z + rand(-2, 2);
        if (!this.isOnRoad(x, z)) return null;
        return { x, y: gy(x, z) + 0.35, z, r: 0 };
      });

    // mail boxes / hydrant-like posts already exist; add utility poles along roads
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });
    addInst(new THREE.CylinderGeometry(0.17, 0.21, 9, 6), poleMat, 90, () => {
      const p = this.randomSidewalkPoint();
      return { x: p.x, y: gy(p.x, p.z) + 4.5, z: p.z, r: 0 };
    }, 'utility-pole');

    // ---- neon strips downtown ----
    const neonColors = [0xff3d81, 0x3df0ff, 0xffd23d, 0x9d5cff, 0x4dff88];
    const downtown = this.buildings.filter((b) => b.district === 'downtown' || b.district === 'commercial');
    for (let i = 0; i < Math.min(48, downtown.length); i++) {
      const b = pick(downtown);
      const c = pick(neonColors);
      const mat = new THREE.MeshBasicMaterial({ color: c });
      const side = randInt(0, 3);
      const dir = [[0, 1], [1, 0], [0, -1], [-1, 0]][side];
      const half = side % 2 === 0 ? b.d / 2 : b.w / 2;
      const len = (side % 2 === 0 ? b.w : b.d) * 0.8;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.14), mat);
      strip.position.set(b.x + dir[0] * (half + 0.1), rand(6, Math.max(7, b.h - 2)), b.z + dir[1] * (half + 0.1));
      strip.rotation.y = Math.atan2(dir[0], dir[1]);
      this.scene.add(strip);
      this.neonStrips.push({ mesh: strip, mat, base: c, phase: rand(0, 6.3), flicker: Math.random() < 0.25 });
    }


    // ---- painted neon signs on commercial buildings ----
    const neonFiles = ['neon_bar.png', 'neon_hotel.png', 'neon_club.png', 'neon_open.png', 'neon_martini.png'];
    const neonHosts = this.buildings.filter((b) => b.h > 10 && b.h < 60);
    for (let i = 0; i < Math.min(30, neonHosts.length); i++) {
      const b = pick(neonHosts);
      const side = randInt(0, 3);
      const dir = [[0, 1], [1, 0], [0, -1], [-1, 0]][side];
      const half = side % 2 === 0 ? b.d / 2 : b.w / 2;
      const sz = Math.min((side % 2 === 0 ? b.w : b.d) * 0.55, 6.5);
      const mat = new THREE.MeshBasicMaterial({
        map: TEX.load(pick(neonFiles), { repeat: [1, 1] }),
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz), mat);
      sign.position.set(
        b.x + dir[0] * (half + 0.14),
        clamp(b.h * 0.45, 5.5, b.h - sz / 2 - 0.5),
        b.z + dir[1] * (half + 0.14));
      sign.rotation.y = Math.atan2(dir[0], dir[1]);
      this.scene.add(sign);
      this.neonSigns.push({ mat, phase: rand(0, 6.3), flicker: Math.random() < 0.3 });
    }

    // ---- torn posters pasted on low walls ----
    const posterFiles = ['poster_a.jpg', 'poster_b.jpg', 'poster_c.jpg', 'poster_d.jpg'];
    for (let i = 0; i < 60; i++) {
      const b = pick(this.buildings);
      const side = randInt(0, 3);
      const dir = [[0, 1], [1, 0], [0, -1], [-1, 0]][side];
      const half = side % 2 === 0 ? b.d / 2 : b.w / 2;
      const pw = 1.15, ph = 1.7;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph),
        new THREE.MeshLambertMaterial({ map: TEX.load(pick(posterFiles), { repeat: [1, 1] }) }));
      const spread = (side % 2 === 0 ? b.w : b.d) * 0.35;
      const along = rand(-spread, spread);
      m.position.set(
        b.x + dir[0] * (half + 0.05) + (side % 2 === 0 ? along : 0),
        rand(1.6, 3.1),
        b.z + dir[1] * (half + 0.05) + (side % 2 === 1 ? along : 0));
      m.rotation.y = Math.atan2(dir[0], dir[1]);
      m.rotation.z = rand(-0.05, 0.05);
      this.scene.add(m);
    }

    // ---- dumpsters in alleys (with collision) ----
    const dumpMat = new THREE.MeshLambertMaterial({ color: 0x2f5f3f });
    for (let i = 0; i < 40; i++) {
      const p = this.randomSidewalkPoint();
      const d = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.25, 1.1), dumpMat);
      d.position.set(p.x, 0.78, p.z);
      d.rotation.y = rand(0, 6.28);
      d.castShadow = true; d.receiveShadow = true;
      this.scene.add(d);
      this.addCollider(p.x - 1.1, p.z - 0.7, p.x + 1.1, p.z + 0.7, 1.4);
    }
  }

  updateDetails(dt, time, night) {
    this.urbanTrees?.update(time);
    this.life?.update(time, night);
    // neon flicker + night-only shop glow
    for (const n of this.neonStrips) {
      if (n.flicker) {
        const f = Math.sin(time * 9 + n.phase) > -0.4 ? 1 : 0.15;
        n.mat.color.setHex(n.base);
        n.mat.color.multiplyScalar(night * f + 0.12);
      } else {
        n.mat.color.setHex(n.base);
        n.mat.color.multiplyScalar(0.18 + night * 0.9);
      }
    }

    for (const n of this.neonSigns) {
      let v = 0.35 + night * 0.65;
      if (n.flicker && Math.sin(time * 11 + n.phase) < -0.55) v *= 0.25;
      n.mat.opacity = v;
      n.mat.color.setScalar(0.6 + v * 0.5);
    }
    // Витрины первых этажей: днём тёмное стекло, ночью тёплый свет изнутри.
    // Раньше это был порог night > 0.35 — свет во всём городе включался
    // ОДНИМ кадром. Теперь разгорается по кривой: сначала едва, к глухой
    // ночи в полную силу.
    const lit = smooth01((night - 0.18) / 0.42);
    if (this.shopMat) {
      // Материал неосвещаемый, поэтому цвет здесь — это сразу яркость на
      // экране. С 0.86 витрины выжигались в сплошную кремовую ленту вдоль
      // всей улицы; нужно тёплое свечение изнутри, а не прожектор.
      // Свечение стекла держим низким: за ним теперь нарисованный зал, и
      // яркое стекло поверх подсвеченного интерьера складывалось вдвое —
      // витрина превращалась в белый прямоугольник, а вся начинка пропадала.
      this.shopMat.color.setRGB(
        0.07 + lit * 0.16, 0.085 + lit * 0.12, 0.11 + lit * 0.05);
      // И прозрачности ночью почти не теряем: светится ЗАЛ, стекло лишь
      // добавляет ему тёплый налёт.
      this.shopMat.opacity = 0.16 + lit * 0.04;
    }
    // Сам интерьер ночью подсвечен изнутри: иначе за горящим стеклом была
    // бы чернота, а горит-то как раз свет в зале.
    if (this.shopInteriorMat) {
      const e = lit * 0.62;
      this.shopInteriorMat.emissive.setRGB(e, e * 0.9, e * 0.72);
    }
    for (const w of this.shopWindows) {
      const g = 0.16 + night * 0.85;
      w.material.color.setRGB(
        (0.16 * g + 0.05) * (1 - lit) + 0.95 * lit,
        (0.17 * g + 0.05) * (1 - lit) + 0.82 * lit,
        (0.2 * g + 0.06) * (1 - lit) + 0.50 * lit);
    }
  }

  buildWalls() {
    const L = CITY.HALF + CITY.ROAD_W / 2 + 4;
    const t = 8;
    this.addCollider(-L - t, -L - t, L + t, -L, 40);
    this.addCollider(-L - t, L, L + t, L + t, 40);
    this.addCollider(-L - t, -L, -L, L, 40);
    this.addCollider(L, -L, L + t, L, 40);
  }

  // ---- night lighting ----
  setNight(f) {
    // f: 0 = day, 1 = night
    // Окна больше не отдельные плашки — светится сам фасад по маске,
    // и «сколько горит» задаёт яркость свечения материала.
    for (const m of this.facadeMaterials) {
        const e = m.userData.noWindows ? 0 : smooth01((f-0.12)/0.88) * 0.19;
      m.emissive.setRGB(e, e * 0.87, e * 0.62);
    }
    const lampDay = new THREE.Color(0x4a4a44), lampNight = new THREE.Color(0xffe6a8);
    for (const m of this.lampMaterials) m.color.copy(lampDay).lerp(lampNight, f);
  }

  nearbyColliders(x, z, r, out) { return this.hash.query(x, z, r, out); }

  /**
   * Реально ли точка занята зданием (с запасом margin).
   *
   * nearbyColliders() для этого не годится: это запрос к пространственному
   * хэшу с ячейкой 40 м, он отдаёт всё содержимое ячейки, а не то, что
   * попало в радиус. Проверка «список непустой» поэтому означает «где-то
   * в сорока метрах есть здание» — то есть почти всегда «занято».
   */
  blockedAt(x, z, margin = 0) {
    const near = this.hash.query(x, z, margin + 1, []);
    for (const b of near) {
      if (b.characterOnly) continue;
      if (x > b.minX - margin && x < b.maxX + margin
        && z > b.minZ - margin && z < b.maxZ + margin) return true;
    }
    return false;
  }

  /**
   * Насколько точка ЗАШЛА за кромку проезжей части. 0 на дороге, растёт
   * вглубь тротуара. Нужна, чтобы высота бордюра была функцией ПОЛОЖЕНИЯ.
   */
  depthPastKerb(x, z) {
    const S = CITY.SPACING, W = CITY.ROAD_W / 2;
    const fx = ((x + CITY.HALF) % S + S) % S;
    const fz = ((z + CITY.HALF) % S + S) % S;
    // расстояние наружу от края дорожной полосы по каждой оси
    const dx = Math.min(fx - W, (S - W) - fx);
    const dz = Math.min(fz - W, (S - W) - fz);
    if (dx < 0 || dz < 0) return 0;          // это проезжая часть
    return Math.min(dx, dz);
  }

  /**
   * Высота поверхности под точкой: 0 на проезжей части, высота бордюра на
   * тротуаре, и ПЛАВНЫЙ ПОДЪЁМ между ними на ширине ступеньки.
   *
   * Раньше здесь была ступень 0 → 0.3 одним скачком, а сглаживал её
   * character.syncMesh — по ВРЕМЕНИ, лерпом за несколько кадров. Из-за
   * этого высота отвязывалась от положения: персонаж успевал перейти
   * кромку раньше, чем поднимался, и ноги оказывались внутри бордюра.
   * Теперь высота зависит только от того, где человек стоит, — на кромке
   * он поднимается ровно по мере того, как переступает её.
   */
  groundHeightAt(x, z) {
    if (this.parks.some(p => Math.abs(x-p.x)<p.w/2 && Math.abs(z-p.z)<p.h/2)) return 0.38;
    if (Math.abs(x) > CITY.HALF + 6 || Math.abs(z) > CITY.HALF + 6) return 0;
    const d = this.depthPastKerb(x, z);
    if (d <= 0) return 0;
    const RAMP = 0.45;                        // на сколько метров растянут подъём
    const t = clamp(d / RAMP, 0, 1);
    return CURB_H * (t * t * (3 - 2 * t));
  }

  isOnRoad(x, z) {
    const S = CITY.SPACING, W = CITY.ROAD_W / 2;
    const fx = ((x + CITY.HALF) % S + S) % S;
    const fz = ((z + CITY.HALF) % S + S) % S;
    return (fx < W || fx > S - W) || (fz < W || fz > S - W);
  }

  randomRoadPoint() {
    const N = CITY.N;
    const i = randInt(0, N - 1), j = randInt(0, N - 2);
    const t = rand(0.2, 0.8);
    if (Math.random() < 0.5) return { x: gridToWorld(j) + t * CITY.SPACING, z: gridToWorld(i) };
    return { x: gridToWorld(i), z: gridToWorld(j) + t * CITY.SPACING };
  }

  randomSidewalkPoint() {
    const N = CITY.N;
    const i = randInt(0, N - 1), j = randInt(0, N - 2);
    const t = rand(0.15, 0.85);
    const off = (CITY.ROAD_W / 2 + 2.6) * (Math.random() < 0.5 ? 1 : -1);
    if (Math.random() < 0.5) return { x: gridToWorld(j) + t * CITY.SPACING, z: gridToWorld(i) + off };
    return { x: gridToWorld(i) + off, z: gridToWorld(j) + t * CITY.SPACING };
  }

  /**
   * Точка на ТОМ ЖЕ тротуаре, где человек стоит сейчас.
   *
   * Пешеходы ходят к цели по прямой, а цель бралась случайной по всему
   * городу — половина маршрутов пересекала проезжую часть, и толпа
   * постоянно лезла под машины. Держим человека на его стороне улицы:
   * находим ближайшую линию сетки, остаёмся с той же стороны от неё и
   * двигаемся только вдоль. Переходы остаются — но через перекрёстки,
   * куда тротуар и так выводит.
   *
   * Не нашли тротуара рядом (человека вынесло в парк или к воде) —
   * отдаём обычную случайную точку, чтобы он вернулся к улицам.
   */
  sidewalkPointNear(x, z) {
    const S = CITY.SPACING, EDGE = CITY.ROAD_W / 2 + 2.6;
    const idx = (v) => Math.round((v + CITY.HALF) / S);
    const iz = clamp(idx(z), 0, CITY.N - 1);
    const ix = clamp(idx(x), 0, CITY.N - 1);
    const lineZ = gridToWorld(iz), lineX = gridToWorld(ix);
    const dz = z - lineZ, dx = x - lineX;

    // вдоль какой улицы человек стоит — вдоль X или вдоль Z
    const alongX = Math.abs(dz) < Math.abs(dx);
    const off = alongX ? dz : dx;
    if (Math.abs(off) > EDGE + 6) return this.randomSidewalkPoint();

    const keep = EDGE * Math.sign(off || 1);          // та же сторона улицы
    const along = alongX ? x : z;
    const block = clamp(Math.floor((along + CITY.HALF) / S), 0, CITY.N - 2);
    const lo = gridToWorld(block) + EDGE, hi = gridToWorld(block + 1) - EDGE;
    const destination = clamp(along + rand(-S * 0.42, S * 0.42), lo, hi);
    return alongX
      ? { x: destination, z: lineZ + keep }
      : { x: lineX + keep, z: destination };
  }

  nearestLocation(type, x, z) {
    let best = null, bd = Infinity;
    for (const l of this.locations) {
      if (type && l.type !== type) continue;
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < bd) { bd = d; best = l; }
    }
    return best ? { loc: best, dist: bd } : null;
  }
}
