import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roomMaterial } from './room-materials.js?v=resident-devices-v32';

// Real geometry at metre scale. Pieces sharing a finish are baked into one mesh.
function workshop() {
  const pieces = new THREE.Group();
  const add = (geometry,material,x=0,y=0,z=0) => {
    const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);pieces.add(mesh);return mesh;
  };
  const cylinder=(r,h,y,mat)=>add(new THREE.CylinderGeometry(r,r,h,32),mat,0,y);
  const ring=(r,t,y,mat)=>{const m=add(new THREE.TorusGeometry(r,t,6,32),mat,0,y);m.rotation.x=Math.PI/2;return m;};
  const lathe=(profile,mat)=>add(new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),40),mat);
  function finish(name) {
    pieces.updateMatrixWorld(true);const batches=new Map();
    for(const m of pieces.children){m.geometry.applyMatrix4(m.matrixWorld);if(!batches.has(m.material))batches.set(m.material,[]);batches.get(m.material).push(m.geometry);}
    const result=new THREE.Group();result.name=name;
    for(const [material,parts] of batches){
      const geometry=mergeGeometries(parts,false);parts.forEach(p=>p.dispose());
      const m=new THREE.Mesh(geometry,material);m.castShadow=m.receiveShadow=true;result.add(m);
    }
    return result;
  }
  return {add,cylinder,ring,lathe,finish};
}

function metal(color,roughness=.38) {
  const m=roomMaterial('metal',color);m.roughness=roughness;m.metalness=.65;m.bumpScale=.00035;return m;
}
function finish(color,roughness=.75,metalness=.05) {return new THREE.MeshStandardMaterial({color,roughness,metalness});}
function wear(w,r,y0,length,count,mat) {
  // Sparse chips in the finish, with a fixed pattern instead of per-frame noise.
  for(let i=0;i<count;i++){
    const angle=i*2.399963, y=y0+((i*37)%count)/count*length;
    const m=w.add(new THREE.BoxGeometry(.0012,.006+(i%4)*.003,.0005),mat,Math.sin(angle)*r,y,Math.cos(angle)*r);
    m.rotation.y=angle;m.rotation.z=(i%3-1)*.18;
  }
}

export function createFlashlight() {
  const w=workshop(),paint=metal(0x555c47,.66),steel=metal(0xabb0a8,.27),edge=metal(0x77756a,.46);
  const rubber=finish(0x171c19,.91),black=finish(0x0c100e,.8),brass=metal(0xa58b50,.34);
  const reflector=finish(0xcbd0c5,.19,.82);reflector.side=THREE.DoubleSide;
  const emitter=finish(0xe5d5a4,.3);emitter.emissive.set(0xffd19a);
  const indicator=finish(0x829065,.35);indicator.emissive.set(0xbacd77);
  w.lathe([[0,-.231],[.040,-.231],[.047,-.224],[.049,-.212],[.049,.035],[.054,.055],[.061,.071],[.081,.122],[.087,.146],[.087,.193],[.082,.205],[.076,.205],[.076,.183]],paint);
  w.cylinder(.050,.12,-.105,rubber);
  for(let i=0;i<11;i++)w.ring(.050,.0028,-.157+i*.0103,rubber);
  w.ring(.048,.0038,-.224,edge);w.ring(.05,.003,-.205,steel);
  for(const y of [.076,.093,.11])w.ring(.062+(y-.076)*.48,.0024,y,edge);
  w.ring(.084,.0037,.198,steel);w.ring(.079,.0023,.202,black);
  w.lathe([[.010,.151],[.018,.154],[.032,.163],[.052,.179],[.075,.198]],reflector);
  w.cylinder(.016,.005,.156,brass);w.cylinder(.009,.003,.160,emitter);
  // Recessed switch plate on the top side once the torch is laid along -Z.
  w.add(new THREE.BoxGeometry(.029,.068,.006),edge,0,-.003,.050);
  w.add(new THREE.BoxGeometry(.021,.034,.005),rubber,0,.006,.055);
  for(let i=0;i<4;i++)w.add(new THREE.BoxGeometry(.022,.002,.002),black,0,-.004+i*.007,.058);
  w.add(new THREE.SphereGeometry(.0035,10,6),indicator,0,.027,.055);
  for(const y of [-.027,.025])w.add(new THREE.SphereGeometry(.0028,8,6),steel,.010,y,.055);
  // Metal pocket clip and a folded fabric wrist loop at the tail.
  w.add(new THREE.BoxGeometry(.009,.121,.003),edge,.048,-.105,0);
  w.add(new THREE.BoxGeometry(.016,.014,.009),steel,.044,-.04,0);
  const loop=w.add(new THREE.TorusGeometry(.024,.003,6,18,Math.PI*1.75),rubber,0,-.259,0);loop.scale.y=1.6;
  wear(w,.0495,-.205,.25,22,edge);wear(w,.0873,.147,.042,14,edge);
  const g=w.finish('household-flashlight');g.rotation.x=-Math.PI/2;
  const model=new THREE.Group();model.name='flashlight';model.add(g);
  // A thin glass surface preserves the depth of the reflector behind it.
  const glass=new THREE.Mesh(new THREE.CircleGeometry(.076,40),new THREE.MeshStandardMaterial({
    color:0xabc6ca,metalness:.15,roughness:.12,transparent:true,opacity:.14,depthWrite:false,side:THREE.DoubleSide}));
  glass.position.z=-.201;model.add(glass);
  model.userData.emitter=emitter;model.userData.indicator=indicator;
  setFlashlightPower(model,1);return model;
}

export function setFlashlightPower(model,power) {
  model.userData.emitter.emissiveIntensity=power*2.2;
  model.userData.indicator.emissiveIntensity=power*.55;
}

export function createBattery() {
  const w=workshop(),steel=metal(0xb3b6b0,.36),rim=metal(0x8a8d82,.44);
  const sleeve=finish(0xb58b40,.52,.24),label=finish(0x253d38,.72,.04),ink=finish(0xd8cda7,.83),insulator=finish(0x161c19,.9);
  // The label is subtly readable in darkness; the body itself is not a glowing blob.
  label.emissive.set(0x2b2912);label.emissiveIntensity=.18;
  w.lathe([[0,-.181],[.091,-.181],[.103,-.171],[.106,-.16],[.106,.16],[.101,.175],[.087,.18],[0,.18]],sleeve);
  const wrap=w.add(new THREE.CylinderGeometry(.1065,.1065,.19,40,1,true),label);
  w.ring(.102,.005,-.168,rim);w.ring(.100,.005,.172,steel);
  w.cylinder(.092,.009,-.18,steel);w.cylinder(.077,.005,.180,insulator);
  w.cylinder(.060,.006,.185,steel);w.cylinder(.035,.022,.198,steel);w.ring(.035,.003,.207,rim);
  // Raised polarity marks and label bars remain legible from a close angle.
  w.add(new THREE.BoxGeometry(.038,.007,.0017),ink,0,.126,.106);
  w.add(new THREE.BoxGeometry(.007,.038,.0017),ink,0,.126,.106);
  w.add(new THREE.BoxGeometry(.034,.007,.0017),ink,0,-.128,.106);
  for(let i=0;i<3;i++)w.add(new THREE.BoxGeometry(.045,.012,.0017),ink,0,-.036+i*.024,.107);
  wear(w,.1068,.10,.05,10,rim);wear(w,.1068,-.16,.04,8,rim);
  const g=w.finish('battery-cell');g.userData.radius=.112;return g;
}
