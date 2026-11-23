// Кисти от первого лица. Вынесены из player.js, чтобы стенд позы вьюмодели и
// игра строили одну и ту же геометрию.
import * as THREE from 'three';
import { getSkinSurface, scaleBoxUV } from './textures.js';
import { boxMaterials, artFaceIndices, rotateArt } from './face.js';

// Базовый разворот кистей. Без него предплечье шло строго вдоль ствола и рука
// выглядела бруском: теперь она приходит снизу-сбоку под ~45°, как у живого
// хвата. y разводит руки наружу, x опускает локоть, z доворачивает кулак.
export const HAND_REST = Object.freeze({
  right: { x: 0.5, y: 0.34, z: -0.16 },
  left: { x: 0.58, y: -0.46, z: 0.18 },
  // Пистолет держат одной рукой и ближе к оси прицеливания: сильный разворот
  // под двуручный хват делал кисть вывернутой.
  rightOneHanded: { x: 0.34, y: 0.16, z: -0.06 },
});

// Кулак на 0.3 м от глаза занимал треть кадра — кисти уменьшены и отодвинуты.
export const HAND_SCALE = Object.freeze({ right: 0.78, left: 0.72 });

/** Маленький кулак + манжета + предплечье, цвета кожи/рукава скина. */
export function buildHand(skin) {
  const g = new THREE.Group();
  // Та же карта, что у бойца на арене: руки перед глазами не должны быть
  // гладкими, когда противник в двух метрах — фактурный.
  const surface = getSkinSurface(skin.id);
  const skinMat = new THREE.MeshLambertMaterial({ color: skin.body.arms, map: surface });
  const sleeveMat = new THREE.MeshLambertMaterial({ color: skin.body.torso, map: surface });
  // яркая полоска цветом трассера — чтобы кисть не сливалась с тёмными
  // пушками/скинами (Пустота и т.п.), где кожа/торс почти чёрные
  const trimMat = new THREE.MeshBasicMaterial({ color: skin.tracer });

  /*
    Рукав перед глазами — тот же, что на руке бойца.

    Кисть красилась двумя плоскими цветами из скина, и когда у бойца появились
    наплечник, налокотник и манжета, собственная рука игрока осталась
    единственным местом, где от скина был только оттенок. Берём тот же рисунок
    рукава, что лежит на руках модели, и поворачиваем на четверть: полосы
    нарисованы под вертикальную руку, а предплечье во вьюмодели вытянуто вдоль
    взгляда. Нет рисунка (пользовательский скин, старая сборка) — остаётся
    прежняя заливка.
  */
  const рукав = skin.art?.arm ? rotateArt(skin.art.arm) : null;
  // Перёд и зад предплечья не трогаем: перёд упирается в кулак, зад в камеру.
  const грани = рукав ? { side: рукав, top: рукав, bottom: рукав } : null;
  const пропуск = грани ? artFaceIndices(грани) : false;
  const рукавныйМат = () => (грани
    ? boxMaterials((hex) => new THREE.MeshLambertMaterial({ color: hex, map: surface }),
      skin.body.torso, грани)
    : sleeveMat);

  const fist = new THREE.Mesh(scaleBoxUV(new THREE.BoxGeometry(0.15, 0.15, 0.22), 0.22), skinMat);
  fist.position.set(0, 0, 0.03);
  const sleeve = new THREE.Mesh(
    scaleBoxUV(new THREE.BoxGeometry(0.18, 0.18, 0.16), 0.18, пропуск), рукавныйМат());
  sleeve.position.set(0, -0.03, 0.21);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.035, 0.05), trimMat);
  trim.position.set(0, 0.055, 0.15);
  // Предплечье: без него кисть читалась обрубком, торчащим вдоль ствола.
  const forearm = new THREE.Mesh(
    scaleBoxUV(new THREE.BoxGeometry(0.15, 0.15, 0.34), 0.34, пропуск), рукавныйМат());
  forearm.position.set(0, -0.05, 0.44);
  fist.castShadow = sleeve.castShadow = forearm.castShadow = true;
  g.add(fist, sleeve, trim, forearm);
  return g;
}
