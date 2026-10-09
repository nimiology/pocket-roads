const BEST_KEY = 'pocket-roads.best';

/** Best score kept in this browser; `record` returns true when it's a new best. */
export const highScore = {
  get(): number {
    try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
  },
  record(score: number): boolean {
    if (score <= this.get()) return false;
    try { localStorage.setItem(BEST_KEY, String(score)); } catch { /* ignore */ }
    return true;
  },
};

export interface MenuActions {
  play(): void;
  newCity(): void;
  tutorial(): void;
  toggleSound(): boolean;
}

/** Title screen over the live map: play, new city, best score, sound, how to play. */
export class Menu {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement, actions: MenuActions, muted: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.innerHTML = `<div class="panel">
      <img class="logo" src="${import.meta.env.BASE_URL}logo.svg" alt="" width="64" height="64">
      <h1>Pocket<br>Roads</h1>
      <p class="tag">Draw roads. Keep the city moving.</p>
      <button class="primary" data-act="play">Play</button>
      <div class="row">
        <button data-act="new">New city</button>
        <button data-act="tutorial">How to play</button>
      </div>
      <div class="foot"><span class="best"></span><button class="sound" data-act="sound"></button></div>
    </div>`;
    const on = (act: string, fn: () => void) => this.el.querySelector(`[data-act="${act}"]`)!.addEventListener('click', fn);
    on('play', () => actions.play());
    on('new', () => actions.newCity());
    on('tutorial', () => actions.tutorial());
    on('sound', () => this.setSound(actions.toggleSound()));
    this.setSound(muted);
    parent.appendChild(this.el);
    this.show();
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  private setSound(muted: boolean) {
    this.el.querySelector('.sound')!.textContent = muted ? 'Sound off' : 'Sound on';
  }

  refresh(): void {
    const best = highScore.get();
    this.el.querySelector('.best')!.textContent = best ? `Best ${best}` : 'No best yet';
  }

  show(): void {
    this.refresh();
    this.el.hidden = false;
    document.body.classList.add('in-menu');
  }

  hide(): void {
    this.el.hidden = true;
    document.body.classList.remove('in-menu');
  }
}
