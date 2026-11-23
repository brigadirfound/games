// Independent reasons: finishing an ad cannot clear platform/visibility mute.
const reasons = new Set();
const listeners = new Set();
export const AudioPolicy = {
  get blocked() { return reasons.size > 0; },
  set(reason, blocked) {
    if (blocked) reasons.add(reason); else reasons.delete(reason);
    for (const listener of listeners) listener();
  },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
if (typeof document !== 'undefined' && document.addEventListener) {
  AudioPolicy.set('hidden', !!document.hidden);
  document.addEventListener('visibilitychange', () => AudioPolicy.set('hidden', !!document.hidden));
}
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('blur', () => AudioPolicy.set('blur', true));
  window.addEventListener('focus', () => AudioPolicy.set('blur', false));
}
