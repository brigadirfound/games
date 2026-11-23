import * as THREE from 'three';
// Small deterministic surface texture, generated once, no download or per-frame work.
export function iceTexture() {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#edf7ff';ctx.fillRect(0,0,256,256);
  let seed=1327;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<1800;i++){
    ctx.fillStyle=`rgba(120,180,210,${rand()*.09})`;
    ctx.fillRect(rand()*256,rand()*256,1+rand()*5,1+rand()*3);
  }
  for(let i=0;i<6;i++){
    let x=rand()*256,y=rand()*256;
    ctx.strokeStyle='rgba(65,135,180,.13)';ctx.lineWidth=.7;
    ctx.beginPath();ctx.moveTo(x,y);
    for(let j=0;j<4;j++){x+=(rand()-.5)*48;y+=(rand()-.5)*48;ctx.lineTo(x,y);}ctx.stroke();
  }
  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  return texture;
}
