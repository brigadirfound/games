// Превью скина для магазина: рендерим НАСТОЯЩУЮ модель бойца из voxel.js,
// а не рисованную картинку. Игрок видит ровно то, что получит в бою, и ассетов
// не прибавляется. Раньше скин показывали тремя цветными точками по 14 px —
// по ним нельзя было понять, как выглядит боец.
//
// Рендерер отдельный от игрового и создаётся лениво: контекст живёт только пока
// открыт магазин, дальше его можно отпустить через dispose().
import * as THREE from 'three';
import { buildFighter, buildHookHead } from './voxel.js';

const SIZE = 192;
const cache = new Map();
let ctx = null;

function setup() {
  if (ctx) return ctx;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);

  const scene = new THREE.Scene();
  // свет тот же, что на арене, иначе превью врёт по цвету
  scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x5d7787, 1.0));
  const sun = new THREE.DirectionalLight(0xfff4e0, 0.75);
  sun.position.set(6, 10, 8);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(2.6, 2.35, 3.6);
  camera.lookAt(0, 1.0, 0);

  ctx = { renderer, scene, camera };
  return ctx;
}

/**
 * data:URL с портретом бойца в этом облике. Кэш по id; для «своего цвета» id
 * всегда один и тот же, поэтому при кручении ползунков кэш обходится флагом.
 */
export function skinPreview(skin, fresh = false) {
  if (!fresh && cache.has(skin.id)) return cache.get(skin.id);

  const { renderer, scene, camera } = setup();
  const fighter = buildFighter(skin, skin.accent);
  // лицо и борода смотрят в −z, камера стоит в +z: без разворота на π виден затылок.
  // Небольшой довесок даёт три четверти — видно и лицо, и плечо с багром.
  fighter.rotation.y = Math.PI * 0.88;
  scene.add(fighter);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(fighter);

  // геометрия и материалы созданы на каждый вызов — освобождаем сразу
  fighter.traverse((o) => {
    o.geometry?.dispose?.();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose?.();
  });

  cache.set(skin.id, url);
  return url;
}

/** Превью облика багра: крюк с куском цепи, тем же рендером. */
export function hookPreview(hookSkin) {
  const key = 'hook:' + hookSkin.id;
  if (cache.has(key)) return cache.get(key);

  const { renderer, scene, camera } = setup();
  const g = new THREE.Group();
  const head = buildHookHead(hookSkin);
  head.scale.setScalar(2.6);
  g.add(head);

  // короткая цепь позади крюка — видно цвет обмотки и металла разом
  const linkGeo = new THREE.BoxGeometry(0.13, 0.13, 0.34);
  const linkMat = new THREE.MeshLambertMaterial({ color: hookSkin.iron, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(linkGeo, linkMat);
    l.scale.setScalar(2.6);
    l.position.set(0, -0.42 * i * 0.9, 0.62 * i * 0.9);
    g.add(l);
  }
  g.position.set(0, 1.15, 0);
  g.rotation.set(-0.25, Math.PI * 0.82, 0.35);
  scene.add(g);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(g);
  linkGeo.dispose(); linkMat.dispose();
  head.geometry?.dispose?.();
  if (Array.isArray(head.material)) head.material.forEach((m) => m.dispose());
  else head.material?.dispose?.();

  cache.set(key, url);
  return url;
}

/** Отпустить GL-контекст: зовётся при уходе из магазина. */
export function disposePreviews() {
  ctx?.renderer.dispose();
  ctx = null;
}
