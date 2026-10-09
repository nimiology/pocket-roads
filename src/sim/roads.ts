import { Grid, Terrain } from './grid';

export interface Inventory {
  roads: number;
  bridges: number;
  tunnels: number;
  roundabouts: number;
  lights: number;
  motorways: number;
}

export type Special = 'roundabout' | 'light';

/**
 * A raised straight link between two road tiles; cars join and leave only at its ends.
 * It may pass over roads and water, but not mountains or buildings.
 */
export interface Motorway {
  a: number;
  b: number;
  /** Removed by the player; kept until the cars on it have cleared, but no longer routed onto. */
  closing: boolean;
}

/** Motorways must span at least this many tiles (Chebyshev distance). */
export const MOTORWAY_MIN = 3;

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
  /** Roundabouts and traffic lights by junction tile. `closing` ones wait for traffic to clear. */
  readonly specials = new Map<number, { kind: Special; closing: boolean }>();
  readonly motorways: Motorway[] = [];
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
    const specials = [...this.specials.values()];
    return {
      roads,
      bridges: spans.filter((s) => s.kind === 'bridge').length,
      tunnels: spans.filter((s) => s.kind === 'tunnel').length,
      roundabouts: specials.filter((s) => s.kind === 'roundabout').length,
      lights: specials.filter((s) => s.kind === 'light').length,
      motorways: this.motorways.length,
    };
  }

  available(): Inventory {
    const u = this.used();
    const out = { ...this.inventory };
    for (const k of Object.keys(out) as (keyof Inventory)[]) out[k] -= u[k];
    return out;
  }

  /** Active special on tile i (closing ones behave like a plain junction). */
  specialAt(i: number): Special | null {
    const s = this.specials.get(i);
    return s && !s.closing ? s.kind : null;
  }

  /** Road links plus active motorway ends at tile i: what a junction tool sits on. */
  linkCount(i: number): number {
    return this.neighbors(i).size + this.motorways.filter((m) => !m.closing && (m.a === i || m.b === i)).length;
  }

  canPlaceSpecial(i: number, kind: Special): boolean {
    const key = kind === 'roundabout' ? 'roundabouts' : 'lights';
    if (!this.hasTile(i) || this.isSpanTile(i) || this.specials.has(i) || this.linkCount(i) < 3 || this.available()[key] <= 0) return false;
    // Roundabouts need room: on neighbouring tiles their rings would overlap, and the one-tile road
    // between them is too short for a car to fully leave one before waiting at the next.
    if (kind === 'roundabout') {
      const [x, y] = this.xy(i);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && this.grid.contains(x + dx, y + dy) && this.specials.get(this.idx(x + dx, y + dy))?.kind === 'roundabout') return false;
      }
    }
    return true;
  }

  placeSpecial(i: number, kind: Special): boolean {
    if (!this.canPlaceSpecial(i, kind)) return false;
    this.specials.set(i, { kind, closing: false });
    this.version++;
    return true;
  }

  /** Stop using the special at i; it returns to inventory once `finishClosing` sees it clear. */
  closeSpecial(i: number): boolean {
    const s = this.specials.get(i);
    if (!s || s.closing) return false;
    s.closing = true;
    this.version++;
    return true;
  }

  /** Why a motorway from a to b can't be built, or null if it can. */
  motorwayProblem(a: number, b: number): string | null {
    if (!this.hasTile(a) || !this.hasTile(b) || this.isSpanTile(a) || this.isSpanTile(b)) return 'ends must be road tiles';
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    if (Math.max(Math.abs(bx - ax), Math.abs(by - ay)) < MOTORWAY_MIN) return 'too short';
    if (this.available().motorways <= 0) return 'no motorways left';
    if (this.motorways.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a))) return 'already linked';
    for (const t of this.tilesUnder(a, b)) {
      if (this.terrainAt(t) === Terrain.Mountain) return 'crosses a mountain';
      if (!this.canOccupy(t)) return 'blocked by a building';
    }
    return null;
  }

  placeMotorway(a: number, b: number): boolean {
    if (this.motorwayProblem(a, b)) return false;
    this.motorways.push({ a, b, closing: false });
    this.version++;
    return true;
  }

  closeMotorway(m: Motorway): void {
    if (m.closing) return;
    m.closing = true;
    this.version++;
  }

  /** Tiles a straight line between the centres of a and b passes over. */
  tilesUnder(a: number, b: number): number[] {
    const [ax, ay] = this.xy(a), [bx, by] = this.xy(b);
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 8);
    const out = new Set<number>();
    for (let k = 0; k <= n; k++) {
      const x = Math.floor(ax + 0.5 + ((bx - ax) * k) / n), y = Math.floor(ay + 0.5 + ((by - ay) * k) / n);
      out.add(this.idx(x, y));
    }
    return [...out];
  }

  /** Motorway whose deck passes within `r` of world point (px, py), if any. */
  motorwayNear(px: number, py: number, r = 0.4): Motorway | undefined {
    return this.motorways.find((m) => {
      const [ax, ay] = this.xy(m.a), [bx, by] = this.xy(m.b);
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax - 0.5) * dx + (py - ay - 0.5) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(ax + 0.5 + dx * t - px, ay + 0.5 + dy * t - py) < r;
    });
  }

  /** Drop closed tools that `isBusy` says no car is using any more, refunding them. */
  finishClosing(isBusy: (tool: { node: number } | { motorway: Motorway }) => boolean): void {
    let changed = false;
    for (const [i, s] of this.specials) {
      if (s.closing && !isBusy({ node: i })) {
        this.specials.delete(i);
        changed = true;
      }
    }
    for (let k = this.motorways.length - 1; k >= 0; k--) {
      const m = this.motorways[k];
      if (m.closing && !isBusy({ motorway: m })) {
        this.motorways.splice(k, 1);
        changed = true;
      }
    }
    if (changed) this.version++;
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
      // Tools standing on the tile go with it.
      this.specials.delete(t);
      for (let k = this.motorways.length - 1; k >= 0; k--) {
        if (this.motorways[k].a === t || this.motorways[k].b === t) this.motorways.splice(k, 1);
      }
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
    return Object.values(a).every((v) => v >= 0);
  }
}

const EMPTY: ReadonlySet<number> = new Set();
