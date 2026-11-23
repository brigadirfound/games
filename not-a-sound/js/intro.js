import { PALETTE, T } from './apartment.js';

// Authored first night: sightline to the first pickup, then two connected rooms.
export function generateIntro(night = 1) {
  const secondNight=night===true||night>=2,thirdNight=night===3;
  const width = 17, depth = 17;
  const rooms = [
    { x0: 1, x1: 7, z0: 1, z1: 7, cx: 4.5, cz: 4.5 },
    { x0: 9, x1: 15, z0: 1, z1: 7, cx: 12.5, cz: 4.5 },
    { x0: 9, x1: 15, z0: 9, z1: 15, cx: 12.5, cz: 12.5 },
  ];
  if(secondNight) rooms.push({x0:1,x1:7,z0:9,z1:15,cx:4.5,cz:12.5});
  const wallGrid = Array.from({ length: depth }, () => Array(width).fill(true));
  for (const r of rooms) for (let z = r.z0; z <= r.z1; z++)
    for (let x = r.x0; x <= r.x1; x++) wallGrid[z][x] = false;
  for (const [x, z] of [[8, 4], [8, 5], [12, 8], [13, 8]]) wallGrid[z][x] = false;
  // A return loop through the newly opened room: neither entrance is a dead end.
  if(secondNight) for(const [x,z] of [[4,8],[5,8],[8,12],[8,13]]) wallGrid[z][x]=false;
  const blocks = [], occupied = new Set();
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
    blocks.push([x, 0, z, T.FLOOR], [x, 4, z, T.CEIL]);
    if (wallGrid[z][x]) for (let y = 1; y <= 3; y++) blocks.push([x, y, z, T.WALL_A]);
  }
  const wardrobes = [{ x: 1, z: 2 }, { x: 14, z: 14 }];
  if(secondNight) wardrobes.push({x:1,z:10});
  for (const w of wardrobes) {
    occupied.add(w.z + ',' + w.x);
    for (let y = 1; y <= 3; y++) blocks.push([w.x, y, w.z, T.WARDROBE]);
  }
  for (const [x, z] of [[2, 6], [10, 2], [14, 10], ...(secondNight?[[2,12],[6,14]]:[])]) {
    blocks.push([x, 1, z, T.WOOD]); occupied.add(z + ',' + x);
  }
  return {
    id: thirdNight?'farewell-v1':secondNight?'return-v1':'intro-v1', name: thirdNight?'farewell':secondNight?'return':'intro', seed: thirdNight?'farewell-v1':secondNight?'return-v1':'intro-v1', authoredHome:true, width, depth, rooms,
    palette: PALETTE, blocks, wallGrid, occupied, wardrobes,
    spawns: [[3.5, 1, 4.5, -90]], neighborStart: { x: 12.5, z: 12.5 },
    batteries: (thirdNight?[[6.5,3.5],[10.5,5.5],[14.5,7.5],[11.5,10.5],[12.5,14.5],[4.5,13.5]]:
      secondNight?[[6.5,4.5],[13.5,3.5],[11.5,13.5],[4.5,13.5],[3.5,10.5]]:
      [[6.5,4.5],[12.5,6.5],[12.5,13.5]]).map(([x,z])=>({x,y:1.18,z})),
    rugRects: rooms.map(r=>({x:r.x0+2,z:r.z0+2,w:3,d:2})),
    rugs: rooms.flatMap(r=>Array.from({length:6},(_,i)=>({x:r.x0+2+i%3,z:r.z0+2+Math.floor(i/3)}))), lamps: [
      {x:2.24,y:2.50,z:6.60,color:0xffbd76,intensity:3.1,distance:4.2},
      {x:7.45,y:2.88,z:2.55,color:0x8babcb,intensity:2.4,distance:4.5},
      {x:2.2,y:3.35,z:3.9,color:0x8b9fae,intensity:3.2,distance:5.2},
      {x:11.20,y:3.45,z:3.25,color:0xc5cbb1,intensity:thirdNight?.65:2.1,distance:5},
      {x:14.15,y:2.80,z:10.85,color:0xd2b487,intensity:1.4,distance:4.2},
      ...(secondNight?[{x:4.6,y:3.45,z:10.7,color:0x92aebd,intensity:3.5,distance:6}]:[]),
      ...(thirdNight?[{x:11.1,y:2.9,z:9.5,color:0xf4ce8b,intensity:2.5,distance:4}]:[]),
    ], clutter: [], wallArt: [],
  };
}

export class FirstNightLesson {
  constructor(enabled) {
    this.stage = enabled ? 'move' : 'done'; this.safeSeconds = 0; this.age = 0;
    this.read = false; this.changed = false; this.noticed = false; this.noticeSeconds = 0;
  }
  update(dt, { taken, still, light, sheltered=false, visitPhase=null, exploring=false }) {
    this.age += dt;
    // Hints never gate play. Leaving the starting room or collecting another cell skips them.
    if(exploring || taken>=2){this.stage='done';return this.stage;}
    if (this.stage === 'change' && this.noticed) this.noticeSeconds += dt;
    let next = this.stage;
    if (this.stage === 'move' && taken > 0) next = 'sound';
    else if (this.stage === 'sound' && this.age >= 2.2) next = 'note';
    // Reading is an invitation. A player who ignores it still reaches the encounter.
    else if (this.stage === 'note' && this.read) next = 'change';
    else if (this.stage === 'note' && this.age >= 14) next = 'done';
    else if (this.stage === 'change' && ((this.changed && (this.noticeSeconds >= 2 || this.age >= 7)) || this.age >= 12)) next = 'done';
    else if (this.stage === 'hide') {
      this.safeSeconds = still && !light ? this.safeSeconds + dt : 0;
      if ((sheltered && visitPhase === 'leave' && this.safeSeconds >= 2) ||
          (!sheltered && this.age >= 16 && this.safeSeconds >= 4.5) ||
          (this.age >= 32 && this.safeSeconds >= 2)) next = 'done';
    }
    if (next !== this.stage) { this.stage = next; this.age = 0; this.safeSeconds = 0; }
    return this.stage;
  }
}
