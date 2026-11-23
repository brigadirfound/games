// Web Audio music: no HTML media element or operating-system media player.
import { AudioPolicy } from './audio-policy.js';
const TRACKS = new Set(['menu', 'arena01', 'arena02', 'arena03', 'arena04', 'arena05']);
let ctx = null, gain = null, source = null, current = null;
let enabled = true, ducked = false, revision = 0;
let loadedTrack = null, loadingTrack = null;
export function trackForMap(mapId) {
  return TRACKS.has(mapId) && mapId !== 'menu' ? mapId : 'arena01';
}
function sync() {
  if (!ctx) return;
  const silent = !enabled || ducked || AudioPolicy.blocked || !current;
  gain.gain.value = silent ? 0 : 0.34;
  if (silent) {
    if (ctx.state === 'running') ctx.suspend()?.catch?.(() => {});
  } else {
    if (ctx.state !== 'running') ctx.resume()?.catch?.(() => {});
    if (loadedTrack !== current && loadingTrack !== current) void loadTrack(current);
  }
}
async function loadTrack(track) {
  const seq = ++revision;
  loadingTrack = track;
  try {
    const response = await fetch('assets/music/' + track + '.mp3');
    if (!response.ok) throw new Error('Music HTTP ' + response.status);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    if (seq !== revision || current !== track) return;
    if (source) { source.stop(); source.disconnect(); }
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    loadedTrack = track;
  } catch (error) {
    if (seq === revision) console.warn('[music] track unavailable', track, error);
  } finally {
    if (seq === revision) loadingTrack = null;
  }
}
function unlock() {
  if (!ctx && enabled && current && !AudioPolicy.blocked) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    ctx = new Context();
    gain = ctx.createGain();
    gain.connect(ctx.destination);
  }
  sync();
}
AudioPolicy.subscribe(sync);
if (typeof document !== 'undefined' && document.addEventListener) {
  for (const event of ['pointerdown', 'touchend', 'keydown']) document.addEventListener(event, unlock);
}
export const Music = {
  play(track) {
    if (!TRACKS.has(track)) return;
    if (current !== track) {
      revision++; loadingTrack = null;
      if (source) { source.stop(); source.disconnect(); source = null; }
      loadedTrack = null;
    }
    current = track; sync();
  },
  stop() {
    current = null; revision++; loadingTrack = null; loadedTrack = null;
    if (source) { source.stop(); source.disconnect(); source = null; }
    sync();
  },
  duck(on) { ducked = !!on; sync(); },
  setEnabled(on) { enabled = !!on; sync(); },
  get enabled() { return enabled; },
  get track() { return current; },
};
