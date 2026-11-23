import * as THREE from 'three';

const surfaces={
  wood:{roughness:.82,metalness:0,bump:.018,scale:1.2,gain:1.85},
  linen:{roughness:1,metalness:0,bump:.012,scale:1.6,gain:1.9},
  enamel:{roughness:.43,metalness:.08,bump:.006,scale:1,gain:1.65},
  metal:{roughness:.55,metalness:.55,bump:.007,scale:1.6,gain:2.4},
};
const maps=new Map();
let loading;
export function prepareRoomMaterials(){
  return loading??=Promise.all(Object.keys(surfaces).map(async kind=>{
    const map=await new THREE.TextureLoader().loadAsync(new URL(`../assets/textures/room-${kind}-v1.webp`,import.meta.url).href);
    map.wrapS=map.wrapT=THREE.RepeatWrapping;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
    const bump=map.clone();bump.colorSpace=THREE.NoColorSpace;bump.needsUpdate=true;
    maps.set(kind,{map,bump});
  }));
}

// Local metre-scale projection: grain keeps its size on thin trim and large doors.
// Instance translation seeds the pattern without swimming when the group moves.
export function roomMaterial(kind,color=0xffffff){
  const p=surfaces[kind];
  if(!p)return new THREE.MeshStandardMaterial({color,roughness:.94});
  const textures=maps.get(kind);
  const material=new THREE.MeshStandardMaterial({color,roughness:p.roughness,metalness:p.metalness,
    map:textures?.map??null,bumpMap:textures?.bump??null,bumpScale:p.bump});
  material.name=`room-${kind}`;
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>',`#include <uv_vertex>
      #ifdef USE_MAP
        vec3 roomP=position;
        vec3 roomSeed=vec3(0.0);
        #ifdef USE_INSTANCING
          roomP*=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
          roomSeed=instanceMatrix[3].xyz;
        #endif
        vec3 roomN=abs(normal);
        vec2 roomUv=roomN.y>0.7?roomP.xz+roomSeed.xz:
          (roomN.x>0.7?roomP.zy+roomSeed.zy:roomP.xy+roomSeed.xy);
        vMapUv=roomUv*${p.scale.toFixed(2)};
        #ifdef USE_BUMPMAP
          vBumpMapUv=vMapUv;
        #endif
      #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      #ifdef USE_MAP
        diffuseColor.rgb*=${p.gain.toFixed(2)};
      #endif`);
  };
  material.customProgramCacheKey=()=>`room-v1-${kind}`;
  return material;
}
