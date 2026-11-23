// Procedural 128 px surface tiles; one 512 px atlas, generated once locally.
// Тайлы нейтральных тонов: цвет из палитры карты умножается сверху (тонировка),
// поэтому один тайл обслуживает любые расцветки. Один атлас = один draw call.
import * as THREE from 'three';

export const TILE = {
  plain: 0,     // чистый белый — фолбэк для блоков без текстуры (старые UGC-карты)
  stone: 1,
  brick: 2,
  planks: 3,
  grass: 4,     // верх травы (grass_dirt: верх grass, бока/низ dirt)
  dirt: 5,
  sand: 6,
  metal: 7,     // рифлёный металл
  crate: 8,     // ящик с окантовкой
  concrete: 9,  // бетон с трещинами
  neon: 10,     // неон-панель
  glass: 11,    // полупрозрачное стекло
  carpet: 12,   // ворс: частое переплетение, без крупного рисунка
  wallpaper: 13, // обои: полосы, шов рулона и мелкий вензель
};

const GRID = 4;       // 4×4 тайлов
const TS = 128;
let atlasCanvas = null;
let atlasTexture = null;
let wallpaperImage=null;
export async function prepareSurfaces(){
  wallpaperImage=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Wallpaper texture failed to load'));image.src=new URL('../assets/textures/wallpaper-v1.webp',import.meta.url).href;});
}

function rng(seed) {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function buildAtlasCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = GRID * TS;
  const ctx = c.getContext('2d');
  const at = (i) => [(i % GRID) * TS, Math.floor(i / GRID) * TS];
  const px = (ox, oy) => (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(ox + x*TS/16, oy + y*TS/16, w*TS/16, h*TS/16); };

  const tile = (i, fn) => {
    const [ox, oy] = at(i);
    ctx.save();
    fn(px(ox, oy), rng(1000 + i));
    ctx.restore();
  };

  // plain — чистый белый
  tile(TILE.plain, (P) => P(0, 0, 16, 16, '#ffffff'));

  // stone — светло-серые пятна
  tile(TILE.stone, (P, r) => {
    P(0, 0, 16, 16, '#c2c6cc');
    for (let i = 0; i < 14; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 3 | 0), 1 + (r() * 2 | 0), '#a8adb5');
    for (let i = 0; i < 6; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 2 | 0), 1, '#d8dce2');
  });

  // brick — кирпичи со швами, смещение рядов
  tile(TILE.brick, (P) => {
    P(0, 0, 16, 16, '#9a948c'); // раствор
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let col = -1; col < 3; col++) P(off + col * 8 + 1, row * 4 + 1, 7, 3, '#cfc6ba');
    }
  });

  // planks — горизонтальные доски с волокнами
  tile(TILE.planks, (P, r) => {
    P(0, 0, 16, 16, '#d6c9b2');
    for (let row = 0; row < 4; row++) {
      P(0, row * 4, 16, 1, '#a89878');
      for (let i = 0; i < 3; i++) P((r() * 15) | 0, row * 4 + 1 + (r() * 3 | 0), 2 + (r() * 3 | 0), 1, '#c4b599');
    }
    P(4, 6, 1, 1, '#8a7a5c'); P(11, 13, 1, 1, '#8a7a5c'); // сучки
  });

  // grass — шумная светлая (тонируется зелёным)
  tile(TILE.grass, (P, r) => {
    P(0, 0, 16, 16, '#d2d8c8');
    for (let i = 0; i < 22; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1 + (r() * 2 | 0), '#b8c2a4');
    for (let i = 0; i < 10; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#e4ead8');
  });

  // dirt — земля с камешками
  tile(TILE.dirt, (P, r) => {
    P(0, 0, 16, 16, '#cbb89e');
    for (let i = 0; i < 16; i++) P((r() * 16) | 0, (r() * 16) | 0, 1 + (r() * 2 | 0), 1, '#b09a7c');
    for (let i = 0; i < 5; i++) P((r() * 16) | 0, (r() * 16) | 0, 2, 1, '#e0d2ba');
  });

  // sand — мелкие точки
  tile(TILE.sand, (P, r) => {
    P(0, 0, 16, 16, '#eee4c8');
    for (let i = 0; i < 20; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#d8cba8');
    for (let i = 0; i < 8; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#f8f0dc');
  });

  // metal — рифлёные горизонтальные полосы + заклёпки
  tile(TILE.metal, (P) => {
    P(0, 0, 16, 16, '#c8ccd2');
    for (let row = 0; row < 4; row++) {
      P(0, row * 4, 16, 1, '#eef1f5');
      P(0, row * 4 + 3, 16, 1, '#9aa0a8');
    }
    P(1, 1, 1, 1, '#788088'); P(14, 1, 1, 1, '#788088');
    P(1, 14, 1, 1, '#788088'); P(14, 14, 1, 1, '#788088');
  });

  // crate — доски + тёмная окантовка + диагональ
  tile(TILE.crate, (P, r) => {
    P(0, 0, 16, 16, '#d6c9b2');
    for (let row = 1; row < 4; row++) P(2, row * 4, 12, 1, '#b3a284');
    P(0, 0, 16, 2, '#94825f'); P(0, 14, 16, 2, '#94825f');
    P(0, 0, 2, 16, '#94825f'); P(14, 0, 2, 16, '#94825f');
    for (let i = 0; i < 12; i++) P(2 + i, 2 + i, 1, 1, '#a89468'); // диагональ
    void r;
  });

  // concrete — бетон с трещинами и подтёками
  tile(TILE.concrete, (P, r) => {
    P(0, 0, 16, 16, '#c9c9c6');
    let cx = 3, cy = 0;
    for (let i = 0; i < 14 && cy < 16; i++) { P(cx, cy, 1, 1, '#8f8f8c'); cy++; cx += (r() * 3 | 0) - 1; }
    for (let i = 0; i < 6; i++) P((r() * 16) | 0, (r() * 16) | 0, 2, 1 + (r() * 2 | 0), '#b8b8b4');
    P(10, 12, 4, 3, '#bebebb');
  });

  // neon — тёмная рамка, светящаяся сетка (тонируется цветом палитры)
  tile(TILE.neon, (P) => {
    P(0, 0, 16, 16, '#3a3a42');
    P(1, 1, 14, 14, '#ffffff');
    P(3, 3, 10, 10, '#4a4a54');
    P(7, 3, 2, 10, '#ffffff'); P(3, 7, 10, 2, '#ffffff');
  });

  // glass — полупрозрачное с бликами (единственный тайл с альфой)
  /*
    carpet — ворс.

    Ковру в «Эхо-укрытии» сперва досталась кирпичная кладка, и на полу это
    выглядело ровно тем, чем было: кирпичами. Ткань узнаётся не рисунком, а
    частотой: переплетение мелкое, шаг в два пикселя, контраст низкий. Крупный
    орнамент здесь невозможен в принципе — тайл повторяется на каждой клетке
    пола, и любой заметный узор сразу читается решёткой.
  */
  tile(TILE.carpet, (P, r) => {
    P(0, 0, 16, 16, '#d9d2ca');
    // Уток и основа: два перпендикулярных набора нитей через пиксель.
    for (let y = 0; y < 16; y += 2) P(0, y, 16, 1, '#cabfb4');
    for (let x = 1; x < 16; x += 2) P(x, 0, 1, 16, '#d2c9c0');
    // Ворс: редкие тёмные и светлые волокна, чтобы поверхность не была ровной.
    for (let i = 0; i < 26; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#b8ada1');
    for (let i = 0; i < 14; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1, '#e6e0d8');
  });

  /*
    wallpaper — обои.

    Стены брали тайл бетона с трещинами, и квартира не читалась жильём: игрок
    честно сказал, что «не выглядит как дом». Дом узнаётся по трём приметам, и
    все три здесь:

      1. ШОВ РУЛОНА — вертикальная линия через равные промежутки. Одна эта
         деталь отличает оклеенную стену от штукатурки.
      2. ПОЛОСА — частый вертикальный ритм слабого контраста.
      3. ВЕНЗЕЛЬ — мелкий повторяющийся ромбик. Крупный рисунок здесь нельзя:
         тайл ложится на каждый блок стены, и заметный узор станет решёткой.

    Тон нейтральный: цвет комнаты приходит из палитры карты умножением.
  */
  tile(TILE.wallpaper, (P, r) => {
    P(0, 0, 16, 16, '#d8d2c6');
    // Полоса: через каждые четыре пикселя чуть темнее.
    for (let x = 1; x < 16; x += 4) P(x, 0, 1, 16, '#cec7b8');
    // Шов рулона по левому краю тайла, с лёгкой тенью справа от него.
    P(0, 0, 1, 16, '#bdb5a4');
    P(1, 0, 1, 16, '#d2ccbf');
    // Вензель: ромб четыре на четыре, два на тайл со сдвигом.
    const diamond = (cx, cy, col) => {
      P(cx, cy - 2, 1, 1, col); P(cx - 1, cy - 1, 3, 1, col);
      P(cx - 2, cy, 5, 1, col); P(cx - 1, cy + 1, 3, 1, col);
      P(cx, cy + 2, 1, 1, col);
    };
    diamond(5, 4, '#c6bda9');
    diamond(12, 11, '#c6bda9');
    // Потёртости: обои живут не первый год.
    for (let i = 0; i < 5; i++) P((r() * 16) | 0, (r() * 16) | 0, 1, 1 + (r() * 2 | 0), '#cbc4b5');
  });

  tile(TILE.glass, (P) => {
    const [ox, oy] = at(TILE.glass);
    ctx.clearRect(ox, oy, TS, TS);
    P(0, 0, 16, 16, 'rgba(255,255,255,0.30)');
    const edge = 'rgba(255,255,255,0.75)';
    P(0, 0, 16, 1, edge); P(0, 15, 16, 1, edge);
    P(0, 0, 1, 16, edge); P(15, 0, 1, 16, edge);
    for (let i = 0; i < 6; i++) { P(3 + i, 9 - i, 1, 1, edge); P(7 + i, 12 - i, 1, 1, edge); }
  });

  // Replace the large block marks with fine, neutral material information.
  // Colour still comes from each room's existing palette.
  for(const index of [TILE.planks,TILE.wallpaper,TILE.concrete,TILE.carpet,TILE.metal]) {
    const [ox,oy]=at(index),r=rng(index*917),pixels=ctx.createImageData(TS,TS);
    for(let y=0;y<TS;y++)for(let x=0;x<TS;x++) {
      const n=(r()-.5)*11, cloud=Math.sin(x*.053+Math.sin(y*.025))*Math.sin(y*.077)*6;
      let v=211+n+cloud;
      if(index===TILE.planks){
        const row=Math.floor(y/32),joint=(x+row*47)%128;
        v=199+n+Math.sin(y*.8+Math.sin(x*.024)*2)*7+Math.sin(y*2.1+x*.022)*3;
        if(y%32<2||joint<1)v-=48;
        if(y%32===2)v+=12;
      }else if(index===TILE.wallpaper){
        v=218+n*.55+cloud*.65+Math.sin(x*Math.PI/16)*3;
        if(x%64===0)v-=10;
        const dx=(x%32)-16,dy=(y%48)-24;
        if(Math.abs(Math.abs(dx)*.8+Math.abs(dy)-10)<.8)v-=9;
      }else if(index===TILE.carpet){v=200+n+Math.sin(x*2.7)*7+Math.sin(y*3.1)*5;}
      else if(index===TILE.metal){v=215+n*.25+Math.sin(y*1.5)*2;}
      else {v=207+n+cloud;}
      const p=(y*TS+x)*4;pixels.data[p]=v;pixels.data[p+1]=v-2;pixels.data[p+2]=v-5;pixels.data[p+3]=255;
    }
    ctx.putImageData(pixels,ox,oy);
    if(index===TILE.wallpaper||index===TILE.concrete){
      ctx.strokeStyle='rgba(65,59,45,.18)';ctx.lineWidth=.7;ctx.beginPath();
      let x=31,y=0;ctx.moveTo(ox+x,oy+y);
      for(let j=0;j<7;j++){x+=(r()-.6)*9;y+=r()*10+4;ctx.lineTo(ox+x,oy+y);}ctx.stroke();
    }
  }
  if(wallpaperImage){const [x,y]=at(TILE.wallpaper);ctx.drawImage(wallpaperImage,x,y,TS,TS);}
  return c;
}

export function getAtlasCanvas() {
  atlasCanvas ??= buildAtlasCanvas();
  return atlasCanvas;
}

export function getAtlas() {
  if (!atlasTexture) {
    atlasTexture = new THREE.CanvasTexture(getAtlasCanvas());
    atlasTexture.magFilter = THREE.LinearFilter;
    atlasTexture.minFilter = THREE.LinearMipmapLinearFilter;
    atlasTexture.anisotropy=4;
    atlasTexture.colorSpace = THREE.SRGBColorSpace;
  }
  return atlasTexture;
}

/** UV-прямоугольник тайла (с учётом flipY у CanvasTexture). */
export function tileUV(index) {
  const col = index % GRID, row = Math.floor(index / GRID);
  const s = 1 / GRID, pad = 1.5/(GRID*TS);
  return {
    u0: col * s + pad, v0: 1 - (row + 1) * s + pad,
    u1: (col + 1) * s - pad, v1: 1 - row * s - pad,
  };
}

/** Превью тайла с тонировкой для редактора: маленький canvas → dataURL. */
export function tilePreviewURL(texName, color, size = 34) {
  const src = getAtlasCanvas();
  const idx = TILE[texName] ?? TILE.plain;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(src, (idx % GRID) * TS, Math.floor(idx / GRID) * TS, TS, TS, 0, 0, size, size);
  return c.toDataURL();
}
