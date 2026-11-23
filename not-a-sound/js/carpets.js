import * as THREE from 'three';
let texture;
export async function prepareCarpets(){
  texture=await new THREE.TextureLoader().loadAsync(new URL('../assets/textures/soviet-rug-v31.png',import.meta.url).href);
  texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
}
export function createCarpets(apt){
  const group=new THREE.Group();
  const material=new THREE.MeshStandardMaterial({map:texture,roughness:1});
  // One complete woven pattern and border per carpet, including under furniture.
  for(const {x,z,w,d} of apt.rugRects||[]){
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w-.025,d-.025),material);
    mesh.rotation.x=-Math.PI/2;mesh.position.set(x+w/2,1.024,z+d/2);mesh.receiveShadow=true;group.add(mesh);
  }
  return group;
}
