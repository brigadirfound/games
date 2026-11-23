import * as THREE from 'three';
import { rand, randInt, pick, clamp } from './physics.js';
import { CAR_BY_ID } from './vehicle.js';

// ---------------------------------------------------------------------------
// A 12-mission campaign in three acts with a real ending.
// ---------------------------------------------------------------------------
export const STORY = [
  // ---- ACT I: мелкая сошка ----
  {
    id: 'first_ride', act: 1, title: 'ПЕРВАЯ ПОЕЗДКА', giver: 'ЛУИДЖИ',
    brief: 'Угони любую тачку и пригони её к точке.',
    intro: 'Луиджи: «Новенький? Докажи, что руки растут откуда надо. Пригони тачку.»',
    outro: 'Луиджи: «Неплохо. Может, из тебя и выйдет толк.»',
    reward: 800, type: 'deliver', time: 120,
  },
  {
    id: 'hot_wheels', act: 1, title: 'ГОРЯЧИЕ КОЛЁСА', giver: 'ДЖОУИ',
    brief: 'Достань спорткар и пригони его в гараж целым.',
    intro: 'Джоуи: «Клиенту нужна Banshee. Без единой царапины, ясно?»',
    outro: 'Джоуи: «Чистая работа. Держи долю.»',
    reward: 1500, type: 'steal_specific', carId: 'sport', time: 150, minHealth: 60,
  },
  {
    id: 'collector', act: 1, title: 'СБОР ДАНИ', giver: 'ТОНИ',
    brief: 'Объезжай 4 точки и собирай выручку. Тебя будут ждать.',
    intro: 'Тони: «Лавочники обнаглели. Объезжай их и забирай наше.»',
    outro: 'Тони: «Теперь они снова уважают семью.»',
    reward: 2200, type: 'collect', count: 4, time: 200,
  },
  {
    id: 'clean_streets', act: 1, title: 'ЧИСТЫЕ УЛИЦЫ', giver: 'ТОНИ',
    brief: 'Устрани 5 бойцов вражеской банды.',
    intro: 'Тони: «Багровые лезут на нашу землю. Объясни им границы.»',
    outro: 'Тони: «Улицы стали чище. Босс это заметил.»',
    reward: 2800, type: 'hitlist', count: 5, time: 200,
  },
  // ---- ACT II: доверие семьи ----
  {
    id: 'bomb_run', act: 2, title: 'ДОСТАВКА С СЮРПРИЗОМ', giver: 'КАЛВИН',
    brief: 'Бомба рванёт, если скорость упадёт ниже 30 км/ч. Довези фургон.',
    intro: 'Калвин: «В кузове бомба с датчиком скорости. Тормознёшь — соберём тебя ложкой.»',
    outro: 'Калвин: «Живой? Я ставил против тебя. Забирай деньги.»',
    reward: 4000, type: 'speed_bomb', time: 110, minSpeed: 8.3,
  },
  {
    id: 'protect', act: 2, title: 'ЭСКОРТ', giver: 'ДЖОУИ',
    brief: 'Сопроводи машину босса. Не дай её уничтожить.',
    intro: 'Джоуи: «Босс едет на встречу. Прикрой его — на него открыли охоту.»',
    outro: 'Джоуи: «Босс доехал целым. Ты в деле по-крупному.»',
    reward: 5000, type: 'escort', time: 180,
  },
  {
    id: 'rampage', act: 2, title: 'ПОКАЗАТЕЛЬНАЯ ПОРКА', giver: 'ЭЛЬ БУРРО',
    brief: 'Взорви 8 машин конкурентов за 90 секунд.',
    intro: 'Эль Бурро: «Их автопарк слишком целый. Исправь это.»',
    outro: 'Эль Бурро: «Красиво горело! Ты псих, мне нравится.»',
    reward: 5500, type: 'spree', count: 8, time: 90,
  },
  {
    id: 'the_heist', act: 2, title: 'ОГРАБЛЕНИЕ', giver: 'ДОН',
    brief: 'Забери деньги и оторвись от копов — 4 звезды розыска.',
    intro: 'Дон: «Инкассаторы. Возьмёшь кассу — весь город встанет на уши. Уходи чисто.»',
    outro: 'Дон: «Ты вернулся с деньгами. Немногие возвращаются.',
    reward: 9000, type: 'heist', time: 260, wanted: 4,
  },
  // ---- ACT III: война и предательство ----
  {
    id: 'turf_push', act: 3, title: 'ПЕРЕДЕЛ', giver: 'ДОН',
    brief: 'Захвати район: устрани 10 бойцов на чужой территории.',
    intro: 'Дон: «Пора расширяться. Возьми район под нас.»',
    outro: 'Дон: «Район наш. Ты растёшь быстро… может, слишком.»',
    reward: 11000, type: 'turf', count: 10, time: 240,
  },
  {
    id: 'betrayal', act: 3, title: 'ПРЕДАТЕЛЬСТВО', giver: '???',
    brief: 'ЗАСАДА! Выживи 90 секунд и оторвись от 5 звёзд.',
    intro: 'Дон подставил тебя. Копы уже здесь. Выживи.',
    outro: 'Ты выжил. Теперь это личное.',
    reward: 14000, type: 'survive', time: 90, wanted: 5,
  },
  {
    id: 'revenge', act: 3, title: 'ОТВЕТКА', giver: 'ТЫ САМ',
    brief: 'Уничтожь 3 бронированных машины Дона.',
    intro: 'Кортеж Дона на улицах. Разбери его по кускам.',
    outro: 'Кортеж уничтожен. Остался только он сам.',
    reward: 18000, type: 'convoy', count: 3, time: 220,
  },
  {
    id: 'finale', act: 3, title: 'ПОСЛЕДНИЙ ДОН', giver: 'ФИНАЛ',
    brief: 'Добей Дона и уйди живым. 6 звёзд. Последний бой.',
    intro: 'Дон забаррикадировался. Розыск 6 звёзд. Всё решится сейчас.',
    outro: 'ДОН МЁРТВ. ГОРОД ТВОЙ.',
    reward: 50000, type: 'boss', time: 300, wanted: 6,
  },
];

export const ACT_NAMES = {
  1: 'АКТ I · МЕЛКАЯ СОШКА',
  2: 'АКТ II · ДОВЕРИЕ СЕМЬИ',
  3: 'АКТ III · ВОЙНА',
};

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.storyIndex = 0;
    this.active = null;
    this.sideJob = null;
    this.completed = [];
    this.markerPos = null;
    this.finished = false;

    this.marker = this.buildMarker(0xffcc33);
    game.scene.add(this.marker);
    this.targetMarker = this.buildMarker(0x33ff77);
    game.scene.add(this.targetMarker);
    this.targetMarker.visible = false;

    this.placeStoryMarker();
  }

  buildMarker(color) {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(
      new THREE.CylinderGeometry(2.0, 2.0, 7, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false }));
    cyl.position.y = 3.5;
    g.add(cyl);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.3, 22),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6,
        side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    g.add(ring);
    return g;
  }

  get storyMission() { return STORY[this.storyIndex] || null; }
  get act() { return this.storyMission ? this.storyMission.act : 3; }

  placeStoryMarker() {
    if (!this.storyMission) { this.marker.visible = false; this.markerPos = null; return; }
    const p = this.game.city.randomRoadPoint();
    this.markerPos = { x: p.x, z: p.z };
    this.marker.position.set(p.x, 0, p.z);
    this.marker.visible = true;
  }

  // ------------------------------------------------------------ start
  start(def) {
    const g = this.game;
    const m = {
      def, id: def.id, title: def.title, type: def.type,
      timeLeft: def.time, reward: def.reward, progress: 0,
      need: def.count || 1, targets: [], cars: [], points: [],
    };

    switch (def.type) {
      case 'deliver':
      case 'heist': {
        const p = g.city.randomRoadPoint();
        m.dest = { x: p.x, z: p.z };
        break;
      }
      case 'steal_specific': {
        const p = g.city.randomRoadPoint();
        const v = g.spawnParkedCar(p.x, p.z, def.carId);
        v.isMissionTarget = true;
        m.car = v;
        m.dest = g.city.randomRoadPoint();
        break;
      }
      case 'collect': {
        for (let i = 0; i < def.count; i++) {
          const p = g.city.randomSidewalkPoint();
          m.points.push({ x: p.x, z: p.z, done: false });
        }
        m.dest = m.points[0];
        break;
      }
      case 'hitlist':
      case 'turf': {
        const n = Math.min(def.count, 6);
        for (let i = 0; i < n; i++) {
          const ped = g.spawnPed(false, true);
          if (!ped) continue;
          ped.armed = true; ped.hostile = true; ped.isMissionTarget = true;
          if (ped.mesh.children[0]) {
            ped.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0xff2a2a });
          }
          m.targets.push(ped);
        }
        m.need = def.count;
        break;
      }
      case 'speed_bomb': {
        const p = g.city.randomRoadPoint();
        const v = g.spawnParkedCar(p.x, p.z, 'van');
        v.isMissionTarget = true;
        m.car = v;
        m.armed = false;
        m.dest = g.city.randomRoadPoint();
        break;
      }
      case 'escort': {
        const p = g.city.randomRoadPoint();
        const v = g.spawnTrafficCar(true) || g.spawnParkedCar(p.x, p.z, 'sedan');
        v.isMissionTarget = true;
        v.color = 0x101014;
        m.car = v;
        m.dest = g.city.randomRoadPoint();
        // hostile hunters
        for (let i = 0; i < 3; i++) {
          const hp = g.city.randomRoadPoint();
          const hv = g.spawnParkedCar(hp.x, hp.z, 'coupe');
          hv.isHunter = true;
          hv.huntTarget = v;
          m.cars.push(hv);
        }
        break;
      }
      case 'convoy': {
        for (let i = 0; i < def.count; i++) {
          const p = g.city.randomRoadPoint();
          const v = g.spawnParkedCar(p.x, p.z, 'van');
          v.isMissionTarget = true;
          v.health = v.maxHealth = 200;
          m.cars.push(v);
        }
        break;
      }
      case 'survive': {
        g.addWanted(def.wanted);
        break;
      }
      case 'boss': {
        g.addWanted(def.wanted);
        const p = g.city.randomRoadPoint();
        m.dest = { x: p.x, z: p.z };
        // the Don's guards
        for (let i = 0; i < 5; i++) {
          const ped = g.spawnPed(false, true);
          if (!ped) continue;
          ped.armed = true; ped.hostile = true; ped.isMissionTarget = true;
          ped.x = m.dest.x + rand(-14, 14);
          ped.z = m.dest.z + rand(-14, 14);
          ped.health = ped.maxHealth = 160;
          ped.syncMesh();
          m.targets.push(ped);
        }
        // the Don himself
        const don = g.spawnPed(false, true);
        if (don) {
          don.armed = true; don.hostile = true; don.isBoss = true; don.isMissionTarget = true;
          don.health = don.maxHealth = 420;
          don.baseSpeed = 3.2;
          don.x = m.dest.x; don.z = m.dest.z;
          don.syncMesh();
          if (don.mesh.children[0]) {
            don.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0x1a1a1f });
          }
          m.boss = don;
        }
        break;
      }
    }

    if (m.dest) {
      this.targetMarker.position.set(m.dest.x, 0, m.dest.z);
      this.targetMarker.visible = true;
    }

    this.active = m;
    this.marker.visible = false;
    g.showMessage(def.intro, 5, { eyebrow: def.title });
    g.audio.beep(660, 0.12, 0.3);
    setTimeout(() => g.audio && g.audio.beep(880, 0.16, 0.3), 130);
    return m;
  }

  // ------------------------------------------------------------ end states
  complete() {
    const g = this.game, m = this.active;
    if (!m) return;
    g.addMoney(m.reward);
    g.stats.missions++;
    this.completed.push(m.id);
    this.cleanup(m);
    this.active = null;
    this.targetMarker.visible = false;
    this.storyIndex = Math.min(STORY.length, this.storyIndex + 1);

    const isFinale = m.id === 'finale';
    if (!g.player.inVehicle) g.player.cheer();   // жест победы, если игрок на ногах
    g.showMessage(m.def.outro, isFinale ? 6 : 4, { tone: 'success', sub: `+$${m.reward}` });
    g.audio.beep(880, 0.12, 0.3);
    setTimeout(() => g.audio && g.audio.beep(1180, 0.24, 0.3), 140);

    if (isFinale) {
      this.finished = true;
      g.wanted = 0;
      g.onCampaignComplete();
    } else {
      this.placeStoryMarker();
    }
    g.checkEndgame();
  }

  fail(reason) {
    const g = this.game, m = this.active;
    if (!m) return;
    this.cleanup(m);
    this.active = null;
    this.targetMarker.visible = false;
    g.showMessage('МИССИЯ ПРОВАЛЕНА', 3, { tone: 'fail', sub: reason });
    g.audio.beep(220, 0.4, 0.3, 'sawtooth');
    this.placeStoryMarker();
  }

  cleanup(m) {
    if (m.car) m.car.isMissionTarget = false;
    for (const c of m.cars || []) { c.isMissionTarget = false; c.isHunter = false; }
    for (const t of m.targets || []) t.isMissionTarget = false;
    if (m.boss) m.boss.isMissionTarget = false;
  }

  onPlayerDeath() {
    if (this.active) this.fail('Ты погиб');
    if (this.sideJob) this.endSideJob('Ты погиб');
  }

  onKill(ped) {
    const m = this.active;
    if (m && (m.type === 'hitlist' || m.type === 'turf') && ped.isMissionTarget) {
      m.progress++;
      this.game.showMessage(`ЦЕЛЬ УСТРАНЕНА ${m.progress}/${m.need}`, 1.5);
      // top up targets so the count is always reachable
      if (m.progress < m.need && m.targets.filter((t) => !t.dead).length < 3) {
        for (let i = 0; i < 3; i++) {
          const p = this.game.spawnPed(false, true);
          if (!p) continue;
          p.armed = true; p.hostile = true; p.isMissionTarget = true;
          if (p.mesh.children[0]) p.mesh.children[0].material = new THREE.MeshLambertMaterial({ color: 0xff2a2a });
          m.targets.push(p);
        }
      }
    }
    if (m && m.type === 'boss' && ped.isBoss) {
      m.bossDead = true;
    }
    if (this.sideJob && this.sideJob.type === 'vigilante' && (ped.gang || ped.armed)) {
      this.sideJob.progress += 120;
      this.sideJob.kills = (this.sideJob.kills || 0) + 1;
      this.sideJob.timeLeft += 8;
      this.game.addMoney(120);
      this.game.showMessage('ПРЕСТУПНИК ЛИКВИДИРОВАН +$120', 1.4);
    }
    this.game.progress.onRampageKill();
  }

  onVehicleDestroyed(v) {
    const m = this.active;
    if (!m) return;
    if (m.type === 'convoy' && m.cars.includes(v)) {
      m.progress++;
      this.game.showMessage(`БРОНЕВИК УНИЧТОЖЕН ${m.progress}/${m.need}`, 1.8);
    }
    if (m.type === 'escort' && v === m.car) this.fail('Машину босса уничтожили');
  }

  onExplosion() {
    const m = this.active;
    if (m && m.type === 'spree') {
      m.progress++;
      if (m.progress < m.need) this.game.showMessage(`${m.progress}/${m.need}`, 1);
    }
  }

  onEnterVehicle(v) {
    const m = this.active;
    if (!m) return;
    if (m.type === 'speed_bomb' && v === m.car && !m.armed) {
      m.armed = true;
      this.game.showMessage('БОМБА АКТИВИРОВАНА!\nНЕ СНИЖАЙ СКОРОСТЬ', 3);
    }
  }

  // ------------------------------------------------------------ side jobs
  startSideJob(type) {
    const g = this.game;
    if (type === 'taxi') {
      const p = g.city.randomSidewalkPoint();
      this.sideJob = { type, stage: 'pickup', pos: p, fares: 0, timeLeft: 70, progress: 0 };
      g.showMessage('РЕЖИМ ТАКСИ\nЗабери пассажира', 2.5);
    } else if (type === 'vigilante') {
      this.sideJob = { type, timeLeft: 60, progress: 0, kills: 0 };
      g.showMessage('РЕЖИМ ЛИНЧЕВАТЕЛЯ\nУничтожай преступников', 2.5);
    } else if (type === 'ambulance') {
      const p = g.city.randomSidewalkPoint();
      this.sideJob = { type, pos: p, timeLeft: 65, progress: 0, saved: 0 };
      g.showMessage('СКОРАЯ ПОМОЩЬ\nЗабери пострадавшего', 2.5);
    } else {
      const p = g.city.randomRoadPoint();
      this.sideJob = { type: 'courier', pos: p, timeLeft: 55, progress: 0 };
      g.showMessage('КУРЬЕР\nУспей к точке', 2.5);
    }
    if (this.sideJob.pos) {
      this.targetMarker.position.set(this.sideJob.pos.x, 0, this.sideJob.pos.z);
      this.targetMarker.visible = true;
    }
  }

  endSideJob(reason) {
    const j = this.sideJob;
    if (!j) return;
    this.sideJob = null;
    if (!this.active) this.targetMarker.visible = false;
    this.game.showMessage(`ПОДРАБОТКА ОКОНЧЕНА\n${reason}`, 2.5);
  }

  updateSideJob(dt) {
    const g = this.game, j = this.sideJob;
    if (!j) return;
    j.timeLeft -= dt;
    if (j.timeLeft <= 0) { this.endSideJob(`Заработано: $${j.progress}`); return; }

    const arrive = (r = 6) => Math.hypot(g.playerX() - j.pos.x, g.playerZ() - j.pos.z) < r;

    if (j.type === 'taxi') {
      if (!g.player.inVehicle || !arrive()) return;
      if (j.stage === 'pickup') {
        j.stage = 'dropoff';
        j.pos = g.city.randomRoadPoint();
        j.timeLeft = 60;
        g.showMessage('ПАССАЖИР В МАШИНЕ\nВези к точке', 2);
      } else {
        const fare = randInt(150, 400);
        g.addMoney(fare); j.progress += fare; j.fares++;
        j.stage = 'pickup';
        j.pos = g.city.randomSidewalkPoint();
        j.timeLeft = 70;
        g.showMessage(`ОПЛАТА +$${fare}\nПоездок: ${j.fares}`, 2);
        g.audio.beep(1000, 0.14, 0.25);
      }
      this.targetMarker.position.set(j.pos.x, 0, j.pos.z);
    } else if (j.type === 'ambulance') {
      if (!g.player.inVehicle || !arrive()) return;
      const pay = randInt(180, 380);
      g.addMoney(pay); j.progress += pay; j.saved++;
      g.player.health = Math.min(100, g.player.health + 12);
      j.pos = g.city.randomSidewalkPoint();
      j.timeLeft = Math.min(75, j.timeLeft + 28);
      this.targetMarker.position.set(j.pos.x, 0, j.pos.z);
      g.showMessage(`ПАЦИЕНТ ДОСТАВЛЕН +$${pay}\nСпасено: ${j.saved}`, 2);
      g.audio.beep(1000, 0.14, 0.25);
    } else if (j.type === 'courier') {
      if (!arrive()) return;
      const pay = randInt(200, 450);
      g.addMoney(pay); j.progress += pay;
      j.pos = g.city.randomRoadPoint();
      j.timeLeft = Math.min(60, j.timeLeft + 30);
      this.targetMarker.position.set(j.pos.x, 0, j.pos.z);
      g.showMessage(`ПОСЫЛКА ДОСТАВЛЕНА +$${pay}`, 2);
      g.audio.beep(1000, 0.14, 0.25);
    }
  }

  // ------------------------------------------------------------ update
  update(dt) {
    const g = this.game;
    this.marker.rotation.y = g.time * 1.1;
    this.targetMarker.rotation.y = -g.time * 1.1;

    this.updateSideJob(dt);

    if (!this.active && this.markerPos) {
      if (Math.hypot(g.playerX() - this.markerPos.x, g.playerZ() - this.markerPos.z) < 5) {
        const def = this.storyMission;
        if (def) this.start(def);
      }
    }

    const m = this.active;
    if (!m) return;
    m.timeLeft -= dt;
    if (m.timeLeft <= 0 && m.type !== 'survive') { this.fail('Время вышло'); return; }

    switch (m.type) {
      case 'deliver':
        if (g.player.inVehicle && Math.hypot(g.playerX() - m.dest.x, g.playerZ() - m.dest.z) < 6) this.complete();
        break;

      case 'steal_specific':
        if (m.car.destroyed) { this.fail('Машина уничтожена'); return; }
        this.targetMarker.position.set(m.dest.x, 0, m.dest.z);
        if (g.player.inVehicle === m.car && Math.hypot(m.car.x - m.dest.x, m.car.z - m.dest.z) < 6) {
          if (m.car.health < (m.def.minHealth || 0)) this.fail('Машина слишком побита');
          else this.complete();
        }
        break;

      case 'collect': {
        const next = m.points.find((p) => !p.done);
        if (!next) { this.complete(); break; }
        m.dest = next;
        this.targetMarker.position.set(next.x, 0, next.z);
        if (Math.hypot(g.playerX() - next.x, g.playerZ() - next.z) < 5) {
          next.done = true;
          m.progress++;
          const cash = randInt(300, 700);
          g.addMoney(cash);
          g.showMessage(`ДАНЬ СОБРАНА ${m.progress}/${m.need}  +$${cash}`, 2);
          g.audio.beep(1000, 0.12, 0.25);
          // ambush after each pickup
          for (let i = 0; i < 2; i++) {
            const ped = g.spawnPed(false, true);
            if (!ped) continue;
            ped.armed = true; ped.hostile = true;
            ped.x = g.playerX() + rand(-20, 20);
            ped.z = g.playerZ() + rand(-20, 20);
            ped.syncMesh();
          }
        }
        break;
      }

      case 'hitlist':
      case 'turf':
        if (m.progress >= m.need) this.complete();
        break;

      case 'spree':
        if (m.progress >= m.need) this.complete();
        break;

      case 'speed_bomb':
        if (m.car.destroyed) { this.fail('Машина уничтожена'); return; }
        this.targetMarker.position.set(m.dest.x, 0, m.dest.z);
        if (m.armed) {
          if (g.player.inVehicle !== m.car) {
            g.explode(m.car.x, m.car.z, 1.5);
            this.fail('Ты покинул машину');
            return;
          }
          if (Math.abs(m.car.speed) < m.def.minSpeed) {
            g.explode(m.car.x, m.car.z, 1.8);
            this.fail('Скорость упала — взрыв');
            return;
          }
          if (Math.hypot(m.car.x - m.dest.x, m.car.z - m.dest.z) < 7) this.complete();
        }
        break;

      case 'escort': {
        if (m.car.destroyed) { this.fail('Машину босса уничтожили'); return; }
        this.targetMarker.position.set(m.car.x, 0, m.car.z);
        // hunters chase the VIP
        for (const h of m.cars) {
          if (h.destroyed) continue;
          const dx = m.car.x - h.x, dz = m.car.z - h.z;
          const d = Math.hypot(dx, dz);
          if (d > 1) {
            const desired = Math.atan2(dx, dz);
            let diff = ((desired - h.heading + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            h.drive(dt, 1, clamp(-diff * 1.8, -1, 1), false);
          }
          if (d < 4) { m.car.health -= 22 * dt; }
        }
        if (Math.hypot(m.car.x - m.dest.x, m.car.z - m.dest.z) < 8) this.complete();
        break;
      }

      case 'heist':
        this.targetMarker.position.set(m.dest.x, 0, m.dest.z);
        if (Math.hypot(g.playerX() - m.dest.x, g.playerZ() - m.dest.z) < 7) {
          if (g.wanted < 1) this.complete();
          else g.showMessage("СБРОСЬ РОЗЫСК!\nЕзжай в Pay'n'Spray", 1.2);
        }
        break;

      case 'convoy':
        if (m.progress >= m.need) this.complete();
        else {
          const alive = m.cars.find((c) => !c.destroyed);
          if (alive) this.targetMarker.position.set(alive.x, 0, alive.z);
        }
        break;

      case 'survive':
        if (m.timeLeft <= 0) {
          if (g.wanted <= 0) this.complete();
          else { m.timeLeft = 0.001; g.showMessage('ОТОРВИСЬ ОТ КОПОВ!', 1.2); }
          if (g.wanted <= 0) return;
        }
        break;

      case 'boss': {
        if (m.boss && !m.boss.dead) {
          this.targetMarker.position.set(m.boss.x, 0, m.boss.z);
        }
        if (m.bossDead || (m.boss && m.boss.dead)) {
          if (!m.bossAnnounced) {
            m.bossAnnounced = true;
            g.showMessage('ДОН МЁРТВ!\nУходи от копов', 3);
            m.timeLeft = Math.max(m.timeLeft, 90);
          }
          if (g.wanted <= 0) this.complete();
        }
        break;
      }
    }
  }

  // ------------------------------------------------------------ hud
  hudInfo() {
    const out = [];
    const m = this.active;
    if (m) {
      let extra = '';
      if (['hitlist', 'spree', 'turf', 'convoy', 'collect'].includes(m.type)) extra = ` ${m.progress}/${m.need}`;
      let desc = m.def.brief;
      if (m.type === 'survive') desc = `Продержись и оторвись. Розыск: ${Math.floor(this.game.wanted)}★`;
      if (m.type === 'boss' && m.bossAnnounced) desc = 'Дон мёртв — оторвись от копов';
      out.push({ title: m.title + extra, desc, time: Math.ceil(m.timeLeft), color: '#ffcc33' });
    } else if (this.storyMission) {
      out.push({
        title: ACT_NAMES[this.storyMission.act],
        desc: `К жёлтому маркеру: ${this.storyMission.title}`,
        color: '#ffcc33',
      });
    } else {
      out.push({ title: 'ГОРОД ТВОЙ', desc: 'Кампания пройдена — свободная игра', color: '#33ff77' });
    }
    const j = this.sideJob;
    if (j) {
      const names = { taxi: 'ТАКСИ', vigilante: 'ЛИНЧЕВАТЕЛЬ', courier: 'КУРЬЕР', ambulance: 'СКОРАЯ' };
      out.push({ title: names[j.type], desc: `Заработано: $${j.progress}`, time: Math.ceil(j.timeLeft), color: '#4dc3ff' });
    }
    const R = this.game.progress.rampageActive;
    if (R) {
      out.push({ title: 'БЕСПРЕДЕЛ', desc: `Целей: ${R.count}/${R.need}`, time: Math.ceil(R.timeLeft), color: '#ff4d6d' });
    }
    return out;
  }

  markers() {
    // icon — имя из атласа миникарты (assets/map_icons.png)
    const list = [];
    if (this.markerPos && !this.active) {
      list.push({ x: this.markerPos.x, z: this.markerPos.z, color: '#ffcc33', icon: 'mission' });
    }
    const m = this.active;
    if (m) {
      if (m.dest) list.push({ x: m.dest.x, z: m.dest.z, color: '#33ff77', icon: 'flag' });
      if (m.car) list.push({ x: m.car.x, z: m.car.z, color: '#ff3b3b', icon: 'cartarget' });
      for (const c of m.cars || []) if (!c.destroyed) list.push({ x: c.x, z: c.z, color: '#ff3b3b', icon: 'cartarget' });
      for (const t of m.targets || []) if (!t.dead) list.push({ x: t.x, z: t.z, color: '#ff3b3b', icon: 'enemy' });
      if (m.boss && !m.boss.dead) list.push({ x: m.boss.x, z: m.boss.z, color: '#ff00aa', icon: 'boss' });
    }
    if (this.sideJob && this.sideJob.pos) {
      list.push({ x: this.sideJob.pos.x, z: this.sideJob.pos.z, color: '#4dc3ff', icon: 'cash' });
    }
    return list;
  }

  serialize() {
    return { storyIndex: this.storyIndex, completed: this.completed, finished: this.finished };
  }

  deserialize(d) {
    if (!d) return;
    if (this.active) this.fail('Загрузка');
    this.storyIndex = d.storyIndex || 0;
    this.completed = d.completed || [];
    this.finished = !!d.finished;
    this.placeStoryMarker();
  }
}
