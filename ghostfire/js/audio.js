// CC0 firearm recordings and restrained material foley; no arcade oscillators.
import { AudioPolicy } from './audio-policy.js';
let ctx = null;
let master = null;
let enabled = true;
const activeSources = new Set();
let wanted = true;
const samples = new Map();
const variants = { pistol: 2, smg: 3, assault: 2, shotgun: 2, sniper: 3, 'reload-out': 2, 'reload-in': 2, jump: 2, hurt: 2, death: 2, tick: 2 };
const lastVariant = new Map();
let sampleLoading = null;
async function preloadSamples() {
  if (sampleLoading) return sampleLoading;
  const Offline = globalThis.window?.OfflineAudioContext || globalThis.window?.webkitOfflineAudioContext;
  const decoder = Offline ? new Offline(1, 1, 44100) : ctx;
  if (!decoder?.decodeAudioData) return;
  sampleLoading = Promise.all(Object.entries(variants).flatMap(([name, count]) =>
    Array.from({ length: count }, async (_, i) => {
      const key = `${name}-${i + 1}`;
      try {
        const response = await fetch(`assets/sfx/${key}.wav`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        samples.set(key, await decoder.decodeAudioData(await response.arrayBuffer()));
      } catch (error) { console.warn(`SFX ${key}: sample unavailable`, error); }
    })));
  return sampleLoading;
}
function firearm(name, volume = 1) {
  if (!ok()) return true;
  const count = variants[name];
  const previous = lastVariant.get(name) ?? 0;
  const next = (previous + 1 + Math.floor(Math.random() * (count - 1))) % count;
  const buffer = samples.get(`${name}-${next + 1}`);
  if (!buffer) return false;
  lastVariant.set(name, next);
  const source = track(ctx.createBufferSource());
  source.buffer = buffer;
  source.playbackRate.value = 0.98 + Math.random() * 0.04;
  const gain = ctx.createGain();
  gain.gain.value = volume * (0.94 + Math.random() * 0.06);
  source.connect(gain).connect(master);
  source.addEventListener('ended', () => gain.disconnect(), { once: true });
  source.start();
  return true;
}
function syncAudio() {
  if (!ctx) return;
  if (master) master.gain.value = enabled && !AudioPolicy.blocked ? 0.5 : 0;
  if (AudioPolicy.blocked || !wanted) {
    if (ctx.state === 'running') ctx.suspend()?.catch?.(() => {});
  } else if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
    ctx.resume()?.catch?.(() => {});
  }
}
AudioPolicy.subscribe(syncAudio);
if (typeof document !== 'undefined' && document.addEventListener) {
  for (const event of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(event, syncAudio);
}

export const Sound = {
  preload: preloadSamples,
  init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    void preloadSamples();
    syncAudio();
  },
  resume() { wanted = true; syncAudio(); },
  /** Глушим на время рекламы и при сворачивании вкладки. */
  suspend() { wanted = false; syncAudio(); },
  /** Отменяет хвосты текущего матча, сохраняя AudioContext и master bus. */
  stopAll() {
    for (const source of activeSources) {
      try { source.stop(); } catch { /* source уже завершился */ }
      try { source.disconnect(); } catch { /* уже отключён */ }
    }
    activeSources.clear();
  },
  setEnabled(v) { enabled = !!v; syncAudio(); },

  pistol() { firearm('pistol', 0.9); },
  smg() { firearm('smg', 0.65); },
  assault() { firearm('assault', 0.9); },
  shotgun() { firearm('shotgun', 1.1); },
  sniper() { firearm('sniper', 1.05); },
  // A low air rush replaces the rising electronic whistle.
  railCharge(dur = 0.8) { noiseBurst(Math.min(1, Math.max(.05, dur)), 450, .08); },
  railgun() { firearm('sniper', 1.1); },
  reloadOut() { firearm('reload-out', .35); },
  reloadIn() { firearm('reload-in', .45); },
  hit() {},
  headshot() {},
  hurt() { firearm('hurt', .4); },
  pickup() { firearm('reload-in', .3); },
  jump() { firearm('jump', .22); },
  death() { firearm('death', .5); },
  countdown() { firearm('tick', .2); },
  go() { firearm('reload-in', .4); },
  // Result overlays and unchanged music carry the outcome without a jingle.
  winRound() {},
  loseRound() {},
};

function ok() { return ctx && enabled && wanted && !AudioPolicy.blocked; }

function noiseBurst(dur, cutoff, vol) {
  if (!ok()) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = track(ctx.createBufferSource());
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}

function track(source) {
  activeSources.add(source);
  source.addEventListener?.('ended', () => {
    activeSources.delete(source);
    try { source.disconnect(); } catch { /* уже отключён */ }
  }, { once: true });
  return source;
}
