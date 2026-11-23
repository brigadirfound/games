import { AudioPolicy } from './audio-policy.js';
let active = false;
function event(name) {
  if (typeof document !== 'undefined' && document.dispatchEvent) document.dispatchEvent(new CustomEvent(name));
}
export const Ads = {
  get active() { return active; },
  request(invoke) {
    if (active) return Promise.resolve(false);
    active = true;
    AudioPolicy.set('ad', true);
    document.documentElement?.classList?.add('ad-active');
    event('ghostfire:ad-pause');
    return new Promise(resolve => {
      let settled = false;
      // Only a request that never starts can time out. An open ad owns the pause.
      const timer = setTimeout(() => finish(false), 15000);
      const finish = granted => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        active = false;
        AudioPolicy.set('ad', false);
        document.documentElement?.classList?.remove('ad-active');
        event('ghostfire:ad-resume');
        resolve(granted === true);
      };
      const started = () => { if (!settled) clearTimeout(timer); };
      try { invoke({ started, finish, pending: () => !settled }); }
      catch { finish(false); }
    });
  },
};
