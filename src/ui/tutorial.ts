import { Game } from '../sim/game';

const STORAGE_KEY = 'mm.tutorialDone';

interface Step {
  text: string;
  /** Step completes when this returns true; omitted means it waits for "Got it". */
  done?: (g: Game) => boolean;
}

const STEPS: Step[] = [
  { text: 'Drag from a <b>house</b> to the <b>building of the same color</b> to lay a road.', done: (g) => g.cars.length > 0 },
  { text: 'Cars pick up the white <b>pins</b> and bring them home. Each one is a point.', done: (g) => g.score >= 2 },
  { text: 'Too many pins and a <b>red ring</b> starts filling. If it closes, the game is over.' },
  { text: 'Every road tile uses one from your budget below. <b>Right-drag</b> erases roads and refunds them.' },
  { text: 'The week dial (top right) fills up. At the end of each week you get more roads and pick an upgrade.' },
];

/** Hint bubbles for a first game; advances on the player's actions and remembers when finished. */
export class Tutorial {
  private el: HTMLDivElement;
  private step = -1;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'tutorial';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="text"></div><div class="row"><span class="count"></span><button class="skip">Skip</button><button class="next">Got it</button></div>`;
    this.el.querySelector('.skip')!.addEventListener('click', () => this.finish());
    this.el.querySelector('.next')!.addEventListener('click', () => this.advance());
    parent.appendChild(this.el);
  }

  /** Start the tutorial if this player hasn't finished it (or `force`). */
  start(force = false): void {
    let done = false;
    try { done = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage blocked: show it */ }
    if (done && !force) return;
    this.step = -1;
    this.advance();
  }

  update(game: Game): void {
    const s = STEPS[this.step];
    if (s?.done?.(game)) this.advance();
  }

  private advance() {
    this.step++;
    const s = STEPS[this.step];
    if (!s) return this.finish();
    this.el.querySelector('.text')!.innerHTML = s.text;
    this.el.querySelector('.count')!.textContent = `${this.step + 1}/${STEPS.length}`;
    (this.el.querySelector('.next') as HTMLElement).hidden = !!s.done;
    this.el.hidden = false;
    // Restart the pop-in animation for each step.
    this.el.style.animation = 'none';
    void this.el.offsetWidth;
    this.el.style.animation = '';
  }

  private finish() {
    this.step = STEPS.length;
    this.el.hidden = true;
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
  }
}
