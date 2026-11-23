export function traceSolids(origin, direction, distance, boxes) {
  let nearest = distance;
  for (const box of boxes) {
    if (box.characterOnly) continue;
    let entry = 0, exit = nearest;
    for (const [axis, lower, upper] of [['x', box.minX, box.maxX], ['y', box.minY ?? 0, box.height ?? 30], ['z', box.minZ, box.maxZ]]) {
      if (Math.abs(direction[axis]) < 1e-8) {
        if (origin[axis] < lower || origin[axis] > upper) { exit = -1; break; }
      } else {
        const first = (lower - origin[axis]) / direction[axis], second = (upper - origin[axis]) / direction[axis];
        entry = Math.max(entry, Math.min(first, second)); exit = Math.min(exit, Math.max(first, second));
      }
      if (entry > exit) break;
    }
    if (entry <= exit && exit >= 0) nearest = Math.min(nearest, entry);
  }
  return nearest;
}

export function traceSphere(origin, direction, distance, center, radius) {
  const offsetX = origin.x - center.x, offsetY = origin.y - center.y, offsetZ = origin.z - center.z;
  const along = offsetX * direction.x + offsetY * direction.y + offsetZ * direction.z;
  const outside = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ - radius * radius;
  if (outside <= 0) return 0;
  const discriminant = along * along - outside;
  if (discriminant < 0) return distance;
  const entry = -along - Math.sqrt(discriminant);
  return entry >= 0 && entry < distance ? entry : distance;
}
