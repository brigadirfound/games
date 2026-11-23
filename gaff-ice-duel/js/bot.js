// Соперники-боты: пять уровней с честными ручками — реакция, вынос прицела
// перед бегущей целью, шанс уклонения от летящего крюка, разброс, дистанция.
// Бот не «читает» состояние игрока напрямую: он видит те же данные, что и игрок,
// и обязан выдерживать задержку реакции.
import { T } from './tuning.js';
import { STATE, emptyIntent } from './sim.js';
import { traceHook, holeAt, insideArena } from './arena.js';

export const BOT_LEVELS = [
  {
    id: 1, coinMult: 1,
    holeSense: 0.5,
    name: { ru: 'Юнга', en: 'Deckhand' },
    react: 0.55, lead: 0.2, aimErr: 0.16, dodge: 0.1,
    prefDist: 5.5, hookRange: 9, trapUse: 0.1, dashUse: 0.15, chase: 0.5,
  },
  {
    id: 2, coinMult: 1.5,
    holeSense: 0.68,
    name: { ru: 'Ледолом', en: 'Icebreaker' },
    react: 0.42, lead: 0.45, aimErr: 0.12, dodge: 0.25,
    prefDist: 6, hookRange: 11, trapUse: 0.3, dashUse: 0.3, chase: 0.62,
  },
  {
    id: 3, coinMult: 2,
    holeSense: 0.85,
    name: { ru: 'Промысловик', en: 'Trapper' },
    react: 0.3, lead: 0.7, aimErr: 0.085, dodge: 0.42,
    prefDist: 6.5, hookRange: 12.5, trapUse: 0.55, dashUse: 0.45, chase: 0.72,
  },
  {
    id: 4, coinMult: 2.5,
    holeSense: 0.95,
    name: { ru: 'Зимовщик', en: 'Wintersmith' },
    react: 0.22, lead: 0.85, aimErr: 0.055, dodge: 0.58,
    prefDist: 7, hookRange: 13.5, trapUse: 0.7, dashUse: 0.6, chase: 0.82,
  },
  {
    id: 5, coinMult: 3,
    holeSense: 1.0,
    name: { ru: 'Хозяин полыньи', en: 'Deepwarden' },
    react: 0.15, lead: 1, aimErr: 0.03, dodge: 0.75,
    prefDist: 7.5, hookRange: T.hook.range, trapUse: 0.85, dashUse: 0.75, chase: 0.9,
  },
];

export function botLevel(index) {
  return BOT_LEVELS[Math.max(0, Math.min(BOT_LEVELS.length - 1, index))];
}

export class Bot {
  constructor(level, id) {
    this.L = level;
    this.id = id;
    this.intentObj = emptyIntent();
    this.think = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 1.2;
    this.reactedTo = null;      // крюк, на который уже отреагировали (одна реакция на бросок)
    this.aimNoise = 0;
  }

  /** Возвращает намерение на тик. sim — та же симуляция, что у игрока. */
  intent(sim, dt) {
    const me = sim.fighters[this.id];
    const foe = sim.enemyOf(me);
    const it = this.intentObj;
    it.cast.length = 0;
    it.move.x = 0; it.move.z = 0;
    it.aim.x = foe.x; it.aim.z = foe.z;

    if (me.state === STATE.DEAD || foe.state === STATE.DEAD || sim.over) return it;

    this.think -= dt;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 0.9 + Math.random() * 1.4; }

    const dx = foe.x - me.x, dz = foe.z - me.z;
    const dist = Math.hypot(dx, dz) || 0.01;
    const ux = dx / dist, uz = dz / dist;

    this._dodge(sim, me, foe);
    this._aimAndCast(sim, me, foe, dist, ux, uz, it);
    this._steer(sim, me, foe, dist, ux, uz, it);
    return it;
  }

  /** Уклонение от летящего крюка: одна попытка на бросок, шанс по сложности. */
  _dodge(sim, me, foe) {
    const h = foe.hook;
    if (!h || h.phase !== 'fly') { if (!h) this.reactedTo = null; return; }
    if (this.reactedTo === h) return;
    const toMeX = me.x - h.x, toMeZ = me.z - h.z;
    const len = Math.hypot(toMeX, toMeZ) || 0.01;
    const dot = (toMeX / len) * h.dirX + (toMeZ / len) * h.dirZ;
    if (dot < 0.9 || len > 9) return;               // летит не в нас или ещё далеко
    this.reactedTo = h;
    if (Math.random() > this.L.dodge || me.cd.dash > 0 || me.state !== STATE.IDLE) return;
    // рывок в сторону от линии полёта
    const side = this.strafe;
    this.intentObj.aim.x = me.x + -h.dirZ * side * T.dash.dist;
    this.intentObj.aim.z = me.z + h.dirX * side * T.dash.dist;
    this.intentObj.cast.push('dash');
  }

  _aimAndCast(sim, me, foe, dist, ux, uz, it) {
    // прицел с выносом перед бегущей целью: чем выше уровень, тем точнее лид
    const flight = dist / T.hook.speed;
    const leadX = foe.x + foe.vx * flight * this.L.lead;
    const leadZ = foe.z + foe.vz * flight * this.L.lead;
    const ang = Math.atan2(leadZ - me.z, leadX - me.x) + (Math.random() - 0.5) * this.L.aimErr;
    const aimDist = Math.min(T.hook.range, Math.max(dist, 3));
    it.aim.x = me.x + Math.cos(ang) * aimDist;
    it.aim.z = me.z + Math.sin(ang) * aimDist;

    if (this.think > 0) return;

    const blocked = traceHook(me.x, me.z, ux, uz, Math.min(dist, T.hook.range));
    const clear = !blocked || blocked.dist > dist - 0.6;

    if (!me.hook && me.cd.hook <= 0 && dist < this.L.hookRange && clear && me.state === STATE.IDLE) {
      it.cast.push('hook');
      this.think = this.L.react;
      return;
    }

    // ловушка ставится под ноги противнику, а не в пустоту
    if (me.cd.trap <= 0 && Math.random() < this.L.trapUse && dist < T.trap.castRange + 1 && me.state === STATE.IDLE) {
      const tx = foe.x + foe.vx * 0.4, tz = foe.z + foe.vz * 0.4;
      if (insideArena(tx, tz, 1.2) && !holeAt(tx, tz, -0.5)) {
        it.aim.x = tx; it.aim.z = tz;
        it.cast.push('trap');
        this.think = this.L.react;
        return;
      }
    }

    // рывок на сближение для добивания или разрыв дистанции при своём низком HP
    if (me.cd.dash <= 0 && me.state === STATE.IDLE && Math.random() < this.L.dashUse) {
      const foeLow = foe.hp <= foe.maxHp * T.finisher.hpFrac;
      if (foeLow && dist > T.finisher.range && dist < T.dash.dist + 2) {
        it.aim.x = foe.x; it.aim.z = foe.z;
        it.cast.push('dash');
        this.think = this.L.react * 0.6;
      } else if (me.hp < me.maxHp * 0.3 && dist < 3.5) {
        it.aim.x = me.x - ux * T.dash.dist; it.aim.z = me.z - uz * T.dash.dist;
        it.cast.push('dash');
        this.think = this.L.react * 0.6;
      }
    }
  }

  /**
   * Обход полыньи и кромки. На льду важно смотреть не только туда, куда бот
   * хочет идти, но и туда, куда его несёт: тормозной путь больше метра, поэтому
   * проверка «одна точка в 1.6 м впереди» проваливалась и боты топились сами.
   * Дальность взгляда — ручка сложности: слабые боты замечают полынью поздно.
   */
  _avoid(me, mx, mz) {
    const speed = Math.hypot(me.vx, me.vz);
    const look = (1.1 + speed * 0.55) * (0.55 + this.L.holeSense * 0.75);
    const dirs = [];
    const dl = Math.hypot(mx, mz);
    if (dl > 0.01) dirs.push({ x: mx / dl, z: mz / dl });
    if (speed > 0.4) dirs.push({ x: me.vx / speed, z: me.vz / speed });

    for (const d of dirs) {
      for (const s of [0.45, 0.75, 1]) {
        const px = me.x + d.x * look * s, pz = me.z + d.z * look * s;
        const h = holeAt(px, pz, -0.7);
        if (h) return this._skirt(me.x - h.x, me.z - h.z, h.r + T.move.radius + 0.9, mx, mz);
        if (!insideArena(px, pz, 1.7)) {
          // кромка: обкатываем по дуге внутрь, а не разворачиваемся в центр
          const r = this._skirt(-me.x, -me.z, 0, mx, mz);
          return r;
        }
      }
    }
    return null;
  }

  /**
   * Обход препятствия по касательной. Ключевой момент: уходить НЕ строго назад
   * от полыньи (так бот отступает и теряет дистанцию до цели — проверено, он
   * зависал вне дальности крюка), а вбок, сохраняя выбранное направление.
   * ax,az — вектор от препятствия к боту; safe — нужный зазор.
   */
  _skirt(ax, az, safe, mx, mz) {
    const al = Math.hypot(ax, az) || 0.01;
    const rx = ax / al, rz = az / al;
    // две касательные; берём ту, что ближе к желаемому курсу
    const t1 = { x: -rz, z: rx }, t2 = { x: rz, z: -rx };
    const dot1 = t1.x * mx + t1.z * mz;
    const t = dot1 >= (t2.x * mx + t2.z * mz) ? t1 : t2;
    const push = safe > 0 ? Math.max(0, (safe - al) / Math.max(safe, 0.01)) : 0.35;
    return { x: t.x + rx * push, z: t.z + rz * push };
  }

  _steer(sim, me, foe, dist, ux, uz, it) {
    const foeHelpless = foe.state === STATE.PULLED || foe.state === STATE.STUNNED || foe.state === STATE.HOLE;
    const foeLow = foe.hp <= foe.maxHp * T.finisher.hpFrac;
    let want = this.L.prefDist;
    // Идти в упор можно, только если самого бота не добьют в ответ: у него
    // замах добивания длиннее на botTelegraphBonus, поэтому взаимную гонку
    // добиваний он всегда проигрывает — в неё нельзя входить сознательно.
    const meFinishable = me.hp <= me.maxHp * T.finisher.hpFrac;
    if (foeHelpless) want = 0.8;                                 // окно бесплатных ударов
    else if (foeLow && !meFinishable) want = 0.8;                 // идём добивать
    else if (me.hp <= foe.hp) want = this.L.prefDist + 2;         // проигрываем по HP — кайтим
    else if (me.cd.hook > T.hook.cooldown * 0.5) want += 2.5;     // без крюка держаться дальше

    const radial = (dist - want) * this.L.chase;
    let mx = ux * radial - uz * this.strafe * 0.8;
    let mz = uz * radial + ux * this.strafe * 0.8;

    const avoid = this._avoid(me, mx, mz);
    if (avoid) { mx = avoid.x; mz = avoid.z; this.strafeT = Math.min(this.strafeT, 0.3); }

    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    it.move.x = mx; it.move.z = mz;
  }
}
