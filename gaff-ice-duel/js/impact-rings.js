import * as THREE from 'three';
// Bounded reusable effects for long matches.
export class ImpactRings {
  constructor(scene) {
    this.items=Array.from({length:10},()=>{
      const mesh=new THREE.Mesh(new THREE.RingGeometry(.75,1,24),new THREE.MeshBasicMaterial({color:0xbdefff,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}));
      mesh.rotation.x=-Math.PI/2;mesh.visible=false;scene.add(mesh);
      return {mesh,life:0,duration:1,size:1};
    });
  }
  emit(x,z,color,size=2,duration=.45,y=.08) {
    const item=this.items.find(i=>i.life<=0)||this.items[0];
    Object.assign(item,{life:duration,duration,size});
    item.mesh.position.set(x,y,z);item.mesh.material.color.setHex(color);
    item.mesh.scale.setScalar(.15);item.mesh.material.opacity=.65;item.mesh.visible=true;
  }
  update(dt) {
    for(const i of this.items){if(i.life<=0)continue;
      i.life=Math.max(0,i.life-dt);const p=1-i.life/i.duration;
      i.mesh.scale.setScalar(.15+p*i.size);i.mesh.material.opacity=(1-p)*.6;i.mesh.visible=i.life>0;
    }
  }
  reset(){for(const i of this.items){i.life=0;i.mesh.visible=false;}}
  dispose(){for(const i of this.items){i.mesh.removeFromParent();i.mesh.geometry.dispose();i.mesh.material.dispose();}}
}
