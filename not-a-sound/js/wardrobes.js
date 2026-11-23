import * as THREE from 'three';
import {roomMaterial} from './room-materials.js?v=resident-devices-v32';
import {clearSight} from './light-sense.js?v=resident-devices-v32';

export function wardrobeMounts(apt){
  const [sx,,sz]=apt.spawns[0],queue=[[Math.floor(sx),Math.floor(sz)]],seen=new Set();
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i],key=z+','+x;if(seen.has(key)||apt.wallGrid[z]?.[x]!==false||apt.occupied.has(key))continue;
    seen.add(key);for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([x+dx,z+dz]);
  }
  return apt.wardrobes.map(w=>{
    const room=apt.rooms.find(r=>w.x>=r.x0&&w.x<=r.x1&&w.z>=r.z0&&w.z<=r.z1);
    const choices=[[1,0],[-1,0],[0,1],[0,-1]].filter(([x,z])=>seen.has((w.z+z)+','+(w.x+x)));
    // Prefer doors opposite the supporting wall, not a sideways turn toward
    // the centre of an unmerged logical room.
    const rank=([dx,dz])=>(apt.wallGrid[w.z-dz]?.[w.x-dx]?-100:0)+Math.hypot(w.x+dx+.5-(room?.cx??w.x),w.z+dz+.5-(room?.cz??w.z));
    choices.sort((a,b)=>rank(a)-rank(b));
    if(!choices.length)return null;const[nx,nz]=choices[0];
    return {...w,nx,nz,entry:new THREE.Vector3(w.x+.5+nx,1,w.z+.5+nz),yaw:Math.atan2(-nx,-nz)};
  }).filter(Boolean);
}
export class Wardrobes {
  constructor(apt){
    this.apt=apt;
    this.mounts=wardrobeMounts(apt);this.group=new THREE.Group();this.group.name='usable-wardrobes';this.active=null;this.peek=false;this.offset=0;this.pitch=0;
    this.interior=new THREE.PointLight(0x9c967b,0,1.05,1.4);this.group.add(this.interior);
    const wood=roomMaterial('wood',0x786041),inner=roomMaterial('wood',0x403427),metal=roomMaterial('metal',0x9e8356);
    const box=(parent,x,y,z,w,h,d,mat)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
    for(const w of this.mounts){
      const g=new THREE.Group();g.position.set(w.x+.5,1,w.z+.5);g.rotation.y=Math.atan2(w.nx,w.nz);this.group.add(g);w.group=g;
      box(g,0,1.24,-.46,1,2.48,.075,inner);
      for(const x of [-.47,.47])box(g,x,1.24,0,.065,2.48,.98,wood);
      for(const y of [.04,2.46])box(g,0,y,0,1.04,.085,1.03,wood);
      box(g,0,2.32,.03,.88,.04,.04,metal);
      // Hanging coat silhouettes live behind the player, not across the sight slit.
      for(const x of [-.25,.22])box(g,x,1.54,-.34,.23,1.35,.10,inner);
      w.doors=[];
      for(const side of [-1,1]){
        const door=new THREE.Group();door.position.set(side*.44,0,.47);g.add(door);w.doors.push(door);
        const cx=-side*.214;
        box(door,cx,.63,0,.43,1.18,.047,wood);box(door,cx,2.18,0,.43,.48,.047,wood);
        for(const x of [cx-.20,cx+.20])box(door,x,1.58,0,.035,.76,.047,wood);
        for(let j=0;j<7;j++)box(door,cx,1.265+j*.10,0,.395,.055,.046,wood);
        box(door,cx-side*.115,1.12,.042,.024,.19,.038,metal);
        for(const y of [.35,2.13])box(door,0,y,.02,.034,.12,.035,metal);
      }
    }
  }
  nearby(player){return this.mounts.find(w=>w.entry.distanceTo(player)<1.25&&clearSight(this.apt,player,w.entry))||null;}
  enter(player,controls){const w=this.nearby(player.pos);if(!w)return false;this.active=w;this.peek=false;this.offset=this.pitch=0;this.doorOpen=.7;w.open=.7;
    player.pos.copy(w.entry);player.vel.set(0,0,0);player.mode='still';player.noise=0;controls.reset();controls.light=false;return true;}
  exit(player,controls){if(!this.active)return false;this.active.open=.7;player.pos.copy(this.active.entry);player.yaw=this.active.yaw;player.pitch=0;player.vel.set(0,0,0);controls.reset();this.active=null;this.peek=false;return true;}
  update(dt,look,player,camera){
    this.interior.intensity=this.active?.28:0;
    for(const w of this.mounts){const target=w===this.active?(this.peek?.95:0):0;
      w.open=THREE.MathUtils.damp(w.open??(w===this.active?this.doorOpen:0),target,10,dt);
      // Open one leaf and lean towards the actual gap, not the other leaf's slats.
      w.doors[0].rotation.y=-w.open;w.doors[1].rotation.y=0;}
    if(!this.active)return;
    const w=this.active,peek=THREE.MathUtils.smoothstep(w.open,0,.95);
    const yawLimit=THREE.MathUtils.lerp(.28,.70,peek),pitchLimit=THREE.MathUtils.lerp(.12,.40,peek);
    this.offset=THREE.MathUtils.clamp(this.offset-look.x,-yawLimit,yawLimit);this.pitch=THREE.MathUtils.clamp(this.pitch-look.y,-pitchLimit,pitchLimit);
    player.yaw=w.yaw+this.offset;player.mode='still';player.noise=0;
    const forward=THREE.MathUtils.lerp(.02,.40,peek),side=THREE.MathUtils.lerp(.14,-.095,peek);
    camera.position.set(w.x+.5+w.nx*forward+w.nz*side,2.62,w.z+.5+w.nz*forward-w.nx*side);
    this.interior.position.copy(camera.position);
    camera.rotation.set(this.pitch,player.yaw,0,'YXZ');
  }
  beam(){
    const w=this.active;if(!w)return null;
    const peek=THREE.MathUtils.smoothstep(w.open??0,0,.95),side=THREE.MathUtils.lerp(.14,-.095,peek);
    const yaw=w.yaw+this.offset*(.7+.3*peek),pitch=this.pitch;
    return {origin:new THREE.Vector3(w.x+.5+w.nx*.55+w.nz*side,2.62,w.z+.5+w.nz*.55-w.nx*side),
      direction:new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(pitch,yaw,0,'YXZ')),
      angle:THREE.MathUtils.lerp(.25,.43,peek)};
  }
  get protected(){return !!this.active&&!this.peek;}
}
