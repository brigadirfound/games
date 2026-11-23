import { WEAPONS, WEAPON_ORDER } from './weapon-data.js';

export class WeaponState {
  constructor(inventory, saved = {}) {
    this.inventory = inventory;
    this.magazines = {};
    this.reload = null;
    for (const id of WEAPON_ORDER.slice(1)) {
      const total = Math.max(0, Math.floor(Number(inventory[id]) || 0));
      inventory[id] = total;
      if (total > 0 || Object.hasOwn(saved, id)) this.magazines[id] = Number.isFinite(saved[id])
        ? Math.max(0, Math.min(total, WEAPONS[id].capacity, Math.floor(saved[id]))) : Math.min(total, WEAPONS[id].capacity);
    }
  }
  owned(id) { return id === 'fist' || this.inventory[id] > 0 || Object.hasOwn(this.magazines, id); }
  loaded(id) {
    if (id === 'fist') return Infinity;
    if (!WEAPONS[id]) return 0;
    if (!Object.hasOwn(this.magazines, id) && this.inventory[id] > 0)
      this.magazines[id] = Math.min(this.inventory[id], WEAPONS[id].capacity);
    return this.magazines[id] = Math.max(0, Math.min(this.magazines[id] || 0, this.inventory[id] || 0));
  }
  reserve(id) { return id === 'fist' ? 0 : Math.max(0, this.inventory[id] - this.loaded(id)); }
  startReload(id) {
    const definition = WEAPONS[id];
    if (!definition?.capacity || this.reload || this.loaded(id) >= definition.capacity || this.reserve(id) <= 0) return false;
    this.reload = { id, elapsed: 0, duration: definition.reload, stage: 0 };
    return true;
  }
  cancelReload() { this.reload = null; }
  fire(id) {
    if (this.reload) {
      if (this.reload.id === id && WEAPONS[id].shellReload && this.loaded(id) > 0) this.cancelReload();
      else return false;
    }
    if (this.loaded(id) <= 0) return false;
    this.magazines[id]--; this.inventory[id]--;
    return true;
  }
  tick(dt) {
    const events = [];
    if (!this.reload || !Number.isFinite(dt) || dt <= 0) return events;
    this.reload.elapsed += dt;
    while (this.reload) {
      const state = this.reload, definition = WEAPONS[state.id];
      const stage = Math.floor(Math.min(1, state.elapsed / state.duration) * 3);
      if (stage > state.stage) { state.stage = stage; events.push('mechanism'); }
      if (state.elapsed < state.duration) break;
      const amount = Math.min(this.reserve(state.id), definition.shellReload ? 1 : definition.capacity - this.loaded(state.id));
      this.magazines[state.id] += amount;
      events.push('loaded');
      if (definition.shellReload && this.loaded(state.id) < definition.capacity && this.reserve(state.id) > 0) {
        state.elapsed -= state.duration; state.stage = 0;
      } else this.cancelReload();
    }
    return events;
  }
  get progress() { return this.reload ? Math.min(1, this.reload.elapsed / this.reload.duration) : 0; }
}
