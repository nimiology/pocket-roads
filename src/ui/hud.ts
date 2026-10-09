/** Top bar: score on the left; week dial and pause/1x/2x controls on the right. */
export class Hud {
  private score: HTMLSpanElement;
  private dial: SVGCircleElement;
  private weekLabel: HTMLSpanElement;
  private sandbox: HTMLDivElement;
  private buttons = new Map<number, HTMLButtonElement>();

  private lastScore = 0;
  private mute: HTMLButtonElement;

  constructor(parent: HTMLElement, onSpeed: (speed: number) => void, onMute: () => boolean, muted: boolean) {
    const left = document.createElement('div');
    left.className = 'hud';
    left.innerHTML = `<svg class="pin" viewBox="0 0 20 20"><circle cx="10" cy="10.8" r="8" fill="#3d3a35"/><circle cx="10" cy="9.6" r="6.4" fill="#fff"/></svg><span class="score">0</span>`;
    this.score = left.querySelector('.score')!;

    const right = document.createElement('div');
    right.className = 'hud-right';
    right.innerHTML = `<div class="sandbox" hidden title="Sandbox: rings never end the game (O to toggle)">Sandbox</div><div class="week"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" class="track"/><circle cx="12" cy="12" r="9" class="fill" pathLength="1"/></svg><span></span></div>
      <div class="speed"></div><button class="mute" title="Sound"></button>`;
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
    this.mute = right.querySelector('.mute')!;
    this.mute.addEventListener('click', () => this.setMuted(onMute()));
    this.setMuted(muted);
    parent.append(left, right);
  }

  setMuted(muted: boolean): void {
    const wave = muted
      ? '<path d="M14 8 L19 13 M19 8 L14 13" stroke="#4a4740" stroke-width="1.8" stroke-linecap="round"/>'
      : '<path d="M14 7.5 Q17 10.5 14 13.5 M16.5 5 Q21.5 10.5 16.5 16" stroke="#4a4740" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
    this.mute.innerHTML = `<svg viewBox="0 0 22 21"><path d="M3 8 H6.5 L11 4 V17 L6.5 13 H3 Z" fill="#4a4740"/>${wave}</svg>`;
  }

  /** `speed` 0 means paused. */
  update(score: number, week: number, weekProgress: number, speed: number, sandbox: boolean): void {
    this.sandbox.hidden = !sandbox;
    if (score !== this.lastScore) {
      this.score.textContent = String(score);
      if (score > this.lastScore) {
        // Restart the bump animation on every point.
        this.score.classList.remove('bump');
        void this.score.offsetWidth;
        this.score.classList.add('bump');
      }
      this.lastScore = score;
    }
    this.weekLabel.textContent = `Week ${week}`;
    this.dial.style.strokeDashoffset = String(1 - Math.min(1, weekProgress));
    for (const [s, b] of this.buttons) b.classList.toggle('on', s === speed);
  }
}
