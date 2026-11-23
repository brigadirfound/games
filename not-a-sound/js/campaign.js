export const STORY_NIGHTS=7;
// V16's three-night ending is deliberately not a seven-night completion.
export const freePlayUnlocked=p=>p.load('campaignCompletedV2',false)===true;
export function storyProgress(p){
  const s=p.load('campaignV2',null);
  if(!s||s.version!==2||!Number.isInteger(s.night)||s.night<1||s.night>STORY_NIGHTS)
    return {version:2,night:1,score:0};
  return {version:2,night:s.night,score:Number.isFinite(s.score)?Math.max(0,Math.min(1e8,Math.floor(s.score))):0};
}
export function checkpoint(p,night,score){
  p.save('campaignV2',{version:2,night:Math.max(1,Math.min(STORY_NIGHTS,night)),score:Math.max(0,Math.floor(score))});
}
export function freeDifficulty(night){
  const t=1-Math.exp(-Math.max(0,night-1)/12);
  return {speed:2.9+1.9*t,hearRange:12+18*t,hearThreshold:.4-.1*t,
    drain:2.2+1.4*t,batteries:6+Math.round(6*t),graceSec:0};
}
export const storySeeds=[0,0,0,0,41827,52733,61219,73157];
