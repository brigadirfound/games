import * as THREE from 'three';
import {roomMaterial} from './room-materials.js?v=resident-devices-v32';
import {createHunter} from './hunter.js?v=resident-devices-v32';

// Continuous two-flight stairwell shared by the opening, loop and escape.
export function buildStairwell(resident=true){
 const shot={extraTextures:[]},day=!resident;
 shot.scene=new THREE.Scene();shot.scene.background=new THREE.Color(0x101716);
 shot.camera=new THREE.PerspectiveCamera(55,1,.05,30);
 let seed=1987;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 function worn(base,roughness=1){
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');g.fillStyle=base;g.fillRect(0,0,256,256);
  for(let i=0;i<3200;i++){g.fillStyle=i%3?'rgba(30,25,17,.065)':'rgba(244,235,209,.13)';g.fillRect(rnd()*256,rnd()*256,1+rnd()*3,1+rnd()*2);}
  for(let i=0;i<24;i++){g.fillStyle='rgba(59,47,28,.04)';g.fillRect(rnd()*256,rnd()*256,2+rnd()*7,8+rnd()*38);}
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;shot.extraTextures.push(map);return new THREE.MeshStandardMaterial({map,roughness});
 }
 const plaster=worn('#c3bfab'),green=worn('#48765a',.8),stone=worn('#8b887b'),edge=worn('#a9a598'),skirt=worn('#50493c');
 const wood=roomMaterial('wood',0x51412d),metal=roomMaterial('metal',0x343c37),mail=roomMaterial('enamel',0x777a66);
 const box=(x,y,z,w,h,d,mat,parent=shot.scene)=>{const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
 function rod(a,b,r,mat){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),v=bv.clone().sub(av);const m=new THREE.Mesh(new THREE.CylinderGeometry(r,r,v.length(),8),mat);m.position.copy(av.add(bv).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize());m.castShadow=true;shot.scene.add(m);return m;}
 box(0,-.14,1.2,5.2,.28,4.4,stone);
 for(let i=0;i<9;i++){const z=3.57+i*.34,y=-.17*(i+1);box(.15,y-.16,z,1.9,.32,.35,stone);box(.15,y+.012,z-.14,1.92,.025,.065,edge);}
 const slab=box(.15,-1.05,4.93,1.94,.17,3.48,stone);slab.rotation.x=Math.atan(.17/.34);
 box(0,-1.67,7.03,5.2,.28,1.76,stone);
 for(let i=0;i<9;i++){const z=6.25-i*.34,y=-1.53-.17*(i+1);box(-1.78,y-.16,z,1.38,.32,.35,stone);box(-1.78,y+.012,z+.14,1.4,.025,.065,edge);}
 box(-1.78,-3.20,2.56,1.4,.28,1.4,stone);
 // Lower green paint follows the stairs; upper walls remain limewashed.
 for(const x of [-2.6,2.6]){
  box(x,.08,2.05,.18,6.7,11.9,plaster);
  const face=x>0?x-.10:x+.10;
  box(face,.65,1.2,.022,1.3,4.4,green);box(face+(x>0?-.015:.015),.10,1.2,.022,.20,4.4,skirt);
  const band=(offset,height,mat)=>{
   const fx=face+(x>0?-.015:.015)*offset,g=new THREE.BufferGeometry(),a=3.4,b=6.46,drop=1.53;
   g.setAttribute('position',new THREE.Float32BufferAttribute([fx,0,a,fx,-drop,b,fx,height-drop,b,fx,0,a,fx,height-drop,b,fx,height,a],3));
   g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1],2));g.computeVertexNormals();
   const m=mat.clone();m.side=THREE.DoubleSide;const mesh=new THREE.Mesh(g,m);mesh.receiveShadow=true;shot.scene.add(mesh);
  };
  band(0,1.3,green);band(1,.2,skirt);
  box(face,-.88,7.03,.022,1.3,1.76,green);
 }
 box(0,3.45,2,5.4,.18,12,plaster);
 // Window in a closed rear wall above the half-floor landing.
 box(-1.8,.08,7.96,1.6,6.7,.18,plaster);box(1.8,.08,7.96,1.6,6.7,.18,plaster);
 box(0,-1.84,7.96,2,2.9,.18,plaster);box(0,2.48,7.96,2,1.94,.18,plaster);box(0,-.98,7.85,5.2,1.07,.025,green);box(0,-1.43,7.83,5.2,.20,.025,skirt);
 for(const x of [-1.05,1.05])box(x,.56,7.81,.10,1.9,.20,wood);
 for(const y of [-.39,1.51])box(0,y,7.81,2.2,.10,.20,wood);
 const glass=new THREE.MeshStandardMaterial({color:day?0xc5d5cd:0x27353c,emissive:day?0xc0c9ac:0x152329,emissiveIntensity:day?.7:.12,roughness:.48});
 box(0,.56,7.91,2,1.8,.04,glass);box(0,.56,7.76,.055,1.8,.09,wood);box(0,.88,7.76,2,.055,.09,wood);box(0,-.45,7.65,2.3,.09,.48,stone);
 // Established apartment hinge and actor positions remain unchanged.
 // Side piers meet the ceiling underside at 3.36; no open strip above the door wall.
 for(const x of [-1.75,1.75]){box(x,1.70,-.75,1.6,3.4,.2,plaster);box(x,.65,-.638,1.6,1.3,.025,green);box(x,.1,-.62,1.6,.2,.025,skirt);}
 box(0,3.02,-.75,1.95,.86,.2,plaster);
 for(const x of [-1,1])box(x,1.3,-.6,.12,2.6,.18,wood);box(0,2.61,-.6,2.12,.12,.18,wood);
 box(0,-.1,-2.1,5,.2,3,wood);box(0,1.75,-3.6,5,3.5,.15,plaster);
 shot.door=new THREE.Group();shot.door.position.set(-.94,0,-.63);shot.scene.add(shot.door);
 box(.94,1.28,0,1.86,2.56,.1,wood,shot.door);for(const y of [.66,1.77])box(.94,y,.063,1.55,.89,.028,wood,shot.door);
 box(1.68,1.08,.09,.19,.035,.05,metal,shot.door);shot.door.rotation.y=-1.25;
 // Rail endpoints are calculated from the same rise/run as the stairs.
 for(const x of [-.77,1.07]){
  for(let i=0;i<9;i++){const z=3.57+i*.34,y=-.17*(i+1);rod([x,y,z],[x,y+.93,z],.018,metal);}
  rod([x,.76,3.57],[x,-.60,6.29],.035,wood);rod([x,.22,3.57],[x,-1.14,6.29],.014,metal);
 }
 for(let i=0;i<9;i++){const z=6.25-i*.34,y=-1.53-.17*(i+1);rod([-1.12,y,z],[-1.12,y+.93,z],.018,metal);}
 rod([-1.12,-.77,6.25],[-1.12,-2.13,3.53],.035,wood);
 for(let i=0;i<9;i++)box(-.69+i*.17,-1.03,7.70,.12,.48,.13,mail);
 for(const x of [-2.32,2.32])rod([x,-2.8,7.57],[x,3.30,7.57],.026,mail);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++){
  const z=.45+col*.47,y=1.03+row*.43;box(2.39,y,z,.23,.40,.44,metal);box(2.257,y,z,.025,.36,.40,mail);box(2.237,y+.10,z,.012,.026,.28,metal);box(2.230,y-.07,z+.12,.018,.04,.04,metal);
 }
 box(-2.45,1.64,1.1,.09,.78,1.02,wood);for(let i=0;i<3;i++)box(-2.39,1.66+(i%2)*.05,.81+i*.29,.016,.47,.23,plaster);
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='#302b23';ctx.fillRect(0,0,128,64);ctx.fillStyle='#e5cc91';ctx.font='bold 42px sans-serif';ctx.textAlign='center';ctx.fillText('12',64,47);
 shot.plaqueTexture=new THREE.CanvasTexture(canvas);const plaque=new THREE.Mesh(new THREE.PlaneGeometry(.32,.16),new THREE.MeshBasicMaterial({map:shot.plaqueTexture}));plaque.position.set(1.29,1.85,-.63);shot.scene.add(plaque);
 shot.ambient=new THREE.HemisphereLight(0xbfc9cf,0x4b4938,.6);shot.scene.add(shot.ambient);
 shot.bulb=new THREE.PointLight(0xffd294,25,12,1.6);shot.bulb.position.set(.6,2.95,1.2);shot.bulb.castShadow=true;shot.bulb.shadow.mapSize.set(512,512);shot.scene.add(shot.bulb);
 const daylight=new THREE.PointLight(day?0xffebbe:0x7899b0,day?18:.3,11,1.5);daylight.position.set(0,1.1,7.3);shot.scene.add(daylight);
 shot.lamp=box(.6,3.29,1.2,.32,.12,.32,new THREE.MeshStandardMaterial({color:0xf1d8a6,emissive:0xe0aa60,emissiveIntensity:.7}));
 shot.darkStep=0;shot.doorSlam=false;shot.shouted=false;
 if(resident){shot.model=createHunter();shot.model.position.set(0,0,-.1);shot.scene.add(shot.model);}
 return shot;
}
