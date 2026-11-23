// Procedural radio: every station is generated live with WebAudio.
// No audio files — a small step sequencer drives bass, drums, chords and lead.

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  phryg: [0, 1, 3, 5, 7, 8, 10],
};

export const STATIONS = [
  {
    id: 'off', name: 'РАДИО ВЫКЛ', short: 'OFF', color: '#777',
  },
  {
    id: 'flash', name: 'FLASHBACK FM', short: 'FLASH', color: '#ff77cc',
    bpm: 116, scale: 'minor', root: 45, style: 'disco',
    prog: [0, 5, 3, 4], swing: 0.12,
  },
  {
    id: 'head', name: 'HEAD RADIO', short: 'HEAD', color: '#66ccff',
    bpm: 104, scale: 'major', root: 48, style: 'pop',
    prog: [0, 4, 5, 3], swing: 0.06,
  },
  {
    id: 'kjah', name: 'K-JAH DUB', short: 'K-JAH', color: '#5ec46a',
    bpm: 78, scale: 'dorian', root: 40, style: 'dub',
    prog: [0, 0, 3, 3], swing: 0.18,
  },
  {
    id: 'rise', name: 'RISE FM', short: 'RISE', color: '#c88cff',
    bpm: 138, scale: 'minor', root: 43, style: 'trance',
    prog: [0, 6, 5, 4], swing: 0,
  },
  {
    id: 'msx', name: 'MSX HEAVY', short: 'MSX', color: '#ff6b4a',
    bpm: 152, scale: 'phryg', root: 38, style: 'rock',
    prog: [0, 0, 5, 6], swing: 0,
  },
  {
    id: 'talk', name: 'CHATTERBOX', short: 'TALK', color: '#e0c060',
    bpm: 90, scale: 'minor', root: 45, style: 'talk',
    prog: [0, 3, 4, 3], swing: 0,
  },
];

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Radio {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.index = 1;
    this.enabled = true;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.bar = 0;
    this.melodyLine = [];
    this.volume = 0.24;
    this.gain = null;
    this.duck = 1;
  }

  get station() { return STATIONS[this.index]; }

  init() {
    const ctx = this.audio.ctx;
    if (!ctx || this.gain) return;
    this.gain = ctx.createGain();
    this.gain.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.gain.connect(comp);
    comp.connect(this.audio.master);
    this.nextTime = ctx.currentTime + 0.1;
    this.newMelody();
  }

  setStation(i) {
    this.index = ((i % STATIONS.length) + STATIONS.length) % STATIONS.length;
    this.step = 0; this.bar = 0;
    this.newMelody();
    if (this.audio.ctx) this.nextTime = this.audio.ctx.currentTime + 0.05;
    return this.station;
  }

  next() { return this.setStation(this.index + 1); }
  prev() { return this.setStation(this.index - 1); }

  // fade music down while sirens / explosions play
  setDuck(d) { this.duck = d; }

  newMelody() {
    const s = this.station;
    if (!s.scale) { this.melodyLine = []; return; }
    const scale = SCALES[s.scale];
    const line = [];
    for (let i = 0; i < 16; i++) {
      if (Math.random() < (s.style === 'dub' ? 0.25 : 0.55)) {
        line.push(scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0));
      } else line.push(null);
    }
    this.melodyLine = line;
  }

  update() {
    const ctx = this.audio.ctx;
    const s = this.station;
    if (!ctx || !this.gain) return;
    if (!s.bpm || !this.enabled) {
      this.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      return;
    }
    this.gain.gain.setTargetAtTime(this.volume * this.duck, ctx.currentTime, 0.25);

    const stepDur = 60 / s.bpm / 4;
    const lookahead = 0.25;
    let guard = 0;
    while (this.nextTime < ctx.currentTime + lookahead && guard++ < 64) {
      const swing = (this.step % 2 === 1) ? stepDur * (s.swing || 0) : 0;
      this.scheduleStep(this.nextTime + swing, this.step, s);
      this.nextTime += stepDur;
      this.step++;
      if (this.step % 16 === 0) {
        this.bar++;
        if (this.bar % 4 === 0 && Math.random() < 0.7) this.newMelody();
      }
    }
  }

  // ---- instruments ----
  _env(dest, t, a, d, peak) {
    const g = this.audio.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
    g.connect(dest);
    return g;
  }

  _tone(t, freq, dur, type, vol, filterHz) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    let node = osc;
    if (filterHz) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(filterHz, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(160, filterHz * 0.4), t + dur);
      f.Q.value = 6;
      osc.connect(f);
      node = f;
    }
    const g = this._env(this.gain, t, 0.006, dur, vol);
    node.connect(g);
    osc.start(t);
    osc.stop(t + dur + 0.06);
  }

  _kick(t, vol = 0.85) {
    const ctx = this.audio.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = this._env(this.gain, t, 0.004, 0.22, vol);
    osc.connect(g);
    osc.start(t); osc.stop(t + 0.3);
  }

  _noiseHit(t, dur, vol, hz, q = 1) {
    const ctx = this.audio.ctx;
    const src = ctx.createBufferSource();
    if (!this._nb) {
      const len = ctx.sampleRate * 0.5;
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._nb = b;
    }
    src.buffer = this._nb;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = hz; f.Q.value = q;
    const g = this._env(this.gain, t, 0.002, dur, vol);
    src.connect(f); f.connect(g);
    src.start(t); src.stop(t + dur + 0.05);
  }

  scheduleStep(t, step, s) {
    const i = step % 16;
    const barIdx = Math.floor(step / 16) % s.prog.length;
    const scale = SCALES[s.scale];
    const degree = s.prog[barIdx];
    const rootMidi = s.root + scale[degree % scale.length];

    switch (s.style) {
      case 'disco': {
        if (i % 4 === 0) this._kick(t, 0.9);
        if (i % 8 === 4) this._noiseHit(t, 0.18, 0.5, 2200, 0.8);
        if (i % 2 === 1) this._noiseHit(t, 0.045, 0.16, 8000, 1.2);
        // octave bass
        const bn = rootMidi - 12 + (i % 4 === 2 ? 12 : 0);
        if (i % 2 === 0) this._tone(t, midiToFreq(bn), 0.16, 'sawtooth', 0.4, 700);
        if (i % 8 === 0) {
          for (const iv of [0, 3, 7]) this._tone(t, midiToFreq(rootMidi + 12 + iv), 0.5, 'triangle', 0.11, 2400);
        }
        const m = this.melodyLine[i];
        if (m !== null && m !== undefined && i % 2 === 0) {
          this._tone(t, midiToFreq(s.root + 24 + m), 0.22, 'square', 0.1, 3000);
        }
        break;
      }
      case 'pop': {
        if (i === 0 || i === 8) this._kick(t, 0.8);
        if (i === 4 || i === 12) this._noiseHit(t, 0.2, 0.45, 1900, 0.7);
        if (i % 2 === 0) this._noiseHit(t, 0.04, 0.1, 7000, 1.4);
        if (i % 4 === 0) {
          for (const iv of [0, 4, 7]) this._tone(t, midiToFreq(rootMidi + 12 + iv), 0.62, 'triangle', 0.1, 2000);
        }
        if (i % 4 === 0) this._tone(t, midiToFreq(rootMidi - 12), 0.34, 'sine', 0.34, 500);
        const m = this.melodyLine[i];
        if (m != null && (i % 2 === 0)) this._tone(t, midiToFreq(s.root + 24 + m), 0.26, 'triangle', 0.12, 3200);
        break;
      }
      case 'dub': {
        if (i === 0 || i === 10) this._kick(t, 0.95);
        if (i === 8) this._noiseHit(t, 0.3, 0.42, 1500, 0.6);
        if (i % 8 === 6) this._noiseHit(t, 0.09, 0.14, 6000, 1.5);
        if (i % 8 === 0) this._tone(t, midiToFreq(rootMidi - 24), 0.7, 'sine', 0.55, 260);
        // off-beat skank chords
        if (i % 4 === 2) {
          for (const iv of [0, 3, 7]) this._tone(t, midiToFreq(rootMidi + 12 + iv), 0.16, 'square', 0.07, 1500);
        }
        const m = this.melodyLine[i];
        if (m != null && i % 4 === 0) this._tone(t, midiToFreq(s.root + 24 + m), 0.5, 'sine', 0.09, 1800);
        break;
      }
      case 'trance': {
        this._noiseHit(t, 0.03, 0.07, 9000, 1.6);
        if (i % 4 === 0) this._kick(t, 0.95);
        if (i % 8 === 4) this._noiseHit(t, 0.16, 0.4, 2400, 0.8);
        // rolling 16th bass
        this._tone(t, midiToFreq(rootMidi - 12), 0.085, 'sawtooth', 0.3, 900);
        if (i % 16 === 0) {
          for (const iv of [0, 3, 7, 10]) this._tone(t, midiToFreq(rootMidi + 12 + iv), 1.4, 'sawtooth', 0.055, 1600);
        }
        const m = this.melodyLine[i];
        if (m != null) this._tone(t, midiToFreq(s.root + 24 + m), 0.16, 'square', 0.085, 3600);
        break;
      }
      case 'rock': {
        if (i % 8 === 0 || i % 8 === 3) this._kick(t, 0.9);
        if (i % 8 === 4) this._noiseHit(t, 0.22, 0.55, 1700, 0.5);
        this._noiseHit(t, 0.05, 0.12, 9500, 1.1);
        // palm-muted power chords
        if (i % 2 === 0) {
          this._tone(t, midiToFreq(rootMidi), 0.14, 'sawtooth', 0.26, 1400);
          this._tone(t, midiToFreq(rootMidi + 7), 0.14, 'sawtooth', 0.2, 1400);
        }
        const m = this.melodyLine[i];
        if (m != null && i % 2 === 1) this._tone(t, midiToFreq(s.root + 24 + m), 0.2, 'sawtooth', 0.11, 3000);
        break;
      }
      case 'talk': {
        // sparse lounge bed + "speech" blips
        if (i === 0) this._kick(t, 0.4);
        if (i === 8) this._noiseHit(t, 0.14, 0.2, 1600, 0.7);
        if (i % 8 === 0) {
          for (const iv of [0, 3, 7]) this._tone(t, midiToFreq(rootMidi + iv), 1.0, 'sine', 0.06, 1200);
        }
        if (Math.random() < 0.28) {
          const f = 180 + Math.random() * 260;
          this._tone(t, f, 0.07 + Math.random() * 0.09, 'sawtooth', 0.05, 900);
        }
        break;
      }
    }
  }
}
