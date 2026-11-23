import { CITY, LOCATION_TYPES } from './city.js';
import { WEAPONS, WEAPON_ORDER } from './weapons.js';
import { PACKAGE_TOTAL, PROPERTIES, TURF_DISTRICTS } from './progress.js';
import { STORY, ACT_NAMES } from './missions.js';
import { clamp } from './physics.js';

export class HUD {
  constructor(root) {
    this.root = root;
    this.shakeAmount = 0;
    this.damageFlash = 0;
    this.mapZoom = 135;

    // атлас иконок миникарты 4x4 по 64px
    this.icons = new Image();
    this.iconsReady = false;
    this.icons.onload = () => { this.iconsReady = true; };
    this.icons.src = 'assets/map_icons.png';
    // Атлас 5x4 по 64px. ВАЖНО: при смене сетки править и ICON_COLS ниже.
    this.ICON_COLS = 5;
    this.ICON = {
      mission: 0, boss: 1, package: 2, property: 3, rampage: 4,
      police: 5, heli: 6, hospital: 7, ammu: 8, spray: 9,
      job: 10, cartarget: 11, enemy: 12, cash: 13, flag: 14,
      garage: 15, gang: 16, phone: 17, waypoint: 18, crane: 19,
    };

    root.innerHTML = `
      <div id="hud-damage"></div>
      <div id="hud-vignette"></div>
      <div id="hud-top">
        <div id="hud-clock">08:00</div>
        <div id="hud-money">$0</div>
        <div id="hud-stars"></div>
        <div id="hud-district"></div>
        <div id="hud-progress">
          <div id="prog-pct">0%</div>
          <div id="prog-sub">ПРОЙДЕНО</div>
        </div>
        <div id="hud-cam">3RD</div>
      </div>
      <div id="hud-left">
        <div class="bar-wrap"><div class="bar-label">HP</div><div class="bar"><i id="bar-hp"></i></div></div>
        <div class="bar-wrap" id="armor-wrap"><div class="bar-label">БРОНЯ</div><div class="bar"><i id="bar-armor"></i></div></div>
        <div class="bar-wrap" id="car-hp-wrap"><div class="bar-label">ТАЧКА</div><div class="bar"><i id="bar-car"></i></div></div>
      </div>
      <div id="hud-weapon">
        <img id="weap-icon" src="assets/icons/weapon_pistol.png" alt="">
        <div id="weap-text">
          <div id="weap-name">ПИСТОЛЕТ</div>
          <div id="weap-ammo">40</div>
        </div>
      </div>
      <canvas id="minimap" width="220" height="220"></canvas>
      <div id="hud-speed"><span id="speed-val">0</span><small>км/ч</small></div>
      <div id="hud-mission"></div>
      <div id="hud-msg"></div>
      <div id="hud-hint"></div>
      <div id="hud-crosshair">
        <i class="ch t"></i><i class="ch b"></i><i class="ch l"></i><i class="ch r"></i>
        <i class="ch dot"></i>
      </div>
      <div id="tutorial">
        <div id="tut-step"></div>
        <div id="tut-title"></div>
        <div id="tut-text"></div>
        <div id="tut-skip">Пропустить обучение — <b>Backspace</b></div>
      </div>
      <div id="tut-arrow"><span></span><i></i></div>
      <div id="scope"></div>
      <div id="hud-radio"><span id="radio-name">FLASHBACK FM</span></div>
      <div id="credits">
        <div class="credits-inner">
          <h1>S.T.A.</h1>
          <h2>КАМПАНИЯ ЗАВЕРШЕНА</h2>
          <div id="credit-stats"></div>
          <p class="credits-note">Дон мёртв. Улицы принадлежат тебе.<br>
            Город остаётся открытым: подработки, беспредел, недвижимость, 40 пакетов и захват районов.</p>
          <!-- Часть моделей теперь под CC-BY 3.0, и там указание автора —
               обязательное условие лицензии, а не вежливость. Список ниже
               обязан совпадать с разделом атрибуции в
               assets/models/PROVENANCE.md; за этим следит отдельный тест,
               иначе добавленная модель молча оставила бы игру без прав. -->
          <p class="credits-note" style="opacity:.5;font-size:11px">
            3D-модели · poly.pizza<br>
            CC0: Quaternius, Kay Lousberg, Kenney<br>
            CC BY 3.0: jeremy, Jasmine Roberts, Ivan Klus, Zsky</p>
          <button id="credits-btn">ПРОДОЛЖИТЬ В ОТКРЫТОМ МИРЕ</button>
        </div>
      </div>
      <div id="gameover" class="menu-screen">
        <div class="menu-header"><div class="menu-title">ТЫ ПОГИБ</div></div>
        <div class="menu-body"><div style="width:520px"><p id="go-stats" class="go-stats"></p></div></div>
        <div class="menu-legend">
          <span class="menu-legend__status">СМЕРТЬ</span>
          <div class="menu-legend__items">
            <span class="menu-legend__item"><b>R · ENTER</b><span>больница</span></span>
          </div>
        </div>
      </div>
    `;

    const $ = (s) => root.querySelector(s);
    this.el = {
      clock: $('#hud-clock'), money: $('#hud-money'), stars: $('#hud-stars'),
      district: $('#hud-district'), hp: $('#bar-hp'), armor: $('#bar-armor'),
      armorWrap: $('#armor-wrap'), car: $('#bar-car'), carWrap: $('#car-hp-wrap'),
      weapName: $('#weap-name'), weapAmmo: $('#weap-ammo'), weapon: $('#hud-weapon'),
      weapIcon: $('#weap-icon'),
      speed: $('#speed-val'), speedBox: $('#hud-speed'), mission: $('#hud-mission'),
      msg: $('#hud-msg'), hint: $('#hud-hint'), crosshair: $('#hud-crosshair'),
      scope: $('#scope'), gameover: $('#gameover'), goStats: $('#go-stats'),
      dmg: $('#hud-damage'), vignette: $('#hud-vignette'),
      radio: $('#hud-radio'), radioName: $('#radio-name'),
      progress: $('#hud-progress'), progPct: $('#prog-pct'), progSub: $('#prog-sub'),
      credits: $('#credits'), creditStats: $('#credit-stats'), creditsBtn: $('#credits-btn'),
      cam: $('#hud-cam'),
      chT: root.querySelector('.ch.t'), chB: root.querySelector('.ch.b'),
      chL: root.querySelector('.ch.l'), chR: root.querySelector('.ch.r'),
      tut: $('#tutorial'), tutStep: $('#tut-step'), tutTitle: $('#tut-title'),
      tutText: $('#tut-text'), tutArrow: $('#tut-arrow'),
      tutArrowLabel: root.querySelector('#tut-arrow span'),
    };
    this.map = $('#minimap');
    this.mctx = this.map.getContext('2d');
    this._lastStars = -1;
    this._lastWeapon = '';
  }

  shake(a) { this.shakeAmount = Math.max(this.shakeAmount, a); }
  flashDamage() { this.damageFlash = 1; }

  showGameOver(game) {
    this.el.gameover.style.display = 'flex';
    const s = game.stats;
    const money = Math.round(game.money).toLocaleString('ru-RU').replace(/ /g, ' ');
    this.el.goStats.innerHTML =
      `Деньги: <b class="money">$${money}</b> · Миссий: <b>${s.missions}</b> · ` +
      `Убийств: <b>${game.kills}</b><br>Разбито машин: <b>${s.carsWrecked}</b> · ` +
      `Прыжков: <b>${s.jumps}</b> · Пройдено: <b>${(s.distance / 1000).toFixed(2)} км</b>`;
  }
  hideGameOver() { this.el.gameover.style.display = 'none'; }

  showCredits(game) {
    const p = game.progress;
    this.el.credits.style.display = 'flex';
    this.el.creditStats.innerHTML = `
      <div><span>Заработано</span><b>$${game.money}</b></div>
      <div><span>Миссий пройдено</span><b>${game.stats.missions} / ${STORY.length}</b></div>
      <div><span>Убийств</span><b>${game.kills}</b></div>
      <div><span>Разбито машин</span><b>${game.stats.carsWrecked}</b></div>
      <div><span>Пакетов найдено</span><b>${p.packagesFound} / ${PACKAGE_TOTAL}</b></div>
      <div><span>Недвижимость</span><b>${p.owned.length} / ${PROPERTIES.length}</b></div>
      <div><span>Районов под контролем</span><b>${p.turfOwned} / ${TURF_DISTRICTS.length}</b></div>
      <div><span>Пройдено километров</span><b>${(game.stats.distance / 1000).toFixed(1)}</b></div>
      <div class="total"><span>ОБЩЕЕ ПРОХОЖДЕНИЕ</span><b>${game.completionPercent()}%</b></div>`;
  }
  hideCredits() { this.el.credits.style.display = 'none'; }

  update(game, dt) {
    this.t = (this.t || 0) + dt;               // часы для пульсации иконок
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.6);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.4);
    this.el.dmg.style.opacity = this.damageFlash * 0.55;

    const lowHp = game.player.health < 30 && !game.gameOver;
    this.el.vignette.style.opacity = lowHp ? 0.35 + Math.sin(game.time * 6) * 0.12 : 0;

    // clock
    const h = Math.floor(game.clockTime / 3600);
    const mnt = Math.floor((game.clockTime % 3600) / 60);
    this.el.clock.textContent = `${String(h).padStart(2, '0')}:${String(mnt).padStart(2, '0')}`;

    // Разделитель разрядов — так же на экране паузы (pausemenu.js), одно число
    // на двух экранах не должно выглядеть по-разному.
    this.el.money.textContent = '$' + Math.round(game.money).toLocaleString('ru-RU').replace(/ /g, ' ');

    const hp = clamp(game.player.health, 0, 100);
    this.el.hp.style.width = hp + '%';
    this.el.hp.style.background = hp > 50 ? '#4ade80' : hp > 22 ? '#fbbf24' : '#ef4444';

    if (game.armor > 0) {
      this.el.armorWrap.style.display = 'flex';
      this.el.armor.style.width = clamp(game.armor, 0, 100) + '%';
    } else this.el.armorWrap.style.display = 'none';

    const v = game.player.inVehicle;
    if (v) {
      this.el.carWrap.style.display = 'flex';
      const ch = clamp((v.health / v.maxHealth) * 100, 0, 100);
      this.el.car.style.width = ch + '%';
      this.el.car.style.background = v.destroyed ? '#ff5522' : ch > 50 ? '#60a5fa' : ch > 22 ? '#fbbf24' : '#ef4444';
      this.el.speedBox.style.display = 'block';
      this.el.speed.textContent = Math.round(Math.abs(v.speed) * 3.6 * 1.35);
      this.el.weapon.style.display = 'none';
      this.el.crosshair.style.display = 'none';
      this.el.scope.style.display = 'none';
    } else {
      this.el.carWrap.style.display = 'none';
      this.el.speedBox.style.display = 'none';
      this.el.weapon.style.display = 'block';
      const w = WEAPONS[game.weapon];
      this.el.weapName.textContent = w.name;
      this.el.weapAmmo.textContent = w.infinite ? '∞' : `${game.weaponState.loaded(game.weapon)} / ${game.weaponState.reserve(game.weapon)}`;
      if (game.weaponState.reload) this.el.weapName.textContent = `${w.name} · ПЕРЕЗАРЯДКА ${Math.round(game.weaponState.progress * 100)}%`;
      if (this._lastWeapon !== game.weapon) {
        this._lastWeapon = game.weapon;
        this.el.weapIcon.src = `assets/icons/weapon_${game.weapon}.${['ak47', 'm4a1'].includes(game.weapon) ? 'svg' : 'png'}`;
      }
      const aiming = game.aimingDownSights;
      const fp = game.cam.isFirstPerson;
      const scoped = aiming && w.scope;
      this.el.crosshair.style.display = !w.melee && !game.weaponState.reload && !scoped ? 'block' : 'none';
      this.el.scope.style.display = scoped ? 'block' : 'none';

      // crosshair opens up with movement, recoil and hip fire
      const base = w.melee ? 4 : 6;
      const spreadPx = base
        + (w.spread || 0) * (aiming ? 300 : 900)
        + Math.min(14, game.player.speed * 1.8)
        + game.cam.recoilPitch * 260
        - (game.player.crouch > 0.5 ? 3 : 0);
      const sp = Math.max(3, spreadPx);
      this.el.chT.style.transform = `translate(-50%, ${-sp}px)`;
      this.el.chB.style.transform = `translate(-50%, ${sp}px)`;
      this.el.chL.style.transform = `translate(${-sp}px, -50%)`;
      this.el.chR.style.transform = `translate(${sp}px, -50%)`;
    }

    // Индикатор вида камеры. Постоянная плашка в углу — шум: режим важен
    // только в момент переключения, поэтому показываем и гасим.
    const camNames = { third: '3RD', first: '1ST', far: 'FAR', cine: 'CINE', cinematic: 'CINE' };
    const camName = camNames[game.cam.mode] || '3RD';
    if (camName !== this._camName) {
      this._camName = camName;
      this.el.cam.textContent = camName;
      this._camT = 1.8;
    }
    if (this._camT > 0) {
      this._camT -= dt;
      this.el.cam.style.opacity = Math.min(1, this._camT * 2.5);
    }

    // radio
    if (game.radio && game.player.inVehicle && game.radio.station.bpm) {
      this.el.radio.style.display = 'block';
      this.el.radioName.textContent = game.radio.station.name;
      this.el.radioName.style.color = game.radio.station.color;
    } else this.el.radio.style.display = 'none';

    // completion %
    const pct = game.completionPercent();
    this.el.progPct.textContent = pct + '%';
    this.el.progPct.style.color = pct >= 100 ? '#7CFC8A' : '#ffcc33';

    // Звёзды розыска. При нулевом розыске ряд пустых звёзд — постоянный шум
    // в углу: он ничего не сообщает, но занимает место и тянет взгляд.
    // Показываем шкалу только когда розыск реально есть.
    const lvl = Math.floor(game.wanted);
    if (lvl !== this._lastStars) {
      this._lastStars = lvl;
      if (lvl <= 0) {
        this.el.stars.innerHTML = '';
        this.el.stars.style.display = 'none';
      } else {
        let s = '';
        for (let i = 0; i < 6; i++) s += `<span class="${i < lvl ? 'star on' : 'star'}">★</span>`;
        this.el.stars.innerHTML = s;
        this.el.stars.style.display = 'block';
      }
    }

    // district
    const d = game.city.districtAtWorld(game.playerX(), game.playerZ());
    const names = { downtown: 'ЦЕНТР', commercial: 'ДЕЛОВОЙ КВАРТАЛ', industrial: 'ПРОМЗОНА', suburb: 'ОКРАИНА', docks: 'ПОРТ' };
    this.el.district.textContent = names[d] || '';

    // missions
    const infos = game.missions.hudInfo();
    this.el.mission.innerHTML = infos.map((i) =>
      `<div class="mrow" style="border-color:${i.color}"><b style="color:${i.color}">${i.title}</b>` +
      `<span>${i.desc}</span>${i.time !== undefined ? `<i>${Math.max(0, i.time)} сек</i>` : ''}</div>`
    ).join('');

    // contextual hint
    let hint = '';
    const px = game.playerX(), pz = game.playerZ();
    for (const loc of game.city.locations) {
      if (Math.hypot(loc.x - px, loc.z - pz) < loc.radius + 3) {
        if (loc.type === 'spray') hint = game.player.inVehicle ? "PAY'N'SPRAY — ремонт и сброс розыска ($100)" : "Заезжай сюда на машине";
        else if (loc.type === 'ammu') {
          const menu = ['pistol', 'uzi', 'shotgun', 'rifle', 'rocket', 'ak47', 'm4a1', 'armor'];
          const price = { pistol: 100, uzi: 400, shotgun: 600, rifle: 900, rocket: 2000, ak47: 1100, m4a1: 1250, armor: 300 };
          const item = menu[(game.shopIndex || 0) % menu.length];
          const label = item === 'armor' ? 'БРОНЯ' : WEAPONS[item].name;
          hint = `GUN SHOP — [N] выбрать: ${label} ($${price[item]}) · [B] купить`;
        } else if (loc.type === 'hospital') hint = 'БОЛЬНИЦА — лечение $50';
        break;
      }
    }
    const prop = game.progress.nearProperty();
    if (!hint && prop) hint = `${prop.name} — $${prop.price} · [B] купить · ${prop.perk}`;
    if (!hint && !game.player.inVehicle && !game.missions.sideJob) {
      hint = 'Нажми [J] — подработка · [G] сменить тип';
    }
    if (!hint && game.player.inVehicle) hint = '[R] следующая радиостанция';
    // Подсказки можно выключить в настройках — тогда строка не занимает низ экрана.
    const showHint = hint && this.showHints !== false;
    this.el.hint.textContent = showHint ? hint : '';
    this.el.hint.style.display = showHint ? 'block' : 'none';

    if (game.msgT > 0) {
      this.el.msg.style.display = 'block';
      this.el.msg.style.opacity = Math.min(1, game.msgT * 2);
      const tone = game.msgTone || 'neutral';
      const br = (s) => s.replace(/\n/g, '<br>');
      const eyebrow = game.msgEyebrow ? `<div class="msg-eyebrow">${br(game.msgEyebrow)}</div>` : '';
      // Знак +/- в начале подзаголовка — это сумма (награда, штраф): моноширинным,
      // как остальные деньги в интерфейсе.
      const numeric = /^[+-]/.test(game.msgSub || '');
      const sub = game.msgSub
        ? `<div class="msg-sub tone-${tone}${numeric ? ' numeric' : ''}">${br(game.msgSub)}</div>` : '';
      this.el.msg.innerHTML = `${eyebrow}<div class="msg-title tone-${tone}">${br(game.msg)}</div>${sub}`;
    } else this.el.msg.style.display = 'none';

    this.updateTutorial(game);
    this.drawMinimap(game);
  }

  updateTutorial(game) {
    const t = game.tutorial;
    const step = t && t.step;
    if (!step) {
      this.el.tut.style.display = 'none';
      this.el.tutArrow.style.display = 'none';
      return;
    }
    this.el.tut.style.display = 'block';
    this.el.tut.style.transform = `translateX(-50%) scale(${1 + t.justAdvanced * 0.06})`;
    this.el.tutStep.textContent = 'ОБУЧЕНИЕ ' + t.progressText();
    this.el.tutTitle.textContent = step.title;
    this.el.tutText.innerHTML = step.text;

    // on-screen arrow pointing at the objective
    const target = t.hintTarget();
    if (!target) { this.el.tutArrow.style.display = 'none'; return; }
    const px = game.playerX(), pz = game.playerZ();
    const dist = Math.hypot(target.x - px, target.z - pz);
    const ang = Math.atan2(target.x - px, target.z - pz) - game.cam.yaw;
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.3;
    const sx = window.innerWidth / 2 + Math.sin(ang) * R;
    const sy = window.innerHeight / 2 - Math.cos(ang) * R * 0.55;
    this.el.tutArrow.style.display = 'block';
    this.el.tutArrow.style.left = sx + 'px';
    this.el.tutArrow.style.top = sy + 'px';
    this.el.tutArrow.style.transform = `translate(-50%,-50%) rotate(${ang}rad)`;
    this.el.tutArrowLabel.textContent = `${target.label} ${Math.round(dist)}м`;
    this.el.tutArrowLabel.style.transform = `rotate(${-ang}rad)`;
  }

  drawMinimap(game) {
    if (this.t === undefined) this.t = 0;
    const c = this.mctx;
    const S = 220, R = 104;
    const range = this.mapZoom;
    const px = game.playerX(), pz = game.playerZ();
    const rot = game.camYaw + Math.PI;

    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    c.clip();

    const night = game.nightFactor || 0;
    c.fillStyle = night > 0.5 ? '#141c18' : '#25301f';
    c.fillRect(0, 0, S, S);

    c.translate(S / 2, S / 2);
    c.rotate(rot);
    const sc = R / range;

    // district tint
    for (const b of game.city.blockRects || []) {
      const dx = (b.cx - px) * sc, dz = (b.cz - pz) * sc;
      if (Math.abs(dx) > R + 30 || Math.abs(dz) > R + 30) continue;
      const colors = { downtown: '#3b4250', commercial: '#4a4436', industrial: '#3e3a33', suburb: '#3a4634', docks: '#2f3f46' };
      c.fillStyle = colors[b.district] || '#3a3a3a';
      c.fillRect(dx - (b.x1 - b.x0) * sc / 2, dz - (b.z1 - b.z0) * sc / 2,
        (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    }

    // roads
    c.strokeStyle = night > 0.5 ? '#3c3c46' : '#55555f';
    c.lineWidth = CITY.ROAD_W * sc;
    c.beginPath();
    for (let i = 0; i < CITY.N; i++) {
      const p = i * CITY.SPACING - CITY.HALF;
      c.moveTo((p - px) * sc, (-CITY.HALF - pz) * sc);
      c.lineTo((p - px) * sc, (CITY.HALF - pz) * sc);
      c.moveTo((-CITY.HALF - px) * sc, (p - pz) * sc);
      c.lineTo((CITY.HALF - px) * sc, (p - pz) * sc);
    }
    c.stroke();

    const dot = (x, z, color, size = 3, square = false) => {
      const dx = (x - px) * sc, dz = (z - pz) * sc;
      const dd = Math.hypot(dx, dz);
      c.fillStyle = color;
      if (dd > R - 4) {
        const a = Math.atan2(dz, dx);
        c.beginPath();
        c.arc(Math.cos(a) * (R - 6), Math.sin(a) * (R - 6), size * 0.85, 0, Math.PI * 2);
        c.fill();
        return;
      }
      if (square) c.fillRect(dx - size, dz - size, size * 2, size * 2);
      else { c.beginPath(); c.arc(dx, dz, size, 0, Math.PI * 2); c.fill(); }
    };

    // Иконка из атласа. Карта повёрнута на rot, поэтому саму иконку
    // контр-вращаем — она всегда стоит «головой вверх», как в GTA.
    const icon = (x, z, name, size = 14, opts = {}) => {
      if (!this.iconsReady) { dot(x, z, opts.fallback || '#fff', size * 0.28); return; }
      const idx = this.ICON[name];
      if (idx === undefined) return;
      let dx = (x - px) * sc, dz = (z - pz) * sc;
      const dd = Math.hypot(dx, dz);
      let edge = false;
      if (dd > R - 10) {                       // прижимаем к краю круга
        const a = Math.atan2(dz, dx);
        dx = Math.cos(a) * (R - 12); dz = Math.sin(a) * (R - 12);
        edge = true;
      }
      const s2 = (edge ? size * 0.8 : size) * (opts.scale || 1);
      c.save();
      c.translate(dx, dz);
      c.rotate(-rot);                          // держим иконку вертикально
      if (opts.pulse) {
        const k = 1 + Math.sin(this.t * 5) * 0.12;
        c.scale(k, k);
      }
      if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
      const cols = this.ICON_COLS;
      c.drawImage(this.icons, (idx % cols) * 64, Math.floor(idx / cols) * 64, 64, 64,
        -s2 / 2, -s2 / 2, s2, s2);
      c.restore();
    };

    // locations
    const mf = game.mapFilters;
    for (const loc of game.city.locations) {
      // сервисные точки — иконками из атласа
      const iconByType = { spray: 'spray', ammu: 'ammu', hospital: 'hospital', police: 'police' };
      const nm = iconByType[loc.type];
      if (nm) { if (mf.service) icon(loc.x, loc.z, nm, 15); }
      else dot(loc.x, loc.z, '#' + loc.color.toString(16).padStart(6, '0'), 4, true);
    }
    // pickups
    for (const p of game.pickups) dot(p.x, p.z, '#ffe08a', 2);
    // hidden packages (only nearby, keeps the hunt fun)
    if (mf.packages) for (const pk of game.progress.packages) {
      if (pk.taken) continue;
      if (Math.hypot(pk.x - px, pk.z - pz) < 70) icon(pk.x, pk.z, 'package', 13);
    }
    // property boards
    if (mf.property) for (const pm of game.progress.propertyMarkers) {
      const owned = game.progress.owned.includes(pm.def.id);
      icon(pm.x, pm.z, 'property', 15, { alpha: owned ? 1 : 0.75 });
    }
    // rampage icons
    if (mf.rampage) for (const r of game.progress.rampageSpots) if (!r.done) icon(r.x, r.z, 'rampage', 14);
    // helicopters
    if (mf.heli) for (const h of game.helicopters) if (!h.dead) icon(h.x, h.z, 'heli', 15);
    // vehicles
    for (const v of game.vehicles) {
      if (v === game.player.inVehicle) continue;
      if (v.isMissionTarget) { if (mf.missions) icon(v.x, v.z, 'cartarget', 15, { pulse: true }); }
      else if (v.isPolice) dot(v.x, v.z, '#4d7fff', 2.8);
      else dot(v.x, v.z, night > 0.5 ? '#7a808a' : '#9aa0a8', 1.9);
    }
    for (const cop of game.copsOnFoot) if (!cop.c.dead) dot(cop.c.x, cop.c.z, '#4d7fff', 2.2);
    if (mf.gangs) for (const p of game.peds) if (p.hostile && !p.dead) icon(p.x, p.z, 'gang', 12);
    // брошенная машина игрока — чтобы не терять её в городе
    const lc = game.lastCar;
    if (mf.garage && lc && !lc.destroyed && lc !== game.player.inVehicle) {
      icon(lc.x, lc.z, 'garage', 13, { alpha: 0.8 });
    }
    if (mf.missions) {
      // подработка активна — цель отмечена рулём
      const sj = game.missions.sideJob;
      if (sj && sj.dest) icon(sj.dest.x, sj.dest.z, 'job', 16, { pulse: true });
      // mission markers
      for (const m of game.missions.markers()) {
        icon(m.x, m.z, m.icon || 'mission', 17, { pulse: true });
      }
    }

    c.restore();

    // player arrow
    c.save();
    c.translate(S / 2, S / 2);
    const heading = game.player.inVehicle ? game.player.inVehicle.heading : game.player.heading;
    c.rotate(rot - heading + Math.PI);
    c.fillStyle = '#ffffff';
    c.strokeStyle = '#000'; c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, -8); c.lineTo(5.5, 6.5); c.lineTo(0, 3.5); c.lineTo(-5.5, 6.5);
    c.closePath(); c.fill(); c.stroke();
    c.restore();

    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(S / 2, S / 2, R, 0, Math.PI * 2);
    c.stroke();
  }
}
