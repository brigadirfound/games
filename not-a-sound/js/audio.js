(function () {
  'use strict';

  /**
   * Звук игры.
   *
   * Синтез вместо файлов — сознательный выбор фермы: ноль байт в архиве, ноль
   * вопросов о правах на п. 3.5, и новая игра звучит иначе простой сменой
   * пресета, а не поиском сэмплов.
   *
   * Обязательное поведение по п. 4.7: на время рекламы звук глушится, после —
   * восстанавливается. Подписка на `platform-ad-state` ниже — это не удобство,
   * а требование площадки, снимать её нельзя.
   */

  const Sfx = {
    ctx: null,
    _platformMuted: false,
    master: null,
    enabled: true,
    _adPaused: false,
    _gamePaused: false,
    _focusLost: false,
    _pageHidden: false,
    _platformPaused: false,

    init() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return this;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // Браузеры не дают запустить звук до первого касания — это норма,
      // поэтому контекст будим на первом же действии игрока.
      const wake = () => { if (!this._silent() && ['suspended','interrupted'].includes(this.ctx.state)) this.ctx.resume().catch(() => {}); };
      window.addEventListener('pointerdown', wake, { passive: true });
      window.addEventListener('keydown', wake, { passive: true });

      window.addEventListener('platform-ad-state', e => {
        this._adPaused = !!(e.detail && e.detail.paused);
        this._apply();
      });

      /*
        Глушение по команде площадки.

        У площадки своя кнопка звука над игрой, и её значение обязано
        перебивать внутриигровой переключатель: игрок выключил звук на сайте —
        значит звука нет, что бы ни стояло в самой игре. Отдельный флаг, а не
        `enabled`, именно поэтому: возвращать состояние своей кнопки после
        снятия внешнего глушения иначе было бы нечем.
      */
      window.addEventListener('platform-mute', e => {
        this._platformMuted = !!(e.detail && e.detail.muted);
        this._apply();
      });

      window.addEventListener('visibilitychange', () => this._apply());
      window.addEventListener('blur', () => { this._focusLost=true;this._apply(); });
      window.addEventListener('focus', () => { this._focusLost=false;this._apply(); });
      window.addEventListener('pagehide', () => { this._pageHidden=true;this._apply(); });
      window.addEventListener('pageshow', () => { this._pageHidden=false;this._apply(); });
      window.addEventListener('platform-pause', e => { this._platformPaused=!!e.detail?.paused;this._apply(); });
      return this;
    },

    _silent() {
      return !this.enabled || this._adPaused || this._platformMuted || this._gamePaused || this._focusLost || this._pageHidden || this._platformPaused || document.hidden;
    },

    /**
     * Публичная проверка тишины — для звуков, которые собирает сама игра.
     *
     * В «Эхо-укрытии» страшный слой (сердце, шаги соседа, скрипы) синтезируется
     * отдельным модулем, но обязан подчиняться тем же правилам: глушению на
     * рекламе по п. 4.7 и переключателю звука. Без этого нашлось бы, что ролик
     * идёт, а сердце продолжает стучать.
     */
    silent() { return this._silent(); },

    _apply() {
      if (!this.ctx) return;
      window.dispatchEvent(new CustomEvent('sfx-state'));
      if (this._silent()) {
        if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
      } else if (['suspended','interrupted'].includes(this.ctx.state)) {
        this.ctx.resume().catch(() => {});
      }
    },

    setEnabled(on) {
      this.enabled = !!on;
      if (window.Platform) window.Platform.save('sound', this.enabled);
      this._apply();
      return this.enabled;
    },

    toggle() { return this.setEnabled(!this.enabled); },
    setPaused(on) { this._gamePaused=!!on;this._apply(); },

    /**
     * Короткий тон. Из этого кирпича собираются все игровые звуки: клик,
     * успех, ошибка. Частоты берутся из пентатоники — любые два тона звучат
     * согласованно, поэтому подбирать их на слух не нужно.
     */
    tone(freq, durationMs, type, volume) {
      if (!this.ctx || this._silent()) return;
      const now = this.ctx.currentTime;
      const dur = (durationMs || 90) / 1000;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(volume == null ? 0.3 : volume, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(now);
      osc.stop(now + dur + 0.02);
    },

    // Пентатоника: ступени, на которых нельзя сыграть фальшиво.
    SCALE: [261.6, 293.7, 329.6, 392.0, 440.0, 523.3, 587.3, 659.3],

    click() { this.tone(this.SCALE[3], 60, 'triangle', 0.22); },
    good(step) { this.tone(this.SCALE[Math.min(7, step || 0)], 120, 'sine', 0.28); },
    bad() { this.tone(110, 220, 'sawtooth', 0.18); }
  };

  // НЕ window.Audio: это имя занято браузерным конструктором HTMLAudioElement,
  // и его затирание ломает любой new Audio() в игре. Стоило одного зависшего
  // загрузочного экрана, прежде чем нашлось.
  window.Sfx = Sfx;
}());
