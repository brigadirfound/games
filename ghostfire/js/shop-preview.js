// Живой показ скина в магазине: боец крутится на подиуме, вокруг его оружие.
//
// ЗАЧЕМ. Раньше магазин показывал плоскую карточку-картинку, и что именно
// покупаешь, было непонятно: цвет угадывался, а маска, нагрудный знак и раскраска
// оружия не показывались вовсе. Теперь это тот же боец из тех же FIGURE_PARTS,
// что выйдет в бой, — увидеть можно всё, включая некупленное.
//
// Сцена одна на весь магазин: пересобирается только фигура. Заводить рендерер
// на каждую карточку — это семь контекстов WebGL на экране, чего браузеры не
// прощают.
import * as THREE from 'three';
import { FIGURE_PARTS, partArt } from './figure.js';
import { boxMaterials, artFaceIndices } from './face.js';
import { getSkinSurface, scaleBoxUV, tileCanvas, onAtlasReady } from './textures.js';
import { buildWeaponModel, disposeWeaponModel } from './weapons.js';

let renderer = null;
let scene = null;
let camera = null;
let figure = null;
let arsenal = null;      // оружие живёт отдельно: с фигурой оно крутилось вместе
let weapons = [];
let raf = 0;
let angle = 0;
let вращать = true;

function собратьСцену(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;

  scene = new THREE.Scene();
  // Дальше и ниже прежнего: боец влезал в кадр по грудь, а подиум занимал треть.
  camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 1.25, 5.9);
  camera.lookAt(0, 0.92, 0);

  scene.add(new THREE.HemisphereLight('#bcd4e8', '#2a2438', 0.78));
  const sun = new THREE.DirectionalLight('#fff4d6', 2.4);
  sun.position.set(2.6, 4.4, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -3; sun.shadow.camera.right = 3;
  sun.shadow.camera.top = 3.4; sun.shadow.camera.bottom = -1;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight('#8fb4dd', 0.5);
  fill.position.set(-2.6, 1.8, -2);
  scene.add(sun, fill);

  const холст = tileCanvas('stone', '#6a7484', 256);
  const тайл = new THREE.CanvasTexture(холст);
  тайл.colorSpace = THREE.SRGBColorSpace;
  тайл.wrapS = тайл.wrapT = THREE.RepeatWrapping;
  тайл.repeat.set(2, 2);
  onAtlasReady(() => { tileCanvas('stone', '#6a7484', 256, холст); тайл.needsUpdate = true; });
  const podium = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5, 1.62, 0.18, 24),
    new THREE.MeshLambertMaterial({ map: тайл }),
  );
  podium.position.y = -0.09;
  podium.receiveShadow = true;
  scene.add(podium);
}

function убратьФигуру() {
  if (arsenal) { scene.remove(arsenal); arsenal = null; }
  if (figure) {
    scene.remove(figure);
    figure.traverse((o) => {
      o.geometry?.dispose?.();
      const m = Array.isArray(o.material) ? o.material : [o.material];
      m.forEach((x) => x?.dispose?.());
    });
    figure = null;
  }
  weapons.forEach(disposeWeaponModel);
  weapons = [];
}

/** Показать скин. Вызывается на каждый выбор карточки. */
export function showSkin(skin) {
  if (!renderer) return;
  убратьФигуру();
  figure = new THREE.Group();

  const mat = (hex) => new THREE.MeshLambertMaterial({ color: hex, map: getSkinSurface(skin.id) });
  for (const d of FIGURE_PARTS) {
    const art = partArt(d, skin.art);
    const geo = scaleBoxUV(new THREE.BoxGeometry(d.size[0], d.size[1], d.size[2]), Math.max(...d.size), artFaceIndices(art));
    const mesh = new THREE.Mesh(geo, art ? boxMaterials(mat, skin.body[d.color], art) : mat(skin.body[d.color]));
    mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
    mesh.castShadow = true;
    figure.add(mesh);
  }

  /*
    Оружие — по бокам и НЕ в группе фигуры.

    Первый вариант складывал стволы внутрь figure: они крутились вместе с
    бойцом и раз в оборот проезжали поперёк его груди, закрывая и маску, и
    нагрудный знак — то есть ровно то, ради чего показ и делался.

    Теперь это отдельная неподвижная группа: три ствола слева, три справа,
    лесенкой по высоте. Середина кадра остаётся за бойцом.
  */
  arsenal = new THREE.Group();
  [0, 1, 2, 3, 4, 5].forEach((id) => {
    const w = buildWeaponModel(id, skin);
    const слева = id < 3;
    const ряд = слева ? id : id - 3;
    const x = (слева ? -1 : 1) * 1.75;
    w.position.set(x, 0.45 + ряд * 0.52, -0.15);
    w.rotation.y = слева ? Math.PI * 0.5 : -Math.PI * 0.5;
    w.castShadow = true;
    weapons.push(w);
    arsenal.add(w);
  });

  // Каждый выбор начинается с лица: угол подхватывался от прошлого скина, и
  // новая карточка могла встретить покупателя затылком.
  angle = 0;
  scene.add(figure, arsenal);
}

/*
  Замок не трогает сцену: он рисуется поверх, в разметке.

  Скорость у всех одна. Раньше закрытый скин крутился вдвое медленнее «витрины
  ради», и на деле это читалось поломкой: надетый «Стандарт» вертелся заметно
  быстрее соседей, будто у него что-то сбилось. Разная скорость ничего не
  сообщала — про замок говорит сам замок.
*/
export function setLocked(locked) {
  вращать = true;
  void locked;
}

function кадр() {
  raf = requestAnimationFrame(кадр);
  if (!renderer || !figure) return;
  const c = renderer.domElement;
  const w = c.clientWidth, h = c.clientHeight;
  if (w && h && (c.width !== w * renderer.getPixelRatio() || c.height !== h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (вращать) angle += 0.006;
  figure.rotation.y = angle + Math.PI;   // рисунок лежит на грани -z: доворот на пол-оборота
  renderer.render(scene, camera);
}

export function mount(canvas) {
  if (renderer && renderer.domElement === canvas) return;
  dispose();
  собратьСцену(canvas);
  angle = 0;
  cancelAnimationFrame(raf);
  кадр();
}

export function dispose() {
  cancelAnimationFrame(raf);
  raf = 0;
  убратьФигуру();
  renderer?.dispose?.();
  renderer = null;
  scene = null;
  camera = null;
}
