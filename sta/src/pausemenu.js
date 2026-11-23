// Меню паузы: полноэкранный оверлей с шестью разделами. Портировано из
// design/out/ui_kits/menu/*.jsx (React) в чистый DOM — движок игры на
// vanilla JS без сборщика, React сюда не тащим.
//
// Разделы «Управление» и «Настройки» — рабочие, правят состояние игры сразу.
// «Карта», «Миссии», «Статистика», «Сохранения» — только реальные данные,
// без выдуманных счётчиков; «Сохранения» умеет писать/читать/удалять слоты.
import { STORY, ACT_NAMES } from './missions.js';
import { PACKAGE_TOTAL, PACKAGE_REWARDS, PROPERTIES, TURF_DISTRICTS } from './progress.js';
import { DISTRICTS } from './city.js';
import { SETTINGS, SETTING_GROUPS, BINDABLE, keyLabel } from './settings.js';

const fmtMoney = (v) => '$' + Math.round(v).toLocaleString('ru-RU').replace(/ /g, ' ');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TABS = [
  { id: 'map', label: 'Карта' },
  { id: 'missions', label: 'Миссии' },
  { id: 'stats', label: 'Статистика' },
  { id: 'saves', label: 'Сохранения' },
  { id: 'controls', label: 'Управление' },
  { id: 'settings', label: 'Настройки' },
];

// Слот управления клавиатурой соответствует хоткею на экране, а не наоборот —
// подсказки в футере обязаны быть правдой, поэтому список короткий: то,
// что реально нажимается мышью/тапом, плюс единственная рабочая клавиша здесь — Esc.
const LEGEND = {
  map: [{ keys: 'КЛИК', action: 'выбор раздела' }],
  missions: [{ keys: 'КЛИК', action: 'выбор акта' }],
  stats: [{ keys: 'КЛИК', action: 'счётчики / прохождение' }],
  saves: [{ keys: 'КЛИК', action: 'слот' }, { keys: 'F5', action: 'сохранить' }, { keys: 'F9', action: 'загрузить' }],
  controls: [{ keys: 'КЛИК', action: 'переназначить' }, { keys: 'ЛЮБАЯ КЛАВИША', action: 'назначить во время записи' }],
  settings: [{ keys: 'КЛИК', action: 'переключить / изменить' }],
};

export class PauseMenu {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.tab = 'missions';
    this.subSel = { map: 'districts', missions: null, stats: 'counters', controls: 'move', settings: SETTING_GROUPS[0].id };
    this.capturing = null;    // { action } — ждём нажатия клавиши для ребайнда
    this.conflict = null;     // { code, action, ownerAction } — клавиша занята
    // «Автономный» режим — то же меню открыто с титульного экрана (пункты
    // УПРАВЛЕНИЕ/НАСТРОЙКИ), до старта партии. Игра к этому моменту уже
    // сгенерирована (см. boot() в main.js), так что данные во всех вкладках
    // настоящие — просто закрывается не в геймплей, а обратно на титул,
    // и фон непрозрачный: замороженного кадра ещё нет, рендер не запускался.
    this.standalone = false;
    this.onStandaloneClose = null;
    root.className = 'menu-screen';
    root.addEventListener('click', (e) => this._onClick(e));
    this._onKeydownCapture = this._onKeydownCapture.bind(this);
    this._onStandaloneKey = this._onStandaloneKey.bind(this);
  }

  open(tab, opts = {}) {
    this.standalone = !!opts.standalone;
    this.onStandaloneClose = opts.onClose || null;
    this.root.classList.toggle('menu-screen--solid', this.standalone);
    if (tab) this.tab = tab;
    if (this.standalone) window.addEventListener('keydown', this._onStandaloneKey, true);
    this.root.classList.add('menu-screen--open');
    this.render();
  }

  close() {
    this.root.classList.remove('menu-screen--open');
    this.root.classList.remove('menu-screen--solid');
    this._stopCapture();
    this.conflict = null;
    if (this.standalone) window.removeEventListener('keydown', this._onStandaloneKey, true);
    this.standalone = false;
  }

  _onStandaloneKey(e) {
    if (e.code !== 'Escape') return;
    e.preventDefault(); e.stopPropagation();
    const cb = this.onStandaloneClose;
    this.close();
    if (cb) cb();
  }

  // ------------------------------------------------------------- рендер
  render() {
    const g = this.game;
    const status = this.standalone ? 'ТИТУЛЬНЫЙ ЭКРАН' : 'ПАУЗА';
    this.root.innerHTML =
      `<div class="menu-header">
        <div class="menu-eyebrow">${esc(status)}</div>
        <div class="menu-title">S.T.A.</div>
      </div>
      <div class="menu-tabbar" role="tablist">
        ${TABS.map((t) => `<button class="menu-tab" role="tab" aria-selected="${t.id === this.tab}"
          data-action="tab" data-tab="${t.id}">${esc(t.label)}</button>`).join('')}
      </div>
      <div class="menu-body">${this._renderTab(g)}</div>
      ${this._renderLegend(status)}`;
  }

  _renderLegend(status) {
    // ESC — единственная клавиша, реально работающая на этом экране
    // (input.actHit('pause') в main.js, либо собственный слушатель в
    // автономном режиме), добавляется ко всем разделам сразу, чтобы
    // не дублировать в каждом списке LEGEND.
    const items = [...(LEGEND[this.tab] || []), { keys: 'ESC', action: this.standalone ? 'назад' : 'вернуться в игру' }];
    return `<div class="menu-legend">
      <span class="menu-legend__status">${esc(status)}</span>
      <div class="menu-legend__items">
        ${items.map((it) => `<span class="menu-legend__item"><b>${esc(it.keys)}</b><span>${esc(it.action)}</span></span>`).join('')}
      </div>
    </div>`;
  }

  _renderTab(g) {
    switch (this.tab) {
      case 'map': return this._renderMap(g);
      case 'missions': return this._renderMissions(g);
      case 'stats': return this._renderStats(g);
      case 'saves': return this._renderSaves(g);
      case 'controls': return this._renderControls(g);
      case 'settings': return this._renderSettings(g);
      default: return '';
    }
  }

  // ------------------------------------------------------------- Карта
  _renderMap(g) {
    const snap = g.mapSnapshot();
    const sec = this.subSel.map;
    const subnav = subNavHtml('map', [
      { id: 'districts', label: 'Районы' }, { id: 'property', label: 'Недвижимость' }, { id: 'packages', label: 'Пакеты' },
    ], sec);

    let main = '';
    if (sec === 'districts') {
      main = row('РАЙОН', 'КОНТРОЛЬ', { state: 'header' }) + snap.districts.map((d) =>
        row(d.name, d.control + ' %', { numeric: true, state: d.owned ? 'selected' : d.control === 0 ? 'disabled' : 'default' })).join('');
    } else if (sec === 'property') {
      main = row('ОБЪЕКТ', 'ЦЕНА / СТАТУС', { state: 'header' }) + snap.properties.map((p) =>
        row(p.name, p.owned ? 'КУПЛЕНО' : fmtMoney(p.price), { numeric: !p.owned, state: p.owned ? 'selected' : 'default' })).join('') +
        row('ДОХОД ЗА 30 СЕК', fmtMoney(g.progress.owned.reduce((sum, id) => {
          const def = PROPERTIES.find((x) => x.id === id); return sum + (def ? def.income : 0);
        }, 0) + Math.floor(TURF_DISTRICTS.reduce((s, d) => s + g.progress.turf[d], 0) * 1.2)),
          { numeric: true, moneyColor: true });
    } else if (sec === 'packages') {
      main = row('НАЙДЕНО', `${snap.packagesFound} / ${PACKAGE_TOTAL}`, { numeric: true }) +
        PACKAGE_REWARDS.map((r) => {
          const got = snap.packagesFound >= r.at;
          const left = r.at - snap.packagesFound;
          return row(`${r.at} — ${r.label}`, got ? 'ПОЛУЧЕНО' : `ЕЩЁ ${left}`,
            { numeric: !got, state: got ? 'selected' : 'disabled' });
        }).join('');
    }

    return `${subnav}
      <div class="menu-body__main">${main}</div>
      <div class="menu-body__side">
        <div style="flex:1;border:var(--hairline) solid var(--rule-strong);min-height:200px;display:flex;align-items:flex-end;padding:var(--sp-3)">
          <span style="font-family:var(--font-display);font-size:10px;letter-spacing:var(--tracking-eyebrow);color:var(--text-dim)">ОБЛАСТЬ КАРТЫ · РИСУЕТ CANVAS ИГРЫ</span>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------- Миссии
  _renderMissions(g) {
    const idx = g.missions.storyIndex;
    const acts = [1, 2, 3].map((n) => ({
      id: 'act' + n, label: 'Акт ' + ['I', 'II', 'III'][n - 1],
      missions: STORY.map((m, i) => ({ ...m, i })).filter((m) => m.act === n),
    }));
    const curAct = STORY[Math.min(idx, STORY.length - 1)].act;
    const selId = this.subSel.missions || 'act' + curAct;
    const cur = acts.find((a) => a.id === selId) || acts[0];

    const rows = cur.missions.map((m) => {
      const status = m.i < idx ? 'done' : m.i === idx ? 'current' : 'locked';
      return row(m.title, status === 'locked' ? 'НЕ ОТКРЫТА' : m.giver,
        { state: status === 'current' ? 'selected' : status === 'locked' ? 'disabled' : 'default' });
    }).join('');

    const done = Math.min(idx, STORY.length);
    const note = idx >= STORY.length
      ? 'Кампания пройдена. Город открыт — подработки, беспредел, недвижимость, захват районов.'
      : `Заказчик миссии — правая колонка. Пройдено ${done} из ${STORY.length}.`;

    return `${subNavHtml('missions', acts.map((a) => ({ id: a.id, label: a.label })), selId)}
      <div style="width:500px;flex:0 0 auto">
        <div style="font-family:var(--font-display);font-size:var(--fs-eyebrow);letter-spacing:var(--tracking-eyebrow);color:var(--text-muted);height:var(--row-h);line-height:var(--row-h)">${esc(ACT_NAMES[Number(cur.id.slice(3))])}</div>
        ${rows}
        <div class="menu-note">${esc(note)}</div>
      </div>`;
  }

  // -------------------------------------------------------- Статистика
  _renderStats(g) {
    const sec = this.subSel.stats;
    const s = g.stats, p = g.progress;
    let main;
    if (sec === 'counters') {
      const rows2 = [
        ['ЗАРАБОТАНО', fmtMoney(g.money), true],
        ['МИССИЙ ПРОЙДЕНО', `${s.missions} / ${STORY.length}`],
        ['УБИЙСТВ', String(g.kills)],
        ['РАЗБИТО МАШИН', String(s.carsWrecked)],
        ['ПАКЕТОВ НАЙДЕНО', `${p.packagesFound} / ${PACKAGE_TOTAL}`],
        ['НЕДВИЖИМОСТЬ', `${p.owned.length} / ${PROPERTIES.length}`],
        ['РАЙОНОВ ПОД КОНТРОЛЕМ', `${p.turfOwned} / ${TURF_DISTRICTS.length}`],
        ['ПРОЙДЕНО КИЛОМЕТРОВ', (s.distance / 1000).toFixed(1)],
        ['ПРЫЖКОВ', String(s.jumps)],
        ['ЛУЧШЕЕ КОМБО', String(s.bestCombo)],
      ];
      main = rows2.map(([l, v, money]) => row(l, v, { numeric: true, moneyColor: !!money })).join('');
    } else {
      const weights = [
        ['СЮЖЕТ · 12 МИССИЙ', g.missions.storyIndex / STORY.length, 0.42],
        ['ПАКЕТЫ · 40 ШТ', p.packagesFound / PACKAGE_TOTAL, 0.20],
        ['НЕДВИЖИМОСТЬ · 4', p.owned.length / PROPERTIES.length, 0.14],
        ['БЕСПРЕДЕЛ', p.rampagesDone.length / Math.max(1, p.rampageSpots.length), 0.12],
        ['ЗАХВАТ РАЙОНОВ · 5', p.turfOwned / TURF_DISTRICTS.length, 0.12],
      ];
      main = weights.map(([l, frac, w]) => row(l, Math.round(w * 100) + ' %', { numeric: true })).join('') +
        row('ИТОГО', g.completionPercent() + ' %', { numeric: true, state: 'selected' }) +
        `<div class="menu-note">Веса зашиты в completionPercent(). Счётчиков, которых нет в коде, на экране быть не должно.</div>`;
    }
    return `${subNavHtml('stats', [{ id: 'counters', label: 'Счётчики' }, { id: 'completion', label: 'Прохождение' }], sec)}
      <div class="menu-body__main">${main}</div>`;
  }

  // -------------------------------------------------------- Сохранения
  _renderSaves(g) {
    const slots = g.listSaves();
    const sel = this.subSel.saveSlot != null ? this.subSel.saveSlot : g.lastSlot;
    const nav = slots.map((s, i) => ({ id: String(i), label: 'Слот ' + (i + 1) + (s ? '' : ' — пусто') }));
    const slot = slots[sel];

    let main;
    if (!slot) {
      main = row('СЛОТ ' + (sel + 1), 'ПУСТО', { state: 'disabled' }) +
        `<div class="menu-note">Строк параметров нет — заполнять пустой слот нулями нельзя.</div>` +
        actionBtn('save-slot', sel, 'СОХРАНИТЬ СЮДА');
    } else {
      const date = slot.savedAt ? new Date(slot.savedAt) : null;
      const dateStr = date ? `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : 'ДАТА НЕ ЗАПИСАНА';
      const actLabel = slot.act === 0 ? 'КАМПАНИЯ ПРОЙДЕНА' : 'АКТ ' + ['I', 'II', 'III'][slot.act - 1];
      main = row('СОХРАНЕНО', dateStr, { numeric: !!date, state: date ? 'default' : 'disabled' }) +
        row('ПРОГРЕСС', actLabel, { state: slot.act === 0 ? 'selected' : 'default' }) +
        row('СЛЕДУЮЩАЯ МИССИЯ', slot.mission || 'СЮЖЕТ ЗАКОНЧЕН', { state: slot.mission ? 'default' : 'disabled' }) +
        row('ДЕНЬГИ', fmtMoney(slot.money), { numeric: true, moneyColor: true }) +
        row('ПРОХОЖДЕНИЕ', slot.completion == null ? 'НЕ ПОСЧИТАНО' : slot.completion + ' %', { numeric: slot.completion != null, state: slot.completion == null ? 'disabled' : 'default' }) +
        row('ВРЕМЯ В ИГРЕ', fmtPlayTime(slot.playTime), { numeric: true }) +
        row('РАЙОН', slot.district || '—', {}) +
        `<div style="display:flex;gap:var(--sp-5);margin-top:var(--sp-4)">${actionBtn('load-slot', sel, 'ЗАГРУЗИТЬ')}${actionBtn('save-slot', sel, 'ПЕРЕЗАПИСАТЬ')}${actionBtn('delete-slot', sel, 'УДАЛИТЬ')}</div>`;
    }

    return `${subNavHtml('saves', nav, String(sel), 'saveSlot')}
      <div class="menu-body__main">${main}</div>`;
  }

  // -------------------------------------------------------- Управление
  _renderControls(g) {
    const idOfGroup = { 'ПЕРЕДВИЖЕНИЕ': 'move', 'БОЙ': 'fight', 'ГОРОД': 'city', 'СИСТЕМА': 'system' };
    const groupOfId = Object.fromEntries(Object.entries(idOfGroup).map(([k, v]) => [v, k]));
    const sel = this.subSel.controls;
    const rows = BINDABLE.filter((b) => b.group === groupOfId[sel]).map((b) => {
      const keys = g.settings.bindsOf(b.action);
      const listening = this.capturing && this.capturing.action === b.action;
      const unresolved = keys.length === 0;
      const val = listening ? 'НАЖМИТЕ КЛАВИШУ…' : unresolved ? 'НЕ ОПРЕДЕЛЕНО' : keys.map(keyLabel).join(' · ');
      return `<div class="menu-row menu-keybind clickable ${listening ? 'is-listening' : ''} ${unresolved ? 'is-unresolved' : ''}"
          data-action="bind-start" data-bind-action="${b.action}">
        <span class="menu-row__label menu-keybind__label">${esc(b.label)}</span>
        <span class="menu-row__value menu-keybind__value">${esc(val)}</span>
      </div>`;
    }).join('');

    let conflictHtml = '';
    if (this.conflict) {
      const ownerLabel = (BINDABLE.find((b) => b.action === this.conflict.ownerAction) || {}).label || this.conflict.ownerAction;
      conflictHtml = `<div class="menu-conflict">Клавиша ${esc(keyLabel(this.conflict.code))} занята: ${esc(ownerLabel)}.
        <div class="menu-conflict__actions">
          <span class="menu-conflict__take" data-action="conflict-take">Отобрать</span>
          <span class="menu-conflict__keep" data-action="conflict-keep">Оставить как есть</span>
        </div></div>`;
    }

    return `${subNavHtml('controls', Object.entries(idOfGroup).map(([label, id]) => ({ id, label })), sel)}
      <div style="width:500px;flex:0 0 auto">
        ${rows}
        ${conflictHtml}
        <div class="menu-reset" data-action="reset-controls">Сбросить «${esc(groupOfId[sel])}» к раскладке по умолчанию</div>
      </div>`;
  }

  // -------------------------------------------------------- Настройки
  _renderSettings(g) {
    const sel = this.subSel.settings;
    const items = SETTINGS.filter((s) => s.group === sel);
    const rows = items.map((s) => this._renderSetting(g, s)).join('');
    const groupLabel = (SETTING_GROUPS.find((x) => x.id === sel) || {}).label || sel;
    return `${subNavHtml('settings', SETTING_GROUPS.map((x) => ({ id: x.id, label: x.label })), sel)}
      <div style="width:500px;flex:0 0 auto">
        ${rows}
        <div class="menu-reset" data-action="reset-settings" data-group="${sel}">Сбросить «${esc(groupLabel)}» к значениям по умолчанию</div>
      </div>`;
  }

  _renderSetting(g, s) {
    const v = g.settings.get(s.id);
    if (s.type === 'toggle') {
      return `<div class="menu-row menu-toggle ${v ? 'is-on' : ''}" data-action="set-toggle" data-id="${s.id}">
        <span class="menu-row__label">${esc(s.label)}</span>
        <span class="menu-row__value">${v ? 'ВКЛ' : 'ВЫКЛ'}</span>
      </div>`;
    }
    if (s.type === 'slider') {
      const pct = Math.max(0, Math.min(1, (v - s.min) / (s.max - s.min))) * 100;
      return `<div class="menu-row">
        <span class="menu-row__label">${esc(s.label)}</span>
        <div class="menu-row__value menu-slider__value">
          <span class="menu-slider__nudge" data-action="slider-nudge" data-id="${s.id}" data-dir="-1">−</span>
          <div class="menu-slider__track"><div class="menu-slider__fill" style="width:${pct}%"></div></div>
          <span class="menu-slider__nudge" data-action="slider-nudge" data-id="${s.id}" data-dir="1">+</span>
          <span class="menu-slider__num">${esc(s.format(v))}</span>
        </div>
      </div>`;
    }
    // choice / степпер
    return `<div class="menu-row">
      <span class="menu-row__label">${esc(s.label)}</span>
      <div class="menu-row__value menu-stepper__value">
        ${s.options.map((o) => `<span class="menu-stepper__opt ${o.value === v ? 'is-active' : ''}"
          data-action="stepper-pick" data-id="${s.id}" data-value="${o.value}">${esc(o.label)}</span>`).join('')}
      </div>
    </div>`;
  }

  // ------------------------------------------------------------- клики
  _onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const g = this.game;
    const action = el.dataset.action;

    if (action === 'tab') { this.tab = el.dataset.tab; this._stopCapture(); this.conflict = null; this.render(); return; }
    if (action === 'subnav') {
      const [group, key] = el.dataset.group.split(':');
      this.subSel[key] = el.dataset.id;
      this.render(); return;
    }
    if (action === 'set-toggle') { g.settings.set(el.dataset.id, !g.settings.get(el.dataset.id), g); this.render(); return; }
    if (action === 'slider-nudge') {
      const def = SETTINGS.find((s) => s.id === el.dataset.id);
      const dir = Number(el.dataset.dir);
      const next = Math.round((g.settings.get(def.id) + dir * def.step) * 1000) / 1000;
      g.settings.set(def.id, next, g); this.render(); return;
    }
    if (action === 'stepper-pick') {
      const def = SETTINGS.find((s) => s.id === el.dataset.id);
      g.settings.set(def.id, def.type === 'choice' ? Number(el.dataset.value) : el.dataset.value, g);
      this.render(); return;
    }
    if (action === 'reset-settings') { g.settings.resetGroup(el.dataset.group, g); this.render(); return; }
    if (action === 'reset-controls') {
      g.settings.resetGroup('controls', g); this._stopCapture(); this.conflict = null; this.render(); return;
    }
    if (action === 'bind-start') { this._startCapture(el.dataset.bindAction); return; }
    if (action === 'conflict-take') { this._resolveConflict(true); return; }
    if (action === 'conflict-keep') { this._resolveConflict(false); return; }
    if (action === 'save-slot') { g.saveToSlot(Number(el.dataset.slot)); this.render(); return; }
    if (action === 'load-slot') { g.loadSlot(Number(el.dataset.slot)); this.close(); return; }
    if (action === 'delete-slot') { g.deleteSlot(Number(el.dataset.slot)); this.render(); return; }
  }

  // ------------------------------------------------------ ребайнд клавиш
  _startCapture(action) {
    this.capturing = { action };
    this.conflict = null;
    window.addEventListener('keydown', this._onKeydownCapture, true);
    this.render();
  }

  _stopCapture() {
    if (!this.capturing) return;
    this.capturing = null;
    window.removeEventListener('keydown', this._onKeydownCapture, true);
  }

  _onKeydownCapture(e) {
    e.preventDefault(); e.stopPropagation();
    if (!this.capturing) return;
    const action = this.capturing.action;
    const code = e.code;
    this._stopCapture();
    const owner = this.game.settings.conflictOf(code, action);
    if (owner) {
      this.conflict = { code, action, ownerAction: owner.action };
      this.render();
      return;
    }
    this.game.settings.setBind(action, code, this.game);
    this.render();
  }

  _resolveConflict(take) {
    if (!this.conflict) return;
    const { code, action } = this.conflict;
    if (take) this.game.settings.setBind(action, code, this.game);
    this.conflict = null;
    this.render();
  }
}

// ----------------------------------------------------------------- хелперы
function subNavHtml(tab, items, activeId, subKey) {
  const key = subKey || tab;
  return `<div class="menu-subnav">
    ${items.map((it) => `<button class="menu-subnav-item" aria-selected="${it.id === activeId}"
      data-action="subnav" data-group="${tab}:${key}" data-id="${it.id}">${esc(it.label)}</button>`).join('')}
  </div>`;
}

function row(label, value, opts = {}) {
  const cls = ['menu-row'];
  if (opts.state) cls.push('state-' + opts.state);
  return `<div class="${cls.join(' ')}">
    <span class="menu-row__label">${esc(label)}</span>
    <span class="menu-row__value ${opts.numeric ? 'numeric' : ''} ${opts.moneyColor ? 'money' : ''}">${esc(value)}</span>
  </div>`;
}

function actionBtn(action, slot, label) {
  return `<span class="menu-reset" style="display:inline-block;margin-right:var(--sp-5)"
    data-action="${action}" data-slot="${slot}">${esc(label)}</span>`;
}

function fmtPlayTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return `${h} Ч ${String(m).padStart(2, '0')} МИН`;
}
