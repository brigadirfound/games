// Оркестратор: сцена, камера, матч-цикл, реакция на события симуляции.
// Цикл: фиксированный шаг симуляции + интерполяция при рендере.
// Замедление времени и тряска живут здесь, симуляция о них не знает.
import * as THREE from 'three';
import { T } from './tuning.js';
import { ARENA } from './arena.js';
import { buildArenaMesh } from './arenamesh.js';
import { Sim, STATE } from './sim.js';
import { View } from './view.js';
import { LocalInput } from './input.js';
import { Bot, botLevel } from './bot.js';
import { Sound } from './audio.js';
import { skinById, hookSkinById, BOT_SKIN } from './skins.js';
import { Training } from './training.js';

const PHASE = { IDLE: 'idle', COUNTDOWN: 'countdown', PLAY: 'play', ROUND_END: 'roundEnd', PAUSED: 'paused' };

/**
 * Небо вертикальным градиентом вместо заливки одним цветом: у кадра появляется верх и низ.
 * Рисуется в canvas на лету — никаких файлов-ассетов. Нижний цвет совпадает с туманом,
 * поэтому горизонт сходится без шва. Время суток не меняем: сцена дневная.
 */
function makeSkyTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0.00, '#6b93b6');   // зенит
  grad.addColorStop(0.55, '#9fbccd');   // прежний ровный цвет
  grad.addColorStop(1.00, '#c2d9e6');   // у горизонта светлее
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.phase = PHASE.IDLE;
    this.sim = null;
    this.bot = null;
    this.levelIndex = 0;
    this.score = [0, 0];
    this.roundNo = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.shake = 0;
    this.acc = 0;
    this.last = performance.now();
    this.phaseT = 0;
    this.countdownShown = -1;
    this.pendingCooldownReset = false;   // награда «сброс кулдаунов» на следующий раунд

    // колбэки наружу (ui.js их переопределяет)
    this.onHud = () => {};
    this.onRoundEnd = () => {};
    this.onMatchEnd = () => {};
    this.onBanner = () => {};

    this._setupScene();
    this.input = new LocalInput(canvas, this.camera);
    this.aimVisible = !('ontouchstart' in window);
    this._camTarget = new THREE.Vector3(0, 0, 0);
    this._camPos = new THREE.Vector3();
    addEventListener('resize', () => this._resize());
  }

  /* ------------------------------------------------------------------ сцена */

  _setupScene() {
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !isTouch, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);

    this.scene = new THREE.Scene();
    this.scene.background = makeSkyTexture();
    // плотность считана под отъезд камеры до distMax: на 0.017 кадр с дальней
    // камерой выцветал (28% тумана на бойцах вместо прежних 13% на 22 м)
    this.scene.fog = new THREE.FogExp2(0xa8c6d6, 0.011);

    this.camera = new THREE.PerspectiveCamera(T.camera.fov, this.canvas.clientWidth / this.canvas.clientHeight, 0.5, 400);
    const rad = (T.camera.angleDeg * Math.PI) / 180;
    this.camOffset = new THREE.Vector3(0, Math.sin(rad) * T.camera.dist, Math.cos(rad) * T.camera.dist);
    this.camDist = T.camera.dist;

    this.scene.add(new THREE.HemisphereLight(0xe8f6ff, 0x5d7787, 1.0));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.75);
    sun.position.set(14, 24, 10);
    this.scene.add(sun);

    this.scene.add(buildArenaMesh());
  }

  _resize() {
    this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight, false);
  }

  /* ------------------------------------------------------------------- матч */

  startMatch(levelIndex, skinId, hookSkinId, hues) {
    this.training = null;
    this.levelIndex = levelIndex;
    this.score = [0, 0];
    this.roundNo = 0;
    this.playerSkin = skinById(skinId, hues);
    this.playerHookSkin = hookSkinById(hookSkinId);

    // Облик мог смениться в магазине между матчами. Перекрасить готовые меши
    // нельзя — пересобираем вид, освободив прежний, иначе старый облик
    // держался бы до перезагрузки страницы, а меши копились бы в сцене.
    const key = `${this.playerSkin.id}|${this.playerHookSkin.id}|${(hues ?? []).join(",")}`;
    if (this.view && this._viewKey !== key) { this.view.dispose(); this.view = null; }
    this._viewKey = key;

    if (this.view) this.view.reset();
    this.startRound();
  }

  startRound() {
    this.roundNo++;
    this.sim = new Sim();
    this.sim.fighters[1].isBot = true;
    const level = botLevel(this.levelIndex);
    this.bot = new Bot(level, 1);
    if (this.pendingCooldownReset) {
      this.sim.clearCooldowns(0);
      this.pendingCooldownReset = false;
      this.onBanner('cooldownReset');
    }

    if (!this.view) {
      this.view = new View(this.scene, [this.playerSkin, BOT_SKIN],
        [this.playerHookSkin, BOT_SKIN]);
    }
    else this.view.reset();

    this.input.aimAt(ARENA.spawns[1].x, ARENA.spawns[1].z);
    this.input.setEnabled(false);
    this.phase = PHASE.COUNTDOWN;
    this.phaseT = T.match.countdown;
    this.countdownShown = -1;
    this.timeScale = 1;
    this.slowT = 0;
    this.shake = 0;
    this.acc = 0;
    this._zoomT = 0;
    this._cameraSnap = true;
    this._camera(0);
  }

  pause() {
    if (this.phase !== PHASE.PLAY && this.phase !== PHASE.COUNTDOWN) return;
    this._resumePhase = this.phase;
    this.phase = PHASE.PAUSED;
    this.input.setEnabled(false);
  }

  resume() {
    if (this.phase !== PHASE.PAUSED) return;
    this.phase = this._resumePhase ?? PHASE.PLAY;
    this.input.setEnabled(this.phase === PHASE.PLAY);
    this.last = performance.now();
  }

  abandonMatch() {
    this.training = null;
    this.phase = PHASE.IDLE;
    this.input.setEnabled(false);
    this.view?.reset();
  }

  grantCooldownReset() { this.pendingCooldownReset = true; }

  /* -------------------------------------------------------------------- цикл */

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      this._frame(now);
    };
    requestAnimationFrame(loop);
  }

  _frame(now) {
    const raw = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    if (this.slowT > 0) {
      this.slowT -= raw;
      if (this.slowT <= 0) this.timeScale = 1;
    }

    if (this.phase === PHASE.COUNTDOWN) {
      this.phaseT -= raw;
      const n = Math.ceil(this.phaseT);
      if (n !== this.countdownShown && n > 0) {
        this.countdownShown = n;
        Sound.countdown(n === 1);
        this.onBanner('countdown', n);
      }
      if (this.phaseT <= 0) {
        this.phase = PHASE.PLAY;
        this.input.setEnabled(true);
        this.onBanner('fight');
      }
    } else if (this.phase === PHASE.PLAY) {
      this.acc += raw * this.timeScale;
      let steps = 0;
      while (this.phase === PHASE.PLAY && this.acc >= T.step && steps < T.maxStepsPerFrame) {
        this._tick();
        this.acc -= T.step;
        steps++;
      }
      if (steps === T.maxStepsPerFrame) this.acc = 0;   // отстали (сворачивание) — не догоняем рывком
    } else if (this.phase === PHASE.ROUND_END) {
      this.phaseT -= raw;
      if (this.phaseT <= 0) this._afterRound();
    }

    if (this.sim) {
      const alpha = this.phase === PHASE.PLAY ? this.acc / T.step : 1;
      this.view.sync(this.sim, alpha, this.phase === PHASE.PAUSED ? 0 : raw);
      this.view.syncAim(this.sim, 0, this.input.aim, this.aimVisible);
      this._camera(raw);
      this.onHud(this._hudData());
    }
    this.renderer.render(this.scene, this.camera);
  }

  _tick() {
    if (this.training) { this.training.tick(this.input.intent()); return; }
    const sim = this.sim;
    const intents = {
      0: this.input.intent(),
      1: this.bot.intent(sim, T.step),
    };
    sim.step(intents);
    this._events(sim.drainEvents());
  }

  startTraining(onStep, onDone) {
    this.startMatch(0, 'default', 'steel');
    this.training = new Training(this, onStep, onDone);
    this.phase = PHASE.PLAY; this.input.setEnabled(true);
  }

  _events(events) {
    for (const e of events) {
      switch (e.type) {
        case 'hook-throw': Sound.hookThrow(); break;
        case 'hook-hit-body':
          Sound.hookBody(); Sound.chainClank();
          this.shake = Math.max(this.shake, 0.16);
          // цель — соперник бросавшего; событие несёт только id хозяина крюка
          this.view.hit(e.id === 0 ? 1 : 0, e.x, e.z);
          if (e.id === 0) this._zoom(0.35);
          break;
        case 'hook-hit-wall': Sound.hookWall(); if (e.id === 0) this._zoom(0.3); break;
        case 'hook-miss': Sound.hookMiss(); break;
        case 'dash': {
          Sound.dash();
          const f = this.sim.fighters[e.id];
          this.view.impacts.emit(f.x,f.z,e.id===0?0x51d0ff:0xff7b4a,1.5,.35);
          break;
        }
        case 'trap-set': Sound.trapSet(); break;
        case 'trap-hit':
          Sound.trapHit(); this.shake = Math.max(this.shake, 0.1);
          this.view.hit(e.id, e.x, e.z);
          break;
        case 'melee-hit':
          Sound.melee();
          this.shake = Math.max(this.shake, 0.12);
          this.view.hit(e.target, e.x, e.z);
          break;
        case 'melee-miss': Sound.hookMiss(); break;
        case 'hole':
          Sound.splash(); Sound.iceCrack();
          this.view.splash(e.x, e.z);
          this.shake = Math.max(this.shake, 0.22);
          break;
        case 'finisher-start': Sound.finisherWindup(); this._zoom(T.finisher.telegraph + 0.4); break;
        case 'finisher-hit':
          Sound.finisherHit();
          this.timeScale = T.finisher.timeScale;
          this.slowT = T.finisher.slowmo;
          this.shake = T.finisher.shake;
          break;
        case 'finisher-escape': Sound.hookMiss(); break;
        case 'death':
          this.view.burst(this.sim.fighters[e.id]);
          this.shake = Math.max(this.shake, 0.3);
          break;
        case 'round-over': this._roundOver(e); break;
        default: break;
      }
    }
  }

  _zoom(seconds) {
    this._zoomT = Math.max(this._zoomT ?? 0, seconds);
  }

  _roundOver({ winner }) {
    if (this.phase === PHASE.ROUND_END) return;
    if (winner >= 0) this.score[winner]++;
    this.lastRoundWinner = winner;
    this.phase = PHASE.ROUND_END;
    this.phaseT = winner === 0 ? 1.9 : 1.6;
    this.input.setEnabled(false);
    if (winner === 0) Sound.roundWin(); else if (winner === 1) Sound.roundLose();
  }

  _afterRound() {
    const matchOver = this.score[0] >= T.match.winsToTake || this.score[1] >= T.match.winsToTake;
    // фаза сбрасывается ДО колбэков, иначе _frame зовёт _afterRound каждый кадр
    this.phase = PHASE.IDLE;
    if (matchOver) {
      const playerWon = this.score[0] > this.score[1];
      if (playerWon) Sound.matchWin();
      this.onMatchEnd({
        playerWon,
        score: [...this.score],
        levelIndex: this.levelIndex,
        rounds: this.roundNo,
      });
    } else {
      this.onRoundEnd({ winner: this.lastRoundWinner, score: [...this.score] });
    }
  }

  /* ------------------------------------------------------------------ камера */

  _camera(dt) {
    const me = this.sim.fighters[0];
    const foe = this.sim.fighters[1];
    const anchor = me.state === STATE.DEAD ? foe : me;

    // кадр держит обоих: центр уводится от игрока к сопернику, иначе на
    // расхождении соперник оказывается позади камеры и дуэль идёт вслепую
    const other = anchor === me ? foe : me;
    const alive = other.state !== STATE.DEAD;
    const sep = alive ? Math.hypot(other.x - anchor.x, other.z - anchor.z) : 0;
    const bias = alive ? T.camera.foeBias : 0;
    const bx = anchor.x + (other.x - anchor.x) * bias;
    const bz = anchor.z + (other.z - anchor.z) * bias;

    // центр кадра слегка уводится к прицелу — видно, куда полетит крюк
    const aimDX = this.input.aim.x - anchor.x, aimDZ = this.input.aim.z - anchor.z;
    const tx = bx + aimDX * T.camera.aimLead;
    const tz = bz + aimDZ * T.camera.aimLead;
    this._camTarget.lerp(new THREE.Vector3(tx, 0, tz), this._cameraSnap ? 1 : 1 - Math.exp(-T.camera.lerp * dt));

    // зум на действиях (крюк попал, добивание) — плавно и обратно;
    // иначе дистанция растёт с расхождением бойцов
    this._zoomT = Math.max(0, (this._zoomT ?? 0) - dt);
    const spread = T.camera.dist + Math.max(0, sep - T.camera.sepFree) * T.camera.sepZoom;
    const wantDist = this._zoomT > 0
      ? T.camera.distZoom
      : Math.min(T.camera.distMax, spread);
    this.camDist += (wantDist - this.camDist) * Math.min(1, 4 * dt);
    const rad = (T.camera.angleDeg * Math.PI) / 180;
    this.camOffset.set(0, Math.sin(rad) * this.camDist, Math.cos(rad) * this.camDist);

    this._camPos.copy(this._camTarget).add(this.camOffset);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6);
      const s = this.shake * this.shake * 1.6;
      this._camPos.x += (Math.random() - 0.5) * s;
      this._camPos.y += (Math.random() - 0.5) * s;
      this._camPos.z += (Math.random() - 0.5) * s;
    }
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camTarget);
    // Fit both complete bodies into the usable area, including the first frame.
    // Zoom out immediately to prevent clipping; the normal distance eases back in.
    for (let attempt = 0; attempt < 45; attempt++) {
      this.camera.updateMatrixWorld();
      const visible = [me, foe].every(f => [0, 2.2].every(y => {
        const p = new THREE.Vector3(f.x, y, f.z).project(this.camera);
        return Math.abs(p.x) < 0.85 && p.y > -0.52 && p.y < 0.68 && p.z < 1;
      }));
      if (visible) break;
      this.camDist += 1;
      this.camOffset.set(0, Math.sin(rad) * this.camDist, Math.cos(rad) * this.camDist);
      this.camera.position.copy(this._camTarget).add(this.camOffset);
      this.camera.lookAt(this._camTarget);
    }
    this._cameraSnap = false;
  }

  /* --------------------------------------------------------------------- HUD */

  _hudData() {
    const me = this.sim.fighters[0], foe = this.sim.fighters[1];
    return {
      hp: me.hp, hpMax: me.maxHp,
      foeHp: foe.hp, foeHpMax: foe.maxHp,
      score: this.score,
      time: Math.max(0, T.match.roundTime - this.sim.time),
      cd: {
        hook: me.cd.hook / T.hook.cooldown,
        dash: me.cd.dash / T.dash.cooldown,
        trap: me.cd.trap / T.trap.cooldown,
      },
      cdSec: { hook: me.cd.hook, dash: me.cd.dash, trap: me.cd.trap },
      foeLow: foe.hp <= foe.maxHp * T.finisher.hpFrac && foe.state !== STATE.DEAD,
      phase: this.phase,
    };
  }
}

export { PHASE };
