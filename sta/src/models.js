// Библиотека готовых 3D-моделей (.glb) — машины и городские пропсы.
//
// Модели скачиваются с Poly Pizza инструментом tools/fetch-models.js; лицензии
// и авторы — в assets/models/PROVENANCE.md. Здесь только загрузка и калибровка.
//
// Три вещи, которые делает этот модуль и без которых чужие модели не встают
// в игру:
//
// 1. КАЛИБРОВКА. Модели рисовали разные люди в разных редакторах: масштаб
//    произвольный (одна машина 2 юнита, другая 400), перед смотрит куда попало,
//    пивот где угодно. Игра же считает габариты сама (CAR_TYPES.w/l/h) и ждёт,
//    что перед машины смотрит в +Z, а колёса стоят на y=0. Поэтому каждую
//    модель при загрузке измеряем и приводим к этому виду — руками подгонять
//    два десятка моделей числами в коде смысла нет.
//
// 2. РАЗБОР НА ЧАСТИ. Игре нужны отдельно колёса (крутятся и рулят), материалы
//    фар и стоп-сигналов (переключаются) и материал кузова (красится в цвет
//    машины). В .glb это просто ноды и материалы с именами — находим по ним.
//
// 3. КЛОНИРОВАНИЕ МАТЕРИАЛОВ. three.js при clone() материалы НЕ копирует, они
//    остаются общими. Без явного клонирования все машины в городе оказались бы
//    одного цвета и мигали бы стоп-сигналами разом.
import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { prepareVehicleModel } from './vehicle-rig.js';
import { enhanceVehicleMaterial, vehicleMaterialRole, prepareVehicleSurfaceUVs } from './vehicle-materials.js';

const loader = new GLTFLoader();

// Имена материалов, которые НЕ являются краской кузова. Всё остальное —
// кандидат в «цвет машины». Шаблоны намеренно узкие: широкое `light` ловило
// «LightBlue» — реальный цвет кузова у половины моделей Quaternius — и красить
// начинало не тот материал.
const NON_BODY_MAT = /window|glass|tire|tyre|wheel|rim|chrome|headlight|taillight|brake ?light|^black$|^grey$|^gray$|^metal/i;
const WHEEL_NODE = /wheel/i;
const FRONT_WHEEL_NODE = /front/i;
const HEADLIGHT_MAT = /headlight/i;
const TAILLIGHT_MAT = /taillight|brake ?light/i;

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (g) => resolve(g), undefined, (e) => reject(new Error(`${url}: ${e.message || e}`)));
  });
}

function boxOf(obj) {
  return new THREE.Box3().setFromObject(obj);
}

// Центроид геометрии, использующей материал по предикату — нужен, чтобы
// понять, с какой стороны у модели перёд (там, где фары).
function centroidByMaterial(root, test) {
  const c = new THREE.Vector3();
  let n = 0;
  const tmp = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some((m) => m && m.name && test.test(m.name))) return;
    o.geometry.computeBoundingBox();
    o.geometry.boundingBox.getCenter(tmp);
    o.localToWorld(tmp);
    c.add(tmp); n++;
  });
  return n ? c.divideScalar(n) : null;
}

/**
 * Центроид мелких КРАСНЫХ материалов — это задние фонари.
 *
 * Считаем по МАТЕРИАЛУ, а не по мешу: часть моделей разбита на сотню
 * кусков, и каждый кусок красного кузова прошёл бы как «мелкий».
 */
function centroidOfSmallRed(root) {
  const stat = new Map();
  let total = 0;
  const tmp = new THREE.Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    total += n;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.color) continue;
      const c = m.color;
      const красный = c.r > 0.42 && c.r > c.g * 2.2 && c.r > c.b * 2.2;
      if (!красный) continue;
      g.computeBoundingBox();
      g.boundingBox.getCenter(tmp);
      o.localToWorld(tmp);
      let e = stat.get(m);
      if (!e) { e = { n: 0, c: new THREE.Vector3() }; stat.set(m, e); }
      e.n += n;
      e.c.addScaledVector(tmp, n);
    }
  });
  let best = null;
  for (const e of stat.values()) {
    if (e.n / total > 0.12) continue;          // это окрашенный кузов, не фонарь
    if (!best || e.n > best.n) best = e;
  }
  return best ? best.c.divideScalar(best.n) : null;
}

/**
 * Приводит загруженную сцену к соглашениям игры:
 *   низ → y = 0, центр по X/Z → 0, размер → заданный.
 *
 * opts.orient — доворачивать по длинной оси и по фарам (нужно машинам,
 *   вредно пропсам: у скамейки «длинная ось» ничего не значит).
 * opts.fitZ  — подогнать длину (машины: сравниваем с CAR_TYPES.l).
 * opts.fitY  — подогнать высоту (деревья, столбы, урны — у них важна она).
 */
/**
 * Убрать «подиумы» — плоские подложки, на которых автор выставил модель.
 *
 * Калибровка меряет габарит и подгоняет его под длину машины. Багги приехал
 * стоящим на плоскости 6.5 × 15: подгонялась она, и сам багги выходил ростом
 * в семьдесят сантиметров. Признак надёжный — толщина ровно ноль: у настоящей
 * детали машины бесконечно тонких горизонтальных поверхностей не бывает,
 * а подложка и «плоскость тени» — это ровно один прямоугольник.
 */
function stripDisplayPlanes(root) {
  const лишние = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const h = b.max.y - b.min.y;
    const w = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (h <= 1e-6 && w > 1e-3) лишние.push(o);
  });
  for (const o of лишние) if (o.parent) o.parent.remove(o);
  return лишние.length;
}

function calibrate(scene, opts = {}) {
  const root = new THREE.Group();
  root.add(scene);

  stripDisplayPlanes(root);

  let b = boxOf(root);
  let size = b.getSize(new THREE.Vector3());

  if (opts.orient) {
    // 1. Длинная горизонтальная ось — это длина машины. Если модель лежит
    //    вдоль X, доворачиваем на 90°, чтобы длина легла на Z.
    if (size.x > size.z) {
      scene.rotation.y += Math.PI / 2;
      root.updateWorldMatrix(true, true);
      b = boxOf(root);
      size = b.getSize(new THREE.Vector3());
    }
    // 2. Где перёд. Сначала по материалу фар — так размечены модели
    //    Quaternius. У других авторов материалы названы по цвету
    //    («FFFFFF», «1A1A1A»), правило не срабатывало вовсе, и машина
    //    вставала как лежала в файле: половина трафика ездила задом.
    const mid = b.getCenter(new THREE.Vector3());
    let frontZ = null;
    const head = centroidByMaterial(root, HEADLIGHT_MAT);
    if (head) frontZ = head.z - mid.z;

    if (frontZ === null) {
      //    Запасное правило: у любой дорожной машины сзади КРАСНЫЕ фонари.
      //    Ищем мелкий красный материал — конец, где он сидит, это корма.
      //    Ограничение по доле важно: у пожарной машины красный весь кузов,
      //    и без него правило показало бы на середину.
      const tail = centroidOfSmallRed(root);
      //    Верим только ЯВНО смещённому к краю пятну. Красная деталь у
      //    середины — это обивка, дуга или бак, а не фонарь; у багги такая
      //    нашлась в 16% от полудлины и развернула бы машину наугад.
      if (tail && Math.abs(tail.z - mid.z) > size.z * 0.14) {
        frontZ = -(tail.z - mid.z);
      }
    }

    if (frontZ !== null && frontZ < 0) {
      scene.rotation.y += Math.PI;
      root.updateWorldMatrix(true, true);
      b = boxOf(root);
      size = b.getSize(new THREE.Vector3());
    }
  }

  if (opts.slot === 'fire') {
    scene.rotation.y += Math.PI;
    root.updateWorldMatrix(true, true);
    b = boxOf(root);
    size = b.getSize(new THREE.Vector3());
  }

  // 3. Масштаб — всегда равномерный. Неравномерный подогнал бы габариты
  //    точнее, но раздавил бы пропорции, ради которых модель и берётся.
  let k = opts.fitZ && size.z > 1e-4 ? opts.fitZ / size.z
    : opts.fitY && size.y > 1e-4 ? opts.fitY / size.y
      : 0;
  // Подгонка только по длине оставляла выбросы: у иной модели кузов «пузатый»
  // относительно своей длины, и рядом с остальными она смотрелась великаном
  // (грузовик выходил в полтора раза шире и выше собственных габаритов).
  // Немного превысить норму можно — форма важнее, — но не в разы.
  if (k && opts.maxX && size.x * k > opts.maxX) k = opts.maxX / size.x;
  if (k && opts.maxY && size.y * k > opts.maxY) k = opts.maxY / size.y;
  if (k) {
    scene.scale.multiplyScalar(k);
    root.updateWorldMatrix(true, true);
    b = boxOf(root);
  }

  // 4. Ставим на землю, центр по горизонтали в ноль.
  const c = b.getCenter(new THREE.Vector3());
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y -= b.min.y;
  root.updateWorldMatrix(true, true);

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  root.userData.size = boxOf(root).getSize(new THREE.Vector3());
  return root;
}

/**
 * Слить неподвижные части модели — по одному мешу на материал.
 *
 * Авторы режут модель как им удобно: пожарная машина приехала 126 отдельными
 * мешами на 2120 треугольников. Каждый меш — это вызов отрисовки, и одна
 * такая машина в трафике стоила дороже целого квартала домов. Треугольников
 * при слиянии не прибавляется, меняется только их развеска по вызовам.
 *
 * Колёса не трогаем: они вращаются и поворачиваются каждое само по себе,
 * слитые в кузов они бы намертво встали. Меши с несколькими материалами
 * тоже обходим — там своя разбивка по группам, ломать её не за чем.
 */
function compact(root) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  const слитые = [];

  const колесо = (o) => {
    for (let n = o; n; n = n.parent) if (WHEEL_NODE.test(n.name || '')) return true;
    return false;
  };

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || Array.isArray(o.material) || !o.material) return;
    if (колесо(o)) return;
    const g = o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
    слитые.push(o);
  });

  // Сливать нечего, если у каждого материала и так по одному мешу.
  if (слитые.length <= byMat.size) return root;

  const готовые = [];
  for (const [m, geos] of byMat) {
    let merged;
    if (geos.length === 1) merged = geos[0];
    else {
      // Разный набор атрибутов у кусков одного материала — законный случай
      // (у одного есть uv, у другого нет). mergeGeometries на таком падает,
      // и это не повод потерять модель: оставляем её неслитой.
      try { merged = mergeGeometries(geos, false); } catch { merged = null; }
      if (!merged) return root;
    }
    готовые.push(new THREE.Mesh(merged, m));
  }

  for (const o of слитые) if (o.parent) o.parent.remove(o);
  for (const m of готовые) {
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
  }
  return root;
}

// Материал кузова — тот, что покрывает больше всего треугольников среди
// «не служебных». Считать по площади надёжнее, чем угадывать по имени:
// у одного автора он «Blue», у другого «Material.007».
//
// Материалы С ТЕКСТУРОЙ исключены намеренно. Часть авторов (Kay Lousberg)
// красит всю машину одним атласом: кузов, стёкла, колёса и фары лежат на
// одной картинке под одним материалом. three.js умножает текстуру на color,
// поэтому «покраска кузова» затонировала бы такую модель целиком — вместе
// с колёсами. Такие модели оставляем в родных цветах: разнообразия меньше,
// зато машина выглядит машиной.
function findBodyMaterial(root, slot) {
  const score = new Map();
  root.traverse((o) => {
    if (!o.isMesh || WHEEL_NODE.test(o.name || '')) return;
    for (let parent = o.parent; parent; parent = parent.parent) if (WHEEL_NODE.test(parent.name || '')) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const positions = o.geometry.attributes.position, indices = o.geometry.index;
    const count = indices ? indices.count : positions.count;
    let area = 0;
    const first = new THREE.Vector3(), second = new THREE.Vector3(), third = new THREE.Vector3();
    for (let index = 0; index < count; index += 3) {
      first.fromBufferAttribute(positions, indices ? indices.getX(index) : index);
      second.fromBufferAttribute(positions, indices ? indices.getX(index + 1) : index + 1);
      third.fromBufferAttribute(positions, indices ? indices.getX(index + 2) : index + 2);
      area += second.sub(first).cross(third.sub(first)).length() / 2;
    }
    for (const m of mats) {
      if (!m || m.map) continue;
      if (vehicleMaterialRole(m, slot) !== 'paint') continue;
      if (m.name && NON_BODY_MAT.test(m.name)) continue;
      score.set(m, (score.get(m) || 0) + area);
    }
  });
  let best = null, bestN = -1;
  for (const [m, n] of score) if (n > bestN) { best = m; bestN = n; }
  return best;
}

export class ModelLibrary {
  constructor() {
    this.templates = new Map();   // slot -> { root, bodyMat }
    this.failed = [];
  }

  /**
   * entries: [{ slot, url, orient, fitZ, fitY }]. Грузим параллельно — модели
   * мелкие, а последовательная загрузка двух десятков файлов заметно тормозит
   * старт. Промах по одной модели не должен ронять игру: слот просто останется
   * пустым, и вызывающий код откатится на процедурную геометрию.
   */
  async preload(entries) {
    await Promise.all(entries.map(async (e) => {
      try {
        const gltf = await loadGLB(e.url);
        const approved = gltf.scene.getObjectByName('STA_approved');
        const root = approved ? gltf.scene : compact(calibrate(gltf.scene, e));
        if (approved) {
          root.userData.approvedFleet = true;
          root.userData.size = new THREE.Vector3(...approved.userData.size);
          root.traverse(node => { if(node.isMesh){node.castShadow=true;node.receiveShadow=true;} });
        } else if (e.orient) {
          prepareVehicleModel(root, e.slot);
          prepareVehicleSurfaceUVs(root, e.slot);
        }
        this.templates.set(e.slot, { root, bodyMat: approved ? null : findBodyMaterial(root, e.slot) });
      } catch (err) {
        this.failed.push({ slot: e.slot, error: String(err.message || err) });
      }
    }));
    return this.templates.size;
  }

  has(slot) { return this.templates.has(slot); }

  /** Просто копия модели — для единичных объектов. */
  instanceProp(slot) {
    const t = this.templates.get(slot);
    return t ? t.root.clone(true) : null;
  }

  /**
   * Геометрия модели, «запечённая» в систему координат её корня, по одной
   * записи на материал.
   *
   * Нужно для того, что ставится сотнями: деревьев в городе под девятьсот,
   * и отдельным Object3D на каждое дерево игра захлебнётся. InstancedMesh
   * рисует их одним вызовом, но требует голую геометрию — поэтому здесь
   * трансформации узлов вплавляются в вершины, а вызывающий код получает
   * пары «геометрия + материал», по InstancedMesh на каждую.
   */
  bakedParts(slot) {
    const t = this.templates.get(slot);
    if (!t) return null;
    t.root.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(t.root.matrixWorld).invert();
    const out = [];
    t.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      out.push({ geometry: g, material: mats[0] });
    });
    return out.length ? out : null;
  }

  /**
   * Машина в том же виде, в каком её отдаёт процедурный buildCarMesh():
   * { group, wheels, lightbar, brakeLights, headLights, body }.
   * Благодаря этому класс Vehicle не знает, откуда взялся меш.
   */
  buildVehicle(slot, color) {
    const t = this.templates.get(slot);
    if (!t) return null;

    const group = t.root.clone(true);
    const headLights = [], brakeLights = [], sirenMaterials = [];
    let bodyMesh = null;

    // Материалы: клонируем только те, что игра меняет по ходу дела.
    // Остальные оставляем общими — это десятки машин на карте.
    const remap = new Map();

    group.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      let wheelPart = false;
      for (let parent = o; parent; parent = parent.parent) wheelPart ||= WHEEL_NODE.test(parent.name || '');
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => {
        if (!m) return m;
        const isBody = !wheelPart && (m.userData.staPaintMask || (slot === 'bike' && m.name === 'red_paint') || (t.bodyMat && m.name === t.bodyMat.name));
        const isHead = m.userData.staLamp === 'head' || (m.name && HEADLIGHT_MAT.test(m.name));
        const isTail = m.userData.staLamp === 'brake' || (m.name && TAILLIGHT_MAT.test(m.name));
        const role = isBody ? 'paint' : vehicleMaterialRole(m, slot, wheelPart);
        const key = `${m.uuid}:${role}:${wheelPart}`;
        const c = remap.has(key) ? remap.get(key) : t.root.userData.approvedFleet ? m.clone() : enhanceVehicleMaterial(m, role, wheelPart);
        remap.set(key, c);
        c.userData.vehicleRole = role;
        c.userData.vehiclePaint = !!isBody;
        if (m.userData.staLamp) {
          c.emissiveMap = c.map; c.emissive.setHex(0xffffff); c.emissiveIntensity = 0;
          if (m.userData.staLamp.startsWith('siren') && !sirenMaterials.includes(c)) sirenMaterials.push(c);
        }
        if (isBody) { c.color.setHex(color); if (!bodyMesh) bodyMesh = o; }
        if (m.userData.staPaintMask) {
          c.onBeforeCompile = shader => {
            shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
              #ifdef USE_MAP
                vec4 samplePaint = texture2D(map, vMapUv);
                diffuseColor.rgb = mix(samplePaint.rgb, samplePaint.rgb * diffuse, samplePaint.a);
              #endif
            `);
          };
          c.customProgramCacheKey = () => 'STA-paint-mask-v1';
        }
        if (isHead && !headLights.includes(c)) headLights.push(c);
        if (isTail && !brakeLights.includes(c)) brakeLights.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });


    // Колёса вынимаем из иерархии и вешаем на собственные группы, чтобы
    // вращение шло вокруг центра колеса, а не вокруг начала координат модели.
    // Порядок важен: Vehicle рулит первыми двумя (см. wheels[i], i < 2).
    // Берём ВЕРХНИЙ узел колеса, а не каждый меш внутри него: часть моделей
    // разбита по материалам (шина и диск — отдельные меши с тем же именем),
    // и по мешам колёс насчитывалось вдвое больше. Каждый кусок получал бы
    // свою ось вращения по своему центру — колесо разъезжалось бы на ходу.
    const found = [];
    group.updateWorldMatrix(true, true);
    group.traverse((o) => {
      if (!WHEEL_NODE.test(o.name || '')) return;
      if (o.parent && WHEEL_NODE.test(o.parent.name || '')) return;
      found.push(o);
    });

    const wheels = [];
    for (const node of found) {
      // Центр колеса — в системе координат group, а не мира: pivot будет
      // её ребёнком. Вращать надо вокруг центра колеса, иначе оно ходит
      // по дуге вокруг центра машины.
      const centreWorld = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
      const centreLocal = group.worldToLocal(centreWorld.clone());

      const pivot = new THREE.Group();
      pivot.position.copy(centreLocal);
      group.add(pivot);
      // attach() переносит узел в pivot, сам пересчитывая локальную матрицу
      // так, что в мире ничего не сдвинулось. Вручную вычитать координаты
      // нельзя: у родителей свои трансформации, и системы координат разъезжаются.
      pivot.attach(node);

      wheels.push({ pivot, z: centreLocal.z, front: FRONT_WHEEL_NODE.test(node.name) });
    }
    // Передние — вперёд списка: сначала по явному имени, потом по координате.
    wheels.sort((a, b) => (b.front - a.front) || (b.z - a.z));

    return {
      group,
      wheels: wheels.map((w) => w.pivot),
      lightbar: null,          // навешивает вызывающий код: мигалка — игровая логика
      brakeLights,
      headLights,
      sirenMaterials,
      body: bodyMesh,
      size: t.root.userData.size,   // реальные габариты после калибровки
    };
  }
}


export const MODELS = new ModelLibrary();
