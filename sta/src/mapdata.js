// Данные для полноэкранной карты: легенда маркеров и живой снимок мира.
//
// Легенда содержит ТОЛЬКО иконки, которые реально рисуются на миникарте
// (src/hud.js, вызовы icon(...)). В атласе assets/map_icons.png 20 слотов,
// но семь из них — boss, enemy, cash, flag, phone, waypoint, crane — ни разу
// не используются кодом. Показывать их в легенде значит объяснять то,
// чего игрок никогда не увидит.
//
// filterId связывает строку легенды с переключателем из settings.js
// (группа 'map') — это один и тот же выключатель, а не два похожих списка.
import { CITY, DISTRICTS } from './city.js';

export const MAP_LEGEND = [
  { icon: 'mission',   label: 'Сюжетная миссия',          filterId: 'showMissions' },
  { icon: 'job',       label: 'Подработка',               filterId: 'showMissions' },
  { icon: 'cartarget', label: 'Машина-цель миссии',       filterId: 'showMissions' },
  { icon: 'package',   label: 'Спрятанный пакет',         filterId: 'showPackages' },
  { icon: 'property',  label: 'Недвижимость',             filterId: 'showProperty' },
  { icon: 'rampage',   label: 'Точка беспредела',         filterId: 'showRampage' },
  { icon: 'spray',     label: "Pay'n'Spray",              filterId: 'showService' },
  { icon: 'ammu',      label: 'Gun Shop',              filterId: 'showService' },
  { icon: 'hospital',  label: 'Больница',                 filterId: 'showService' },
  { icon: 'police',    label: 'Полицейский участок',      filterId: 'showService' },
  { icon: 'heli',      label: 'Полицейский вертолёт',     filterId: 'showHeli' },
  { icon: 'gang',      label: 'Враждебная банда',         filterId: 'showGangs' },
  { icon: 'garage',    label: 'Брошенная машина игрока',  filterId: 'showGarage' },
];

// Цвет иконок задан пикселями в атласе — доставать точный hex из PNG
// программой нет смысла. Для легенды это нормально: рядом с подписью
// достаточно самой иконки, а не цветной точки-заменителя.
export const MAP_ICON_ATLAS = { src: 'assets/map_icons.png', cols: 5, rows: 4, cell: 64 };

// Снимок мира на момент открытия карты — то, что экран показывает сверх
// самих маркеров: границы города для перевода координат, контроль районов
// и статус недвижимости.
export function mapSnapshot(game) {
  const p = game.progress;
  return {
    bounds: { half: CITY.HALF },
    districts: Object.keys(p.turf).map((id) => ({
      id,
      name: (DISTRICTS[id] && DISTRICTS[id].name) || id,
      control: Math.round(p.turf[id]),
      owned: p.turf[id] >= 100,
    })),
    properties: p.propertyMarkers.map((pm) => ({
      id: pm.def.id, name: pm.def.name, price: pm.def.price, income: pm.def.income,
      perk: pm.def.perk, x: pm.x, z: pm.z, owned: p.owned.includes(pm.def.id),
    })),
    packagesFound: p.packagesFound,
    turfOwned: p.turfOwned,
  };
}
