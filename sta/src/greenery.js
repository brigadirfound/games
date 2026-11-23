import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// One coherent family of urban broadleaf trees. Geometry and leaf artwork are
// generated locally; no downloaded model, external texture or per-frame allocation.
function random(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function leafSpray() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d'), rng = random(821);
  c.lineCap = 'round';
  for (let b = 0; b < 7; b++) {
    const a = b * 2.4, ex = 128 + Math.cos(a) * 90, ey = 132 + Math.sin(a) * 93;
    c.strokeStyle = '#686a3c'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(128, 140); c.lineTo(ex, ey); c.stroke();
    for (let n = 0; n < 9; n++) {
      const t = 0.25 + rng() * 0.77;
      const x = 128 + (ex - 128) * t + (rng() - 0.5) * 40;
      const y = 140 + (ey - 140) * t + (rng() - 0.5) * 37;
      c.save(); c.translate(x, y); c.rotate(a + rng() * 2);
      const l = 10 + rng() * 12;
      c.fillStyle = ['#708644', '#8c9d56', '#adb86a', '#607e3c'][Math.floor(rng() * 4)];
      c.beginPath(); c.moveTo(-l, 0); c.quadraticCurveTo(0, -l * 0.7, l, 0);
      c.quadraticCurveTo(0, l * 0.7, -l, 0); c.fill(); c.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function treeGeometry(kind) {
  const rng = random(980 + kind * 57), branches = [], leaves = [];
  const height = [8.4, 9.6, 10.8][kind], width = [3.5, 3.0, 2.0][kind];
  const up = new THREE.Vector3(0, 1, 0);
  function branch(a, b, r0, r1) {
    const direction = b.clone().sub(a);
    const geo = new THREE.CylinderGeometry(r1, r0, direction.length(), 7);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize()));
    geo.translate(...a.clone().add(b).multiplyScalar(0.5).toArray()); branches.push(geo);
  }
  branch(new THREE.Vector3(), new THREE.Vector3(0.12, height * 0.82, 0), 0.24, 0.04);
  for (let i = 0; i < 13; i++) {
    const a = i * 2.399 + rng() * 0.3;
    const y = height * (0.40 + i / 13 * 0.43);
    const radius = width * Math.sqrt(Math.max(0.15, 1 - Math.pow((y / height - 0.65) * 2.5, 2)));
    const end = new THREE.Vector3(Math.cos(a) * radius * 0.72, y + 0.7, Math.sin(a) * radius * 0.72);
    branch(new THREE.Vector3(0.08, y - 1.4, 0), end, 0.085, 0.016);
  }
  // Crossed sprays form a porous crown, with visible branch gaps and small leaves.
  for (let i = 0; i < 88; i++) {
    const a = i * 2.39996;
    const v = (i + 0.5) / 88;
    const sy = 1 - 2 * v, ring = Math.sqrt(1 - sy * sy);
    const r = 0.66 + rng() * 0.35;
    const x = Math.cos(a) * ring * width * r, z = Math.sin(a) * ring * width * r;
    const y = height * 0.69 + sy * height * 0.30;
    const size = 1.6 + rng() * 1.0;
    const geo = new THREE.PlaneGeometry(size, size);
    geo.rotateX((rng() - 0.5) * 2.5); geo.rotateY(a); geo.rotateZ(rng() * 3);
    geo.translate(x, y, z);
    leaves.push(geo);
  }
  const trunk = mergeGeometries(branches), crown = mergeGeometries(leaves);
  branches.forEach(g => g.dispose()); leaves.forEach(g => g.dispose());
  return { trunk, crown };
}

export class UrbanTrees {
  constructor(scene, spots) {
    this.time = { value: 0 };
    this.meshes = [];
    const texture = leafSpray();
    const leaf = new THREE.MeshLambertMaterial({ map: texture, alphaTest: 0.46, side: THREE.DoubleSide, color: 0xc4d098 });
    const depth = new THREE.MeshDepthMaterial({ map: texture, alphaTest: 0.46, side: THREE.DoubleSide, depthPacking: THREE.RGBADepthPacking });
    const wind = shader => {
      shader.uniforms.uTreeTime = this.time;
      shader.vertexShader = 'uniform float uTreeTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
        #include <begin_vertex>
        vec3 origin = instanceMatrix[3].xyz;
        float sway = sin(uTreeTime * 1.1 + origin.x * 0.13 + origin.z * 0.17);
        transformed.x += sway * 0.065 * max(0.0, position.y - 3.0);
        transformed.z += sin(uTreeTime * 0.8 + origin.z * 0.21) * 0.03 * max(0.0, position.y - 3.0);
      `);
    };
    leaf.onBeforeCompile = wind; depth.onBeforeCompile = wind;
    const bark = new THREE.MeshLambertMaterial({ color: 0x645442 });
    const rng = random(1553), matrix = new THREE.Matrix4(), q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const buckets = [[], [], []];
    spots.forEach(p => {
      const kind = p.street ? (Math.floor((p.x + p.z + 1500) / 68) % 2) : Math.floor(rng() * 3);
      buckets[kind].push({ ...p, angle: rng() * Math.PI * 2 });
    });
    buckets.forEach((pts, kind) => {
      if (!pts.length) return;
      const geometry = treeGeometry(kind);
      for (const [geo, mat, isLeaf] of [[geometry.trunk, bark, false], [geometry.crown, leaf, true]]) {
        const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
        mesh.name = isLeaf ? 'Urban tree canopy' : 'Urban tree branches';
        pts.forEach((p, i) => {
          const s = p.s * (p.street ? 0.98 : 0.88);
          matrix.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q.setFromAxisAngle(up, p.angle), new THREE.Vector3(s, s, s));
          mesh.setMatrixAt(i, matrix);
          if (isLeaf) mesh.setColorAt(i, new THREE.Color().setHSL(0.22 + rng() * 0.035, 0.13, 0.72 + rng() * 0.12));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = true; mesh.receiveShadow = true;
        if (isLeaf) mesh.customDepthMaterial = depth;
        mesh.computeBoundingSphere(); mesh.boundingSphere.radius += 1;
        scene.add(mesh); this.meshes.push(mesh);
      }
    });
    this.count = spots.length;
  }
  update(time) { this.time.value = time; }
}
