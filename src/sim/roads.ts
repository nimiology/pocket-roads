import { Grid, Terrain } from './grid';

export interface Inventory {
  roads: number;
  bridges: number;
  tunnels: number;
}

/** A maximal run of road tiles over water (bridge) or mountain (tunnel). */
export interface Span {
  kind: 'bridge' | 'tunnel';
  tiles: number[];
}

/**
 * Road graph on the tile grid. Nodes are tile indices; edges join 8-connected neighbours.
 * Land road tiles cost one road tile each. Each continuous run over water or mountain
 * costs one bridge or tunnel instead, and must be straight with no junctions.
 */
export class RoadNetwork {
  readonly adj = new Map<number, Set<number>>();
  /** Bumped on every change so renderers and pathfinding know to rebuild. */
  version = 0;

  constructor(
    readonly grid: Grid,
    readonly inventory: Inventory,
    /** Whether a road may occupy this tile (inside play area, not under a building). */
    public isBuildable: (x: number, y: number) => boolean = () => true,
  ) {}

  idx(x: number, y: number): number {
    return y * this.grid.w + x;
  }

  xy(i: number): [number, number] {
    return [i % this.grid.w, Math.floor(i / this.grid.w)];
  }

  hasTile(i: number): boolean {
    return this.adj.has(i);
  }

  hasEdge(a: number, b: number): boolean {
    return this.adj.get(a)?.has(b) ?? false;
  }

  neighbors(i: number): ReadonlySet<number> {
    return this.adj.get(i) ?? EMPTY;
  }

  /** Each undirected edge once, as [a, b] with a < b. */
  *edges(): Iterable<[number, number]> {
    for (const [a, ns] of this.adj) for (const b of ns) if (a < b) yield [a, b];
  }

  terrainAt(i: number): Terrain {
    const [x, y] = this.xy(i);
    return this.grid.get(x, y);
  }

  isSpanTile(i: number): boolean {
    return this.terrainAt(i) !== Terrain.Land;
  }

  used(): Inventory {
    let roads = 0;
    for (const i of this.adj.keys()) if (!this.isSpanTile(i)) roads++;
    const spans = this.spans();
    return {
      roads,
      bridges: spans.filter((s) => s.kind === 'bridge').length,
      tunnels: spans.filter((s) => s.kind === 'tunnel').length,
    };
  }

  available(): Inventory {
    const u = this.used();
    return {
      roads: this.inventory.roads - u.roads,
      bridges: this.inventory.bridges - u.bridges,
      tunnels: this.inventory.tunnels - u.tunnels,
    };
  }

  spans(): Span[] {
    const seen = new Set<number>();
    const out: Span[] = [];
    for (const start of this.adj.keys()) {
      if (seen.has(start) || !this.isSpanTile(start)) continue;
      const kind = this.terrainAt(start) === Terrain.Water ? 'bridge' : 'tunnel';
      const tiles: number[] = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const i = stack.pop()!;
        tiles.push(i);
        for (const n of this.neighbors(i)) {
          if (!seen.has(n) && this.terrainAt(n) === this.terrainAt(start)) {
            seen.add(n);
            stack.push(n);
          }
        }
      }
      out.push({ kind, tiles });
    }
    return out;
  }

  /** Place an unconnected road tile (start of a stroke). */
  placeTile(i: number): boolean {
    if (this.hasTile(i)) return true;
    // A stroke can't start in the middle of water or a mountain.
    if (!this.canOccupy(i) || this.isSpanTile(i)) return false;
    this.adj.set(i, new Set());
    if (this.available().roads < 0) {
      this.adj.delete(i);
      return false;
    }
    this.version++;
    return true;
  }

  /** Connect adjacent tiles a and b, placing b if needed. Returns false if not allowed. */
  connect(a: number, b: number): boolean {
    if (!this.hasTile(a) || a === b) return false;
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    const dx = bx - ax, dy = by - ay;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;
    if (this.hasEdge(a, b)) return true;
    const newTile = !this.hasTile(b);
    if (newTile && !this.canOccupy(b)) return false;
    // Diagonals may not cross another diagonal in the same 2x2 square.
    if (dx !== 0 && dy !== 0 && this.hasEdge(this.idx(ax + dx, ay), this.idx(ax, ay + dy))) return false;
    // A diagonal can't squeeze between two blocked corner tiles.
    if (dx !== 0 && dy !== 0 && !this.cornerPassable(ax, ay, dx, dy)) return false;

    if (newTile) this.adj.set(b, new Set());
    this.adj.get(a)!.add(b);
    this.adj.get(b)!.add(a);
    if (!this.spanShapeOk(a) || !this.spanShapeOk(b) || !this.withinInventory()) {
      this.adj.get(a)!.delete(b);
      this.adj.get(b)!.delete(a);
      if (newTile) this.adj.delete(b);
      return false;
    }
    this.version++;
    return true;
  }

  /** Remove a road tile. Removing part of a bridge or tunnel removes the whole span. */
  removeTile(i: number): void {
    if (!this.hasTile(i)) return;
    const targets = this.isSpanTile(i) ? this.spans().find((s) => s.tiles.includes(i))!.tiles : [i];
    for (const t of targets) {
      for (const n of this.neighbors(t)) this.adj.get(n)?.delete(t);
      this.adj.delete(t);
    }
    this.version++;
  }

  /**
   * Remove bridges and tunnels that don't reach land at both ends.
   * Called when a stroke finishes so half-built crossings give their tools back.
   */
  pruneDanglingSpans(): void {
    for (const span of this.spans()) {
      const landLinks = span.tiles.reduce(
        (n, t) => n + [...this.neighbors(t)].filter((nb) => !this.isSpanTile(nb)).length,
        0,
      );
      if (landLinks < 2) this.removeTile(span.tiles[0]);
    }
  }

  private canOccupy(i: number): boolean {
    const [x, y] = this.xy(i);
    return this.grid.contains(x, y) && this.isBuildable(x, y);
  }

  private cornerPassable(ax: number, ay: number, dx: number, dy: number): boolean {
    const c1 = this.grid.get(ax + dx, ay), c2 = this.grid.get(ax, ay + dy);
    const from = this.grid.get(ax, ay), to = this.grid.get(ax + dx, ay + dy);
    // On land, cutting between two mountain/water corners would clip the terrain.
    return !(from === Terrain.Land && to === Terrain.Land && c1 !== Terrain.Land && c2 !== Terrain.Land);
  }

  /** Bridge/tunnel tiles have at most two links, and those must be in a straight line. */
  private spanShapeOk(i: number): boolean {
    if (!this.isSpanTile(i)) return true;
    const ns = [...this.neighbors(i)];
    if (ns.length > 2) return false;
    if (ns.length < 2) return true;
    const [x, y] = this.xy(i);
    const [x1, y1] = this.xy(ns[0]), [x2, y2] = this.xy(ns[1]);
    return x1 - x === x - x2 && y1 - y === y - y2;
  }

  private withinInventory(): boolean {
    const a = this.available();
    return a.roads >= 0 && a.bridges >= 0 && a.tunnels >= 0;
  }
}

const EMPTY: ReadonlySet<number> = new Set();
