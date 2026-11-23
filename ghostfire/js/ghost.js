// Призрак: двигается ТОЧНО по записи (интерполяция снапшотов),
// но стреляет "живьём" — в текущую позицию игрока, с профилем меткости оригинала
// и задержкой реакции 150–300 мс. Поэтому дуэль ощущается как PvP.
import * as THREE from 'three';
import { raycastVoxels } from './map.js';
import { WEAPONS, buildWeaponModel, disposeWeaponModel } from './weapons.js';
import { boxMaterials, artFaceIndices } from './face.js';
import { getSkinSurface, scaleBoxUV } from './textures.js';
import { Sound } from './audio.js';

import { FIGURE_PARTS, HEAD, partArt } from './figure.js';

export class Ghost {
  /**
   * @param {*} opts { replay, map, skin, scene,
   *                   onShoot(weaponId, origin, dir), pickups }
   */
  constructor(opts) {
    this.replay = opts.replay;
    this.map = opts.map;
    this.skin = opts.skin;
    this.scene = opts.scene;
    this.onShoot = opts.onShoot;
    this.pickups = opts.pickups;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.hp = 100;
    this.alive = true;
    this.time = 0;
    this._sample = {};
    this._shotIdx = 0;
    this._pickupIdx = 0;
    this._pending = [];   // отложенные (реакция) выстрелы
    this._nextShotScheduleAt = 0;
    this._lastTick = -1;
    this._weapon = 0;

    const prof = this.replay.accuracyProfile();
    // меткость оригинала ± случайность, в разумных рамках
    this.accuracy = THREE.MathUtils.clamp(prof.accuracy, 0.15, 0.92);
    this.headRate = THREE.MathUtils.clamp(prof.headRate, 0.05, 0.5);

    /*
      Поправка на стаю.

      Пятеро стреляют впятеро чаще: без поправки стая снимала игрока за
      секунду, и пятизвёздный бой заканчивался, не начавшись. Гасим не урон
      и не число врагов — гасим плотность огня каждого: реже попадают, дольше
      реагируют. Ходят и целятся они по-прежнему как живые, просто не
      расстреливают в упор вшестером одновременно.

      Корень, а не деление: вдвоём огонь всё-таки должен быть плотнее, чем
      один на один, иначе рост числа врагов ничего не меняет.
    */
    this.packSize = Math.max(1, Math.round(opts.packSize ?? 1));
    if (this.packSize > 1) {
      const мягче = 1 / Math.sqrt(this.packSize);
      this.accuracy *= мягче;
      this.headRate *= мягче;
    }
    this.reactionBase = 0.15 + 0.06 * (this.packSize - 1);

    // Точка входа в запись: стая расходится сдвигом по фазе, см. reset().
    this.startTime = Number.isFinite(opts.startTime) ? opts.startTime : 0;

    this._buildModel();
    this.hitboxHead = new THREE.Box3();
    this.hitboxBody = new THREE.Box3();
  }

  _buildModel() {
    const b = this.skin.body;
    const tint = new THREE.Color(this.skin.ghostTint ?? '#88ddff');
    const mat = (hex) => {
      const c = new THREE.Color(hex).lerp(tint, 0.45);
      // map красит поверхность фактурой, color остаётся цветом скина:
      // Lambert перемножает их сам, поэтому скины менять не пришлось.
      return new THREE.MeshLambertMaterial({
        map: getSkinSurface(this.skin.id),
        color: c, transparent: true, opacity: this.skin.ghostOpacity ?? 0.85,
        emissive: tint.clone().multiplyScalar(0.15),
      });
    };
    const part = (w, h, d, hex, art = null) => {
      // art — пиксель-арт на передней грани (маска на голове, одежда на торсе)
      const geo = scaleBoxUV(new THREE.BoxGeometry(w, h, d), Math.max(w, h, d), artFaceIndices(art));
      const m = new THREE.Mesh(geo, art ? boxMaterials(mat, hex, art) : mat(hex));
      m.castShadow = true;
      return m;
    };
    this.group = new THREE.Group();
    this._materials = [];
    this._развоплощение = 0;
    // Список деталей — из figure.js: там же его берут витрина и карточки
    // магазина, поэтому разъехаться они не могут.
    for (const d of FIGURE_PARTS) {
      const mesh = part(d.size[0], d.size[1], d.size[2], b[d.color], partArt(d, this.skin.art));
      mesh.position.set(d.pos[0], d.pos[1], d.pos[2]);
      const мат = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of мат) if (m && m.transparent) this._materials.push(m);
      this[d.name] = mesh;
      this.group.add(mesh);
    }
    // пушка в правой руке
    this.weaponModels = WEAPONS.map(w => {
      const m = buildWeaponModel(w.id, this.skin);
      m.position.set(0.38, 0.95, -0.35);
      m.visible = false;
      this.group.add(m);
      return m;
    });
    this.weaponModels[0].visible = true;
    this.scene.add(this.group);
    this._animT = 0;
  }

  dispose() {
    this.scene.remove(this.group);
    this._pending.length = 0;
    this._nextShotScheduleAt = 0;
    for (const model of this.weaponModels) {
      this.group.remove(model);
      disposeWeaponModel(model);
    }
    disposeObject(this.group);
  }

  reset() {
    /*
      Стая входит в запись с разных мест.

      Пятеро призраков — это пять записей, и каждая начинается со спавна.
      Без сдвига стая выходила одной кучей, шла в затылок друг другу и
      ложилась от одной очереди. Сдвиг именно по ВРЕМЕНИ, а не по координате:
      любая точка записи заведомо проходима, а сдвинутый вбок призрак встал бы
      в стену — ровно та беда, с которой мы уже разбирались.
    */
    this.time = this.startTime;
    this.hp = 100;
    this.alive = true;
    this._shotIdx = 0;
    this._pickupIdx = 0;
    // Всё, что записано до точки входа, уже случилось. Иначе призрак на
    // первом же кадре отстрелялся бы за всю пропущенную половину записи.
    const входТик = Math.floor(this.time * this.replay.tickRate);
    while (this._shotIdx < this.replay.shots.length &&
           this.replay.shots[this._shotIdx].tick <= входТик) this._shotIdx++;
    while (this._pickupIdx < this.replay.pickups.length &&
           this.replay.pickups[this._pickupIdx].tick <= входТик) this._pickupIdx++;
    this._pending.length = 0;
    this._nextShotScheduleAt = 0;
    this._lastTick = -1;
    this._px = undefined;
    this._pz = undefined;
    this._animT = 0;
    this._setWeapon(0);
    this.group.visible = true;
    this.update(0, null);
  }

  _setWeapon(id) {
    if (!WEAPONS[id]) return false;
    this._weapon = id;
    this.weaponModels.forEach((m, i) => (m.visible = i === id));
    return true;
  }

  takeDamage(dmg) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp <= 0) { this.alive = false; this.group.visible = false; }
  }

  getEyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + 1.4, this.pos.z);
  }

  /** targets-запись для fireHitscan игрока. */
  get target() {
    return {
      head: this.hitboxHead,
      body: this.hitboxBody,
      onHit: (part, dmg) => this.takeDamage(dmg),
    };
  }

  /** @param {Player|null} player живой игрок — цель для живого прицеливания */
  update(dt, player) {
    if (!this.alive) return;
    this.time += dt;
    const s = this.replay.sample(this.time, this._sample);
    if (!s) return;

    // запись зациклена: на перемотке в начало сбрасываем индексы событий,
    // иначе после первого круга призрак перестаёт стрелять и подбирать
    if (s.tick < this._lastTick) {
      this._shotIdx = 0;
      this._pickupIdx = 0;
      /*
        Стык петли — момент развоплощения.

        Запись конечна и на стыке возвращает призрака к началу пути: иногда
        это шаг, иногда бросок через полкарты. Никакая правка маршрута не
        уберёт скачок на всех картах и сложностях сразу. Но призраку и не
        положено ходить пешком: он тает и появляется заново. Дефект
        превращается в приём.
      */
      this._развоплощение = 0.55;
    }
    this._lastTick = s.tick;

    /*
      Прозрачность живая: призрак дышит.

      Ровные 0.85 читались как обычный полупрозрачный куб. Медленное колебание
      и вспышка на стыке дают ощущение, что тела нет, а есть след.
    */
    const базовая = this.skin.ghostOpacity ?? 0.85;
    let прозрачность = базовая * (0.86 + 0.14 * Math.sin(this.time * 2.7));
    if (this._развоплощение > 0) {
      this._развоплощение -= dt;
      const k = Math.max(0, this._развоплощение) / 0.55;
      // Ноль в середине: сначала тает, потом собирается обратно.
      прозрачность *= Math.abs(k * 2 - 1);
    }
    /*
      Вплотную призрак почти исчезает.

      Тела у него нет, и с игроком он не сталкивается — маршрут записи спокойно
      проходит сквозь того, кто стоит на пути. В дуэли это случалось редко, а
      впятером кто-нибудь непременно пройдёт через камеру, и экран на секунду
      заливает сплошной синей плитой: не видно ни арены, ни остальных.

      Гасим по расстоянию: ближе полутора метров призрак тает до тени. Хитбоксы
      не трогаем — попасть в него по-прежнему можно, просто он не слепит.
    */
    if (player) {
      const близь = Math.hypot(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      if (близь < 1.5) прозрачность *= THREE.MathUtils.clamp((близь - 0.4) / 1.1, 0.1, 1);
    }
    for (const m of this._materials) m.opacity = прозрачность;

    const prevY = this.pos.y;
    this.pos.set(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.group.position.copy(this.pos);
    this.group.rotation.y = s.yaw;

    // смена оружия по записи
    if (s.weapon !== this._weapon) this._setWeapon(s.weapon);

    // подборы: гасим пикап на карте в записанный момент
    while (this._pickupIdx < this.replay.pickups.length &&
           this.replay.pickups[this._pickupIdx].tick <= s.tick) {
      const pk = this.replay.pickups[this._pickupIdx++];
      let best = null, bestD = 9;
      for (const p of this.pickups) {
        if (!p.available || p.type !== pk.weapon) continue;
        const d = p.pos.distanceToSquared(this.pos);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) { best.timer = best.respawnTime; best.mesh.visible = false; }
    }

    // анимация ходьбы
    const speed = Math.hypot(s.x - (this._px ?? s.x), s.z - (this._pz ?? s.z)) / Math.max(dt, 1e-4);
    this._px = s.x; this._pz = s.z;
    this._animT += dt * Math.min(speed, 10);
    const sw = Math.sin(this._animT * 1.6) * 0.5;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.7;
    this.head.rotation.x = s.pitch * 0.5;

    // хитбоксы (axis-aligned, голова — большой куб)
    this.hitboxHead.setFromCenterAndSize(
      new THREE.Vector3(this.pos.x, this.pos.y + 1.43, this.pos.z),
      new THREE.Vector3(HEAD, HEAD, HEAD));
    this.hitboxBody.setFromCenterAndSize(
      new THREE.Vector3(this.pos.x, this.pos.y + 0.58, this.pos.z),
      new THREE.Vector3(0.7, 1.15, 0.45));

    // --- живое прицеливание ---
    // на записанном тике выстрела ставим отложенный выстрел с реакцией 150–300 мс
    // reset() вызывает update(0, null), чтобы выставить позу/пикапы до старта.
    // Боевые события начинаем только после GO — иначе rail charge звучал бы
    // во время трёхсекундного countdown.
    if (player) {
      while (this._shotIdx < this.replay.shots.length &&
             this.replay.shots[this._shotIdx].tick <= s.tick) {
        const shot = this.replay.shots[this._shotIdx++];
        const weapon = WEAPONS[shot.weapon];
        // Короткая запись (например, one-shot sniper) зацикливается чаще,
        // чем оружие физически способно стрелять. Не копим очередь одинаковых
        // выстрелов на каждом обороте replay — соблюдаем charge + cooldown.
        if (!weapon || this.time < this._nextShotScheduleAt) continue;
        const reaction = this.reactionBase + Math.random() * 0.15;
        const chargeAt = this.time + reaction;
        const fireAt = chargeAt + weapon.charge;
        this._pending.push({ at: chargeAt, weapon: shot.weapon, charging: weapon.charge > 0 });
        this._nextShotScheduleAt = fireAt + weapon.cooldown;
      }
      // сработка отложенных выстрелов — в ТЕКУЩУЮ позицию игрока
      for (let i = this._pending.length - 1; i >= 0; i--) {
        const pd = this._pending[i];
        if (this.time < pd.at) continue;
        if (pd.charging) {
          const charge = WEAPONS[pd.weapon].charge;
          Sound.railCharge(charge);
          pd.charging = false;
          pd.at = this.time + charge;
          this._nextShotScheduleAt = Math.max(
            this._nextShotScheduleAt,
            pd.at + WEAPONS[pd.weapon].cooldown,
          );
          continue;
        }
        this._pending.splice(i, 1);
        if (player.alive) {
          this._fireAt(pd.weapon, player);
          this._nextShotScheduleAt = Math.max(
            this._nextShotScheduleAt,
            this.time + WEAPONS[pd.weapon].cooldown,
          );
        }
      }
    }
    void prevY;
  }

  _fireAt(weaponId, player) {
    const origin = this.getEyePos();
    const isHead = Math.random() < this.headRate;
    const target = new THREE.Vector3(
      player.pos.x, player.pos.y + (isHead ? 1.6 : 1.0), player.pos.z);
    const dir = target.clone().sub(origin);
    const dist = dir.length();
    if (dist < 0.01) return;
    dir.normalize();

    const willHit = Math.random() < this.accuracy;
    if (willHit) {
      // лёгкое дрожание, чтобы дробовик не клал все дробины в точку
      dir.x += (Math.random() - 0.5) * 0.01;
      dir.y += (Math.random() - 0.5) * 0.01;
      dir.normalize();
    } else {
      // промах: увод луча на 3–10°
      const err = (3 + Math.random() * 7) * Math.PI / 180;
      const perp = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .cross(dir).normalize();
      dir.addScaledVector(perp, Math.tan(err)).normalize();
    }
    // LOS: если стена ближе цели, выстрел уйдёт в стену (трассер честный) —
    // это решает fireHitscan в game.js через raycastVoxels
    const weapon = WEAPONS[weaponId];
    Sound[weapon?.sound]?.();
    this.onShoot(weaponId, origin, dir);
  }

  /** Есть ли прямая видимость до точки (для мобильного автоогня по призраку). */
  hasLosTo(point) {
    const origin = this.getEyePos();
    const d = point.clone().sub(origin);
    const dist = d.length();
    return raycastVoxels(this.map, origin, d.normalize(), dist) >= dist - 0.05;
  }
}

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse((o) => {
    if (o.geometry) geometries.add(o.geometry);
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
      materials.add(mat);
      if (mat.map) textures.add(mat.map);
    }
  });
  textures.forEach(t => t.dispose());
  materials.forEach(m => m.dispose());
  geometries.forEach(g => g.dispose());
  root.clear();
}
