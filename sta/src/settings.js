// Настройки игры: реестр опций, хранение и применение.
//
// Реестр — единственный источник правды. Экран настроек строится из него же,
// поэтому список на экране не может разойтись с тем, что игра реально умеет:
// нельзя показать опцию, у которой нет apply.
//
// Всё, что здесь есть, действительно на что-то влияет. Опций «на будущее»
// в реестре нет — пустой переключатель хуже отсутствующего.

import { DEFAULT_BINDS } from './input.js';

const STORE_KEY = 'liberty-settings';

export const SETTING_GROUPS = [
  { id: 'controls', label: 'УПРАВЛЕНИЕ' },
  { id: 'audio',    label: 'ЗВУК' },
  { id: 'display',  label: 'ЭКРАН' },
  { id: 'game',     label: 'ИГРА' },
  { id: 'map',      label: 'КАРТА' },
];

const pct = (v) => Math.round(v * 100) + ' %';
const onOff = (v) => (v ? 'ВКЛ' : 'ВЫКЛ');

export const SETTINGS = [
  // ---------------------------------------------------------------- controls
  {
    id: 'mouseSensitivity', group: 'controls', label: 'ЧУВСТВИТЕЛЬНОСТЬ МЫШИ',
    type: 'slider', min: 0.2, max: 3, step: 0.1, def: 1,
    format: (v) => v.toFixed(1) + '×',
    apply: (g, v) => { g.cam.sensitivity = v; },
  },
  {
    id: 'invertY', group: 'controls', label: 'ИНВЕРСИЯ ВЕРТИКАЛИ',
    type: 'toggle', def: false, format: onOff,
    apply: (g, v) => { g.cam.invertY = v; },
  },

  // ------------------------------------------------------------------- audio
  {
    id: 'sound', group: 'audio', label: 'ЗВУК',
    type: 'toggle', def: true, format: onOff,
    apply: (g, v) => { g.audio.setMuted(!v); },
  },
  {
    id: 'volumeMaster', group: 'audio', label: 'ГРОМКОСТЬ ЭФФЕКТОВ',
    type: 'slider', min: 0, max: 1, step: 0.05, def: 0.6, format: pct,
    apply: (g, v) => { g.audio.setMasterVolume(v); },
  },
  {
    id: 'volumeRadio', group: 'audio', label: 'ГРОМКОСТЬ РАДИО',
    type: 'slider', min: 0, max: 0.6, step: 0.03, def: 0.24,
    format: (v) => Math.round((v / 0.6) * 100) + ' %',
    apply: (g, v) => { if (g.radio) g.radio.volume = v; },
  },

  // ----------------------------------------------------------------- display
  {
    id: 'postfx', group: 'display', label: 'ПОСТОБРАБОТКА',
    type: 'toggle', def: true, format: onOff,
    apply: (g, v) => { g.post.enabled = v; },
  },
  {
    id: 'grain', group: 'display', label: 'ПЛЁНОЧНОЕ ЗЕРНО',
    type: 'toggle', def: true, format: onOff,
    apply: (g, v) => { g.post.grainScale = v ? 1 : 0; },
  },
  {
    id: 'aberration', group: 'display', label: 'ХРОМАТИЧЕСКАЯ АБЕРРАЦИЯ',
    type: 'toggle', def: true, format: onOff,
    apply: (g, v) => { g.post.aberrationScale = v ? 1 : 0; },
  },
  {
    id: 'fpsCounter', group: 'display', label: 'СЧЁТЧИК КАДРОВ',
    type: 'toggle', def: true, format: onOff,
    apply: (g, v) => {
      const el = document.getElementById('fps');
      if (el) el.style.display = v ? '' : 'none';
    },
  },

  // -------------------------------------------------------------------- game
  {
    id: 'cameraShake', group: 'game', label: 'ТРЯСКА КАМЕРЫ',
    type: 'slider', min: 0, max: 1.5, step: 0.1, def: 1, format: pct,
    apply: (g, v) => { g.shakeScale = v; },
  },
  {
    id: 'hints', group: 'game', label: 'КОНТЕКСТНЫЕ ПОДСКАЗКИ',
    type: 'toggle', def: true, format: onOff,
    apply: (g, v) => { g.hud.showHints = v; },
  },
  {
    id: 'minimapZoom', group: 'game', label: 'ЗУМ МИНИКАРТЫ',
    type: 'choice', def: 135,
    options: [
      { value: 80,  label: 'БЛИЖНИЙ' },
      { value: 135, label: 'СРЕДНИЙ' },
      { value: 210, label: 'ДАЛЬНИЙ' },
    ],
    apply: (g, v) => { g.hud.mapZoom = v; },
  },

  // ---------------------------------------------------------------- map
  // Фильтры маркеров миникарты. Каждый переключает РЕАЛЬНУЮ группу
  // иконок в src/hud.js (см. MAP_LEGEND в mapdata.js) — не декоративный список.
  { id: 'showMissions', group: 'map', label: 'МИССИИ И ЦЕЛИ',   type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.missions = v; } },
  { id: 'showPackages', group: 'map', label: 'ПАКЕТЫ',          type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.packages = v; } },
  { id: 'showProperty', group: 'map', label: 'НЕДВИЖИМОСТЬ',    type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.property = v; } },
  { id: 'showRampage',  group: 'map', label: 'БЕСПРЕДЕЛ',       type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.rampage = v; } },
  { id: 'showService',  group: 'map', label: 'СЕРВИСЫ ГОРОДА',  type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.service = v; } },
  { id: 'showHeli',     group: 'map', label: 'ПОЛИЦЕЙСКИЕ ВЕРТОЛЁТЫ', type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.heli = v; } },
  { id: 'showGangs',    group: 'map', label: 'БАНДЫ',           type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.gangs = v; } },
  { id: 'showGarage',   group: 'map', label: 'БРОШЕННАЯ МАШИНА', type: 'toggle', def: true, format: onOff, apply: (g, v) => { g.mapFilters.garage = v; } },
];

// Клавиши, которые игрок может переназначить. Порядок — порядок на экране.
// Слоты оружия (1…6) и управление в ролике намеренно не переназначаются:
// первое — цифровой ряд как единое целое, второе живёт до старта игры.
export const BINDABLE = [
  { action: 'forward',      group: 'ПЕРЕДВИЖЕНИЕ', label: 'Вперёд' },
  { action: 'back',         group: 'ПЕРЕДВИЖЕНИЕ', label: 'Назад' },
  { action: 'left',         group: 'ПЕРЕДВИЖЕНИЕ', label: 'Влево' },
  { action: 'right',        group: 'ПЕРЕДВИЖЕНИЕ', label: 'Вправо' },
  { action: 'sprint',       group: 'ПЕРЕДВИЖЕНИЕ', label: 'Бежать' },
  { action: 'jump',         group: 'ПЕРЕДВИЖЕНИЕ', label: 'Прыжок · ручник' },
  { action: 'crouch',       group: 'ПЕРЕДВИЖЕНИЕ', label: 'Присесть' },
  { action: 'enter',        group: 'ПЕРЕДВИЖЕНИЕ', label: 'Сесть · выйти из машины' },
  { action: 'camera',       group: 'ПЕРЕДВИЖЕНИЕ', label: 'Смена вида' },
  { action: 'horn',         group: 'ПЕРЕДВИЖЕНИЕ', label: 'Сигнал' },
  { action: 'nextWeapon',   group: 'БОЙ',          label: 'Смена оружия' },
  { action: 'reload',       group: 'БОЙ',          label: 'Перезарядка' },
  { action: 'respawn',      group: 'БОЙ',          label: 'Возрождение' },
  { action: 'interact',     group: 'ГОРОД',        label: 'Купить · взаимодействие' },
  { action: 'shopNext',     group: 'ГОРОД',        label: 'Следующий товар' },
  { action: 'job',          group: 'ГОРОД',        label: 'Подработка' },
  { action: 'jobType',      group: 'ГОРОД',        label: 'Сменить подработку' },
  { action: 'radio',        group: 'ГОРОД',        label: 'Радиостанция' },
  { action: 'map',          group: 'СИСТЕМА',      label: 'Зум миникарты' },
  { action: 'mute',         group: 'СИСТЕМА',      label: 'Звук' },
  { action: 'pause',        group: 'СИСТЕМА',      label: 'Пауза' },
  { action: 'save',         group: 'СИСТЕМА',      label: 'Быстрое сохранение' },
  { action: 'load',         group: 'СИСТЕМА',      label: 'Быстрая загрузка' },
  { action: 'skipTutorial', group: 'СИСТЕМА',      label: 'Пропустить обучение' },
];

// Человекочитаемые подписи клавиш. Всё, чего нет в таблице, показывается
// без префикса Key/Digit — «KeyW» игроку ничего не говорит.
const KEY_LABELS = {
  Space: 'ПРОБЕЛ', Enter: 'ENTER', Escape: 'ESC', Backspace: 'BACKSPACE', Tab: 'TAB',
  ShiftLeft: 'SHIFT', ShiftRight: 'ПР. SHIFT', ControlLeft: 'CTRL', ControlRight: 'ПР. CTRL',
  AltLeft: 'ALT', AltRight: 'ПР. ALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  return code.replace(/^(Key|Digit|Numpad)/, '');
}

const byId = new Map(SETTINGS.map((s) => [s.id, s]));
export const getDef = (id) => byId.get(id);

function clampValue(def, v) {
  if (def.type === 'toggle') return !!v;
  if (def.type === 'choice') return def.options.some((o) => o.value === v) ? v : def.def;
  const n = Number(v);
  if (!Number.isFinite(n)) return def.def;
  return Math.min(def.max, Math.max(def.min, n));
}

export class Settings {
  constructor() {
    this.values = {};
    for (const s of SETTINGS) this.values[s.id] = s.def;
    this.binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
    this.load();
  }

  get(id) { return this.values[id]; }

  // game может быть null: экран настроек открывается и до старта партии.
  set(id, value, game) {
    const def = byId.get(id);
    if (!def) return false;
    this.values[id] = clampValue(def, value);
    if (game) def.apply(game, this.values[id]);
    this.persist();
    return true;
  }

  applyAll(game) {
    if (!game) return;
    for (const s of SETTINGS) {
      try { s.apply(game, this.values[s.id]); }
      catch (e) { console.warn('[settings] не применилось:', s.id, e.message); }
    }
    game.input.binds = JSON.parse(JSON.stringify(this.binds));
  }

  resetGroup(groupId, game) {
    for (const s of SETTINGS) if (s.group === groupId) this.values[s.id] = s.def;
    if (groupId === 'controls') this.binds = JSON.parse(JSON.stringify(DEFAULT_BINDS));
    this.persist();
    this.applyAll(game);
  }

  // ------------------------------------------------------------------ binds
  bindsOf(action) { return this.binds[action] || []; }

  // Ищет, за кем ещё числится клавиша. Молча отдавать одну клавишу двум
  // действиям нельзя: игрок нажмёт и получит оба.
  conflictOf(code, exceptAction) {
    for (const b of BINDABLE) {
      if (b.action === exceptAction) continue;
      if ((this.binds[b.action] || []).includes(code)) return b;
    }
    return null;
  }

  // Ставит клавишу первой в списке действия. Если она занята другим
  // действием — забирает её оттуда и возвращает, у кого отняли, чтобы
  // экран мог об этом сказать словами.
  setBind(action, code, game) {
    if (!this.binds[action]) return { ok: false };
    const stolenFrom = this.conflictOf(code, action);
    if (stolenFrom) {
      this.binds[stolenFrom.action] = this.binds[stolenFrom.action].filter((c) => c !== code);
    }
    this.binds[action] = [code, ...this.binds[action].filter((c) => c !== code)].slice(0, 2);
    this.persist();
    if (game) game.input.binds = JSON.parse(JSON.stringify(this.binds));
    return { ok: true, stolenFrom };
  }

  // ---------------------------------------------------------------- storage
  load() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); }
    catch (e) { return; }   // приватный режим — играем на значениях по умолчанию
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      for (const s of SETTINGS) {
        if (d.values && s.id in d.values) this.values[s.id] = clampValue(s, d.values[s.id]);
      }
      // Незнакомые действия из старого файла игнорируем, а новые берут
      // значение по умолчанию — иначе обновление игры ломает управление.
      if (d.binds) {
        for (const action of Object.keys(this.binds)) {
          const list = d.binds[action];
          if (Array.isArray(list) && list.length) this.binds[action] = list.slice(0, 2);
        }
      }
    } catch (e) { /* битый файл настроек — молча остаёмся на умолчаниях */ }
  }

  persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ values: this.values, binds: this.binds }));
    } catch (e) { /* приватный режим */ }
  }
}
