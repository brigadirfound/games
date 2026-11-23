import * as THREE from 'three';
import { CAR_TYPES, CAR_BY_ID, TANK_TYPE, Vehicle } from './vehicle.js';
import { MODELS } from './models.js';
import { animateDoors } from './vehicle-rig.js';
import { AIRCRAFT_TYPES, buildAircraft, updateAircraftParts, aircraftLoadFailures } from './aircraft-models.js';
import { PoliceHelicopter } from './helicopter.js';

// Explicit development route; runs against the same city, Vehicle and mount
// logic as normal play. It never writes the player's saved games.
export function runTransportChecks(game) {
  const checks = [];
  const check = (name, pass, detail = null) => checks.push({ name, pass: !!pass, detail });
  const oldVehicles = game.vehicles, oldPlayer = { x: game.player.x, z: game.player.z, y: game.player.y };
  game.player.inVehicle = null; game.mount = null; game.vehicles = [];
  check('Все модели загружены', MODELS.failed.length === 0 && aircraftLoadFailures.length === 0, [MODELS.failed, aircraftLoadFailures]);
  check('Танк в городе один', oldVehicles.filter(v=>v.type.id==='tank' && v.unique).length === 1);
  const emptyCity = { ramps: [], nearbyColliders: () => [] };
  try {
    for (const type of [...CAR_TYPES, TANK_TYPE, { ...CAR_BY_ID.sedan, id: 'police' }]) {
      const police = type.id === 'police';
      const vehicle = new Vehicle(game.city, { x: 68, z: 0, heading: 0, type: police ? CAR_BY_ID.sedan : type, police });
      game.vehicles = [vehicle]; game.scene.add(vehicle.mesh);
      check(`${type.id}: новый GLB`, vehicle.mesh.userData.approvedFleet);
      const painted=[];let paintedWheel=false;
      vehicle.mesh.traverse(node=>{if(!node.isMesh)return;for(const m of Array.isArray(node.material)?node.material:[node.material]){if(m.userData.vehiclePaint&&!painted.includes(m))painted.push(m);}});
      for(const wheel of vehicle.wheels) wheel.traverse(node=>{if(node.isMesh)for(const m of Array.isArray(node.material)?node.material:[node.material])paintedWheel ||= !!m.userData.vehiclePaint;});
      check(`${type.id}: резина не красится`, !paintedWheel);
      if(painted.length) {
        vehicle.color=0x286699;vehicle.repair();
        check(`${type.id}: двери и кузов одного цвета`,painted.every(m=>m.color.getHex()===0x286699));
      }
      const expectedWheels = type.id === 'tank' ? 0 : type.bike ? 2 : ['schoolbus','garbage'].includes(type.id) ? 6 : 4;
      check(`${type.id}: колёса / двери`, vehicle.wheels.length === expectedWheels && vehicle.doors.length === (type.bike || type.id === 'tank' ? 0 : 2), [vehicle.wheels.length, vehicle.doors.length]);
      for (const door of vehicle.doors) door.target = 1;
      animateDoors(vehicle.doors, .16);
      check(`${type.id}: плавное открытие`, vehicle.doors.every(door => Math.abs(Math.abs(door.hinge.rotation.y) - .56) < 1e-5));
      animateDoors(vehicle.doors, .16);
      check(`${type.id}: полный угол`, vehicle.doors.every(door => Math.abs(Math.abs(door.hinge.rotation.y) - 1.12) < 1e-5));
      for (const door of vehicle.doors) door.target = 0;
      animateDoors(vehicle.doors, .32);
      for (const side of [-1, 1]) {
        const point = game.doorPoint(vehicle, side);
        Object.assign(game.player, point); game.player.y = 0; game.player.syncMesh();
        game.tryEnterVehicle();
        check(`${type.id}: вход с борта ${side}`, game.mount?.v === vehicle && game.mount?.sign === side);
        for (let n = 0; n < 150; n++) { if (game.mount) game.updateMount(1/60); vehicle.update(1/60); }
        check(`${type.id}: посадка ${side}`, game.player.inVehicle === vehicle && !game.mount && vehicle.doors.every(d => d.amount === 0));
        game.exitVehicle(false, false);
        for (let n = 0; n < 150; n++) { if (game.mount) game.updateMount(1/60); vehicle.update(1/60); }
        check(`${type.id}: высадка ${side}`, !game.player.inVehicle && !game.mount && vehicle.doors.every(d => d.amount === 0));
      }
      const wheelCenters = vehicle.wheels.map(w => w.userData.steering.position.clone());
      vehicle.city = emptyCity;
      for (let n = 0; n < 120; n++) vehicle.drive(1/60, 1, .3, false);
      check(`${type.id}: едет и рулит`, Number.isFinite(vehicle.x) && vehicle.speed > 1 && vehicle.wheels.every((w,i) => w.userData.steering.position.distanceTo(wheelCenters[i]) < 1e-6));
      vehicle.setHeadlights(true);
      check(`${type.id}: свет`, vehicle.headLights.every(m => !m.userData.staLamp || m.emissiveIntensity === 2));
      if(police || type.emergency) {
        vehicle.sirenOn=true;vehicle.update(.1);
        check(`${type.id}: штатные мигалки`,!vehicle.lightbar && vehicle.sirenMaterials.length>=2 && vehicle.sirenMaterials.some(m=>m.emissiveIntensity>0));
      }
      game.scene.remove(vehicle.mesh);
      // Frame-rate invariance through the real drive integrator.
      const speeds = [30,60,144].map(fps => {
        const v = new Vehicle(emptyCity, { type });
        for (let n=0;n<fps*3;n++) v.drive(1/fps,1,0,false);
        return v.speed;
      });
      check(`${type.id}: 30/60/144 FPS`, Math.max(...speeds) - Math.min(...speeds) < .15, speeds);
    }
    for (const type of AIRCRAFT_TYPES) {
      const a = buildAircraft(type.id), b = buildAircraft(type.id);
      check(`${type.id}: импорт авиации`, a.group.userData.importedAircraft);
      const moving = type.kind === 'helicopter' ? [a.mainRotor,a.tailRotor] : a.parts.propellers;
      check(`${type.id}: число винтов`, moving.filter(Boolean).length === (type.id === 'trainer' ? 1 : 2));
      const positions = moving.map(p => p.position.clone());
      updateAircraftParts(a, .1);
      check(`${type.id}: вращение без смещения оси`, moving.every((p,i) => p.position.distanceTo(positions[i]) === 0 && Math.abs(p.rotation.x)+Math.abs(p.rotation.y)+Math.abs(p.rotation.z)>0));
      const second = type.kind === 'helicopter' ? [b.mainRotor,b.tailRotor] : b.parts.propellers;
      check(`${type.id}: независимые экземпляры`, second.every(p => p.rotation.x === 0 && p.rotation.y === 0 && p.rotation.z === 0));
    }
    const heli = new PoliceHelicopter(game, 68, 42);
    const initial = heli.rotor.rotation.y;
    for (let n=0;n<120;n++) heli.update(1/60,{policeShoot(){}});
    check('Полицейский вертолёт: полёт ИИ', heli.mesh.userData.importedAircraft && heli.rotor.rotation.y !== initial && Number.isFinite(heli.x));
    heli.damage(221); check('Полицейский вертолёт: повреждение', heli.dead);
    game.scene.remove(heli.mesh);
  } finally {
    for (const vehicle of game.vehicles) game.scene.remove(vehicle.mesh);
    game.vehicles = oldVehicles; game.mount = null; game.player.inVehicle = null;
    Object.assign(game.player,oldPlayer); game.player.syncMesh();
  }
  return { passed: checks.filter(c=>c.pass).length, total: checks.length, failures: checks.filter(c=>!c.pass), checks };
}
