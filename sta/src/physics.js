// Lightweight collision helpers: AABB world stored in a uniform spatial hash.

export class SpatialHash {
  constructor(cell = 40) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  insert(box) {
    const c = this.cell;
    const x0 = Math.floor(box.minX / c), x1 = Math.floor(box.maxX / c);
    const z0 = Math.floor(box.minZ / c), z1 = Math.floor(box.maxZ / c);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = this._key(x, z);
        let arr = this.map.get(k);
        if (!arr) { arr = []; this.map.set(k, arr); }
        arr.push(box);
      }
    }
  }
  query(x, z, r, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c);
    const z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.map.get(this._key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (out.indexOf(b) === -1) out.push(b);
        }
      }
    }
    return out;
  }
}

// Push a circle (x,z,r) out of axis-aligned boxes. Returns {x,z,hit,nx,nz}
export function resolveCircleBoxes(x, z, r, boxes, includeCharacterOnly = false) {
  let hit = false, nx = 0, nz = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.characterOnly && !includeCharacterOnly) continue;
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    let dx = x - cx, dz = z - cz;
    let d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    hit = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = r - d;
      dx /= d; dz /= d;
      x += dx * push; z += dz * push;
      nx += dx; nz += dz;
    } else {
      const dl = x - b.minX, dr = b.maxX - x;
      const db = z - b.minZ, dt = b.maxZ - z;
      const m = Math.min(dl, dr, db, dt);
      if (m === dl) { x = b.minX - r; nx -= 1; }
      else if (m === dr) { x = b.maxX + r; nx += 1; }
      else if (m === db) { z = b.minZ - r; nz -= 1; }
      else { z = b.maxZ + r; nz += 1; }
    }
  }
  const nl = Math.hypot(nx, nz);
  if (nl > 1e-6) { nx /= nl; nz /= nl; }
  return { x, z, hit, nx, nz };
}

// Segment vs AABB list. Returns distance to first hit or Infinity.
export function raycastBoxes(ox, oz, dx, dz, maxDist, boxes) {
  let best = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (b.characterOnly) continue;
    let tmin = 0, tmax = maxDist;
    if (Math.abs(dx) < 1e-8) {
      if (ox < b.minX || ox > b.maxX) continue;
    } else {
      let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-8) {
      if (oz < b.minZ || oz > b.maxZ) continue;
    } else {
      let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (tmin < best) best = tmin;
  }
  return best;
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function rand(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(rand(a, b + 1)); }
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
