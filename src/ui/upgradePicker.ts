import { Upgrade } from '../sim/game';
import { Inventory } from '../sim/roads';
import { ICONS } from './toolbar';

const NAMES: Record<keyof Inventory, string> = { roads: 'Roads', bridges: 'Bridge', tunnels: 'Tunnel' };

/** Week's-end card: one free road gift, then a choice between two packages. */
export class UpgradePicker {
  private el: HTMLDivElement;
  private choices: HTMLDivElement;
  private title: HTMLDivElement;

  constructor(parent: HTMLElement, private onPick: (i: number) => void) {
    this.el = document.createElement('div');
    this.el.className = 'upgrades';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="card"><div class="label"></div><div class="sub">Choose an upgrade</div><div class="choices"></div></div>`;
    this.title = this.el.querySelector('.label')!;
    this.choices = this.el.querySelector('.choices')!;
    parent.appendChild(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(week: number, gift: number, options: Upgrade[]): void {
    this.title.textContent = `Week ${week} complete · +${gift} roads`;
    this.choices.innerHTML = '';
    options.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      // Special tool first and large; bundled roads underneath.
      const keys = (Object.keys(u) as (keyof Inventory)[]).sort((a) => (a === 'roads' ? 1 : -1));
      b.innerHTML = keys.map((k, j) =>
        `<div class="${j === 0 ? 'main' : 'extra'}">${ICONS[k]}<span>${k !== 'roads' ? NAMES[k] : j === 0 ? `+${u[k]} roads` : `+${u[k]}`}</span></div>`,
      ).join('');
      b.title = `${i + 1}`;
      b.addEventListener('click', () => this.pick(i));
      this.choices.appendChild(b);
    });
    this.el.hidden = false;
  }

  pick(i: number): void {
    if (!this.visible || i >= this.choices.children.length) return;
    this.el.hidden = true;
    this.onPick(i);
  }

  hide(): void {
    this.el.hidden = true;
  }
}
