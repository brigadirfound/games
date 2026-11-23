// Карта: загрузка из JSON и постройка ОДНОГО merged-меша + воксельные коллизии.
// Никакой геометрии в коде — всё из maps/*.json (тот же формат будет писать редактор).
//
// Формат maps/*.json:
// {
//   "id": "arena01", "name": "...",
//   "palette": { "1": "#hex" | {"color": "#hex", "tex": "stone"}, ... },
//       tex — имя тайла из textures.js (или "grass_dirt": верх трава, бока земля);
//       строка "#hex" — легаси-формат старых UGC-карт, рендерится чистым цветом
//   "blocks": [[x, y, z, type], ...],               воксели, step сетки = 1 м
//   "spawns": [[x, y, z, yawDeg], [x, y, z, yawDeg]],
//   "weapons": [{ "type": 1|2, "pos": [x, y, z] }]  1 — дробовик, 2 — рейлган
// }

/** Нормализация записи палитры: строка или {color, tex} → {color, tex}. */
export function paletteEntry(palette, type) {
  const raw = palette?.[String(type)];
  if (!raw) return { color: '#ff00ff', tex: null };
  if (typeof raw === 'string') return { color: raw, tex: null };
  return { color: raw.color ?? '#ff00ff', tex: raw.tex ?? null };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TILE, getAtlas, tileUV } from './textures.js?v=resident-devices-v32';
import { furnitureColumns } from './furniture.js?v=resident-devices-v32';

export class GameMap {
  constructor(data) {
    this.data = data;
    this.solid = new Set();
    for (const [x, y, z] of data.blocks ?? []) this.solid.add(key(x, y, z));
    this.mesh = this._buildMesh();
    this.spawns = (data.spawns ?? []).map(([x, y, z, yaw]) => ({
      pos: new THREE.Vector3(x, y, z),
      yaw: (yaw ?? 0) * Math.PI / 180,
    }));
    this.weaponSpots = (data.weapons ?? []).map(w => ({
      type: w.type,
      pos: new THREE.Vector3(w.pos[0], w.pos[1], w.pos[2]),
    }));
  }

  static async load(id) {
    const res = await fetch(`maps/${id}.json`);
    if (!res.ok) throw new Error(`map load failed: ${id}`);
    return new GameMap(await res.json());
  }

  /** Занят ли воксель с целыми координатами (x,y,z — индексы сетки). */
  isSolid(x, y, z) {
    if (y < -2) return true; // страховочное дно
    return this.solid.has(key(x, y, z));
  }

  _buildMesh() {
    const geoms = [];
    const color = new THREE.Color();
    const jitter = mulberry32(12345); // детерминированная вариация тона
    const furnished = new Set(furnitureColumns(this.data).map(c=>`${c.z},${c.x}`));
    const wardrobes=new Set((this.data.wardrobes||[]).map(w=>`${w.z},${w.x}`));
    const replaced=(x,y,z)=>!this.data.wallGrid?.[z]?.[x]&&
      ((y>0&&y<3&&furnished.has(`${z},${x}`))||(y>0&&y<4&&wardrobes.has(`${z},${x}`)));
    // Rendering must not use invisible replacement voxels as occluders.
    // Otherwise furniture punches holes in the wall behind it.
    const renderedSolid=new Set((this.data.blocks||[]).filter(([x,y,z])=>!replaced(x,y,z)).map(([x,y,z])=>key(x,y,z)));
    const opaque=(x,y,z)=>renderedSolid.has(key(x,y,z));
    for (const [x, y, z, type] of this.data.blocks ?? []) {
      if(replaced(x,y,z))continue;
      // скрытые блоки (окружены со всех сторон) не рендерим
      if (opaque(x + 1, y, z) && opaque(x - 1, y, z) &&
          opaque(x, y + 1, z) && opaque(x, y - 1, z) &&
          opaque(x, y, z + 1) && opaque(x, y, z - 1)) continue;
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.translate(x + 0.5, y + 0.5, z + 0.5);
      const entry = paletteEntry(this.data.palette, type);
      color.set(entry.color);
      const v = 0.98 + jitter() * 0.04;
      const c = color.clone().multiplyScalar(v);
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const p=g.attributes.position,n=g.attributes.normal;
        let shade=1;
        // Static contact shade anchors the floor and the ceiling/wall junction.
        // Collision data is only read; gameplay geometry stays unchanged.
        if(n.getY(i)>.5&&y===0&&this.data.wallGrid){
          const vx=p.getX(i),vz=p.getZ(i),grid=this.data.wallGrid;
          let walls=0;
          for(const dx of [-.04,.04])for(const dz of [-.04,.04])if(grid[Math.floor(vz+dz)]?.[Math.floor(vx+dx)])walls++;
          shade=1-Math.min(.34,walls*.11);
        }else if(Math.abs(n.getY(i))<.5){
          if(p.getY(i)<=1.01)shade=.72;
          if(p.getY(i)>=3.99)shade=.78;
        }
        colors[i*3]=c.r*shade;colors[i*3+1]=c.g*shade;colors[i*3+2]=c.b*shade;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      // UV на тайл атласа: грань 2 — верх, грань 3 — низ, остальные бока
      let topTile, sideTile, bottomTile;
      if (entry.tex === 'grass_dirt') {
        topTile = TILE.grass; sideTile = TILE.dirt; bottomTile = TILE.dirt;
      } else {
        topTile = sideTile = bottomTile = TILE[entry.tex] ?? TILE.plain;
      }
      const uv = g.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const r = tileUV(f === 2 ? topTile : f === 3 ? bottomTile : sideTile);
        for (let vtx = 0; vtx < 4; vtx++) {
          const i = f * 4 + vtx;
          uv.setXY(i, r.u0 + uv.getX(i) * (r.u1 - r.u0), r.v0 + uv.getY(i) * (r.v1 - r.v0));
        }
      }
      geoms.push(g);
    }
    const merged = geoms.length ? mergeGeometries(geoms, false) : new THREE.BufferGeometry();
    geoms.forEach(g => g.dispose());
    // один материал с атласом = один draw call; transparent — ради тайла стекла
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: getAtlas(), transparent: true, alphaTest: 0.05,
      roughness:.93,metalness:0,bumpMap:getAtlas(),bumpScale:.025,
    });
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose() {
    this.mesh.geometry?.dispose();
    const mats = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    // Atlas — глобальный singleton textures.js; освобождаем только map material.
    mats.forEach(m => m?.dispose());
  }
}

/**
 * Скольжение AABB по вокселям. pos — центр НОГ, half — полуширина, height — рост.
 * Двигает по осям раздельно, возвращает { onGround, hitHead }.
 */
// Зазор от грани блока: достаточно, чтобы округление следующего кадра не
// сочло игрока внутри, и достаточно мало, чтобы глаз этого не заметил.
const SKIN = 1e-3;

/** Пересекает ли коробка игрока хоть один сплошной воксель. */
function embedded(map, pos, half, height) {
  const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 1e-4);
  const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height - 1e-4);
  const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 1e-4);
  for (let x = minX; x <= maxX; x++)
    for (let y = minY; y <= maxY; y++)
      for (let z = minZ; z <= maxZ; z++)
        if (map.isSolid(x, y, z)) return true;
  return false;
}

export function moveAABB(map, pos, vel, dt, half, height) {
  const res = { onGround: false, hitHead: false };
  // по каждой оси отдельно — классический воксельный свип
  for (const axis of ['x', 'z', 'y']) {
    const d = vel[axis] * dt;
    if (d === 0) continue;
    pos[axis] += d;
    const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 1e-4);
    const minY = Math.floor(pos.y), maxY = Math.floor(pos.y + height - 1e-4);
    const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 1e-4);
    let collided = false;
    outer:
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++)
        for (let z = minZ; z <= maxZ; z++)
          if (map.isSolid(x, y, z)) { collided = true; break outer; }
    if (!collided) continue;
    if (axis === 'y') {
      if (d < 0) { pos.y = Math.ceil(pos.y); res.onGround = true; }
      else { pos.y = Math.floor(pos.y + height) - height; res.hitHead = true; }
      vel.y = 0;
    } else if (axis === 'x') {
      // SKIN — зазор от грани. Без него игрок вставал ТОЧНО на границу блока,
      // и следующий кадр, начавшись с округления в другую сторону, мог счесть
      // его уже внутри стены. Отсюда редкие залипания: выбраться нельзя,
      // потому что по всем осям упор.
      pos.x = d < 0 ? Math.ceil(pos.x - half) + half + SKIN : Math.floor(pos.x + half) - half - SKIN;
      vel.x = 0;
    } else {
      pos.z = d < 0 ? Math.ceil(pos.z - half) + half + SKIN : Math.floor(pos.z + half) - half - SKIN;
      vel.z = 0;
    }
  }
  /*
    Аварийное выталкивание.

    Свип по осям исходит из того, что в начале кадра игрок стоит в пустоте.
    Если он всё же оказался внутри стены — влез в щель на стыке двух осей,
    был вытолкнут соседом, появился в неудачном месте, — выбраться он не может
    в принципе: любое направление упирается, и остаётся только перезапуск.

    Владелец сообщал о таком: «оч редко, но прилетало». Редкость тут не
    оправдание — игрок теряет всю цепочку ночей и не понимает, за что.

    Ищем ближайшую свободную точку по расширяющимся кольцам и переносим туда.
    Срабатывает только в уже сломанном состоянии, поэтому на обычную игру не
    влияет никак.
  */
  if (embedded(map, pos, half, height)) {
    const step = 0.34;
    search:
    for (let ring = 1; ring <= 6; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const x = pos.x + dx * step, z = pos.z + dz * step;
          const probe = { x: x, y: pos.y, z: z };
          if (embedded(map, probe, half, height)) continue;
          pos.x = x; pos.z = z;
          vel.x = 0; vel.z = 0;
          break search;
        }
      }
    }
  }

  // проверка "стою на земле" даже без вертикального движения
  if (!res.onGround && vel.y <= 0) {
    const yBelow = Math.floor(pos.y - 0.02);
    const minX = Math.floor(pos.x - half), maxX = Math.floor(pos.x + half - 1e-4);
    const minZ = Math.floor(pos.z - half), maxZ = Math.floor(pos.z + half - 1e-4);
    for (let x = minX; x <= maxX && !res.onGround; x++)
      for (let z = minZ; z <= maxZ && !res.onGround; z++)
        if (map.isSolid(x, yBelow, z) && pos.y - (yBelow + 1) < 0.02) res.onGround = true;
  }
  return res;
}

/** Рейкаст по вокселям (DDA). Возвращает дистанцию до стены или maxDist. */
export function raycastVoxels(map, origin, dir, maxDist) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
  let t = 0;
  while (t <= maxDist) {
    if (map.isSolid(x, y, z)) return t;
    if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { t = tMaxX; tMaxX += tDeltaX; x += stepX; }
    else if (tMaxY <= tMaxZ) { t = tMaxY; tMaxY += tDeltaY; y += stepY; }
    else { t = tMaxZ; tMaxZ += tDeltaZ; z += stepZ; }
  }
  return maxDist;
}

function key(x, y, z) { return x + '|' + y + '|' + z; }

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
