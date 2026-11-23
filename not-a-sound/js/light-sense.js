// Grid occlusion includes furniture. Sample spacing is much smaller than a cell.
export function clearSight(apt,from,to) {
  const steps=Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)*12);
  for(let i=1;i<steps;i++) {
    const x=Math.floor(from.x+(to.x-from.x)*i/steps),z=Math.floor(from.z+(to.z-from.z)*i/steps);
    if(apt.wallGrid[z]?.[x]!==false || apt.occupied?.has(z+','+x))return false;
  }
  return true;
}

export function inBeam(apt,origin,direction,target,angle,range=10) {
  const dx=target.x-origin.x,dy=target.y-origin.y,dz=target.z-origin.z;
  const d=Math.hypot(dx,dy,dz);
  return d>0 && d<=range && (dx*direction.x+dy*direction.y+dz*direction.z)/d>=Math.cos(angle)
    && clearSight(apt,origin,target);
}

// Brief exposure warns first. Sustained light records a place, never tracks through walls.
export function reactToLight(n,dt,lit,playerPos) {
  const previous=n.lightExposure||0;
  n.lightExposure=Math.max(0,Math.min(1.2,previous+(lit?dt:-dt*2)));
  n.lightCooldown=Math.max(0,(n.lightCooldown||0)-dt);
  const noticed=lit&&previous<.15&&n.lightExposure>=.15;
  if(lit&&n.lightExposure>=.75&&!n.lightCooldown) {
    n.cancelInspection?.();
    n.stare=null;n.avoidPoint=null;n.lightAggro=2;
    n.lastHeard={x:playerPos.x,z:playerPos.z}; n.heardAt=performance.now();
    n.state='seeking'; n.pauseLeft=0;
    if(!n.goal||Math.hypot(n.goal.x-playerPos.x,n.goal.z-playerPos.z)>2.5)n.path=[];
    n.lightCooldown=1.5;
    return 'investigate';
  }
  return noticed?'noticed':null;
}
