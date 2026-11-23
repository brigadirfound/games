// Вступительный ролик: рисованные панели + текст с печатной машинкой.
// Подаёт завязку сюжета до первой миссии, чтобы игрок понимал, кто он и зачем.

const PANELS = [
  {
    img: 'assets/intro_1.jpg',
    title: 'ЛИБЕРТИ-СИТИ',
    lines: [
      'Восемь лет назад ты уехал отсюда с одной сумкой и чужим паспортом.',
      'Паром возвращает тебя обратно. Сумка та же. Паспорт снова чужой.',
    ],
    hold: 7.5,
  },
  {
    img: 'assets/intro_2.jpg',
    title: 'ДОЛГ',
    lines: [
      'В Портленде тебя ждут не с цветами. За тобой висит долг,',
      'который вырос втрое, пока тебя не было в городе.',
      'Проценты в этом городе считают не банкиры.',
    ],
    hold: 8,
  },
  {
    img: 'assets/intro_3.jpg',
    title: 'ПРЕДЛОЖЕНИЕ',
    lines: [
      'Дон Сальери держит порт, полицию и половину мэрии.',
      'Он двигает тебе ключи через стол и говорит:',
      '«Отработаешь. Или отработают тебя».',
    ],
    hold: 8.5,
  },
  {
    img: 'assets/intro_4.jpg',
    title: 'РАБОТА',
    lines: [
      'Сначала это просто поездки. Потом — поездки с грузом.',
      'Потом ты перестаёшь спрашивать, что в багажнике.',
      'Город быстро учит: тормозить некогда.',
    ],
    hold: 8,
  },
  {
    img: 'assets/intro_5.jpg',
    title: 'ВЕРХ',
    lines: [
      'Наверху той башни сидит человек, который решает,',
      'кто в этом городе живёт, а кто числится пропавшим.',
      'Однажды он решит и насчёт тебя.',
    ],
    hold: 8,
  },
  {
    img: 'assets/intro_6.jpg',
    title: 'НАЧАЛО',
    lines: [
      'У тебя есть тачка, пустые карманы и очень плохая репутация.',
      'Двенадцать заказов отделяют тебя от вершины.',
      'Или от дна залива.',
    ],
    hold: 8,
  },
];

const CHAR_TIME = 0.022;   // секунд на символ
const FADE = 0.7;

export class Intro {
  constructor(onDone) {
    this.onDone = onDone;
    this.active = false;
    this.index = 0;
    this.t = 0;
    this.done = false;

    this.root = document.createElement('div');
    this.root.id = 'intro';
    this.root.innerHTML = `
      <div id="intro-img"></div>
      <div id="intro-grain"></div>
      <div id="intro-vig"></div>
      <div id="intro-text">
        <div id="intro-title"></div>
        <div id="intro-lines"></div>
      </div>
      <div id="intro-skip">ПРОБЕЛ — ДАЛЬШЕ · ESC — ПРОПУСТИТЬ</div>
      <div id="intro-progress"><i></i></div>`;
    document.body.appendChild(this.root);

    this.el = {
      img: this.root.querySelector('#intro-img'),
      title: this.root.querySelector('#intro-title'),
      lines: this.root.querySelector('#intro-lines'),
      bar: this.root.querySelector('#intro-progress i'),
    };
  }

  // Предзагрузка, иначе первая панель мигнёт пустотой.
  preload() {
    return Promise.all(PANELS.map((p) => new Promise((res) => {
      const im = new Image();
      im.onload = im.onerror = () => res();
      im.src = p.img;
    })));
  }

  start() {
    this.active = true;
    this.done = false;
    this.index = 0;
    this.root.style.display = 'block';
    this.showPanel(0);
  }

  showPanel(i) {
    const p = PANELS[i];
    if (!p) { this.finish(); return; }
    this.transitioning = false;
    this.t = 0;
    this.typed = 0;
    this.fullText = p.lines.join('\n');
    this.el.img.style.backgroundImage = `url("${p.img}")`;
    // каждая панель едет в свою сторону — эффект Кена Бёрнса
    this.el.img.style.animation = 'none';
    void this.el.img.offsetWidth;             // рестарт анимации
    this.el.img.style.animation = `introPan${i % 3} ${p.hold + 2}s ease-out forwards`;
    this.el.title.textContent = p.title;
    this.el.lines.textContent = '';
    this.root.classList.remove('fading');
    this.root.classList.add('entering');
    setTimeout(() => this.root.classList.remove('entering'), FADE * 1000);
  }

  update(dt, input) {
    if (!this.active || this.transitioning) return;
    this.t += dt;
    const p = PANELS[this.index];
    if (!p) return;

    // печатаем текст
    const want = Math.floor(this.t / CHAR_TIME);
    if (want !== this.typed) {
      this.typed = want;
      this.el.lines.textContent = this.fullText.slice(0, want);
    }
    const typedAll = this.typed >= this.fullText.length;

    const prog = Math.min(1, this.t / p.hold);
    this.el.bar.style.width = (prog * 100).toFixed(1) + '%';

    // Пробел: сначала домотать текст, вторым нажатием — следующая панель.
    const skipKey = input && (input.hit('Space') || input.hit('Enter') || input.hit('KeyE'));
    if (skipKey && !typedAll) {
      this.t = this.fullText.length * CHAR_TIME;
      return;
    }
    if ((skipKey && typedAll) || this.t >= p.hold) this.next();
  }

  next() {
    if (this.transitioning) return;
    this.index++;
    if (this.index >= PANELS.length) { this.finish(); return; }
    this.transitioning = true;                 // блокируем update на время фейда
    this.root.classList.add('fading');
    setTimeout(() => {
      this.transitioning = false;
      this.showPanel(this.index);
    }, FADE * 400);
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.active = false;
    this.root.classList.add('fading');
    setTimeout(() => {
      this.root.style.display = 'none';
      this.root.classList.remove('fading');
      if (this.onDone) this.onDone();
    }, FADE * 1000);
  }

  skip() { this.finish(); }
}

export const INTRO_PANEL_COUNT = PANELS.length;
