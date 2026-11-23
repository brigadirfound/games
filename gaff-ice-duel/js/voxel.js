// Воксельные модели строятся кодом: боец, крюк, цепь, льдинки распада.
// Тело бойца — один merged-меш (1 draw call), рука вынесена отдельной группой,
// чтобы можно было анимировать замах и бросок.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function tinted(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function mergedMesh(parts, metal = false) {
  const geo = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return new THREE.Mesh(geo, metal
    ? new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.34, metalness:.55, flatShading:true })
    : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

/**
 * Воксельный ледовый охотник. Смотрит вдоль -Z (вперёд), стоит ногами в y=0.
 * Возвращает группу; в userData — узлы для анимации.
 */
export function buildFighter(skin, teamColor) {
  const group = new THREE.Group();

  const body = mergedMesh([
    // валенки и штаны
    tinted(0.26, 0.5, 0.26, -0.17, 0.25, 0, skin.pants),
    tinted(0.26, 0.5, 0.26, 0.17, 0.25, 0, skin.pants),
    tinted(0.3, 0.14, 0.36, -0.17, 0.07, -0.04, skin.iron),
    tinted(0.3, 0.14, 0.36, 0.17, 0.07, -0.04, skin.iron),
    // тулуп
    tinted(0.74, 0.66, 0.46, 0, 0.83, 0, skin.coat),
    tinted(0.78, 0.12, 0.5, 0, 0.56, 0, skin.accent),   // подол-опушка
    tinted(0.2, 0.5, 0.24, -0.47, 0.85, 0, skin.coat),  // левое плечо+рука
    tinted(0.22, 0.16, 0.26, -0.47, 0.58, 0, skin.skin),// левая рукавица
    // голова, борода, шапка
    tinted(0.44, 0.42, 0.42, 0, 1.37, 0, skin.skin),
    tinted(0.4, 0.18, 0.1, 0, 1.22, -0.2, skin.rope),
    tinted(0.5, 0.2, 0.48, 0, 1.66, 0, skin.hat),
    tinted(0.6, 0.07, 0.56, 0, 1.55, 0, skin.hat),
    tinted(0.16, 0.14, 0.1, 0, 1.79, 0, skin.accent),   // помпон
    // моток верёвки на поясе
    tinted(0.16, 0.16, 0.16, 0.4, 0.62, 0.2, skin.rope),
  ]);
  group.add(body);

  // правая рука с багром: pivot в плече, анимируется замах/бросок
  const arm = new THREE.Group();
  arm.position.set(0.47, 1.08, 0);
  const armMesh = mergedMesh([
    tinted(0.2, 0.5, 0.24, 0, -0.23, 0, skin.coat),
    tinted(0.22, 0.16, 0.26, 0, -0.5, 0, skin.skin),
  ]);
  arm.add(armMesh);

  // багор в руке (при броске прячется — летит снаряд)
  const gaff = new THREE.Group();
  gaff.position.set(0, -0.5, 0);
  const handle = mergedMesh([
    tinted(0.09, 0.09, 1.25, 0, 0, -0.45, skin.rope),
    ...Array.from({length:7}, (_,i)=>tinted(.115,.115,.035,0,0,.05-i*.075,skin.accent)),
  ]);
  gaff.add(handle);
  const gaffMesh = mergedMesh([
    tinted(0.11, 0.11, 0.2, 0, 0, -1.12, skin.iron),    // обойма
    tinted(0.1, 0.26, 0.1, 0, 0.14, -1.2, skin.iron),   // крюк: вверх
    tinted(0.1, 0.1, 0.24, 0, 0.24, -1.34, skin.iron),  // и загиб вперёд
  ], true);
  gaff.add(gaffMesh);
  arm.add(gaff);
  group.add(arm);

  // маркер команды под ногами: читаемость «кто есть кто» на виде сверху
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.68, 18),
    new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext('2d');
  const gradient = shadowContext.createRadialGradient(32,32,3,32,32,32);
  gradient.addColorStop(0,'rgba(5,25,40,.38)');
  gradient.addColorStop(1,'rgba(5,25,40,0)');
  shadowContext.fillStyle = gradient; shadowContext.fillRect(0,0,64,64);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8,1.8),
    new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2; shadow.position.y=.015;group.add(shadow);

  group.userData = { arm, gaff, ring, body };
  return group;
}

/** Летящий крюк — тот же силуэт, что и в руке, только без древка. */
export function buildHookHead(skin) {
  return mergedMesh([
    tinted(0.14, 0.14, 0.44, 0, 0, 0.1, skin.rope),
    tinted(0.16, 0.16, 0.16, 0, 0, -0.16, skin.iron),
    tinted(0.12, 0.3, 0.12, 0, 0.16, -0.24, skin.iron),
    tinted(0.12, 0.12, 0.26, 0, 0.28, -0.38, skin.iron),
  ]);
}

/**
 * Цепь троса: InstancedMesh звеньев. Одна геометрия, один draw call,
 * невидимые звенья уводятся масштабом в ноль (быстрее, чем менять count).
 */
export class Chain {
  constructor(skin, maxLinks) {
    const geo = new THREE.BoxGeometry(0.13, 0.13, 0.34);
    this.mesh = new THREE.InstancedMesh(
      geo, new THREE.MeshLambertMaterial({ color: skin.iron, flatShading: true }), maxLinks);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.max = maxLinks;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._dir = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._scale = new THREE.Vector3(1, 1, 1);
    this._zero = new THREE.Vector3(0, 0, 0);
  }

  /** Раскладывает звенья между двумя точками с легким провисом. */
  update(from, to, gap) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    const count = Math.min(this.max, Math.max(2, Math.floor(len / gap)));
    this._dir.set(dx, dy, dz).normalize();
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._dir);
    const sag = Math.min(0.5, len * 0.04);

    for (let i = 0; i < this.max; i++) {
      if (i >= count) {
        this._m.compose(this._pos.set(0, -100, 0), this._q, this._zero);
      } else {
        const t = (i + 0.5) / count;
        const droop = Math.sin(t * Math.PI) * sag;
        this._pos.set(from.x + dx * t, from.y + dy * t - droop, from.z + dz * t);
        this._m.compose(this._pos, this._q, this._scale);
      }
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = true;
  }

  hide() { this.mesh.visible = false; }
}

/**
 * Пул льдинок для бескровного распада бойца: кубики разлетаются и тают.
 * Никакой крови и частей тела — рейтинг остаётся детским.
 */
export class ShatterPool {
  constructor(count = 44) {
    const geo = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    this.mesh = new THREE.InstancedMesh(
      geo, new THREE.MeshLambertMaterial({ vertexColors: false, flatShading: true }), count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    this.count = count;
    this.parts = Array.from({ length: count }, () => ({ life: 0, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, rot: 0 }));
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color();
  }

  burst(x, y, z, colors) {
    let spawned = 0;
    for (const p of this.parts) {
      if (p.life > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      p.life = 0.9 + Math.random() * 0.5;
      p.x = x + (Math.random() - 0.5) * 0.5;
      p.y = y + Math.random() * 1.4;
      p.z = z + (Math.random() - 0.5) * 0.5;
      p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp;
      p.vy = 3 + Math.random() * 4;
      p.rot = Math.random() * 6;
      this._c.set(colors[(spawned + colors.length) % colors.length]);
      this.mesh.instanceColor.setXYZ(this.parts.indexOf(p), this._c.r, this._c.g, this._c.b);
      if (++spawned >= 22) break;
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.count; i++) {
      const p = this.parts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 22 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.1) { p.y = 0.1; p.vy *= -0.35; p.vx *= 0.7; p.vz *= 0.7; }
        p.rot += dt * 6;
        const s = Math.max(0.01, Math.min(1, p.life));
        this._e.set(p.rot, p.rot * 0.7, 0);
        this._q.setFromEuler(this._e);
        this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(s, s, s));
      } else {
        this._m.compose(this._p.set(0, -100, 0), this._q, this._s.set(0, 0, 0));
      }
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
