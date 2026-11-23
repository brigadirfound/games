import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone } from '../vendor/SkeletonUtils.js';
import { attachHero } from './hero-model.js';
import { calibrateNpcFeet, createNpcAnimation } from './npc-animation.js';

export const NPC_MODELS = {
  brian: { height: 1.82, gender: 'male', label: 'Горожанин в поло' },
  leonard: { height: 1.85, gender: 'male', label: 'Горожанин в свитере' },
  james: { height: 1.80, gender: 'male', label: 'Горожанин в худи' },
  megan: { height: 1.70, gender: 'female', label: 'Горожанка в футболке' },
  louise: { height: 1.73, gender: 'female', label: 'Горожанка в костюме' },
  elizabeth: { height: 1.74, gender: 'female', label: 'Горожанка в полосатом джемпере' },
  alex: { height: 1.84, gender: 'male', label: 'Полиция' },
  swat: { height: 1.86, gender: 'male', label: 'Спецназ' },
};

const pools = {
  casual: ['brian', 'megan', 'elizabeth', 'leonard'],
  jacket: ['leonard', 'elizabeth', 'louise'],
  hoodie: ['james', 'james', 'megan'],
  suit: ['louise', 'leonard'],
  worker: ['brian', 'leonard', 'james'],
  dress: ['megan', 'louise', 'elizabeth'],
  track: ['james', 'brian', 'megan'],
};
const palettes = [[1, 1, 1], [.74, .84, 1], [.94, .78, .68], [.73, .91, .79], [.91, .72, .78]];
const assets = new Map();
const geometryCache = new Map();
const materialCache = new Map();
const links = [
  ['hip', 'Hips'], ['abdomen', 'Spine'], ['chest', 'Spine2'], ['neck', 'Neck'], ['head', 'Head'],
  ['rShldr', 'RightArm'], ['rForeArm', 'RightForeArm'], ['rHand', 'RightHand'],
  ['lShldr', 'LeftArm'], ['lForeArm', 'LeftForeArm'], ['lHand', 'LeftHand'],
  ['rThigh', 'RightUpLeg'], ['rShin', 'RightLeg'], ['rFoot', 'RightFoot'],
  ['lThigh', 'LeftUpLeg'], ['lShin', 'LeftLeg'], ['lFoot', 'LeftFoot'],
];

export function resolveNpcLook(opts) {
  if (!Number.isInteger(opts.npcVariant)) opts.npcVariant = Math.floor(Math.random() * palettes.length);
  if (opts.role === 'swat') opts.npcModel = 'swat';
  else if (opts.role === 'police') opts.npcModel = 'alex';
  else if (!NPC_MODELS[opts.npcModel]) {
    const pool = opts.gang ? ['james', 'leonard', 'brian', 'megan'] : pools[opts.outfit] || pools.casual;
    opts.npcModel = pool[Math.floor(Math.random() * pool.length)];
  }
  opts.gender = NPC_MODELS[opts.npcModel].gender;
  return opts;
}

export async function preloadNpcs() {
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(NPC_MODELS).map(async ([id, definition]) => {
    if (assets.has(id)) return;
    const asset = await loader.loadAsync(`./assets/models/characters/citizens/${id}.glb`);
    asset.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(asset.scene);
    const bones = Object.fromEntries(asset.scene.getObjectsByProperty('isBone', true)
      .map(bone => [bone.name.replace(/^mixamorig\d*:?/i, ''), bone]));
    for (const [, name] of links) if (!bones[name]) throw new Error(`NPC ${id}: missing ${name}`);
    const calibration = calibrateNpcFeet(asset.scene, bones);
    assets.set(id, { ...asset, bounds, calibration, scale: definition.height / (bounds.max.y - bounds.min.y) });
  }));
}

function clothingGeometry(mesh, asset, opts) {
  const key = `${opts.npcModel}|${mesh.geometry.uuid}|${opts.npcVariant}|${opts.gang || ''}|${opts.gang ? opts.shirt : ''}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const geometry = mesh.geometry.clone();
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const point = new THREE.Vector3();
  const tint = new THREE.Color().setRGB(...palettes[opts.npcVariant % palettes.length]);
  if (opts.gang) tint.set(opts.shirt).multiplyScalar(3.2).addScalar(.4);
  if (opts.role) tint.setRGB(1, 1, 1);
  const height = asset.bounds.max.y - asset.bounds.min.y;
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    const vertical = (point.y - asset.bounds.min.y) / height;
    const horizontal = Math.abs(point.x) / height;
    const torso = THREE.MathUtils.smoothstep(vertical, .52, .58)
      * (1 - THREE.MathUtils.smoothstep(vertical, .77, .81))
      * (1 - THREE.MathUtils.smoothstep(horizontal, .10, .14));
    colors[index * 3] = THREE.MathUtils.lerp(1, tint.r, torso);
    colors[index * 3 + 1] = THREE.MathUtils.lerp(1, tint.g, torso);
    colors[index * 3 + 2] = THREE.MathUtils.lerp(1, tint.b, torso);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometryCache.set(key, geometry);
  return geometry;
}

export function attachNpc(character, opts = {}) {
  resolveNpcLook(opts);
  const asset = assets.get(opts.npcModel);
  if (!asset) throw new Error(`NPC model not preloaded: ${opts.npcModel}`);
  if (!Number.isFinite(opts.npcPhase)) opts.npcPhase = Math.random();
  const motionState = { speed: 0, strideScale: NPC_MODELS[opts.npcModel].height / 1.91 };
  const motion = attachHero(character, { ...opts, hero: false, animationProxy: true, motionState });
  if (!motion) throw new Error('NPC motion source not preloaded');
  motion.root.visible = false;
  const root = clone(asset.scene);
  root.name = `CitizenModel:${opts.npcModel}`;
  root.userData.npcModel = opts.npcModel;
  root.updateMatrixWorld(true);
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry = clothingGeometry(mesh, asset, opts);
    const prepareMaterial = original => {
      if (!materialCache.has(original.uuid)) {
        const material = original.clone();
        material.roughness = .88;
        material.metalness = 0;
        material.color.multiplyScalar(.68);
        material.vertexColors = true;
        if (material.map) material.map.anisotropy = 4;
        materialCache.set(original.uuid, material);
      }
      return materialCache.get(original.uuid);
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(prepareMaterial) : prepareMaterial(mesh.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
  });
  const namedBones = Object.fromEntries(root.getObjectsByProperty('isBone', true)
    .map(bone => [bone.name.replace(/^mixamorig\d*:?/i, ''), bone]));
  const bindings = links.map(([sourceName, targetName]) => {
    const source = motion.bones[sourceName];
    const target = namedBones[targetName];
    return { source, target, correction: motion.bind.get(source).world.clone().invert()
      .multiply(target.getWorldQuaternion(new THREE.Quaternion())) };
  });
  const bones = Object.fromEntries(links.map(([source, target]) => [source, namedBones[target]]));
  const hipRest = bones.hip.position.clone();
  const sourceHipRest = motion.bind.get(motion.bones.hip).position;
  root.scale.multiplyScalar(asset.scale);
  root.position.y -= asset.bounds.min.y * asset.scale;
  character.mesh.scale.set(
    THREE.MathUtils.lerp(1, character.mesh.scale.x, .55),
    THREE.MathUtils.lerp(1, character.mesh.scale.y, .5),
    THREE.MathUtils.lerp(1, character.mesh.scale.z, .55));
  character.mesh.add(root);
  const animation = createNpcAnimation({ character, root, bones, namedBones, calibration: asset.calibration,
    definition: NPC_MODELS[opts.npcModel], phase: opts.npcPhase, scale: asset.scale });
  motion.mixer.setTime(opts.npcPhase * motion.actions.idle.getClip().duration);
  const world = new THREE.Quaternion();
  const parent = new THREE.Quaternion();
  const translation = new THREE.Vector3();
  function syncPose() {
    translation.copy(motion.bones.hip.position).sub(sourceHipRest).multiplyScalar(1.08 / asset.scale);
    bones.hip.position.copy(hipRest).add(translation);
    character.mesh.updateMatrixWorld(true);
    for (const binding of bindings) {
      binding.source.getWorldQuaternion(world).multiply(binding.correction);
      binding.target.parent.getWorldQuaternion(parent).invert();
      binding.target.quaternion.copy(parent.multiply(world));
      binding.target.updateMatrixWorld(true);
    }
    root.updateMatrixWorld(true);
  }
  syncPose();
  const rightBinding = bindings.find(binding => binding.source.name === 'rHand');
  const leftBinding = bindings.find(binding => binding.source.name === 'lHand');
  const socket = new THREE.Group(); socket.name = 'NpcWeaponSocket';
  socket.quaternion.copy(rightBinding.correction).invert().multiply(motion.socket.quaternion);
  bones.rHand.add(socket);
  const weaponHandDelta = rightBinding.correction.clone().invert()
    .multiply(motion.weaponHandDelta).multiply(leftBinding.correction);
  return { root, bones, animation, socket, weaponHandDelta, modelId: opts.npcModel, look: opts, motionRoot: motion.root,
    mixer: motion.mixer, actions: motion.actions, update(dt, game) {
      character.skin?.restoreWeaponPose?.();
      if (!Number.isFinite(dt) || dt <= 0) return;
      Object.assign(motionState, animation.prepare(dt));
      motion.update(dt, game);
      syncPose();
      animation.update(dt);
    } };
}
