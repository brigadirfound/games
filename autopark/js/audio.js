/* Web Audio only: never create an HTML media element or a system media player. */
const AutoparkAudio={
  ctx:null,blocked:new Set(['menu']),muted:true,buffer:null,pending:null,source:null,
  sync(){if(!this.ctx)return;const quiet=this.muted||this.blocked.size||document.hidden;if(quiet){this.ctx.suspend().catch(()=>{});return;}this.ctx.resume().then(()=>this.music()).catch(()=>{});},
  block(reason,value){if(value)this.blocked.add(reason);else this.blocked.delete(reason);this.sync();},
  unlock(){this.muted=getMuted();if(this.muted||this.blocked.size||document.hidden)return;try{const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return;this.ctx ||= new Context();this.sync();}catch(e){}},
  async music(){if(this.source||this.muted||this.blocked.size||!this.ctx)return;try{this.pending ||= fetch(asset('assets/audio/game.mp3')).then(r=>{if(!r.ok)throw Error('music');return r.arrayBuffer();}).then(b=>this.ctx.decodeAudioData(b));this.buffer ||= await this.pending;if(this.source||this.muted||this.blocked.size)return;const s=this.ctx.createBufferSource(),g=this.ctx.createGain();s.buffer=this.buffer;s.loop=true;g.gain.value=.24;s.connect(g).connect(this.ctx.destination);s.start();this.source=s;}catch(e){this.pending=null;}},
  play(kind){if(this.muted||this.blocked.size||document.hidden)return;this.unlock();if(!this.ctx)return;const c=this.ctx,o=c.createOscillator(),g=c.createGain(),now=c.currentTime,f={coin:660,buy:290,merge:440,boost:180}[kind]||440;o.type=kind==='merge'?'triangle':'sine';o.frequency.setValueAtTime(f,now);o.frequency.exponentialRampToValueAtTime(f*(kind==='merge'?2:1.2),now+.13);g.gain.setValueAtTime(.018,now);g.gain.exponentialRampToValueAtTime(.001,now+.16);o.connect(g).connect(c.destination);o.start();o.stop(now+.17);}
};
