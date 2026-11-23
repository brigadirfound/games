const KEYS = { up:['KeyW','ArrowUp'], down:['KeyS','ArrowDown'], left:['KeyA','ArrowLeft'], right:['KeyD','ArrowRight'], sneak:['ShiftLeft','ShiftRight'], hurry:['Space'], light:['KeyF','KeyE'] };
export function detectInput() {
  const touch = (navigator.maxTouchPoints || 0) > 0;
  return { touch, keyboard: !touch || !!window.matchMedia?.('(pointer: fine)').matches };
}
export class Controls {
  constructor(canvas) {
    this.canvas = canvas; this.io = detectInput(); this.active = false;
    this.touchMode = 'sneak'; this.light = false; this.reset();
    this._bindKeyboard(); this._bindMouse(); this._bindTouch();
    window.addEventListener('blur', () => this.reset());
  }
  reset() {
    this.x = this.y = this.lookDX = this.lookDY = 0;
    this.sneak = this.hurry = false; this._down = {};
    this._movePointer = this._lookPointer = null; this._moveOrigin = this._lookLast = null;
    document.getElementById('stick')?.classList.remove('active');
    this._paintStick();
  }
  _paintStick(dx = 0, dy = 0) {
    const knob = document.getElementById('stick-knob');
    if (knob) knob.style.transform = `translate(${dx}px,${dy}px)`;
  }
  setTouchMode(mode) {
    this.touchMode = mode;
    this.sneak = mode === 'sneak'; this.hurry = mode === 'hurry';
  }
  _bindKeyboard() {
    const track = (e, down) => {
      if (!this.active || !Object.values(KEYS).some(keys => keys.includes(e.code))) return;
      e.preventDefault();
      for (const [name, keys] of Object.entries(KEYS)) if (keys.includes(e.code)) this._down[name] = down;
      this.x = (+!!this._down.right) - (+!!this._down.left);
      this.y = (+!!this._down.down) - (+!!this._down.up);
      this.sneak = !!this._down.sneak; this.hurry = !!this._down.hurry;
      if (down && !e.repeat && KEYS.light.includes(e.code)) this.toggleLight();
    };
    window.addEventListener('keydown', e => track(e, true));
    window.addEventListener('keyup', e => track(e, false));
  }
  _bindMouse() {
    this.canvas.addEventListener('click', () => { if (this.active) this.grabLook(); });
    document.addEventListener('mousemove', e => {
      if (!this.active || document.pointerLockElement !== this.canvas) return;
      this.lookDX += e.movementX * .0022; this.lookDY += e.movementY * .0022;
    });
    document.addEventListener('pointerlockchange', () =>
      window.dispatchEvent(new CustomEvent('look-lock', { detail: { locked: this.locked } })));
  }
  grabLook() {
    if (!this.active || !this.io.keyboard || document.pointerLockElement === this.canvas) return;
    try { this.canvas.requestPointerLock()?.catch?.(() => {}); } catch (_) {}
  }
  get locked() { return !this.io.keyboard || document.pointerLockElement === this.canvas; }
  _bindTouch() {
    const half = () => innerWidth / 2;
    this.canvas.addEventListener('pointerdown', e => {
      if (!this.active || e.pointerType === 'mouse') return;
      // A real touch switches hybrid devices out of pointer-lock control.
      this.io.touch = true; this.io.keyboard = false;
      window.dispatchEvent(new CustomEvent('input-touch'));
      try { this.canvas.setPointerCapture?.(e.pointerId); } catch (_) {}
      if (e.clientX < half() && this._movePointer === null) {
        this._movePointer = e.pointerId; this._moveOrigin = {x:e.clientX,y:e.clientY};
        const stick=document.getElementById('stick');
        if(stick){stick.style.left=`${Math.max(12,Math.min(innerWidth/2-124,e.clientX-56))}px`;stick.style.top=`${Math.max(96,Math.min(innerHeight-136,e.clientY-56))}px`;stick.style.bottom='auto';stick.classList.add('active');}
      } else if (e.clientX >= half() && this._lookPointer === null) {
        this._lookPointer = e.pointerId; this._lookLast = {x:e.clientX,y:e.clientY};
      }
    });
    this.canvas.addEventListener('pointermove', e => {
      if (!this.active) return;
      if (e.pointerId === this._movePointer && this._moveOrigin) {
        const dx=e.clientX-this._moveOrigin.x, dy=e.clientY-this._moveOrigin.y, len=Math.hypot(dx,dy);
        // The stick also chooses pace: inner ring is quiet, middle is walking,
        // outer ring is running. Buttons remain available for one-thumb play.
        this.x = len < 12 ? 0 : dx/len; this.y = len < 12 ? 0 : dy/len;
        this.setTouchMode(len >= 76 ? 'hurry' : len >= 38 ? 'walk' : 'sneak');
        const k = len ? Math.min(36,len)/len : 0; this._paintStick(dx*k,dy*k);
      }
      if (e.pointerId === this._lookPointer && this._lookLast) {
        this.lookDX += (e.clientX-this._lookLast.x)*.005; this.lookDY += (e.clientY-this._lookLast.y)*.005;
        this._lookLast={x:e.clientX,y:e.clientY};
      }
    });
    const release=e=>{
      if(e.pointerId===this._movePointer) { this._movePointer=null;this._moveOrigin=null;this.x=this.y=0;this._paintStick();document.getElementById('stick')?.classList.remove('active'); }
      if(e.pointerId===this._lookPointer) { this._lookPointer=null;this._lookLast=null; }
    };
    for(const event of ['pointerup','pointercancel','lostpointercapture']) this.canvas.addEventListener(event,release);
  }
  takeLook() { const d={x:this.lookDX,y:this.lookDY};this.lookDX=this.lookDY=0;return d; }
  toggleLight() { this.light=!this.light; }
}
