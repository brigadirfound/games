// All sound is synthesized with WebAudio - no external assets.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.muted = false;
    this.masterVolume = 0.6;
    this.engineNodes = null;
    this.sirenNodes = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;
    this.master.connect(this.ctx.destination);
    this._buildEngine();
    this._buildSiren();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  weaponMechanism(stage) {
    if (!this.ctx || !this.enabled || this.muted) return;
    const source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    source.buffer = this._noiseBuffer(.075);
    filter.type = 'bandpass'; filter.frequency.value = stage === 'loaded' ? 2100 : 1250; filter.Q.value = 1.8;
    gain.gain.setValueAtTime(.16, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.001, this.ctx.currentTime + .07);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(); source.stop(this.ctx.currentTime + .075);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  setMuted(m) {
    this.muted = !!m;
    if (this.master) this.master.gain.value = this.muted ? 0 : this.masterVolume;
  }

  setMasterVolume(v) {
    this.masterVolume = v;
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  _noiseBuffer(seconds = 1) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _buildEngine() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 60;
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 30;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;

    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer(2);
    noise.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;

    osc1.connect(lp);
    osc2.connect(g2); g2.connect(lp);
    noise.connect(ng); ng.connect(lp);
    lp.connect(gain);
    gain.connect(this.master);
    osc1.start(); osc2.start(); noise.start();
    this.engineNodes = { gain, osc1, osc2, lp };
  }

  // rpm01: 0..1, load 0..1
  engine(active, rpm01 = 0, volume = 0.25, toneMul = 1) {
    if (!this.ctx || !this.engineNodes) return;
    const { gain, osc1, osc2, lp } = this.engineNodes;
    const t = this.ctx.currentTime;
    const target = active ? volume : 0;
    gain.gain.setTargetAtTime(target, t, 0.15);
    if (active) {
      const f = (45 + rpm01 * 150) * toneMul;
      osc1.frequency.setTargetAtTime(f, t, 0.08);
      osc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
      lp.frequency.setTargetAtTime(500 + rpm01 * 2200, t, 0.1);
    }
  }

  _buildSiren() {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 1.6;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1600;
    osc.connect(lp); lp.connect(gain); gain.connect(this.master);
    osc.start(); lfo.start();
    this.sirenNodes = { gain };
  }

  siren(on, volume = 0.08) {
    if (!this.ctx || !this.sirenNodes) return;
    this.sirenNodes.gain.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.2);
  }

  shot(vol = 0.5, tone = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400 * tone; bp.Q.value = 0.7;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.25);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180 * tone, t);
    osc.frequency.exponentialRampToValueAtTime(50 * tone, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.16);
  }

  crash(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.7, 0.25 * strength), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 300 + Math.random() * 400; bp.Q.value = 0.5;
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 0.4);
  }

  beep(freq = 880, dur = 0.12, vol = 0.25, type = 'square') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  explosion(vol = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.9);
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.2);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(24, t + 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(og); og.connect(this.master);
    osc.start(t); osc.stop(t + 0.85);
  }

  horn(vol = 0.16) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.setValueAtTime(vol, t + 0.26);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    for (const f of [370, 466]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f;
      o.connect(g);
      o.start(t); o.stop(t + 0.36);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1800;
    g.connect(lp); lp.connect(this.master);
  }

  rotor(on, intensity = 1) {
    if (!this.ctx) return;
    if (!this._rotor) {
      const ctx = this.ctx;
      const g = ctx.createGain();
      g.gain.value = 0;
      // chopping noise
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(2);
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 1.4;
      // amplitude chop via LFO
      const chopGain = ctx.createGain();
      chopGain.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 15;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.5;
      lfo.connect(lfoAmt);
      lfoAmt.connect(chopGain.gain);
      src.connect(bp); bp.connect(chopGain); chopGain.connect(g);
      // low engine whine
      const osc = ctx.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = 88;
      const og = ctx.createGain(); og.gain.value = 0.22;
      osc.connect(og); og.connect(g);
      g.connect(this.master);
      src.start(); lfo.start(); osc.start();
      this._rotor = g;
    }
    this._rotor.gain.setTargetAtTime(on ? 0.16 * intensity : 0, this.ctx.currentTime, 0.25);
  }

  skid(on, vol = 0.1) {
    if (!this.ctx) return;
    if (!this._skid) {
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuffer(2); src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2;
      src.connect(bp); bp.connect(g); g.connect(this.master);
      src.start();
      this._skid = g;
    }
    this._skid.gain.setTargetAtTime(on ? vol : 0, this.ctx.currentTime, 0.08);
  }
}
