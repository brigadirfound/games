import {setAudioScene,refreshAudio} from './scare.js?v=resident-devices-v32';

let selected='menu',watched=false,unlocked=false,playing=null;
const buffers=new Map(),pending=new Map(),offsets=new Map();
function stop(){
  if(!playing)return;
  const {source,gain,id,started,offset}=playing;
  offsets.set(id,(offset+window.Sfx.ctx.currentTime-started)%source.buffer.duration);
  source.stop();source.disconnect();gain.disconnect();playing=null;
}
async function load(id){
  if(buffers.has(id))return;
  if(!pending.has(id))pending.set(id,(async()=>{
    const response=await fetch(new URL(`../assets/audio/${id}.mp3`,import.meta.url));
    if(!response.ok)throw new Error(`Music HTTP ${response.status}`);
    buffers.set(id,await window.Sfx.ctx.decodeAudioData(await response.arrayBuffer()));
  })().catch(error=>console.warn('[music]',error.message)).finally(()=>pending.delete(id)));
  await pending.get(id);
}
export function refreshMusic(){
  refreshAudio();const id=selected==='game'?'game':selected==='menu'||selected==='result'?'menu':null,sfx=window.Sfx;
  if(playing&&(playing.id!==id||sfx.silent()))stop();
  if(!id||!unlocked||sfx.silent()||!sfx.ctx||playing)return;
  if(!buffers.has(id)){load(id).then(()=>{if(buffers.has(id))refreshMusic();});return;}
  const source=sfx.ctx.createBufferSource(),gain=sfx.ctx.createGain();
  source.buffer=buffers.get(id);source.loop=true;
  // Music bus preserves the previous output level through Master (0.5).
  gain.gain.value=id==='menu'?.64:.40;
  source.connect(gain);gain.connect(sfx.master);
  const offset=offsets.get(id)||0;
  playing={source,gain,id,offset,started:sfx.ctx.currentTime};source.start(0,offset);
}
export function playMusic(key){selected=key;setAudioScene(key);refreshMusic();}
export function watchMusic(){
  if(watched)return;watched=true;
  const wake=()=>{unlocked=true;refreshMusic();};
  window.addEventListener('pointerdown',wake,{passive:true});window.addEventListener('keydown',wake,{passive:true});
  window.addEventListener('sfx-state',refreshMusic);window.addEventListener('visibilitychange',refreshMusic);
}
