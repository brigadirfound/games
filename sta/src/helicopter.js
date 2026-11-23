import * as THREE from 'three';
import { clamp, angleDiff, rand } from './physics.js';
import { buildAircraft } from './aircraft-models.js';

// Police chopper that appears at 4+ stars: circles the player, spotlight at night,
// snipes from above and drops SWAT on rooftops-ish positions.
export class PoliceHelicopter {
  constructor(game, x, z) {
    this.game = game;
    this.x = x; this.z = z; this.y = 46;
    this.heading = rand(-Math.PI, Math.PI);
    this.rotorSpin = 0;
    this.health = 220;
    this.dead = false;
    this.shootCd = rand(2, 4);
    this.dropCd = 12;
    this.orbit = rand(0, Math.PI * 2);
    this.orbitR = rand(26, 38);
    this.mesh = this.build();
    game.scene.add(this.mesh);
  }

  build() {
    const aircraft = buildAircraft('patrol');
    const g = aircraft.group;
    this.rotor = aircraft.mainRotor;
    this.tailRotor = aircraft.tailRotor;
    this.beacon = aircraft.beacon;

    // spotlight cone (visual only)
    const coneGeo = new THREE.ConeGeometry(7, 44, 14, 1, true);
    coneGeo.translate(0, -22, 0);
    this.spot = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0xfff6c8, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
    this.spot.position.y = -1.2;
    this.spot.visible = false;
    g.add(this.spot);

    return g;
  }

  damage(n) {
    this.health -= n;
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    const g = this.game;
    if (this.dead) {
      // spin down and crash
      this.y -= 22 * dt;
      this.heading += dt * 5;
      this.rotorSpin += dt * 8;
      this.mesh.rotation.z += dt * 1.4;
      if (Math.random() < dt * 20) g.spawnSmoke(this.x, this.y, this.z);
      if (this.y <= 1) {
        g.explode(this.x, this.z, 2.2);
        g.scene.remove(this.mesh);
        return false;
      }
      this.mesh.position.set(this.x, this.y, this.z);
      this.rotor.rotation.y = this.rotorSpin;
      return true;
    }

    const px = g.playerX(), pz = g.playerZ();
    this.orbit += dt * 0.42;
    const tx = px + Math.cos(this.orbit) * this.orbitR;
    const tz = pz + Math.sin(this.orbit) * this.orbitR;

    const dx = tx - this.x, dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    const speed = clamp(d * 0.9, 0, 26);
    if (d > 0.5) {
      this.x += (dx / d) * speed * dt;
      this.z += (dz / d) * speed * dt;
    }
    // keep altitude above buildings nearby
    let need = 34;
    const boxes = [];
    g.city.nearbyColliders(this.x, this.z, 22, boxes);
    for (const b of boxes) need = Math.max(need, b.height + 12);
    this.y += (Math.min(need, 78) - this.y) * Math.min(1, dt * 1.2);

    const face = Math.atan2(px - this.x, pz - this.z);
    this.heading += angleDiff(this.heading, face) * Math.min(1, dt * 2.2);
    this.rotorSpin += dt * 26;

    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, this.heading, 0);
    this.rotor.rotation.y = this.rotorSpin;
    this.tailRotor.rotation.x = this.rotorSpin * 1.6;
    this.beacon.visible = Math.sin(g.time * 8) > 0;

    const night = (g.nightFactor || 0) > 0.4;
    this.spot.visible = night;
    if (night) {
      // aim the cone at the player
      const ddx = px - this.x, ddz = pz - this.z;
      this.spot.rotation.set(
        Math.atan2(Math.hypot(ddx, ddz), this.y) * 0.55, 0,
        -Math.atan2(ddx, ddz) * 0.0);
    }

    // shooting
    this.shootCd -= dt;
    const flat = Math.hypot(px - this.x, pz - this.z);
    if (flat < 46 && this.shootCd <= 0) {
      this.shootCd = rand(1.3, 2.4);
      ctx.policeShoot(this.x, this.z, px, pz, 11);
    }

    // rotor noise near the player
    if (flat < 90) g.audio.rotor(true, clamp(1 - flat / 90, 0.1, 1));
    return true;
  }
}
