import * as THREE from 'three';
import { roomMaterial } from './room-materials.js?v=resident-devices-v32';

// Small surface details only: no new invisible obstacles in the existing collision grid.
export function createApartmentDetail(apt) {
  const group=new THREE.Group(), pieces=[],rounds=[];
  const box=(x,y,z,w,h,d,color,ry=0,rz=0)=>pieces.push({x,y,z,w,h,d,color,ry,rz,kind:'wood'});
  const round=(x,y,z,w,h,d,color,rx=0)=>rounds.push({x,y,z,w,h,d,color,rx,kind:'metal'});
  const typedBox=kind=>(...args)=>{box(...args);pieces[pieces.length-1].kind=kind;};
  const cloth=typedBox('linen'),enamel=typedBox('enamel'),metal=typedBox('metal'),plain=typedBox('plain');
  const ceramic=(...args)=>{round(...args);rounds[rounds.length-1].kind='enamel';};
  const openings=new Set(),dressedFaces=new Set();
  function frame(axis,fixed,start,end,sign){
    const key=axis+':'+fixed+':'+start+':'+end+':'+sign;
    if(openings.has(key))return;openings.add(key);
    const center=(start+end+1)/2,width=end-start+1;
    const put=(u,y,depth,w,h,d,col)=>axis==='x'?box(u,y,fixed+sign*depth,w,h,d,col):box(fixed+sign*depth,y,u,d,h,w,col);
    for(const edge of [start-.025,end+1.025]){
      put(edge,2.41,.055,.105,2.82,.11,0x443b30);
      put(edge,2.41,.116,.026,2.79,.025,0x80715a);
      put(edge,1.11,.06,.145,.20,.13,0x393027);
    }
    put(center,3.83,.055,width+.18,.16,.11,0x443b30);
    put(center,3.92,.085,width+.23,.035,.15,0x77684f);
    put(center,3.71,-.06,width,.025,.22,0x292720);
  }
  for(let i=0;i<apt.rooms.length;i++) {
    const r=apt.rooms[i], tint=[0x394b42,0x564c3d,0x40464c][i%3];
    // Wainscoting and timber trim follow solid wall faces, never door openings.
    for(let x=r.x0;x<=r.x1;x++) for(const [z,sign] of [[r.z0,1],[r.z1,-1]]) {
      if(!apt.wallGrid[z-sign]?.[x])continue;
      dressedFaces.add(`${x},${z-sign},0,${sign}`);
      const edge=z+(sign<0?1:0);
      box(x+.5,1.52,edge+sign*.025,.98,1.02,.045,tint);
      box(x+.5,2.04,edge+sign*.052,1,.055,.08,0x72654e);
      box(x+.5,1.055,edge+sign*.06,1,.1,.1,0x3a332a);
      box(x+.5,3.86,edge+sign*.05,1,.12,.1,0x655f50);
      box(x+.5,1.13,edge+sign*.079,1,.025,.06,0x71604a);
      box(x+.5,1.52,edge+sign*.053,.018,.93,.016,0x24332d);
    }
    for(let z=r.z0;z<=r.z1;z++) for(const [x,sign] of [[r.x0,1],[r.x1,-1]]) {
      if(!apt.wallGrid[z]?.[x-sign])continue;
      dressedFaces.add(`${x-sign},${z},${sign},0`);
      const edge=x+(sign<0?1:0);
      box(edge+sign*.025,1.52,z+.5,.045,1.02,.98,tint);
      box(edge+sign*.052,2.04,z+.5,.08,.055,1,0x72654e);
      box(edge+sign*.06,1.055,z+.5,.1,.1,1,0x3a332a);
      box(edge+sign*.05,3.86,z+.5,.1,.12,1,0x655f50);
      box(edge+sign*.079,1.13,z+.5,.06,.025,1,0x71604a);
      box(edge+sign*.053,1.52,z+.5,.016,.93,.018,0x24332d);
    }
    // Read actual openings in each boundary. All posts sit on the solid side
    // and the lintels stay above the character; no closed decorative doors.
    for(const [z,sign] of [[r.z0,1],[r.z1,-1]]){
      for(let x=r.x0;x<=r.x1;x++)if(!apt.wallGrid[z-sign]?.[x]){
        const first=x;while(x+1<=r.x1&&!apt.wallGrid[z-sign]?.[x+1])x++;
        if(x-first<4)frame('x',z+(sign<0?1:0),first,x,sign);
      }
    }
    for(const [x,sign] of [[r.x0,1],[r.x1,-1]]){
      for(let z=r.z0;z<=r.z1;z++)if(!apt.wallGrid[z]?.[x-sign]){
        const first=z;while(z+1<=r.z1&&!apt.wallGrid[z+1]?.[x-sign])z++;
        if(z-first<4)frame('z',x+(sign<0?1:0),first,z,sign);
      }
    }
    // Radiator only: framed photographs are placed by buildWallArt, avoiding
    // the previous duplicate portrait that covered its stopped clock.
    const x=r.x0+1.5,z=r.z0+.09;
    if(!(apt.authoredHome&&i===1)&&apt.wallGrid[r.z0-1]?.[Math.floor(x)]&&!apt.occupied?.has(r.z0+','+Math.floor(x))) {
      // Radiator remains almost flush against the wall.
      for(let j=0;j<7;j++)enamel(x-.48+j*.16,1.52,z+.045,.105,.61,.13,0x807c67);
      enamel(x,1.26,z+.055,1.15,.045,.1,0x696957);
    }
  }
  // Merged rooms expose wall strips outside the original room rectangles.
  // Dress every remaining exposed grid face, including corridor junctions.
  for(let z=0;z<apt.wallGrid.length;z++)for(let x=0;x<apt.wallGrid[z].length;x++){
    if(!apt.wallGrid[z][x])continue;
    for(const [nx,nz]of [[1,0],[-1,0],[0,1],[0,-1]]){
      if(apt.wallGrid[z+nz]?.[x+nx]!==false||dressedFaces.has(`${x},${z},${nx},${nz}`))continue;
      const nearest=apt.rooms.reduce((best,r,i)=>{
        const distance=Math.hypot(r.cx-(x+nx+.5),r.cz-(z+nz+.5));
        return !best||distance<best.distance?{i,distance}:best;
      },null);
      const tint=[0x394b42,0x564c3d,0x40464c][(nearest?.i||0)%3];
      const face=(y,offset,w,h,d,color)=>box(x+.5+nx*(.5+offset),y,z+.5+nz*(.5+offset),nx?d:w,h,nx?w:d,color);
      face(1.52,.025,.98,1.02,.045,tint);
      face(2.04,.052,1,.055,.08,0x72654e);
      face(1.055,.06,1,.1,.1,0x3a332a);
      face(3.86,.05,1,.12,.1,0x655f50);
      face(1.13,.079,1,.025,.06,0x71604a);
      face(1.52,.053,.018,.93,.016,0x24332d);
    }
  }
  if(apt.authoredHome) {
    // First-room art prototype. Large furniture wraps the existing (2,6) solid
    // cell; window, pipes and curtains stay against walls, clear of the lesson.
    box(2.5,1.53,6.5,1.035,.96,1.035,0x302c23);
    box(2.5,2.03,6.5,1.10,.075,1.09,0x6b5238);
    for(const y of [1.27,1.59,1.88]) {
      box(2.5,y,5.974,.90,.245,.035,0x594430);
      box(2.5,y+.084,5.950,.83,.018,.014,0x7c6346);
      metal(2.5,y,5.92,.18,.025,.04,0x9a8862);
    }
    // Uneven books, a cup and an old shaded lamp on the sideboard.
    for(let i=0;i<3;i++)cloth(2.75,2.10+i*.048,6.57,.35,.04,.46,[0x574a35,0x6c6550,0x303d36][i],.06*i);
    enamel(2.65,2.28,6.56,.115,.17,.115,0x9a947e);
    enamel(2.73,2.29,6.56,.047,.065,.04,0x8b8672);
    metal(2.24,2.10,6.60,.29,.065,.29,0x46402e);
    metal(2.24,2.32,6.60,.034,.41,.034,0x9a7950);
    for(let i=0;i<6;i++)cloth(2.24,2.51+i*.04,6.60,.44-i*.029,.043,.44-i*.029,0x978363);
    metal(2.24,2.49,6.60,.45,.023,.45,0x392d20);
    // A cold window at the far side of the opening room, with deep timber reveals.
    box(7.95,2.83,2.55,.085,1.64,1.75,0x252d2b);
    plain(7.888,2.83,2.55,.035,1.40,1.51,0x273e48);
    for(const z of [1.74,2.55,3.36])box(7.83,2.83,z,.17,1.62,.075,0x726f60);
    for(const y of [2.06,2.84,3.60])box(7.83,y,2.55,.17,.067,1.76,0x858170);
    box(7.72,2.05,2.55,.43,.095,1.92,0x797665);
    for(const z of [1.56,3.54])for(let i=0;i<5;i++){
      const zz=z+(i-2)*.064;
      cloth(7.74+(i%2)*.045,2.74,zz,.09,1.80-(i%3)*.035,.074,i%2?0x5a5949:0x74715b);
    }
    metal(7.73,3.71,2.55,.055,.045,2.2,0x38362c);
    // Dim reflected sky, not an extra player-readable object or pickup.
    const glass=new THREE.Mesh(new THREE.PlaneGeometry(1.44,1.32),
      new THREE.MeshStandardMaterial({color:0x2d4148,emissive:0x233e4b,emissiveIntensity:.35,roughness:.55}));
    glass.rotation.y=-Math.PI/2;glass.position.set(7.862,2.83,2.55);group.add(glass);
    // Age reads in depth: a pipe elbow, irregular plaster loss, scratches where
    // the cabinet was dragged, and strips of old tape on an existing wardrobe.
    metal(1.085,2.43,7.72,.075,2.84,.075,0x716551);
    metal(1.33,1.14,7.72,.55,.07,.075,0x605642);
    for(const y of [1.39,2.16,3.33])metal(1.095,y,7.72,.115,.05,.11,0x403d32);
    for(let i=0;i<8;i++)box(2.10+(i%2)*.76+(i%3)*.023,1.022,5.65-i*.08,.013,.003,.70-i*.035,0x75624a,.025*(i-3));
    // Kitchen: the existing (10,2) solid cell becomes an enamel stove. Everything
    // else is shallow wall dressing, so the route to the second pickup stays open.
    for(let row=0;row<5;row++)for(let col=0;col<10;col++) {
      const x=9.20+col*.34,y=2.18+row*.27;
      enamel(x,y,1.043,.325,.257,.035,(row*3+col)%7===0?0x737d6b:0x959887);
    }
    enamel(10.5,1.52,2.5,1.026,.98,1.026,0x8f927e);
    enamel(10.5,2.027,2.5,1.065,.065,1.065,0xa3a18c);
    enamel(10.5,1.88,3.026,.99,.20,.035,0x6d7467);
    for(let i=0;i<4;i++)round(10.20+i*.20,1.90,3.061,.065,.04,.065,0x343a31,Math.PI/2);
    enamel(10.5,1.42,3.030,.82,.59,.037,0x4c5448);
    plain(10.5,1.45,3.054,.64,.35,.015,0x242f29);
    metal(10.5,1.74,3.086,.61,.035,.065,0xaaa48b);
    for(const x of [10.25,10.75])for(const z of [2.25,2.75]) {
      round(x,2.073,z,.34,.020,.34,0x333a30);
      round(x,2.086,z,.21,.012,.21,0x47483a);
      metal(x,2.10,z,.37,.018,.025,0x252d25);
      metal(x,2.10,z,.025,.018,.37,0x252d25);
    }
    // The kettle and the second cup connect the room to the existing RU/EN pages.
    ceramic(10.25,2.27,2.25,.31,.32,.31,0x778477);
    ceramic(10.25,2.445,2.25,.33,.027,.33,0x92998a);
    round(10.25,2.48,2.25,.064,.057,.064,0x353e32);
    metal(10.25,2.64,2.25,.29,.045,.055,0x3a4133);
    for(const x of [10.12,10.38])metal(x,2.53,2.25,.035,.22,.045,0x444f41);
    enamel(10.25,2.32,2.43,.088,.10,.19,0x808b7b);
    box(12.75,2.30,1.12,1.30,.065,.23,0x75694f);
    for(const x of [12.40,13.03]) {
      ceramic(x,2.36,1.13,.23,.023,.19,0xb2ad90);
      ceramic(x,2.45,1.13,.125,.16,.125,0xbbb79e);
      round(x,2.535,1.13,.10,.006,.10,0x343b30);
      enamel(x+.078,2.46,1.13,.052,.063,.035,0xaaa58d);
    }
    box(10.52,3.40,1.12,1.72,.55,.23,0x727660);
    metal(11.20,3.87,3.25,.08,.20,.08,0x333c30);
    ceramic(11.20,3.73,3.25,.58,.13,.58,0x8c9683);
    ceramic(11.20,3.655,3.25,.46,.018,.46,0xc0c5ab);
    for(const x of [10.11,10.93]) {
      box(x,3.40,1.25,.77,.48,.025,0x92947c);
      metal(x+.23,3.38,1.277,.035,.14,.035,0x444b3a);
    }
    box(13.96,2.85,1.09,.50,.60,.08,0x564e38);
    plain(13.96,2.85,1.143,.43,.53,.021,0xada88b);
    // Blank torn calendar stub: readable narrative remains in the translated UI.
    for(let row=0;row<3;row++)for(let col=0;col<4;col++)plain(13.82+col*.091,2.94-row*.10,1.16,.044,.039,.008,0x626851);
    plain(13.87,2.77,1.169,.16,.014,.012,0x695343,0,.38);
    // Resident's room: writing cabinet, sealed envelopes, a radio facing the empty
    // space, and a paired photograph with one face covered as described in the letter.
    box(14.5,1.52,10.5,1.028,.98,1.028,0x40382b);
    box(14.5,2.035,10.5,1.10,.07,1.10,0x766044);
    for(const x of [14.25,14.75]) {
      box(x,1.49,11.026,.45,.82,.032,0x59442e);
      metal(x+(x<14.5?.14:-.14),1.65,11.064,.032,.16,.038,0x9d8a5e);
    }
    plain(14.55,2.105,10.72,.44,.012,.26,0xaca184,.17);
    plain(14.55,2.12,10.72,.32,.004,.005,0x6d654f,.17);
    box(14.70,2.131,10.73,.18,.009,.009,0x403931,.39);
    box(14.42,2.32,10.29,.68,.43,.24,0x393a2c);
    cloth(14.42,2.32,10.425,.60,.35,.035,0x6e6951);
    for(let i=0;i<8;i++)metal(14.22+i*.037,2.30,10.45,.012,.24,.013,0x333c30);
    round(14.62,2.26,10.455,.089,.018,.089,0xa29877,Math.PI/2);
    box(14.62,2.43,10.46,.13,.064,.012,0x393f33);
    box(14.46,2.45,10.477,.045,.29,.018,0x736c51,0,.53);
    metal(14.87,2.28,10.12,.03,.39,.03,0x8f7957);
    round(14.87,2.49,10.12,.22,.09,.22,0x968467);
    box(15.92,2.74,12.65,.13,.86,1.1,0x483b2a);
    plain(15.843,2.74,12.65,.026,.72,.96,0x8d8166);
    for(const z of [12.41,12.88]) {
      plain(15.822,2.68,z,.014,.33,.24,0x41473b);
      round(15.795,2.93,z,.025,.025,.025,0x7f785e);
      plain(15.803,2.93,z,.02,.16,.15,0xb2a282);
    }
    plain(15.784,2.94,12.41,.025,.12,.24,0x31382e,0,.04);
    // Three low shelves of dog-eared books, above the player's walking volume.
    for(const y of [2.98,3.36,3.74]) {
      box(11.1,y,15.91,1.78,.05,.17,0x5c4b34);
      for(let j=0;j<10;j++)cloth(10.35+j*.15,y+.14,15.92,.10,.21+(j%3)*.025,.12,
        [0x565c49,0x766850,0x453e32,0x4e5d58][j%4],0,j===3?.10:0);
    }
    round(10.40,2.95,9.055,.64,.08,.64,0x4b4735,Math.PI/2);
    round(10.40,2.95,9.102,.53,.013,.53,0x9a987e,Math.PI/2);
    box(10.40,2.95,9.12,.21,.018,.015,0x343d32);
    box(10.36,3.005,9.121,.018,.13,.017,0x343d32,0,-.50);
    // Tape on the actual wardrobe door; no new false exit or interaction prompt.
    const plaster=new THREE.MeshStandardMaterial({color:0x6b6856,roughness:1});
    for(const [cy,cz,size] of [[2.26,6.74,.28],[3.53,3.82,.19],[2.09,1.39,.11]]) {
      const vertices=[];
      for(let i=0;i<13;i++) {
        const point=j=>{const a=j/13*Math.PI*2,r=size*(.7+.18*Math.sin(j*7.3)+.10*Math.cos(j*3.7));return [7.974,cy+Math.cos(a)*r,cz+Math.sin(a)*r*.8];};
        vertices.push(7.974,cy,cz,...point((i+1)%13),...point(i));
      }
      const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();
      group.add(new THREE.Mesh(geo,plaster));
    }
  }
  if(apt.authoredHome&&apt.rooms.length===4) {
    // Stored belongings: geometry stays inside the two occupied furniture cells.
    for(const [x,z] of [[2.5,12.5],[6.5,14.5]]) {
      box(x,1.48,z,.99,.96,.99,0x554330);
      box(x,1.99,z,1.03,.06,1.03,0x776044);
      cloth(x,2.19,z,.83,.34,.55,0x4c4c3c);
      for(const dx of [-.25,.25])metal(x+dx,2.19,z+.285,.035,.31,.02,0x716951);
      metal(x,2.385,z,.20,.04,.045,0x655e49);
    }
    // Folded blankets and empty coat hooks; no misleading interactable objects.
    for(let i=0;i<3;i++)cloth(2.5,2.41+i*.10,12.5,.73-i*.04,.09,.45,0x636756);
    box(1.055,2.95,13.8,.09,.17,1.65,0x493e2f);
    for(const z of [13.2,13.6,14,14.4]) {
      metal(1.13,2.90,z,.08,.10,.03,0x8b8270);
      metal(1.18,2.86,z,.025,.07,.03,0x8b8270);
    }
    // The cold pool marks the new route from the familiar first room.
    round(4.6,3.70,10.7,.48,.10,.48,0x666a60);
    round(4.6,3.63,10.7,.37,.06,.37,0xbdc9bc);
  }
  if(apt.id==='farewell-v1') {
    // A lit letter shelf in the resident's room, outside occupied furniture cells.
    box(11.1,2.21,9.14,1.1,.065,.28,0x6d573a);
    for(const x of [10.7,11.5])metal(x,2.08,9.10,.035,.22,.12,0x77684e);
    plain(11.48,2.26,9.16,.24,.012,.19,0xa29374,.12);
  }
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  group.name='apartment-lived-in';
  for(const kind of ['wood','linen','enamel','metal','plain']) {
    const material=roomMaterial(kind);
    for(const [source,isRound] of [[pieces,false],[rounds,true]]) {
      const batch=source.filter(p=>p.kind===kind);if(!batch.length)continue;
      const geo=isRound?new THREE.CylinderGeometry(.5,.5,1,16):new THREE.BoxGeometry(1,1,1);
      const mesh=new THREE.InstancedMesh(geo,material,batch.length);mesh.name=`detail-${kind}`;
      batch.forEach((p,i)=>{
        dummy.position.set(p.x,p.y,p.z);dummy.rotation.set(p.rx||0,p.ry||0,p.rz||0);
        dummy.scale.set(p.w,p.h,p.d);dummy.updateMatrix();
        mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,color.setHex(p.color));
      });
      mesh.castShadow=true;mesh.receiveShadow=true;mesh.instanceMatrix.needsUpdate=true;group.add(mesh);
    }
  }
  return group;
}
