import {synthesize,SAMPLE_RATE} from './foley-palette.js?v=resident-devices-v32';
const db=v=>10**(v/20),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
let ctx,buses,scene='menu',lastHeart=-10,lastBreath=-10,nextCreak=14,clock=0,stepIndex=0;
let ambient=null,heartLoop=null,duckUntil=0;const buffers=new Map(),voices=new Set(),steps=new Map(),recorded=new Map();
const live=()=>ctx&&!window.Sfx.silent();
export function initScare(){
  if(ctx||!window.Sfx?.ctx)return !!ctx;ctx=window.Sfx.ctx;buses={};
  const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-9;limiter.knee.value=6;
  limiter.ratio.value=5;limiter.attack.value=.004;limiter.release.value=.22;limiter.connect(window.Sfx.master);
  for(const [name,level]of Object.entries({threat:-3,foley:-6,ambience:-11,ui:-7})){
    const bus=ctx.createGain();bus.gain.value=db(level);bus.connect(limiter);buses[name]=bus;
  }
  window.addEventListener('sfx-state',()=>{if(window.Sfx.silent())resetScare();});return true;
}
export async function prepareRecordedAudio(){
  if(!ctx?.decodeAudioData)return;
  await Promise.all(['step','scream','heart','angry'].map(async kind=>{
    try{
      const file=kind==='angry'?'resident-angry-approved':kind==='scream'?'resident-capture':kind==='heart'?'heartbeat':kind;
      const response=await fetch(new URL(`../assets/audio/${file}.mp3`,import.meta.url));
      if(!response.ok)return;
      recorded.set(kind,await ctx.decodeAudioData(await response.arrayBuffer()));
    }catch{/* Synthesized fallback remains available if decoding fails. */}
  }));
}
function buffer(kind,variant){
  const key=kind+variant;if(buffers.has(key))return buffers.get(key);
  const pcm=synthesize(kind,variant),b=ctx.createBuffer(1,pcm.length,SAMPLE_RATE);b.copyToChannel(pcm,0);buffers.set(key,b);return b;
}
function play(kind,{gain=1,pan=0,bus='foley',variant=0,rate=1,delay=0,blocked=false}={}){
  if(!live()||voices.size>=24)return null;
  const src=ctx.createBufferSource(),g=ctx.createGain(),filter=ctx.createBiquadFilter();
  src.buffer=recorded.get(kind)||buffer(kind==='scream'?'settle':kind,variant);src.playbackRate.value=rate;
  filter.type='lowpass';filter.frequency.value=blocked?720:9500;filter.Q.value=.5;g.gain.value=gain*(blocked?.42:1);
  const panNode=ctx.createStereoPanner?.();src.connect(filter);filter.connect(g);
  if(panNode){panNode.pan.value=clamp(pan,-.94,.94);g.connect(panNode);panNode.connect(buses[bus]);}else g.connect(buses[bus]);
  const item={src,nodes:[src,filter,g,...(panNode?[panNode]:[])]};voices.add(item);
  src.onended=()=>{item.nodes.forEach(n=>n.disconnect());voices.delete(item);};src.start(ctx.currentTime+delay);return item;
}
function duck(seconds=.7){if(ctx)duckUntil=Math.max(duckUntil,ctx.currentTime+seconds);}
export function setAudioScene(key){scene=key;resetScare();}
export function refreshAudio(){if(!live())resetScare();}
export function playerStep(noise){play('step',{gain:.09+noise*.19,variant:++stepIndex%4,rate:1.05+(stepIndex%3)*.035});}
export function neighborStep(dist,pan,fast,id=0,blocked=false){
  if(!live())return;const now=ctx.currentTime,last=steps.get(id)||{at:-10,index:0};if(now-last.at<.13)return;
  const index=last.index+1;steps.set(id,{at:now,index});
  const gain=clamp(1-dist/12,0,1)**2*(fast?.7:.5);if(gain<.01)return;
  play('step',{gain,pan,bus:'threat',variant:index%4,rate:(fast?1.04:.87)+(index%2)*.07,blocked});
  if(index%2===0&&dist<4)play('drag',{gain:gain*.12,pan,blocked,rate:1.4});
}
export function heartbeat(dist){
  if(!live())return;const near=clamp((6-dist)/5,0,1),now=ctx.currentTime;
  // The restored asset contains twelve seconds of beats, not one beat.
  // Keep one loop, otherwise starting it every second stacks dozens of hearts.
  if(recorded.has('heart')){
    if(near<=0){stopHeart();return;}
    if(!heartLoop){
      const src=ctx.createBufferSource(),gain=ctx.createGain();
      src.buffer=recorded.get('heart');src.loop=true;src.connect(gain);gain.connect(buses.threat);
      gain.gain.value=0;src.start();heartLoop={src,gain};
    }
    heartLoop.gain.gain.setTargetAtTime(near*.5,now,.15);
    heartLoop.src.playbackRate.setTargetAtTime(.85+near*.3,now,.3);return;
  }
  if(near>0&&now-lastHeart>1.22-near*.5){lastHeart=now;play('heart',{gain:near*.5,bus:'threat'});}
}
export function residentBreath(dist,pan,blocked){
  if(!live()||dist>2.8||(blocked&&dist>1.3))return;const now=ctx.currentTime;if(now-lastBreath<6)return;lastBreath=now;
  play('breath',{gain:clamp(1-dist/3,0,1)*.24,pan,blocked,bus:'threat',variant:stepIndex%3});
}
export function ambientCreak(dt=.016,threat=0){
  if(!live()||scene!=='game')return;clock+=dt;
  if(!ambient){const src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=buffer('room',0);src.loop=true;src.connect(g);g.connect(buses.ambience);g.gain.value=0;src.start();ambient={src,g};}
  const quiet=ctx.currentTime<duckUntil?.18:1;
  ambient.g.gain.setTargetAtTime(.12*(1-clamp(threat,0,1)*.85)*quiet,ctx.currentTime,.3);
  if(scene==='game'&&clock>nextCreak&&threat<.3){nextCreak=clock+17+Math.random()*14;play('creak',{gain:.17,pan:Math.random()*1.5-.75,bus:'ambience',variant:stepIndex%3});}
}
export function stingerHeard(){duck();play('cloth',{gain:.32,bus:'threat'});}
export function gasp(){if(live()&&ctx.currentTime-lastBreath>2.4){lastBreath=ctx.currentTime;play('breath',{gain:.35,rate:1.2});}}
export function stopHeart(){lastHeart=-10;if(heartLoop){heartLoop.src.stop();heartLoop.src.disconnect();heartLoop.gain.disconnect();heartLoop=null;}}
export function pickupSting(){duck(.35);play('pickup',{gain:.85,bus:'ui'});}
export function winSting(){resetScare();play('settle',{gain:.6,bus:'ui'});}
export function catchSting(){play('cloth',{gain:1.05,bus:'threat'});play('step',{gain:.9,bus:'threat',delay:.075,rate:.83});}
// Same timeline as the hand reaching the collar (about 460 ms).
export function screamSting(){
  resetScare();duck(3);play('cloth',{gain:.35,bus:'threat'});
  // Another +4 dB at the voice input; the shared compressor retains headroom.
  play('scream',{gain:.68*db(8),bus:'threat',delay:.30});
  play('step',{gain:.65,bus:'threat',delay:.46,rate:.74});
  play('cloth',{gain:.75,bus:'threat',delay:.46});
}
export function storySound(id,pan=0){duck(1.2);play(id==='notice'?'lamp':id==='routine'?'cup':'paper',{gain:.72,pan});}
export function wardrobeSound(open){duck(.5);play('latch',{gain:.65});play('creak',{gain:open?.23:.14,rate:open?1.3:1.6});play('cloth',{gain:.38});}
export function entranceDoorSlam(){duck(1.1);play('door',{gain:1.15,bus:'threat'});}
export function angryResident(){
  duck(1.4);
  // Human nonverbal voice; never substitute a synthetic noise for speech.
  if(recorded.has('angry'))play('angry',{gain:.95,bus:'threat',pan:.12});
}
export function paperSound(){play('paper',{gain:.65,bus:'ui'});}
export function endingSound(){resetScare();duck(4);play('settle',{gain:.5});play('cup',{gain:.75,pan:.42,delay:1.45});play('cloth',{gain:.24,pan:.42,delay:2.0});}
export function resetScare(){
  stopHeart();
  for(const item of [...voices]){try{item.src.stop();}catch{}item.nodes.forEach(n=>n.disconnect());voices.delete(item);}
  if(ambient){try{ambient.src.stop();}catch{}ambient.src.disconnect();ambient.g.disconnect();ambient=null;}
  lastHeart=lastBreath=-10;clock=0;nextCreak=14;steps.clear();
}
export function audioSnapshot(){return {voices:voices.size,heartbeat:!!heartLoop,buffers:buffers.size,recordings:[...recorded.keys()],scene,silent:!live()};}
