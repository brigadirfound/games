import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const templates = new Map();
export const aircraftLoadFailures = [];
export async function preloadAircraft() {
  const loader = new GLTFLoader();
  await Promise.all(['bell', 'trainer', 'twin'].map(async id => {
    try {
      const gltf = await loader.loadAsync(`./assets/models/aircraft/${id}.glb`);
      templates.set(id, gltf.scene);
    } catch (error) {
      aircraftLoadFailures.push({ id, error: String(error) });
      console.warn('[aircraft]', id, error);
    }
  }));
}

function importedAircraft(definition) {
  const template = templates.get(definition.kind === 'helicopter' ? 'bell' : definition.id);
  if (!template) return null;
  const group = template.clone(true);
  group.name = `Aircraft_${definition.id}`;
  group.userData.aircraftId = definition.id;
  group.userData.importedAircraft = true;
  group.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
  if (definition.kind === 'helicopter' && definition.id !== 'rescue') {
    const materials = new Map();
    group.traverse(node => {
      if (!node.isMesh || !node.material.map) return;
      if (!materials.has(node.material)) {
        const paint = node.material.clone();
        paint.onBeforeCompile = shader => {
          shader.uniforms.rolePaint = { value: new THREE.Color(definition.color) };
          shader.fragmentShader = 'uniform vec3 rolePaint;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
            #include <map_fragment>
            float redPaint = smoothstep(.03, .18, diffuseColor.r - max(diffuseColor.g, diffuseColor.b));
            diffuseColor.rgb = mix(diffuseColor.rgb, rolePaint * diffuseColor.r, redPaint);
          `);
        };
        paint.customProgramCacheKey = () => 'STA-aircraft-role';
        materials.set(node.material, paint);
      }
      node.material = materials.get(node.material);
    });
  }
  const parts = { rotors: [], propellers: [], landingGear: [], controlSurfaces: [] };
  const mainRotor = group.getObjectByName('MainRotor') || null;
  const tailRotor = group.getObjectByName('TailRotor') || null;
  if (mainRotor) parts.rotors.push(mainRotor, tailRotor);
  group.traverse(node => { if (/^Propeller(?:_Left|_Right)?$/.test(node.name)) parts.propellers.push(node); });
  const beaconPosition = new THREE.Vector3(0, 0, 0);
  group.traverse(node => {
    if (!node.isMesh || node.name !== 'Fuselage') return;
    const position = node.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(position.getX(i)) < .15 && position.getY(i) > beaconPosition.y) beaconPosition.fromBufferAttribute(position, i);
    }
  });
  beaconPosition.y += .025;
  const beacon = part(group, 'beacon', new THREE.SphereGeometry(.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }), beaconPosition.toArray());
  return { group, definition, parts, mainRotor, tailRotor, beacon };
}

export const AIRCRAFT_TYPES = [
  { id: 'scout', name: 'Scout · гражданский вертолёт', kind: 'helicopter', color: 0xd6a42b, blades: 4, length: 11.2 },
  { id: 'patrol', name: 'Patrol · полицейский', kind: 'helicopter', color: 0x263f5a, blades: 4, length: 11.2 },
  { id: 'rescue', name: 'Rescue · спасательный', kind: 'helicopter', color: 0xd84b31, blades: 4, length: 11.2 },
  { id: 'trainer', name: 'Cessna 152 · лёгкий винтовой', kind: 'plane', color: 0x327bac, length: 7.3 },
  { id: 'twin', name: 'Cessna 310 · двухмоторный', kind: 'plane', color: 0xb1bec9, length: 9.7 },
];

function material(color, metalness = .15, roughness = .48) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function part(parent, name, geometry, paint, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, paint);
  mesh.name = name; mesh.position.set(...position); mesh.rotation.set(...rotation);
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
  return mesh;
}

function box(parent, name, size, paint, position, rotation) {
  return part(parent, name, new THREE.BoxGeometry(...size), paint, position, rotation);
}

function rod(parent, name, start, end, radius, paint) {
  const from = new THREE.Vector3(...start), to = new THREE.Vector3(...end), direction = to.clone().sub(from);
  const mesh = part(parent, name, new THREE.CylinderGeometry(radius, radius, direction.length(), 10), paint, from.add(to).multiplyScalar(.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function loft(parent, name, rings, paints, glazed = false) {
  const points = [], indices = [], segments = 12;
  for (const [along, height, width, radius] of rings) {
    for (let index = 0; index < segments; index++) {
      const angle = index * Math.PI * 2 / segments;
      points.push(Math.cos(angle) * width, height + Math.sin(angle) * radius, along);
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let index = 0; index < segments; index++) {
      const base = ring * segments + index, next = ring * segments + (index + 1) % segments;
      const offset = indices.length;
      indices.push(base, next, next + segments, base, next + segments, base + segments);
      const window = typeof glazed === 'function' ? glazed(ring, index) : glazed && ring >= rings.length - 3 && index < segments / 2;
      geometry.addGroup(offset, 6, window ? 1 : 0);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return part(parent, name, geometry, paints);
}

function wing(parent, name, outline, thickness, paint, height) {
  const shape = new THREE.Shape();
  shape.moveTo(...outline[0]);
  for (const point of outline.slice(1)) shape.lineTo(...point);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  geometry.rotateX(Math.PI / 2);
  return part(parent, name, geometry, paint, [0, height, 0]);
}

function rotor(parent, name, blades, radius, paint, position) {
  const hub = new THREE.Group(); hub.name = name; hub.position.set(...position); parent.add(hub);
  for (let index = 0; index < blades; index++) {
    const blade = new THREE.Group(); blade.rotation.y = index * Math.PI * 2 / blades; hub.add(blade);
    box(blade, 'blade', [.25, .045, radius - .25], paint, [0, 0, radius / 2 + .125]);
    box(blade, 'safety-tip', [.255, .047, .22], material(0xd8c586), [0, 0, radius - .11]);
  }
  part(hub, 'hub', new THREE.SphereGeometry(.19, 12, 8), material(0x5e6871, .65), [0, 0, 0]);
  return hub;
}

function landingWheel(parent, x, z, radius, strutTop, parts) {
  const dark = material(0x181e25, .05, .9), metal = material(0xabb4ba, .7);
  rod(parent, 'gear-leg', [x * .7, strutTop, z], [x, radius, z], .055, metal);
  const wheel = new THREE.Group(); wheel.position.set(x, radius, z); parent.add(wheel);
  part(wheel, 'tyre', new THREE.CylinderGeometry(radius, radius, radius * .65, 16), dark, [0, 0, 0], [0, 0, Math.PI / 2]);
  part(wheel, 'rim', new THREE.CylinderGeometry(radius * .52, radius * .52, radius * .68, 12), metal, [0, 0, 0], [0, 0, Math.PI / 2]);
  parts.landingGear.push(wheel);
}

export function buildAircraft(id) {
  const definition = AIRCRAFT_TYPES.find(type => type.id === id);
  if (!definition) throw new Error(`Unknown aircraft: ${id}`);
  const imported = importedAircraft(definition);
  if (imported) return imported;
  const group = new THREE.Group(); group.name = `Aircraft_${id}`;
  const paint = material(definition.color), white = material(0xe3e8e7), dark = material(0x18232d, .4);
  const glass = material(0x203c50, .5, .18), metal = material(0x919ca4, .65);
  const parts = { rotors: [], propellers: [], landingGear: [], controlSurfaces: [] };
  let mainRotor = null, tailRotor = null;
  if (definition.kind === 'helicopter') {
    const heavy = id === 'rescue', scout = id === 'scout';
    const width = heavy ? 1.12 : scout ? .74 : .88;
    const rear = heavy ? -2.4 : -1.5, nose = scout ? 2.0 : 2.5;
    const height = heavy ? 2.1 : 1.65;
    loft(group, 'fuselage', [[rear - .6, height, .03, .05], [rear, height, width * .75, .65], [-.4, height, width, .83], [1.1, height, width, .8], [nose - .35, height - .2, width * .66, .55], [nose, height - .37, .02, .03]], [paint, glass], true);
    loft(group, 'lower-shell', [[rear, height - .37, .02, .03], [-.8, height - .4, width * .94, .48], [1, height - .4, width * .91, .46], [nose - .05, height - .37, .02, .03]], [white]);
    const tailZ = -definition.length + nose + .45;
    loft(group, 'tail-boom', [[tailZ, height + .5, .08, .12], [tailZ + 1.1, height + .35, .15, .20], [rear + .4, height, width * .65, .5]], [paint]);
    wing(group, 'tail-stabilizer', [[-1.25, tailZ + 1.05], [1.25, tailZ + 1.05], [1.12, tailZ + .58], [-1.12, tailZ + .58]], .07, white, height + .35);
    const finShape = new THREE.Shape(); finShape.moveTo(tailZ, 0); finShape.lineTo(tailZ + .9, 0); finShape.lineTo(tailZ + .55, 1.55); finShape.lineTo(tailZ + .03, 1.75); finShape.closePath();
    part(group, 'tail-fin', new THREE.ExtrudeGeometry(finShape, { depth: .1, bevelEnabled: false }), paint, [.05, height + .3, 0], [0, -Math.PI / 2, 0]);
    const mastY = height + (heavy ? 1.75 : 1.4);
    if (!scout) {
      for (const side of [-1, 1]) {
        loft(group, 'turbine', [[-1.35, height + .84, .1, .1], [-1.05, height + .86, .29, .28], [.45, height + .88, .28, .26], [.65, height + .88, .1, .1]], [white]).position.x = side * .4;
        part(group, 'exhaust', new THREE.CylinderGeometry(.19, .19, .35, 14), dark, [side * .4, height + .85, -1.3], [Math.PI / 2, 0, 0]);
      }
    }
    rod(group, 'rotor-mast', [0, height + .6, -.3], [0, mastY, -.3], .075, metal);
    mainRotor = rotor(group, 'main-rotor', definition.blades, scout ? 4.2 : heavy ? 5.6 : 4.8, dark, [0, mastY, -.3]);
    parts.rotors.push(mainRotor);
    tailRotor = new THREE.Group(); tailRotor.name = 'tail-rotor'; tailRotor.position.set(.23, height + .85, tailZ + .22); group.add(tailRotor);
    const tailBlades = rotor(tailRotor, 'tail-blades', scout ? 2 : 4, .74, dark, [0, 0, 0]); tailBlades.rotation.z = Math.PI / 2;
    parts.rotors.push(tailRotor);
    for (const side of [-1, 1]) {
      if (heavy) {
        landingWheel(group, side * 1.22, -1.4, .29, height - .3, parts);
      } else {
        for (const along of [-.9, .85]) rod(group, 'skid-strut', [side * width * .7, height - .4, along], [side * 1.05, .2, along - .2], .065, metal);
        rod(group, 'landing-skid', [side * 1.05, .18, -1.8], [side * 1.05, .18, 1.65], .075, dark);
        rod(group, 'skid-toe', [side * 1.05, .18, 1.65], [side * 1.05, .38, 1.96], .075, dark);
      }
      const paneCount = heavy ? 3 : 1;
      for (let index = 0; index < paneCount; index++) {
        box(group, 'cabin-window', [.025, .53, .55], glass, [side * (width + .006), height + .14, .5 - index * .76]);
        box(group, 'window-sill', [.045, .045, .58], white, [side * (width + .018), height - .15, .5 - index * .76]);
      }
      box(group, 'door-handle', [.045, .04, .20], metal, [side * (width + .025), height - .28, .22]);
      rod(group, 'windscreen-pillar', [side * width * .85, height + .52, 1.15], [side * width * .68, height - .05, nose - .3], .025, white);
      part(group, 'navigation-light', new THREE.SphereGeometry(.06, 8, 6), new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3020 : 0x40ef80 }), [side * width, height, rear]);
    }
    if (heavy) landingWheel(group, 0, 1.35, .23, height - .35, parts);
    if (id === 'patrol') {
      part(group, 'searchlight', new THREE.SphereGeometry(.24, 12, 8), metal, [.48, height - .85, 1.5]);
      part(group, 'searchlight-lens', new THREE.SphereGeometry(.17, 12, 8), white, [.48, height - .9, 1.66]);
    }
  } else {
    const twin = id === 'twin', height = twin ? 1.85 : 1.45, width = twin ? .74 : .54;
    const tail = twin ? -5.6 : -3.9, nose = twin ? 4.4 : 3.15;
    loft(group, 'fuselage', [[tail, height + .1, .03, .06], [tail + 1, height, .23, .35], [-1.2, height, width, .71], [1.1, height, width, .72], [2.0, height - .12, width * .8, .50], [nose, height - .17, twin ? .06 : .27, twin ? .09 : .28]], [white, glass], (ring, segment) => ring === 3 && segment < 6);
    const span = twin ? 6.6 : 5.0, wingY = twin ? height - .3 : height + .65;
    wing(group, 'main-wing', [[-span, -.55], [-span, .30], [-.6, 1.18], [.6, 1.18], [span, .30], [span, -.55], [.7, -.85], [-.7, -.85]], .10, paint, wingY);
    wing(group, 'horizontal-tail', [[-2.0, tail + .5], [-1.9, tail + 1.3], [0, tail + 1.7], [1.9, tail + 1.3], [2.0, tail + .5]], .08, paint, height + .26);
    const finShape = new THREE.Shape(); finShape.moveTo(tail + .4, 0); finShape.lineTo(tail + 2, 0); finShape.lineTo(tail + 1.05, 1.8); finShape.lineTo(tail + .6, 1.85); finShape.closePath();
    part(group, 'vertical-tail', new THREE.ExtrudeGeometry(finShape, { depth: .08, bevelEnabled: false }), paint, [.04, height + .15, 0], [0, -Math.PI / 2, 0]);
    for (const side of [-1, 1]) {
      landingWheel(group, side * (twin ? 2.2 : 1.3), -.2, twin ? .34 : .27, wingY, parts);
      if (!twin) rod(group, 'wing-strut', [side * .5, height - .4, .3], [side * 3.4, wingY, .2], .036, metal);
      for (let index = 0; index < (twin ? 5 : 2); index++) box(group, 'passenger-window', [.025, .34, .40], glass, [side * width * .99, height + .20, .75 - index * .57]);
      const aileron = box(group, 'aileron', [span * .37, .07, .22], white, [side * span * .68, wingY - .015, -.52]);
      parts.controlSurfaces.push(aileron);
      part(group, 'wingtip-light', new THREE.SphereGeometry(.065, 8, 6), new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3020 : 0x40ef80 }), [side * span, wingY, .1]);
    }
    landingWheel(group, 0, twin ? 2.8 : 2.0, twin ? .26 : .20, height - .3, parts);
    for (const side of twin ? [-1, 1] : [0]) {
      const engineX = side * 2.15, engineZ = twin ? 1.4 : nose;
      if (twin) loft(group, 'engine-nacelle', [[-1, height - .13, .03, .04], [-.3, height - .13, .35, .37], [engineZ, height - .13, .31, .33], [engineZ + .2, height - .13, .04, .05]], [paint]).position.x = engineX;
      const propeller = new THREE.Group(); propeller.name = 'propeller'; propeller.position.set(engineX, height - .13, engineZ + .24); group.add(propeller);
      const blades = rotor(propeller, 'propeller-blades', twin ? 4 : 2, twin ? 1.15 : .91, dark, [0, 0, 0]); blades.rotation.x = Math.PI / 2;
      part(propeller, 'spinner', new THREE.ConeGeometry(.2, .38, 16), paint, [0, 0, .14], [Math.PI / 2, 0, 0]);
      parts.propellers.push(propeller);
    }
  }
  const beacon = part(group, 'beacon', new THREE.SphereGeometry(.085, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3020 }), [0, definition.kind === 'helicopter' ? 2.6 : 2.2, -1.0]);
  group.userData.aircraftId = id;
  return { group, definition, parts, mainRotor, tailRotor, beacon };
}

export function updateAircraftParts(aircraft, dt, running = true) {
  if (!running) return;
  if (aircraft.mainRotor) aircraft.mainRotor.rotation.y = (aircraft.mainRotor.rotation.y + dt * 26) % (Math.PI * 2);
  if (aircraft.tailRotor) aircraft.tailRotor.rotation.x = (aircraft.tailRotor.rotation.x + dt * 42) % (Math.PI * 2);
  for (const propeller of aircraft.parts.propellers) propeller.rotation.z = (propeller.rotation.z + dt * 45) % (Math.PI * 2);
}
