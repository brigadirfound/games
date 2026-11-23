import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { setupVehicleEnvironment } from './vehicle-materials.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x3d4b56);
setupVehicleEnvironment(renderer, scene);
scene.add(new THREE.HemisphereLight(0xdceaff, 0x82766b, 2));
const light = new THREE.DirectionalLight(0xffe6c5, 3);
light.position.set(-7, 10, 8); scene.add(light);
light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.bias=-.00015;light.shadow.normalBias=.025;scene.add(light.target);
const fill = new THREE.DirectionalLight(0xb9d9ff, 1);
fill.position.set(7, 4, -7); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(100,100), new THREE.MeshStandardMaterial({color:0x53616b,roughness:1}));
ground.rotation.x = -Math.PI/2; ground.position.y=-.02; scene.add(ground);
ground.receiveShadow=true;
const grid = new THREE.GridHelper(100,100,0x768892,0x5d6d77); grid.position.y=-.01; scene.add(grid);
const camera = new THREE.PerspectiveCamera(38,1,.05,600);
const target = new THREE.Vector3();
let yaw=-.75, elevation=.22, distance=10, active;
const select = document.getElementById('model'), status=document.getElementById('status');
const manifest=await (await fetch('./output/vehicle-replacements/candidates.json')).json();
const loader=new GLTFLoader();
const packs=new Map(await Promise.all([...new Set(manifest.map(entry=>entry.file))].map(async file=>[file,await loader.loadAsync('./output/vehicle-replacements/sketchfab-originals/'+file)])));
const entries=await Promise.all(manifest.map(async entry=>{
  const gltf=packs.get(entry.file);
  gltf.scene.updateMatrixWorld(true);
  const root=new THREE.Group(); scene.add(root);
  for(const index of entry.nodes){
    const source=await gltf.parser.getDependency('node',index);
    const clone=source.clone(true); if(source.parent)clone.applyMatrix4(source.parent.matrixWorld);root.add(clone);
  }
  // Sketchfab marks this opaque RGB body atlas as BLEND. Drawing the whole
  // body in the transparent pass lets its far-side wheels cover the near body.
  if(entry.id==='ambulance')root.traverse(object=>{
    if(!object.isMesh||object.material.name!=='ambulance')return;
    object.material=object.material.clone();
    object.material.transparent=false;
    object.material.opacity=1;
    object.material.depthWrite=true;
  });
  if(entry.category==='cars'||entry.category==='service'){
    const anchorIndex=entry.category==='cars'?entry.nodes.find(index=>/body/i.test(gltf.parser.json.nodes[index].name)):entry.nodes[0];
    const anchor=await gltf.parser.getDependency('node',anchorIndex);
    const axis=new THREE.Vector3(1,0,0).transformDirection(anchor.matrixWorld);
    root.rotation.y=Math.atan2(axis.z,axis.x);
  }
  root.rotation.y+=entry.yaw||0;
  root.updateMatrixWorld(true);
  let box=new THREE.Box3().setFromObject(root), size=box.getSize(new THREE.Vector3());
  if(size.x>size.z){root.rotation.y+=Math.PI/2;root.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(root);size=box.getSize(new THREE.Vector3());}
  const scale=entry.length/Math.max(size.x,size.z); root.scale.setScalar(scale);root.updateMatrixWorld(true);
  box=new THREE.Box3().setFromObject(root);
  const center=box.getCenter(new THREE.Vector3());root.position.set(-center.x,-box.min.y,-center.z);
  const normalized=new THREE.Group(); scene.add(normalized);normalized.attach(root);normalized.visible=false;
  let triangles=0;root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;o.castShadow=true;o.receiveShadow=true;}});
  const label=document.createElement('button');label.className='model-label';label.textContent=String(manifest.indexOf(entry)+1).padStart(2,'0');label.title=entry.name;label.onclick=()=>show(entry.id);document.getElementById('labels').append(label);
  return {...entry,root:normalized,triangles,label,labelHeight:box.max.y-box.min.y+.5};
}));
// Keep catalog order stable even when small models download first.
select.replaceChildren(...manifest.map((entry,i)=>new Option(`${String(i+1).padStart(2,'0')} · ${entry.name}`,entry.id)));
function render(){
  const span=active?active.length*1.1:55;
  light.position.copy(target).add(new THREE.Vector3(-12,22,12));light.target.position.copy(target);
  Object.assign(light.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:.5,far:180});light.shadow.camera.updateProjectionMatrix();
  camera.position.set(target.x+Math.sin(yaw)*Math.cos(elevation)*distance,target.y+Math.sin(elevation)*distance,target.z+Math.cos(yaw)*Math.cos(elevation)*distance);camera.lookAt(target);renderer.render(scene,camera);
  for(const entry of entries){
    const point=new THREE.Vector3(entry.root.position.x,entry.labelHeight,entry.root.position.z).project(camera);
    entry.label.hidden=!!active||!entry.root.visible||Math.abs(point.z)>1;
    entry.label.style.left=`${(point.x+1)*innerWidth/2}px`;entry.label.style.top=`${(1-point.y)*innerHeight/2}px`;
  }
}
function show(id){
  if(id==='all'||id==='cars'||id==='service'||id==='bikes')return showRow(id);
  active=entries.find(entry=>entry.id===id);
  yaw=-.75;elevation=.22;
  entries.forEach(entry=>{entry.root.visible=entry===active;entry.root.position.set(0,0,0);});
  const box=new THREE.Box3().setFromObject(active.root); box.getCenter(target);
  distance=box.getSize(new THREE.Vector3()).length()*1.6;
  select.value=id;
  status.textContent=`${active.name} · ${active.triangles.toLocaleString('ru')} треугольников · ${active.note}`;
  render();
}
function showRow(kind='all'){
  active=null;const selected=entries.filter(e=>kind==='all'||e.category===kind);
  entries.forEach(e=>{e.root.visible=selected.includes(e);e.root.position.set(0,0,0);});
  const box=new THREE.Box3();
  selected.forEach((e,i)=>{e.root.position.x=i*4.6;e.root.updateMatrixWorld(true);box.union(new THREE.Box3().setFromObject(e.root));});
  box.getCenter(target);const size=box.getSize(new THREE.Vector3());select.value='';
  yaw=-.12;elevation=.42;distance=Math.max(size.x/camera.aspect,size.z)*1.6+8;
  status.textContent=`${selected.length} моделей · выбери номер для осмотра крупно`;
  render();
}
let catalogImage;
function buildCatalog(){
  const cards=document.getElementById('cards');cards.replaceChildren();
  const sheet=document.createElement('canvas');sheet.width=1600;sheet.height=Math.ceil(entries.length/4)*290+70;
  const ctx=sheet.getContext('2d');ctx.fillStyle='#202b34';ctx.fillRect(0,0,sheet.width,sheet.height);
  ctx.fillStyle='#fff';ctx.font='bold 25px system-ui';ctx.fillText('STA · новый парк для выбора · '+entries.length+' модели',24,43);
  renderer.setPixelRatio(1);renderer.setSize(400,250,false);camera.aspect=1.6;camera.updateProjectionMatrix();
  entries.forEach((entry,i)=>{
    show(entry.id);
    const url=canvas.toDataURL('image/png');
    const x=(i%4)*400,y=Math.floor(i/4)*290+70;
    ctx.drawImage(canvas,x,y,400,250);ctx.fillStyle='#fff';ctx.font='16px system-ui';ctx.fillText(`${String(i+1).padStart(2,'0')} · ${entry.name}`,x+12,y+277);
    const card=document.createElement('button'),img=new Image(),caption=document.createElement('span');
    img.src=url;img.alt=entry.name;caption.textContent=`${String(i+1).padStart(2,'0')} · ${entry.name}`;
    card.append(img,caption);card.onclick=()=>{document.getElementById('catalog').close();show(entry.id);};cards.append(card);
  });
  catalogImage=sheet.toDataURL('image/png');
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));resize();showRow('cars');
}
document.getElementById('open-catalog').onclick=()=>{if(!catalogImage)buildCatalog();document.getElementById('catalog').showModal();};
document.getElementById('close-catalog').onclick=()=>document.getElementById('catalog').close();
document.getElementById('save-catalog').onclick=()=>{const a=document.createElement('a');a.href=catalogImage;a.download='sta-new-vehicle-catalog.png';a.click();};
document.getElementById('all').onclick=()=>showRow('all');
document.getElementById('cars').onclick=()=>showRow('cars');
document.getElementById('service').onclick=()=>showRow('service');
document.getElementById('bikes').onclick=()=>showRow('bikes');
select.onchange=()=>show(select.value);
document.getElementById('front').onclick=()=>{yaw=-.75;elevation=.22;render();};
document.getElementById('rear').onclick=()=>{yaw=Math.PI-.75;elevation=.22;render();};
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{if(!canvas.hasPointerCapture(e.pointerId))return;yaw-=e.movementX*.007;elevation=THREE.MathUtils.clamp(elevation+e.movementY*.004,-.1,1.2);render();};
canvas.onpointerup=e=>{if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);};
canvas.onwheel=e=>{e.preventDefault();distance=THREE.MathUtils.clamp(distance*Math.exp(e.deltaY*.001),2.5,200);render();};
function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();render();}
window.addEventListener('resize',resize);resize();show(new URLSearchParams(location.search).get('model')||'cars');
