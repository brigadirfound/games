import { resolveCircleBoxes } from './physics.js';

export function terrainHeight(city, x, z, radius) {
  if (!city?.groundHeightAt) return 0;
  let height = city.groundHeightAt(x, z);
  for (const [offsetX, offsetZ] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
    height = Math.max(height, city.groundHeightAt(x + offsetX, z + offsetZ));
  }
  return height;
}

export function colliderTop(box, x, z) {
  return box.topAt ? box.topAt(x, z) : box.height ?? 30;
}

export function overlapsFootprint(x, z, radius, box) {
  const deltaX = x - Math.max(box.minX, Math.min(x, box.maxX));
  const deltaZ = z - Math.max(box.minZ, Math.min(z, box.maxZ));
  return deltaX * deltaX + deltaZ * deltaZ < radius * radius;
}

export function moveCharacterBody(actor, dt, velocityX, velocityZ) {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)), Math.ceil(Math.hypot(velocityX, velocityZ) * dt / (actor.radius * .45)));
  const step = dt / steps;
  const footprint = actor.radius * .85;
  const bodyHeight = actor.skin?.modelId ? 1.8 : 1.91;
  const blockers = actor._bodyBlockers || (actor._bodyBlockers = []);
  let feet = terrainHeight(actor.city, actor.x, actor.z, footprint) + actor.y;
  let landed = false;
  for (let frame = 0; frame < steps; frame++) {
    const wasFeet = feet;
    const nextX = actor.x + velocityX * step, nextZ = actor.z + velocityZ * step;
    const boxes = actor.city.nearbyColliders(nextX, nextZ, actor.radius + 2, actor._boxes);
    blockers.length = 0;
    for (const box of boxes) {
      const top = colliderTop(box, nextX, nextZ);
      const bottom = box.minY ?? -Infinity;
      if (feet + bodyHeight <= bottom + .015 || feet >= top - .025) continue;
      if (!actor.airborne && top - feet <= .22 && top >= feet) continue;
      blockers.push(box);
    }
    const resolved = resolveCircleBoxes(nextX, nextZ, actor.radius, blockers, true);
    actor.x = resolved.x;
    actor.z = resolved.z;
    const terrain = terrainHeight(actor.city, actor.x, actor.z, footprint);
    let support = terrain;
    for (const box of boxes) {
      if (!overlapsFootprint(actor.x, actor.z, actor.radius * .70, box)) continue;
      const top = colliderTop(box, actor.x, actor.z);
      if (top <= feet + (actor.airborne ? .025 : .22) && top > support) support = top;
    }
    if (!actor.airborne && feet - support <= .025) {
      feet = support;
      actor.jumpVy = 0;
    } else {
      actor.airborne = true;
      actor.jumpVy -= 24 * step;
      feet += actor.jumpVy * step;
      if (actor.jumpVy > 0) {
        for (const box of boxes) {
          if (!Number.isFinite(box.minY) || !overlapsFootprint(actor.x, actor.z, actor.radius * .8, box)) continue;
          if (wasFeet + bodyHeight <= box.minY && feet + bodyHeight >= box.minY) {
            feet = box.minY - bodyHeight - .001;
            actor.jumpVy = 0;
          }
        }
      }
      if (feet < terrain || (actor.jumpVy <= 0 && feet <= support && wasFeet >= support - .025)) {
        actor.landImpact = Math.max(actor.landImpact || 0, -actor.jumpVy);
        feet = Math.max(terrain, support);
        actor.jumpVy = 0;
        actor.airborne = false;
        landed = true;
      }
    }
    actor.y = feet - terrain;
  }
  if (landed) actor.landT = .32;
}
