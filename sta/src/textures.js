import * as THREE from 'three';

// Central texture cache. Generated assets live in /assets, everything else is
// drawn procedurally on a canvas so the game still works if a file is missing.
class TextureLib {
  constructor() {
    this.loader = new THREE.TextureLoader();
    this.cache = new Map();
    this.ready = false;
  }

  /**
   * aniso — анизотропная фильтрация.
   *
   * Она нужна поверхностям, которые уходят от камеры под острым углом:
   * дороге и тротуару, где без неё дальний план превращается в мыло.
   * Вертикальной стене, на которую смотришь почти в лоб, она не даёт
   * практически ничего, а стоит столько же. Раньше 16 стояло на всём
   * подряд, и после перехода на текстуры 1024 это стало заметно в замерах.
   */
  load(name, { repeat = [1, 1], srgb = true, aniso = 4 } = {}) {
    const key = `${name}|${repeat[0]}x${repeat[1]}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const t = this.loader.load(`./assets/${name}`, undefined, undefined, () => {
      // missing file: silently fall back to a flat colour
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    this.cache.set(key, t);
    return t;
  }

  // ---- procedural canvas textures ----
  canvas(key, w, h, draw) {
    if (this.cache.has(key)) return this.cache.get(key);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 16;
    this.cache.set(key, t);
    return t;
  }

  sidewalk() {
    return this.canvas('sidewalk', 256, 256, (g, w, h) => {
      g.fillStyle = '#8b8b85';
      g.fillRect(0, 0, w, h);
      // paving slabs
      const s = 64;
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          const v = 138 + Math.floor(Math.random() * 18);
          g.fillStyle = `rgb(${v},${v},${v - 4})`;
          g.fillRect(x + 1.5, y + 1.5, s - 3, s - 3);
        }
      }
      g.strokeStyle = 'rgba(60,60,58,0.5)';
      g.lineWidth = 2;
      for (let y = 0; y <= h; y += s) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let x = 0; x <= w; x += s) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      // grime speckles
      for (let i = 0; i < 500; i++) {
        g.fillStyle = `rgba(40,40,38,${Math.random() * 0.14})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
  }

  grass() {
    return this.canvas('grass', 128, 128, (g, w, h) => {
      g.fillStyle = '#3c6b36';
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const shade = 40 + Math.floor(Math.random() * 60);
        g.fillStyle = `rgba(${shade},${shade + 45},${shade - 8},0.55)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 3);
      }
    });
  }

  // small shop sign with a fictional brand
  sign(text, bg, fg) {
    return this.canvas(`sign:${text}:${bg}`, 256, 64, (g, w, h) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 5;
      g.strokeRect(2.5, 2.5, w - 5, h - 5);
      g.fillStyle = fg;
      g.font = 'bold 34px Impact, Haettenschweiler, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 2);
    });
  }

  graffiti(color) {
    return this.canvas(`graf:${color}`, 256, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineWidth = 11;
      g.lineCap = 'round';
      g.lineJoin = 'round';
      for (let s = 0; s < 4; s++) {
        g.beginPath();
        let x = 24 + s * 55, y = 90;
        g.moveTo(x, y);
        for (let i = 0; i < 4; i++) {
          x += 12 + Math.random() * 18;
          y = 34 + Math.random() * 56;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      g.globalAlpha = 0.55;
      g.strokeStyle = '#000';
      g.lineWidth = 3;
      g.stroke();
    });
  }

  // Пятно света фар НА АСФАЛЬТЕ. Объёмный конус в воздухе читался как луч
  // фонарика — в реальности из фар виден именно освещённый кусок дороги,
  // а сам луч заметен только в дожде или тумане.
  //
  // Форма: клин, расширяющийся от машины вдаль, с мягким затуханием и по
  // бокам, и к дальнему краю. Верх картинки — дальний край.
  headlightPool() {
    const t = this.canvas('headlight-pool', 128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        // v: 0 у машины (низ картинки) → 1 на дальнем краю
        const v = 1 - y / (h - 1);
        // Клин: у машины узкий, вдаль расширяется.
        const halfWidth = 0.12 + v * 0.42;
        // Вдоль: ярко сразу перед машиной, плавно гаснет к концу.
        const along = Math.max(0, 1 - Math.pow(v, 1.5)) * (v < 0.04 ? v / 0.04 : 1);
        for (let x = 0; x < w; x++) {
          const u = Math.abs(x / (w - 1) - 0.5) / halfWidth;   // 0 по центру, 1 у края клина
          const across = Math.max(0, 1 - u * u);
          const a = Math.max(0, Math.min(1, along * across));
          const o = (y * w + x) * 4;
          img.data[o] = 255; img.data[o + 1] = 246; img.data[o + 2] = 214;
          img.data[o + 3] = Math.round(a * 255);
        }
      }
      g.putImageData(img, 0, 0);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }

  // Мягкий градиент для объёмного луча — остаётся для дождя и тумана,
  // где взвесь в воздухе действительно делает луч видимым.
  headlightBeam() {
    const t = this.canvas('headlight-beam', 64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const grad = g.createRadialGradient(w / 2, 0, 0, w / 2, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }
}

export const TEX = new TextureLib();
