import * as THREE from 'three';
import {buildStairwell} from './stairwell-scene.js?v=resident-devices-v32';
import {animateHunter,disposeGroup} from './hunter.js?v=resident-devices-v32';
import {playerStep,wardrobeSound,entranceDoorSlam,angryResident,resetScare} from './scare.js?v=resident-devices-v32';
import {openingCopy} from './opening-script.js?v=resident-devices-v32';

const element=id=>document.getElementById(id);
const smooth=(t,a,b)=>THREE.MathUtils.smoothstep(t,a,b);

// An isolated scene: no AI, battery drain or campaign clock during the opening.
export class StoryOpening {
 constructor(){this.active=false;}
 start(done,preview=false,loop=null){
  this.finish(false);this.done=done;this.preview=preview;this.active=true;this.phase='stairs';this.time=0;this.age=0;this.step=-1;this.suspended=false;
  this.loop=loop;if(loop)this.phase='loopExit';
  this.reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;this.attention=.35;
  Object.assign(this,buildStairwell());
  this.paint();this.renderPose(0);element('opening').classList.remove('hidden');element(loop?'opening-next':'opening-skip').focus();
 }
 paint(){
  if(this.loop){
   const ru=window.Platform.getLanguage()==='ru',back=this.phase==='loopReturn',walking=this.phase==='loopWalk';
   element('opening-title').textContent=back?'ВРЕМЯ · 23:00':(ru?'ДВЕРЬ №12':'DOOR 12');
   if(back&&!ru)element('opening-title').textContent='TIME · 23:00';
   element('opening-copy').textContent=back?(ru?'Та же квартира. Снова одиннадцать вечера. Найденные письма и фотографии остались с вами. Это не новая ночь — это его ожидание начинается заново.':'The same flat. Eleven at night again. The letters and photographs are still with you. This is not another night — his vigil is starting over.'):(ru?'За дверью тихо. Вы узнаёте свою лестничную площадку. До дома всего один пролёт.':'It is quiet beyond the door. You recognise your landing. Home is only one flight away.');
   element('opening-next').textContent=back?(ru?'Вернуться в квартиру · Ночь '+(this.loop.night+1):'Return to the flat · Night '+(this.loop.night+1)):(ru?'Выйти в подъезд':'Step onto the landing');
   element('opening-next').disabled=walking;element('opening-skip').hidden=true;
   element('opening').setAttribute('data-phase',this.phase);element('opening-veil').style.opacity=back?'1':'0';return;
  }
  const ru=window.Platform.getLanguage()==='ru',[speaker,line]=openingCopy(this.phase,ru?'ru':'en');
  element('opening-title').textContent=speaker;element('opening-copy').textContent=line;
  const button=element('opening-next');button.textContent=this.phase==='wake'?(this.preview?(ru?'В меню':'Back to menu'):(ru?'Найти выход':'Find a way out')):(ru?'Далее':'Continue');
  button.disabled=['stairs','grab'].includes(this.phase);
  element('opening-skip').textContent=ru?'Пропустить вступление':'Skip opening';element('opening-skip').hidden=this.phase==='wake';
  element('opening').setAttribute('data-phase',this.phase);
  element('opening-veil').style.opacity=this.phase==='wake'?'1':'0';
 }
 change(phase){this.phase=phase;this.age=0;this.paint();if(!['stairs','grab'].includes(phase))element('opening-next').focus();}
 setSuspended(on){this.suspended=on;const ru=window.Platform.getLanguage()==='ru';element('opening-pause').textContent=on?(ru?'Продолжить сцену':'Resume scene'):(ru?'Пауза':'Pause');element('opening-pause').setAttribute('aria-pressed',String(on));if(on)element('opening-pause').focus();}
 advance(){
  if(!this.active||this.suspended||document.hidden)return;
  if(this.loop){if(this.phase==='loopExit'){wardrobeSound(true);this.change('loopWalk');}else if(this.phase==='loopReturn')this.finish();return;}
  if(this.phase==='accusation')this.change('answer');
  else if(this.phase==='answer')this.change('threat');
  else if(this.phase==='threat'){
   this.change('grab');
  }else if(this.phase==='wake')this.finish();
 }
 wake(){if(!this.active)return;this.change('wake');}
 skip(){if(this.active&&!document.hidden){resetScare();if(this.loop)this.change('loopReturn');else this.wake();}}
 renderPose(t){
  if(this.loop){
   this.model.visible=false;
   const p=this.reduced?0:smooth(t,0,3);
   this.camera.position.set(.1,1.98,-2.25+3.8*p);this.camera.lookAt(.1,1.4,6);return;
  }
  const climb=smooth(t,0,5),moving=this.phase==='stairs';
  const z=6.1-3.75*climb,ground=-Math.max(0,z-3.4)*.5;
  this.camera.position.set(.13,1.75+ground+(moving&&!this.reduced?Math.sin(t*9)*.012:0),z);
  this.camera.lookAt(0,-.9+2.6*climb,3.9-4.05*climb);
  animateHunter(this.model,this.time,false,this.attention,0,false,0);
 }
 update(dt,renderer,aspect){
  if(!this.active||this.suspended||document.hidden)return;
  this.time+=dt;this.age+=dt;
  if(this.loop){
   if(this.phase==='loopWalk'){
    this.renderPose(this.age);element('opening-veil').style.opacity=String(smooth(this.age,2,3.2));
    const step=Math.floor(this.age/.6);if(step!==this.step&&this.age<2.7){this.step=step;playerStep(.35);}
    if(this.age>=.75&&!this.shouted){angryResident();this.shouted=true;}
    if(this.age>=3.4){entranceDoorSlam();this.doorSlam=true;this.change('loopReturn');}
   }
   this.camera.aspect=aspect;this.camera.updateProjectionMatrix();renderer.render(this.scene,this.camera);return;
  }
  this.attention=THREE.MathUtils.damp(this.attention,this.phase==='stairs'?.35:.9,3.2,dt);
  if(this.phase==='stairs'){
   this.renderPose(this.age);
   const step=Math.floor(this.age/.55);if(step!==this.step&&this.age<5){this.step=step;playerStep(.35);}
   if(this.age>=5)this.change('accusation');
  }else if(this.phase!=='grab')this.renderPose(5);
  if(this.phase==='grab'){
   // Hold the composition: the empty doorway is revealed after a slow blackout.
   this.renderPose(5);
   const t=this.age,firstDark=smooth(t,.3,1.35),returnLight=smooth(t,1.95,2.6),lastDark=smooth(t,3.45,4.2);
   const light=(1-firstDark+.65*returnLight)*(1-lastDark);
   this.bulb.intensity=25*light;this.ambient.intensity=.6*light;
   this.lamp.material.emissiveIntensity=.7*light;
   this.model.visible=t<1.6;
   element('opening-veil').style.opacity=String(Math.max(firstDark*(1-returnLight),lastDark));
   const steps=[1.65,2.15,2.7];
   while(this.darkStep<steps.length&&t>=steps[this.darkStep]){playerStep(.3+this.darkStep*.12);this.darkStep++;}
   this.door.rotation.y=-1.25*(1-smooth(t,3.25,3.75));
   if(t>=1.1&&!this.shouted){angryResident();this.shouted=true;}
   if(t>=3.75&&!this.doorSlam){entranceDoorSlam();this.doorSlam=true;}
   if(t>=4.8)this.wake();
  }
  this.camera.aspect=aspect;this.camera.updateProjectionMatrix();renderer.render(this.scene,this.camera);
 }
 finish(complete=true){
  if(!this.active)return;this.active=false;resetScare();
  this.scene.traverse(o=>{if(o.isLight&&o.shadow)o.shadow.dispose();});disposeGroup(this.scene);this.scene.clear();this.plaqueTexture.dispose();this.extraTextures?.forEach(t=>t.dispose());
  element('opening').classList.add('hidden');const done=this.done;this.done=null;if(complete)done?.();
 }
}
