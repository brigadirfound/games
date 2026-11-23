import * as THREE from 'three';

// Single-pass screen shader: vignette, film grain, chromatic aberration,
// radial speed blur, damage tint and colour grading. Cheap enough for 60 fps.
const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uAberration;
uniform float uSpeed;      // radial blur amount
uniform float uDamage;     // red pulse
uniform float uSaturation;
uniform float uContrast;
uniform vec3  uTint;
uniform vec3  uShadowTint;   // куда уводим тени
uniform vec3  uHighTint;     // куда уводим света
uniform float uGradeAmt;     // сила раздельного тонирования
uniform float uLift;         // подъём чёрного
uniform float uExposure;
uniform float uFlash;      // white flash (explosions)
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r = length(c);

  // --- radial speed blur ---
  vec3 col;
  if (uSpeed > 0.002) {
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 6; i++) {
      float t = float(i) / 5.0;
      float scale = 1.0 - uSpeed * t * r * 1.4;
      vec2 suv = c * scale + 0.5;
      float w = 1.0 - t * 0.55;
      sum += texture2D(tDiffuse, suv).rgb * w;
      total += w;
    }
    col = sum / total;
  } else {
    col = texture2D(tDiffuse, uv).rgb;
  }

  // --- chromatic aberration toward the edges ---
  float ab = uAberration * (0.35 + r * 1.6);
  if (ab > 0.0002) {
    col.r = texture2D(tDiffuse, uv + c * ab).r;
    col.b = texture2D(tDiffuse, uv - c * ab).b;
  }

  // --- exposure + soft filmic knee (keeps highlights, lifts midtones) ---
  col *= uExposure;
  col = col / (col + vec3(0.72)) * 1.38;

  // --- colour grading ---
  float lum = dot(col, vec3(0.299, 0.587, 0.114));

  // Раздельное тонирование: тени уходят в холод, света — в тепло. Это и
  // есть «стилистика». Плоский общий множитель, который был здесь раньше,
  // двигал всю картинку разом и не давал ни настроения, ни глубины —
  // сцена оставалась ровно того цвета, каким её отдал рендер.
  vec3 tone = mix(uShadowTint, uHighTint, smoothstep(0.12, 0.82, lum));
  col = mix(col, col * tone, uGradeAmt);

  // Подъём чёрного к оттенку теней: абсолютно чёрные пиксели читаются
  // пластиком, у плёнки и у любой камеры тень имеет цвет.
  col = col * (1.0 - uLift) + uLift * uShadowTint * 0.30;

  col = mix(vec3(lum), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col *= uTint;

  // --- damage pulse ---
  if (uDamage > 0.001) {
    float edge = smoothstep(0.15, 0.75, r);
    col = mix(col, vec3(0.75, 0.05, 0.05), edge * uDamage);
  }

  // --- white flash ---
  col += uFlash;

  // --- vignette ---
  float vig = smoothstep(0.95, 0.28, r);
  col *= mix(1.0, vig, uVignette);

  // --- film grain ---
  // Было: новый случайный шум КАЖДЫЙ кадр (60/сек) по пикселю — читалось как
  // мерцающая рябь/статика, а не плёночное зерно. Замедлили смену узора до
  // ~12 кадров/сек и снизили частоту хэша — зерно крупнее и мягче.
  float gt = floor(uTime * 12.0) / 12.0;
  float g = hash(uv * vec2(540.0, 540.0) + gt * 91.7) - 0.5;
  col += g * uGrain;

  col = clamp(col, 0.0, 1.0);
  // linear -> sRGB (the render target holds linear light)
  vec3 lo = col * 12.92;
  vec3 hi = 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055;
  col = mix(hi, lo, step(col, vec3(0.0031308)));

  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    // Множители для настроек: setState пересчитывает эти униформы каждый
    // кадр, поэтому выключать эффект надо здесь, а не разовой записью.
    this.grainScale = 1;
    this.aberrationScale = 1;

    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    this.target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
    });
    // pass-through: the target already holds display-ready pixels, so the
    // shader must NOT apply an sRGB decode when sampling it
    this.target.texture.colorSpace = THREE.NoColorSpace;
    this.target.texture.generateMipmaps = false;

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uTime: { value: 0 },
      uVignette: { value: 0.5 },
      uGrain: { value: 0.016 },
      uAberration: { value: 0.0016 },
      uSpeed: { value: 0 },
      uDamage: { value: 0 },
      uSaturation: { value: 1.1 },
      uContrast: { value: 1.0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uShadowTint: { value: new THREE.Vector3(0.92, 0.97, 1.08) },
      uHighTint: { value: new THREE.Vector3(1.06, 1.02, 0.94) },
      uGradeAmt: { value: 0.55 },
      uLift: { value: 0.02 },
      uExposure: { value: 1.55 },
      uFlash: { value: 0 },
    };

    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.quadScene = new THREE.Scene();
    const geo = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geo, this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(w, h) {
    const pr = this.renderer.getPixelRatio();
    this.target.setSize(Math.max(2, w * pr), Math.max(2, h * pr));
  }

  // called every frame with live game state
  setState({ time, speed01 = 0, damage = 0, night = 0, dusk = 0, flash = 0,
    weather = 'clear', wet = 0, fog = 0, wanted = 0 }) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uSpeed.value = speed01 * 0.075;   // было 0.22 — весь экран плыл
    u.uDamage.value = damage;
    u.uFlash.value = flash;

    const mix3 = (a, b, t) => [
      a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    // Раздельное тонирование ведём по времени суток НЕПРЕРЫВНО. Раньше
    // здесь стоял порог `night > 0.5`, и весь кадр менял оттенок за один
    // кадр — ровно то, что читается как «резко, без переходов».
    const shDay = [0.92, 0.97, 1.09], hiDay = [1.06, 1.02, 0.93];
    const shDusk = [0.86, 0.93, 1.16], hiDusk = [1.16, 1.00, 0.82];
    const shNight = [0.78, 0.89, 1.24], hiNight = [1.14, 1.00, 0.80];
    let sh = mix3(shDay, shDusk, dusk);
    let hi = mix3(hiDay, hiDusk, dusk);
    sh = mix3(sh, shNight, night);
    hi = mix3(hi, hiNight, night);

    u.uShadowTint.value.set(sh[0], sh[1], sh[2]);
    u.uHighTint.value.set(hi[0], hi[1], hi[2]);
    u.uGradeAmt.value = 0.55 + dusk * 0.25 + night * 0.32;
    u.uLift.value = 0.018 + night * 0.030;
    // Ночью общий свет почти выключен, поэтому чуть добавляем экспозиции:
    // темнота должна читаться контрастом освещённого и неосвещённого,
    // а не тем, что игрок не видит, куда идёт.
    u.uExposure.value = 1.55 + night * 0.30;

    // Погодные множители тоже ведём непрерывно: смена погоды сама по себе
    // плавная (см. _rainAmt), а грейд щёлкал по строковому состоянию.
    let sat = 1.14 - night * 0.16 - dusk * 0.02;
    let con = 1.03 + night * 0.03;
    let tint = [1, 1, 1];
    const foggy = fog;
    sat -= wet * 0.16 + foggy * 0.22;
    con -= foggy * 0.05;
    tint = mix3(tint, [0.90, 0.95, 1.07], wet);
    tint = mix3(tint, [0.98, 0.99, 1.03], foggy);
    // police chase: push red slightly
    if (wanted >= 3) { tint[0] *= 1.05; tint[2] *= 0.97; }

    u.uSaturation.value = sat;
    u.uContrast.value = con;
    u.uTint.value.set(tint[0], tint[1], tint[2]);
    u.uGrain.value = (0.003 + night * 0.004) * this.grainScale;   // мягкое зерно, не рябь
    u.uAberration.value = (0.0008 + speed01 * 0.0008) * this.aberrationScale;
    u.uVignette.value = 0.46 + night * 0.14;
  }

  render() {
    if (!this.enabled) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }
}
