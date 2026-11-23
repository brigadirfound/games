import * as THREE from 'three';

// Small deterministic textures; the courtyard has no additional network assets.
function random(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function texture(kind){
  const c=document.createElement('canvas');c.width=c.height=256;
  const g=c.getContext('2d'),r=random(kind==='bark'?71:kind==='grass'?93:117);
  g.fillStyle=kind==='bark'?'#655b49':kind==='grass'?'#596144':'#a8a393';g.fillRect(0,0,256,256);
  if(kind==='grass'){
    // Broad patches remain legible at a grazing angle; fine blades alone mip away.
    for(let i=0;i<280;i++){
      const x=r()*256,y=r()*256,rx=4+r()*23,ry=3+r()*15;
      g.fillStyle=['#6c7750','#73764f','#424f32','#8b865b','#58633e'][Math.floor(r()*5)];
      g.globalAlpha=.16+r()*.17;
      for(const dx of [-256,0,256])for(const dy of [-256,0,256]){
        g.beginPath();g.ellipse(x+dx,y+dy,rx,ry,r()*Math.PI,0,Math.PI*2);g.fill();
      }
    }
    g.globalAlpha=1;
  }
  for(let i=0;i<6500;i++){
    const x=r()*256,y=r()*256,v=Math.floor(35+r()*100);
    g.fillStyle=`rgba(${v+25},${v+22},${v},${.08+r()*.25})`;
    if(kind==='bark')g.fillRect(x,y,.5+r()*2,3+r()*38);
    else if(kind==='grass'){
      g.strokeStyle=g.fillStyle;g.beginPath();g.moveTo(x,y);g.lineTo(x-3+r()*6,y-2-r()*8);g.stroke();
    }else g.fillRect(x,y,.5+r()*2,.5+r()*2);
  }
  if(kind==='stone'){
    g.strokeStyle='#666659';g.lineWidth=2;
    for(let y=0;y<=256;y+=64){g.beginPath();g.moveTo(0,y);g.lineTo(256,y);g.stroke();
      for(let x=(y%128?32:0);x<256;x+=64){g.beginPath();g.moveTo(x,y);g.lineTo(x,y+64);g.stroke();}}
    g.strokeStyle='#d0c7b1';g.lineWidth=1;
    for(let y=2;y<256;y+=64){g.beginPath();g.moveTo(0,y);g.lineTo(256,y);g.stroke();}
  }
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;return map;
}
function surface(kind,scale,bumpScale){
  const map=texture(kind),bump=map.clone();bump.colorSpace=THREE.NoColorSpace;bump.needsUpdate=true;
  const material=new THREE.MeshStandardMaterial({map,bumpMap:bump,bumpScale,roughness:1});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      vec3 p=position;
      #ifdef USE_INSTANCING
        p=(instanceMatrix*vec4(position,1.)).xyz;
      #endif
      vec3 n=abs(normal);
      vec2 texUv=n.y>.7?p.xz:(n.x>.7?p.zy:p.xy);
      vMapUv=texUv*${scale.toFixed(3)};
      vBumpMapUv=vMapUv;`);
  };
  material.customProgramCacheKey=()=>`courtyard-${kind}-${scale}`;
  return material;
}
function foliageTexture(){
  const c=document.createElement('canvas');c.width=c.height=128;
  const g=c.getContext('2d'),r=random(154);
  // A twig with separate leaves and transparent gaps, rather than an opaque blob.
  g.strokeStyle='#645637';g.lineWidth=2;g.beginPath();g.moveTo(62,120);g.lineTo(69,10);g.stroke();
  for(let i=0;i<10;i++){
    const side=i%2?-1:1,y=20+i*9;
    g.save();g.translate(65+side*16,y);g.rotate(side*.6);
    g.fillStyle=['#79904b','#526d36','#9ba65c'][Math.floor(r()*3)];
    g.beginPath();g.ellipse(0,0,10+r()*3,19,0,0,Math.PI*2);g.fill();
    g.strokeStyle='#bdba79';g.lineWidth=.7;g.beginPath();g.moveTo(0,-15);g.lineTo(0,15);g.stroke();g.restore();
  }
  const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;return map;
}
export function buildCourtyard(parent){
  const stone=surface('stone',.65,.025),grass=surface('grass',.34,.07),bark=surface('bark',1.2,.035);
  const wood=surface('bark',.65,.014),wall=surface('plaster',1.4,.028);
  wall.color.set(0xd3c6ad);
  const box=(x,y,z,w,h,d,mat)=>{
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);
    m.castShadow=m.receiveShadow=true;parent.add(m);return m;
  };
  // Ground extends beneath the distant facades and beyond the camera horizon.
  box(34,-.16,3.35,64,.28,76,grass);
  box(29,-.005,3.35,52,.03,2.1,stone);
  for(const z of [2.2,4.5])box(29,.055,z,52,.11,.15,stone);
  // Entrance surround, paved apron and sheltered threshold join house to yard.
  for(const [z,d] of [[-1.1,6.4],[7.8,6.6]])box(4.12,2,z,.22,4,d,wall);
  box(4.12,3.62,3.35,.25,.76,2.5,wall);
  box(4.85,3.48,3.35,1.65,.14,2.8,stone);
  box(5.05,.025,3.35,2.2,.08,3.3,stone);
  for(const z of [1.7,5])box(5.2,.15,z,2.3,.3,.18,stone);
  // Slatted, slightly weathered bench; legs and back braces leave daylight through.
  const iron=new THREE.MeshStandardMaterial({color:0x393d35,roughness:.8,metalness:.5});
  for(let i=0;i<4;i++)box(12,.57,6+i*.16,2.5,.085,.13,wood);
  for(let i=0;i<3;i++)box(12,.84+i*.18,6.52,2.5,.13,.07,wood);
  for(const x of [11.1,12.9]){box(x,.28,6.23,.07,.56,.5,iron);box(x,.86,6.56,.06,.95,.06,iron);}
  for(const z of [-5,11.5])box(28,.65,z,1,1.3,12,stone);
  // Low planting beds and a second bench keep the lawn from reading as an empty plane.
  for(const z of [-3,9]){
    box(18,.13,z,4,.26,.16,stone);
    for(const x of [16,20])box(x,.13,z+(z<0?-.7:.7),.16,.26,1.55,stone);
  }
  for(let i=0;i<4;i++)box(19,.57,-1.7+i*.16,2.5,.085,.13,wood);
  for(let i=0;i<3;i++)box(19,.84+i*.18,-1.75,2.5,.13,.07,wood);
  for(const x of [18.1,19.9])box(x,.28,-1.45,.07,.56,.5,iron);
  const leafMat=new THREE.MeshStandardMaterial({map:foliageTexture(),alphaTest:.45,side:THREE.DoubleSide,
    roughness:.92,emissive:0x57622c,emissiveIntensity:.10});
  const trees=[
    [9,-1.6,5.5],[15,8.5,6.2],[23,-4.5,6.8],[27,11,6.4],
    // The last four trees sit behind the service buildings. Their crowns close
    // the low gaps while the sky remains visible above them.
    [48,-8.2,7.1],[52,-12.5,6.6],[49,13.8,7.3],[53,17.2,6.7]
  ];
  const branches=[],leaves=[],r=random(729),up=new THREE.Vector3(0,1,0);
  const segment=(a,b,width,taper=.7)=>{
    const v=new THREE.Vector3().subVectors(b,a),o=new THREE.Object3D();o.position.copy(a).addScaledVector(v,.5);
    o.quaternion.setFromUnitVectors(up,v.clone().normalize());o.scale.set(width,v.length(),width*taper);o.updateMatrix();branches.push(o.matrix.clone());
  };
  for(const [x,z,h] of trees){
    const base=new THREE.Vector3(x,0,z),top=new THREE.Vector3(x+.25,h,z-.12);
    segment(base,top,.20);
    for(let j=0;j<20;j++){
      const a=j*2.399+.3*r(),f=j/20,reach=(1.1+Math.sin(f*Math.PI)*1.35)*( .85+r()*.25);
      const origin=new THREE.Vector3(x+.2*f,1.8+f*(h-2),z);
      const end=new THREE.Vector3(x+Math.cos(a)*reach,origin.y+.55+r()*.8,z+Math.sin(a)*reach);
      segment(origin,end,.055*(1-f*.6));
      for(let k=0;k<34;k++){
        const o=new THREE.Object3D(),theta=r()*Math.PI*2,radius=Math.sqrt(r())*.92;
        o.position.copy(end).add(new THREE.Vector3(Math.cos(theta)*radius,(r()-.4)*1.3,Math.sin(theta)*radius));
        o.rotation.set(r()*2.4,r()*Math.PI*2,r()*1.5);
        o.scale.setScalar(.48+r()*.44);o.updateMatrix();leaves.push(o.matrix.clone());
      }
    }
    // Visible roots and a soil ring anchor each trunk to the lawn.
    for(let j=0;j<5;j++){const a=j*1.26;segment(new THREE.Vector3(x,.15,z),new THREE.Vector3(x+Math.cos(a)*.6,.025,z+Math.sin(a)*.6),.09);}
  }
  const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.68,1,1,7),bark,branches.length);
  branches.forEach((m,i)=>trunks.setMatrixAt(i,m));trunks.castShadow=trunks.receiveShadow=true;parent.add(trunks);
  const canopy=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),leafMat,leaves.length);
  leaves.forEach((m,i)=>{canopy.setMatrixAt(i,m);canopy.setColorAt(i,new THREE.Color().setHSL(.19+r()*.035,.22+r()*.15,.63+r()*.25));});
  canopy.castShadow=canopy.receiveShadow=true;parent.add(canopy);
  // Low grass tufts break up the lawn edge, without adding one draw per blade.
  const tuftGeo=new THREE.ConeGeometry(.018,.18,3),tufts=new THREE.InstancedMesh(tuftGeo,grass,2100);
  let patchX=0,patchZ=0;
  for(let i=0;i<2100;i++){
    if(i%7===0){patchX=4+r()*33;patchZ=i%2?4.65+r()*12:1.98-r()*12;}
    const o=new THREE.Object3D();o.position.set(patchX+(r()-.5)*.42,.055,patchZ+(r()-.5)*.3);
    o.rotation.set((r()-.5)*.5,r()*Math.PI,(r()-.5)*.7);o.scale.set(.6+r(),.4+r()*.8,.6+r());o.updateMatrix();tufts.setMatrixAt(i,o.matrix);
    tufts.setColorAt(i,new THREE.Color().setHSL(.18+r()*.04,.22+r()*.14,.55+r()*.2));
  }
  tufts.receiveShadow=true;parent.add(tufts);
  return {box,stone,wall,dispose(){
    const maps=new Set();for(const m of [stone,grass,bark,wood,wall,leafMat])for(const t of [m.map,m.bumpMap])if(t)maps.add(t);
    maps.forEach(t=>t.dispose());
  }};
}
