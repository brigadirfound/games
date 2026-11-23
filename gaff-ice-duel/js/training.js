import { Sim, emptyIntent } from './sim.js';
// Explicit practice arena. These stationary targets never enter normal matches.
export class Training {
  constructor(game, onStep, onDone) {
    this.game=game; this.onStep=onStep; this.onDone=onDone; this.step=0; this.reset();
  }
  reset() {
    const s=this.game.sim=new Sim();
    const positions=this.step===2 ? [[6.5,-12],[-10,10]] : [[-8,-9],[-8,-2]];
    s.fighters.forEach((f,i)=>{f.x=f.px=positions[i][0];f.z=f.pz=positions[i][1];});
    this.origin={x:s.fighters[0].x,z:s.fighters[0].z};
    this.game.input.aimAt(this.step===2 ? 6.5 : s.fighters[1].x,this.step===2 ? -6 : s.fighters[1].z);
    this.game._cameraSnap=true; this.onStep(this.step);
  }
  tick(intent) {
    const s=this.game.sim;
    // Restore health without invulnerability: invulnerability also blocks the hook.
    s.fighters.forEach(f=>{f.hp=f.maxHp;});s.time=0;
    s.step({0:intent,1:emptyIntent()});
    const events=s.drainEvents();
    const me=s.fighters[0];
    const passed=this.step===0 ? Math.hypot(me.x-this.origin.x,me.z-this.origin.z)>3 :
      events.some(e=>e.id===0&&e.type===[null,'hook-hit-body','hook-hit-wall','dash','trap-set'][this.step]);
    this.game._events(events.filter(e=>e.type!=='round-over'));
    if(passed){this.step++;if(this.step===5){this.onDone();return;}this.reset();}
  }
}
