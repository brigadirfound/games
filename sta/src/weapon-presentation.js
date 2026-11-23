import * as THREE from 'three';
import { WEAPONS, buildWeaponMesh, animateWeapon } from './weapons.js';
import { makeLimbSolver } from './npc-animation.js';
import { updateGripHands } from './weapon-hands.js';
import { WEAPON_FIT } from './weapon-fit.js';

const solver = makeLimbSolver();
const target = new THREE.Vector3(), pole = new THREE.Vector3(), local = new THREE.Vector3();
const handRotation = new THREE.Quaternion(), gunRotation = new THREE.Quaternion(), correction = new THREE.Quaternion();
const clamp = THREE.MathUtils.clamp;
const stanceFrames = new WeakMap();
function shoulderStance(actor, amount) {
  const bones = actor.skin.bones;
  let frames = stanceFrames.get(actor);
  if (!frames) {
    frames = new Map(); stanceFrames.set(actor, frames);
    actor.skin.restoreWeaponPose = () => {
      for (const [bone, frame] of frames) {
        if (frame.before) bone.quaternion.copy(frame.before);
        if (frame.position) bone.position.copy(frame.position);
      }
      frames.clear(); actor.mesh.updateMatrixWorld(true);
    };
  }
  const collar = bones.lCollar || bones.lShldr.parent;
  for (const [bone, angle] of [[bones.chest, -amount], [bones.head, amount], [collar, -amount * .65]]) {
    const before = bone.quaternion.clone();
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(actor.mesh.getWorldQuaternion(new THREE.Quaternion()));
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
    bone.updateMatrixWorld(true); frames.set(bone, { before });
  }
}
function poseArms(actor, holder, { id, aim = 0, pitch = 0, progress = 0, reloading = false, recoil = 0, first = false }) {
  const skin = actor.skin, definition = WEAPONS[id];
  if (!skin?.socket || !definition?.capacity || actor.dead || actor.inVehicle || actor.kickT > 0) return;
  const model = holder.children[0];
  if (!model) return;
  const fit = WEAPON_FIT[id];
  const fetch = reloading ? Math.sin(progress * Math.PI) : 0;
  const desiredPitch = pitch - (1 - aim) * (first ? .12 : .24) + fetch * .28 + recoil * .04;
  skin.restoreWeaponPose?.();
  actor.mesh.updateMatrixWorld(true);
  shoulderStance(actor, id === 'pistol' ? .16 : .62);
  const scale = skin.socket.getWorldScale(new THREE.Vector3());
  const heldScale = first ? 1 : ({ pistol: .64, uzi: .60, shotgun: .56, rifle: .54, rocket: .52, ak47: .64, m4a1: .64 }[id] || .68);
  holder.scale.set(1 / scale.x, 1 / scale.z, 1 / scale.y);
  holder.position.set(0, -.075 / scale.y, .065 / scale.z);
  holder.updateMatrixWorld(true);
  const desiredGrip = model.localToWorld(new THREE.Vector3(0, -.065, -.075));
  holder.scale.set(heldScale / scale.x, heldScale / scale.z, heldScale / scale.y);
  holder.updateMatrixWorld(true);
  if (!first) {
    const scaledGrip = model.localToWorld(new THREE.Vector3(0, -.065, -.075));
    const parent = holder.parent;
    holder.position.add(desiredGrip.sub(scaledGrip).applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert()).divide(parent.getWorldScale(new THREE.Vector3())));
    holder.updateMatrixWorld(true);
  }
  holder.getWorldQuaternion(correction).invert().multiply(skin.bones.rHand.getWorldQuaternion(handRotation));
  actor.mesh.getWorldQuaternion(gunRotation);
  gunRotation.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-desiredPitch, fetch * .20, fetch * -.30)));
  handRotation.copy(gunRotation).multiply(correction);
  local.fromArray(fit.hip).lerp(new THREE.Vector3(...fit.aim), aim);
  if (skin.modelId) {
    const shoulder = actor.mesh.worldToLocal(skin.bones.rShldr.getWorldPosition(new THREE.Vector3()));
    local.y = local.y * shoulder.y / 1.52 + (1 - aim) * .05; local.x *= .9; local.z -= .09;
  }
  const shoulderDistance = id === 'rifle' || id === 'rocket' ? .38 : id === 'shotgun' ? .34 : .28;
  local.y += Math.sin(pitch) * (first ? 0 : shoulderDistance) - fetch * .05 - (first ? 0 : actor.crouch * .35);
  if (!first) {
    const pitchOffset = (Math.cos(pitch) - 1) * shoulderDistance;
    local.z += id === 'shotgun' && pitch < 0 ? Math.max(pitchOffset, .016) : Math.max(pitchOffset, -.012);
  }
  local.z += fetch * .06 - recoil * .016;
  if (!first) {
    local.z += id === 'uzi' ? -.05 : id === 'shotgun' ? -.08 : 0;
    if (id === 'uzi' && pitch < 0) local.y += .055;
  }
  target.copy(local); actor.mesh.localToWorld(target);
  target.sub(new THREE.Vector3(0, .065 * heldScale, .075 * heldScale).applyQuaternion(gunRotation));
  if (first) for (const side of ['r', 'l']) {
    const shoulder = skin.bones[side + 'Shldr'];
    stanceFrames.get(actor).set(shoulder, { position: shoulder.position.clone() });
    local.set(-.10, -.45, -.26);
    if (side === 'l') local.fromArray(fit.support).add(new THREE.Vector3(.12, -.42 + .065, -.24 + .075));
    local.applyQuaternion(gunRotation).add(target);
    shoulder.position.copy(shoulder.parent.worldToLocal(local)); shoulder.updateMatrixWorld(true);
  }
  pole.set(-.44,
    first ? .88 : 1.06 + Math.sin(pitch) * .18 - actor.crouch * .35, .12); actor.mesh.localToWorld(pole);
  if (first) pole.set(-.12, -.26, -.10).applyQuaternion(gunRotation).add(target);
  solver(skin.bones.rShldr, skin.bones.rForeArm, skin.bones.rHand, target, pole, handRotation);
  holder.updateMatrixWorld(true);
  model.getObjectByName(reloading ? 'magazineSocket' : 'support').getWorldPosition(target);
  if (reloading) {
    const mag = model.getObjectByName('magazine');
    if (mag) target.y += mag.position.y;
    local.set(.19, .86, .18); actor.mesh.localToWorld(local);
    const reach = progress < .18 ? progress / .18 : progress < .40 ? 1 - (progress - .18) / .22
      : progress < .66 ? (progress - .40) / .26 : progress < .85 ? 1 : (1 - progress) / .15;
    if (progress < .66) target.lerp(local, 1 - clamp(reach, 0, 1));
    else if (progress > .85) {
      model.getObjectByName('support').getWorldPosition(local); target.lerp(local, 1 - clamp(reach, 0, 1));
    }
  }
  pole.set(.46, first ? .88 : 1.04, .18); actor.mesh.localToWorld(pole);
  if (first) pole.set(.12, -.22, -.08).applyQuaternion(gunRotation).add(target);
  handRotation.multiply(skin.weaponHandDelta);
  solver(skin.bones.lShldr, skin.bones.lForeArm, skin.bones.lHand, target, pole, handRotation);
  actor.mesh.updateMatrixWorld(true);
}

export class WeaponPresentation {
  constructor(game) {
    this.game = game; this.aim = 0; this.recoil = 0; this.equip = 0;
    this.models = new Map(); this.npcs = new Map();
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(68, 1, .01, 5);
    this.fill = new THREE.HemisphereLight(0xcadbe6, 0x514d3d, 2.1); this.viewScene.add(this.fill);
    this.key = new THREE.DirectionalLight(0xffe5c2, 2.5); this.key.position.set(-3, 4, 1); this.viewScene.add(this.key);
    this.forward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  }
  ensureView() {
    if (this.viewActor) return;
    const game = this.game;
    this.viewActor = new game.player.constructor(game.city, 0, 0, { hero: true });
    const actor = this.viewActor;
    actor.skin.root.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const geometry = mesh.geometry.clone(), index = geometry.index, indices = [];
      const skinIndex = geometry.attributes.skinIndex, skinWeight = geometry.attributes.skinWeight;
      const armBones = new Set(mesh.skeleton.bones.map((bone, index) => /[rl](Shldr|ForeArm|Hand)/.test(bone.name) ? index : -1));
      const armVertex = vertex => {
        let total = 0;
        for (const getter of ['getX', 'getY', 'getZ', 'getW'])
          if (armBones.has(skinIndex[getter](vertex))) total += skinWeight[getter](vertex);
        return total > .55;
      };
      for (let offset = 0; offset < (index?.count || geometry.attributes.position.count); offset += 3) {
        const triangle = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner);
        if (triangle.every(armVertex)) indices.push(...triangle);
      }
      geometry.setIndex(indices); mesh.geometry = geometry; mesh.castShadow = false;
    });
    this.viewHolder = new THREE.Group(); actor.skin.socket.add(this.viewHolder);
    this.viewHolder.position.set(0, -.075, .018); this.viewHolder.rotation.x = Math.PI / 2;
    this.viewScene.add(actor.mesh);
  }
  select(id) {
    this.id = id; this.equip = .22;
    if (!this.models.has(id)) this.models.set(id, buildWeaponMesh(id));
    this.game.weaponHolder.clear();
    const model = this.models.get(id);
    if (model) this.game.weaponHolder.add(model);
    if (this.viewHolder) { this.viewHolder.clear(); const view = buildWeaponMesh(id); if (view) this.viewHolder.add(view); }
  }
  shot() { this.recoil = 1; }
  update(dt) {
    const game = this.game, actor = game.player, state = game.weaponState;
    if (dt > 0) {
      this.aim += ((game.aimingDownSights && !state.reload ? 1 : 0) - this.aim) * (1 - Math.exp(-16 * dt));
      this.recoil = Math.max(0, this.recoil - dt * (game.weapon === 'shotgun' ? 2.8 : 8));
      this.equip = Math.max(0, this.equip - dt);
    }
    const config = { id: game.weapon, aim: this.aim, pitch: -game.cam.pitch, progress: state.progress,
      reloading: !!state.reload, recoil: this.recoil, loaded: state.loaded(game.weapon) };
    const visible = !actor.dead && !actor.inVehicle && !game.mount && game.weapon !== 'fist';
    if (!actor.inVehicle && !game.mount) actor.mesh.visible = actor.dead || !game.cam.isFirstPerson;
    game.weaponHolder.visible = visible && !game.cam.isFirstPerson;
    animateWeapon(game.weaponHolder.children[0], config);
    if (visible && !game.cam.isFirstPerson) poseArms(actor, game.weaponHolder, config);
    updateGripHands(actor, game.weaponHolder, visible && !game.cam.isFirstPerson);
    this.firstVisible = visible && game.cam.isFirstPerson && !(game.aimingDownSights && WEAPONS[game.weapon].scope);
    if (visible && game.cam.isFirstPerson) {
      this.ensureView();
      if (this.viewHolder.children[0]?.userData.weaponId !== game.weapon) {
        this.viewHolder.clear(); this.viewHolder.add(buildWeaponMesh(game.weapon));
      }
      const view = this.viewActor;
      const fit = WEAPON_FIT[game.weapon];
      const sway = Math.min(1, actor.speed / 3.4) * (1 - this.aim);
      view.mesh.position.set((fit.aim[0] + (fit.sightX || 0)) * this.aim + Math.sin(game.time * 7) * .006 * sway,
        -THREE.MathUtils.lerp(1.65, fit.aim[1] + WEAPONS[game.weapon].sight, this.aim)
          - this.equip * .7 + Math.cos(game.time * 14) * .005 * sway, 0);
      view.mesh.quaternion.copy(this.forward);
      view.speed = 0; view.skin.update(dt); view.mesh.updateMatrixWorld(true);
      animateWeapon(this.viewHolder.children[0], config);
      const stock = this.viewHolder.children[0].getObjectByName('stock');
      if (stock) stock.visible = false;
      poseArms(view, this.viewHolder, { ...config, first: true, pitch: 0 });
      updateGripHands(view, this.viewHolder, true);
      this.viewCamera.position.z = fit.camera;
      this.viewCamera.aspect = game.camera.aspect; this.viewCamera.fov = THREE.MathUtils.lerp(70, 64, this.aim); this.viewCamera.updateProjectionMatrix();
      this.viewCamera.updateMatrixWorld(true);
      this.fill.intensity = .85 + (1 - (game.nightFactor || 0)) * 1.25;
    }
    const active = new Set([...game.peds.filter(ped => ped.armed), ...game.copsOnFoot.map(cop => cop.c)]);
    for (const [npc, holder] of this.npcs) if (!active.has(npc)) { holder.removeFromParent(); npc.weaponEquipped = false; this.npcs.delete(npc); }
    for (const npc of active) {
      if (!npc.skin?.socket) continue;
      let holder = this.npcs.get(npc);
      if (!holder) {
        holder = new THREE.Group(); npc.skin.socket.add(holder); holder.position.set(0, -.075, .018); holder.rotation.x = Math.PI / 2;
        holder.add(buildWeaponMesh(npc.skin.modelId === 'swat' ? 'uzi' : npc.gang ? 'uzi' : 'pistol'));
        this.npcs.set(npc, holder);
      }
      holder.visible = !npc.dead && !npc.inVehicle;
      npc.weaponEquipped = holder.visible;
      const id = holder.children[0].userData.weaponId;
      if (npc.dead && !npc._weaponDropped && dt > 0) { npc._weaponDropped = true; game.spawnWeaponPickup(id, npc.x, npc.z); }
      if (holder.visible) {
        npc._weaponRecoil = Math.max(0, (npc._weaponRecoil || 0) - dt * 8);
        const options = { id, aim: npc.aiming ? 1 : 0, pitch: npc.aimPitch || 0, recoil: npc._weaponRecoil,
          reloading: npc.reloadT > 0, progress: 1 - (npc.reloadT || 0) / (npc.reloadDur || 1), loaded: npc._weaponMagazine ?? 1 };
        animateWeapon(holder.children[0], options); poseArms(npc, holder, options);
      }
    }
  }
  muzzle(out = new THREE.Vector3()) {
    const game = this.game;
    this.update(0);
    if (game.cam.isFirstPerson && this.viewHolder?.children[0]) {
      this.viewHolder.children[0].getObjectByName('muzzle').getWorldPosition(out);
      return out.applyMatrix4(this.viewCamera.matrixWorldInverse).applyMatrix4(game.camera.matrixWorld);
    }
    const socket = game.weaponHolder.children[0]?.getObjectByName('muzzle');
    if (socket) return socket.getWorldPosition(out);
    return game.player.getHandWorld(out);
  }
  render() {
    if (!this.firstVisible || !this.viewActor) return;
    const renderer = this.game.renderer, auto = renderer.autoClear;
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(this.viewScene, this.viewCamera); renderer.autoClear = auto;
  }
}
