"use strict";
const LEADERBOARD_NAME="autoparkTotalEarned",STORAGE_PREFIX="autopark_";
function timeout(p,ms=5000){let timer;return Promise.race([Promise.resolve(p),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SDK timeout')),ms);})]).finally(()=>clearTimeout(timer));}
const YandexSDK={
  _cg:typeof document!=='undefined'&&document.documentElement?.dataset.platform==='crazygames',_real:false,_ready:false,_sdk:null,_player:null,_lb:null,_cloudData:null,_cloudWritable:false,_loadingReady:false,_adActive:false,_platformPaused:false,_desiredGameplay:false,_activeGameplay:false,_saveTimer:null,_pendingSave:null,_lastInterstitial:0,
  async init(){
    try{
      if(this._cg){const sdk=window.CrazyGames?.SDK;if(!sdk)throw Error('no SDK');await timeout(sdk.init());this._sdk=sdk;this._real=true;this._detectedLang=normalizeLang(sdk.user?.systemInfo?.locale);sdk.game.loadingStart();if(sdk.game.settings?.muteAudio)audioBlock('portal',true);sdk.game.addSettingsChangeListener?.(s=>audioBlock('portal',!!s.muteAudio));}
      else {const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);if(local||typeof YaGames==='undefined'||!window.__ysdkScriptLoaded)throw Error('no SDK');const sdk=await timeout(YaGames.init());this._sdk=sdk;this._real=true;this._detectedLang=detectLang(sdk);sdk.on?.('game_api_pause',()=>this.setPlatformPause(true));sdk.on?.('game_api_resume',()=>this.setPlatformPause(false));if(sdk.leaderboards)this._lb=sdk.leaderboards;else if(sdk.getLeaderboards)try{this._lb=await timeout(sdk.getLeaderboards());}catch(e){}if(sdk.getPlayer)try{const player=await timeout(sdk.getPlayer({scopes:false}));const data=player?.getData?await timeout(player.getData()):{};this._player=player;this._cloudData=data&&typeof data==='object'?data:{};this._cloudWritable=!!player;}catch(e){this._cloudWritable=false;}}
    }catch(e){}this._ready=true;return this._real;
  },
  read(key){try{return this._cg&&this._real?this._sdk.data.getItem(STORAGE_PREFIX+key):localStorage.getItem(STORAGE_PREFIX+key);}catch(e){return null;}},
  write(key,value){try{if(this._cg&&this._real)this._sdk.data.setItem(STORAGE_PREFIX+key,String(value));else localStorage.setItem(STORAGE_PREFIX+key,String(value));}catch(e){}},
  loadingReady(){if(this._loadingReady)return;this._loadingReady=true;try{if(this._cg)this._sdk?.game.loadingStop();else this._sdk?.features?.LoadingAPI?.ready();}catch(e){}},
  _syncGameplay(){const active=this._desiredGameplay&&!this._adActive&&!this._platformPaused;if(active===this._activeGameplay)return;this._activeGameplay=active;try{if(this._cg)this._sdk?.game[active?'gameplayStart':'gameplayStop']();else this._sdk?.features?.GameplayAPI?.[active?'start':'stop']();}catch(e){}},
  gameplayStart(){this._desiredGameplay=true;this._syncGameplay();},gameplayStop(){this._desiredGameplay=false;this._syncGameplay();},
  setPlatformPause(value){this._platformPaused=value;audioBlock('platform',value);this._syncGameplay();if(typeof window.dispatchEvent==='function')window.dispatchEvent(new CustomEvent('autopark-platform-pause',{detail:{paused:value}}));},
  adsEnabled(){return !this._cg;},
  pauseForAd(){audioBlock('ad',true);this._syncGameplay();},resumeAfterAd(){audioBlock('ad',false);this._syncGameplay();},
  showRewardedAd(onReward,onClose){
    if(!this.adsEnabled()||!this._real||!this._sdk?.adv||this._adActive){onClose?.(false);return;}
    this._adActive=true;this.pauseForAd();let earned=false,finished=false,opened=false;
    const finish=()=>{if(finished)return;finished=true;clearTimeout(timer);this._adActive=false;this.resumeAfterAd();onClose?.(earned);};
    const timer=setTimeout(()=>{if(!opened)finish();},15000);
    try{this._sdk.adv.showRewardedVideo({callbacks:{onOpen:()=>{if(finished)return;opened=true;clearTimeout(timer);},onRewarded:()=>{if(finished||earned)return;earned=true;onReward?.();},onClose:finish,onError:finish}});}catch(e){finish();}
  },
  showFullscreenAd(cb){const now=Date.now();if(!this.adsEnabled()||!this._real||!this._sdk?.adv||this._adActive||now-this._lastInterstitial<180000){cb?.(false);return;}this._adActive=true;this.pauseForAd();let finished=false,opened=false;const finish=shown=>{if(finished)return;finished=true;clearTimeout(timer);this._adActive=false;this.resumeAfterAd();cb?.(!!shown);};const timer=setTimeout(()=>{if(!opened)finish(false);},15000);try{this._sdk.adv.showFullscreenAdv({callbacks:{onOpen:()=>{if(finished)return;opened=true;this._lastInterstitial=Date.now();clearTimeout(timer);},onClose:shown=>finish(shown),onError:()=>finish(false)}});}catch(e){finish(false);}},
  savePlayer(data){let copy;try{copy=JSON.parse(JSON.stringify(data));}catch(e){return;}this.write('player',JSON.stringify(copy));if(this._cg){this._cloudData=copy;return;}this._cloudData=copy;if(!this._real||!this._cloudWritable)return;this._pendingSave=copy;this._queueSave();},
  _nextCloudSaveAt:0,
  _queueSave(){if(this._saveTimer||this._saving||!this._pendingSave)return;this._saveTimer=setTimeout(()=>this.flushSave(),Math.max(5000,this._nextCloudSaveAt-Date.now()));},
  async flushSave(){clearTimeout(this._saveTimer);this._saveTimer=null;if(this._saving)return this._saving;if(!this._pendingSave||!this._cloudWritable)return;const wait=this._nextCloudSaveAt-Date.now();if(wait>0){this._saveTimer=setTimeout(()=>this.flushSave(),wait);return;}const data=this._pendingSave;this._pendingSave=null;this._nextCloudSaveAt=Date.now()+5000;this._saving=(async()=>{try{await timeout(this._player.setData(data));}catch(e){}})();try{await this._saving;}finally{this._saving=null;this._queueSave();}},
  loadPlayer(){let local={};try{local=JSON.parse(this.read('player')||'{}');}catch(e){}if(!local||typeof local!=='object'||Array.isArray(local))local={};const cloud=this._cloudData&&typeof this._cloudData==='object'?this._cloudData:{};const selected=this._cg?local:!Object.keys(cloud).length?local:!Object.keys(local).length?cloud:Number(cloud.lastSeen||0)>=Number(local.lastSeen||0)?cloud:local;return JSON.parse(JSON.stringify(selected));},
  saveHighScore(v){this.write('highScore',v);},loadHighScore(){return Math.max(0,Number(this.read('highScore'))||0);},
  _lastScoreAt:0,_pendingScore:0,_scoreTimer:null,
  submitScore(score){if(this._cg||!this._real||!this._lb)return;this._pendingScore=Math.max(this._pendingScore,Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(Number(score)||0))));const flush=()=>{this._scoreTimer=null;this._lastScoreAt=Date.now();const value=this._pendingScore;this._pendingScore=0;try{Promise.resolve(this._lb.setScore?this._lb.setScore(LEADERBOARD_NAME,value):this._lb.setLeaderboardScore?.(LEADERBOARD_NAME,value)).catch(()=>{});}catch(e){}};const wait=Math.max(0,1100-(Date.now()-this._lastScoreAt));if(!wait)flush();else if(!this._scoreTimer)this._scoreTimer=setTimeout(flush,wait);},
  async getLeaderboard(limit=10){if(!this._real||!this._lb||this._cg)return null;try{const options={quantityTop:limit,includeUser:true,quantityAround:3},result=await timeout(this._lb.getEntries?this._lb.getEntries(LEADERBOARD_NAME,options):this._lb.getLeaderboardEntries(LEADERBOARD_NAME,options));return (result.entries||[]).map((e,i)=>({rank:e.rank??i+1,name:e.player?.getName?.()||e.player?.publicName||t('anonymous'),score:e.score,photo:null}));}catch(e){return null;}}
};
function audioBlock(reason,value){if(typeof AutoparkAudio!=='undefined')AutoparkAudio.block(reason,value);}
function getMuted(){const v=YandexSDK.read('muted');return v===null?true:v==='1';}
function setMuted(game,value){const muted=!!value;YandexSDK.write('muted',muted?'1':'0');if(typeof AutoparkAudio!=='undefined'){AutoparkAudio.muted=muted;AutoparkAudio.sync();if(!muted)AutoparkAudio.unlock();}return muted;}
function normalizeLang(v){const l=String(v||'').toLowerCase().split('-')[0];return l==='ru'?'ru':l==='en'?'en':YandexSDK._cg?'en':'ru';}
function detectLang(sdk){return normalizeLang(sdk?.environment?.i18n?.lang||(typeof navigator!=='undefined'?navigator.language:'ru'));}
YandexSDK._detectedLang=YandexSDK._cg?'en':detectLang(null);
function getLang(){const s=YandexSDK.read('lang');return s==='en'||s==='ru'?s:YandexSDK._detectedLang;}
function setLang(lang){YandexSDK.write('lang',lang==='en'?'en':'ru');applyTitle();}
function applyTitle(){try{document.title=t('gameTitle');document.documentElement.lang=getLang();}catch(e){}}

const I18N={ru:{gameTitle:"Автопарк",buy:"КУПИТЬ МАШИНУ",track:"НА ТРАССУ",offline:"Пока тебя не было",claim:"ЗАБРАТЬ",boost:"Буст ×3 📺",free:"Бесплатная машина 📺",prestige:"Переезд в новый город",autoBuy:"Автопокупка",autoMerge:"Автомерж",parking:"ПАРКОВКА",city:"ГОРОД",max:"МАКС.",daily:"СЕРИЯ",dailyClaim:"ПОДАРОК ДНЯ",dailyTaken:"ЗАВТРА НОВЫЙ ПОДАРОК",order:"ЗАКАЗ ГОРОДА",orderReady:"ЗАБРАТЬ НАГРАДУ",orderDone:"Заказ выполнен!",orderNeed:"Круги машиной",reward:"НАГРАДА",collection:"КОЛЛЕКЦИЯ",garage:"ГАРАЖ МОДЕЛЕЙ",newModel:"Новая модель",rare:"РЕДКАЯ",play:"ИГРАТЬ",settings:"НАСТРОЙКИ",resume:"ПРОДОЛЖИТЬ",soundOn:"ЗВУК: ВКЛ",soundOff:"ЗВУК: ВЫКЛ",language:"ЯЗЫК",howTo:"Покупай машины · объединяй одинаковые · отправляй на трассу",welcome:"СОБЕРИ СВОЙ АВТОПАРК",pause:"ПАУЗА",vip:"VIP-ПОЛОСА",vipReady:"VIP-ПОЛОСА ×2",vipActive:"VIP: первая машина на трассе ×2",eventRush:"ЧАС ПИК",chainReward:"Серия слияний! +{reward} монет",tutorial:"ПЕРВЫЕ ШАГИ",tutBuy:"Купи первую машину",tutMerge:"Объедини две одинаковые машины",tutTrack:"Отправь машину на трассу",tutOrder:"Забери награду за заказ",tutDone:"Обучение завершено!",achievement:"ДОСТИЖЕНИЕ",ach_model5:"Модель L5",ach_model10:"Модель L10",ach_rare:"Редкая раскраска",ach_fullTrack:"Полная трасса",ach_sevenDays:"Серия 7 дней",ach_orders10:"10 заказов",ach_newCity:"Новый город"},en:{gameTitle:"Autopark",buy:"BUY CAR",track:"TO TRACK",offline:"While you were away",claim:"COLLECT",boost:"×3 Boost 📺",free:"Free car 📺",prestige:"Move to new city",autoBuy:"Auto-buy",autoMerge:"Auto-merge",parking:"PARKING",city:"CITY",max:"MAX",daily:"STREAK",dailyClaim:"DAILY GIFT",dailyTaken:"NEW GIFT TOMORROW",order:"CITY ORDER",orderReady:"COLLECT REWARD",orderDone:"Order complete!",orderNeed:"Car laps",reward:"REWARD",collection:"COLLECTION",garage:"MODEL GARAGE",newModel:"New model",rare:"RARE",play:"PLAY",settings:"SETTINGS",resume:"RESUME",soundOn:"SOUND: ON",soundOff:"SOUND: OFF",language:"LANGUAGE",howTo:"Buy cars · merge equals · send them to the track",welcome:"BUILD YOUR CAR PARK",pause:"PAUSED",vip:"VIP LANE",vipReady:"VIP LANE ×2",vipActive:"VIP: first track car ×2",eventRush:"RUSH HOUR",chainReward:"Merge chain! +{reward} coins",tutorial:"FIRST STEPS",tutBuy:"Buy your first car",tutMerge:"Merge two equal cars",tutTrack:"Send a car to the track",tutOrder:"Collect an order reward",tutDone:"Tutorial complete!",achievement:"ACHIEVEMENT",ach_model5:"Level 5 model",ach_model10:"Level 10 model",ach_rare:"Rare paint",ach_fullTrack:"Full track",ach_sevenDays:"7-day streak",ach_orders10:"10 orders",ach_newCity:"New city"}};
I18N.ru.garageHint="Открывай модели покупками и мерджем. Золотая рамка — редкая раскраска.";
I18N.en.garageHint="Unlock models by buying and merging. A gold frame marks a rare paint.";
I18N.ru.garageShort="ГАРАЖ";
I18N.en.garageShort="GARAGE";
I18N.ru.vipActiveShort="VIP ×2 · ВКЛ";
I18N.en.vipActiveShort="VIP ×2 · ON";
I18N.ru.nextModel="СЛЕДУЮЩАЯ МОДЕЛЬ";
I18N.en.nextModel="NEXT MODEL";
I18N.ru.goalBuyMore="Купи ещё {n} машину L{level}";
I18N.en.goalBuyMore="Buy {n} more L{level} car";
I18N.ru.goalMerge="Объедини две машины L{level}";
I18N.en.goalMerge="Merge two L{level} cars";
I18N.ru.goalBuildPair="Собери пару L{level} · {count}/2";
I18N.en.goalBuildPair="Build an L{level} pair · {count}/2";
I18N.ru.tutOrder="Сделай круги и забери награду";
I18N.en.tutOrder="Make laps, then collect the reward";
I18N.ru.orderShort="{title} · {progress}/{goal}";
I18N.en.orderShort="{title} · {progress}/{goal}";
I18N.ru.orderLaps="КРУГИ L{level}";
I18N.en.orderLaps="L{level} LAPS";
I18N.ru.orderMerge="МЕРДЖИ L{level}";
I18N.en.orderMerge="L{level} MERGES";
I18N.ru.orderFleet="МАШИНЫ НА ТРАССУ";
I18N.en.orderFleet="CARS TO TRACK";
I18N.ru.prestigeNeed="Нужна машина L{level}";
I18N.en.prestigeNeed="Reach car L{level}";
I18N.ru.prestigeTitle="ПЕРЕЕЗД В НОВЫЙ ГОРОД";
I18N.en.prestigeTitle="MOVE TO A NEW CITY";
I18N.ru.prestigeIncome="Доход навсегда +{gain}% · ×{multiplier}";
I18N.en.prestigeIncome="Permanent income +{gain}% · ×{multiplier}";
I18N.ru.prestigeReset="Машины, монеты и цены на покупку начнутся заново. Коллекция и постоянный множитель останутся.";
I18N.en.prestigeReset="Cars, coins, and purchase prices restart. Your collection and permanent multiplier stay.";
I18N.ru.prestigeMove="ПЕРЕЕХАТЬ";
I18N.en.prestigeMove="MOVE";
I18N.ru.cancel="ОТМЕНА";
I18N.en.cancel="CANCEL";
I18N.ru.seedUnlocked="Открыто производство машин L{level}";
I18N.en.seedUnlocked="L{level} car production unlocked";
I18N.ru.autoWait="ЖДЁТ СЛОТ";
I18N.en.autoWait="WAITING FOR SLOT";
I18N.ru.arrivalTitle="НОВЫЙ ГОРОД ОТКРЫТ";
I18N.en.arrivalTitle="NEW CITY UNLOCKED";
I18N.ru.arrivalBonus="Постоянный доход ×{multiplier}";
I18N.en.arrivalBonus="Permanent income ×{multiplier}";
I18N.ru.arrivalGo="НАЧАТЬ РАБОТУ";
I18N.en.arrivalGo="START WORK";
I18N.ru.garageStats="МОДЕЛИ {found}/25 · РЕДКИЕ {rare} · 🏆 {ach}/7";
I18N.en.garageStats="MODELS {found}/25 · RARE {rare} · 🏆 {ach}/7";
I18N.ru.collectionGoal="КОЛЛЕКЦИЯ {found}/{goal}\nНАГРАДА +{reward} 🪙";
I18N.en.collectionGoal="COLLECTION {found}/{goal}\nREWARD +{reward} 🪙";
I18N.ru.collectionComplete="КОЛЛЕКЦИЯ СОБРАНА!";
I18N.en.collectionComplete="COLLECTION COMPLETE!";
I18N.ru.achievementGoal="ЦЕЛЬ: {title}\n{progress}/{goal} · +{reward} 🪙";
I18N.en.achievementGoal="GOAL: {title}\n{progress}/{goal} · +{reward} 🪙";
I18N.ru.achievementComplete="ВСЕ ДОСТИЖЕНИЯ ОТКРЫТЫ!";
I18N.en.achievementComplete="ALL ACHIEVEMENTS UNLOCKED!";
I18N.ru.collectionMilestone="КОЛЛЕКЦИЯ {goal}/25";
I18N.en.collectionMilestone="COLLECTION {goal}/25";
I18N.ru.garageRewards="НАГРАДЫ ГАРАЖА";
I18N.en.garageRewards="GARAGE REWARDS";
I18N.ru.cityUpgrade="РАЗВИТИЕ";
I18N.en.cityUpgrade="UPGRADES";
I18N.ru.trackCars="МАШИНЫ {current}/{capacity}";
I18N.en.trackCars="CARS {current}/{capacity}";
I18N.ru.cityUpgradeTitle="РАЗВИТИЕ ГОРОДА";
I18N.en.cityUpgradeTitle="CITY DEVELOPMENT";
I18N.ru.cityUpgradeTrack="НОВАЯ ПОЛОСА";
I18N.en.cityUpgradeTrack="NEW LANE";
I18N.ru.cityUpgradeTrackDesc="+1 место на трассе";
I18N.en.cityUpgradeTrackDesc="+1 track slot";
I18N.ru.cityUpgradeVip="VIP-ПОЛОСА";
I18N.en.cityUpgradeVip="VIP LANE";
I18N.ru.cityUpgradeVipDesc="Первая машина зарабатывает ×2";
I18N.en.cityUpgradeVipDesc="First car earns ×2";
I18N.ru.cityUpgradeIncome="СЕРВИСНЫЙ ЦЕНТР";
I18N.en.cityUpgradeIncome="SERVICE CENTER";
I18N.ru.cityUpgradeIncomeDesc="Весь доход +15%";
I18N.en.cityUpgradeIncomeDesc="All income +15%";
I18N.ru.cityUpgradeOffline="НОЧНАЯ СМЕНА";
I18N.en.cityUpgradeOffline="NIGHT SHIFT";
I18N.ru.cityUpgradeOfflineDesc="Оффлайн-доход +25%";
I18N.en.cityUpgradeOfflineDesc="Offline income +25%";
I18N.ru.cityInstalled="✓ УСТАНОВЛЕНО";
I18N.en.cityInstalled="✓ INSTALLED";
I18N.ru.cityMax="✓ МАКСИМУМ";
I18N.en.cityMax="✓ MAXED";
I18N.ru.cityUpgradeHint="ДОСТУПНО РАЗВИТИЕ ГОРОДА";
I18N.en.cityUpgradeHint="CITY UPGRADE AVAILABLE";
I18N.ru.needCoins="Нужно {amount} 🪙";
I18N.en.needCoins="Need {amount} 🪙";
I18N.ru.needMoreCoins="Нужно ещё {amount} монет";
I18N.en.needMoreCoins="Need {amount} more coins";
I18N.ru.parkingFullHint="Освободи слот или отправь машину на трассу";
I18N.en.parkingFullHint="Free a slot or send a car to the track";
I18N.ru.trackFull="Трасса заполнена · добавь место в «Развитии»";
I18N.en.trackFull="Track is full · add a slot in Upgrades";
I18N.ru.perSecond="сек";
I18N.en.perSecond="sec";
I18N.ru.secondShort="с";
I18N.en.secondShort="s";
I18N.ru.minuteShort="м";
I18N.en.minuteShort="m";
I18N.ru.statusOn="ВКЛ";
I18N.en.statusOn="ON";
I18N.ru.statusOff="ВЫКЛ";
I18N.en.statusOff="OFF";
I18N.ru.boostActive="Доход ×{multiplier} на {minutes} мин!";
I18N.en.boostActive="Income ×{multiplier} for {minutes} min!";
I18N.ru.noFreeSlot="Нет свободного слота";
I18N.en.noFreeSlot="No free slot";
I18N.ru.freeCarReceived="Бесплатная машина L{level}";
I18N.en.freeCarReceived="Free L{level} car";
I18N.ru.offlineDetails="до {hours} ч · {percent}% от онлайн-дохода";
I18N.en.offlineDetails="up to {hours}h · {percent}% of online income";
I18N.ru.doubleReward="×2 📺 за рекламу";
I18N.en.doubleReward="×2 📺 watch ad";
I18N.ru.trackSlots="Трасса {current}/{capacity}";
I18N.en.trackSlots="Track {current}/{capacity}";
I18N.ru.slotPrice="+слот {cost}";
I18N.en.slotPrice="+slot {cost}";
I18N.ru.anonymous="Игрок";
I18N.en.anonymous="Player";
function t(key){return(I18N[getLang()]||I18N.ru)[key]||key;}
applyTitle();

I18N.ru.howTo='Покупай машины. Перетащи одну на такую же или выбери их по очереди, чтобы объединить. Отправляй машины на трассу — каждый круг приносит монеты.';
I18N.en.howTo='Buy cars. Drag a car onto a matching one, or select the pair in turn to merge. Send cars to the track — every lap earns coins.';
