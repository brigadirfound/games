import * as THREE from 'three';
import { TEX } from './textures.js';
import { rand, clamp, pick } from './physics.js';

// ---------------------------------------------------------------------------
// Sprite flipbook: one shared texture, each instance walks its own UV window.
// ---------------------------------------------------------------------------
class Flipbook {
  constructor(file, cols, rows, { blending = THREE.NormalBlending } = {}) {
    this.cols = cols; this.rows = rows;
    this.frames = cols * rows;
    this.file = file;
    this.blending = blending;
    this.pool = [];
  }

  make() {
    const tex = TEX.load(this.file, { repeat: [1 / this.cols, 1 / this.rows], srgb: true }).clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(1 / this.cols, 1 / this.rows);
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
      blending: this.blending, opacity: 1,
    });
    return new THREE.Sprite(mat);
  }

  setFrame(sprite, i) {
    const f = clamp(Math.floor(i), 0, this.frames - 1);
    const cx = f % this.cols;
    const cy = Math.floor(f / this.cols);
    sprite.material.map.offset.set(cx / this.cols, 1 - (cy + 1) / this.rows);
  }
}

export const FLIP_EXPLOSION = new Flipbook('explosion.png', 4, 4, { blending: THREE.AdditiveBlending });
export const FLIP_SMOKE = new Flipbook('smoke.png', 4, 4);

// ---------------------------------------------------------------------------
export class EffectSystem {
  constructor(scene) {
    this.scene = scene;
    this.active = [];
    this.decals = [];
    this.maxDecals = 90;
    // Следы живут в СВОЁМ пуле. В общем они бы вытеснили кровь, масло и
    // следы шин: шагов три в секунду, и любой пробежки хватит, чтобы
    // выдавить из очереди всё остальное.
    this.foot = [];
    this.maxFoot = 26;
    this.trails = [];

    // shared geometry for ground decals
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalGeo.rotateX(-Math.PI / 2);

    this.decalMats = {};
    for (const [key, file] of Object.entries({
      oil: 'decal_oil.png', blood: 'decal_blood.png',
      scorch: 'decal_scorch.png', crack: 'decal_crack.png',
      foot: 'decal_footprint.png',
    })) {
      this.decalMats[key] = new THREE.MeshBasicMaterial({
        map: TEX.load(file, { repeat: [1, 1] }),
        transparent: true, depthWrite: false, opacity: 0.9,
        polygonOffset: true, polygonOffsetFactor: -4,
      });
    }
  }

  // ---- flipbook bursts ----
  burst(book, x, y, z, { size = 4, life = 0.75, spin = 0, rise = 0, fade = 1 } = {}) {
    const s = book.make();
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    s.material.rotation = spin;
    this.scene.add(s);
    this.active.push({ s, book, t: 0, life, size, rise, fade, y0: y });
    return s;
  }

  explosion(x, y, z, scale = 1) {
    this.burst(FLIP_EXPLOSION, x, y + 1.4 * scale, z, {
      size: 9 * scale, life: 0.85, spin: rand(-0.4, 0.4), rise: 1.6,
    });
    // secondary puffs for volume
    for (let i = 0; i < 3; i++) {
      this.burst(FLIP_SMOKE, x + rand(-2, 2) * scale, y + rand(1, 3) * scale, z + rand(-2, 2) * scale, {
        size: rand(5, 9) * scale, life: rand(1.4, 2.4), spin: rand(0, 6.28), rise: rand(1.2, 2.6), fade: 0.65,
      });
    }
    this.addDecal('scorch', x, z, 7 * scale, 0.85);
  }

  smoke(x, y, z, size = 2.4, life = 1.5) {
    this.burst(FLIP_SMOKE, x, y, z, {
      size, life, spin: rand(0, 6.28), rise: rand(1.4, 2.6), fade: 0.5,
    });
  }

  muzzle(x, y, z, size = 1.1) {
    this.burst(FLIP_EXPLOSION, x, y, z, { size, life: 0.09, spin: rand(0, 6.28) });
  }

  // ---- persistent ground decals ----
  addDecal(kind, x, z, size = 2, opacity = 0.85) {
    const mat = this.decalMats[kind];
    if (!mat) return;
    const m = new THREE.Mesh(this.decalGeo, mat.clone());
    m.material.opacity = opacity;
    m.position.set(x, 0.035 + Math.random() * 0.01, z);
    m.rotation.y = rand(0, Math.PI * 2);
    m.scale.set(size, 1, size);
    this.scene.add(m);
    this.decals.push({ m, life: 60, fade: opacity });
    if (this.decals.length > this.maxDecals) {
      const old = this.decals.shift();
      this.scene.remove(old.m);
      old.m.material.dispose();
    }
  }

  bloodSplat(x, z) { this.addDecal('blood', x, z, rand(1.4, 2.4), 0.85); }
  oilStain(x, z) { this.addDecal('oil', x, z, rand(1.6, 3), 0.6); }
  skidMark(x, z, heading) {
    const mat = this.decalMats.oil;
    const m = new THREE.Mesh(this.decalGeo, mat.clone());
    m.material.opacity = 0.4;
    m.position.set(x, 0.03, z);
    m.rotation.y = heading;
    m.scale.set(0.5, 1, 2.2);
    this.scene.add(m);
    this.decals.push({ m, life: 22, fade: 0.4 });
    if (this.decals.length > this.maxDecals) {
      const old = this.decals.shift();
      this.scene.remove(old.m);
      old.m.material.dispose();
    }
  }

  /** Облачко пыли из-под ноги. */
  footDust(x, z, size = 0.55) {
    this.burst(FLIP_SMOKE, x, 0.12, z, {
      size, life: rand(0.32, 0.5), spin: rand(0, 6.28),
      rise: rand(0.35, 0.8), fade: 0.28,
    });
  }

  /**
   * Отпечаток подошвы. Держим отдельно от общих декалей и коротко живём:
   * это фоновая мелочь, она не должна ни вытеснять важное, ни копиться.
   */
  footPrint(x, z, heading, opacity = 0.4) {
    const mat = this.decalMats.foot;
    if (!mat) return;
    const m = new THREE.Mesh(this.decalGeo, mat.clone());
    m.material.opacity = opacity;
    // Светлее асфальта, а не темнее: след оставляют по МОКРОМУ, и тёмная
    // метка на тёмном мокром покрытии не читается вовсе. Вода из-под
    // подошвы выдавливается и даёт светлый отпечаток.
    m.material.color.setHex(0xa8b8c4);
    m.position.set(x, 0.032 + Math.random() * 0.008, z);
    m.rotation.y = -heading;
    m.scale.set(0.34, 1, 0.5);
    this.scene.add(m);
    this.foot.push({ m, life: 13, fade: opacity });
    if (this.foot.length > this.maxFoot) {
      const old = this.foot.shift();
      this.scene.remove(old.m);
      old.m.material.dispose();
    }
  }

  update(dt) {
    // следы затухают своим чередом
    for (let i = this.foot.length - 1; i >= 0; i--) {
      const d = this.foot[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.m);
        d.m.material.dispose();
        this.foot.splice(i, 1);
      } else if (d.life < 5) {
        d.m.material.opacity = d.fade * (d.life / 5);
      }
    }

    // flipbooks
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.t += dt;
      const p = a.t / a.life;
      if (p >= 1) {
        this.scene.remove(a.s);
        a.s.material.map.dispose();
        a.s.material.dispose();
        this.active.splice(i, 1);
        continue;
      }
      a.book.setFrame(a.s, p * a.book.frames);
      a.s.position.y = a.y0 + a.rise * a.t;
      const grow = 1 + p * 0.5;
      a.s.scale.setScalar(a.size * grow);
      a.s.material.opacity = a.fade * (p > 0.7 ? (1 - p) / 0.3 : 1);
    }

    // decals fade out slowly
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.m);
        d.m.material.dispose();
        this.decals.splice(i, 1);
      } else if (d.life < 4) {
        d.m.material.opacity = d.fade * (d.life / 4);
      }
    }
  }

  clear() {
    for (const a of this.active) { this.scene.remove(a.s); a.s.material.dispose(); }
    this.active.length = 0;
    for (const d of this.decals) { this.scene.remove(d.m); d.m.material.dispose(); }
    this.decals.length = 0;
    for (const d of this.foot) { this.scene.remove(d.m); d.m.material.dispose(); }
    this.foot.length = 0;
  }
}
