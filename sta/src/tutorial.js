// Step-by-step onboarding: teaches look, move, sprint, camera, car, driving,
// the first mission marker, then hands the player the open world.
export const STEPS = [
  {
    id: 'look', title: 'ОСМОТРИСЬ',
    text: 'Двигай <b>мышью</b>, чтобы вращать камеру',
    check: (g, s) => (s.look = (s.look || 0) + Math.abs(g.input.mouseDX) + Math.abs(g.input.mouseDY)) > 320,
  },
  {
    id: 'move', title: 'ИДИ',
    text: 'Клавиши <b>W A S D</b> — движение',
    check: (g, s) => (s.dist = (s.dist || 0) + g.player.speed / 60) > 9,
  },
  {
    id: 'sprint', title: 'БЕГИ',
    text: 'Удерживай <b>Shift</b>, чтобы бежать',
    check: (g, s) => (s.run = (s.run || 0) + (g.player.speed > 5 ? 1 : 0)) > 45,
  },
  {
    id: 'camera', title: 'СМЕНИ ВИД',
    text: 'Нажми <b>V</b> — от третьего лица, от первого, дальняя, кино',
    check: (g, s) => { if (s.startMode === undefined) s.startMode = g.cam.modeIndex; return g.cam.modeIndex !== s.startMode; },
  },
  {
    id: 'aim', title: 'ПРИЦЕЛЬСЯ',
    text: 'Зажми <b>ПКМ</b> для прицела, <b>ЛКМ</b> — выстрел',
    check: (g, s) => (s.aim = (s.aim || 0) + (g.aimingDownSights ? 1 : 0)) > 40,
  },
  {
    id: 'car', title: 'СЯДЬ В МАШИНУ',
    text: 'Подойди к любой машине и нажми <b>F</b>',
    hint: 'car',
    check: (g) => !!g.player.inVehicle,
  },
  {
    id: 'drive', title: 'ПРОКАТИСЬ',
    text: '<b>W</b> — газ, <b>S</b> — тормоз, <b>Space</b> — ручник. Радио: <b>T</b>',
    check: (g, s) => {
      if (!g.player.inVehicle) return (s.drive || 0) > 45;
      s.drive = (s.drive || 0) + Math.abs(g.player.inVehicle.speed) / 60;
      return s.drive > 45;
    },
  },
  {
    id: 'mission', title: 'ПЕРВОЕ ДЕЛО',
    text: 'Езжай к <b style="color:#ffcc33">жёлтому маркеру</b> на карте — там ждёт работа',
    hint: 'mission',
    check: (g) => !!g.missions.active,
  },
  {
    id: 'done', title: 'ТЫ ГОТОВ',
    text: 'Дальше — сам. Удачи в Либерти.',
    auto: 4.2,
  },
];

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.state = {};
    this.active = true;
    this.finished = false;
    this.timer = 0;
    this.justAdvanced = 0;
    this.arrow = null;
  }

  get step() { return this.active ? STEPS[this.index] : null; }

  skip() {
    if (!this.active) return;
    this.active = false;
    this.finished = true;
    this.game.showMessage('ОБУЧЕНИЕ ПРОПУЩЕНО', 1.6);
  }

  advance() {
    this.index++;
    this.state = {};
    this.timer = 0;
    this.justAdvanced = 1;
    this.game.audio.beep(1150, 0.09, 0.22);
    setTimeout(() => this.game.audio && this.game.audio.beep(1500, 0.13, 0.2), 90);
    if (this.index >= STEPS.length) {
      this.active = false;
      this.finished = true;
      this.game.showMessage('ОБУЧЕНИЕ ЗАВЕРШЕНО\nГород открыт', 3.5);
    }
  }

  update(dt) {
    if (!this.active) return;
    this.justAdvanced = Math.max(0, this.justAdvanced - dt * 2.5);
    const s = this.step;
    if (!s) { this.active = false; this.finished = true; return; }

    this.timer += dt;
    if (s.auto) {
      if (this.timer >= s.auto) this.advance();
      return;
    }
    // instant steps (already in the desired state) shouldn't wait
    const instant = s.id === 'car' || s.id === 'mission';
    if (!instant && this.timer < 0.4) return;
    if (s.check && s.check(this.game, this.state)) this.advance();
  }

  // where to point the on-screen guidance arrow, if anywhere
  hintTarget() {
    const s = this.step;
    if (!s || !s.hint) return null;
    const g = this.game;
    if (s.hint === 'car') {
      let best = null, bd = 1e9;
      for (const v of g.vehicles) {
        if (v.destroyed) continue;
        const d = Math.hypot(v.x - g.player.x, v.z - g.player.z);
        if (d < bd) { bd = d; best = v; }
      }
      return best ? { x: best.x, z: best.z, label: 'МАШИНА' } : null;
    }
    if (s.hint === 'mission' && g.missions.markerPos) {
      return { x: g.missions.markerPos.x, z: g.missions.markerPos.z, label: 'МИССИЯ' };
    }
    return null;
  }

  progressText() {
    if (!this.active) return '';
    return `${Math.min(this.index + 1, STEPS.length)}/${STEPS.length}`;
  }

  serialize() { return { finished: this.finished, index: this.index }; }
  deserialize(d) {
    if (!d) return;
    if (d.finished) { this.active = false; this.finished = true; }
  }
}
