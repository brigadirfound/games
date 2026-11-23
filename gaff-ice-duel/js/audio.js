// Весь звук идёт через Web Audio: эффекты синтезируются, музыка играет буфером.
// Ни одного медиа-элемента — см. подробности у _buffer().
// suspend()/resume() дергает только platform.js на время рекламы (п. 4.7).
const Ctx = window.AudioContext || window.webkitAudioContext;

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noise = null;
    this.blockers = new Set();
  }

  block(reason, on) {
    if (on) this.blockers.add(reason); else this.blockers.delete(reason);
    if (this.blockers.size) this.suspend(); else this.resume();
  }

  /** Создаётся по первому жесту игрока — иначе браузер не даст звук. */
  unlock() {
    if (this.blockers.size) return;
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.75;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.75;
    if (m) this.pauseMusic(); else this.resumeMusic();
  }

  /*
    Музыка — буфер в графе Web Audio, а не элемент <audio>.

    Медиа-элемент браузер регистрирует в системном плеере: на десктопе всплывает
    окно управления воспроизведением (п. 1.6.2.5), на мобильном — строка в панели
    уведомлений (п. 1.6.1.6). Ровно за это игру отклонили 21.08.2026.

    Тем же махом уходит вторая беда: элемент не слушает suspend() контекста и
    продолжал играть после ухода со вкладки и сворачивания окна (п. 1.3).

    Раскодированным держим только звучащий трек. 184 секунды моно при 44.1 кГц —
    это 32 МБ, и два таких буфера рядом на телефоне лишние. Файлы переведены в
    моно именно поэтому: вдвое меньше памяти при той же музыке.
  */
  _buffer(kind) {
    this._buffers ||= Object.create(null);
    this._loading ||= Object.create(null);
    if (this._buffers[kind]) return Promise.resolve(this._buffers[kind]);
    if (this._loading[kind]) return this._loading[kind];
    if (!this.ctx) return Promise.resolve(null);
    this._loading[kind] = fetch(`assets/audio/${kind}.mp3`)
      .then((r) => r.arrayBuffer())
      .then((raw) => new Promise((resolve, reject) => {
        // Старый webkit промиса не возвращает — принимаем оба вида.
        const maybe = this.ctx.decodeAudioData(raw, resolve, reject);
        if (maybe?.then) maybe.then(resolve, reject);
      }))
      .then((buf) => {
        for (const key of Object.keys(this._buffers)) if (key !== kind) delete this._buffers[key];
        this._buffers[kind] = buf;
        return buf;
      })
      .catch(() => null)
      .finally(() => { delete this._loading[kind]; });
    return this._loading[kind];
  }

  _startSource() {
    if (!this.ctx || this._src || !this._current) return;
    const buf = this._buffers?.[this._current];
    if (!buf) return;
    if (!this._musicGain) {
      this._musicGain = this.ctx.createGain();
      this._musicGain.connect(this.master);
    }
    this._musicGain.gain.value = this._current === 'menu' ? 0.32 : 0.24;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this._musicGain);
    // Позицию помним сами: источник Web Audio не ставится на паузу, только
    // останавливается и пересоздаётся с нужного места.
    const offset = (this._offset || 0) % buf.duration;
    src.start(0, offset);
    this._src = src;
    this._startedAt = this.ctx.currentTime - offset;
  }

  _wantMusic() {
    if (this.muted || this.blockers.size || !this._current) return;
    const wanted = this._current;
    this._buffer(wanted).then(() => {
      if (this._current === wanted && !this.muted && !this.blockers.size) this._startSource();
    });
  }

  music(kind) {
    if (this._current !== kind) { this.pauseMusic(); this._offset = 0; }
    this._current = kind || null;
    this.unlock();
    this._wantMusic();
  }

  pauseMusic() {
    if (!this._src) return;
    const buf = this._src.buffer;
    if (this.ctx && buf) this._offset = (this.ctx.currentTime - this._startedAt) % buf.duration;
    try { this._src.stop(); } catch { /* уже остановлен */ }
    this._src.disconnect();
    this._src = null;
  }

  resumeMusic() { this._wantMusic(); }

  suspend() { this.pauseMusic(); try { this.ctx?.suspend?.(); } catch { /* контекст ещё не создан */ } }

  /** Контекст поднимаем ПЕРЕД музыкой: у остановленного не идёт время. */
  resume() {
    // holdForAd держит рекламный показ: без него возврат вкладки в фокус
    // включал бы музыку поверх ролика, а это уже п. 4.7.
    if (this.muted || this.holdForAd || this.blockers.size) return;
    try { this.ctx?.resume?.(); } catch { /* нет контекста */ }
    this.resumeMusic();
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Кешированный буфер белого шума — основа для свистов, всплесков и треска. */
  _noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _env(gain, t, attack, decay, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone({ freq = 220, to = null, type = 'sine', dur = 0.2, peak = 0.3, attack = 0.005, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.now + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    this._env(g, t, attack, dur, peak);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + attack + 0.05);
  }

  noise({ dur = 0.25, peak = 0.25, freq = 1200, to = null, q = 1, type = 'bandpass', delay = 0 }) {
    if (!this.ctx) return;
    const t = this.now + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(Math.max(60, to), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this._env(g, t, 0.008, dur, peak);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.1);
  }

  /* --------------------------------------------------------- игровые звуки */

  hookThrow() {                         // свист багра в полёте
    this.noise({ dur: 0.34, peak: 0.22, freq: 400, to: 2600, q: 1.4 });
    this.tone({ freq: 180, to: 90, type: 'triangle', dur: 0.18, peak: 0.12 });
  }

  chainClank() {                        // лязг цепи при натяжении
    this.tone({ freq: 900 + Math.random() * 300, to: 500, type: 'square', dur: 0.07, peak: 0.06 });
  }

  hookBody() {                          // попал по бойцу — глухой рывок
    this.tone({ freq: 130, to: 60, type: 'sine', dur: 0.26, peak: 0.4 });
    this.noise({ dur: 0.14, peak: 0.2, freq: 700, to: 200, q: 0.8 });
  }

  hookWall() {                          // застрял в торосе — звонкий металл по льду
    this.tone({ freq: 1500, to: 700, type: 'square', dur: 0.12, peak: 0.14 });
    this.noise({ dur: 0.3, peak: 0.18, freq: 2400, to: 900, q: 2.5 });
  }

  hookMiss() { this.noise({ dur: 0.2, peak: 0.1, freq: 1800, to: 500, q: 1 }); }

  iceCrack() {                          // треск льда
    this.noise({ dur: 0.09, peak: 0.28, freq: 3000, to: 1200, q: 3 });
    this.noise({ dur: 0.22, peak: 0.16, freq: 900, to: 300, q: 1.5, delay: 0.05 });
  }

  splash() {                            // провалился в полынью
    this.noise({ dur: 0.5, peak: 0.34, freq: 300, to: 2200, q: 0.7 });
    this.tone({ freq: 320, to: 80, type: 'sine', dur: 0.35, peak: 0.18 });
  }

  melee() {
    this.tone({ freq: 160, to: 70, type: 'triangle', dur: 0.14, peak: 0.3 });
    this.noise({ dur: 0.1, peak: 0.16, freq: 1400, to: 400, q: 1.2 });
  }

  dash() { this.noise({ dur: 0.24, peak: 0.16, freq: 900, to: 2400, q: 1.6 }); }

  trapSet() { this.tone({ freq: 700, to: 1400, type: 'triangle', dur: 0.16, peak: 0.14 }); }

  trapHit() {
    this.noise({ dur: 0.16, peak: 0.24, freq: 2600, to: 800, q: 3 });
    this.tone({ freq: 240, to: 120, type: 'square', dur: 0.2, peak: 0.14 });
  }

  finisherWindup() {                    // замах: воздух втягивается
    this.noise({ dur: 0.34, peak: 0.2, freq: 2200, to: 300, q: 1.2 });
  }

  finisherHit() {                       // ключевой удар матча
    this.tone({ freq: 90, to: 38, type: 'sine', dur: 0.7, peak: 0.5 });
    this.tone({ freq: 1400, to: 300, type: 'square', dur: 0.16, peak: 0.12 });
    this.noise({ dur: 0.55, peak: 0.3, freq: 1800, to: 200, q: 1 });
    this.iceCrack();
  }

  roundWin() {
    [523, 659, 784].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.22, peak: 0.18, delay: i * 0.1 }));
  }

  roundLose() {
    [392, 330, 262].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.26, peak: 0.16, delay: i * 0.12 }));
  }

  matchWin() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.3, peak: 0.2, delay: i * 0.12 }));
  }

  click() { this.tone({ freq: 620, to: 480, type: 'triangle', dur: 0.07, peak: 0.1 }); }

  coin() {
    this.tone({ freq: 880, type: 'triangle', dur: 0.1, peak: 0.14 });
    this.tone({ freq: 1320, type: 'triangle', dur: 0.14, peak: 0.12, delay: 0.08 });
  }

  countdown(last) {
    this.tone({ freq: last ? 900 : 600, type: 'triangle', dur: last ? 0.3 : 0.14, peak: 0.18 });
  }
}

export const Sound = new SoundEngine();
