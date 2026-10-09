import { Inventory } from '../sim/roads';

export const ICONS: Record<keyof Inventory, string> = {
  roads: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="#5b5f66"/></svg>`,
  bridges: `<svg viewBox="0 0 24 24"><rect x="2" y="13" width="20" height="5" rx="1.5" fill="#8cc3e2"/><rect x="2" y="9" width="20" height="4" rx="1" fill="#5b5f66"/><rect x="2" y="7" width="20" height="1.6" fill="#44474d"/></svg>`,
  tunnels: `<svg viewBox="0 0 24 24"><path d="M2 20 L12 4 L22 20 Z" fill="#c8bb9c"/><path d="M8 20 a4 4 0 0 1 8 0 Z" fill="#3b3a38"/></svg>`,
};

/** Bottom-centre inventory: remaining road tiles, bridges and tunnels. */
export class Toolbar {
  private el: HTMLDivElement;
  private items = {} as Record<keyof Inventory, HTMLDivElement>;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toolbar';
    for (const key of Object.keys(ICONS) as (keyof Inventory)[]) {
      const item = document.createElement('div');
      item.className = 'tool';
      item.title = key;
      item.innerHTML = `${ICONS[key]}<span></span>`;
      this.el.appendChild(item);
      this.items[key] = item;
    }
    parent.appendChild(this.el);
  }

  update(available: Inventory): void {
    for (const key of Object.keys(this.items) as (keyof Inventory)[]) {
      const item = this.items[key];
      item.querySelector('span')!.textContent = String(available[key]);
      item.classList.toggle('empty', available[key] <= 0);
    }
  }
}
