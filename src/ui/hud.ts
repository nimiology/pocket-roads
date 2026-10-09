/** Top bar: score on the left; week dial and pause/1x/2x controls on the right. */
export class Hud {
  private score: HTMLSpanElement;
  private dial: SVGCircleElement;
  private weekLabel: HTMLSpanElement;
  private sandbox: HTMLDivElement;
  private buttons = new Map<number, HTMLButtonElement>();

  constructor(parent: HTMLElement, onSpeed: (speed: number) => void) {
    const left = document.createElement('div');
    left.className = 'hud';
    left.innerHTML = `<svg class="pin" viewBox="0 0 20 20"><circle cx="10" cy="10" r="7" fill="#fff" stroke="#4a4740" stroke-width="2"/></svg><span class="score">0</span>`;
    this.score = left.querySelector('.score')!;

    const right = document.createElement('div');
    right.className = 'hud-right';
    right.innerHTML = `<div class="sandbox" hidden title="Sandbox: rings never end the game (O to toggle)">Sandbox</div><div class="week"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" class="track"/><circle cx="12" cy="12" r="9" class="fill" pathLength="1"/></svg><span></span></div>
      <div class="speed"></div>`;
    this.sandbox = right.querySelector('.sandbox')!;
    this.dial = right.querySelector('.fill')!;
    this.weekLabel = right.querySelector('.week span')!;
    const speedBox = right.querySelector('.speed')!;
    const labels: [number, string][] = [
      [0, `<svg viewBox="0 0 20 20"><rect x="5" y="4" width="3.5" height="12" rx="1"/><rect x="11.5" y="4" width="3.5" height="12" rx="1"/></svg>`],
      [1, `<svg viewBox="0 0 20 20"><path d="M6 4 L16 10 L6 16 Z"/></svg>`],
      [2, `<svg viewBox="0 0 20 20"><path d="M2 4 L10 10 L2 16 Z M10 4 L18 10 L10 16 Z"/></svg>`],
    ];
    for (const [speed, icon] of labels) {
      const b = document.createElement('button');
      b.innerHTML = icon;
      b.title = speed === 0 ? 'Pause (P)' : `${speed}x (${speed})`;
      b.addEventListener('click', () => onSpeed(speed));
      speedBox.appendChild(b);
      this.buttons.set(speed, b);
    }
    parent.append(left, right);
  }

  /** `speed` 0 means paused. */
  update(score: number, week: number, weekProgress: number, speed: number, sandbox: boolean): void {
    this.sandbox.hidden = !sandbox;
    this.score.textContent = String(score);
    this.weekLabel.textContent = `Week ${week}`;
    this.dial.style.strokeDashoffset = String(1 - Math.min(1, weekProgress));
    for (const [s, b] of this.buttons) b.classList.toggle('on', s === speed);
  }
}
