import * as THREE from 'three';

// Создание WebGL-рендерера с запасными вариантами.
// Раньше рендерер создавался одним жёстким вызовом с antialias + high-performance,
// и на любой машине без аппаратного ускорения игра падала с
// «Error creating WebGL context» ещё до старта.

const ATTEMPTS = [
  { label: 'antialias + high-performance',
    opts: { antialias: true, powerPreference: 'high-performance' } },
  // На ноутбуках с двумя GPU high-performance иногда не отдаёт контекст.
  { label: 'antialias, обычный GPU',
    opts: { antialias: true, powerPreference: 'default' } },
  // Без сглаживания требования к контексту заметно ниже.
  { label: 'без antialias',
    opts: { antialias: false, powerPreference: 'default' } },
  // Последний шанс: разрешаем программный рендер и экономичный режим.
  { label: 'программный рендер',
    opts: { antialias: false, powerPreference: 'low-power',
            failIfMajorPerformanceCaveat: false } },
];

export function detectWebGL() {
  const probe = document.createElement('canvas');
  let gl2 = null, gl1 = null, reason = '';
  try {
    gl2 = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
  } catch (e) { reason = e.message; }
  try {
    gl1 = probe.getContext('webgl') || probe.getContext('experimental-webgl');
  } catch (e) { if (!reason) reason = e.message; }

  let renderer = '';
  const gl = gl2 || gl1;
  if (gl) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();          // не держим лишний контекст
  }
  return { webgl2: !!gl2, webgl1: !!gl1, renderer, reason };
}

export function createRenderer(canvas) {
  const tried = [];
  for (const a of ATTEMPTS) {
    try {
      const r = new THREE.WebGLRenderer({ canvas, ...a.opts });
      // Проверяем, что контекст живой, а не «пустышка».
      if (!r.getContext()) throw new Error('пустой контекст');
      if (tried.length) console.warn('[GL] контекст создан в режиме:', a.label);
      return { renderer: r, mode: a.label, degraded: tried.length > 0 };
    } catch (e) {
      tried.push(`${a.label}: ${e.message}`);
    }
  }
  const info = detectWebGL();
  const err = new Error('WEBGL_UNAVAILABLE');
  err.details = { tried, info };
  throw err;
}
