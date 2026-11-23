import * as THREE from 'three';
import { CAR_TYPES, CAR_BY_ID, TANK_TYPE, Vehicle } from './vehicle.js';
import { AIRCRAFT_TYPES, buildAircraft, updateAircraftParts } from './aircraft-models.js';
import { animateDoors } from './vehicle-rig.js';
import { runTransportChecks } from './transport-game-checks.js';

export function installTransportTest(game, start, drive) {
  const panel = document.createElement('aside'); panel.id = 'transport-test';
  panel.style.cssText = 'position:fixed;z-index:10000;left:16px;top:16px;max-width:640px;background:#14202eec;color:white;padding:12px;border:1px solid #69819a;border-radius:8px;font:14px system-ui';
  panel.innerHTML = `<b>Транспорт в городе</b> <select aria-label="Тестовая модель"></select>
    <button id="transport-doors">Двери</button> <button id="transport-drive">За руль</button>
    <button id="transport-checks">Проверить парк</button> <a href="./transport-review.html" style="color:#bde">Мастерская</a>
    <div id="transport-state" style="margin-top:8px">Выбери модель. F — сесть/выйти, WASD — ехать, P — пауза.</div>
    <details><summary>Результаты проверок</summary><pre id="transport-results" style="max-height:220px;overflow:auto;white-space:pre-wrap"></pre></details>`;
  document.body.append(panel);
  // Native select navigation must not trigger game hotkeys (P, F, Space).
  for (const event of ['keydown', 'keyup']) panel.addEventListener(event, e => e.stopPropagation());
  const select = panel.querySelector('select');
  for (const type of [...CAR_TYPES,TANK_TYPE,{id:'police',name:'Police'},...AIRCRAFT_TYPES]) {
    const option = document.createElement('option'); option.value=type.id;option.textContent=type.name;select.append(option);
  }
  let vehicle = null, aircraft = null, opened = false;
  const status = panel.querySelector('#transport-state');
  function show(id) {
    panel.dataset.ready='';
    start(); game.paused=true; game.mount=null; game.player.inVehicle=null;game.player.mesh.visible=true;
    game.input.keys.clear(); game.input.endFrame();
    if(vehicle) game.destroyVehicle(vehicle);
    if(aircraft) game.scene.remove(aircraft.group);
    for (const v of [...game.vehicles]) if(Math.hypot(v.x-68,v.z)<30) game.destroyVehicle(v);
    vehicle=null;aircraft=null;opened=false;
    if(AIRCRAFT_TYPES.some(t=>t.id===id)) {
      aircraft=buildAircraft(id);aircraft.group.position.set(68,0,0);game.scene.add(aircraft.group);
    } else {
      vehicle=new Vehicle(game.city,{x:68,z:0,heading:0,type:id==='tank'?TANK_TYPE:CAR_BY_ID[id]||CAR_BY_ID.sedan,police:id==='police'});
      vehicle.isMissionTarget=true; game.attachVehicleHooks(vehicle);game.vehicles.push(vehicle);game.scene.add(vehicle.mesh);
    }
    const point=vehicle?game.doorPoint(vehicle,-1):{x:74,z:4};
    game.player.x=point.x;game.player.z=point.z;game.player.y=0;game.player.syncMesh();
    game.spawnGrace=999;game.wanted=0;game.clockTime=13*3600;game.updateDayNight(0);
    game.tutorial.skip();
    const bounds=new THREE.Box3().setFromObject(vehicle?.mesh||aircraft.group),size=bounds.getSize(new THREE.Vector3());
    const center=bounds.getCenter(new THREE.Vector3());const d=Math.max(6,size.length()*.80);
    game.camera.position.copy(center).add(new THREE.Vector3(-d*(aircraft ? .28 : .75),d*.38,d*.85));game.camera.lookAt(center);game.render();
    status.textContent=vehicle?'Модель в игровом городе. Двери — осмотр; За руль — управление.':'Авиация в игровом освещении; винты вращаются. Управление полётом игрока пока отсутствует.';
    game.hud.update(game,0);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{panel.dataset.ready=id;}));
  }
  select.onchange=()=>show(select.value);
  panel.querySelector('#transport-doors').onclick=()=>{opened=!opened;if(vehicle)for(const d of vehicle.doors)d.target=opened?1:0;};
  panel.querySelector('#transport-drive').onclick=event=>{
    if(!vehicle)return;
    event.currentTarget.blur();
    for(const d of vehicle.doors)d.target=0;opened=false;
    const point=game.doorPoint(vehicle,-1);game.player.x=point.x;game.player.z=point.z;game.player.syncMesh();
    game.cam.yaw=0;game.cam.pitch=.2;game.tryEnterVehicle();drive();
  };
  panel.querySelector('#transport-checks').onclick=()=>{
    start();game.paused=true;
    try {
      const result=runTransportChecks(game);
      panel.querySelector('#transport-results').textContent=JSON.stringify(result,null,2);
      show(select.value);status.textContent=`Проверки: ${result.passed}/${result.total}; ошибок: ${result.failures.length}`;
    } catch(error) {status.textContent='Ошибка проверки: '+error.message;console.error(error);}
  };
  let previous=performance.now();
  function frame(now){const dt=Math.min(.05,(now-previous)/1000);previous=now;if(game.paused){if(vehicle)animateDoors(vehicle.doors,dt);if(aircraft)updateAircraftParts(aircraft,dt);}requestAnimationFrame(frame);}
  requestAnimationFrame(frame);show('sedan');
}
