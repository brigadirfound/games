import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { WEAPONS } from './weapon-data.js';
import { WEAPON_FIT } from './weapon-fit.js';

const materials = {
  steel: new THREE.MeshStandardMaterial({ color: 0x66727a, metalness: .48, roughness: .38 }),
  edge: new THREE.MeshStandardMaterial({ color: 0x829095, metalness: .85, roughness: .3 }),
  black: new THREE.MeshStandardMaterial({ color: 0x161d22, metalness: .18, roughness: .69 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x71422a, roughness: .63 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x596249, metalness: .35, roughness: .58 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x25595b, metalness: .62, roughness: .16 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb89855, metalness: .65, roughness: .32 }),
  shell: new THREE.MeshStandardMaterial({ color: 0x7b3023, roughness: .59 }),
};
const cache = new Map();
let textured = false;
function prepareTextures() {
  if (textured) return;
  textured = true;
  for (const kind of ['wood', 'steel']) {
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const context = canvas.getContext('2d'), pixels = context.createImageData(128, 128);
    let seed = 2479;
    for (let row = 0; row < 128; row++) for (let column = 0; column < 128; column++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = (seed / 4294967296 - .5) * 14;
      const grain = kind === 'wood' ? Math.sin(row * .82 + Math.sin(column * .07) * 2) * 23 : Math.sin(row * 4) * 6;
      const value = 212 + grain + noise, offset = (row * 128 + column) * 4;
      pixels.data.set([value, value, value, 255], offset);
    }
    context.putImageData(pixels, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 4;
    materials[kind].map = texture; materials[kind].needsUpdate = true;
  }
}
function makeTemplate(id) {
  prepareTextures();
  const root = new THREE.Group(), groups = new Map();
  root.name = 'Weapon-' + id;
  const add = (geometry, material, position, rotation = [0, 0, 0], part = 'body') => {
    geometry = geometry.index ? geometry.toNonIndexed() : geometry;
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
    const key = part + ':' + material;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(geometry);
  };
  const slab = (profile, width, material, position = [0, 0, 0], part = 'body', bevel = .004) => {
    const shape = new THREE.Shape();
    profile.forEach(([forward, height], index) => index ? shape.lineTo(forward, height) : shape.moveTo(forward, height));
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 8 });
    geo.translate(0, 0, -width / 2); geo.rotateY(-Math.PI / 2);
    add(geo, material, position, [0, 0, 0], part);
  };
  const block = (width, height, length, position, material = 'steel', part = 'body') =>
    slab([[-length / 2, -height / 2], [length / 2, -height / 2], [length / 2, height / 2], [-length / 2, height / 2]],
      width, material, position, part, Math.min(.004, width / 7, height / 7));
  const cylinder = (radius, length, position, material = 'steel', part = 'body', axis = 'z', endRadius = radius) =>
    add(new THREE.CylinderGeometry(endRadius, radius, length, 16), material, position,
      axis === 'z' ? [Math.PI / 2, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0], part);
  const bore = (radius, z, y, part = 'body') => {
    add(new THREE.TorusGeometry(radius, .0035, 6, 20), 'edge', [0, y, z], [0, 0, 0], part);
    cylinder(radius * .8, .004, [0, y, z - .006], 'black', part);
  };
  const grip = (material = 'black') => {
    slab([[-.052, .028], [.032, .02], [.013, -.145], [-.052, -.155], [-.075, -.123]], .048, material);
    for (let row = 0; row < 6; row++) block(.052, .004, .06, [0, -.035 - row * .016, -.025], 'black');
  };
  const guard = () => {
    const shape = new THREE.Shape();
    shape.moveTo(-.005, .025); shape.lineTo(.115, .025); shape.quadraticCurveTo(.13, -.055, .074, -.066);
    shape.lineTo(-.005, -.058); shape.closePath();
    const hole = new THREE.Path(); hole.moveTo(.011, .011); hole.lineTo(.008, -.044);
    hole.lineTo(.075, -.05); hole.quadraticCurveTo(.111, -.045, .101, .011); hole.closePath(); shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: .012, bevelEnabled: false, curveSegments: 8 });
    geo.translate(0, 0, -.006); geo.rotateY(-Math.PI / 2); add(geo, 'steel', [0, 0, 0]);
    slab([[.035, .016], [.047, .016], [.047, -.027], [.032, -.041], [.025, -.034]], .009, 'edge');
  };
  const sights = (rear, front, height) => {
    block(.032, .013, .018, [0, height, rear], 'black');
    block(.009, .02, .012, [0, height + .007, front], 'black');
    for (const side of [-1, 1]) block(.006, .015, .014, [side * .014, height + .011, rear], 'edge');
  };
  const stock = (material = 'wood', long = .33) => {
    slab([[-long - .08, -.052], [-long - .08, .040], [-.16, .056], [-.052, .032], [-.058, -.022], [-.20, -.036]], .050, material, [0, 0, 0], 'stock');
    block(.059, .100, .023, [0, -.004, -long - .082], 'black', 'stock');
  };
  if (id === 'pistol') {
    grip(); guard();
    slab([[-.093, .034], [.215, .034], [.224, .063], [.204, .112], [-.074, .112], [-.093, .089]], .049, 'steel', [0, 0, 0], 'slide');
    block(.057, .027, .25, [0, .022, .065], 'black');
    cylinder(.017, .206, [0, .083, .131], 'edge'); bore(.015, .235, .083);
    block(.052, .006, .056, [0, .114, .041], 'black', 'slide');
    for (let row = 0; row < 7; row++) for (const side of [-1, 1])
      block(.0025, .037, .003, [side * .028, .079, -.07 + row * .008], 'black', 'slide');
    block(.035, .132, .052, [0, -.087, -.021], 'steel', 'magazine');
    block(.058, .009, .076, [0, -.158, -.02], 'black', 'magazine');
    sights(-.071, .182, .12);
  } else if (id === 'uzi') {
    grip(); guard();
    slab([[-.128, .015], [.243, .015], [.258, .065], [.22, .14], [-.128, .14]], .07, 'steel');
    block(.073, .03, .12, [0, .003, .187], 'black');
    cylinder(.02, .17, [0, .096, .33]); bore(.018, .414, .096);
    block(.077, .017, .03, [0, .159, .014], 'edge', 'slide');
    block(.04, .235, .055, [0, -.182, .012], 'steel', 'magazine');
    block(.055, .012, .073, [0, -.301, .012], 'black', 'magazine');
    for (const side of [-1, 1]) {
      cylinder(.008, .18, [side * .035, .06, -.203], 'edge', 'stock');
      for (let slot = 0; slot < 5; slot++) block(.003, .025, .015, [side * .038, .09, .115 + slot * .026], 'black');
    }
    block(.07, .105, .016, [0, .012, -.293], 'black', 'stock'); sights(-.10, .223, .16);
  } else if (id === 'ak47') {
    grip('wood'); guard();
    slab([[-.39, -.065], [-.39, .065], [-.27, .077], [-.11, .028], [-.10, -.015], [-.24, -.027]], .054, 'wood', [0, 0, 0], 'stock');
    block(.062, .137, .018, [0, 0, -.39], 'black', 'stock');
    slab([[-.12, .015], [.205, .015], [.22, .065], [.17, .106], [-.12, .098]], .065, 'steel');
    cylinder(.035, .27, [0, .093, .022], 'black');
    cylinder(.016, .52, [0, .09, .458]); bore(.015, .72, .09);
    slab([[.19, .018], [.37, .021], [.39, .071], [.19, .075]], .073, 'wood');
    cylinder(.026, .174, [0, .108, .28], 'wood');
    cylinder(.016, .19, [0, .122, .448], 'black');
    block(.046, .065, .035, [0, .112, .515], 'steel');
    cylinder(.022, .035, [0, .09, .69], 'black');
    block(.043, .073, .022, [0, .122, .64], 'steel');
    block(.037, .044, .03, [0, .126, .105], 'steel');
    sights(.105, .64, .154);
    slab([[.069, .018], [.161, .018], [.164, -.09], [.185, -.17], [.231, -.248], [.166, -.278], [.12, -.20], [.09, -.11]], .044, 'black', [0, 0, 0], 'magazine');
    for (const side of [-1, 1]) {
      for (const offset of [0, .025, .05])
        slab([[.093 + offset, -.055], [.1 + offset, -.055], [.116 + offset, -.15], [.18 + offset, -.246], [.171 + offset, -.25], [.106 + offset, -.154]], .004, 'steel', [side * .026, 0, 0], 'magazine', .001);
      for (const forward of [-.085, -.045, .16]) cylinder(.004, .005, [side * .036, .04, forward], 'edge', 'body', 'x');
    }
    block(.015, .02, .095, [-.039, .045, .035], 'black');
    cylinder(.009, .045, [-.057, .082, .095], 'steel', 'slide', 'x');
  } else if (id === 'm4a1') {
    grip(); guard();
    cylinder(.023, .30, [0, .068, -.245], 'steel', 'stock');
    slab([[-.405, -.058], [-.405, .094], [-.25, .094], [-.22, .055], [-.23, .02], [-.34, -.02]], .059, 'black', [0, 0, 0], 'stock');
    block(.065, .155, .022, [0, .02, -.408], 'black', 'stock');
    block(.032, .013, .08, [0, -.015, -.285], 'steel', 'stock');
    slab([[-.10, .026], [.205, .026], [.23, .06], [.195, .12], [-.09, .12]], .061, 'black');
    block(.056, .075, .10, [0, .01, .135], 'steel');
    cylinder(.016, .50, [0, .09, .43], 'steel');
    cylinder(.025, .055, [0, .09, .655], 'black'); bore(.016, .68, .09);
    cylinder(.043, .245, [0, .082, .334], 'black');
    for (let rib = 0; rib < 10; rib++) {
      const forward = .22 + rib * .025;
      block(.075, .008, .012, [0, .128, forward], 'steel');
      block(.075, .008, .012, [0, .034, forward], 'steel');
      for (const side of [-1, 1]) block(.009, .042, .012, [side * .042, .079, forward], 'steel');
    }
    block(.03, .015, .25, [0, .133, .05], 'black');
    for (let tooth = 0; tooth < 10; tooth++) block(.048, .009, .010, [0, .144, -.06 + tooth * .025], 'steel');
    slab([[.465, .085], [.494, .183], [.515, .183], [.54, .085], [.526, .085], [.502, .157], [.48, .085]], .023, 'black');
    block(.035, .031, .026, [0, .158, -.063], 'black');
    sights(-.063, .504, .179);
    slab([[.085, .025], [.176, .025], [.176, -.103], [.20, -.218], [.117, -.232], [.089, -.116]], .047, 'steel', [0, 0, 0], 'magazine');
    for (const side of [-1, 1]) for (const offset of [0, .027])
      slab([[.105 + offset, -.047], [.112 + offset, -.047], [.115 + offset, -.11], [.141 + offset, -.207], [.132 + offset, -.208], [.107 + offset, -.113]], .003, 'black', [side * .027, 0, 0], 'magazine', .001);
    block(.07, .012, .037, [0, .12, -.099], 'steel', 'slide');
    block(.004, .027, .067, [-.034, .086, .063], 'steel');
    cylinder(.012, .035, [-.049, .078, -.042], 'black', 'body', 'x');
  } else if (id === 'shotgun' || id === 'rifle') {
    const rifle = id === 'rifle'; stock(rifle ? 'olive' : 'wood', rifle ? .27 : .26); grip(rifle ? 'olive' : 'wood'); guard();
    slab([[-.098, .023], [.211, .023], [.237, .073], [.18, .116], [-.098, .104]], .059, 'steel');
    cylinder(rifle ? .018 : .024, rifle ? .70 : .61, [0, .094, rifle ? .54 : .48]);
    bore(rifle ? .015 : .02, rifle ? .89 : .79, .094);
    if (rifle) {
      slab([[.125, .015], [.42, .027], [.43, .067], [.16, .068]], .063, 'olive');
      block(.042, .084, .106, [0, -.047, .123], 'steel', 'magazine');
      for (const forward of [-.005, .19]) block(.046, .061, .029, [0, .142, forward]);
      cylinder(.033, .31, [0, .194, .076], 'black');
      cylinder(.045, .065, [0, .194, .239], 'steel');
      cylinder(.037, .006, [0, .194, -.083], 'glass'); cylinder(.04, .006, [0, .194, .272], 'glass');
      cylinder(.017, .048, [-.055, .108, -.02], 'edge', 'slide', 'x');
      add(new THREE.SphereGeometry(.017, 12, 8), 'black', [-.078, .105, -.019], [0, 0, 0], 'slide');
    } else {
      cylinder(.021, .48, [0, .042, .40]);
      cylinder(.043, .195, [0, .035, .294], 'wood', 'pump');
      for (let ring = 0; ring < 9; ring++) add(new THREE.TorusGeometry(.043, .003, 5, 16), 'black',
        [0, .035, .212 + ring * .02], [0, 0, 0], 'pump');
      sights(-.02, .744, .12);
      cylinder(.01, .052, [0, -.035, .12], 'shell', 'shell');
      cylinder(.011, .011, [0, -.035, .089], 'brass', 'shell');
    }
    block(.062, .032, .071, [0, .075, .054], 'black');
  } else if (id === 'rocket') {
    cylinder(.055, .57, [0, .14, .285], 'olive');
    cylinder(.055, .34, [0, .14, -.17], 'olive', 'stock');
    cylinder(.07, .09, [0, .14, -.375], 'steel', 'stock', 'z', .053);
    bore(.06, -.422, .14, 'stock');
    for (let ring = 0; ring < 11; ring++) cylinder(.06, .018, [0, .14, -.13 + ring * .028], 'wood', -.13 + ring * .028 < 0 ? 'stock' : 'body');
    grip(); block(.04, .1, .055, [0, -.045, .22], 'black');
    block(.036, .11, .085, [0, .055, -.018], 'steel');
    block(.032, .1, .05, [0, .05, .22], 'steel');
    cylinder(.09, .23, [0, .14, .695], 'olive', 'warhead', 'z', .07);
    cylinder(.07, .20, [0, .14, .91], 'olive', 'warhead', 'z', .004);
    cylinder(.025, .15, [0, .14, .505], 'steel', 'warhead');
    block(.015, .14, .03, [-.069, .233, .035], 'black');
    add(new THREE.TorusGeometry(.039, .007, 6, 16), 'edge', [-.069, .301, .035]);
  }
  if (id !== 'rocket') for (const side of [-1, 1]) for (const forward of [-.05, .145])
    cylinder(.007, .003, [side * .036, .052, forward], 'edge', 'body', 'x');
  for (const [key, geometries] of groups) {
    const [part, material] = key.split(':');
    let mount = root.getObjectByName(part);
    if (!mount) { mount = new THREE.Group(); mount.name = part; root.add(mount); }
    const geometry = mergeGeometries(geometries); geometries.forEach(geo => geo.dispose());
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, materials[material]); mesh.castShadow = true; mesh.receiveShadow = true; mount.add(mesh);
  }
  for (const name of ['muzzle', 'support', 'magazineSocket']) {
    const socket = new THREE.Object3D(); socket.name = name;
    socket.position.fromArray(name === 'support' ? WEAPON_FIT[id].support : WEAPONS[id][name === 'magazineSocket' ? 'magazine' : name]); root.add(socket);
  }
  const shell = root.getObjectByName('shell'); if (shell) shell.visible = false;
  return root;
}
export function buildWeaponMesh(id) {
  if (!WEAPONS[id]?.capacity) return null;
  if (!cache.has(id)) cache.set(id, makeTemplate(id));
  const root = cache.get(id).clone(true); root.userData.weaponId = id; return root;
}
export function animateWeapon(root, { recoil = 0, progress = 0, reloading = false, loaded = 1 } = {}) {
  if (!root) return;
  const id = root.userData.weaponId;
  const magazine = root.getObjectByName('magazine'), slide = root.getObjectByName('slide');
  if (magazine) {
    magazine.position.y = reloading ? -Math.sin(Math.PI * Math.min(1, progress / .78)) * .23 : 0;
    magazine.rotation.x = reloading ? Math.sin(progress * Math.PI) * .12 : 0;
  }
  if (slide) slide.position.z = -Math.min(1, recoil) * (id === 'pistol' ? .034 : .065) - (id === 'pistol' && loaded === 0 ? .027 : 0);
  const pump = root.getObjectByName('pump');
  if (pump) pump.position.z = -Math.sin(Math.min(1, recoil) * Math.PI) * .095;
  const warhead = root.getObjectByName('warhead');
  if (warhead) { warhead.visible = loaded > 0 || (reloading && progress > .35); warhead.position.z = reloading ? (1 - progress) * .46 : 0; }
  const shell = root.getObjectByName('shell');
  if (shell) { shell.visible = reloading && progress > .22 && progress < .94; shell.position.y = -.13 * Math.sin(progress * Math.PI); }
}
