import * as THREE from 'three';
import {NOTES} from './story-pages.js?v=resident-devices-v32';
export {NOTES};
import { clearSight } from './light-sense.js?v=resident-devices-v32';
import { storyPhoto } from './resident-traces.js?v=resident-devices-v32';
import {ARCHIVE_ITEMS,itemsForNight,foundArchive} from './archive-items.js?v=resident-devices-v32';

export function foundNotes(platform) {
  const value=platform.load('notesV1',[]);
  return Array.isArray(value)?NOTES.filter(n=>value.includes(n.id)).map(n=>n.id):[];
}
export function noteForNight(night,found) {return NOTES.find(n=>n.night===night&&!found.includes(n.id))||NOTES.find(n=>n.night<=night&&!found.includes(n.id))||null;}
export function observedTraces(platform) {
  const value=platform.load('observedTracesV1',[]),found=foundNotes(platform);
  return Array.isArray(value)?found.filter(id=>value.includes(id)):[];
}
export function rememberTrace(platform,id) {
  if(!foundNotes(platform).includes(id))return false;
  const seen=observedTraces(platform);if(seen.includes(id))return false;
  platform.save('observedTracesV1',[...seen,id]);return true;
}
export function nextStoryHook(night,platform,language) {
  const ru=language==='ru',next=NOTES.find(note=>note.night===night+1);
  if(next)return ru?'Находки сохранены в журнале. За входной дверью стало тихо. Попробуйте выйти в подъезд.':'Your finds are saved in the journal. It has gone quiet beyond the front door. Try stepping onto the landing.';
  return observedTraces(platform).length<7?
    (ru?'Все записки найдены. Но вы заметили не всё, что изменилось на полке.':'All notes found. But you have not noticed every change on the shelf.'):
    (ru?'Семь записок. Семь ночей ожидания. Теперь вы знаете, почему пора уходить.':'Seven notes. Seven nights of waiting. Now you know why it is time to leave.');
}
const observations={
  notice:{ru:'Вы заметили: лампа у фотографии погасла, пока вы не смотрели.',en:'You noticed: the lamp beside the photograph went dim while you looked away.'},
  routine:{ru:'Вы заметили: рядом с фотографией появилась вторая чашка.',en:'You noticed: a second cup appeared beside the photograph.'},
  letter:{ru:'Вы заметили: конверт с письмом сдвинулся.',en:'You noticed: the envelope has shifted.'},
  shift:{ru:'Вы заметили: на полке появился табель ночных смен Лены.',en:'You noticed: Lena’s night-shift roster appeared on the shelf.'},
  portrait:{ru:'Вы заметили: рамка с фотографией наклонилась.',en:'You noticed: the photograph frame has tilted.'},
  visitor:{ru:'Вы заметили: на полке появились две длинные царапины.',en:'You noticed: two long scratches appeared on the shelf.'},
  departure:{ru:'Вы заметили: на полке лежит прощальное письмо.',en:'You noticed: the farewell letter lies on the shelf.'},
};

export function notePosition(apt,id) {
  // If no safe shelf fits, place the page on a reachable floor cell instead
  // of using an old fixed coordinate that can now be inside furniture.
  // Pick a reachable empty cell near the first objective; no through-wall collection.
  const [sx,,sz]=apt.spawns[0],q=[[Math.floor(sx),Math.floor(sz)]],seen=new Set();
  for(let i=0;i<q.length;i++) {
    const [x,z]=q[i],key=z+','+x;
    if(seen.has(key)||apt.wallGrid[z]?.[x]!==false||apt.occupied?.has(key))continue;
    seen.add(key); for(const [dx,dz]of[[1,0],[-1,0],[0,1],[0,-1]])q.push([x+dx,z+dz]);
  }
  const b=apt.batteries[0]||{x:sx,z:sz};
  return [...seen].map(k=>{const[z,x]=k.split(',').map(Number);return{x:x+.5,y:1.035,z:z+.5};})
    .filter(p=>Math.hypot(p.x-sx,p.z-sz)>2)
    .sort((a,c)=>Math.abs(Math.hypot(a.x-b.x,a.z-b.z)-1.5)-Math.abs(Math.hypot(c.x-b.x,c.z-b.z)-1.5))[0]||null;
}
export function createPaper(pos,id) {
  const g=new THREE.Group();g.position.set(pos.x,pos.y,pos.z);g.rotation.y=.23;
  const paper=new THREE.Mesh(new THREE.BoxGeometry(.42,.009,.55),new THREE.MeshLambertMaterial({color:0xc8b98e,emissive:0x302715}));g.add(paper);
  if(id==='portrait'){
    const photo=new THREE.Mesh(new THREE.PlaneGeometry(.35,.44),new THREE.MeshStandardMaterial({map:storyPhoto(),roughness:1}));
    photo.rotation.x=-Math.PI/2;photo.position.set(0,.008,-.025);g.add(photo);return g;
  }
  const ink=new THREE.MeshBasicMaterial({color:0x514b3e});
  for(let i=0;i<6;i++){const line=new THREE.Mesh(new THREE.BoxGeometry(i===5?.17:.3,.003,.008),ink);line.position.set(-.02,.007,-.18+i*.056);g.add(line);}
  return g;
}

export function createJournal({getState,pause,trace,onClose=()=>{}}) {
  const el=id=>document.getElementById(id), platform=window.Platform;
  let opened=false,resume=false,selected=null,language=platform.getLanguage(),returnFocus=null;
  const ru=()=>language==='ru';
  function paint() {
    const found=foundNotes(platform),evidence=foundArchive(platform);
    el('journal-title').textContent=ru()?'Следы жильца':'Traces of a resident';
    el('journal-count').textContent=(ru()?'Записки: ':'Notes: ')+found.length+'/7 · '+(ru()?'Архив: ':'Archive: ')+evidence.length+'/21';
    el('journal-close').textContent=resume?(ru()?'Продолжить':'Resume'):(ru()?'Закрыть':'Close');
    el('journal-lang').textContent=ru()?'Read in English':'Читать по-русски';
    el('journal-pages').replaceChildren();
    for(const note of NOTES) {
      const hasEvidence=itemsForNight(note.night).some(item=>evidence.includes(item.id));
      const button=document.createElement('button');button.className='ghost';button.disabled=!found.includes(note.id)&&!hasEvidence;
      button.textContent=found.includes(note.id)?note[language].title:(ru()?'Ночь ':'Night ')+note.night+(hasEvidence?(ru()?' · Находки':' · Evidence'):' · ???');
      button.setAttribute('aria-pressed',String(selected===note.id));
      button.onclick=()=>{selected=note.id;paint();};el('journal-pages').appendChild(button);
    }
    const note=NOTES.find(n=>n.id===selected&&found.includes(n.id));
    const chapter=NOTES.find(n=>n.id===selected)?.night;
    el('note-evidence').replaceChildren();
    el('note-evidence').hidden=true;
    el('note-page').setAttribute('data-document',note?.id||'empty');
    el('note-photo').hidden=!['notice','portrait'].includes(note?.id);
    el('note-photo').src=note?.id==='notice'?'assets/textures/archive-courtyard-v23.png':'assets/textures/viktor-lena-v1.png';
    el('note-photo').alt=ru()?'Виктор и Лена у подъезда, до событий игры':'Viktor and Lena outside their building, before the events of the game';
    if(note?.id==='notice')el('note-photo').alt=ru()?'Ваш двор на старой фотографии':'Your courtyard in an old photograph';
    el('note-title').textContent=note?note[language].title:(ru()?'Кто оставляет эти записки?':'Who keeps leaving these notes?');
    el('note-body').textContent=note?note[language].body:(ru()?'Ищите листки в квартире. Подойдите ближе и нажмите «Читать» или R. Найденное остаётся с вами после любой попытки.':'Look for loose pages in the flat. Walk closer and press Read or R. Every note stays with you after a run.');
    if(!note&&chapter){el('note-title').textContent=(ru()?'Ночь ':'Night ')+chapter;el('note-body').textContent=ru()?'Записка этой ночи ещё не найдена.':'This night’s note has not been found yet.';}
    // The document contains only its author's words; gameplay commentary stays out.
    el('note-hint').hidden=true;
    el('note-observation').hidden=true;
    el('note-page').lang=language;
  }
  function open(id=null) {
    if(opened)return;
    const state=getState();resume=state.running&&!state.paused;returnFocus=document.activeElement;
    if(resume)pause(true);
    opened=true;selected=id||NOTES.find(n=>n.night===ARCHIVE_ITEMS.find(item=>item.id===foundArchive(platform).at(-1))?.night)?.id||foundNotes(platform).at(-1)||null;language=platform.getLanguage();
    if(id&&!foundNotes(platform).includes(id)&&NOTES.some(n=>n.id===id)) {
      platform.save('notesV1',[...foundNotes(platform),id]);trace('note_found',{id});
    }
    paint();el('journal').classList.remove('hidden');el('journal-close').focus();
  }
  function close(continueGame=true) {
    if(!opened)return;opened=false;el('journal').classList.add('hidden');
    if(resume&&continueGame&&!document.hidden){pause(false);onClose();}else returnFocus?.focus?.();
    resume=false;
  }
  el('journal-close').addEventListener('click',()=>close());
  el('journal-lang').addEventListener('click',()=>{language=ru()?'en':'ru';paint();});
  el('journal').addEventListener('keydown',e=>{
    if(e.code==='Escape'){e.preventDefault();e.stopPropagation();close(false);}
    if(e.key==='Tab') {
      const buttons=[...el('journal').querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
      if(e.shiftKey&&index<=0){e.preventDefault();buttons.at(-1).focus();}
      else if(!e.shiftKey&&index===buttons.length-1){e.preventDefault();buttons[0].focus();}
    }
  });
  return {open,close,get opened(){return opened;}};
}

export function canRead(apt,player,note) {return note&&Math.hypot(player.x-note.x,player.z-note.z)<2.2&&clearSight(apt,player,note);}
