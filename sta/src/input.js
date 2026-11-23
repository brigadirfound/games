// Keyboard / mouse / gamepad input with pointer lock and rebindable actions.
export const DEFAULT_BINDS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  crouch: ['ControlLeft', 'KeyC'],
  enter: ['KeyF', 'KeyE'],
  handbrake: ['Space'],
  horn: ['KeyH'],
  camera: ['KeyV'],
  reload: ['KeyR'],
  nextWeapon: ['KeyQ'],
  radio: ['KeyT'],
  job: ['KeyJ'],
  jobType: ['KeyG'],
  interact: ['KeyB'],
  shopNext: ['KeyN'],
  map: ['KeyZ'],
  mute: ['KeyM'],
  pause: ['Escape', 'KeyP'],
  respawn: ['KeyR', 'Enter'],
  save: ['F5'],
  load: ['F9'],
  skipTutorial: ['Backspace'],
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseButtons = new Set();
    this.mousePressed = new Set();
    this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
    this.gamepadIndex = null;
    this.gp = { lx: 0, ly: 0, rx: 0, ry: 0, buttons: new Set(), pressed: new Set() };
    this.usingGamepad = false;

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
           'F5', 'F9', 'ControlLeft'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseButtons.clear(); });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) { this.requestLock(); return; }
      if (!this.mouseButtons.has(e.button)) this.mousePressed.add(e.button);
      this.mouseButtons.add(e.button);
      this.usingGamepad = false;
    });
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button));
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += e.deltaY > 0 ? 1 : -1;
    }, { passive: false });

    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  requestLock() {
    if (!this.locked && this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  // ---- raw ----
  down(code) { return this.enabled && this.keys.has(code); }
  hit(code) { return this.enabled && this.pressed.has(code); }
  mouseDown(b) { return this.enabled && this.mouseButtons.has(b); }
  mouseHit(b) { return this.enabled && this.mousePressed.has(b); }

  // ---- actions ----
  act(name) {
    const list = this.binds[name];
    if (!list) return false;
    for (const c of list) if (this.keys.has(c)) return this.enabled;
    return false;
  }
  actHit(name) {
    const list = this.binds[name];
    if (!list) return false;
    for (const c of list) if (this.pressed.has(c)) return this.enabled;
    return false;
  }

  pollGamepad() {
    if (this.gamepadIndex === null || !navigator.getGamepads) return;
    const pad = navigator.getGamepads()[this.gamepadIndex];
    if (!pad) return;
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
    this.gp.lx = dz(pad.axes[0] || 0);
    this.gp.ly = dz(pad.axes[1] || 0);
    this.gp.rx = dz(pad.axes[2] || 0);
    this.gp.ry = dz(pad.axes[3] || 0);
    if (Math.abs(this.gp.lx) + Math.abs(this.gp.ly) + Math.abs(this.gp.rx) + Math.abs(this.gp.ry) > 0.1) {
      this.usingGamepad = true;
    }
    this.gp.pressed.clear();
    for (let i = 0; i < pad.buttons.length; i++) {
      const p = pad.buttons[i].pressed;
      if (p && !this.gp.buttons.has(i)) this.gp.pressed.add(i);
      if (p) this.gp.buttons.add(i); else this.gp.buttons.delete(i);
    }
    // right stick looks around
    if (this.gp.rx || this.gp.ry) {
      this.mouseDX += this.gp.rx * 13;
      this.mouseDY += this.gp.ry * 11;
    }
  }

  padDown(i) { return this.gp.buttons.has(i); }
  padHit(i) { return this.gp.pressed.has(i); }

  // movement axes (keyboard + left stick)
  axis() {
    let x = 0, y = 0;
    if (this.act('forward')) y += 1;
    if (this.act('back')) y -= 1;
    if (this.act('left')) x -= 1;
    if (this.act('right')) x += 1;
    if (this.gp.lx || this.gp.ly) { x += this.gp.lx; y -= this.gp.ly; }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  // analogue throttle for driving (triggers when a pad is present)
  driveAxes() {
    let throttle = 0, steer = 0;
    if (this.act('forward')) throttle += 1;
    if (this.act('back')) throttle -= 1;
    if (this.act('left')) steer -= 1;
    if (this.act('right')) steer += 1;
    if (this.gamepadIndex !== null && navigator.getGamepads) {
      const pad = navigator.getGamepads()[this.gamepadIndex];
      if (pad) {
        const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
        const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
        if (rt > 0.05 || lt > 0.05) throttle = rt - lt;
        if (this.gp.lx) steer = this.gp.lx;
      }
    }
    return { throttle: Math.max(-1, Math.min(1, throttle)), steer: Math.max(-1, Math.min(1, steer)) };
  }

  fireDown() {
    return this.mouseDown(0) || this.padDown(7);
  }
  fireHit() {
    return this.mouseHit(0) || this.padHit(7);
  }
  aimDown() {
    return this.mouseDown(2) || this.padDown(6);
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.gp.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
