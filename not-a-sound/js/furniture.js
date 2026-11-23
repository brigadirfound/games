import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roomMaterial } from './room-materials.js?v=resident-devices-v32';

// Keep the existing occupied cells: dressing must never narrow a route or move a goal.
export function furnitureColumns(apt) {
  if (apt.id !== 'apartment' || !apt.wallGrid || !apt.occupied) return [];
  const columns = new Map(), wardrobes = new Set((apt.wardrobes||[]).map(w => `${w.z},${w.x}`));
  for (const [x,y,z,type] of apt.blocks) {
    const key = `${z},${x}`;
    if (y < 1 || y > 2 || apt.wallGrid[z]?.[x] || wardrobes.has(key) || !apt.occupied.has(key)) continue;
    if (![4,6,7,8,9,10,11].includes(type)) continue;
    if (!columns.has(key)) columns.set(key,{x,z,levels:[]});
    columns.get(key).levels[y-1]=type;
  }
  return [...columns.values()];
}

export function tidySeats(apt) {
  const seats=new Map(furnitureColumns(apt).filter(c=>c.levels[0]===7&&!c.levels[1]).map(c=>[`${c.x},${c.z}`,c]));
  const seen=new Set(),removed=new Set();
  for(const [key,first] of seats){
    if(seen.has(key))continue;
    const cluster=[first];seen.add(key);
    for(let i=0;i<cluster.length;i++)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
      const k=`${cluster[i].x+dx},${cluster[i].z+dz}`;
      if(seats.has(k)&&!seen.has(k)){seen.add(k);cluster.push(seats.get(k));}
    }
    let best=[];
    const members=new Set(cluster.map(c=>`${c.x},${c.z}`));
    for(const c of cluster)for(let w=1;w<=cluster.length;w++)for(let d=1;w*d<=cluster.length;d++){
      if(w*d<=best.length)continue;
      const rect=[];
      for(let x=0;x<w;x++)for(let z=0;z<d;z++)if(members.has(`${c.x+x},${c.z+z}`))rect.push(`${c.x+x},${c.z+z}`);
      if(rect.length===w*d)best=rect;
    }
    for(const c of cluster)if(!best.includes(`${c.x},${c.z}`)){removed.add(`${c.z},${c.x}`);apt.occupied.delete(`${c.z},${c.x}`);}
  }
  apt.blocks=apt.blocks.filter(([x,y,z])=>y!==1||!removed.has(`${z},${x}`));
}

export function createFurniture(apt) {
  const group = new THREE.Group(); group.name = 'furnished-rooms';
  const wood=roomMaterial('wood',0x786044), darkWood=roomMaterial('wood',0x42382d);
  const cloth=roomMaterial('linen',0x625e4e), enamel=roomMaterial('enamel',0xb4b09d);
  const metal=roomMaterial('metal',0x8d8067), paper=roomMaterial('linen',0xc9bc98);
  const green=roomMaterial('linen',0x455139), terracotta=roomMaterial('enamel',0x755440);
  const covers=[0x5d3431,0x46524d,0x796347].map(c=>roomMaterial('linen',c));
  const batches=new Map(), matrix=new THREE.Matrix4(), unit=new THREE.Vector3(1,1,1);
  let root;
  function add(geometry,x,y,z,mat,rotation=0) {
    matrix.compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),rotation),unit);
    geometry.applyMatrix4(matrix).applyMatrix4(root);
    if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(geometry);
  }
  const box=(x,y,z,w,h,d,m)=>add(new THREE.BoxGeometry(w,h,d),x,y,z,m);
  const columns=furnitureColumns(apt), consumed=new Set();
  const seats=new Map(columns.filter(c=>c.levels[0]===7&&!c.levels[1]).map(c=>[`${c.x},${c.z}`,c]));
  for(const c of columns) {
    if(consumed.has(c))continue;
    if(seats.has(`${c.x},${c.z}`)){
      let cluster=[c];const seen=new Set([c]);
      for(let i=0;i<cluster.length;i++)for(const [dx,dz]of [[1,0],[-1,0],[0,1],[0,-1]]){
        const next=seats.get(`${cluster[i].x+dx},${cluster[i].z+dz}`);
        if(next&&!consumed.has(next)&&!seen.has(next)){seen.add(next);cluster.push(next);}
      }
      if(cluster.length!==(Math.max(...cluster.map(p=>p.x))-Math.min(...cluster.map(p=>p.x))+1)*(Math.max(...cluster.map(p=>p.z))-Math.min(...cluster.map(p=>p.z))+1)){
        const strips=[[1,0],[0,1]].map(([dx,dz])=>{
          const strip=[c];
          for(const sign of [-1,1])for(let step=1;;step++){
            const next=seats.get(`${c.x+dx*step*sign},${c.z+dz*step*sign}`);
            if(!next||consumed.has(next))break;strip.push(next);
          }
          return strip;
        });
        cluster=strips.sort((a,b)=>b.length-a.length)[0];
      }
      const minX=Math.min(...cluster.map(p=>p.x)),maxX=Math.max(...cluster.map(p=>p.x));
      const minZ=Math.min(...cluster.map(p=>p.z)),maxZ=Math.max(...cluster.map(p=>p.z));
      const spanX=maxX-minX+1,spanZ=maxZ-minZ+1;
      // A rectangular footprint is one sofa/daybed, not one armchair per voxel.
      // The mesh stays inside its original occupied cells.
      if(cluster.length>1&&cluster.length===spanX*spanZ){
        const acrossX=spanX>=spanZ,w=(acrossX?spanX:spanZ)-.16,d=(acrossX?spanZ:spanX)-.16;
        const cx=(minX+maxX+1)/2,cz=(minZ+maxZ+1)/2;
        const room=apt.rooms.find(r=>cx>=r.x0&&cx<=r.x1+1&&cz>=r.z0&&cz<=r.z1+1);
        const angle=acrossX?(room&&cz>room.cz?Math.PI:0):(room&&cx>room.cx?-Math.PI/2:Math.PI/2);
        root=new THREE.Matrix4().compose(new THREE.Vector3(cx,1,cz),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),angle),unit);
        for(const x of [-w/2+.15,w/2-.15])for(const z of [-d/2+.15,d/2-.15])box(x,.13,z,.09,.26,.09,darkWood);
        box(0,.36,0,w,.30,d,cloth);
        const count=Math.max(spanX,spanZ),seatWidth=(w-.24)/count;
        for(let i=0;i<count;i++)box(-w/2+.12+seatWidth*(i+.5),.565,.025,seatWidth-.025,.15,d-.25,cloth);
        box(0,.81,-d/2+.09,w,.58,.18,cloth);
        for(const x of [-w/2+.065,w/2-.065])box(x,.68,.04,.13,.34,d-.08,wood);
        box(0,.26,d/2+.005,w-.10,.06,.02,darkWood);
        cluster.forEach(p=>consumed.add(p));continue;
      }
    }
    const walls=[[0,-1],[0,1],[-1,0],[1,0]].map(([x,z])=>{
      let distance=1;
      while(distance<Math.max(apt.width,apt.depth)&&apt.wallGrid[c.z+z*distance]?.[c.x+x*distance]===false)distance++;
      return {x,z,distance};
    }).sort((a,b)=>a.distance-b.distance);
    const {x:nx,z:nz}=walls[0];
    // Leave clearance for the 9 cm wall mouldings, including corner placements.
    root=new THREE.Matrix4().compose(new THREE.Vector3(c.x+.5,1,c.z+.5),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.atan2(-nx,-nz)),new THREE.Vector3(.80,1,.80));
    const [base,top]=c.levels;
    const legs=()=>{for(const x of [-.39,.39])for(const z of [-.39,.39])box(x,.12,z,.09,.24,.09,darkWood);};
    if(base===7&&!top) {
      legs();box(0,.47,0,.94,.60,.94,cloth);
      box(0,.88,-.37,.94,.24,.20,cloth);
      box(0,.795,.05,.86,.045,.67,cloth);
      box(0,.35,.475,.88,.035,.02,darkWood);
    } else if(base===8&&top===8) {
      legs();box(0,1.02,0,.97,1.92,.95,enamel);
      for(const [y,h]of [[.62,1.03],[1.56,.76]]) {
        box(0,y,.485,.89,h,.025,enamel);
        box(-.30,y+.18,.505,.035,.22,.035,metal);
      }
      box(0,1.17,.49,.90,.025,.02,darkWood);
    } else if(base===9||top===9) {
      const h=top===9?1.95:.96;
      box(0,h/2,-.46,.96,h,.065,darkWood);
      for(const x of [-.46,.46])box(x,h/2,0,.065,h,.96,wood);
      for(let y=.07;y<=h+.02;y+=.46) {
        box(0,y,0,.94,.045,.95,wood);
        if(y+.37>h)continue;
        for(let i=0;i<7;i++) {
          const bh=.25+((i+c.x+c.z)%3)*.035,x=-.36+i*.12;
          box(x,y+bh/2+.025,.10,.085,bh,.48,covers[i%3]);
          box(x,y+bh-.04,.347,.07,.015,.009,paper);
        }
      }
      box(0,h,0,.97,.05,.97,wood);
    } else {
      const h=top===4?1.98:.98;
      legs();box(0,(h+.19)/2,0,.94,h-.19,.94,wood);
      box(0,h,0,.98,.045,.98,wood);
      for(const x of [-.225,.225]) {
        box(x,(h+.21)/2,.474,.433,h-.27,.018,darkWood);
        box(x,(h+.21)/2,.486,.38,h-.33,.012,wood);
        box(x>0?.07:-.07,(h+.21)/2,.504,.035,.15,.028,metal);
      }
    }
    if(top===11) {
      add(new THREE.CylinderGeometry(.15,.18,.045,16),0,1.05,0,metal);
      box(0,1.35,0,.035,.57,.035,metal);
      add(new THREE.CylinderGeometry(.14,.32,.34,20,1,true),0,1.70,0,paper);
      add(new THREE.SphereGeometry(.065,10,8),0,1.61,0,enamel);
    } else if(top===10) {
      add(new THREE.CylinderGeometry(.22,.15,.32,16),0,1.16,0,terracotta);
      for(let i=0;i<9;i++) {
        const a=i*2.4, y=1.4+i*.052;
        box(Math.cos(a)*.08,y,Math.sin(a)*.08,.018,.50,.018,darkWood);
        const leaf=new THREE.SphereGeometry(1,8,6);leaf.scale(.19,.065,.10);
        add(leaf,Math.cos(a)*.18,y+.15,Math.sin(a)*.18,green,Math.sin(a)*.6);
      }
    }
  }
  for(const [material,geometries] of batches) {
    const mesh=new THREE.Mesh(mergeGeometries(geometries,false),material);
    mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);
    geometries.forEach(g=>g.dispose());
  }
  return group;
}
