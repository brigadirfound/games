// Слой отображения: читает состояние симуляции и рисует его.
// Симуляция о рендере не знает — поэтому её можно считать на хосте в онлайне,
// а этот файл просто покажет присланные позиции.
import * as THREE from 'three';
import { T } from './tuning.js';
import { STATE } from './sim.js';
import { buildFighter, buildHookHead, Chain, ShatterPool } from './voxel.js';

const HIT_FLASH = 0.22;   // с, длительность вспышки при попадании
import { traceHook } from './arena.js';
import { ImpactRings } from './impact-rings.js';

const TEAM = [0x51d0ff, 0xff7b4a];   // игрок / соперник

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class View {
  // hookSkins — облик багра, свой слот; если не передан, крюк красится как боец
  constructor(scene, skins, hookSkins = []) {
    this.scene = scene;
    this.skins = skins;
    this.t = 0;
    this.fighters = skins.map((skin, i) => {
      const group = buildFighter(skin, TEAM[i]);
      scene.add(group);
      const hookSkin = hookSkins[i] ?? skin;
      const head = buildHookHead(hookSkin);
      head.visible = false;
      scene.add(head);
      const chain = new Chain(hookSkin, T.hook.maxLinks);
      scene.add(chain.mesh);
      return { group, head, chain, skin };
    });

    this.shatter = new ShatterPool();
    scene.add(this.shatter.mesh);
    this.hitT = [0, 0];             // таймеры вспышки попадания по бойцам

    // маркер прицела и предпросмотр линии броска
    this.aimRing = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.58, 20),
      new THREE.MeshBasicMaterial({ color: TEAM[0], transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimRing.position.y = 0.06;
    scene.add(this.aimRing);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.aimLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: TEAM[0], transparent: true, opacity: 0.5 }));
    this.aimLine.visible = false;
    scene.add(this.aimLine);

    this.trapViews = new Map();
    this.impacts = new ImpactRings(scene);
  }

  /**
   * Снять всё своё со сцены и освободить ресурсы. Нужно потому, что смена облика
   * требует пересборки мешей: перекрасить уже созданную геометрию нельзя, а без
   * освобождения старые меши остались бы в сцене и в памяти.
   */
  dispose() {
    this.impacts.dispose();
    const kill = (o) => {
      if (!o) return;
      this.scene.remove(o);
      o.traverse((n) => {
        n.geometry?.dispose?.();
        const materials = Array.isArray(n.material) ? n.material : [n.material];
        for (const m of materials) { m?.map?.dispose(); m?.dispose(); }
      });
    };
    for (const f of this.fighters) { kill(f.group); kill(f.head); kill(f.chain.mesh); }
    kill(this.shatter.mesh);
    kill(this.aimRing);
    kill(this.aimLine);
    for (const v of this.trapViews.values()) kill(v);
    this.trapViews.clear();
    this.fighters.length = 0;
  }

  _trapMesh(skin) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(T.trap.radius * 0.8, T.trap.radius, 18),
      new THREE.MeshBasicMaterial({ color: 0x8fe6ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    g.add(ring);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.4, 0.16),
        new THREE.MeshLambertMaterial({ color: 0xd8f4ff, flatShading: true }),
      );
      spike.position.set(Math.cos(a) * 0.55, 0.2, Math.sin(a) * 0.55);
      spike.rotation.y = a;
      g.add(spike);
    }
    g.userData.ring = ring;
    return g;
  }

  /** aimVisible: показывать ли линию броска (мобильный drag-aim). */
  syncAim(sim, playerId, aim, aimVisible) {
    const f = sim.fighters[playerId];
    this.aimRing.position.set(aim.x, 0.06, aim.z);
    const ready = f.cd.hook <= 0 && f.state === STATE.IDLE;
    this.aimRing.material.color.setHex(ready ? TEAM[0] : 0x7c8a97);

    if (!aimVisible || f.state === STATE.DEAD) { this.aimLine.visible = false; return; }
    const dx = aim.x - f.x, dz = aim.z - f.z;
    const len = Math.hypot(dx, dz) || 0.01;
    const ux = dx / len, uz = dz / len;
    const blocked = traceHook(f.x, f.z, ux, uz, T.hook.range);
    const reach = blocked ? blocked.dist : T.hook.range;
    const pos = this.aimLine.geometry.attributes.position;
    pos.setXYZ(0, f.x, T.hook.flyY, f.z);
    pos.setXYZ(1, f.x + ux * reach, T.hook.flyY, f.z + uz * reach);
    pos.needsUpdate = true;
    this.aimLine.material.color.setHex(blocked ? 0xffd75e : TEAM[0]);
    this.aimLine.visible = true;
  }

  sync(sim, alpha, dt) {
    this.t += dt;
    this.shatter.update(dt);
    this.impacts.update(dt);

    for (const f of sim.fighters) {
      const v = this.fighters[f.id];
      const g = v.group;
      if (f.state === STATE.DEAD) { g.visible = false; v.head.visible = false; v.chain.hide(); continue; }
      g.visible = true;

      const x = lerp(f.px, f.x, alpha);
      const z = lerp(f.pz, f.z, alpha);
      const y = lerp(f.py, f.y, alpha);
      g.position.set(x, y, z);
      g.rotation.y = lerpAngle(f.pyaw, f.yaw, alpha);
      g.rotation.z = 0;
      g.rotation.x = 0;

      // вспышка и раздувание от попадания — гаснут за HIT_FLASH секунд
      const ht = this.hitT[f.id] = Math.max(0, this.hitT[f.id] - dt);
      const hp = ht / HIT_FLASH;
      this._flash(v, hp);
      g.scale.setScalar(1 + hp * 0.18);

      const speed = Math.hypot(f.vx, f.vz);
      const vulnerable = f.hp <= f.maxHp * T.finisher.hpFrac;
      g.userData.ring.material.opacity = vulnerable ? .65 + .3 * Math.sin(this.t * 9) : .75;
      g.userData.ring.scale.setScalar(vulnerable ? 1.2 : 1);
      // покачивание при ходьбе — только на льду, в воздухе фиксируем
      if (f.state === STATE.IDLE && speed > 0.4) {
        g.position.y = y + Math.abs(Math.sin(this.t * 9)) * 0.045;
      }
      if (f.state === STATE.STUNNED) g.rotation.z = Math.sin(this.t * 22) * 0.14;
      if (f.state === STATE.HOLE) { g.position.y = -0.55; g.rotation.z = 0.2; }
      if (f.state === STATE.PULLED) g.rotation.x = -0.18;

      // рука: замах удара, бросок крюка, замах добивания
      const arm = g.userData.arm;
      let armX = -0.1 + Math.sin(this.t * 9) * (speed > 0.4 ? 0.12 : 0.03);
      if (f.swing > 0) armX = -1.5 + (1 - f.swing / (T.melee.cooldown * 0.6)) * 2.1;
      if (f.throwT > 0) armX = -2.2 + (1 - f.throwT / 0.25) * 2.4;
      if (f.state === STATE.FINISHER) {
        const fin = sim.finisher;
        const total = T.finisher.telegraph + (f.isBot ? T.finisher.botTelegraphBonus : 0);
        const p = fin ? 1 - Math.max(0, fin.t) / total : 1;
        armX = -2.6 * Math.min(1, p * 1.6);
      }
      arm.rotation.x = armX;
      g.userData.gaff.visible = !f.hook || f.hook.phase === 'retract';

      // крюк и цепь
      const h = f.hook;
      if (h && h.phase !== 'retract') {
        const hy = h.phase === 'pullSelf' ? T.hook.flyY + 0.3 : T.hook.flyY;
        v.head.visible = true;
        v.head.position.set(h.x, hy, h.z);
        v.head.rotation.y = Math.atan2(-h.dirX, -h.dirZ);
        const handY = 1.0 + y;
        v.chain.update(
          { x: x + Math.sin(g.rotation.y + Math.PI / 2) * 0.35, y: handY, z: z + Math.cos(g.rotation.y + Math.PI / 2) * 0.35 },
          { x: h.x, y: hy, z: h.z },
          T.hook.linkGap,
        );
      } else {
        v.head.visible = false;
        v.chain.hide();
      }
    }

    // ловушки: появляются/исчезают по данным симуляции
    const seen = new Set();
    for (const tr of sim.traps) {
      seen.add(tr.id);
      let m = this.trapViews.get(tr.id);
      if (!m) {
        m = this._trapMesh(this.fighters[tr.owner].skin);
        m.position.set(tr.x, 0, tr.z);
        this.scene.add(m);
        this.trapViews.set(tr.id, m);
      }
      const armed = tr.arm <= 0;
      m.userData.ring.material.opacity = armed ? 0.55 + Math.sin(this.t * 5) * 0.2 : 0.25;
      m.scale.setScalar(armed ? 1 : 0.7);
    }
    for (const [id, m] of this.trapViews) {
      if (seen.has(id)) continue;
      this.scene.remove(m);
      m.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); });
      this.trapViews.delete(id);
    }
  }

  /**
   * Видимое подтверждение попадания. Раньше удар давал только звук, тряску и зум —
   * при отъезде камеры до 34 м по фигуркам было не понять, попал ты или промазал.
   * Теперь цель вспыхивает, дёргается по размеру и роняет льдинки в точке удара.
   */
  hit(id, x, z) {
    this.impacts.emit(x,z,TEAM[id],1.1,.3);
    this.hitT[id] = HIT_FLASH;
    this.shatter.burst(x, 1.0, z, [0xffffff, 0xdff0f8, this.skins[id]?.accent ?? 0x9fd8ef]);
  }

  /** Подсветка всех мешей бойца: 0 — обычный вид, 1 — белая вспышка. */
  _flash(v, amount) {
    v.group.traverse((n) => {
      if (n.material?.emissive) n.material.emissive.setScalar(amount * 0.85);
    });
  }

  /** Бескровный распад: боец рассыпается воксельными льдинками своего цвета. */
  burst(f) {
    const s = this.skins[f.id];
    this.shatter.burst(f.x, 0.6, f.z, [s.coat, s.pants, s.hat, 0xdff0f8, s.accent]);
  }

  splash(x, z) {
    this.impacts.emit(x,z,0x9ee8ff,2.1,.7,-.25);
    this.shatter.burst(x, 0.2, z, [0x9fd8ef, 0xdff0f8, 0x6fb8d8]);
  }

  reset() {
    this.impacts.reset();
    for (const v of this.fighters) { v.group.visible = true; v.head.visible = false; v.chain.hide(); }
    for (const [id, m] of this.trapViews) {
      this.scene.remove(m); m.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); });
      this.trapViews.delete(id);
    }
  }
}
