// Меш площадки. Отделён от arena.js, чтобы данные и коллизии остались
// пригодными для Node (тесты симуляции, будущий хост онлайн-матча).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { T } from './tuning.js';
import { ARENA, holeAt } from './arena.js';
import { iceTexture } from './ice-texture.js';

const COLOR = {
  ice: 0xcfe6f2,
  iceAlt: 0xc5e1ef,
  crack: 0xb9dbea,
  rim: 0xe8f5fb,
  // Торосы держим ТЕМНЕЕ льда: они блокируют крюк и служат якорем самоподтяга,
  // поэтому обязаны читаться как препятствие. Было светлее фона — сливались.
  toros: 0x8fb8d4,
  torosAlt: 0x6f9cbe,
  water: 0x0e3550,
  boulder: 0x3c4752,
};

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Хеш-шум на целых координатах: стабильный рисунок льда без Math.random. */
function noise2(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Один merged-меш всей площадки: воксели льда 1 м с разбросом высоты и цвета,
 * приподнятая кромка, торосы. Полыньи вырезаются (воксель не создаётся).
 * Плюс тёмный валун-цилиндр под площадкой и «вода» в полыньях.
 */
export function buildArenaMesh() {
  const group = new THREE.Group();
  const parts = [];
  const snow = [];
  const R = ARENA.radius;

  for (let x = -R; x <= R; x++) {
    for (let z = -R; z <= R; z++) {
      const cx = x + 0.5, cz = z + 0.5;
      const dist = Math.hypot(cx, cz);
      if (dist > R) continue;
      if (holeAt(cx, cz, -0.45)) continue;         // вырез полыньи с запасом

      const n = noise2(x, z);
      const isRim = dist > R - T.arena.rimWidth;
      const h = isRim ? T.arena.rimHeight + n * 0.12 : 0.5 + n * 0.09;
      const color = isRim ? COLOR.rim : (n > 0.82 ? COLOR.crack : (n > 0.45 ? COLOR.ice : COLOR.iceAlt));
      parts.push(box(1, h, 1, cx, -h / 2 + (isRim ? T.arena.rimHeight * 0.5 : 0), cz, color));
      if (isRim) snow.push(box(.98,.055,.98,cx,T.arena.rimHeight*.5+.025,cz,0xf3faff));
    }
  }

  for (const t of ARENA.toros) {
    // торос как ступенчатая горка вокселей — читается как лёд, не как ящик
    const nx = Math.round(t.w), nz = Math.round(t.d);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const cx = t.x - t.w / 2 + i + 0.5;
        const cz = t.z - t.d / 2 + j + 0.5;
        const edge = Math.min(i, nx - 1 - i, j, nz - 1 - j);
        const h = Math.min(t.h, 0.9 + edge * 0.7 + noise2(i, j) * 0.25);
        parts.push(box(1, h, 1, cx, h / 2, cz, noise2(j, i) > 0.6 ? COLOR.toros : COLOR.torosAlt));
        snow.push(box(.96,.045,.96,cx,h+.02,cz,0xe5f7ff));
      }
    }
  }

  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  const uv=merged.attributes.uv, pos=merged.attributes.position;
  for(let i=0;i<uv.count;i++)uv.setXY(i,pos.getX(i)/5,pos.getZ(i)/5);
  group.add(new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, map:iceTexture(), roughness:0.48, metalness:0.08 })));
  const snowGeometry=mergeGeometries(snow,false);
  snow.forEach(p=>p.dispose());
  group.add(new THREE.Mesh(snowGeometry,new THREE.MeshLambertMaterial({vertexColors:true})));

  // вода в полыньях — тёмный диск чуть ниже уровня льда
  for (const h of ARENA.holes) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(h.r + 0.2, 16),
      new THREE.MeshStandardMaterial({ color: COLOR.water, roughness:0.22, metalness:0.35 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(h.x, -0.35, h.z);
    group.add(disc);
    for(let i=0;i<3;i++){
      const ripple=new THREE.Mesh(new THREE.RingGeometry(h.r*(.38+i*.2),h.r*(.38+i*.2)+.025,32),
        new THREE.MeshBasicMaterial({color:0x62bed9,transparent:true,opacity:.16,side:THREE.DoubleSide}));
      ripple.rotation.x=-Math.PI/2;ripple.position.set(h.x,-.32,h.z);group.add(ripple);
    }
  }

  // валун под площадкой: уходит в туман, даёт ощущение высоты над пропастью
  const boulder = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.92, R * 0.45, 26, 12, 1),
    new THREE.MeshLambertMaterial({ color: COLOR.boulder, flatShading: true }),
  );
  boulder.position.y = -13.6;
  group.add(boulder);

  return group;
}
