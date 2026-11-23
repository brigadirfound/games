// Сосед: ищет по звуку, а не глазами.
//
// Главное правило, на котором держится вся игра: он идёт НЕ к игроку, а к
// месту, где услышал шум. Замерев, игрок перестаёт для соседа существовать —
// это единственный способ оторваться, и он должен работать безотказно, иначе
// прятки превращаются в бег наперегонки.
//
// Путь ищем поиском в ширину по сетке стен. Сквозь стены он не ходит: сосед,
// проходящий насквозь, читается игроком мгновенно и убивает доверие к правилам.
//
// Слышит с разбросом в клетку. Точный слух сделал бы погоню безнадёжной:
// один громкий шаг — и он идёт прямо в лицо.

import * as THREE from 'three';
import { clearSight } from './light-sense.js?v=resident-devices-v32';

const HEAR_THRESHOLD = 0.40;    // ниже — не слышит
const HEAR_RANGE = 22;          // метров, дальше звук не доносится
// Быстрее идущего (3.0), медленнее спешащего (5.2). На 2.2 он не догонял вообще
// никого: спешка становилась стратегией без риска, и игра переставала быть игрой.
const SPEED = 3.4;
const CATCH_DIST = 1.6;
// Порога «упёрся» больше нет, и это вывод из замеров, а не упрощение.
//
// Идея была: замерший в темноте ловится, только если сосед наткнётся на него
// вплотную. На 1.6 м он ловился всегда, на 0.8 — в трёх забегах из трёх, на
// 0.45 — в двух из четырёх. Причина не в числе: путь ищется по клеткам сетки,
// игрок стоит В клетке, и маршрут к точке за его спиной проходит прямо сквозь
// него. Дистанция падает почти в ноль при ЛЮБОМ пороге.
//
// Значит, правило должно опираться не на расстояние, а на сигнал: молчащего и
// не светящего игрока сосед не замечает вовсе — он ищет по звуку, а звука нет.
// Это и есть подзаголовок игры дословно.
//
// Непобедимой стратегией это не делает: счёт начисляется за батарейки (см.
// score в game.js), и неподвижность стоит игроку всей партии.
const PAUSE_MS = 1600;
// Неточность слуха: цель всегда лежит в кольце вокруг игрока, не ближе
// SCATTER_MIN. Нижняя граница заметно больше радиуса «упёрся» (0.8 м) —
// иначе кольцо не спасало бы замершего, ради чего и заводилось.
const SCATTER_MIN = 1.4;
const SCATTER_MAX = 2.6;
const REPLAN_DIST = 2.5;        // насколько шум должен сместиться, чтобы менять цель
const MEMORY_MS = 4000;         // сколько сосед помнит услышанное

export class Neighbor {
  /**
   * @param {*} opts { map, apartment, mesh, tuning }
   *
   * Слух и скорость переехали из констант модуля в поля объекта: с цепочкой
   * ночей они растут от ночи к ночи, а модульная константа одна на всю игру.
   * Значения по умолчанию — те же, что были, поэтому старые вызовы работают.
   */
  constructor(opts) {
    this.map = opts.map;
    this.apt = opts.apartment;
    this.mesh = opts.mesh;

    const t = opts.tuning || {};
    this.speed = t.speed ?? SPEED;
    this.catchDelay=t.catchDelay??0;this.contactExposure=0;
    this.hearRange = t.hearRange ?? HEAR_RANGE;
    this.hearThreshold = t.hearThreshold ?? HEAR_THRESHOLD;

    this.pos = new THREE.Vector3(opts.apartment.neighborStart.x, 1, opts.apartment.neighborStart.z);
    this.path = [];
    this.pauseLeft = 0;
    this.lastHeard = null;
    this.heardAt = 0;
    this.goal = null;           // куда он идёт прямо сейчас, в метрах
    this.state = 'wander';
    this.stepped = false;       // снимается игрой после озвучивания
    this._stepPhase = 0;
    this.inspection = null;
    this.inspectCooldown = 0;
    this.revealSeconds = 0;
    this.stare=null;this.stareCooldown=0;this.avoidPoint=null;
  }

  // A remembered door, not a continuously tracked player position.
  investigateWardrobe(mount) {
    if (this.inspection || this.inspectCooldown > 0) return false;
    const stand = mount.entry.clone();
    stand.x += mount.nx*.55; stand.z += mount.nz*.55;
    if (!this.walkable(Math.floor(stand.x),Math.floor(stand.z))) stand.copy(mount.entry);
    const route = this.findPath(Math.floor(this.pos.x), Math.floor(this.pos.z),
      Math.floor(stand.x), Math.floor(stand.z));
    if (!route.length && (Math.floor(this.pos.x)!==Math.floor(stand.x)||Math.floor(this.pos.z)!==Math.floor(stand.z))) return false;
    route.push({x:stand.x,z:stand.z});
    this.inspection = { phase: 'approach', mount, stand, age: 0 };
    this.path = route; this.goal = {x:stand.x,z:stand.z};
    this.lastHeard = null; this.pauseLeft = 0; this.state = 'approach';
    return true;
  }

  cancelInspection() {
    if (!this.inspection) return;
    this.inspection = null; this.inspectCooldown = 12; this.path = [];
  }

  _leaveWardrobe() {
    const visit = this.inspection, w = visit.mount;
    // Choose a reachable room away from the door; never patrol the hiding spot forever.
    const rooms = [...this.apt.rooms].sort((a,b) =>
      Math.hypot(b.cx-w.entry.x,b.cz-w.entry.z)-Math.hypot(a.cx-w.entry.x,a.cz-w.entry.z));
    this.path = [];
    for (const r of rooms) {
      const target = this._nearestWalkable(Math.floor(r.cx),Math.floor(r.cz));
      if (!target) continue;
      const route = this.findPath(Math.floor(this.pos.x),Math.floor(this.pos.z),target.x,target.z);
      if (route.length >= 3) { this.path = route; break; }
    }
    visit.phase = 'leave'; visit.age = 0; this.state = 'leave'; this.pauseLeft = 0;
    this.lastHeard = null; this.goal = null;
  }

  _caught(dt, playerPos, s) {
    // During the announced room search, standing in his path is no longer cover.
    // Closing a wardrobe or breaking line of sight still works; no remote tracking.
    const searching=s.searchingRoom&&!s.hidden&&Math.hypot(this.pos.x-playerPos.x,this.pos.z-playerPos.z)<CATCH_DIST&&clearSight(this.apt,this.pos,playerPos);
    this.searchExposure=searching?(this.searchExposure||0)+dt:0;
    if(this.searchExposure>=.45)return true;
    const visible = !s.hidden && !(s.still && !s.light) &&
      this.pos.distanceTo(playerPos) < CATCH_DIST && clearSight(this.apt,this.pos,playerPos);
    // A brief peek is possible; keeping a door open or a light on gives him time to notice.
    this.revealSeconds = visible && s.wardrobe ? this.revealSeconds + dt : 0;
    this.contactExposure=visible&&!s.wardrobe?this.contactExposure+dt:0;
    return visible && (s.wardrobe?this.revealSeconds>=.7:this.contactExposure>=this.catchDelay);
  }

  /**
   * Ближайшая проходимая клетка кольцевым поиском.
   *
   * Слух неточен на полтора метра, и эта неточность регулярно указывает внутрь
   * стены. Раньше такой промах возвращал пустой путь, сосед вставал на 1.6 с — и
   * при беге игрока промахи шли подряд, так что он стоял почти всю партию.
   * Теперь мимо стены он идёт к ближайшей точке, откуда её слышно.
   */
  _nearestWalkable(x, z) {
    if (this.walkable(x, z)) return { x: x, z: z };
    for (let r = 1; r <= 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (this.walkable(x + dx, z + dz)) return { x: x + dx, z: z + dz };
        }
      }
    }
    return null;
  }

  /**
   * Проходима ли клетка сетки. Стены — из той же карты, что и рендер.
   *
   * Мебель проверяем по общему набору занятых клеток, который отдаёт
   * планировка. Раньше здесь перебирались только шкафы, и после появления
   * обстановки сосед прошёл бы сквозь диван, комод и холодильник — а сосед,
   * ходящий насквозь, читается игроком мгновенно и убивает доверие к правилам.
   */
  walkable(x, z) {
    const a = this.apt;
    if (x < 0 || z < 0 || x >= a.width || z >= a.depth) return false;
    if (a.wallGrid[z][x]) return false;
    if(this.trafficBlock&&Math.hypot(x+.5-this.trafficBlock.x,z+.5-this.trafficBlock.z)<.95)return false;
    if(this.avoidPoint&&Math.hypot(x+.5-this.avoidPoint.x,z+.5-this.avoidPoint.z)<1.2)return false;
    return !(a.occupied && a.occupied.has(z + ',' + x));
  }

  /**
   * Поиск в ширину. Квартира маленькая (24×32), поэтому полный обход дешевле
   * и надёжнее приоритетной очереди с эвристикой — и не даёт срезать углы.
   */
  findPath(fromX, fromZ, toX, toZ) {
    if (!this.walkable(toX, toZ)) return [];
    const key = (x, z) => z * this.apt.width + x;
    const prev = new Map();
    const seen = new Set([key(fromX, fromZ)]);
    const queue = [[fromX, fromZ]];

    while (queue.length) {
      const [x, z] = queue.shift();
      if (x === toX && z === toZ) {
        const path = [];
        let cur = key(x, z), cx = x, cz = z;
        while (prev.has(cur)) {
          path.unshift({ x: cx + 0.5, z: cz + 0.5 });
          const p = prev.get(cur);
          cx = p.x; cz = p.z; cur = key(cx, cz);
        }
        return path;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        const k = key(nx, nz);
        if (seen.has(k) || !this.walkable(nx, nz)) continue;
        seen.add(k);
        prev.set(k, { x, z });
        queue.push([nx, nz]);
      }
    }
    return [];
  }

  /** Услышал шум игрока. Громкость уже посчитана ходьбой. */
  hear(noise, playerPos) {
    // Finish clearing the doorway before a new footstep can cancel the retreat.
    if(this.stare?.phase==='leave'&&this.stare.age<3)return false;
    if (noise < this.hearThreshold) return false;
    const dist = this.pos.distanceTo(playerPos);
    if (dist > this.hearRange) return false;
    this.cancelInspection();

    // Разброс — КОЛЬЦО, а не круг.
    //
    // Круг регулярно давал точку ровно на игроке, и замерший в темноте всё
    // равно оказывался пойман: он сделал единственное, чему учит игра, и
    // проиграл без единого сигнала. Кольцо означает «иду туда, ОТКУДА
    // послышалось», а не «иду в тебя»: цель всегда в стороне, и найти
    // неподвижного можно только случайно задев его по дороге.
    const angle = Math.random() * Math.PI * 2;
    const radius = SCATTER_MIN + Math.random() * (SCATTER_MAX - SCATTER_MIN);
    const heard = {
      x: playerPos.x + Math.cos(angle) * radius,
      z: playerPos.z + Math.sin(angle) * radius,
    };
    this.state = 'seeking';
    this.pauseLeft = 0;

    // Свежий шум запоминаем всегда: дойдя до цели, сосед должен идти на текущий
    // звук, а не забывать шумящего игрока и уходить блуждать.
    this.lastHeard = heard;
    this.heardAt = performance.now();

    // А вот уже начатый маршрут рвём, только если звук ушёл заметно в сторону.
    // Иначе каждый шаг бегущего игрока перестраивал путь заново, и сосед
    // топтался на месте вместо того, чтобы идти по найденному.
    if (!this._replanSource || Math.hypot(playerPos.x-this._replanSource.x,playerPos.z-this._replanSource.z)>REPLAN_DIST) {
      this.path = [];
      this._replanSource={x:playerPos.x,z:playerPos.z};
    }
    return true;
  }

  /**
   * @param {*} sense { hidden, still, light } — как игрок заметен прямо сейчас
   * @returns true, если игрок пойман
   */
  _retreat(playerPos){
    this.avoidPoint={x:playerPos.x,z:playerPos.z};this.path=[];this.lastHeard=null;this.goal=null;
    const rooms=[...this.apt.rooms].sort((a,b)=>Math.hypot(b.cx-playerPos.x,b.cz-playerPos.z)-Math.hypot(a.cx-playerPos.x,a.cz-playerPos.z));
    for(const r of rooms){
      const target=this._nearestWalkable(Math.floor(r.cx),Math.floor(r.cz));if(!target)continue;
      const route=this.findPath(Math.floor(this.pos.x),Math.floor(this.pos.z),target.x,target.z);
      if(route.length>=2){this.path=route;break;}
    }
    if(!this.path.length){
      // If the player covers the only doorway, another room is unreachable.
      // Step deeper into the current room instead of retrying that doorway.
      const fromX=Math.floor(this.pos.x),fromZ=Math.floor(this.pos.z);
      const queue=[[fromX,fromZ]],seen=new Set([fromZ+','+fromX]);
      let target=null,best=this.pos.distanceTo(playerPos)+.5;
      for(let i=0;i<queue.length;i++){
        const [x,z]=queue[i],distance=Math.hypot(x+.5-playerPos.x,z+.5-playerPos.z);
        if(distance>best){best=distance;target={x,z};}
        for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
          const nx=x+dx,nz=z+dz,key=nz+','+nx;
          if(!seen.has(key)&&this.walkable(nx,nz)){seen.add(key);queue.push([nx,nz]);}
        }
      }
      if(target)this.path=this.findPath(fromX,fromZ,target.x,target.z);
    }
    this.pauseLeft=450;this.state='leave';
  }
  update(dt, playerPos, sense) {
    const s = sense || {};
    this.stareCooldown=Math.max(0,this.stareCooldown-dt);
    if(!this.stare&&this.stareCooldown===0)this.avoidPoint=null;
    this.inspectCooldown = Math.max(0,this.inspectCooldown-dt);
    if (this._caught(dt,playerPos,s)) return true;
    // Search reveals a stationary player in darkness, but never through a wall
    // or a closed wardrobe. A visible torch provokes the same chase at any time.
    const detected=!s.hidden&&(s.searchingRoom||s.light)&&
      this.pos.distanceTo(playerPos)<10&&clearSight(this.apt,this.pos,playerPos);
    this.chaseReplan=Math.max(0,(this.chaseReplan||0)-dt);
    this.lightAggro=Math.max(0,(this.lightAggro||0)-dt);
    if(detected){
      this.cancelInspection();this.stare=null;this.avoidPoint=null;this.pauseLeft=0;
      this.state='chase';if(s.light)this.lightAggro=2;
      this.lastHeard={x:playerPos.x,z:playerPos.z};this.heardAt=performance.now();
      if(!this.chaseReplan||!this.path.length){
        const target=this._nearestWalkable(Math.floor(playerPos.x),Math.floor(playerPos.z));
        if(target){this.path=this.findPath(Math.floor(this.pos.x),Math.floor(this.pos.z),target.x,target.z);this.goal={...this.lastHeard};}
        this.chaseReplan=.35;
      }
    }
    if(s.searchingRoom&&this.stare){this.stare=null;this.avoidPoint=null;}
    if(this.stare){
      this.stare.age+=dt;
      if(this.stare.phase==='watch'){
        this.heading=Math.atan2(playerPos.x-this.pos.x,playerPos.z-this.pos.z);this._face(dt);
        if(this.stare.age<2.6)return false;
        this.stare.phase='leave';this.stare.age=0;this._retreat(playerPos);
      }else if(!this.path.length||this.stare.age>12){
        this.stare=null;this.stareCooldown=12;this.state='wander';this.pauseLeft=700;
      }
    }
    const quiet=!s.hidden&&!s.wardrobe&&s.still&&!s.light&&!s.searchingRoom;
    if(quiet&&!this.stare&&this.stareCooldown===0&&this.pos.distanceTo(playerPos)<1.85&&clearSight(this.apt,this.pos,playerPos)){
      this.cancelInspection();this.path=[];this.stare={phase:'watch',age:0};this.state='stare';this.pauseLeft=0;
      this.heading=Math.atan2(playerPos.x-this.pos.x,playerPos.z-this.pos.z);this._face(dt);return false;
    }
    const visit = this.inspection;
    if (visit) {
      visit.age += dt;
      if (visit.phase === 'approach' && (!this.path.length || visit.age > 22)) {
        if (this.pos.distanceTo(visit.stand) > .6) this._leaveWardrobe();
        else { visit.phase = 'listen'; visit.age = 0; this.path = []; this.state = 'listen'; }
      }
      if (visit.phase === 'listen') {
        const w = visit.mount;
        const facing = Math.atan2(w.x+.5-this.pos.x,w.z+.5-this.pos.z);
        this.heading = facing + Math.sin(visit.age*1.35)*.16;
        this._face(dt);
        if (visit.age >= 4.4) this._leaveWardrobe();
        return false;
      }
      if (visit.phase === 'leave' && (!this.path.length || visit.age > 18)) {
        this.inspection = null; this.inspectCooldown = 12; this.state = 'wander';
        this.pauseLeft = 600;
      }
    }
    if (this.pauseLeft > 0) { this.pauseLeft -= dt * 1000; this._face(dt); return false; }

    if (!this.path.length && !this.inspection) {
      const fromX = Math.floor(this.pos.x), fromZ = Math.floor(this.pos.z);
      let target;

      // След остывает: старше MEMORY_MS звук уже не ведёт, иначе сосед вечно
      // ходил бы к месту, где игрока давно нет.
      const fresh = this.lastHeard && performance.now() - this.heardAt < MEMORY_MS;
      if (fresh) {
        this.goal = this.lastHeard;
        this.state = 'seeking';
        target = this._nearestWalkable(Math.floor(this.lastHeard.x), Math.floor(this.lastHeard.z));
        this.lastHeard = null;
        if (!target) { this.pauseLeft = PAUSE_MS; return false; }
      } else {
        this.goal = null;
        // Блуждание: сосед просто живёт в квартире, а не караулит игрока.
        const otherRooms = this.apt.rooms.filter(r=>Math.hypot(r.cx-this.pos.x,r.cz-this.pos.z)>4);
        const choices = otherRooms.length ? otherRooms : this.apt.rooms;
        const room = choices[Math.floor(Math.random() * choices.length)];
        target = this._nearestWalkable(Math.floor(room.cx),Math.floor(room.cz));
        if(!target){this.pauseLeft=PAUSE_MS;return false;}
        this.state = 'wander';
      }

      this.path = this.findPath(fromX, fromZ, target.x, target.z);
      if (!this.path.length) { this.pauseLeft = PAUSE_MS; return false; }
    }

    // Consume adjacent waypoints in the same frame. A separate zero-distance
    // frame used to drop the walking blend at every tile and snap the heading.
    const pace=this.lightAggro>0?Math.max(4.1,this.speed*1.5):s.searchingRoom?Math.max(3.5,this.speed*1.4):this.speed;
    let remaining=pace*(this.state==='leave'?.65:1)*dt,travel=0;
    while(this.path.length&&remaining>0) {
      const next=this.path[0],dx=next.x-this.pos.x,dz=next.z-this.pos.z;
      const dist=Math.hypot(dx,dz);
      if(dist<.00001){this.path.shift();continue;}
      const step=Math.min(remaining,dist);
      // Do not step through a silent player, including while leaving a stare.
      const nextX=this.pos.x+dx/dist*step,nextZ=this.pos.z+dz/dist*step;
      if(quiet&&Math.hypot(nextX-playerPos.x,nextZ-playerPos.z)<1.25&&
        Math.hypot(nextX-playerPos.x,nextZ-playerPos.z)<this.pos.distanceTo(playerPos)){
        if(quiet&&!this.stare&&this.stareCooldown===0){this.stare={phase:'watch',age:0};this.state='stare';this.path=[];}
        else this._retreat(playerPos);
        break;
      }
      const peer=(s.neighbors||[]).find(n=>n!==this&&Math.hypot(nextX-n.pos.x,nextZ-n.pos.z)<.9&&
        Math.hypot(nextX-n.pos.x,nextZ-n.pos.z)<this.pos.distanceTo(n.pos));
      if(peer){
        this.trafficWait=(this.trafficWait||0)+dt;
        // Stable priority prevents both agents from changing direction together.
        // The second one yields first; the first can recover if its peer is idle.
        const later=s.neighbors.indexOf(this)>s.neighbors.indexOf(peer);
        if(this.trafficWait>(later?.45:1.4)){
          this.trafficBlock=peer.pos;
          const rooms=[...this.apt.rooms].sort((a,b)=>Math.hypot(b.cx-peer.pos.x,b.cz-peer.pos.z)-Math.hypot(a.cx-peer.pos.x,a.cz-peer.pos.z));
          let route=[];
          for(const room of rooms){
            const target=this._nearestWalkable(Math.floor(room.cx),Math.floor(room.cz));
            if(target)route=this.findPath(Math.floor(this.pos.x),Math.floor(this.pos.z),target.x,target.z);
            if(route.length>1)break;
          }
          this.trafficBlock=null;
          if(route.length>1){this.cancelInspection();this.path=route;this.lastHeard=null;this.goal=null;this.state='wander';this.pauseLeft=0;}
          this.trafficWait=0;
        }
        break;
      }
      this.trafficWait=0;
      this.pos.x+=dx/dist*step;this.pos.z+=dz/dist*step;
      remaining-=step;travel+=step;this.heading=Math.atan2(dx,dz);
      if(step>=dist-.00001)this.path.shift();
    }
    if (!this.path.length && !this.inspection) {
        // Дошёл. Прислушивается — но если игрок шумит прямо сейчас, замирать на
        // полторы секунды посреди погони нельзя, иначе оторваться можно просто
        // добежав до его же цели.
        const hot = this.lastHeard && performance.now() - this.heardAt < MEMORY_MS;
        this.pauseLeft = hot ? 250 : PAUSE_MS;
        if (!hot) this.state = 'wander';
    }
    if(travel>0) {
      // Шаг отмеряем пройденным путём, как у игрока. Флаг снимает игра: звук
      // соседа собирается там, потому что только там известно, куда смотрит
      // игрок, — а без стороны звучания подсказка бесполезна.
      this._stepPhase = (this._stepPhase || 0) + travel;
      if (this._stepPhase >= 0.95) { this._stepPhase = 0; this.stepped = true; }
    }

    if (this.mesh) {
      this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
      this._face(dt);
    }

    // В шкафу игрока не находят даже вплотную: правило должно быть
    // безусловным, иначе укрытие перестаёт быть укрытием.
    if (s.hidden) return false;
    // Фонарь выдаёт даже неподвижного: свет в тёмной квартире виден издалека,
    // и это делает выбор «светить или замереть» настоящим. А замерший в
    // темноте не обнаруживается ни на каком расстоянии.
    if (s.still && !s.light) return false;
    // Contact timing is evaluated once per frame by _caught, including search.
    return false;
  }

  _face(dt=0) {
    if(!this.mesh||this.heading===undefined)return;
    const delta=Math.atan2(Math.sin(this.heading-this.mesh.rotation.y),Math.cos(this.heading-this.mesh.rotation.y));
    this.mesh.rotation.y+=THREE.MathUtils.clamp(delta,-3.2*dt,3.2*dt);
  }
}
