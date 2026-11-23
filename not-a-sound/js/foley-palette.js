// Original deterministic sound design; no downloaded recordings or voice models.
export const SAMPLE_RATE=22050;
export const DURATIONS={step:.42,drag:.68,cloth:.72,breath:1.55,heart:.55,creak:1.8,latch:.26,door:1.1,paper:.6,cup:.6,lamp:.21,pickup:.38,room:12,settle:1.5};
export function synthesize(kind,variant=0,rate=SAMPLE_RATE){
  const duration=DURATIONS[kind];if(!duration)throw new Error('Unknown foley '+kind);
  const samples=new Float32Array(Math.ceil(duration*rate));let seed=731+variant*971,low=0,air=0,phase=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/2147483648-1;};
  const hit=(t,at,decay)=>t<at?0:(1-Math.exp(-(t-at)*700))*Math.exp(-(t-at)/decay);
  const swell=(t,at,len)=>t<at||t>at+len?0:Math.sin((t-at)/len*Math.PI)**2;
  const pitch=1+variant*.018;
  for(let i=0;i<samples.length;i++){
    const t=i/rate,n=random();low+=.065*(n-low);air+=.38*(n-air);
    const grain=air-low,body=(f,d,at=0)=>Math.sin(2*Math.PI*f*pitch*Math.max(0,t-at))*hit(t,at,d);
    let v=0;
    switch(kind){
      case 'step':v=.45*body(83,.055)+.16*body(146,.04)+grain*.32*hit(t,0,.028)+low*.9*swell(t,.08,.25);break;
      case 'drag':v=.3*body(78,.06)+grain*(.5+.2*Math.sin(t*153))*swell(t,.05,.5)+.12*body(177,.06,.43);break;
      case 'cloth':v=grain*(swell(t,0,.24)*.7+swell(t,.16,.43)*.8)*(.7+.3*Math.sin(t*117)**2);break;
      case 'breath':v=(grain*.7+low*.42)*(swell(t,0,.54)*.36+swell(t,.66,.86)*.6);break;
      case 'heart':v=.6*body(56,.042)+.26*body(47,.057,.155)+low*.35*hit(t,0,.035);break;
      case 'creak':phase+=2*Math.PI*(180+34*Math.sin(t*6)+19*Math.sin(t*31))/rate;v=(Math.sin(phase)+.24*Math.sin(phase*2.7))*.13*swell(t,.12,1.36)*(.2+.8*Math.sin(t*23)**4)+grain*.025;break;
      case 'latch':v=grain*.65*hit(t,0,.015)+.2*body(390,.03)+.11*body(730,.025,.068);break;
      case 'door':v=.46*body(68,.12)+.24*body(119,.08)+grain*.8*hit(t,0,.023)+low*.55*hit(t,0,.17)+.09*body(210,.07,.055)+grain*.16*hit(t,.065,.016)+.07*body(74,.17,.09);break;
      case 'paper':v=grain*(swell(t,0,.2)+swell(t,.18,.26)*.7+swell(t,.39,.18)*.4)*(.4+.4*Math.sin(t*291)**2);break;
      case 'cup':v=.24*body(1270,.17)+.12*body(2060,.11)+.15*body(263,.035)+grain*.1*hit(t,0,.019);break;
      case 'lamp':v=grain*.42*hit(t,0,.009)+.17*body(910,.018)+.08*body(230,.034,.06);break;
      case 'pickup':v=.22*body(910,.065)+.18*body(1610,.048,.04)+grain*.32*hit(t,.065,.02)+low*.32*swell(t,.11,.17);break;
      case 'room':v=low*.065+Math.sin(t*2*Math.PI*48)*.011*(.7+.3*Math.sin(t*2*Math.PI/12));break;
      case 'settle':v=low*.55*swell(t,0,.52)+.11*body(112,.24,.36)+.07*body(169,.32,.48);break;
    }
    samples[i]=v*Math.max(0,Math.min(1,t/.004,(duration-t)/.028));
  }
  return samples;
}
