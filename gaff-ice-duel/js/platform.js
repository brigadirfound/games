import { CONFIG } from './config.js';
const cg = document.documentElement.dataset.platform === 'crazygames';
const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const state = { sdk:null, player:null, cloud:{}, lang:'en', playing:false, ready:false, ad:false, lastAd:0, paused:false };
const dirty = new Map();
let hooks = {}, saving = false, timer;
const normalize = value => String(value || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
const bounded = (promise, ms = 7000) => new Promise((resolve,reject) => {
  const t=setTimeout(()=>reject(new Error('timeout')),ms);
  Promise.resolve(promise).then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});
});
function script(src) { return bounded(new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.head.appendChild(s);
})); }
function read(key) { try {return JSON.parse(localStorage.getItem('bagor.'+key));} catch{return null;} }
function write(key,value) {try{localStorage.setItem('bagor.'+key,JSON.stringify(value));}catch{}}
function signal(name,value) {window.dispatchEvent(new CustomEvent(name,{detail:value}));}
function invoke(fn) {try{fn?.();}catch{}}
async function flush() {
  if(saving||!state.player||!dirty.size)return;
  saving=true;const batch=new Map(dirty);
  try {await bounded(state.player.setData(Object.fromEntries(batch)));
    for(const [key,value] of batch)if(dirty.get(key)===value)dirty.delete(key);
  } catch {} finally {saving=false;if(dirty.size)timer=setTimeout(flush,5000);}
}
const testAds=local&&new URLSearchParams(location.search).get('testAds')==='1';
export const Platform={
  async init(){
    state.lang=normalize(navigator.language);
    try{
      if(cg){
        if(!window.CrazyGames?.SDK)await script('https://sdk.crazygames.com/crazygames-sdk-v3.js');
        const sdk=window.CrazyGames.SDK;await bounded(Promise.resolve().then(()=>sdk.init()));state.sdk=sdk;
        state.lang=normalize(sdk.user?.systemInfo?.locale||'en');invoke(()=>sdk.game.loadingStart());
        const mute=()=>signal('platform-audio',Boolean(sdk.game.settings?.muteAudio));
        invoke(()=>sdk.game.addSettingsChangeListener(mute));mute();
      }else if(!local||window.YaGames){
        if(!window.YaGames)await script('/sdk.js');
        state.sdk=await bounded(Promise.resolve().then(()=>window.YaGames.init()));
        state.lang=normalize(state.sdk.environment?.i18n?.lang);
        state.sdk.on?.('game_api_pause',()=>{state.paused=true;this.gameplayStop();signal('platform-pause',true);});
        state.sdk.on?.('game_api_resume',()=>{state.paused=false;signal('platform-pause',false);});
        const player=await bounded(state.sdk.getPlayer());
        const data=await bounded(player.getData());state.cloud=data||{};state.player=player;
      }
    }catch{/* Play offline; never overwrite cloud data that could not be read. */}
    return {available:Boolean(state.sdk),lang:state.lang};
  },
  configure(options={}){hooks=options;},getLanguage(){return state.lang;},
  isPaused(){return state.paused || state.ad;},
  loadingReady(){if(state.ready)return;state.ready=true;invoke(()=>cg?state.sdk?.game.loadingStop():state.sdk?.features?.LoadingAPI?.ready());},
  gameplayStart(){if(state.playing||state.ad)return;state.playing=true;invoke(()=>cg?state.sdk?.game.gameplayStart():state.sdk?.features?.GameplayAPI?.start());},
  gameplayStop(){if(!state.playing)return;state.playing=false;invoke(()=>cg?state.sdk?.game.gameplayStop():state.sdk?.features?.GameplayAPI?.stop());},
  isRewardedAvailable(){return !cg&&(Boolean(state.sdk?.adv?.showRewardedVideo)||testAds);},
  async showRewardedAd(){return this._ad(true);},
  async showInterstitial({placement}){
    if(cg||!['match_result','menu_transition'].includes(placement)||Date.now()-state.lastAd<180000)return {shown:false};
    return this._ad(false);
  },
  async _ad(reward){
    if(state.ad||cg)return {shown:false,rewarded:false};
    const method=reward?'showRewardedVideo':'showFullscreenAdv';
    if(!state.sdk?.adv?.[method]&&!(testAds&&reward))return {shown:false,rewarded:false};
    state.ad=true;this.gameplayStop();invoke(hooks.onAdOpen);
    return new Promise(resolve=>{
      let done=false,rewarded=false;
      const finish=(shown=false)=>{if(done)return;done=true;
        if(shown&&!reward)state.lastAd=Date.now();state.ad=false;invoke(hooks.onAdClose);resolve({shown,rewarded});};
      if(testAds&&!state.sdk?.adv?.[method]){rewarded=true;setTimeout(()=>finish(true),400);return;}
      try{state.sdk.adv[method]({callbacks:{onRewarded:()=>{if(!done)rewarded=true;},
        onClose:shown=>finish(reward||Boolean(shown)),onError:()=>finish(false),onOffline:()=>finish(false)}});
      }catch{finish(false);}
    });
  },
  async savePlayer(key,value){
    const copy=JSON.parse(JSON.stringify(value));state.cloud[key]=copy;
    if(cg){invoke(()=>state.sdk?.data.setItem('bagor.'+key,JSON.stringify(copy)));}
    else{write(key,copy);dirty.set(key,copy);clearTimeout(timer);timer=setTimeout(flush,1500);}
    return true;
  },
  async loadPlayer(key,fallback=null){
    if(cg){try{const raw=state.sdk?.data.getItem('bagor.'+key);if(raw!=null)return JSON.parse(raw);}catch{}
      return state.cloud[key]??fallback;}
    return state.cloud[key]??read(key)??fallback;
  },
  playerId(){try{return state.player?.getUniqueID?.()??null;}catch{return null;}},
  async isLeaderboardAvailable(){if(cg||!state.sdk?.leaderboards)return false;
    try{return Boolean(await bounded(state.sdk.isAvailableMethod('leaderboards.setScore')));}catch{return false;}},
  async submitScore({board,score}){if(cg||!Number.isFinite(score))return false;
    try{await bounded(state.sdk.leaderboards.setScore(board,Math.max(0,Math.floor(score))));return true;}catch{return false;}},
  async getLeaderboard({board,limit=10}){if(cg)return null;
    try{return (await bounded(state.sdk.leaderboards.getEntries(board,{quantityTop:limit,includeUser:true,quantityAround:3}))).entries;}catch{return null;}},
  get canLinkToCatalog(){return !cg&&Boolean(state.sdk&&CONFIG.catalogAppId);}
};
addEventListener('pagehide',flush);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flush();});
