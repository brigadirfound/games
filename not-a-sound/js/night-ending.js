import * as THREE from 'three';
import {buildCourtyard} from './ending-courtyard.js?v=resident-devices-v32';
import {roomMaterial} from './room-materials.js?v=resident-devices-v32';
import {createHunter,animateHunter,disposeGroup} from './hunter.js?v=resident-devices-v32';
import {createFlashlight,setFlashlightPower} from './handheld-props.js?v=resident-devices-v32';
import {neighborStep,entranceDoorSlam} from './scare.js?v=resident-devices-v32';
import {buildStairwell} from './stairwell-scene.js?v=resident-devices-v32';

// Text waits for input; held keys cannot skip the retreat.
export class NightEnding {
  constructor(){this.active=false;}
  start(done,knowsLetter=false){
    this.finish(false);this.done=done;this.knowsLetter=knowsLetter;
    this.vignetteOpacity=document.getElementById('vignette').style.opacity;
    this.time=0;this.phaseTime=0;this.phase='light';this.active=true;this.closedSound=false;
    this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x080d10);
    this.camera=new THREE.PerspectiveCamera(54,1,.04,80);
    this.camera.position.set(.18,2.1,4.1);this.camera.lookAt(0,1.6,-.3);this.scene.add(this.camera);
    this.torch=createFlashlight();this.torch.scale.setScalar(.72);this.camera.add(this.torch);
    const box=(x,y,z,w,h,d,mat,parent=this.scene)=>{
      const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);
      m.castShadow=m.receiveShadow=true;parent.add(m);return m;
    };
    const wood=roomMaterial('wood',0x4e4233),wall=roomMaterial('linen',0x68616a);
    box(0,-.04,1,8,.08,12,wood);
    box(-2.55,1.9,-.72,2.9,3.8,.20,wall);box(2.55,1.9,-.72,2.9,3.8,.20,wall);
    box(0,3.5,-.72,2.2,.6,.20,wall);
    for(const x of [-1.16,1.16])box(x,1.6,-.58,.12,3.2,.16,wood);
    box(0,3.18,-.58,2.44,.12,.16,wood);
    box(-3.95,1.9,1,.1,3.8,7,wall);
    box(3.95,1.9,-.4,.1,3.8,5.2,wall);box(3.95,1.9,5.4,.1,3.8,1.8,wall);
    box(3.95,3.55,3.35,.1,.5,2.3,wall);
    for(const z of [2.15,4.55])box(3.9,1.6,z,.18,3.2,.12,wood);
    box(3.9,3.2,3.35,.18,.12,2.52,wood);
    box(0,1.9,-4,8,3.8,.15,wall);
    // A closed interior shell keeps outdoor canopies above the ceiling.
    const plaster=roomMaterial('linen',0x8b8375),panel=roomMaterial('wood',0x373a38);
    box(0,3.92,1,8.2,.24,12.2,plaster);
    box(0,1.9,6.9,8,3.8,.18,wall);
    for(const x of [-2.55,2.55]){
      box(x,.65,-.59,2.9,1.3,.065,panel);
      for(const y of [.10,1.32])box(x,y,-.53,2.9,.07,.08,wood);
    }
    box(-3.87,.65,1,.07,1.3,7,panel);
    for(const y of [.10,1.32,3.73])box(-3.81,y,1,.08,.075,7,wood);
    for(const [z,d] of [[-.4,5.2],[5.4,1.8]]){
      box(3.87,.65,z,.07,1.3,d,panel);
      for(const y of [.10,1.32,3.73])box(3.81,y,z,.08,.075,d,wood);
    }
    box(3.81,3.73,3.35,.08,.075,2.6,wood);
    box(0,3.73,-.53,7.8,.075,.08,wood);
    // Familiar hall objects give the exit a lived-in scale.
    box(-3.2,.42,2.8,.65,.84,1.4,wood);
    box(-3.2,.89,2.8,.72,.10,1.48,wood);
    for(const z of [2.4,3.2])box(-2.84,.53,z,.04,.045,.18,roomMaterial('metal',0x9d8a62));
    box(-3.82,2.25,2.8,.09,1.5,1.1,wood);
    box(-3.75,2.25,2.8,.025,1.3,.9,roomMaterial('metal',0x737c7b));
    box(0,3.65,2.8,.6,.14,.6,roomMaterial('enamel',0xbdb297));
    this.door=new THREE.Group();this.door.position.set(-1.1,0,-.7);this.door.rotation.y=.95;this.scene.add(this.door);
    box(1.1,1.55,0,2.2,3.1,.09,wood,this.door);
    for(const y of [.85,2.05])box(1.1,y,.06,1.84,1.03,.04,wood,this.door);
    box(1.92,1.4,.13,.20,.035,.055,roomMaterial('metal',0xab956a),this.door);
    for(const x of [-2.1,-2.5])box(x,2.1,-.52,.05,.17,.09,roomMaterial('metal',0x77776a));
    // A physical old light switch instead of an empty floating nameplate.
    const bakelite=roomMaterial('enamel',0xb3aa8f);
    box(2,1.48,-.585,.19,.25,.065,bakelite);
    box(2,1.48,-.541,.105,.14,.035,roomMaterial('enamel',0x777263));
    for(const y of [1.385,1.575])box(2,y,-.546,.025,.013,.007,roomMaterial('metal',0x514d42));
    this.model=createHunter();this.model.position.set(0,0,0);this.scene.add(this.model);
    this.ambient=new THREE.AmbientLight(0x8dacc0,.35);this.scene.add(this.ambient);
    this.beam=new THREE.SpotLight(0xffd6a0,19,11,.52,.65,1.1);
    this.beam.position.copy(this.camera.position);this.beam.target.position.set(0,1.9,0);
    this.scene.add(this.beam,this.beam.target);
    this.dawn=new THREE.PointLight(0xbbdbe9,0,14,1.1);this.dawn.position.set(3,2.7,3);this.scene.add(this.dawn);
    this.exitDoor=new THREE.Group();this.exitDoor.position.set(3.96,0,2.2);this.scene.add(this.exitDoor);
    box(0,1.55,1.15,.10,3.1,2.3,wood,this.exitDoor);
    box(-.09,1.4,2.05,.12,.04,.24,roomMaterial('metal',0x98865a),this.exitDoor);
    this.outside=new THREE.Group();this.scene.add(this.outside);this.outside.visible=false;
    this.courtyard=buildCourtyard(this.outside);
    for(const [x,z] of [[26,-12],[27,18.5],[55,3.35]]){
      box(x,.16,z,14.3,.36,14.3,this.courtyard.stone,this.outside);
      box(x,4.1,z,14,8.2,14,this.courtyard.wall,this.outside);
      box(x,8.22,z,14.4,.18,14.4,this.courtyard.stone,this.outside);
      for(let row=0;row<3;row++)for(let col=0;col<4;col++){
        const y=1.5+row*2.3,wz=z-4.8+col*3.2;
        const glass=roomMaterial('metal',0x687a7e);
        box(x-7.03,y,wz,.025,1.4,1.05,glass,this.outside);
        box(x-7.10,y-.74,wz,.20,.10,1.23,this.courtyard.stone,this.outside);
        box(x-7.06,y,wz,.055,1.4,.045,this.courtyard.wall,this.outside);
        // Windows continue around the sides facing the courtyard.
        if(x<40){
          const side=z<0?1:-1,wx=x-4.8+col*3.2;
          box(wx,y,z+side*7.03,1.05,1.4,.025,glass,this.outside);
          box(wx,y-.74,z+side*7.1,1.23,.10,.20,this.courtyard.stone,this.outside);
          box(wx,y,z+side*7.06,.045,1.4,.055,this.courtyard.wall,this.outside);
        }
      }
    }
    // Low service buildings anchor the gaps without turning the view into a wall of flats.
    // Their staggered depth and trees beyond keep the courtyard open to the sunrise.
    const serviceDoor=roomMaterial('metal',0x50554f);
    for(const [x,z,w,d] of [[43,-7.8,8.2,6.2],[46,14.6,7.2,5.7]]){
      box(x,1.38,z,w,2.76,d,this.courtyard.wall,this.outside);
      box(x,2.82,z,w+.32,.16,d+.32,this.courtyard.stone,this.outside);
      box(x-w/2-.015,1.18,z,.035,2.08,2.25,serviceDoor,this.outside);
      for(const dz of [-.72,.72])box(x-w/2-.038,1.24,z+dz,.018,1.72,.07,this.courtyard.stone,this.outside);
      box(x-w/2-.045,.19,z,.025,.18,2.35,this.courtyard.stone,this.outside);
    }
    const sky=new THREE.Mesh(new THREE.SphereGeometry(65,24,16),new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,
      vertexShader:'varying vec3 skyDir;void main(){skyDir=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`varying vec3 skyDir;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
        float fbm(vec2 p){float v=0.,a=.55;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+17.4;a*=.48;}return v;}
        void main(){
          vec3 d=normalize(skyDir);
          vec3 horizon=vec3(1.0,.86,.65),zenith=vec3(.48,.70,.86);
          vec3 color=mix(horizon,zenith,smoothstep(-.05,.65,d.y));
          float u=atan(d.z,d.x)/6.28318+.5;
          float cloud=fbm(vec2(u*7.5,d.y*4.2)+vec2(2.1,.4));
          cloud=smoothstep(.55,.76,cloud)*smoothstep(.06,.20,d.y)*(1.0-smoothstep(.70,.94,d.y));
          vec3 cloudColor=mix(vec3(.76,.79,.79),vec3(.96,.92,.82),smoothstep(.05,.42,d.y));
          color=mix(color,cloudColor,cloud*.72);
          gl_FragColor=vec4(color,1.0);
        }`
    }));sky.renderOrder=-2;this.outside.add(sky);
    this.sun=new THREE.DirectionalLight(0xffdfa1,0);this.sun.position.set(30,9,3);this.sun.target.position.set(4,0,3);this.scene.add(this.sun,this.sun.target);
    this.sun.castShadow=true;this.sun.shadow.mapSize.set(1024,1024);
    Object.assign(this.sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:.5,far:65});
    this.sun.shadow.camera.updateProjectionMatrix();this.sun.shadow.bias=-.0005;this.sun.shadow.normalBias=.035;
    this.sunDisk=new THREE.Mesh(new THREE.CircleGeometry(2.2,40),new THREE.MeshBasicMaterial({color:0xfff8df,toneMapped:false}));
    this.sunDisk.position.set(38,10.2,3.35);this.sunDisk.rotation.y=-Math.PI/2;this.outside.add(this.sunDisk);
    const halo=new THREE.Mesh(new THREE.PlaneGeometry(26,26),new THREE.ShaderMaterial({
      transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'varying vec2 vUv;void main(){float r=length(vUv-.5)*2.0;float a=pow(max(0.0,1.0-r),2.4)*.92;gl_FragColor=vec4(1.0,.84,.58,a);}'
    }));
    halo.position.set(37.9,10.2,3.35);halo.rotation.y=-Math.PI/2;this.outside.add(halo);
    this.startRotation=this.camera.quaternion.clone();
    this.sunRotation=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(6.78,2.1,3.35),new THREE.Vector3(38,6.2,3.35),new THREE.Vector3(0,1,0)));
    this.paint();
  }
  advance(){
    if(!this.active||document.hidden)return false;
    if(this.phase==='light'&&this.phaseTime>=.8){
      this.phase='leave';this.phaseTime=0;this.paint();return true;
    }
    if(this.phase==='dawn'){
      this.stairwell=buildStairwell(false);this.stairwell.ambient.intensity=1.2;this.stairwell.bulb.intensity=12;
      this.stairwell.door.rotation.y=0;
      this.stairwell.camera.position.set(.1,1.75,1.1);this.stairwell.camera.lookAt(.1,-.3,6);
      this.phase='stairs';this.phaseTime=0;this.paint();return true;
    }
    if(this.phase==='stairs'){this.phase='stairsWalk';this.phaseTime=0;this.paint();return true;}
    if(this.phase==='sunlight'){this.finish();return true;}
    return false;
  }
  paint(){
    const button=document.getElementById('ending-next'),copy=document.getElementById('ending-copy');
    copy.textContent=window.t(['stairs','stairsWalk'].includes(this.phase)?'farewellStairs':this.phase==='outside'?'farewellWalking':this.phase==='sunlight'?'farewellSun':this.phase==='light'?'farewellLight':this.phase==='leave'?'farewellLeaving':
      this.knowsLetter?'farewellKnown':'farewellUnknown');
    copy.style.opacity='1';document.getElementById('ending-veil').style.opacity='0';
    copy.style.color='#e6e8ea';copy.style.textShadow='none';
    copy.style.background='#0d0e10ed';copy.style.padding='18px 24px';
    button.textContent=window.t(['stairs','stairsWalk','outside'].includes(this.phase)?'farewellDown':this.phase==='sunlight'?'finishStory':this.phase==='light'?'farewellLower':'farewellExit');
    button.disabled=['leave','outside','stairsWalk'].includes(this.phase)||(this.phase==='light'&&this.phaseTime<.8);
  }
  update(dt,renderer,aspect){
    if(!this.active)return false;this.time+=dt;this.phaseTime+=dt;
    if(['stairs','stairsWalk'].includes(this.phase)){
      const s=this.stairwell,t=this.phaseTime,moving=this.phase==='stairsWalk';
      if(moving){
        const p=THREE.MathUtils.smoothstep(t,0,3),z=1.1+4.8*p;s.camera.position.set(.1,1.75-Math.max(0,z-3.4)*.5,z);s.camera.lookAt(.1,-.3,7.6);
        document.getElementById('ending-veil').style.background='#08090a';
        document.getElementById('ending-veil').style.opacity=String(THREE.MathUtils.smoothstep(t,2.3,3.3));
        if(t>=3.5){this.phase='outside';this.phaseTime=0;this.outside.visible=true;this.paint();}
      }
      s.camera.aspect=aspect;s.camera.updateProjectionMatrix();renderer.render(s.scene,s.camera);return true;
    }
    if(this.time<1.1){
      const veil=document.getElementById('ending-veil');
      veil.style.background='#08090a';veil.style.opacity=String(1-THREE.MathUtils.smoothstep(this.time,.15,1.1));
    }
    if(this.phase==='light'){
      animateHunter(this.model,this.time,false,.7,0,false,0);
      if(this.phaseTime>=.8)document.getElementById('ending-next').disabled=false;
    }else if(this.phase==='leave'){
      const t=this.phaseTime,walk=THREE.MathUtils.smoothstep(t,.8,3.5),previous=this.model.position.z;
      this.beam.intensity=19*(1-THREE.MathUtils.smoothstep(t,0,.65));
      this.model.rotation.y=Math.PI*THREE.MathUtils.smoothstep(t,.2,1.15);
      this.model.position.z=-3.2*walk;
      animateHunter(this.model,this.time,false,0,0,t>.8&&t<3.5,Math.abs(previous-this.model.position.z));
      if(this.model.userData.footstep)neighborStep(4.1+3.2*walk,0,false,'farewell',false);
      if(t>=4.4&&!this.closedSound){this.closedSound=true;entranceDoorSlam();}
      this.door.rotation.y=.95*(1-THREE.MathUtils.smoothstep(t,3.3,4.4));
      this.dawn.intensity=16*THREE.MathUtils.smoothstep(t,2.8,5.2);
      this.ambient.intensity=.35+.3*THREE.MathUtils.smoothstep(t,3.3,5.2);
      if(t>=5.2){this.phase='dawn';this.phaseTime=0;this.paint();document.getElementById('ending-next').focus();}
    }
    if(this.phase==='outside'){
      const t=this.phaseTime,turn=THREE.MathUtils.smoothstep(t,0,1.7),walk=THREE.MathUtils.smoothstep(t,1.4,5.7);
      this.camera.quaternion.copy(this.sunRotation);
      this.camera.position.set(6.78+2*walk,2.1,3.35);
      this.exitDoor.rotation.y=1.65*THREE.MathUtils.smoothstep(t,.1,1.5);
      const daylight=THREE.MathUtils.smoothstep(t,2.2,5.7);
      document.getElementById('vignette').style.opacity=String(1-daylight);
      this.sun.intensity=6.8*daylight;this.ambient.intensity=.65+.65*daylight;
      this.scene.background.set(0x080d10).lerp(new THREE.Color(0xc3ddeb),daylight);
      // Eye adaptation begins as the camera crosses the doorway, not on a cut.
      const glare=THREE.MathUtils.smoothstep(t,3,4.6);
      const veil=document.getElementById('ending-veil');veil.style.background='radial-gradient(ellipse at 50% 46%, #fffef6 0%, #fffce9 32%, #fff4d5 70%, #ffe9c0 100%)';veil.style.opacity=String(.88*glare);
      if(t>=5.7){this.phase='sunlight';this.phaseTime=0;this.paint();document.getElementById('ending-next').focus();}
    }
    if(this.phase==='sunlight'){
      const adapt=THREE.MathUtils.smoothstep(this.phaseTime,.35,4.5);
      document.getElementById('ending-veil').style.opacity=String(.88-.69*adapt);
      this.sun.intensity=6.8-1.5*adapt;
    }
    const lowered=this.phase==='light'?0:this.phase==='leave'?THREE.MathUtils.smoothstep(this.phaseTime,0,.65):1;
    this.torch.position.set(Math.min(.30,.55*Math.tan(54*Math.PI/360)*aspect*.62),-.18-.5*lowered,-.55);
    this.torch.rotation.x=-.7*lowered;setFlashlightPower(this.torch,1-lowered);
    this.camera.aspect=aspect;this.camera.updateProjectionMatrix();renderer.render(this.scene,this.camera);
    return true;
  }
  finish(complete=true){
    if(!this.active)return;this.active=false;this.courtyard?.dispose();disposeGroup(this.scene);this.scene.clear();
    if(this.stairwell){this.stairwell.scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.dispose();});disposeGroup(this.stairwell.scene);this.stairwell.scene.clear();this.stairwell.plaqueTexture.dispose();this.stairwell.extraTextures?.forEach(t=>t.dispose());this.stairwell=null;}
    document.getElementById('vignette').style.opacity=this.vignetteOpacity;
    const done=this.done;this.done=null;if(complete)done?.();
  }
}
