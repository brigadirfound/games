import * as THREE from 'three';

export const RETIRED_VEHICLES = ['limo', 'hotrod', 'buggy'];
export const VEHICLE_NUMBERS = Object.fromEntries(['sedan', 'coupe', 'van', 'pickup', 'taxi', 'sport', 'truck', 'bike', 'muscle', 'limo', 'suv', 'compact', 'ambul', 'fire', 'hotrod', 'buggy', 'bus', 'wagon', 'roadster', 'scooter', 'police'].map((id, index) => [id, index + 1]));
Object.assign(VEHICLE_NUMBERS,{garbage:22,schoolbus:23,tow:24,postvan:25,tank:26});

function geometryFrom(vertices, attributes) {
  const geometry = new THREE.BufferGeometry();
  let offset = 0;
  for (const [name, attribute] of attributes) {
    const values = [];
    for (const vertex of vertices) values.push(...vertex.slice(offset, offset + attribute.itemSize));
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, attribute.itemSize));
    offset += attribute.itemSize;
  }
  geometry.computeBoundingSphere();
  return geometry;
}

function verticesOf(geometry) {
  const attributes = Object.entries(geometry.attributes).sort(([left], [right]) => left === 'position' ? -1 : right === 'position' ? 1 : left.localeCompare(right));
  const vertices = [];
  for (let index = 0; index < geometry.attributes.position.count; index++) {
    const vertex = [];
    for (const [, attribute] of attributes) {
      for (let component = 0; component < attribute.itemSize; component++) vertex.push(attribute.getComponent(index, component));
    }
    vertices.push(vertex);
  }
  return { vertices, attributes };
}

function triangulate(polygon, target) {
  for (let index = 1; index < polygon.length - 1; index++) target.push(polygon[0], polygon[index], polygon[index + 1]);
}

function cutMesh(mesh, planes, sideOnly = false) {
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const { vertices, attributes } = verticesOf(source);
  const inside = [], outside = [];
  for (let index = 0; index < vertices.length; index += 3) {
    let polygon = vertices.slice(index, index + 3);
    if (sideOnly) {
      const edgeA = new THREE.Vector3(...polygon[1].slice(0, 3)).sub(new THREE.Vector3(...polygon[0].slice(0, 3)));
      const edgeB = new THREE.Vector3(...polygon[2].slice(0, 3)).sub(new THREE.Vector3(...polygon[0].slice(0, 3)));
      const normal = edgeA.cross(edgeB);
      if (Math.abs(normal.x) < Math.abs(normal.z) * 1.2 || Math.abs(normal.x) < Math.abs(normal.y) * .6) {
        outside.push(...polygon); continue;
      }
    }
    for (const [axis, sign, bound] of planes) {
      const kept = [], rejected = [];
      for (let corner = 0; corner < polygon.length; corner++) {
        const start = polygon[corner], end = polygon[(corner + 1) % polygon.length];
        const startDistance = start[axis] * sign - bound, endDistance = end[axis] * sign - bound;
        (startDistance >= 0 ? kept : rejected).push(start);
        if ((startDistance >= 0) !== (endDistance >= 0)) {
          const amount = startDistance / (startDistance - endDistance);
          const intersection = start.map((value, component) => value + (end[component] - value) * amount);
          kept.push(intersection); rejected.push(intersection);
        }
      }
      triangulate(rejected, outside);
      polygon = kept;
      if (!polygon.length) break;
    }
    triangulate(polygon, inside);
  }
  if (source !== mesh.geometry) source.dispose();
  if (!inside.length) return null;
  mesh.geometry = geometryFrom(outside, attributes);
  const panel = new THREE.Mesh(geometryFrom(inside, attributes), mesh.material);
  panel.castShadow = true; panel.receiveShadow = true;
  return panel;
}

function meshComponents(mesh) {
  const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const positions = geometry.attributes.position;
  const parents = Array.from({ length: positions.count / 3 }, (_, index) => index);
  const rootOf = index => {
    while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; }
    return index;
  };
  const owners = new Map();
  for (let index = 0; index < positions.count; index++) {
    const key = [positions.getX(index), positions.getY(index), positions.getZ(index)].map(value => Math.round(value * 10000)).join(',');
    const triangle = Math.floor(index / 3);
    if (owners.has(key)) parents[rootOf(triangle)] = rootOf(owners.get(key));
    else owners.set(key, triangle);
  }
  const components = new Map();
  for (let index = 0; index < positions.count; index++) {
    const root = rootOf(Math.floor(index / 3));
    if (!components.has(root)) components.set(root, { bounds: new THREE.Box3(), indices: [], material: mesh.material });
    components.get(root).bounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(positions, index));
    components.get(root).indices.push(index);
  }
  if (geometry !== mesh.geometry) geometry.dispose();
  return [...components.values()];
}

function wheelCandidates(mesh) {
  return meshComponents(mesh).filter(component => looksLikeWheel(component)).map(component => component.bounds).filter(box => {
    const size = box.getSize(new THREE.Vector3());
    return box.min.y < .06 && size.y > .22 && size.y < 1.4 && size.z / size.y > .8 && size.z / size.y < 1.2 && size.x < size.y * 2;
  });
}

function looksLikeWheel(component) {
  const material = Array.isArray(component.material) ? component.material[0] : component.material;
  const name = String(material?.name || '').toLowerCase();
  if (/wheel|tire|tyre|rim|rubber|black|grey|gray|metal/i.test(name)) return true;
  const color = material?.color;
  if (!color) return true;
  return (color.r + color.g + color.b) / 3 < .68;
}

function extractWheel(mesh, wheel) {
  const components = meshComponents(mesh);
  const selected = new Set();
  const { center, radius, halfWidth } = wheel;
  for (const component of components) {
    if (!looksLikeWheel(component)) continue;
    const bounds = component.bounds;
    if (bounds.min.x < center.x - halfWidth - .015 || bounds.max.x > center.x + halfWidth + .015) continue;
    if (bounds.min.y < center.y - radius - .015 || bounds.max.y > center.y + radius + .015) continue;
    if (bounds.min.z < center.z - radius - .015 || bounds.max.z > center.z + radius + .015) continue;
    for (const index of component.indices) selected.add(index);
  }
  if (!selected.size) return null;
  const source = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const { vertices, attributes } = verticesOf(source), inside = [], outside = [];
  vertices.forEach((vertex, index) => (selected.has(index) ? inside : outside).push(vertex));
  if (source !== mesh.geometry) source.dispose();
  mesh.geometry = geometryFrom(outside, attributes);
  const result = new THREE.Mesh(geometryFrom(inside, attributes), mesh.material);
  result.castShadow = true; result.receiveShadow = true;
  return result;
}

export function prepareVehicleModel(root, slot) {
  // The source Pony is an open window-frame model. Add actual glazing inside
  // its existing frames before cutting doors so the side panes move with them.
  if (slot === 'van' && root.userData.size && !root.userData.vanGlazing) {
    const scale = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).z / 5.1;
    const material = new THREE.MeshStandardMaterial({ color: 0x263d48, roughness: .12, side: THREE.DoubleSide });
    material.name = 'Windows';
    const points = [];
    const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) points.push(...p.map(v => v * scale)); };
    for (const side of [-1, 1]) {
      quad([side * 1.012, 1.34, -2.42], [side * 1.012, 1.34, 1.54],
        [side * .877, 2.075, .96], [side * .877, 2.075, -2.42]);
    }
    quad([-.95, 1.34, 1.572], [.95, 1.34, 1.572], [.83, 2.075, .982], [-.83, 2.075, .982]);
    quad([-.94, 1.36, -2.492], [-.83, 2.075, -2.44], [.83, 2.075, -2.44], [.94, 1.36, -2.492]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    geometry.computeVertexNormals();
    root.add(new THREE.Mesh(geometry, material));
    root.userData.vanGlazing = true;
  }
  root.updateWorldMatrix(true, true);
  const meshes = [];
  root.traverse(node => { if (node.isMesh) meshes.push(node); });
  const flat = [];
  const inverse = root.matrixWorld.clone().invert();
  for (const mesh of meshes) {
    let wheel = false;
    for (let ancestor = mesh; ancestor && ancestor !== root; ancestor = ancestor.parent) wheel ||= /wheel/i.test(ancestor.name) || ancestor.userData.keepVehicleRig;
    if (wheel) continue;
    const baked = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    const copy = new THREE.Mesh(baked, mesh.material);
    copy.castShadow = true; copy.receiveShadow = true;
    // Keep the authored weighted normals through baking and door extraction.
    // Recomputing here loses the panel/bevel distinction; merging with the
    // original normal attribute also leaves the old flat-shaded seams intact.
    root.add(copy); mesh.removeFromParent(); flat.push(copy);
  }
  let namedWheels = false;
  root.traverse(node => { namedWheels ||= /wheel/i.test(node.name); });
  if (!namedWheels) {
    const seeds = flat.flatMap(wheelCandidates);
    const wheels = [];
    for (const box of seeds) {
      const center = box.getCenter(new THREE.Vector3()), radius = box.getSize(new THREE.Vector3()).y / 2;
      if (wheels.some(wheel => wheel.center.distanceTo(center) < radius * .5)) continue;
      wheels.push({ center, radius, halfWidth: (box.max.x - box.min.x) / 2 + .025 });
    }
    for (const [index, wheel] of wheels.entries()) {
      const group = new THREE.Group(); group.name = `Wheel_${index}`; root.add(group);
      for (const mesh of flat) {
        const part = extractWheel(mesh, wheel);
        if (part) group.add(part);
      }
    }
  }
  if (slot === 'bike' || slot === 'scooter') return root;
  const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
  const profiles = { truck: [.12, .33, .22, .78], van: [.04, .28, .22, .92], ambul: [.075, .29, .18, .875], fire: [.23, .43, .28, .80], bus: [.29, .435, .17, .875], pickup: [-.05, .19, .27, .96] };
  const [back, front, bottom, top] = profiles[slot] || [-.085, .19, .25, .96];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.name = `Door_${side}`;
    hinge.position.set(side * size.x * .43, size.y * bottom, size.z * front);
    hinge.userData.doorSide = side;
    hinge.userData.doorAlong = size.z * (front + back) / 2;
    root.add(hinge);
    const planes = [[0, side, size.x * .30], [1, 1, size.y * bottom], [1, -1, -size.y * top], [2, 1, size.z * back], [2, -1, -size.z * front]];
    for (const mesh of flat) {
      const panel = cutMesh(mesh, planes, true);
      if (!panel) continue;
      panel.geometry.translate(-hinge.position.x, -hinge.position.y, -hinge.position.z);
      const materials = Array.isArray(panel.material) ? panel.material : [panel.material];
      const doubleSided = materials.map(source => { const copy = source.clone(); copy.side = THREE.DoubleSide; return copy; });
      panel.material = Array.isArray(panel.material) ? doubleSided : doubleSided[0];
      hinge.add(panel);
    }
    if (!hinge.children.length) hinge.removeFromParent();
  }
  addVehicleInterior(root, slot, size, back, front, bottom, top);
  removeDanglingBodyBits(root, size.y);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(size.x * .70, .06, size.z * .34), new THREE.MeshStandardMaterial({ color: 0x151b21, roughness: 1 }));
  floor.position.set(0, size.y * .25, size.z * (front + back) / 2); root.add(floor);
  for (const side of [-1, 1]) {
    const upholstery = new THREE.MeshStandardMaterial({ color: 0x303841, roughness: .95 });
    const seat = new THREE.Mesh(new THREE.BoxGeometry(size.x * .26, size.y * .10, size.z * .11), upholstery);
    seat.position.set(side * size.x * .19, size.y * .33, size.z * (front + back) / 2); root.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(size.x * .25, size.y * .30, .09), upholstery);
    backrest.position.set(seat.position.x, size.y * .48, seat.position.z - size.z * .055); backrest.rotation.x = -.12; root.add(backrest);
  }
  return root;
}

function addVehicleInterior(root, slot, size, back, front, bottom, top) {
  // A compact dark cabin volume keeps empty windows from reading as a hollow
  // cutout. It is deliberately simple: seats and dash give depth at gameplay
  // distance without pretending to be a fully modelled interior.
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x20262b, roughness: .92, side: THREE.DoubleSide });
  cabinMat.name = 'STA cabin interior';
  const cabinLength = Math.max(.25, size.z * Math.min(.68, Math.max(.35, front - back)));
  const upholstery = new THREE.MeshStandardMaterial({ color: 0x343b42, roughness: .98 });
  upholstery.name = 'STA cabin upholstery';
  for (const side of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(size.x * .22, size.y * .09, cabinLength * .32), upholstery);
    seat.position.set(side * size.x * .19, size.y * .37, size.z * (front + back) / 2 + cabinLength * .16);
    root.add(seat);
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(size.x * .22, size.y * .24, .065), upholstery);
    backrest.position.set(seat.position.x, size.y * .49, seat.position.z - cabinLength * .16);
    backrest.rotation.x = -.08; root.add(backrest);
  }
}

function removeDanglingBodyBits(root, height) {
  const remove = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || !mesh.geometry || /wheel/i.test(mesh.name || '')) return;
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    const triangles = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
    // Door slicing can leave a tiny triangular shard hanging under the sill.
    // Keep broad chassis pieces; discard only small, low fragments.
    if (box.min.y < -.025 && box.max.y < height * .18 && width < height * 1.15 && triangles < 180) remove.push(mesh);
  });
  for (const mesh of remove) mesh.removeFromParent();
}

export function rigWheels(group, wheels, bike = false) {
  group.updateWorldMatrix(true, true);
  const frontZ = Math.max(...wheels.map(wheel => wheel.position.z));
  for (const wheel of wheels) {
    const bounds = new THREE.Box3().setFromObject(wheel), size = bounds.getSize(new THREE.Vector3());
    const steering = new THREE.Group(); steering.position.copy(wheel.position);
    group.add(steering); steering.attach(wheel);
    wheel.userData.steering = steering;
    wheel.userData.front = Math.abs(steering.position.z - frontZ) < .30;
    wheel.userData.radius = Math.max(.12, size.y / 2);
    wheel.userData.spin = 0;
  }
  return wheels;
}

export function collectDoors(group) {
  const doors = [];
  group.traverse(node => { if (node.userData.doorSide) doors.push({ hinge: node, side: node.userData.doorSide, amount: 0, target: 0 }); });
  return doors;
}

export function animateDoors(doors, dt) {
  for (const door of doors) {
    const step = dt / .32;
    door.amount += Math.sign(door.target - door.amount) * Math.min(step, Math.abs(door.target - door.amount));
    const eased = door.amount * door.amount * (3 - 2 * door.amount);
    door.hinge.rotation.y = -door.side * eased * 1.12;
  }
}
