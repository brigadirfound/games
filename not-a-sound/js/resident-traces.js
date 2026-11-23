import * as THREE from 'three';
import { roomMaterial } from './room-materials.js?v=resident-devices-v32';
import { clearSight } from './light-sense.js?v=resident-devices-v32';

const ids=['notice','routine','shift','portrait','visitor','letter','departure'];
let familyPhoto=null,courtyardPhoto=null;
const chapterPhotos=[];
const couplePhotos=[];
export function wallPhotos(night=1){
  const photos=[familyPhoto,...couplePhotos,...chapterPhotos.filter(p=>p!==familyPhoto)];
  const shelf=chapterPhotos[Math.max(0,night-1)];
  const unique=[...new Set(photos.filter(p=>p&&p!==shelf))];
  const start=Math.max(0,night-1)%Math.max(1,Math.min(3,unique.length));
  return unique.slice(start).concat(unique.slice(0,start));
}
export const chapterPhotoFiles=['archive-courtyard-v23.png','archive-cups-v28.png','archive-hospital-v28.png','viktor-lena-v1.png','archive-landing-v28.png','archive-departure-v28.png','archive-lamp-v28.png'];
export function storyPhoto(index=0){return index%2?courtyardPhoto:familyPhoto;}
export function createArchivePiece(index,item=null){
  const g=new THREE.Group();g.name='family-archive';
  const sheet=new THREE.Mesh(new THREE.BoxGeometry(.42,.012,.55),roomMaterial('linen',0xe4dac4));g.add(sheet);
  if(item?item.kind==='photo':index%3===0){
    const photo=new THREE.Mesh(new THREE.PlaneGeometry(.34,.43),new THREE.MeshStandardMaterial({map:item&&item.night<=3?courtyardPhoto:familyPhoto,roughness:1}));
    photo.rotation.x=-Math.PI/2;photo.position.y=.009;g.add(photo);
  }else{
    const ink=new THREE.MeshBasicMaterial({color:0x4b4035});
    for(let i=0;i<6;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(i===5?.16:.31,.003,.006),ink);line.position.set(-.02,.009,-.18+i*.06);g.add(line);}
    if(item?item.kind==='ticket':index%3===2){g.scale.set(.65,1,.45);sheet.material=roomMaterial('linen',0xcdbd92);}
  }
  return g;
}
export async function prepareStoryPhoto(){
  familyPhoto=await new THREE.TextureLoader().loadAsync(new URL('../assets/textures/viktor-lena-v1.png',import.meta.url).href);
  familyPhoto.colorSpace=THREE.SRGBColorSpace;familyPhoto.anisotropy=4;
  courtyardPhoto=await new THREE.TextureLoader().loadAsync(new URL('../assets/textures/archive-courtyard-v23.png',import.meta.url).href);
  courtyardPhoto.colorSpace=THREE.SRGBColorSpace;courtyardPhoto.anisotropy=4;
  await Promise.all(chapterPhotoFiles.map(async(file,i)=>{
    const map=i===0?courtyardPhoto:i===3?familyPhoto:await new THREE.TextureLoader().loadAsync(new URL('../assets/textures/'+file,import.meta.url).href);
    map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;chapterPhotos[i]=map;
  }));
  await Promise.all(['wedding','picnic','winter'].map(async(name,i)=>{
    const map=await new THREE.TextureLoader().loadAsync(new URL('../assets/textures/viktor-lena-'+name+'-v29.png',import.meta.url).href);
    map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;couplePhotos[i]=map;
  }));
}

// Changes wait for a real look away. Reading and pauses never advance this clock.
export class TraceEvents {
  constructor(found=[],apply=()=>{}) {
    this.done=new Set(found.filter(id=>ids.includes(id)));this.pending=[];this.apply=apply;
    for(const id of this.done)apply(id);
  }
  arm(id) {
    if(ids.includes(id)&&!this.done.has(id)&&!this.pending.some(p=>p.id===id))
      this.pending.push({id,age:0,unseen:0});
  }
  update(dt,{visible,paused=false}) {
    if(paused||!this.pending.length)return null;
    const p=this.pending[0];p.age+=dt;p.unseen=visible?0:p.unseen+dt;
    if(p.age<2.5||p.unseen<.65)return null;
    this.done.add(p.id);this.pending.shift();this.apply(p.id);return p.id;
  }
}

export function createResidentTraces(apt,found=[],noticed=[]) {
  const group=new THREE.Group();group.name='resident-traces';
  const [sx,,sz]=apt.spawns[0];
  const chapter=Math.max(0,(apt.storyNight||1)-1);
  const away=apt.rooms.filter(r=>!(sx>=r.x0&&sx<r.x1+1&&sz>=r.z0&&sz<r.z1+1));
  const ranked=[...(away.length?away:apt.rooms)].sort((a,b)=>Math.hypot(b.cx-sx,b.cz-sz)-Math.hypot(a.cx-sx,a.cz-sz));
  const preferred=apt.authoredHome?apt.rooms[[2,3,1][chapter]??2]:ranked[chapter%ranked.length];
  let mount=null;
  const reachable=new Set(),queue=[[Math.floor(sx),Math.floor(sz)]];
  for(let i=0;i<queue.length;i++){
    const [x,z]=queue[i],key=z+','+x;
    if(reachable.has(key)||apt.wallGrid[z]?.[x]!==false||apt.occupied?.has(key))continue;
    reachable.add(key);
    for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([x+dx,z+dz]);
  }
  const clearApproach=(x,z,dx,dz)=>{
    if(!reachable.has((z+dz)+','+(x+dx)))return false;
    // Entire shelf width needs solid backing, not just its centre.
    for(let side=-1;side<=1;side++)if(!apt.wallGrid[z-dz+dx*side]?.[x-dx-dz*side])return false;
    // Include the wardrobe cornice and door sweep, beyond its one-cell grid.
    if((apt.wardrobes||[]).some(w=>Math.hypot(w.x-x,w.z-z)<2.1))return false;
    for(let depth=0;depth<2;depth++)for(let side=-1;side<=1;side++){
      const cx=x+dx*depth-dz*side,cz=z+dz*depth+dx*side;
      if(apt.wallGrid[cz]?.[cx]!==false||apt.occupied?.has(cz+','+cx))return false;
    }
    return true;
  };
  // A shallow shelf on a solid wall, outside collision cells and door openings.
  for(const room of [preferred,...ranked.filter(r=>r!==preferred)].filter(Boolean)){
  for(let x=room.x1-1;x>=room.x0+1;x--) {
    if(apt.wallGrid[room.z1+1]?.[x]&&clearApproach(x,room.z1,0,-1)) {
      mount={x:x+.5,z:room.z1+1-.16,rotation:Math.PI};break;
    }
  }
  if(!mount)for(let x=room.x0+1;x<room.x1;x++) {
    if(apt.wallGrid[room.z0-1]?.[x]&&clearApproach(x,room.z0,0,1)){
      mount={x:x+.5,z:room.z0+.16,rotation:0};break;
    }
  }
  if(!mount)for(let z=room.z0+1;z<room.z1&&!mount;z++)for(const side of [-1,1]) {
    const x=side<0?room.x0:room.x1;
    if(apt.wallGrid[z]?.[x+side]&&clearApproach(x,z,-side,0)){
      mount={x:side<0?x+.16:x+1-.16,z:z+.5,rotation:-side*Math.PI/2};break;
    }
  }
    if(mount)break;
  }
  // Corridor walls and merged-room edges may lie outside the room rectangles.
  if(!mount)for(const key of reachable){
    const [z,x]=key.split(',').map(Number);
    if(Math.hypot(x+.5-sx,z+.5-sz)<4)continue;
    for(const [dx,dz]of [[0,1],[0,-1],[1,0],[-1,0]]){
      if(!clearApproach(x,z,dx,dz))continue;
      mount={x:x+.5-dx*.34,z:z+.5-dz*.34,rotation:Math.atan2(dx,dz)};break;
    }
    if(mount)break;
  }
  if(!mount)return {group,arm(){},update(){return null;},anchor:null};
  group.position.set(mount.x,0,mount.z);group.rotation.y=mount.rotation;
  const material=color=>new THREE.MeshStandardMaterial({color,roughness:.96});
  const wood=roomMaterial('wood',0x62513a),cream=roomMaterial('enamel',0xb5aa8e),dark=material(0x30382d),brass=roomMaterial('metal',0x8c7654);
  const box=(parent,x,y,z,w,h,d,mat)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);
    m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
  };
  const display=['shelf','kitchen','ledger','album','console','drawer','notebook'][chapter];
  group.userData.display=display;
  box(group,0,2.21,.20,1.70,.065,.75,wood);
  for(const x of [-.58,.58])box(group,x,2.09,-.025,.04,.22,.15,brass);
  // Each chapter has its own document setting. These shallow wall fittings stay
  // inside the old shelf envelope; they do not add obstacles to the walking grid.
  const paperLocal=new THREE.Vector3(-.03,2.26,.32);
  if(display==='kitchen') {
    box(group,-.03,2.251,.32,.55,.012,.58,roomMaterial('linen',0x8f927c));
  } else if(display==='ledger'||display==='notebook') {
    box(group,-.03,2.265,.30,.58,.045,.62,roomMaterial('linen',display==='ledger'?0x494b41:0x685344));
    box(group,-.03,2.294,.30,.53,.016,.57,material(0xd1c5a6));
    paperLocal.y=2.312;
    for(let i=0;i<7;i++)box(group,-.31,2.30,.06+i*.07,.035,.012,.015,brass);
  } else if(display==='album') {
    box(group,-.03,2.27,.31,.57,.05,.62,roomMaterial('linen',0x47362d));
    box(group,-.03,2.301,.31,.52,.014,.58,material(0xcec3a8));
    paperLocal.y=2.32;
  } else if(display==='console'||display==='drawer') {
    box(group,0,2.10,.20,1.58,.14,.69,wood);
    for(const x of [-.39,.39]){
      box(group,x,2.10,.56,.74,.12,.025,wood);
      box(group,x,2.10,.585,.14,.023,.035,brass);
    }
    if(display==='drawer') {
      box(group,-.03,2.255,.31,.58,.02,.61,wood);
      for(const x of [-.31,.25])box(group,x,2.29,.31,.022,.065,.61,wood);
      paperLocal.y=2.276;
    }
  }
  function cup(x) {
    const g=new THREE.Group();g.position.set(x,2.24,.01);group.add(g);
    const m=new THREE.Mesh(new THREE.CylinderGeometry(.066,.056,.14,16),cream);m.position.y=.08;g.add(m);
    const tea=new THREE.Mesh(new THREE.CircleGeometry(.052,16),dark);tea.rotation.x=-Math.PI/2;tea.position.y=.151;g.add(tea);
    const handle=new THREE.Mesh(new THREE.TorusGeometry(.037,.012,6,12),cream);handle.position.set(.075,.083,0);g.add(handle);
    return g;
  }
  cup(-.50);const second=cup(-.27);second.visible=false;
  const photo=new THREE.Group();photo.position.set(.13,2.56,-.045);group.add(photo);
  box(photo,0,0,0,.48,.61,.04,wood);
  box(photo,0,0,.028,.42,.54,.012,new THREE.MeshStandardMaterial({map:chapterPhotos[chapter]||familyPhoto,color:0xffffff,roughness:1}));
  // Keep the original photograph unobstructed; no floating censor geometry.
  // A recognisable ticket and unaddressed envelope support the later pages.
  const ticket=box(group,-.55,2.26,.37,.25,.012,.13,material(0xc4b08a));
  const envelope=box(group,.55,2.26,.36,.28,.012,.20,material(0xd0c2a0));
  ticket.visible=apt.storyNight>=4;envelope.visible=apt.storyNight>=6;
  for(let i=0;i<5;i++){
    const line=box(ticket,-.075+i*.033,.009,0,.012,.003,.08,dark);
    line.castShadow=false;
  }
  const roster=box(group,-.08,2.25,.05,.23,.014,.15,material(0xc9bb93));roster.visible=false;
  const scratches=new THREE.Group();group.add(scratches);scratches.visible=false;
  for(const x of [-.26,.22])box(scratches,x,2.245,.10,.23,.004,.012,dark);
  box(group,.58,2.40,0,.028,.34,.028,brass);
  const shade=new THREE.Mesh(new THREE.ConeGeometry(.16,.15,16,1,true),roomMaterial('linen',0xb5aa8e));shade.position.set(.58,2.61,0);group.add(shade);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.035,8,6),new THREE.MeshStandardMaterial({color:0xd7b77d,emissive:0xffad54,emissiveIntensity:1}));
  bulb.position.set(.58,2.57,0);group.add(bulb);
  const lamp=new THREE.PointLight(0xf6bb76,.85,2.7,1.5);lamp.position.set(.58,2.53,.12);group.add(lamp);
  const apply=id=>{
    if(id==='notice'){lamp.intensity=.075;bulb.material.emissiveIntensity=.04;}
    if(id==='routine')second.visible=true;
    if(id==='letter')envelope.rotation.y=.18;
    if(id==='shift')roster.visible=true;
    if(id==='portrait')photo.rotation.z=-.035;
    if(id==='visitor')scratches.visible=true;
    if(id==='departure')envelope.visible=true;
  };
  const events=new TraceEvents(found,apply),anchor=new THREE.Vector3(mount.x,2.45,mount.z);
  group.updateMatrixWorld(true);const paperPosition=group.localToWorld(paperLocal);
  const observed=new Set(noticed);let viewTime=0;
  return {group,anchor,paperPosition,paperRotation:mount.rotation+.10,events,arm:id=>events.arm(id),update(dt,player,camera){
    const to=anchor.clone().sub(camera.position),distance=to.length();
    const forward=new THREE.Vector3(0,0,-1).applyQuaternion(camera.quaternion);
    // Wider than the player's view, so a prop never changes at the screen edge.
    const facing=forward.dot(to.normalize()),sight=distance<12&&clearSight(apt,player,anchor);
    const visible=distance<.35||(facing>.15&&sight);
    const changed=events.update(dt,{visible});
    const inView=facing>Math.cos(THREE.MathUtils.degToRad(camera.fov)/2)&&sight;
    viewTime=inView&&distance<5?viewTime+dt:0;
    const notice=viewTime>.8?ids.find(id=>events.done.has(id)&&!observed.has(id)):null;
    if(notice)observed.add(notice);
    return {changed,noticed:notice};
  }};
}
