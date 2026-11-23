import { CITY } from './city.js';
import { angleDiff, clamp, rand, pick } from './physics.js';

const LANE = 4.2;

export class TrafficAI {
  constructor(city, vehicle) {
    this.city = city;
    this.v = vehicle;
    this.node = this.nearestNode(vehicle.x, vehicle.z);
    this.next = this.pickNext(this.node, -1);
    this.stuckT = 0;
    this.hornCd = rand(2, 10);
  }

  nearestNode(x, z) {
    const i = clamp(Math.round((x + CITY.HALF) / CITY.SPACING), 0, CITY.N - 1);
    const j = clamp(Math.round((z + CITY.HALF) / CITY.SPACING), 0, CITY.N - 1);
    return this.city.nodeGrid[i][j];
  }

  /**
   * Куда ехать с перекрёстка.
   *
   * Раньше направление бралось совершенно случайно, и машина на каждом
   * узле могла свернуть куда угодно — движение выглядело как метание, а
   * не как поток. Теперь прямое направление в разы вероятнее поворота,
   * а разворот почти исключён: так на улице появляется течение.
   */
  pickNext(nodeIdx, avoid) {
    const n = this.city.nodes[nodeIdx];
    const opts = n.links.filter((l) => l !== avoid);
    if (!opts.length) return pick(n.links);
    if (avoid < 0 || opts.length === 1) return pick(opts);

    const cur = n, from = this.city.nodes[avoid];
    const ix = cur.x - from.x, iz = cur.z - from.z;
    const il = Math.hypot(ix, iz) || 1;

    let sum = 0;
    const w = opts.map((l) => {
      const t = this.city.nodes[l];
      const ox = t.x - cur.x, oz = t.z - cur.z;
      const ol = Math.hypot(ox, oz) || 1;
      // 1 — прямо, 0 — поворот на 90°, −1 — разворот назад
      const dot = (ix / il) * (ox / ol) + (iz / il) * (oz / ol);
      const weight = dot > 0.7 ? 6 : dot > -0.3 ? 1.4 : 0.1;
      sum += weight;
      return weight;
    });
    let r = Math.random() * sum;
    for (let k = 0; k < opts.length; k++) { r -= w[k]; if (r <= 0) return opts[k]; }
    return opts[opts.length - 1];
  }

  targetPoint() {
    const a = this.city.nodes[this.node];
    const b = this.city.nodes[this.next];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    return { x: b.x + uz * LANE, z: b.z - ux * LANE, ux, uz };
  }

  update(dt, ctx) {
    const v = this.v;
    if (v.destroyed) { v.drive(dt, 0, 0, true); return; }

    const tp = this.targetPoint();
    const dx = tp.x - v.x, dz = tp.z - v.z;
    const dist = Math.hypot(dx, dz);

    // 9 м означало «поворачиваю, ещё не доехав» — машины срезали углы
    // и выкатывались на встречную.
    if (dist < 6) {
      const prev = this.node;
      this.node = this.next;
      this.next = this.pickNext(this.node, prev);
    }

    const desired = Math.atan2(dx, dz);
    const diff = angleDiff(v.heading, desired);
    // Было -diff * 1.6 с полным размахом: при отклонении всего в треть
    // радиана руль уходил в упор, и машину мотало между полосами.
    const steer = clamp(-diff * 1.05, -0.85, 0.85);

    let throttle = 1;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const lookAhead = 6 + Math.abs(v.speed) * 0.8;

    // traffic light obedience
    const movingAlongZ = Math.abs(fz) > Math.abs(fx);
    const nextNode = this.city.nodes[this.next];
    const distToNode = Math.hypot(nextNode.x - v.x, nextNode.z - v.z);
    if (distToNode < 22 && distToNode > 8) {
      if (!this.city.lightStateAt(nextNode.x, nextNode.z, movingAlongZ)) {
        throttle = distToNode < 15 ? -0.7 : 0;
      }
    }

    for (const other of ctx.vehicles) {
      if (other === v) continue;
      const ox = other.x - v.x, oz = other.z - v.z;
      const along = ox * fx + oz * fz;
      if (along < 0.5 || along > lookAhead) continue;
      if (Math.abs(ox * fz - oz * fx) < 2.7) {
        throttle = Math.min(throttle, along < 5 ? -0.6 : 0);
        this.hornCd -= dt;
        if (this.hornCd <= 0 && ctx.honk) { this.hornCd = rand(4, 12); ctx.honk(v.x, v.z); }
        break;
      }
    }

    if (throttle > 0) {
      const p = ctx.player;
      if (!p.inVehicle && !p.dead) {
        const ox = p.x - v.x, oz = p.z - v.z;
        const along = ox * fx + oz * fz;
        if (along > 0 && along < lookAhead * 0.8 && Math.abs(ox * fz - oz * fx) < 2.3) throttle = -0.5;
      }
    }

    if (Math.abs(diff) > 0.5) throttle = Math.min(throttle, 0.35);
    // Плавное удержание скорости вместо «газ в пол / сброс в ноль» по порогу:
    // прежний жёсткий потолок давал вечное подёргивание всего потока.
    const cruise = 15;
    if (throttle > 0) throttle = Math.min(throttle, clamp((cruise - v.speed) * 0.35, 0, 1));

    if (Math.abs(v.speed) < 0.6 && throttle > 0) {
      this.stuckT += dt;
      if (this.stuckT > 2.5) {
        v.speed = -3;
        if (this.stuckT > 4.5) {
          this.stuckT = 0;
          this.node = this.nearestNode(v.x, v.z);
          this.next = this.pickNext(this.node, -1);
        }
      }
    } else this.stuckT = 0;

    v.drive(dt, throttle, steer, false);
  }
}

export class PoliceAI {
  constructor(city, vehicle) {
    this.city = city;
    this.v = vehicle;
    this.v.sirenOn = true;
    this.shootCd = rand(1, 3);
    this.stuckT = 0;
    this.mode = 'chase';
    this.pitT = 0;
    this.boxes = [];
  }

  probe(ang, len) {
    const v = this.v;
    const sx = Math.sin(ang), sz = Math.cos(ang);
    for (const b of this.boxes) {
      for (let t = 3; t <= len; t += 3) {
        const px = v.x + sx * t, pz = v.z + sz * t;
        if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ) return t;
      }
    }
    return Infinity;
  }

  update(dt, ctx) {
    const v = this.v;
    if (v.destroyed) { v.sirenOn = false; v.drive(dt, 0, 0, true); return; }

    const p = ctx.player;
    const tx = p.inVehicle ? p.inVehicle.x : p.x;
    const tz = p.inVehicle ? p.inVehicle.z : p.z;
    const pvx = p.inVehicle ? p.inVehicle.vx : 0;
    const pvz = p.inVehicle ? p.inVehicle.vz : 0;

    // intercept: lead the target
    const dist = Math.hypot(tx - v.x, tz - v.z);
    const lead = clamp(dist / 30, 0, 1.4);
    const ix = tx + pvx * lead, iz = tz + pvz * lead;
    let dx = ix - v.x, dz = iz - v.z;

    this.city.nearbyColliders(v.x, v.z, 24, this.boxes);
    let steerTarget = Math.atan2(dx, dz);
    const ahead = this.probe(v.heading, 17);
    if (ahead < 17) {
      const left = this.probe(v.heading - 0.7, 17);
      const right = this.probe(v.heading + 0.7, 17);
      steerTarget = v.heading + (left > right ? -0.85 : 0.85);
    }

    const diff = angleDiff(v.heading, steerTarget);
    const steer = clamp(-diff * 1.9, -1, 1);
    let throttle = 1;
    let hand = false;

    // PIT maneuver when alongside a fleeing player car
    if (ctx.wanted >= 3 && p.inVehicle && dist < 7 && Math.abs(v.speed) > 14) {
      this.pitT += dt;
      if (this.pitT > 0.5) { hand = false; throttle = 1; }
    } else this.pitT = 0;

    if (dist < 7 && Math.abs(v.speed) > 13) throttle = -0.5;
    if (Math.abs(diff) > 0.95) throttle = 0.4;

    if (Math.abs(v.speed) < 0.7 && throttle > 0) {
      this.stuckT += dt;
      if (this.stuckT > 1.5) { v.speed = -6; if (this.stuckT > 3) this.stuckT = 0; }
    } else this.stuckT = 0;

    v.drive(dt, throttle, steer, hand);

    this.shootCd -= dt;
    if (!p.inVehicle && ctx.wanted >= 3 && dist < 28 && this.shootCd <= 0) {
      this.shootCd = rand(1.2, 2.6);
      ctx.policeShoot(v.x, v.z, tx, tz);
    }
  }
}

export class CopAI {
  constructor(city, character, opts = {}) {
    this.city = city;
    this.c = character;
    this.shootCd = rand(0.5, 2);
    this.swat = !!opts.swat;
    this.range = this.swat ? 30 : 24;
    this.dmg = this.swat ? 13 : 8;
  }

  update(dt, ctx) {
    const c = this.c;
    if (c.dead) return;
    const p = ctx.player;
    const tx = p.inVehicle ? p.inVehicle.x : p.x;
    const tz = p.inVehicle ? p.inVehicle.z : p.z;
    const dx = tx - c.x, dz = tz - c.z;
    const dist = Math.hypot(dx, dz);

    const keep = this.swat ? 12 : 9;
    if (dist > keep) c.move(dt, dx, dz, this.swat ? 4.0 : 3.4);
    else {
      c.move(dt, 0, 0, 0);
      c.heading = Math.atan2(dx, dz);
      c.aiming = true;
      c.syncMesh();
    }

    this.shootCd -= dt;
    if (dist < this.range && this.shootCd <= 0) {
      this.shootCd = this.swat ? rand(0.5, 1.2) : rand(0.9, 2.0);
      ctx.policeShoot(c.x, c.z, tx, tz, this.dmg);
    }
  }
}
