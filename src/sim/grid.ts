export const Terrain = { Land: 0, Water: 1, Mountain: 2 } as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

/** Half-open tile rectangle: x0 <= x < x1, y0 <= y < y1. */
export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const boundsWidth = (b: Bounds) => b.x1 - b.x0;
export const boundsHeight = (b: Bounds) => b.y1 - b.y0;
export const inBounds = (b: Bounds, x: number, y: number) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;

export class Grid {
  readonly terrain: Uint8Array;

  constructor(readonly w: number, readonly h: number) {
    this.terrain = new Uint8Array(w * h);
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Terrain {
    return this.terrain[y * this.w + x] as Terrain;
  }

  set(x: number, y: number, t: Terrain): void {
    this.terrain[y * this.w + x] = t;
  }

  count(t: Terrain, b: Bounds): number {
    let n = 0;
    for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (this.get(x, y) === t) n++;
    return n;
  }
}
