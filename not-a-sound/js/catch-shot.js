import * as THREE from 'three';
import { createHunter, animateHunter, disposeGroup } from './hunter.js?v=resident-devices-v32';

export const CATCH_ACTION_MS=1550;
export const CATCH_MS=CATCH_ACTION_MS+650;
const smooth=(a,b,t)=>{const x=THREE.MathUtils.clamp((t-a)/(b-a),0,1);return x*x*(3-2*x);};
export function scaresEnabled() {
  return !!window.Platform.load('scares',!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
export class CatchShot {
  constructor(){this.active=false;}
  start(now,done) {
    this.finish(false); if(!scaresEnabled())return false;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x090c0b);
    this.camera=new THREE.PerspectiveCamera(55,1,.05,20);
    this.model=createHunter();this.scene.add(this.model);
    // Only this cinematic copy bends the sleeve; the walking model stays shared.
    const sleeve=this.model.getObjectByName('Left_sleeve');
    this.sleeveSource=sleeve.geometry; sleeve.geometry=sleeve.geometry.clone();
    sleeve.geometry.userData={...sleeve.geometry.userData,residentShared:false}; sleeve.frustumCulled=false;
    this.sleeve=sleeve;this.hand=this.model.getObjectByName('HandL');
    this.handRest=this.hand.position.clone();this.handRotation=this.hand.quaternion.clone();
    this.elbow=new THREE.Vector3(-.04,-.55,.04);this.bendRotation=new THREE.Quaternion();
    this.vertex=new THREE.Vector3();this.normal=new THREE.Vector3();
    this.scene.add(new THREE.AmbientLight(0x82968c,.5));
    const key=new THREE.SpotLight(0xe1c69a,15,8,Math.PI/3,.7,1.4);key.position.set(.9,2.45,2.5);key.target.position.set(0,1.95,.4);key.castShadow=true;key.shadow.mapSize.set(512,512);key.shadow.bias=-.001;key.shadow.normalBias=.015;this.scene.add(key,key.target);this.key=key;
    const rim=new THREE.DirectionalLight(0x566c7b,.9);rim.position.set(1.3,2.8,-1);this.scene.add(rim);
    // A doorway silhouette gives the approach depth instead of a floating portrait.
    this.set=new THREE.Group();this.scene.add(this.set);
    const wood=new THREE.MeshStandardMaterial({color:0x262922,roughness:1});
    for(const [x,y,z,w,h,d] of [[-.86,1.5,-.45,.18,3,.2],[.86,1.5,-.45,.18,3,.2],[0,2.93,-.45,1.9,.18,.2],[0,0,-.2,3,.04,3]]) {
      const part=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),wood);part.position.set(x,y,z);this.set.add(part);
    }
    this.veil=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:0,transparent:true,opacity:0,depthTest:false,depthWrite:false}));
    this.veil.position.z=-.1;this.veil.renderOrder=100;this.camera.add(this.veil);this.scene.add(this.camera);
    this.started=now;this.done=done;this.active=true;return true;
  }
  update(now,renderer,aspect) {
    if(!this.active)return false;
    const elapsed=Math.max(0,now-this.started);
    if(elapsed>=CATCH_MS){this.finish();return false;}
    const t=Math.min(1,elapsed/CATCH_ACTION_MS);
    const approach=smooth(.07,.19,t),snap=smooth(.09,.20,t),reach=smooth(.18,.31,t);
    const lift=smooth(.31,.52,t),contact=smooth(.28,.31,t);
    const impact=Math.sin(Math.max(0,t-.30)*55)*Math.exp(-Math.max(0,t-.30)*19)*(t>.30?1:0);
    this.camera.aspect=aspect;this.camera.updateProjectionMatrix();
    this.camera.position.set(.11-contact*.065+impact*.022,1.98+lift*.19+impact*.03,2.35-approach*.58-reach*.54);
    this.camera.lookAt(0,1.94-lift*.025,.62);this.camera.rotateZ(-lift*.07+impact*.025);
    animateHunter(this.model,now/1000,true,0,0,false);
    this.model.position.z=approach*.12+reach*.19;
    this.model.rotation.y=.12*(1-snap)-reach*.035;
    const u=this.model.userData;
    u.body.rotation.x=reach*.035;
    u.head.rotation.x=.52-snap*.83-lift*.08;
    u.head.rotation.y=-.10*(1-snap);u.head.rotation.z=-.055-snap*.08;
    // Upper arm remains below the shoulder. A flexed elbow brings the wrist to
    // the collar below the lens, instead of presenting an outstretched palm.
    u.arms[0].rotation.set(-reach*.65-lift*.22,-reach*.17,reach*.13);
    this.bendSleeve(reach*.95);
    // The other hand remains in its authored crooked pose against the abdomen.
    this.key.position.x=.9-contact*1.25;this.key.position.y=2.45-contact*.9;
    this.key.intensity=15-9*smooth(.48,.84,t);
    this.veil.material.opacity=smooth(.68,.86,t);
    renderer.render(this.scene,this.camera);return true;
  }
  bendSleeve(angle) {
    this.bendRotation.setFromAxisAngle(new THREE.Vector3(1,0,0),-angle);
    const source=this.sleeveSource.attributes,live=this.sleeve.geometry.attributes;
    for(let i=0;i<source.position.count;i++) {
      const w=THREE.MathUtils.smoothstep(-source.position.getY(i),.43,.69);
      this.vertex.fromBufferAttribute(source.position,i).sub(this.elbow).applyQuaternion(this.bendRotation).add(this.elbow);
      live.position.setXYZ(i,THREE.MathUtils.lerp(source.position.getX(i),this.vertex.x,w),
        THREE.MathUtils.lerp(source.position.getY(i),this.vertex.y,w),THREE.MathUtils.lerp(source.position.getZ(i),this.vertex.z,w));
      this.normal.fromBufferAttribute(source.normal,i).applyQuaternion(this.bendRotation).multiplyScalar(w);
      this.normal.x+=source.normal.getX(i)*(1-w);this.normal.y+=source.normal.getY(i)*(1-w);this.normal.z+=source.normal.getZ(i)*(1-w);
      this.normal.normalize();live.normal.setXYZ(i,this.normal.x,this.normal.y,this.normal.z);
    }
    live.position.needsUpdate=true;live.normal.needsUpdate=true;
    this.hand.position.copy(this.handRest).sub(this.elbow).applyQuaternion(this.bendRotation).add(this.elbow);
    this.hand.quaternion.copy(this.bendRotation).multiply(this.handRotation);
  }
  skip(now) {
    if(!this.active||now-this.started<CATCH_ACTION_MS)return false;
    this.finish();return true;
  }
  finish(complete=true) {
    if(!this.active)return;this.active=false;disposeGroup(this.model);disposeGroup(this.set);disposeGroup(this.veil);
    this.scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.dispose();});
    this.scene.clear();
    const done=this.done;this.done=null;if(complete)done?.();
  }
}
