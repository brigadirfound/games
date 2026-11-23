import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { clone } from '../vendor/SkeletonUtils.js';

let asset;
const appearanceCache = new Map();
const tint = new THREE.Color();
function dressedGeometry(source, opts) {
  const key = `${opts.shirt || 0x617284}|${opts.pants || 0x303541}`;
  if (appearanceCache.has(key)) return appearanceCache.get(key);
  const geometry = source.clone(), positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  // Compensate the source olive albedo while keeping its folds and fabric detail.
  const shirt = new THREE.Color(opts.shirt ?? 0x617284).multiplyScalar(4.5).addScalar(.20);
  const pants = new THREE.Color(opts.pants ?? 0x303541).multiplyScalar(3).addScalar(.28);
  for (let i=0;i<positions.count;i++) {
    const x=Math.abs(positions.getX(i)), y=positions.getY(i);
    // Bind pose is a T pose. Preserve face, hands and exposed forearms.
    tint.setRGB(1,1,1);
    if(y>1.02&&y<1.49&&x<.43) tint.copy(shirt);
    else if(y>.13&&y<1.01&&x<.32) tint.copy(pants);
    colors.set([tint.r,tint.g,tint.b],i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  appearanceCache.set(key,geometry);return geometry;
}
export async function preloadHero() {
  asset = await new GLTFLoader().loadAsync('./assets/models/characters/vincent.glb');
}

// The existing gameplay rig remains the source for combat and vehicle poses.
// Bone rest orientations are measured from the imported bind pose, never assumed
// to match the engine's Euler axes. Locomotion uses authored, blended skin clips.
export function attachHero(character, opts = { hero:true }) {
  if (!asset) return null;
  const root = clone(asset.scene);
  root.name = opts.hero ? 'HeroSkinnedModel' : 'CitizenSkinnedModel';
  root.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    o.frustumCulled = false; // Animation can move vertices beyond bind bounds.
    o.material = o.material.clone();
    o.material.roughness = .88;
    if(!opts.hero&&!opts.animationProxy){o.geometry=dressedGeometry(o.geometry,opts);o.material.vertexColors=true;}
    if (o.material.map) o.material.map.anisotropy = 4;
    if (o.isSkinnedMesh) o.skeleton.pose();
  });
  root.updateMatrixWorld(true);
  const bones = Object.fromEntries(root.getObjectsByProperty('isBone', true).map(b => [b.name,b]));
  const bind = new Map();
  for(const bone of Object.values(bones)) bind.set(bone, {
    position:bone.position.clone(), quaternion:bone.quaternion.clone(),
    world:bone.getWorldQuaternion(new THREE.Quaternion()),
  });
  // Match the established character height without stretching its proportions.
  root.scale.setScalar(1.08);
  character.mesh.traverse(o => { if(o.isMesh) o.visible = false; });
  character.mesh.add(root);
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for(const original of asset.animations) {
    if(!['idle','walk','run','idleJump','runJump'].includes(original.name)) continue;
    const clip=original.clone();
    // Physics owns translation. Keep the vertical pelvis motion from the clip.
    for(const track of clip.tracks) if(track.name==='hip.position') {
      for(let i=0;i<track.values.length;i+=3) {
        track.values[i]=bind.get(bones.hip).position.x;
        track.values[i+2]=bind.get(bones.hip).position.z;
        if(/Jump/.test(clip.name)) track.values[i+1]=bind.get(bones.hip).position.y;
      }
    }
    actions[clip.name]=mixer.clipAction(clip).play();
    actions[clip.name].setEffectiveWeight(clip.name==='idle'?1:0);
    if(/Jump/.test(clip.name)){actions[clip.name].paused=true;actions[clip.name].setLoop(THREE.LoopOnce,1);actions[clip.name].clampWhenFinished=true;}
  }
  const a=character.arms,l=character.legs;
  const mappings=[['hip',character.hips],['chest',character.chest],['head',character.headPivot],
    ['rShldr',a[0].shoulder,Math.PI/2],['rForeArm',a[0].elbow,Math.PI/2],['rHand',a[0].hand,Math.PI/2],
    ['lShldr',a[1].shoulder,-Math.PI/2],['lForeArm',a[1].elbow,-Math.PI/2],['lHand',a[1].hand,-Math.PI/2],
    ['rThigh',l[0].hip],['rShin',l[0].knee],['rFoot',l[0].foot],
    ['lThigh',l[1].hip],['lShin',l[1].knee],['lFoot',l[1].foot]];
  const q=new THREE.Quaternion(), parentQ=new THREE.Quaternion();
  const zAxis=new THREE.Vector3(0,0,1);
  const corrections=mappings.map(([name,,turn=0])=>new THREE.Quaternion().setFromAxisAngle(zAxis,turn).multiply(bind.get(bones[name]).world));
  const socket=new THREE.Group();socket.name='HeroWeaponSocket';bones.rHand.add(socket);
  socket.quaternion.copy(corrections[4].clone().invert());
  const weights={idle:1,walk:0,run:0};
  const frameQuats=new Map();
  for(const bone of Object.values(bones))frameQuats.set(bone,new THREE.Quaternion());
  const aimPoint = new THREE.Vector3(), elbowPoint = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3(), origin = new THREE.Vector3();
  function pointBone(bone,child,target){
    bone.getWorldPosition(origin);child.getWorldPosition(from).sub(origin).normalize();
    to.copy(target).sub(origin).normalize();
    q.setFromUnitVectors(from,to);
    bone.getWorldQuaternion(parentQ);q.multiply(parentQ);
    bone.parent.getWorldQuaternion(parentQ).invert();
    bone.quaternion.copy(parentQ.multiply(q));bone.updateMatrixWorld(true);
  }
  function aimArm(side, wrist, pole, pitch) {
    const upper=bones[side+'Shldr'],fore=bones[side+'ForeArm'],hand=bones[side+'Hand'];
    root.localToWorld(aimPoint.copy(wrist));
    const start=upper.getWorldPosition(new THREE.Vector3());
    const lengthA=upper.getWorldPosition(new THREE.Vector3()).distanceTo(fore.getWorldPosition(new THREE.Vector3()));
    const lengthB=fore.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3()));
    const axis=aimPoint.clone().sub(start), d=Math.min(axis.length(),lengthA+lengthB-.006);
    axis.normalize();aimPoint.copy(start).addScaledVector(axis,d);
    const along=(lengthA*lengthA-lengthB*lengthB+d*d)/(2*d);
    const bend=root.localToWorld(pole.clone()).sub(start);
    bend.addScaledVector(axis,-bend.dot(axis)).normalize();
    elbowPoint.copy(start).addScaledVector(axis,along).addScaledVector(bend,Math.sqrt(Math.max(0,lengthA*lengthA-along*along)));
    pointBone(upper,fore,elbowPoint);pointBone(fore,hand,aimPoint);
    // Keep the wrist aligned with the barrel instead of inheriting forearm twist.
    character.mesh.getWorldQuaternion(q);
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2-pitch,0,0)))
      .multiply(corrections[side==='r'?4:7]);
    hand.parent.getWorldQuaternion(parentQ).invert();hand.quaternion.copy(parentQ.multiply(q));
    hand.updateMatrixWorld(true);
  }
  // Phase comes from physics, so long falls hold the airborne pose and landing
  // cannot run early just because a fixed-duration clip finished.
  let overlay=0, jumpWeight=0, jumping=false, jumpClip='idleJump', jumpPhase=0;
  const api={root,bones,bind,mixer,actions,socket,
    weaponHandDelta: corrections[4].clone().invert().multiply(corrections[7]), update(dt,game){
    api.restoreWeaponPose?.();
    const speed=Math.abs(opts.motionState?.speed ?? character.speed);
    const run=THREE.MathUtils.smoothstep(speed,4.3,6.4);
    const walk=THREE.MathUtils.smoothstep(speed,.1,1.2)*(1-run);
    const blend=1-Math.exp(-12*dt);
    if(character.airborne&&!jumping){jumpClip=speed>2?'runJump':'idleJump';jumpPhase=0;}
    jumping=!!character.airborne;
    const landing=!jumping&&(character.landT||0)>0;
    const jumpTarget=(jumping||landing)&&!character.dead&&!character.inVehicle?1:0;
    jumpWeight=THREE.MathUtils.lerp(jumpWeight,jumpTarget,1-Math.exp(-30*dt));
    if(jumping) jumpPhase=THREE.MathUtils.clamp((6.2-(character.jumpVy||0))/12.4,0,1)*.72;
    else if(landing)jumpPhase=.72+(1-character.landT/.32)*.28;
    for(const name of ['idleJump','runJump']){
      actions[name].enabled=true;
      actions[name].time=jumpPhase*actions[name].getClip().duration;
      actions[name].setEffectiveWeight(name===jumpClip?jumpWeight:0);
    }
    for(const name of ['idle','walk','run']){
      const target=name==='run'?run:name==='walk'?walk:1-walk-run;
      weights[name]=THREE.MathUtils.lerp(weights[name],target,blend);
      actions[name].setEffectiveWeight(weights[name]*(1-jumpWeight));
    }
    actions.walk.timeScale=THREE.MathUtils.clamp(speed/2.1,.65,1.6);
    actions.run.timeScale=THREE.MathUtils.clamp(speed/5.6,.8,1.35);
    if(opts.animationProxy){
      const strideScale=opts.motionState?.strideScale || 1;
      actions.walk.timeScale=THREE.MathUtils.clamp(speed/(2.1*strideScale),0,2.2);
      actions.run.timeScale=THREE.MathUtils.clamp(speed/(5.6*strideScale),0,1.8);
    }
    mixer.update(dt);
    const special=character.dead||character.inVehicle||(opts.hero&&game?.mount)||character.aiming
      ||character.crouch>.01||character.reloadT>0||character.punchT>0||character.kickT>0
      ||character.staggerT>0||character.handsUpT>0||character.cheerT>0
      ||(opts.animationProxy&&(character.idleAnim>0||character.hurtT>0||character.exhausted>.05));
    overlay=THREE.MathUtils.lerp(overlay,special?1:0,blend);
    for(const bone of Object.values(bones))frameQuats.get(bone).copy(bone.quaternion);
    const clipHip=bones.hip.position.clone();
    if(overlay>.001){
      for(const [bone,rest]of bind){bone.position.copy(rest.position);bone.quaternion.copy(rest.quaternion);}
      bones.hip.position.y+=(character.hips.position.y-.92)/1.08;
      character.mesh.updateMatrixWorld(true);
      for(let i=0;i<mappings.length;i++){
        const [name,control]=mappings[i],bone=bones[name];
        control.getWorldQuaternion(q);
        // Controller world orientation already includes root heading/death tilt.
        q.multiply(corrections[i]);
        bone.parent.getWorldQuaternion(parentQ).invert();
        bone.quaternion.copy(parentQ.multiply(q));
        bone.updateMatrixWorld(true);
      }
      for(const bone of Object.values(bones)){
        q.copy(bone.quaternion);
        bone.quaternion.slerpQuaternions(frameQuats.get(bone),q,overlay);
      }
      bones.hip.position.lerpVectors(clipHip,bones.hip.position,overlay);
      if((opts.animationProxy||(opts.hero&&game?.weapon&&game.weapon!=='fist'))&&!character.dead&&!character.inVehicle&&character.crouch<=.01
        &&!character.kickT&&!character.staggerT){
        for(const name of ['hip','rThigh','rShin','rFoot','lThigh','lShin','lFoot']){
          bones[name].quaternion.copy(frameQuats.get(bones[name]));
        }
        bones.hip.position.copy(clipHip);
      }
    }
    root.updateMatrixWorld(true);
    if(character.aiming&&!character.reloadT&&!character.dead&&!character.inVehicle){
      const pitch=THREE.MathUtils.clamp(character.aimPitch||0,-.7,.7);
      const lift=Math.sin(pitch)*.48;
      aimArm('r',new THREE.Vector3(-.075,1.40+lift,.53),new THREE.Vector3(-.40,1.12,.25),pitch);
      aimArm('l',new THREE.Vector3(-.025,1.37+lift,.49),new THREE.Vector3(.35,1.10,.25),pitch);
    }
    if(opts.hero&&game?.weaponHolder&&game.weaponHolder.parent!==socket){
      socket.add(game.weaponHolder);
      game.weaponHolder.position.set(0,-.075,.018);
      game.weaponHolder.rotation.set(Math.PI/2,0,0);
    }
  }};
  if(!opts.hero&&!opts.animationProxy){
    // Accessories use a neutral frame on the animated head, not bone-local axes.
    const mount=new THREE.Group();mount.quaternion.copy(bind.get(bones.head).world).invert();bones.head.add(mount);
    const color=opts.hat??opts.shirt??0x304158;
    const material=new THREE.MeshStandardMaterial({color,roughness:.95});
    if(['cap','beanie'].includes(opts.hairStyle)){
      const cap=new THREE.Mesh(new THREE.SphereGeometry(1,12,8,0,Math.PI*2,0,Math.PI/2),material);
      cap.scale.set(.113,.091,.124);cap.position.set(0,.13,.012);mount.add(cap);
      if(opts.hairStyle==='cap'){
        const brim=new THREE.Mesh(new THREE.SphereGeometry(1,12,6),material);
        brim.scale.set(.113,.008,.083);brim.position.set(0,.13,.099);mount.add(brim);
      }
    }
    if(opts.role==='police'||opts.role==='swat'){
      const badge=new THREE.Mesh(new THREE.CircleGeometry(.022,6),new THREE.MeshStandardMaterial({color:0xc4bd83,roughness:.55}));
      const chestMount=new THREE.Group();chestMount.quaternion.copy(bind.get(bones.chest).world).invert();bones.chest.add(chestMount);
      badge.position.set(-.083,.09,.135);chestMount.add(badge);
    }
    mixer.update((character.breathe||0)%1.5);
  }
  mixer.update(0);
  return api;
}
