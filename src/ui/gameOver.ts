/** End-of-game card: final score, time survived, and ways to play again. */
export class GameOverScreen {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement, onRetry: () => void, onNewMap: () => void, onMenu: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'game-over';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="card">
      <div class="label">Game over</div>
      <div class="score"></div>
      <div class="sub"></div>
      <div class="best-badge" hidden>New best!</div>
      <div class="actions"><button data-act="retry">Retry map</button><button data-act="new">New map</button><button data-act="menu">Menu</button></div>
    </div>`;
    this.el.querySelector('[data-act="retry"]')!.addEventListener('click', onRetry);
    this.el.querySelector('[data-act="new"]')!.addEventListener('click', onNewMap);
    this.el.querySelector('[data-act="menu"]')!.addEventListener('click', onMenu);
    parent.appendChild(this.el);
  }

  show(score: number, seconds: number, newBest = false, best = 0): void {
    (this.el.querySelector('.best-badge') as HTMLElement).hidden = !newBest;
    const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60).toString().padStart(2, '0');
    this.el.querySelector('.score')!.textContent = String(score);
    this.el.querySelector('.sub')!.textContent = `${score === 1 ? 'trip' : 'trips'} · lasted ${m}:${s}${!newBest && best ? ` · best ${best}` : ''}`;
    this.el.hidden = false;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
