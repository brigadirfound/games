import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { WEAPON_FIT } from './weapon-fit.js';

const glove = new THREE.MeshStandardMaterial({ color: 0x303532, roughness: .87 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x151b1b, roughness: .66 });
const templates = new Map(), actors = new WeakMap();
function handTemplate(side, grip = 'fore') {
  const key = side + '-' + grip;
  if (templates.has(key)) return templates.get(key);
  const soft = [], hard = [], axis = new THREE.Vector3(0, 1, 0);
  const ellipsoid = (position, scale, output = soft) => {
    const geo = new THREE.SphereGeometry(1, 12, 8); geo.scale(...scale); geo.translate(...position); output.push(geo.toNonIndexed());
  };
  const segment = (start, end, radius, output = soft) => {
    const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end), vector = to.clone().sub(from);
    const geo = new THREE.CylinderGeometry(radius * .92, radius, vector.length(), 8);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(axis, vector.clone().normalize()));
    geo.translate(...from.add(to).multiplyScalar(.5).toArray()); output.push(geo.toNonIndexed());
    ellipsoid(end, [radius, radius, radius], output);
  };
  ellipsoid([0, 0, .010], [.026, .018, .030]);
  ellipsoid([.004, -.017, -.015], [.024, .007, .012], hard);
  if (grip === 'fore') {
    ellipsoid([-.016, .002, .046], [.020, .014, .022]);
    for (const offset of [-.014, 0, .014]) {
      segment([-.018, offset, .038], [-.022, offset - .006, .056], .0065);
      segment([-.022, offset - .006, .056], [-.010, offset - .008, .066], .006);
    }
    segment([-.022, .022, .026], [-.038, .021, .042], .008);
  } else {
    ellipsoid([-.020, .004, .034], [.022, .016, .025]);
    for (const offset of [-.016, 0, .016]) {
      segment([-.024, offset, .034], [-.022, offset, .052], .0065);
      segment([-.022, offset, .052], [-.008, offset, .060], .006);
    }
    segment([-.022, .024, .022], [-.040, .019, .038], .008);
  }  const group = new THREE.Group(); group.name = 'WeaponGrip-' + side;
  for (const [geometries, material] of [[soft, glove], [hard, rubber]]) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    geometries.forEach(geo => geo.dispose()); mesh.castShadow = true; group.add(mesh);
  }
  if (side === 'l' && grip !== 'fore') {
    group.scale.x = -1;
    if (grip === 'cup') group.scale.set(-1.12, 1.04, 1.08);
  }
  templates.set(key, group); return group;
}function prepare(actor) {
  const state = { meshes: [], hands: [] };
  actors.set(actor, state);
  return state;
}export function updateGripHands(actor, holder, active) {
  if (!actor.skin || actor.skin.modelId) return;
  let state = actors.get(actor);
  if (!active && !state) return;
  if (!state) state = prepare(actor);
  for (const entry of state.hands) entry.hand.visible = false;
}