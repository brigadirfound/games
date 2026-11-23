import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let template=null;
export async function prepareHunter(bytes) {
  const loader=new GLTFLoader();
  const gltf=bytes?await loader.parseAsync(bytes,''):await loader.loadAsync(
    new URL('../assets/models/resident-human.glb?v=resident-devices-v32',import.meta.url).href);
  for(const name of ['Body','Head','ArmL','ArmR','LegL','LegR','KneeL','KneeR','FootL','FootR','TrouserClothL','TrouserClothR'])
    if(!gltf.scene.getObjectByName(name))throw new Error('Resident model is missing '+name);
  gltf.scene.traverse(o=>{
    if(!o.isMesh)return;
    o.castShadow=true;o.receiveShadow=true;
    o.geometry.userData.residentShared=true;
    const materials=Array.isArray(o.material)?o.material:[o.material];
    for(const m of materials){m.userData.residentShared=true;m.roughness=1;m.metalness=0;}
  });
  template=gltf.scene;
}
export function createHunter() {
  if(!template)throw new Error('Resident model has not loaded');
  const root=template.clone(true);
  const part=name=>root.getObjectByName(name);
  // Pull the bent sleeve clear of the cardigan. Its elbow used to merge into
  // the torso in rear/side views, leaving a detached-looking hand at the cuff.
  const sleeve=part('Right_sleeve')||part('Right sleeve');
  if(sleeve?.isMesh){
    sleeve.geometry=sleeve.geometry.clone();sleeve.geometry.userData={...sleeve.geometry.userData,residentShared:false};
    const p=sleeve.geometry.attributes.position;
    for(let i=0;i<p.count;i++){
      const y=p.getY(i),forearm=THREE.MathUtils.smoothstep(-y,.28,.46);
      p.setXYZ(i,p.getX(i)+.055*(1-forearm),y,p.getZ(i)+.075*forearm);
    }
    p.needsUpdate=true;sleeve.geometry.computeVertexNormals();sleeve.geometry.computeBoundingBox();sleeve.geometry.computeBoundingSphere();
    part('HandR').position.z+=.015; // meet the cuff; the original wrist was 6 cm ahead of it
  }
  root.userData={body:part('Body'),head:part('Head'),arms:[part('ArmL'),part('ArmR')],
    legs:[part('LegL'),part('LegR')],knees:[part('KneeL'),part('KneeR')],
    feet:[part('FootL'),part('FootR')],attention:0,phase:0,weight:0,paceRate:0,lastTime:null};
  root.userData.cloth=['L','R'].map(side=>{
    const cloth=part('TrouserCloth'+side),source=cloth.geometry;
    // Only the small leg surfaces deform; face, hands and atlas remain shared.
    cloth.geometry=source.clone();cloth.geometry.userData={...cloth.geometry.userData,residentShared:false};
    cloth.frustumCulled=false;
    const weights=new Float32Array(source.attributes.position.count);
    for(let i=0;i<weights.length;i++)weights[i]=THREE.MathUtils.smoothstep(-source.attributes.position.getY(i),.32,.59);
    return {geometry:cloth.geometry,source,weights};
  });
  root.name='former-resident';
  return root;
}

const down=new THREE.Vector3(0,-1,0),forward=new THREE.Vector3(0,0,1);
const target=new THREE.Vector3(),direction=new THREE.Vector3(),bend=new THREE.Vector3(),joint=new THREE.Vector3();
const inverseBody=new THREE.Quaternion(),hipRotation=new THREE.Quaternion(),kneeRotation=new THREE.Quaternion();
const neutral=new THREE.Quaternion();
const clothVertex=new THREE.Vector3(),clothNormal=new THREE.Vector3();

function bendCloth(u,i) {
  const {geometry,source,weights}=u.cloth[i],knee=u.knees[i];
  const positions=geometry.attributes.position,normals=geometry.attributes.normal;
  const rest=source.attributes.position,restNormals=source.attributes.normal;
  for(let v=0;v<weights.length;v++) {
    const w=weights[v];
    clothVertex.fromBufferAttribute(rest,v).sub(knee.position).applyQuaternion(knee.quaternion).add(knee.position);
    positions.setXYZ(v,THREE.MathUtils.lerp(rest.getX(v),clothVertex.x,w),
      THREE.MathUtils.lerp(rest.getY(v),clothVertex.y,w),THREE.MathUtils.lerp(rest.getZ(v),clothVertex.z,w));
    clothNormal.fromBufferAttribute(restNormals,v).applyQuaternion(knee.quaternion).multiplyScalar(w);
    clothNormal.x+=restNormals.getX(v)*(1-w);clothNormal.y+=restNormals.getY(v)*(1-w);clothNormal.z+=restNormals.getZ(v)*(1-w);
    clothNormal.normalize();normals.setXYZ(v,clothNormal.x,clothNormal.y,clothNormal.z);
  }
  positions.needsUpdate=true;normals.needsUpdate=true;
}

// Two rigid cloth joints; targets keep the supporting slipper level with the floor.
function placeFoot(u,i,z,lift,roll) {
  const leg=u.legs[i],knee=u.knees[i],foot=u.feet[i];
  inverseBody.copy(u.body.quaternion).invert();
  target.set(leg.position.x,.045+lift,leg.position.z+z).sub(u.body.position)
    .applyQuaternion(inverseBody).sub(leg.position);
  const length=THREE.MathUtils.clamp(target.length(),.1,.939);
  direction.copy(target).normalize();
  bend.copy(forward).addScaledVector(direction,-forward.dot(direction)).normalize();
  const along=(.46*.46-.48*.48+length*length)/(2*length);
  joint.copy(direction).multiplyScalar(along).addScaledVector(bend,Math.sqrt(Math.max(0,.46*.46-along*along)));
  hipRotation.setFromUnitVectors(down,clothVertex.copy(joint).normalize());
  direction.copy(target).sub(joint).normalize().applyQuaternion(kneeRotation.copy(hipRotation).invert());
  kneeRotation.setFromUnitVectors(down,direction);
  leg.quaternion.copy(neutral).slerp(hipRotation,u.weight);
  knee.quaternion.copy(neutral).slerp(kneeRotation,u.weight);
  foot.quaternion.copy(u.body.quaternion).multiply(leg.quaternion).multiply(knee.quaternion).invert();
  foot.rotateX(roll*u.weight);
  bendCloth(u,i);
}

export function animateHunter(mesh,time,chasing,lightLevel=0,headYaw=0,moving=true,travel) {
  const u=mesh.userData;if(!u.body)return;
  const dt=u.lastTime===null?0:THREE.MathUtils.clamp(time-u.lastTime,0,.1);u.lastTime=time;
  const distance=travel===undefined?(moving?dt*(chasing?1.8:.68):0):THREE.MathUtils.clamp(travel,0,.5);
  u.weight=THREE.MathUtils.damp(u.weight,moving?1:0,9,dt);
  // Navigation can move much faster than the gallery treadmill. Bound cadence
  // independently so a fast pursuer does not cycle his legs five times a second.
  const targetRate=dt>0?Math.min(distance/1.28/dt,chasing?1.20:.85):0;
  u.paceRate=THREE.MathUtils.damp(u.paceRate,targetRate,8,dt);
  const previousPhase=u.phase;
  u.phase=(u.phase+u.paceRate*dt)%1;
  u.footstep=moving&&u.weight>.5&&(u.phase<previousPhase||(previousPhase<.5&&u.phase>=.5));
  const pace=u.phase*Math.PI*2,w=u.weight;
  u.body.rotation.set(0,Math.sin(pace-.3)*.025*w,-.02+Math.sin(pace)*.018*w);
  u.body.position.set(Math.sin(pace)*.018*w,-(.125+.014*Math.sin(pace*2))*w+Math.sin(time*.9)*.003*(1-w),0);
  for(let i=0;i<2;i++) {
    const p=(u.phase+i*.5)%1,stance=i?.68:.60,amplitude=1.28*stance/2;
    const swing=Math.max(0,(p-stance)/(1-stance));
    const z=p<stance?amplitude-1.28*p:-amplitude+2*amplitude*(swing*swing*(3-2*swing));
    placeFoot(u,i,z*w,Math.sin(swing*Math.PI)*(i?.018:.09)*w,Math.sin(swing*Math.PI)*(i?.025:.12));
  }
  // Free arm follows the weight shift late; the crooked arm stays across the abdomen.
  u.arms[0].rotation.set(-.02+Math.sin(pace-.65)*.11*w,0,Math.sin(pace-.9)*.025*w);
  u.arms[1].rotation.set(Math.sin(pace-.3)*.018*w,0,0);
  // He raises a real face into the beam. No emissive eyes or flashing materials.
  const attention=Math.max(0,Math.min(1,lightLevel));
  u.head.rotation.x=.52-attention*.48+(1-attention)*Math.sin(time*.53)*.025;
  u.head.rotation.z=-.055+Math.sin(time*.4)*.018+Math.sin(pace-.9)*.015*w;
  u.head.rotation.y=Math.sin(time*.45)*.085*(1-attention)+headYaw*attention;
}

export function disposeGroup(group) {
  if(!group)return;
  const geometries=new Set(),materials=new Set();
  group.traverse(o=>{
    if(o.geometry&&!o.geometry.userData.residentShared)geometries.add(o.geometry);
    for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])
      if(!m.userData.residentShared)materials.add(m);
  });
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  group.removeFromParent();
}
