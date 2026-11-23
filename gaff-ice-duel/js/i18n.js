// Тексты игры. Никаких названий площадок и магазинов — только нейтральные
// формулировки (п. 3.5). Язык приходит из Platform.getLanguage().
export const GAME_META = {
  title: { ru: 'БАГОР: Ледяная дуэль', en: 'Gaff: Ice Duel' },
};

const STRINGS = {
  ru: {
    logo: 'БАГОР',
    logoSub: 'ЛЕДЯНАЯ ДУЭЛЬ',
    play: 'Играть',
    howto: 'Как играть',
    shop: 'Облик',
    settings: 'Настройки',
    back: 'Назад',
    close: 'Закрыть',
    coins: 'Монеты',

    chooseRival: 'Выбери соперника',
    rivalHint: 'Чем сильнее соперник, тем больше монет за победу',
    reward: 'Награда',
    matchTo: 'Матч до {n} побед',

    pause: 'ПАУЗА',
    resume: 'Продолжить',
    toMenu: 'В меню',
    quitMatch: 'Покинуть матч',

    round: 'Раунд {n}',
    roundWin: 'РАУНД ВАШ',
    roundLose: 'РАУНД ПРОИГРАН',
    roundDraw: 'НИЧЬЯ',
    score: 'Счёт',
    nextRound: 'Следующий раунд',
    countdownFight: 'БОЙ!',

    matchWin: 'ПОБЕДА',
    matchLose: 'ПОРАЖЕНИЕ',
    rematch: 'Реванш',
    rewardBase: 'За матч',
    rewardDiff: 'За сложность',
    rewardClean: 'Всухую',
    rewardFirst: 'Первая победа за день',
    rewardTotal: 'Итого',
    doubleCoins: 'Удвоить монеты',
    cooldownResetTitle: 'Сброс кулдаунов в следующем раунде',
    cooldownResetDone: 'Кулдауны сброшены',
    adUnavailable: 'Сейчас недоступно',
    rewardedSuffix: '📺 за рекламу',

    you: 'ВЫ',
    rival: 'СОПЕРНИК',
    finishHint: 'Соперник ослаб — подойди вплотную',

    leaders: 'Лидеры',
    leadersTitle: 'Таблица лидеров',
    leadersHint: 'Считаются выигранные матчи',
    leadersLoading: 'Загрузка…',
    leadersEmpty: 'Пока никто не выиграл ни одного матча. Будь первым.',
    leadersUnavailable: 'Таблица лидеров сейчас недоступна',
    leadersAnon: 'Игрок',
    statsWins: 'Побед в матчах',

    shopFighter: 'Боец',
    shopGaff: 'Багор',
    hueCoat: 'Тулуп',
    hueHat: 'Шапка',
    hueAccent: 'Опушка',

    consolation: 'Забрать {n} монет за поражение',
    adBonus: 'Бонус дня: {n} монет',
    adBonusDone: 'Бонус дня уже получен',

    keyHook: 'ЛКМ',
    keyDash: 'ПКМ',
    keyTrap: 'Q',

    dailyTitle: 'Испытание дня',
    dailyDone: 'Выполнено',
    dailyReward: 'Награда',
    taskWin: 'Выиграй матч',
    taskSweep: 'Выиграй матч всухую — 3:0',
    taskStrong: 'Победи соперника от трёх звёзд',
    taskComeback: 'Победи матч, проигрывая 1:2',
    rewardDaily: 'Испытание дня',

    hookName: 'Багор',
    dashName: 'Рывок',
    trapName: 'Ледяная ловушка',
    hookDesc: 'Бросок по прямой. Попал по сопернику — притянешь его к себе. Попал в торос или кромку — притянешь себя к ним.',
    dashDesc: 'Скачок в указанную точку. Короткая неуязвимость: успевает уйти и от багра, и от добивания.',
    trapDesc: 'Наледь под ногами соперника. Наступит — потеряет управление.',
    finishName: 'Финал',
    finishDesc: 'Когда у соперника меньше 30% сил, контакт вплотную заканчивает раунд одним ударом. Тот же приём работает и против вас.',
    holeName: 'Полынья',
    holeDesc: 'Провал во льду: урон и потеря управления. Затащить туда соперника багром выгоднее, чем бить.',
    iceName: 'Лёд',
    iceDesc: 'Разгон и торможение не мгновенные — рассчитывай скольжение заранее.',

    controlsDesktop: 'WASD — движение · ЛКМ — багор · ПКМ — рывок · Q — ловушка · Esc — пауза',
    controlsTouch: 'Стик слева — движение · кнопки справа — способности',
    aimMode: 'Наведение',
    aimModeDrag: 'Тянуть с кнопки',
    aimModeTap: 'Тап по арене',
    aimModeDragHint: 'Зажми кнопку способности и потяни: появится линия броска',
    aimModeTapHint: 'Нажми кнопку способности, потом коснись арены',
    sound: 'Звук',
    on: 'Вкл',
    off: 'Выкл',
    language: 'Язык',

    skinOwned: 'Куплено',
    skinEquipped: 'Надето',
    skinEquip: 'Надеть',
    skinBuy: 'Купить',
    notEnough: 'Не хватает монет',
    bought: 'Куплено!',
  },
  en: {
    logo: 'GAFF',
    logoSub: 'ICE DUEL',
    play: 'Play',
    howto: 'How to play',
    shop: 'Looks',
    settings: 'Settings',
    back: 'Back',
    close: 'Close',
    coins: 'Coins',

    chooseRival: 'Choose your rival',
    rivalHint: 'Tougher rivals pay more coins',
    reward: 'Reward',
    matchTo: 'First to {n} wins',

    pause: 'PAUSED',
    resume: 'Resume',
    toMenu: 'Menu',
    quitMatch: 'Leave match',

    round: 'Round {n}',
    roundWin: 'ROUND WON',
    roundLose: 'ROUND LOST',
    roundDraw: 'DRAW',
    score: 'Score',
    nextRound: 'Next round',
    countdownFight: 'FIGHT!',

    matchWin: 'VICTORY',
    matchLose: 'DEFEAT',
    rematch: 'Rematch',
    rewardBase: 'Match',
    rewardDiff: 'Difficulty',
    rewardClean: 'Clean sweep',
    rewardFirst: 'First win today',
    rewardTotal: 'Total',
    doubleCoins: 'Double coins',
    cooldownResetTitle: 'Reset cooldowns next round',
    cooldownResetDone: 'Cooldowns reset',
    adUnavailable: 'Not available now',
    rewardedSuffix: '📺 watch ad',

    you: 'YOU',
    rival: 'RIVAL',
    finishHint: 'Rival is weak — close in',

    leaders: 'Leaders',
    leadersTitle: 'Leaderboard',
    leadersHint: 'Counts matches won',
    leadersLoading: 'Loading…',
    leadersEmpty: 'Nobody has won a match yet. Be the first.',
    leadersUnavailable: 'The leaderboard is not available right now',
    leadersAnon: 'Player',
    statsWins: 'Matches won',

    shopFighter: 'Fighter',
    shopGaff: 'Gaff',
    hueCoat: 'Coat',
    hueHat: 'Hat',
    hueAccent: 'Trim',

    consolation: 'Take {n} coins for the loss',
    adBonus: 'Daily bonus: {n} coins',
    adBonusDone: 'Daily bonus already taken',

    keyHook: 'LMB',
    keyDash: 'RMB',
    keyTrap: 'Q',

    dailyTitle: 'Daily challenge',
    dailyDone: 'Done',
    dailyReward: 'Reward',
    taskWin: 'Win a match',
    taskSweep: 'Win a match 3:0',
    taskStrong: 'Beat a three-star rival or tougher',
    taskComeback: 'Win a match from 1:2 down',
    rewardDaily: 'Daily challenge',

    hookName: 'Gaff',
    dashName: 'Dash',
    trapName: 'Ice trap',
    hookDesc: 'Straight throw. Hit the rival and you reel them in. Hit a ridge or the rim and you reel yourself there.',
    dashDesc: 'Leap to a point. Brief invulnerability: escapes both the gaff and the finish.',
    trapDesc: 'Slick ice under the rival. Step on it and they lose control.',
    finishName: 'Finish',
    finishDesc: 'Below 30% strength, close contact ends the round in one blow. It works against you too.',
    holeName: 'Ice hole',
    holeDesc: 'A gap in the ice: damage and lost control. Reeling a rival into one beats hitting them.',
    iceName: 'Ice',
    iceDesc: 'No instant starts or stops — plan for the slide.',

    controlsDesktop: 'WASD — move · LMB — gaff · RMB — dash · Q — trap · Esc — pause',
    controlsTouch: 'Left stick — move · right buttons — abilities',
    aimMode: 'Aiming',
    aimModeDrag: 'Drag from button',
    aimModeTap: 'Tap the arena',
    aimModeDragHint: 'Hold an ability button and drag: a throw line appears',
    aimModeTapHint: 'Tap an ability button, then tap the arena',
    sound: 'Sound',
    on: 'On',
    off: 'Off',
    language: 'Language',

    skinOwned: 'Owned',
    skinEquipped: 'Equipped',
    skinEquip: 'Equip',
    skinBuy: 'Buy',
    notEnough: 'Not enough coins',
    bought: 'Purchased!',
  },
};

let lang = 'ru';

export function setLang(value) { lang = value === 'en' ? 'en' : 'ru'; }
export function getLang() { return lang; }

export function t(key, params) {
  let s = STRINGS[lang][key] ?? STRINGS.ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  return s;
}

/** Подпись кнопки, которая запускает рекламу за награду (п. 4.5.1). */
export function rewardedLabel(text) {
  return `${text}  ${t('rewardedSuffix')}`;
}

export function gameTitle() { return GAME_META.title[lang]; }
