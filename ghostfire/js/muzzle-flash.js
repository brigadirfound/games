import * as THREE from 'three';

// One cached texture, one reusable sprite per player; no allocations per shot.
const texture = new THREE.TextureLoader().load('assets/vfx/muzzle-flash.png');
texture.colorSpace = THREE.SRGBColorSpace;
const sizes = [0.24, 0.43, 0.32, 0.19, 0.30, 0.39];
export class MuzzleFlash {
  constructor(camera) {
    this.camera = camera;
    this.material = new THREE.SpriteMaterial({ map: texture, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, depthTest: false, toneMapped: false });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 1000;
    this.sprite.visible = false;
    camera.add(this.sprite);
    this.remaining = 0;
  }
  fire(player, weapon) {
    // Scope keeps its clear sight picture; flash belongs to the visible barrel.
    if (player.aiming) return;
    this.remaining = weapon === 1 ? 0.065 : 0.045;
    this.material.rotation = Math.random() * Math.PI * 2;
    this.material.color.setHex(weapon === 2 ? 0x85cfff : 0xffffff);
    this.sprite.scale.setScalar(sizes[weapon] * (0.9 + Math.random() * 0.2));
    this.sprite.visible = true;
    this.update(0, player);
  }
  update(dt, player) {
    this.remaining = Math.max(0, this.remaining - dt);
    this.sprite.visible = this.remaining > 0 && player.alive && !player.aiming;
    if (!this.sprite.visible) return;
    player.getMuzzlePoint(this.sprite.position);
    this.camera.worldToLocal(this.sprite.position);
    this.material.opacity = Math.min(1, this.remaining / 0.018);
  }
  reset() { this.remaining = 0; this.sprite.visible = false; }
  dispose() { this.camera.remove(this.sprite); this.material.dispose(); }
}
