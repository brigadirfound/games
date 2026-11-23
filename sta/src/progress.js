import * as THREE from 'three';
import { rand, randInt, pick, clamp } from './physics.js';
import { CITY } from './city.js';

// ---------------------------------------------------------------- packages
// 40 hidden packages. Every 10 unlocks a reward delivered to your safehouse.
export const PACKAGE_TOTAL = 40;

export const PACKAGE_REWARDS = [
  { at: 10, label: 'УЗИ + БРОНЯ в убежище', apply: (g) => { g.homeStash.uzi = 250; g.homeStash.armor = true; } },
  { at: 20, label: 'ДРОБОВИК в убежище', apply: (g) => { g.homeStash.shotgun = 120; } },
  { at: 30, label: 'ВИНТОВКА в убежище', apply: (g) => { g.homeStash.rifle = 60; } },
  { at: PACKAGE_TOTAL, label: 'РПГ + $50000', apply: (g) => { g.homeStash.rocket = 30; g.addMoney(50000); } },
];

// ---------------------------------------------------------------- property
export const PROPERTIES = [
  { id: 'garage_ind',  name: 'ГАРАЖ В ПРОМЗОНЕ', price: 8000,  district: 'industrial', income: 120, perk: 'Спавн машины + сохранение' },
  { id: 'club_docks',  name: 'КЛУБ В ПОРТУ',     price: 22000, district: 'docks',      income: 340, perk: 'Доход и точка старта' },
  { id: 'loft_down',   name: 'ЛОФТ В ЦЕНТРЕ',    price: 45000, district: 'downtown',   income: 700, perk: 'Броня при спавне' },
  { id: 'mansion_sub', name: 'ОСОБНЯК',          price: 90000, district: 'suburb',     income: 1400, perk: 'Полный арсенал' },
];

// ---------------------------------------------------------------- turf war
export const TURF_DISTRICTS = ['industrial', 'docks', 'suburb', 'commercial', 'downtown'];

export class ProgressSystem {
  constructor(game) {
    this.game = game;
    this.packages = [];
    this.packagesFound = 0;
    this.rewardsClaimed = [];
    this.owned = [];
    this.propertyMarkers = [];
    this.turf = {};       // district -> 0..100 player control
    this.turfWave = null;
    this.incomeTimer = 0;
    this.stunts = { longest: 0, total: 0 };
    this.rampageActive = null;
    this.rampagesDone = [];
    this.rampageSpots = [];

    for (const d of TURF_DISTRICTS) this.turf[d] = 0;

    this.spawnPackages();
    this.placeProperties();
    this.placeRampages();
  }

  // ------------------------------------------------------------ packages
  spawnPackages() {
    const geo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const mat = new THREE.MeshBasicMaterial({ color: 0x33e0ff });
    const city = this.game.city;
    const used = [];
    for (let i = 0; i < PACKAGE_TOTAL; i++) {
      let p = null;
      for (let t = 0; t < 40; t++) {
        // hide them in alleys, parks and near buildings
        const c = Math.random() < 0.45 && city.parks.length
          ? (() => { const pk = pick(city.parks); return { x: pk.x + rand(-pk.w / 2 + 2, pk.w / 2 - 2), z: pk.z + rand(-pk.h / 2 + 2, pk.h / 2 - 2) }; })()
          : city.randomSidewalkPoint();
        if (city.blockedAt(c.x,c.z,0.65)) continue;
        if (used.some((u) => Math.hypot(u.x - c.x, u.z - c.z) < 45)) continue;
        p = c; break;
      }
      if (!p) p = city.randomSidewalkPoint();
      used.push(p);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(p.x, 1.0, p.z);
      this.game.scene.add(m);
      this.packages.push({ x: p.x, z: p.z, mesh: m, taken: false, spin: rand(0, 6) });
    }
  }

  updatePackages(dt) {
    const g = this.game;
    if (g.player.inVehicle) {
      for (const p of this.packages) if (!p.taken) { p.spin += dt * 2; p.mesh.rotation.set(p.spin * 0.7, p.spin, 0); }
      return;
    }
    for (const p of this.packages) {
      if (p.taken) continue;
      p.spin += dt * 2;
      p.mesh.rotation.set(p.spin * 0.7, p.spin, 0);
      p.mesh.position.y = 1.0 + Math.sin(p.spin * 1.4) * 0.16;
      if (Math.hypot(p.x - g.player.x, p.z - g.player.z) < 1.8) {
        p.taken = true;
        g.scene.remove(p.mesh);
        this.packagesFound++;
        g.addMoney(250);
        g.audio.beep(1300, 0.1, 0.24);
        setTimeout(() => g.audio && g.audio.beep(1750, 0.16, 0.2), 90);
        let msg = `ПАКЕТ ${this.packagesFound}/${PACKAGE_TOTAL}  +$250`;
        for (const r of PACKAGE_REWARDS) {
          if (this.packagesFound === r.at && !this.rewardsClaimed.includes(r.at)) {
            this.rewardsClaimed.push(r.at);
            r.apply(g);
            msg += `\nНАГРАДА: ${r.label}`;
          }
        }
        g.showMessage(msg, 3);
        g.checkEndgame();
      }
    }
  }

  // ------------------------------------------------------------ property
  placeProperties() {
    const g = this.game;
    for (const def of PROPERTIES) {
      // find a block in the right district
      const blocks = g.city.blockRects.filter((b) => b.district === def.district);
      const b = blocks.length ? pick(blocks) : pick(g.city.blockRects);
      const x = b.cx, z = b.cz + (b.z1 - b.z0) / 2 + 5;
      const group = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.4, 0.35),
        new THREE.MeshLambertMaterial({ color: 0x3a3a42 }));
      post.position.y = 1.7;
      group.add(post);
      const board = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.5, 0.2),
        new THREE.MeshBasicMaterial({ color: 0x2ecc71 }));
      board.position.y = 3.6;
      group.add(board);
      group.position.set(x, 0, z);
      g.scene.add(group);
      this.propertyMarkers.push({ def, x, z, mesh: group, board });
    }
  }

  updateProperties(dt) {
    const g = this.game;
    for (const pm of this.propertyMarkers) {
      const ownedNow = this.owned.includes(pm.def.id);
      pm.board.material.color.setHex(ownedNow ? 0x2ecc71 : 0xffc93c);
      if (ownedNow) continue;
      const d = Math.hypot(g.playerX() - pm.x, g.playerZ() - pm.z);
      if (d < 6 && g.input.actHit('interact')) {
        if (g.money >= pm.def.price) {
          g.addMoney(-pm.def.price);
          this.owned.push(pm.def.id);
          g.showMessage(`КУПЛЕНО: ${pm.def.name}\n${pm.def.perk}`, 3.5);
          g.audio.beep(900, 0.16, 0.3);
          setTimeout(() => g.audio && g.audio.beep(1200, 0.22, 0.3), 150);
          g.checkEndgame();
        } else {
          g.showMessage(`НУЖНО $${pm.def.price}`, 1.6);
        }
      }
    }

    // passive income every 30 s
    this.incomeTimer += dt;
    if (this.incomeTimer >= 30) {
      this.incomeTimer = 0;
      let total = 0;
      for (const id of this.owned) {
        const def = PROPERTIES.find((p) => p.id === id);
        if (def) total += def.income;
      }
      // turf control adds income too
      for (const d of TURF_DISTRICTS) total += Math.floor(this.turf[d] * 1.2);
      if (total > 0) {
        this.game.addMoney(total);
        this.game.showMessage(`ДОХОД С АКТИВОВ +$${total}`, 2);
      }
    }
  }

  nearProperty() {
    const g = this.game;
    for (const pm of this.propertyMarkers) {
      if (this.owned.includes(pm.def.id)) continue;
      if (Math.hypot(g.playerX() - pm.x, g.playerZ() - pm.z) < 7) return pm.def;
    }
    return null;
  }

  ownedProperty(id) { return this.owned.includes(id); }

  // ------------------------------------------------------------ turf wars
  addTurf(district, amount) {
    if (!(district in this.turf)) return;
    const before = Math.floor(this.turf[district] / 25);
    this.turf[district] = clamp(this.turf[district] + amount, 0, 100);
    const after = Math.floor(this.turf[district] / 25);
    if (after > before && this.turf[district] >= 100) {
      const names = { downtown: 'ЦЕНТР', commercial: 'ДЕЛОВОЙ', industrial: 'ПРОМЗОНА', suburb: 'ОКРАИНА', docks: 'ПОРТ' };
      this.game.showMessage(`РАЙОН ЗАХВАЧЕН: ${names[district]}`, 3);
      this.game.audio.beep(700, 0.14, 0.3);
      setTimeout(() => this.game.audio && this.game.audio.beep(1050, 0.2, 0.3), 140);
      this.game.checkEndgame();
    }
  }

  get turfOwned() { return TURF_DISTRICTS.filter((d) => this.turf[d] >= 100).length; }

  // ------------------------------------------------------------ rampages
  placeRampages() {
    const g = this.game;
    const geo = new THREE.CylinderGeometry(1.1, 1.1, 2.6, 12);
    for (let i = 0; i < 6; i++) {
      const p = g.city.randomSidewalkPoint();
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xff3355, transparent: true, opacity: 0.55 }));
      mesh.position.set(p.x, 1.3, p.z);
      g.scene.add(mesh);
      this.rampageSpots.push({ x: p.x, z: p.z, mesh, done: false, id: i });
    }
  }

  updateRampages(dt) {
    const g = this.game;
    const R = this.rampageActive;
    if (R) {
      R.timeLeft -= dt;
      if (R.timeLeft <= 0) {
        g.showMessage(`БЕСПРЕДЕЛ ПРОВАЛЕН\n${R.count}/${R.need}`, 2.5);
        g.audio.beep(200, 0.4, 0.3, 'sawtooth');
        this.rampageActive = null;
      } else if (R.count >= R.need) {
        const spot = this.rampageSpots.find((s) => s.id === R.id);
        if (spot) { spot.done = true; g.scene.remove(spot.mesh); }
        this.rampagesDone.push(R.id);
        g.addMoney(2500);
        this.addTurf(R.district, 34);
        g.showMessage(`БЕСПРЕДЕЛ ЗАВЕРШЁН!\n+$2500 · влияние в районе`, 3.5);
        g.audio.beep(950, 0.14, 0.3);
        setTimeout(() => g.audio && g.audio.beep(1300, 0.22, 0.3), 140);
        this.rampageActive = null;
        g.checkEndgame();
      }
      return;
    }

    for (const s of this.rampageSpots) {
      if (s.done) continue;
      s.mesh.rotation.y += dt * 2;
      s.mesh.position.y = 1.3 + Math.sin(g.time * 2.4) * 0.16;
      if (g.player.inVehicle) continue;
      if (Math.hypot(s.x - g.player.x, s.z - g.player.z) < 2.2) this.startRampage(s);
    }
  }

  startRampage(spot) {
    const g = this.game;
    const weapon = pick(['uzi', 'shotgun', 'rocket']);
    const need = weapon === 'rocket' ? 8 : 14;
    g.inventory[weapon] += weapon === 'rocket' ? 20 : 300;
    g.selectWeapon(weapon);
    this.rampageActive = {
      id: spot.id, need, count: 0, timeLeft: 60, weapon,
      district: g.city.districtAtWorld(spot.x, spot.z),
    };
    g.showMessage(`БЕСПРЕДЕЛ!\nУничтожь ${need} целей за 60 сек`, 3);
    g.audio.beep(400, 0.3, 0.3, 'sawtooth');
  }

  onRampageKill() {
    if (this.rampageActive) this.rampageActive.count++;
  }

  // ------------------------------------------------------------ stunts
  registerStunt(distance, air) {
    if (distance < 12) return;
    this.stunts.total++;
    const bonus = Math.round(distance * 12 + air * 60);
    this.stunts.longest = Math.max(this.stunts.longest, distance);
    this.game.addMoney(bonus);
    this.game.showMessage(`БЕЗУМНЫЙ ПРЫЖОК!\n${distance.toFixed(0)} м · +$${bonus}`, 2.6);
    this.game.audio.beep(1200, 0.18, 0.3);
  }

  // ------------------------------------------------------------ serialize
  serialize() {
    return {
      found: this.packages.map((p) => p.taken),
      packagesFound: this.packagesFound,
      rewardsClaimed: this.rewardsClaimed,
      owned: this.owned,
      turf: this.turf,
      rampagesDone: this.rampagesDone,
      stunts: this.stunts,
    };
  }

  deserialize(d) {
    if (!d) return;
    this.packagesFound = d.packagesFound || 0;
    this.rewardsClaimed = d.rewardsClaimed || [];
    this.owned = d.owned || [];
    this.turf = Object.assign(this.turf, d.turf || {});
    this.rampagesDone = d.rampagesDone || [];
    this.stunts = Object.assign(this.stunts, d.stunts || {});
    if (Array.isArray(d.found)) {
      for (let i = 0; i < this.packages.length; i++) {
        if (d.found[i] && !this.packages[i].taken) {
          this.packages[i].taken = true;
          this.game.scene.remove(this.packages[i].mesh);
        }
      }
    }
    for (const id of this.rampagesDone) {
      const s = this.rampageSpots.find((x) => x.id === id);
      if (s && !s.done) { s.done = true; this.game.scene.remove(s.mesh); }
    }
  }
}
