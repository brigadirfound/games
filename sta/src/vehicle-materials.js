import * as THREE from 'three';

let flakeTexture = null;
const surfaceTextures = new Map();
const generatedSurfaceMaps = new Map();
let surfaceLoad = null;

export function preloadVehicleTextures() {
  if (surfaceLoad) return surfaceLoad;
  surfaceLoad = (async () => {
    const loader = new THREE.TextureLoader();
    const jobs = ['paint', 'rubber', 'metal', 'tire'].flatMap(kind => ['height', 'roughness', 'color'].map(detail => ({ kind, detail })));
    const results = await Promise.allSettled(jobs.map(async ({ kind, detail }) => {
      const url = new URL(`../assets/textures/vehicles/gpt-v1/${kind}-${detail}.png`, import.meta.url);
      const texture = await loader.loadAsync(url.href);
      texture.name = `STA generated ${kind} ${detail}`;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = detail === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.channel = 1;
      texture.repeat.setScalar(kind === 'tire' ? 1 : kind === 'rubber' ? .85 : kind === 'paint' ? .45 : .9);
      texture.anisotropy = 4;
      generatedSurfaceMaps.set(`${kind}-${detail}`, texture);
    }));
    const failed = results.filter(result => result.status === 'rejected').length;
    if (failed) console.warn(`[vehicles] ${failed} detail maps unavailable; using procedural surfaces`);
    return { loaded: generatedSurfaceMaps.size, failed };
  })();
  return surfaceLoad;
}

// Generated maps and their procedural fallbacks are shared by the whole fleet.
function surfaceTexture(kind, detail = 'roughness') {
  const generated = generatedSurfaceMaps.get(`${kind}-${detail}`);
  if (generated) return generated;
  if (kind === 'tire') return surfaceTexture('rubber', detail);
  if (kind === 'paint' && detail === 'height') return microflakeTexture();
  if (kind === 'rubber' && detail === 'roughness') return surfaceTexture('paint');
  if (surfaceTextures.has(kind)) return surfaceTextures.get(kind);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), pixels = context.createImageData(256, 256);
  let seed = 137;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = (seed >>> 24) / 255;
    const groove = ((y + Math.abs(x - 128) * .55) % 32) < 4 || x % 64 < 3;
    const value = kind === 'rubber' ? (groove ? 65 : 155 + noise * 30)
      : kind === 'metal' ? 175 + noise * 12 + Math.sin(y * 3) * 18
      : 218 + noise * 25;
    const index = (y * 256 + x) * 4;
    pixels.data[index] = pixels.data[index + 1] = pixels.data[index + 2] = value;
    pixels.data[index + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = `STA ${kind} surface`;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.channel = 1;
  texture.repeat.set(kind === 'rubber' ? 3 : 4, kind === 'rubber' ? 3 : 4);
  texture.anisotropy = 4;
  surfaceTextures.set(kind, texture);
  return texture;
}

export function prepareVehicleSurfaceUVs(root, slot) {
  root.updateWorldMatrix(true, true);
  const position = new THREE.Vector3(), normal = new THREE.Vector3();
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    let wheel = null;
    for (let node = mesh; node; node = node.parent) if (/wheel/i.test(node.name)) wheel = node;
    if (wheel) {
      prepareWheelUVs(mesh, wheel, slot);
      return;
    }
    const geometry = mesh.geometry, source = geometry.attributes.position, normals = geometry.attributes.normal;
    const values = new Float32Array(source.count * 2);
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < source.count; i++) {
      position.fromBufferAttribute(source, i).applyMatrix4(mesh.matrixWorld);
      normal.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
      const nx = Math.abs(normal.x), ny = Math.abs(normal.y), nz = Math.abs(normal.z);
      values[i * 2] = nx > ny && nx > nz ? position.z : position.x;
      values[i * 2 + 1] = ny > nx && ny > nz ? position.z : position.y;
    }
    geometry.setAttribute('uv1', new THREE.BufferAttribute(values, 2));
  });
}

function prepareWheelUVs(mesh, wheel, slot) {
  // Split triangle corners to unwrap the angular seam without interpolating
  // across the whole texture. Original atlas UVs and weighted normals survive.
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  mesh.geometry = geometry;
  const bounds = new THREE.Box3().setFromObject(wheel);
  const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.y, size.z) / 2;
  const source = geometry.attributes.position, values = new Float32Array(source.count * 2);
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const edge = new THREE.Vector3(), faceNormal = new THREE.Vector3();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (let i = 0; i < source.count; i += 3) {
    for (let j = 0; j < 3; j++) p[j].fromBufferAttribute(source, i + j).applyMatrix4(mesh.matrixWorld);
    faceNormal.subVectors(p[1], p[0]).cross(edge.subVectors(p[2], p[0])).normalize();
    const group = geometry.groups.find(group => i >= group.start && i < group.start + group.count);
    const tire = vehicleMaterialRole(materials[group?.materialIndex || 0], slot, true) === 'tire';
    const sidewall = Math.abs(faceNormal.x) > .55;
    const angles = p.map(v => Math.atan2(v.y - center.y, v.z - center.z) / (2 * Math.PI) + .5);
    if (Math.max(...angles) - Math.min(...angles) > .5) {
      for (let j = 0; j < 3; j++) if (angles[j] < .5) angles[j] += 1;
    }
    for (let j = 0; j < 3; j++) {
      if (!tire) {
        // The face of the rim has one continuous planar projection.
        values[(i + j) * 2] = p[j].z - center.z;
        values[(i + j) * 2 + 1] = p[j].y - center.y;
        continue;
      }
      const radial = Math.hypot(p[j].y - center.y, p[j].z - center.z) / radius;
      const paired = size.x > size.y * 1.5;
      const across = paired
        ? (Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) - Math.abs(p[j].x)) / (radius * .65)
        : (p[j].x - bounds.min.x) / Math.max(size.x, .001);
      values[(i + j) * 2] = angles[j] * (sidewall ? 1 : 4);
      values[(i + j) * 2 + 1] = sidewall
        ? .05 + .4 * THREE.MathUtils.clamp(radial, 0, 1)
        : .55 + .4 * THREE.MathUtils.clamp(across, 0, 1);
    }
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(values, 2));
  geometry.userData.wheelSurfaceUV = true;
}

export function vehicleMaterialRole(source, slot, wheel = false) {
  const name = String(source.name || '');
  if (!name) return 'trim';
  if (wheel) return /rim|chrome|metal|grey|gray|455A64|78909C|Material\.005/i.test(name) ? 'chrome' : 'tire';
  if (/window|glass|windshield/i.test(name) ||
      (slot === 'ambul' && name === '80DEEA') ||
      (['bus', 'bike'].includes(slot) && name === '039BE5')) return 'glass';
  if (/headlight|taillight|brake ?light/i.test(name) || /^(FF9800|FFEB3B)$/.test(name)) return 'light';
  if (/tire|tyre|rubber|^black$|^1A1A1A$|^Material\.00[23]$/i.test(name)) return 'tire';
  if (/rim|chrome|metal|^grey$|^gray$|^455A64$|^78909C$|^Material\.005$/i.test(name)) return 'chrome';
  if (/atlas/i.test(name)) return 'atlas';
  if (/795548/.test(name)) return 'trim';
  return 'paint';
}

export function microflakeTexture() {
  if (flakeTexture) return flakeTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const value = Math.random() < .08 ? 210 : 128 + Math.floor(Math.random() * 38);
    image.data[index] = value; image.data[index + 1] = value; image.data[index + 2] = value; image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  flakeTexture = new THREE.CanvasTexture(canvas);
  flakeTexture.wrapS = THREE.RepeatWrapping;
  flakeTexture.wrapT = THREE.RepeatWrapping;
  flakeTexture.repeat.set(3, 6);
  flakeTexture.colorSpace = THREE.NoColorSpace;
  flakeTexture.anisotropy = 4;
  return flakeTexture;
}

function copyAsPhysical(source) {
  const target = new THREE.MeshPhysicalMaterial();
  copySharedProperties(target, source);
  target.name = source.name;
  return target;
}

function copyAsStandard(source) {
  const target = new THREE.MeshStandardMaterial();
  copySharedProperties(target, source);
  target.name = source.name;
  return target;
}

function copySharedProperties(target, source) {
  if (source.color && target.color) target.color.copy(source.color);
  if (source.emissive && target.emissive) target.emissive.copy(source.emissive);
  for (const key of ['map', 'alphaMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'bumpMap', 'roughness', 'metalness', 'opacity', 'transparent', 'side', 'flatShading', 'vertexColors', 'wireframe', 'depthWrite', 'depthTest']) {
    if (source[key] !== undefined && key in target) target[key] = source[key];
  }
  if (source.normalScale && target.normalScale) target.normalScale.copy(source.normalScale);
}

export function enhanceVehicleMaterial(source, role = 'trim', wheel = false) {
  if (!source) return source;
  const name = String(source.name || '').toLowerCase();
  if (role === 'paint') {
    const material = copyAsPhysical(source);
    material.metalness = .28;
    material.roughness = .48;
    material.clearcoat = .72;
    material.clearcoatRoughness = .23;
    material.bumpMap = surfaceTexture('paint', 'height');
    material.bumpScale = .006;
    material.roughnessMap = surfaceTexture('paint');
    if (!source.map) material.map = generatedSurfaceMaps.get('paint-color') || null;
    material.envMapIntensity = 1.35;
    return material;
  }
  if (/window|glass|windshield|windscreen/i.test(name) || role === 'glass') {
    const material = copyAsPhysical(source);
    material.metalness = .12;
    material.roughness = .075;
    material.clearcoat = .7;
    material.clearcoatRoughness = .08;
    material.envMapIntensity = 1.45;
    if (!source.map) material.color.setHex(0x263d48);
    material.transparent = false;
    material.opacity = 1;
    material.side = THREE.DoubleSide;
    return material;
  }
  if (/tire|tyre|wheel|rubber/i.test(name) || role === 'tire') {
    const material = copyAsStandard(source);
    material.metalness = 0;
    material.roughness = .9;
    material.envMapIntensity = .18;
    const surface = wheel ? 'tire' : 'rubber';
    material.roughnessMap = surfaceTexture(surface);
    material.bumpMap = surfaceTexture(surface, 'height');
    material.bumpScale = wheel ? .014 : .025;
    if (!source.map) {
      material.color.setHex(0x43474c);
      material.map = generatedSurfaceMaps.get(`${surface}-color`) || null;
    }
    return material;
  }
  if (/rim|chrome|metal/i.test(name) || role === 'chrome') {
    const material = copyAsStandard(source);
    material.metalness = .92;
    material.roughness = .26;
    material.envMapIntensity = 1.5;
    material.roughnessMap = surfaceTexture('metal');
    material.bumpMap = surfaceTexture('metal', 'height');
    material.bumpScale = .002;
    if (!source.map) material.map = generatedSurfaceMaps.get('metal-color') || null;
    if (!source.map) material.color.setHex(0xa5adb5);
    return material;
  }
  if (/headlight|taillight|brake ?light/i.test(name)) {
    const material = copyAsPhysical(source);
    material.roughness = .16;
    material.clearcoat = .55;
    material.envMapIntensity = .8;
    return material;
  }
  const material = copyAsStandard(source);
  material.roughness = role === 'atlas' ? .48 : .78;
  material.metalness = role === 'atlas' ? .2 : 0;
  return material;
}

export function setupVehicleEnvironment(renderer, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const context = canvas.getContext('2d');
  const sky = context.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#8faec1'); sky.addColorStop(.46, '#d9d0bd'); sky.addColorStop(.54, '#756e66'); sky.addColorStop(1, '#20252a');
  context.fillStyle = sky; context.fillRect(0, 0, 512, 256);
  for (let index = 0; index < 18; index++) {
    const x = 12 + index * 30;
    const width = 11 + (index % 3) * 7;
    const height = 25 + (index % 5) * 13;
    context.fillStyle = index % 4 === 0 ? '#e9d2a3' : '#465867';
    context.fillRect(x, 132 - height, width, height);
    if (index % 3 !== 1) {
      context.fillStyle = '#f4c768';
      for (let row = 0; row < 3; row++) context.fillRect(x + 3, 136 - height + row * 8, 3, 3);
    }
  }
  const source = new THREE.CanvasTexture(canvas);
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(source).texture;
  scene.environment = environment;
  source.dispose(); pmrem.dispose();
  scene.userData.vehicleEnvironment = environment;
  return environment;
}
