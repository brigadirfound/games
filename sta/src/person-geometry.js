import * as THREE from 'three';

// Authored metre-scale cross sections. Shared by every appearance; callers must
// never mutate cached geometry. +Z is the face / toes, Y is up.
const cache = new Map();
export const HEAD_PROFILE = [[.01,.058,.065,.023],[.04,.087,.086,.018],
  [.09,.11,.103,.007],[.16,.125,.115],[.23,.12,.116,-.007],
  [.28,.105,.098,-.015],[.315,.067,.061,-.019],[.325,.006,.008,-.02]];

// Fitted hair/beard surfaces follow the head, with a varying hairline around
// the circumference. This avoids beads of facial hair floating on the cheeks.
function fittedShell(p) {
  const rows = p.shell === 'hair' ? [...HEAD_PROFILE.slice(0,-2),
    [.315,.091,.085,-.02],[.338,.052,.052,-.023],[.345,.002,.002,-.025]] : HEAD_PROFILE;
  const pos = [], indices = [], uv = [], n = 20, bands = 7;
  for(let j=0;j<=bands;j++) for(let i=0;i<=n;i++) {
    const a=p.shell==='beard' ? (i/n-.5)*Math.PI*1.12 : i/n*Math.PI*2;
    const front=Math.max(0,Math.cos(a));
    const bottom=p.shell==='hair' ? .18+front*.083 : .018;
    const top=p.shell==='hair' ? .345 : .145-front*.072;
    const y=THREE.MathUtils.lerp(bottom,top,j/bands);
    let k=0;while(k<rows.length-2&&rows[k+1][0]<y)k++;
    const r=rows[k],s=rows[k+1],t=THREE.MathUtils.clamp((y-r[0])/(s[0]-r[0]),0,1);
    const rx=THREE.MathUtils.lerp(r[1],s[1],t)+.003;
    const rz=THREE.MathUtils.lerp(r[2],s[2],t)+.003;
    const z=THREE.MathUtils.lerp(r[3]||0,s[3]||0,t);
    pos.push(Math.sign(Math.sin(a))*Math.abs(Math.sin(a))**.83*rx,y,
      Math.sign(Math.cos(a))*Math.abs(Math.cos(a))**.83*rz+z);
    uv.push(i/n,j/bands);
    if(j&&i<n){const v=j*(n+1)+i,u=v-n-1;indices.push(u,u+1,v,v,u+1,v+1);}
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
function loft(rows, segments = 12, power = 1) {
  const pos = [], uv = [], indices = [];
  for (let j = 0; j < rows.length; j++) {
    const [y, rx, rz, z = 0] = rows[j];
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2;
      const s = Math.sin(a), c = Math.cos(a);
      pos.push(Math.sign(s) * Math.abs(s) ** power * rx, y,
        Math.sign(c) * Math.abs(c) ** power * rz + z);
      uv.push(i / segments, j / (rows.length - 1));
      if (j && i < segments) {
        const n = j * (segments + 1) + i, p = n - segments - 1;
        indices.push(p, p + 1, n, n, p + 1, n + 1);
      }
    }
  }
  // Close both ends, including cuffs/neckline which can be seen in bent poses.
  for (const j of [0, rows.length - 1]) {
    const center = pos.length / 3;
    pos.push(0, rows[j][0], rows[j][3] || 0); uv.push(.5, .5);
    for (let i = 0; i < segments; i++) {
      const n = j * (segments + 1) + i;
      if (j === 0) indices.push(center, n + 1, n);
      else indices.push(center, n, n + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  // Weld the duplicate seam normals without losing the UV seam.
  const normal = g.attributes.normal;
  for (let j = 0; j < rows.length; j++) {
    const a = j * (segments + 1), b = a + segments;
    const v = new THREE.Vector3().fromBufferAttribute(normal, a)
      .add(new THREE.Vector3().fromBufferAttribute(normal, b)).normalize();
    normal.setXYZ(a, v.x, v.y, v.z); normal.setXYZ(b, v.x, v.y, v.z);
  }
  return g;
}

export function personGeometry(parts) {
  const key = JSON.stringify(parts);
  if (cache.has(key)) return cache.get(key);
  const geos = parts.map(p => {
    const g = p.shell ? fittedShell(p) : p.rows ? loft(p.rows, p.segments || 12, p.power || 1)
      : new THREE.SphereGeometry(1, p.segments || 10, p.rings || 6)
        .scale(p.w / 2, p.h / 2, p.d / 2);
    if (p.rx) g.rotateX(p.rx);
    if (p.ry) g.rotateY(p.ry);
    if (p.rz) g.rotateZ(p.rz);
    g.translate(p.x || 0, p.y || 0, p.z || 0);
    return g;
  });
  const positions = [], normals = [], uvs = [], indices = [];
  for (const g of geos) {
    const base = positions.length / 3;
    positions.push(...g.attributes.position.array);
    normals.push(...g.attributes.normal.array);
    uvs.push(...g.attributes.uv.array);
    for (const i of g.index.array) indices.push(i + base);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  out.setIndex(indices); out.computeBoundingSphere();
  cache.set(key, out);
  return out;
}
