import * as THREE from 'three';
import { MODELS } from './models.js';
import { CAR_TYPES, CAR_BY_ID, TANK_TYPE, BODY_COLORS, buildCarMesh } from './vehicle.js';
import { VEHICLE_NUMBERS, animateDoors } from './vehicle-rig.js';
import { AIRCRAFT_TYPES, buildAircraft, updateAircraftParts, preloadAircraft } from './aircraft-models.js';
import { setupVehicleEnvironment, preloadVehicleTextures } from './vehicle-materials.js';

const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('view'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x344451);
setupVehicleEnvironment(renderer, scene);
scene.add(new THREE.HemisphereLight(0xdceaff, 0x807569, 2.2));
const key = new THREE.DirectionalLight(0xffead0, 3.5); key.position.set(-7, 13, 8); scene.add(key);
const fill = new THREE.DirectionalLight(0xaecfff, 1.2); fill.position.set(8, 6, -8); scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x596875, roughness: 1 }));
floor.rotation.x = -Math.PI / 2; floor.position.y = -.03; scene.add(floor);
const grid = new THREE.GridHelper(200, 100, 0x81909a, 0x647580); grid.position.y = -.02; scene.add(grid);
const camera = new THREE.PerspectiveCamera(38, 1, .05, 600);
const center = new THREE.Vector3();
let yaw = -.75, elevation = .3, distance = 10, selection = [], paused = false;
let reviewState = '';
const select = document.getElementById('model'), doorInput = document.getElementById('doors'), motionInput = document.getElementById('motion');
const manifest = await (await fetch('./models.json')).json();
await Promise.all([preloadVehicleTextures(), preloadAircraft()]);
await MODELS.preload(manifest.vehicles.filter(entry => CAR_BY_ID[entry.slot] || entry.slot === 'police' || entry.slot === 'tank').map(entry => {
  const type = CAR_BY_ID[entry.slot] || CAR_BY_ID.sedan;
  return { slot: entry.slot, url: './' + (entry.renderOut || entry.out), orient: true, fitZ: entry.fitZ, maxX: type.w * 1.25, maxY: type.bike ? undefined : type.h * 1.35 };
}));
const fleet = [...CAR_TYPES.map(type => ({ type, id: type.id })), { type: TANK_TYPE, id: 'tank' }, { type: CAR_BY_ID.sedan, id: 'police' }].map(({ type, id }, index) => {
  const built = buildCarMesh(type, BODY_COLORS[index % BODY_COLORS.length], id === 'police', id === 'taxi');
  return { id, name: `${String(VEHICLE_NUMBERS[id]).padStart(2, '0')} · ${id === 'police' ? 'Police' : type.name}`, built, group: built.group, kind: 'car' };
});
const aircraft = AIRCRAFT_TYPES.map(type => {
  const built = buildAircraft(type.id);
  return { id: type.id, name: type.name, built, group: built.group, kind: 'aircraft' };
});
const items = [...fleet, ...aircraft];
const texturedMaterials = new Map();
for (const item of items) item.group.traverse(mesh => {
  if (!mesh.isMesh) return;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (texturedMaterials.has(material)) continue;
    const maps = {};
    for (const key of ['map', 'normalMap', 'bumpMap', 'roughnessMap', 'metalnessMap']) {
      if (material[key]) maps[key] = material[key];
    }
    if (Object.keys(maps).length) texturedMaterials.set(material, maps);
  }
});
for (const item of items) {
  scene.add(item.group); item.group.visible = false;
  const option = document.createElement('option'); option.value = item.id; option.textContent = item.name; select.append(option);
}
function render() {
  camera.position.set(center.x + Math.sin(yaw) * Math.cos(elevation) * distance, center.y + Math.sin(elevation) * distance, center.z + Math.cos(yaw) * Math.cos(elevation) * distance);
  camera.lookAt(center); renderer.render(scene, camera);
}
function show(id, view = 'front') {
  document.body.dataset.ready = '';
  reviewState = `${id}-${view}`;
  selection = id === 'fleet' ? fleet : id === 'aircraft' ? aircraft : items.filter(item => item.id === id);
  const bounds = new THREE.Box3();
  for (const item of items) { item.group.visible = selection.includes(item); item.group.position.set(0, 0, 0); }
  selection.forEach((item, index) => {
    item.group.position.x = index * (item.kind === 'aircraft' ? 15 : 4.5);
    item.group.updateWorldMatrix(true, true); bounds.union(new THREE.Box3().setFromObject(item.group));
  });
  bounds.getCenter(center);
  const size = bounds.getSize(new THREE.Vector3());
  distance = selection.length === 1 ? size.length() * 1.18 : Math.max(size.x / camera.aspect, size.z) * 2.0 + 8;
  yaw = view === 'side' ? -Math.PI / 2 : view === 'rear' ? -2.4 : -.75;
  elevation = view === 'side' ? .05 : selection.length === 1 ? .27 : .5;
  document.getElementById('title').textContent = selection.length === 1 ? selection[0].name : id === 'fleet' ? 'STA · оставленный автопарк' : 'STA · авиация';
  document.getElementById('status').textContent = selection.length === 1 && selection[0].kind === 'car' ? `${selection[0].built.wheels.length} осей вращения · ${selection[0].built.doors.length} дверей` : 'Обзор моделей · не лётный режим';
  if (selection.length === 1) select.value = id;
  render();
}
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); render(); }
window.addEventListener('resize', resize); resize();
select.onchange = () => show(select.value);
document.getElementById('side').onclick = () => show(select.value, 'side');
document.getElementById('rear').onclick = () => show(select.value, 'rear');
document.getElementById('fleet').onclick = () => show('fleet');
document.getElementById('aircraft').onclick = () => show('aircraft');
document.getElementById('detail').onclick = () => {
  show(select.value); distance *= .66; render();
};
document.getElementById('textures').onchange = event => {
  for (const [material, maps] of texturedMaterials) {
    for (const [key, texture] of Object.entries(maps)) material[key] = event.target.checked ? texture : null;
    material.needsUpdate = true;
  }
  render();
};
let pointer = null;
renderer.domElement.onpointerdown = event => { pointer = [event.clientX, event.clientY]; renderer.domElement.setPointerCapture(event.pointerId); };
renderer.domElement.onpointerup = () => { pointer = null; };
renderer.domElement.onpointermove = event => {
  if (!pointer) return;
  yaw -= (event.clientX - pointer[0]) * .008; elevation = THREE.MathUtils.clamp(elevation + (event.clientY - pointer[1]) * .006, .03, 1.35);
  pointer = [event.clientX, event.clientY]; render();
};
renderer.domElement.addEventListener('wheel', event => { event.preventDefault(); distance = THREE.MathUtils.clamp(distance * Math.exp(event.deltaY * .001), 2, 220); render(); }, { passive: false });
let previous = performance.now();
function frame(now) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now;
  if (!paused) {
    for (const item of selection) {
      if (item.kind === 'car') {
        for (const door of item.built.doors) door.target = doorInput.checked ? 1 : 0;
        animateDoors(item.built.doors, dt);
        for (const wheel of item.built.wheels) {
          if (motionInput.checked) wheel.rotation.x += dt * 4 / wheel.userData.radius;
          wheel.userData.steering.rotation.y = wheel.userData.front ? -Number(document.getElementById('steer').value) : 0;
        }
      } else updateAircraftParts(item.built, dt, motionInput.checked);
    }
    render();
    const settled = selection.every(item => item.kind !== 'car' || item.built.doors.every(door => door.amount === door.target));
    document.body.dataset.ready = settled ? reviewState : '';
  }
  requestAnimationFrame(frame);
}
window.transportReview = { fleet, aircraft, items, show, render, scene, camera, renderer, failures: MODELS.failed, pause(value) { paused = value; } };
show('sedan'); requestAnimationFrame(frame);
