import * as THREE from 'three';

const clamp = THREE.MathUtils.clamp;
const blend = (rate, dt) => 1 - Math.exp(-rate * dt);

export function calibrateNpcFeet(scene, namedBones) {
  const result = {};
  const point = new THREE.Vector3();
  for (const side of ['Right', 'Left']) {
    const foot = namedBones[side + 'Foot'];
    const inverse = foot.matrixWorld.clone().invert();
    const footPosition = foot.getWorldPosition(new THREE.Vector3());
    const pattern = new RegExp(side + '(Foot|Toe)');
    const candidates = [];
    const fallback = [];
    scene.traverse(mesh => {
      if (!mesh.isSkinnedMesh) return;
      const indices = mesh.geometry.attributes.skinIndex;
      const weights = mesh.geometry.attributes.skinWeight;
      for (let vertex = 0; vertex < indices.count; vertex++) {
        let influence = 0;
        for (let component = 0; component < 4; component++) {
          const accessor = ['getX', 'getY', 'getZ', 'getW'][component];
          const bone = mesh.skeleton.bones[indices[accessor](vertex)];
          if (bone && pattern.test(bone.name)) influence += weights[accessor](vertex);
        }
        mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
        if (influence >= .4) candidates.push(Object.assign(point.clone(), { meshName: mesh.name, vertex }));
        if (point.y < footPosition.y + .02 && point.x * footPosition.x >= 0
          && Math.abs(point.x - footPosition.x) < .23 && Math.abs(point.z - footPosition.z) < .3)
          fallback.push(Object.assign(point.clone(), { meshName: mesh.name, vertex }));
      }
    });
    if (!candidates.length) candidates.push(...fallback);
    if (!candidates.length) throw new Error('NPC foot has no sole vertices: ' + side);
    const bottom = Math.min(...candidates.map(candidate => candidate.y));
    const sole = candidates.filter(candidate => candidate.y < bottom + .035);
    const samples = [];
    for (const axis of ['x', 'z']) for (const direction of [-1, 1]) {
      const sorted = [...sole].sort((first, second) => direction * (first[axis] - second[axis]));
      samples.push(sorted[0], sorted[Math.min(3, sorted.length - 1)]);
    }
    samples.push(candidates.reduce((lowest, candidate) => candidate.y < lowest.y ? candidate : lowest));
    result[side] = { samples: samples.map(sample => sample.clone().applyMatrix4(inverse)),
      probes: samples.map(sample => ({ meshName: sample.meshName, vertex: sample.vertex })),
      ankleHeight: foot.getWorldPosition(point).y - bottom,
      orientation: foot.getWorldQuaternion(new THREE.Quaternion()) };
  }
  return result;
}

export function makeLimbSolver() {
  const origin = new THREE.Vector3(), middle = new THREE.Vector3(), end = new THREE.Vector3();
  const direction = new THREE.Vector3(), bendDirection = new THREE.Vector3(), desiredMiddle = new THREE.Vector3();
  const currentDirection = new THREE.Vector3(), desiredDirection = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), parentRotation = new THREE.Quaternion();
  function pointBone(bone, child, target) {
    bone.getWorldPosition(origin);
    child.getWorldPosition(currentDirection).sub(origin).normalize();
    desiredDirection.copy(target).sub(origin).normalize();
    rotation.setFromUnitVectors(currentDirection, desiredDirection);
    bone.getWorldQuaternion(parentRotation);
    rotation.multiply(parentRotation);
    bone.parent.getWorldQuaternion(parentRotation).invert();
    bone.quaternion.copy(parentRotation.multiply(rotation));
    bone.updateMatrixWorld(true);
  }
  return (upper, lower, extremity, target, pole, orientation) => {
    upper.getWorldPosition(origin);
    lower.getWorldPosition(middle);
    extremity.getWorldPosition(end);
    const upperLength = origin.distanceTo(middle), lowerLength = middle.distanceTo(end);
    const distance = clamp(origin.distanceTo(target), Math.abs(upperLength - lowerLength) + .001,
      (upperLength + lowerLength) * .999);
    direction.copy(target).sub(origin).normalize();
    bendDirection.copy(pole).sub(origin).addScaledVector(direction, -bendDirection.dot(direction)).normalize();
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    desiredMiddle.copy(origin).addScaledVector(direction, along).addScaledVector(bendDirection, height);
    pointBone(upper, lower, desiredMiddle);
    pointBone(lower, extremity, target);
    extremity.parent.getWorldQuaternion(parentRotation).invert();
    extremity.quaternion.copy(parentRotation.multiply(orientation));
    extremity.updateMatrixWorld(true);
  };
}

export function createNpcAnimation({ character, root, bones, namedBones, calibration, definition, phase, scale }) {
  const solver = makeLimbSolver();
  const rootBaseY = root.position.y;
  const position = new THREE.Vector3(), previousPosition = new THREE.Vector3();
  const ankle = new THREE.Vector3(), relative = new THREE.Vector3(), target = new THREE.Vector3();
  const pole = new THREE.Vector3(), point = new THREE.Vector3();
  const heading = new THREE.Quaternion(), orientation = new THREE.Quaternion(), rotation = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0);
  const military = character.isCop || ['alex', 'swat'].includes(root.userData.npcModel);
  const stance = military ? .15 : definition.gender === 'female' ? .105 : .125;
  const state = { speed: 0, strideScale: definition.height / 1.91 * character.mesh.scale.y,
    clock: phase * 7, groundOffset: 0, idleWeight: 1, reset: true, planted: [false, false] };
  const feet = ['Right', 'Left'].map((side, index) => ({
    side, sign: index === 0 ? -1 : 1, bone: bones[index === 0 ? 'rFoot' : 'lFoot'],
    upper: bones[index === 0 ? 'rThigh' : 'lThigh'], lower: bones[index === 0 ? 'rShin' : 'lShin'],
    samples: calibration[side].samples,
    probes: calibration[side].probes.map(probe => ({ mesh: root.getObjectByName(probe.meshName), vertex: probe.vertex })),
    locked: false, anchor: new THREE.Vector3(), previousZ: 0, minimum: 0,
  }));
  const fingers = Object.entries(namedBones).filter(([name]) => /Hand(Index|Middle|Ring|Pinky|Thumb)[123]$/.test(name))
    .map(([name, bone]) => ({ bone, name, rest: bone.quaternion.clone(), curl: 0, joint: Number(name.at(-1)) }));
  let initialized = false;
  function soleMinimum(foot) {
    let minimum = Infinity;
    for (const probe of foot.probes) {
      probe.mesh.getVertexPosition(probe.vertex, point).applyMatrix4(probe.mesh.matrixWorld);
      minimum = Math.min(minimum, point.y);
    }
    return minimum;
  }
  function prepare(dt) {
    root.position.y = rootBaseY;
    character.mesh.getWorldPosition(position);
    const distance = initialized ? Math.hypot(position.x - previousPosition.x, position.z - previousPosition.z) : 0;
    state.reset = !initialized || distance > Math.max(1.5, (Math.abs(character.speed) || 0) * dt * 3);
    let speed = Math.abs(character.speed) || 0;
    if (initialized && !state.reset && character.moveDir && !character.inVehicle) speed = distance / dt;
    if (character.inVehicle || character.dead) speed = 0;
    state.speed += (speed - state.speed) * blend(16, dt);
    previousPosition.copy(position);
    initialized = true;
    state.clock += dt;
    return state;
  }
  function groundFeet(dt) {
    const excluded = character.dead || character.inVehicle || character.airborne || character.kickT > 0;
    const idleTarget = state.speed < .3 && !excluded ? 1 : 0;
    state.idleWeight += (idleTarget - state.idleWeight) * blend(9, dt);
    for (const foot of feet) foot.minimum = soleMinimum(foot);
    const floor = character.mesh.getWorldPosition(position).y;
    const lowest = Math.min(...feet.map(foot => foot.minimum));
    const flight = state.speed > 4.3 && lowest - floor > .055;
    const offset = excluded || flight ? 0 : clamp(floor + .003 - lowest, -.12, .12) / character.mesh.scale.y;
    state.groundOffset += (offset - state.groundOffset) * blend(25, dt);
    root.position.y = rootBaseY + state.groundOffset;
    root.updateMatrixWorld(true);
    character.mesh.getWorldQuaternion(heading);
    for (let index = 0; index < feet.length; index++) {
      const foot = feet[index];
      foot.bone.getWorldPosition(ankle);
      relative.copy(ankle);
      character.mesh.worldToLocal(relative);
      const velocityZ = (relative.z - foot.previousZ) / dt;
      foot.previousZ = relative.z;
      const minimum = soleMinimum(foot);
      const height = minimum - floor;
      if (excluded) {
        foot.locked = false;
        state.planted[index] = false;
        continue;
      }
      target.copy(ankle);
      foot.bone.getWorldQuaternion(orientation);
      if (state.idleWeight > .001) {
        point.set(foot.sign * stance, relative.y, foot.sign * .025);
        character.mesh.localToWorld(point);
        target.lerp(point, state.idleWeight);
        rotation.copy(heading).multiply(calibration[foot.side].orientation);
        orientation.slerp(rotation, state.idleWeight);
      }
      const contact = !flight && (state.idleWeight > .5 || (height < .05 && velocityZ < .08));
      if (state.reset || !contact || height > .08 || character.staggerT > 0 || state.idleWeight > .1) foot.locked = false;
      if (contact && state.idleWeight <= .1 && !foot.locked) {
        foot.anchor.copy(target);
        foot.locked = true;
      }
      if (foot.locked && foot.anchor.distanceTo(target) > .32) foot.locked = false;
      if (foot.locked) { target.x = foot.anchor.x; target.z = foot.anchor.z; }
      const planting = contact || state.idleWeight > .1;
      if (planting || height < .003) target.y += floor + .003 - minimum;
      pole.set(foot.sign * .14, .55, 1);
      character.mesh.localToWorld(pole);
      solver(foot.upper, foot.lower, foot.bone, target, pole, orientation);
      const correction = floor + .003 - soleMinimum(foot);
      if (planting || correction > 0) {
        foot.bone.getWorldPosition(target);
        target.y += correction;
        solver(foot.upper, foot.lower, foot.bone, target, pole, orientation);
      }
      state.planted[index] = planting;
    }
  }
  function poseHands(dt) {
    const driving = !!character.inVehicle;
    const fist = character.punchT > 0 || character.kickT > 0;
    const aiming = character.aiming && !character.reloadT;
    for (const finger of fingers) {
      const thumb = finger.name.includes('Thumb');
      const index = finger.name.includes('Index');
      const base = thumb ? [.12, .22, .15] : [.20, .34, .18];
      let curl = base[finger.joint - 1];
      if (driving || fist || aiming || character.weaponEquipped) curl = (thumb ? [.24, .44, .28] : [.64, .92, .50])[finger.joint - 1];
      if (aiming && index) curl *= .45;
      if (character.handsUpT > 0 || character.cheerT > 0) curl *= .3;
      finger.curl += (curl - finger.curl) * blend(14, dt);
      rotation.setFromAxisAngle(axisX, finger.curl);
      finger.bone.quaternion.copy(finger.rest).multiply(rotation);
    }
    if (driving) {
      character.mesh.getWorldQuaternion(heading);
      const bike = character.driverBike;
      for (const foot of feet) {
        const prefix = foot.sign < 0 ? 'r' : 'l';
        const hand = bones[prefix + 'Hand'];
        hand.getWorldQuaternion(orientation);
        target.set(foot.sign * (bike ? .28 : .20), definition.height * (bike ? .64 : .67), bike ? .53 : .48);
        character.mesh.localToWorld(target);
        pole.set(foot.sign * .55, definition.height * .59, .05);
        character.mesh.localToWorld(pole);
        solver(bones[prefix + 'Shldr'], bones[prefix + 'ForeArm'], hand, target, pole, orientation);
      }
    } else if (state.speed < .3 && !character.dead && !character.aiming && !character.idleAnim
      && !(character.handsUpT > 0 || character.cheerT > 0 || character.staggerT > 0)) {
      rotation.setFromAxisAngle(axisY, Math.sin(state.clock * .47) * .07);
      bones.head.quaternion.multiply(rotation);
    }
  }
  function update(dt) {
    groundFeet(dt);
    poseHands(dt);
    root.updateMatrixWorld(true);
  }
  return { state, prepare, update, feet, fingers };
}
