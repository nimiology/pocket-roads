import { Inventory } from '../sim/roads';

// One set on a 24px grid: soft rounded shapes, the game's own colours, no outlines.
export const ICONS: Record<keyof Inventory, string> = {
  roads: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5" fill="#5d6169"/><rect x="11" y="6" width="2" height="4" rx="1" fill="#f2ede0"/><rect x="11" y="14" width="2" height="4" rx="1" fill="#f2ede0"/></svg>`,
  bridges: `<svg viewBox="0 0 24 24"><rect x="2" y="15" width="20" height="6" rx="3" fill="#7db6dc"/><path d="M3 12 Q12 5 21 12 L21 14 L3 14 Z" fill="#8a8f97"/><rect x="2" y="11" width="20" height="3.2" rx="1.6" fill="#5d6169"/><rect x="6" y="14" width="2" height="4" fill="#8a8f97"/><rect x="16" y="14" width="2" height="4" fill="#8a8f97"/></svg>`,
  tunnels: `<svg viewBox="0 0 24 24"><path d="M2 20 C5 9 8 5 12 5 C16 5 19 9 22 20 Z" fill="#cdbf9c"/><path d="M6 20 C8 12 10 9 12 9 C14 9 16 12 18 20 Z" fill="#e6dcc0"/><path d="M8.5 20 a3.5 3.5 0 0 1 7 0 Z" fill="#3b3a38"/></svg>`,
  roundabouts: `<svg viewBox="0 0 24 24"><rect x="10" y="1" width="4" height="22" rx="2" fill="#5d6169"/><rect x="1" y="10" width="22" height="4" rx="2" fill="#5d6169"/><circle cx="12" cy="12" r="8" fill="#5d6169"/><circle cx="12" cy="12" r="4" fill="#9ccf86"/></svg>`,
  lights: `<svg viewBox="0 0 24 24"><rect x="11" y="16" width="2" height="7" rx="1" fill="#5d6169"/><rect x="7" y="1" width="10" height="17" rx="4" fill="#3d3a35"/><circle cx="12" cy="5.5" r="2.2" fill="#e5483a"/><circle cx="12" cy="9.5" r="2.2" fill="#f2b230" opacity="0.45"/><circle cx="12" cy="13.5" r="2.2" fill="#3db58a" opacity="0.45"/></svg>`,
  motorways: `<svg viewBox="0 0 24 24"><rect x="5" y="12" width="2.4" height="9" rx="1" fill="#c9c2b2"/><rect x="16.6" y="12" width="2.4" height="9" rx="1" fill="#c9c2b2"/><rect x="1" y="7" width="22" height="6" rx="3" fill="#878c95"/><rect x="4" y="9.4" width="4" height="1.2" rx="0.6" fill="#fbfaf6"/><rect x="10" y="9.4" width="4" height="1.2" rx="0.6" fill="#fbfaf6"/><rect x="16" y="9.4" width="4" height="1.2" rx="0.6" fill="#fbfaf6"/></svg>`,
};

/** Tools picked from the toolbar; everything else is passive inventory. */
export type ToolKind = 'road' | 'roundabouts' | 'lights' | 'motorways';

const PICKABLE: ToolKind[] = ['roundabouts', 'lights', 'motorways'];
const LABELS: Record<keyof Inventory, string> = {
  roads: 'Road tiles', bridges: 'Bridges', tunnels: 'Tunnels',
  roundabouts: 'Roundabout (click a junction)', lights: 'Traffic light (click a junction)', motorways: 'Motorway (drag between two roads)',
};

/**
 * Bottom-centre inventory. Roads, bridges and tunnels are passive counts; junction tools and
 * motorways appear once owned and are clicked to select them (Esc goes back to roads).
 */
export class Toolbar {
  private el: HTMLDivElement;
  private items = {} as Record<keyof Inventory, HTMLDivElement>;
  selected: ToolKind = 'road';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'toolbar';
    for (const key of Object.keys(ICONS) as (keyof Inventory)[]) {
      const item = document.createElement('div');
      item.className = 'tool';
      item.title = LABELS[key];
      item.innerHTML = `${ICONS[key]}<span></span>`;
      if ((PICKABLE as string[]).includes(key)) {
        item.classList.add('pickable');
        item.addEventListener('click', () => this.select(this.selected === key ? 'road' : (key as ToolKind)));
      }
      this.el.appendChild(item);
      this.items[key] = item;
    }
    parent.appendChild(this.el);
  }

  select(tool: ToolKind): void {
    this.selected = tool;
    for (const key of PICKABLE) this.items[key as keyof Inventory].classList.toggle('selected', key === tool);
    document.body.classList.toggle('placing', tool !== 'road');
  }

  update(available: Inventory, owned: Inventory): void {
    for (const key of Object.keys(this.items) as (keyof Inventory)[]) {
      const item = this.items[key];
      item.querySelector('span')!.textContent = String(available[key]);
      item.classList.toggle('empty', available[key] <= 0);
      // Special tools only show up once the player has been given one.
      item.hidden = (PICKABLE as string[]).includes(key) && owned[key] <= 0;
    }
    if (this.selected !== 'road' && available[this.selected as keyof Inventory] <= 0) this.select('road');
  }
}
