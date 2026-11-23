import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// Furnish public spaces in metres. Paths always connect all four pavements;
// furniture belongs beside a route, never in its centre.
export class CityLife {
  constructor(city) {
    this.city = city;
    this.geos = [];
    this.water = [];
    this.activitySpots = [];
    this.benches = [];
    this.birdHomes = [];
    this.lamps = [];
    this.lampMaterial = new THREE.MeshBasicMaterial({color:0xd5c8a3});
    city.parks.forEach((p, i) => this.park(p, i));
    this.busStops();
    if (this.geos.length) {
      const mesh = new THREE.Mesh(mergeGeometries(this.geos), new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.name = 'Public space furniture'; mesh.castShadow = true; mesh.receiveShadow = true;
      city.scene.add(mesh); this.geos.forEach(g => g.dispose()); this.geos.length = 0;
    }
    // 24 birds, one instanced draw, circling the parks above roof height.
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute([
      0,0,0.35, -0.75,0.12,0, -0.12,0,-0.2,
      0,0,0.35, 0.12,0,-0.2, 0.75,0.12,0,
    ], 3));
    shape.computeVertexNormals();
    this.birds = new THREE.InstancedMesh(shape, new THREE.MeshLambertMaterial({ color: 0x616469, side: THREE.DoubleSide }), 24);
    this.birds.name = 'Park birds'; this.birds.frustumCulled = false;
    city.scene.add(this.birds);
    this.matrix = new THREE.Matrix4(); this.rotation = new THREE.Quaternion();
    this.position = new THREE.Vector3(); this.scale = new THREE.Vector3(); this.axis = new THREE.Vector3(0, 1, 0);
    // A fixed pool lights only nearby paths, with no shadow cube maps.
    this.pathLights=Array.from({length:4},()=>{
      const light=new THREE.PointLight(0xffd797,0,15,2);city.scene.add(light);return light;
    });
    this.update(0);
  }

  geometry(g, color, x, y, z, angle = 0) {
    if (g.index) { const indexed=g; g=g.toNonIndexed(); indexed.dispose(); }
    const c = new THREE.Color(color), count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.rotateY(angle); g.translate(x, y, z); this.geos.push(g);
  }
  box(w, h, d, x, y, z, color, angle = 0) {
    this.geometry(new THREE.BoxGeometry(w, h, d), color, x, y, z, angle);
  }
  bench(x, z, angle = 0) {
    const y = 0.38, cs = Math.cos(angle), sn = Math.sin(angle);
    const put = (w,h,d,u,v,color,yy) => this.box(w,h,d,x+u*cs+v*sn,y+yy,z-u*sn+v*cs,color,angle);
    for (const u of [-0.8,0.8]) {
      put(0.09,0.55,0.65,u,0,0x343f3d,0.28);
      put(0.09,0.48,0.09,u,0.26,0x343f3d,0.70);
    }
    for (let n=0;n<4;n++) put(2.15,0.065,0.12,0,-0.24+n*0.15,0x916c48,0.5);
    for (let n=0;n<3;n++) put(2.15,0.10,0.07,0,0.29,0x916c48,0.68+n*0.14);
    const wx = Math.abs(cs)*1.12 + Math.abs(sn)*0.37, wz = Math.abs(sn)*1.12+Math.abs(cs)*0.37;
    this.city.addCollider(x-wx,z-wz,x+wx,z+wz,y+.533,'bench',y);
    const backX=x+.29*sn, backZ=z+.29*cs;
    const backWidth=Math.abs(cs)*1.075+Math.abs(sn)*.035;
    const backDepth=Math.abs(sn)*1.075+Math.abs(cs)*.035;
    this.city.addCollider(backX-backWidth,backZ-backDepth,backX+backWidth,backZ+backDepth,
      y+1.01,'bench-back',y+.6);
    this.benches.push({x,z,angle});
  }
  park(p, i) {
    const c = this.city, x=p.x, z=p.z;
    const path = 0xc2b8a1, edge = 0x999b88;
    // A flush cross and central square: no raised paving trapping pedestrians.
    for (const s of [-1,1]) {
      const armX=(p.w+6.8-13)/2, armZ=(p.h+6.8-13)/2;
      this.box(armX,0.07,5.6,x+s*(6.5+armX/2),0.405,z,path);
      this.box(5.6,0.07,armZ,x,0.405,z+s*(6.5+armZ/2),path);
    }
    this.box(13,0.07,13,x,0.405,z,path);
    for (const s of [-1,1]) {
      for(const side of [-1,1]) {
        this.box((p.w-13)/2,0.08,0.18,x+side*(p.w+13)/4,0.42,z+s*3.0,edge);
        this.box(0.18,0.08,(p.h-13)/2,x+s*3.0,0.42,z+side*(p.h+13)/4,edge);
      }
    }
    // Centrepiece varies between a planted square and a working fountain.
    if (i % 3 !== 1) {
      this.geometry(new THREE.CylinderGeometry(2.8,2.9,0.30,24),0xaaa99d,x,0.56,z);
      const rim = new THREE.TorusGeometry(2.68,0.18,6,32);rim.rotateX(Math.PI/2);
      this.geometry(rim,0xc3beb0,x,0.82,z);
      const wm = new THREE.MeshPhongMaterial({color:0x527f83,shininess:75,transparent:true,opacity:0.82});
      const water = new THREE.Mesh(new THREE.CircleGeometry(2.55,32),wm);
      water.rotation.x=-Math.PI/2;water.position.set(x,0.805,z);water.name='Park fountain';c.scene.add(water);
      this.geometry(new THREE.CylinderGeometry(0.13,0.35,0.9,8),0x676f69,x,1.0,z);
      this.water.push(water);
      const spray = new THREE.BufferGeometry();
      const points=[];
      for(let k=0;k<90;k++){
        const a=k*2.4,t=(k%15)/15;
        points.push(x+Math.cos(a)*t*1.9,0.85+Math.sin(t*Math.PI)*1.5,z+Math.sin(a)*t*1.9);
      }
      spray.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
      const droplets=new THREE.Points(spray,new THREE.PointsMaterial({color:0xc0e0df,size:0.055,transparent:true,opacity:0.7}));
      droplets.name='Fountain spray';c.scene.add(droplets);
      c.addCollider(x-2.85,z-2.85,x+2.85,z+2.85,0.83,'fountain');
    } else {
      this.box(4.4,0.55,4.4,x,0.58,z,0xaaa99d);
      this.box(3.95,0.12,3.95,x,0.90,z,0x445e3d);
      for (let n=0;n<20;n++) this.geometry(new THREE.IcosahedronGeometry(0.18,0),n%2?0xb99d60:0x9b766e,x+(n%5-2)*0.65,1.04,z+(Math.floor(n/5)-1.5)*0.85);
      c.addCollider(x-2.2,z-2.2,x+2.2,z+2.2,1.0,'flowerbed');
    }
    for (const s of [-1,1]) {
      this.bench(x+s*10,z-4.0,Math.PI);
      this.bench(x+s*10,z+4.0,0);
      for (const side of [-1,1]) {
        const lx=x+s*6.8,lz=z+side*6.8;
        this.geometry(new THREE.CylinderGeometry(0.055,0.095,3.6,6),0x384640,lx,2.1,lz);
        this.box(0.5,0.1,0.5,lx,4.0,lz,0x384640);
        const lamp=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.15,0.35,6),this.lampMaterial);
        lamp.position.set(lx,3.78,lz);c.scene.add(lamp);this.lamps.push(lamp.position);
        c.addCollider(lx-.095,lz-.095,lx+.095,lz+.095,3.9,'park-lamp',.3);
      }
      // Low planted edges terminate before the four entrances.
      for (const side of [-1,1]) {
        this.box(12,0.25,1.15,x+s*12,0.5,z+side*(p.h/2-1.1),0x777d66);
        this.box(11.7,0.45,0.95,x+s*12,0.8,z+side*(p.h/2-1.1),0x506844);
        c.addCollider(x+s*12-6,z+side*(p.h/2-1.1)-.575,
          x+s*12+6,z+side*(p.h/2-1.1)+.575,1.025,'hedge',.375);
      }
    }
    // Two-way walking loops around the square, used by real pedestrians.
    p.walkLoop=[{x:x-5,z:z-5},{x:x+5,z:z-5},{x:x+5,z:z+5},{x:x-5,z:z+5}];
    this.activitySpots.push(...p.walkLoop.map(t=>({...t,park:p})));
    this.birdHomes.push(p);
  }
  busStops() {
    const c=this.city;
    this.stops=[];
    // Mid-block shelters occupy the furnishing strip along a few avenues.
    for (const b of c.blockRects) {
      if ((b.i*3+b.j)%11!==0 || b.district==='industrial') continue;
      const x=b.cx,z=b.z0-2.5,y=0.3;
      if(c.blockedAt(x,z,0.85))continue;
      for(const s of [-1,1])this.box(0.09,2.8,0.09,x+s*1.8,y+1.4,z+0.3,0x3d504d);
      this.box(4.2,0.16,1.55,x,y+2.85,z,0x3d504d);
      this.box(3.5,0.13,0.5,x,y+0.5,z+0.25,0x8a7054);
      c.addCollider(x-1.75,z,x+1.75,z+.5,y+.565,'bus-seat',y+.435);
      for (const side of [-1,1]) c.addCollider(x+side*1.8-.045,z+.255,
        x+side*1.8+.045,z+.345,y+2.8,'bus-pillar',y);
      const roof=c.addCollider(x-2.1,z-.775,x+2.1,z+.775,y+2.93,'bus-roof',y+2.77);
      roof.characterOnly=true;
      this.box(0.1,2.3,0.1,x+2.6,y+1.15,z,0x55635e);
      this.box(0.65,0.65,0.08,x+2.6,y+2.4,z,0x537c8b);
      for(const s of [-1,1])this.box(0.08,0.15,0.1,x+2.6+s*0.16,y+2.21,z-0.06,0xe1dbbd);
      this.stops.push({x,z});
    }
  }
  update(time, night=0) {
    this.lampMaterial.color.setRGB(0.3+night*0.7,0.29+night*0.51,0.22+night*0.27);
    if(this.pathLights){
      const eye=this.city.viewPosition || this.lamps[0];
      const nearest=eye?this.lamps.slice().sort((a,b)=>a.distanceToSquared(eye)-b.distanceToSquared(eye)):[];
      this.pathLights.forEach((l,i)=>{if(nearest[i]){l.position.copy(nearest[i]);l.position.y-=0.4;l.intensity=night*30;}else l.intensity=0;});
    }
    for(const [i,w] of this.water.entries()) {
      w.position.y=0.805+Math.sin(time*2+i)*0.018;
      w.material.color.setHSL(0.49,0.22,0.37+Math.sin(time*1.2+i)*0.018);
    }
    if (!this.birdHomes.length) {this.birds.count=0;return;}
    for(let i=0;i<24;i++) {
      const home=this.birdHomes[i%this.birdHomes.length],a=time*0.17+i*2.4,r=8+(i%4)*1.5;
      this.position.set(home.x+Math.cos(a)*r,14+(i%3)*1.2+Math.sin(time*0.6+i),home.z+Math.sin(a)*r);
      this.rotation.setFromAxisAngle(this.axis,-a);
      this.scale.set(0.65,Math.sin(time*6+i)*2,0.65);
      this.matrix.compose(this.position,this.rotation,this.scale);this.birds.setMatrixAt(i,this.matrix);
    }
    this.birds.instanceMatrix.needsUpdate=true;
  }
}
