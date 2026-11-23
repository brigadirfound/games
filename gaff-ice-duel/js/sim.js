// Симуляция боя: чистая логика без THREE и без DOM.
// Шаг фиксированный (T.step), вход — намерения бойцов (intents), выход — события.
// Именно этот файл поедет на хост в онлайн-режиме без переписывания.
import { T } from './tuning.js';
import { ARENA, holeAt, resolveCollision, sweepCollision, traceHook, insideArena, torosAt } from './arena.js';

export const STATE = {
  IDLE: 'idle', DASH: 'dash', PULLED: 'pulled', SELFPULL: 'selfpull',
  STUNNED: 'stunned', HOLE: 'hole', FINISHER: 'finisher', DEAD: 'dead',
};

/** Намерение за тик. Один и тот же формат у игрока, бота и (в будущем) сети. */
export function emptyIntent() {
  return { move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, cast: [] };
}

export function createFighter(id, spawn, facingTo) {
  const dx = facingTo.x - spawn.x, dz = facingTo.z - spawn.z;
  return {
    id,
    hp: T.match.hp, maxHp: T.match.hp,
    x: spawn.x, z: spawn.z, y: 0,
    px: spawn.x, pz: spawn.z, py: 0,       // прошлый тик — для интерполяции рендера
    vx: 0, vz: 0,
    yaw: Math.atan2(-dx, -dz), pyaw: Math.atan2(-dx, -dz),
    aim: { x: facingTo.x, z: facingTo.z },
    state: STATE.IDLE, stateT: 0,
    cd: { hook: 0, dash: 0, trap: 0 },
    iframe: 0, meleeCd: 0, swing: 0, throwT: 0,
    hook: null,
    dashDir: { x: 0, z: 0 },
    pullSpeed: 0,
    holeDone: false,
    holeDir: { x: 0, z: 0 },   // куда боец двигался, когда провалился
    holeGrace: 0,              // короткая передышка после вылезания
  };
}

export class Sim {
  constructor() {
    this.fighters = [
      createFighter(0, ARENA.spawns[0], ARENA.spawns[1]),
      createFighter(1, ARENA.spawns[1], ARENA.spawns[0]),
    ];
    this.traps = [];
    this.events = [];
    this.finisher = null;       // ЕДИНСТВЕННЫЙ замок добивания на всю симуляцию
    this.time = 0;
    this.over = null;           // { winner, reason }
    this._trapSeq = 0;
  }

  enemyOf(f) { return this.fighters[f.id === 0 ? 1 : 0]; }
  emit(type, data) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  /** Сброс кулдаунов — используется наградой за просмотр рекламы между раундами. */
  clearCooldowns(id) {
    const f = this.fighters[id];
    f.cd.hook = 0; f.cd.dash = 0; f.cd.trap = 0;
  }

  step(intents) {
    const dt = T.step;
    this.time += dt;

    for (const f of this.fighters) {
      f.px = f.x; f.pz = f.z; f.py = f.y; f.pyaw = f.yaw;
      if (f.state === STATE.DEAD) continue;
      const intent = intents[f.id] ?? emptyIntent();
      f.aim.x = intent.aim.x; f.aim.z = intent.aim.z;

      f.cd.hook = Math.max(0, f.cd.hook - dt);
      f.cd.dash = Math.max(0, f.cd.dash - dt);
      f.cd.trap = Math.max(0, f.cd.trap - dt);
      f.iframe = Math.max(0, f.iframe - dt);
      f.meleeCd = Math.max(0, f.meleeCd - dt);
      f.swing = Math.max(0, f.swing - dt);
      f.throwT = Math.max(0, f.throwT - dt);

      this._casts(f, intent);
      this._move(f, intent, dt);
    }

    for (const f of this.fighters) this._hook(f, dt);
    this._traps(dt);
    this._finisher(dt);
    for (const f of this.fighters) this._contact(f);
    for (const f of this.fighters) this._holes(f, dt);

    if (!this.over && this.time > T.match.roundTime) {
      // время вышло — победа по остатку HP, при равенстве ничья
      const [a, b] = this.fighters;
      const winner = a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1);
      this.over = { winner, reason: 'time' };
      this.emit('round-over', this.over);
    }
  }

  /* ------------------------------------------------------------- намерения */

  _canAct(f) {
    return f.state === STATE.IDLE && !this.finisher;
  }

  _casts(f, intent) {
    if (!intent.cast.length) return;
    for (const ability of intent.cast) {
      if (ability === 'hook' && this._canAct(f) && !f.hook && f.cd.hook <= 0) this._castHook(f);
      else if (ability === 'dash' && f.cd.dash <= 0 && this._canDash(f)) this._castDash(f);
      else if (ability === 'trap' && this._canAct(f) && f.cd.trap <= 0) this._castTrap(f);
    }
    intent.cast.length = 0;
  }

  /** Рывок доступен и во время замаха чужого добивания — это окно спасения. */
  _canDash(f) {
    if (f.state === STATE.IDLE) return true;
    return this.finisher?.target === f && f.state !== STATE.STUNNED && f.state !== STATE.HOLE;
  }

  _aimDir(f) {
    const dx = f.aim.x - f.x, dz = f.aim.z - f.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return { x: -Math.sin(f.yaw), z: -Math.cos(f.yaw) };
    return { x: dx / len, z: dz / len };
  }

  _castHook(f) {
    const d = this._aimDir(f);
    f.yaw = Math.atan2(-d.x, -d.z);
    f.cd.hook = T.hook.cooldown;
    f.throwT = 0.25;
    f.hook = {
      x: f.x, z: f.z, dirX: d.x, dirZ: d.z,
      traveled: 0, phase: 'fly', t: 0,
      anchorX: 0, anchorZ: 0, target: null,
    };
    this.emit('hook-throw', { id: f.id, x: f.x, z: f.z });
  }

  _castDash(f) {
    const d = this._aimDir(f);
    if (this.finisher?.target === f) {
      this.finisher.escaped = true;               // выскочил из-под добивания
    }
    f.state = STATE.DASH;
    f.stateT = T.dash.time;
    f.dashDir = d;
    f.iframe = Math.max(f.iframe, T.dash.iframes);
    f.cd.dash = T.dash.cooldown;
    f.yaw = Math.atan2(-d.x, -d.z);
    f.vx = 0; f.vz = 0;
    this.emit('dash', { id: f.id, x: f.x, z: f.z });
  }

  _castTrap(f) {
    const d = this._aimDir(f);
    const want = Math.hypot(f.aim.x - f.x, f.aim.z - f.z);
    const dist = Math.min(want, T.trap.castRange);
    const x = f.x + d.x * dist, z = f.z + d.z * dist;
    if (!insideArena(x, z, 1.0) || torosAt(x, z, 0.4) || holeAt(x, z, -0.5)) {
      this.emit('cast-fail', { id: f.id });
      return;
    }
    // одна ловушка на бойца: старая снимается
    this.traps = this.traps.filter((t) => t.owner !== f.id);
    this.traps.push({ id: ++this._trapSeq, owner: f.id, x, z, arm: T.trap.arm, life: T.trap.life });
    f.cd.trap = T.trap.cooldown;
    this.emit('trap-set', { id: f.id, x, z });
  }

  /* --------------------------------------------------------------- движение */

  _move(f, intent, dt) {
    if (f.state === STATE.STUNNED || f.state === STATE.HOLE) {
      f.stateT -= dt;
      f.vx = 0; f.vz = 0;
      if (f.stateT <= 0) {
        if (f.state === STATE.HOLE) this._climbOut(f);
        f.state = STATE.IDLE;
      }
      return;
    }

    if (f.state === STATE.DASH) {
      const speed = T.dash.dist / T.dash.time;
      const p = { x: f.x, z: f.z };
      sweepCollision(p, f.dashDir.x * speed * dt, f.dashDir.z * speed * dt);
      f.x = p.x; f.z = p.z;
      f.y = Math.sin((1 - f.stateT / T.dash.time) * Math.PI) * 0.35;   // низкий подскок
      f.stateT -= dt;
      if (f.stateT <= 0) { f.state = STATE.IDLE; f.y = 0; }
      return;
    }

    if (f.state === STATE.PULLED || f.state === STATE.SELFPULL || f.state === STATE.FINISHER) {
      return; // движением управляет крюк/добивание
    }

    // Ход по льду: разгон + трение => инерция, мгновенной остановки нет.
    // Под тягой трение ослаблено (иначе предел скорости = accel/friction, а не
    // T.move.speed), при отпущенном управлении работает полное — это и есть скольжение.
    const mx = intent.move.x, mz = intent.move.z;
    const len = Math.hypot(mx, mz);
    const driving = len > 0.01;
    if (driving) {
      const nx = mx / Math.max(1, len), nz = mz / Math.max(1, len);
      f.vx += nx * T.move.accel * dt;
      f.vz += nz * T.move.accel * dt;
      f.yaw = Math.atan2(-nx, -nz);
    }
    const damp = Math.max(0, 1 - T.move.friction * (driving ? T.move.driveFriction : 1) * dt);
    f.vx *= damp; f.vz *= damp;
    const sp = Math.hypot(f.vx, f.vz);
    if (sp > T.move.speed) { f.vx = (f.vx / sp) * T.move.speed; f.vz = (f.vz / sp) * T.move.speed; }

    const p = { x: f.x + f.vx * dt, z: f.z + f.vz * dt };
    if (resolveCollision(p)) { f.vx *= 0.2; f.vz *= 0.2; }
    f.x = p.x; f.z = p.z; f.y = 0;
  }

  /* ------------------------------------------------------------------ крюк */

  _hook(f, dt) {
    const h = f.hook;
    if (!h) return;

    if (h.phase === 'fly') {
      const stepDist = T.hook.speed * dt;
      const enemy = this.enemyOf(f);

      // сначала геометрия: крюк не должен пролетать сквозь торос за один тик
      const blocked = traceHook(h.x, h.z, h.dirX, h.dirZ, Math.min(stepDist, T.hook.range - h.traveled));

      // затем цель: попадание проверяем по всему отрезку тика
      let hitEnemy = false;
      if (enemy.state !== STATE.DEAD && enemy.iframe <= 0) {
        const sub = Math.ceil(stepDist / 0.25);
        for (let i = 1; i <= sub && !hitEnemy; i++) {
          const d = (stepDist * i) / sub;
          const x = h.x + h.dirX * d, z = h.z + h.dirZ * d;
          if (Math.hypot(x - enemy.x, z - enemy.z) < T.hook.hitRadius) {
            if (blocked && blocked.dist < d) break;      // торос ближе — цель за укрытием
            h.x = x; h.z = z; hitEnemy = true;
          }
        }
      }

      if (hitEnemy) {
        h.phase = 'pullTarget';
        h.t = 0;
        h.target = enemy;
        enemy.state = STATE.PULLED;
        enemy.vx = 0; enemy.vz = 0;
        const dist = Math.max(0.01, Math.hypot(enemy.x - f.x, enemy.z - f.z));
        f.pullSpeed = Math.max(6, (dist - T.hook.keepDist) / T.hook.pullTime);
        this.emit('hook-hit-body', { id: f.id, x: h.x, z: h.z });
        return;
      }

      if (blocked) {
        h.x = blocked.x; h.z = blocked.z;
        h.phase = 'pullSelf';
        h.t = 0;
        h.anchorX = blocked.x; h.anchorZ = blocked.z;
        f.state = STATE.SELFPULL;
        f.vx = 0; f.vz = 0;
        const dist = Math.max(0.01, Math.hypot(h.x - f.x, h.z - f.z));
        f.pullSpeed = Math.max(6, (dist - 1.1) / T.hook.pullTime);
        this.emit('hook-hit-wall', { id: f.id, x: h.x, z: h.z, kind: blocked.kind });
        return;
      }

      h.x += h.dirX * stepDist;
      h.z += h.dirZ * stepDist;
      h.traveled += stepDist;
      if (h.traveled >= T.hook.range) { h.phase = 'retract'; h.t = 0.16; this.emit('hook-miss', { id: f.id }); }
      return;
    }

    if (h.phase === 'pullTarget') {
      const tg = h.target;
      h.t += dt;
      if (tg.state === STATE.DEAD) { this._releaseHook(f); return; }

      // цель едет к текущей позиции хозяина крюка: тянущий может отходить,
      // скорость постоянная — никаких телепортов, ощущение натянутого троса
      const dx = f.x - tg.x, dz = f.z - tg.z;
      const dist = Math.hypot(dx, dz);
      const stop = dist - T.hook.keepDist;
      if (stop <= 0.05 || h.t > T.hook.pullTime * 2.2) {
        tg.state = STATE.STUNNED; tg.stateT = T.hook.stunAfterPull;
        this._releaseHook(f);
        return;
      }
      const move = Math.min(stop, f.pullSpeed * dt);
      const p = { x: tg.x, z: tg.z };
      sweepCollision(p, (dx / dist) * move, (dz / dist) * move);
      tg.x = p.x; tg.z = p.z; tg.y = 0;
      tg.yaw = Math.atan2(-(f.x - tg.x), -(f.z - tg.z));
      h.x = tg.x; h.z = tg.z;
      // затянуть противника в полынью — легальный и очень выгодный приём
      if (holeAt(tg.x, tg.z)) { this._releaseHook(f); }
      return;
    }

    if (h.phase === 'pullSelf') {
      h.t += dt;
      const dx = h.anchorX - f.x, dz = h.anchorZ - f.z;
      const dist = Math.hypot(dx, dz);
      const stop = dist - 1.1;
      if (stop <= 0.05 || h.t > T.hook.pullTime * 2.2) {
        f.state = STATE.IDLE; f.y = 0;
        f.vx = (dx / Math.max(dist, 0.01)) * 2.5; f.vz = (dz / Math.max(dist, 0.01)) * 2.5;
        this._releaseHook(f);
        return;
      }
      const move = Math.min(stop, f.pullSpeed * dt);
      f.x += (dx / dist) * move;
      f.z += (dz / dist) * move;
      // летим по воздуху: полыньи под нами не срабатывают — самоподтяг это escape
      f.y = Math.sin(Math.min(1, h.t / T.hook.pullTime) * Math.PI) * 0.8;
      f.yaw = Math.atan2(-dx, -dz);
      return;
    }

    if (h.phase === 'retract') {
      h.t -= dt;
      if (h.t <= 0) f.hook = null;
    }
  }

  _releaseHook(f) {
    if (!f.hook) return;
    f.hook.phase = 'retract';
    f.hook.t = 0.16;
    f.hook.target = null;
    if (f.state === STATE.SELFPULL) { f.state = STATE.IDLE; f.y = 0; }
  }

  /* --------------------------------------------------------------- ловушки */

  _traps(dt) {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i];
      tr.arm = Math.max(0, tr.arm - dt);
      tr.life -= dt;
      if (tr.life <= 0) { this.traps.splice(i, 1); this.emit('trap-gone', { x: tr.x, z: tr.z }); continue; }
      if (tr.arm > 0) continue;
      for (const f of this.fighters) {
        if (f.id === tr.owner || f.state === STATE.DEAD) continue;
        if (f.state === STATE.DASH || f.iframe > 0) continue;       // рывком ловушка перескакивается
        // Боец в полынье уже обездвижен, а её стан затёр бы состояние HOLE —
        // и вылезание не сработало бы никогда: боец оставался стоять в воде.
        if (f.state === STATE.HOLE) continue;
        if (Math.hypot(f.x - tr.x, f.z - tr.z) > T.trap.radius) continue;
        f.state = STATE.STUNNED; f.stateT = T.trap.stun;
        f.vx = 0; f.vz = 0;
        this.traps.splice(i, 1);
        this.emit('trap-hit', { id: f.id, x: tr.x, z: tr.z });
        break;
      }
    }
  }

  /* ---------------------------------------------- контакт: удар и добивание */

  _contact(f) {
    if (f.state !== STATE.IDLE || this.finisher || this.over) return;
    const e = this.enemyOf(f);
    if (e.state === STATE.DEAD) return;
    const dist = Math.hypot(e.x - f.x, e.z - f.z);

    if (dist <= T.finisher.range && e.hp <= e.maxHp * T.finisher.hpFrac && e.iframe <= 0) {
      this._startFinisher(f, e);
      return;
    }
    if (dist <= T.melee.range && f.meleeCd <= 0) {
      f.meleeCd = T.melee.cooldown;
      f.swing = T.melee.cooldown * 0.6;
      f.yaw = Math.atan2(-(e.x - f.x), -(e.z - f.z));
      if (e.iframe > 0) { this.emit('melee-miss', { id: f.id }); return; }
      e.hp = Math.max(0, e.hp - T.melee.damage);
      this.emit('melee-hit', { id: f.id, target: e.id, x: e.x, z: e.z, hp: e.hp });
      if (e.hp <= 0) this._kill(e, f, 'melee');
    }
  }

  _startFinisher(attacker, target) {
    attacker.state = STATE.FINISHER;
    attacker.vx = 0; attacker.vz = 0;
    attacker.yaw = Math.atan2(-(target.x - attacker.x), -(target.z - attacker.z));
    const bonus = attacker.isBot ? T.finisher.botTelegraphBonus : 0;
    this.finisher = { attacker, target, t: T.finisher.telegraph + bonus, escaped: false, done: false };
    this.emit('finisher-start', { id: attacker.id, target: target.id, x: target.x, z: target.z });
  }

  _finisher(dt) {
    const fin = this.finisher;
    if (!fin || fin.done) return;
    fin.t -= dt;

    const dist = Math.hypot(fin.target.x - fin.attacker.x, fin.target.z - fin.attacker.z);
    const gone = fin.escaped || dist > T.finisher.range * 1.6 || fin.target.state === STATE.DEAD;

    if (fin.t > 0) {
      if (gone) {
        fin.done = true;
        fin.attacker.state = STATE.IDLE;
        fin.attacker.meleeCd = T.melee.cooldown;
        this.finisher = null;
        this.emit('finisher-escape', { id: fin.target.id });
      }
      return;
    }

    // замок: помечаем done и снимаем ссылку до нанесения килла,
    // поэтому добивание физически не может сработать дважды
    fin.done = true;
    this.finisher = null;
    fin.attacker.state = STATE.IDLE;
    fin.attacker.meleeCd = T.melee.cooldown;
    if (gone) { this.emit('finisher-escape', { id: fin.target.id }); return; }
    fin.target.hp = 0;
    this.emit('finisher-hit', { id: fin.attacker.id, target: fin.target.id, x: fin.target.x, z: fin.target.z });
    this._kill(fin.target, fin.attacker, 'finisher');
  }

  /* --------------------------------------------------------------- полыньи */

  _holes(f, dt) {
    if (f.holeGrace > 0) f.holeGrace = Math.max(0, f.holeGrace - dt);
    if (f.state === STATE.DEAD || f.state === STATE.HOLE) return;
    if (f.holeGrace > 0) return;
    if (f.y > 0.2) return;                       // в воздухе (рывок/самоподтяг) — не проваливаемся
    if (f.state === STATE.SELFPULL) return;
    const h = holeAt(f.x, f.z);
    if (!h) { f.holeDone = false; return; }
    if (f.holeDone) {
      // Страховка: боец числится провалившимся, но состояние HOLE у него уже
      // сняли (стан ловушки, подтяг и прочее), и вылезание не запустится —
      // он останется стоять в воде навсегда. Возвращаем в воду без урона:
      // наказание он уже получил при падении.
      f.state = STATE.HOLE;
      f.stateT = Math.min(f.stateT > 0 ? f.stateT : T.hole.stun, T.hole.stun);
      f.vx = 0; f.vz = 0;
      f.y = -0.5;
      return;
    }

    f.holeDone = true;
    f.hp = Math.max(0, f.hp - T.hole.damage);
    f.state = STATE.HOLE;
    f.stateT = T.hole.stun;
    // запоминаем, куда боец шёл: вылезать он будет на ту сторону, а не назад
    const sp = Math.hypot(f.vx, f.vz);
    f.holeDir = sp > 0.2 ? { x: f.vx / sp, z: f.vz / sp } : { x: 0, z: 0 };
    f.vx = 0; f.vz = 0;
    f.y = -0.5;
    this._releaseHook(f);
    this.emit('hole', { id: f.id, x: f.x, z: f.z, hp: f.hp });
    if (f.hp <= 0) this._kill(f, this.enemyOf(f), 'hole');
  }

  /**
   * Выбирание из полыньи: боец оказывается на краю, а не в центре провала.
   * Направление наружу — от центра полыньи, но если боец стоит ровно в центре
   * (или выход упирается в торос/другую полынью), перебираем варианты: иначе
   * получается софт-лок «упал → вылез в ту же полынью → упал».
   */
  _climbOut(f) {
    const h = holeAt(f.x, f.z, -0.8) ?? ARENA.holes.reduce((best, cur) => {
      const d = Math.hypot(f.x - cur.x, f.z - cur.z);
      return !best || d < best.d ? { ...cur, d } : best;
    }, null);

    if (h) {
      const out = h.r + T.move.radius + T.hole.clearance;
      const dx = f.x - h.x, dz = f.z - h.z;
      const len = Math.hypot(dx, dz);
      // Первый кандидат — ДАЛЬНЯЯ сторона по ходу движения: боец «проходит»
      // полынью насквозь. Если выбрасывать назад, к точке входа, то зажатое
      // направление немедленно роняет обратно — получалась петля из шести
      // падений подряд и смерть, а не одна ошибка.
      const moved = Math.hypot(f.holeDir.x, f.holeDir.z) > 0.01;
      const base = moved ? Math.atan2(f.holeDir.z, f.holeDir.x)
        : (len > 0.05 ? Math.atan2(dz, dx) : Math.atan2(-h.z, -h.x));
      const offsets = [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, -Math.PI / 4];
      let placed = false;
      for (const off of offsets) {
        const a = base + off;
        const p = { x: h.x + Math.cos(a) * out, z: h.z + Math.sin(a) * out };
        resolveCollision(p);
        if (!holeAt(p.x, p.z) && !torosAt(p.x, p.z, T.move.radius)) {
          f.x = p.x; f.z = p.z; placed = true;
          break;
        }
      }
      if (!placed) {                            // страховка: свой спавн всегда свободен
        f.x = ARENA.spawns[f.id].x;
        f.z = ARENA.spawns[f.id].z;
      }
    }

    f.y = 0;
    f.vx = 0; f.vz = 0;
    f.holeDone = false;
    f.holeGrace = T.hole.grace;   // мгновенно провалиться снова нельзя
    f.holeDir = { x: 0, z: 0 };
    this.emit('climb', { id: f.id });
  }

  /* ------------------------------------------------------------------ смерть */

  _kill(victim, killer, reason) {
    if (victim.state === STATE.DEAD) return;
    victim.state = STATE.DEAD;
    victim.hp = 0;
    victim.vx = 0; victim.vz = 0;
    this._releaseHook(victim);
    this.traps = this.traps.filter((t) => t.owner !== victim.id);
    if (this.finisher && (this.finisher.attacker === victim || this.finisher.target === victim)) {
      this.finisher.done = true;
      this.finisher = null;
    }
    this.emit('death', { id: victim.id, x: victim.x, z: victim.z, reason });
    if (!this.over) {
      this.over = { winner: killer && killer !== victim ? killer.id : -1, reason };
      this.emit('round-over', this.over);
    }
  }
}
