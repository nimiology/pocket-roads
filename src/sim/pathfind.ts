import { Buildings } from './buildings';
import { Motorway, RoadNetwork } from './roads';

/** Route-planning cost per tile of motorway, relative to a normal road. */
export const MOTORWAY_COST = 0.55;

/**
 * Driving graph: road edges plus driveways joining each building's endpoint
 * (house tile or destination door) to its access tile when a road is there.
 * Building endpoints have only their driveway, so routes can't pass through them.
 * Open motorways add a long edge between their two ends.
 */
export class DriveGraph {
  constructor(private net: RoadNetwork, private buildings: Buildings) {}

  /** Motorway linking a and b (open or closing), if any. */
  motorway(a: number, b: number): Motorway | undefined {
    return this.net.motorways.find((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
  }

  neighbors(i: number): number[] {
    const out: number[] = [];
    const b = this.buildings.byEndpoint.get(i);
    if (b) {
      if (b.kind === 'house') {
        if (this.net.hasTile(b.access)) out.push(b.access);
      } else {
        for (const e of b.entrances) if (e.door === i && this.net.hasTile(e.access)) out.push(e.access);
      }
      return out;
    }
    for (const n of this.net.neighbors(i)) out.push(n);
    for (const m of this.net.motorways) {
      if (m.closing) continue;
      if (m.a === i) out.push(m.b);
      else if (m.b === i) out.push(m.a);
    }
    if (this.net.hasTile(i)) {
      for (const bb of this.buildings.byAccess.get(i) ?? []) {
        if (bb.kind === 'house') out.push(bb.tile);
        else for (const e of bb.entrances) if (e.access === i) out.push(e.door);
      }
    }
    return out;
  }

  hasEdge(a: number, b: number): boolean {
    return this.neighbors(a).includes(b);
  }

  /** Whether a car already on lane a→b may keep driving it (closing motorways still count). */
  hasLane(a: number, b: number): boolean {
    return this.hasEdge(a, b) || !!this.motorway(a, b);
  }

  /** Driving distance from a to b in tiles. */
  length(a: number, b: number): number {
    const w = this.net.grid.w;
    return Math.hypot((a % w) - (b % w), Math.floor(a / w) - Math.floor(b / w));
  }

  /** Route-planning cost: distance, discounted on motorways. */
  cost(a: number, b: number): number {
    const len = this.length(a, b);
    return len > 1.5 ? len * MOTORWAY_COST : len;
  }

  heuristic(a: number, b: number): number {
    // Admissible with motorways: straight-line distance at motorway rates.
    return this.length(a, b) * MOTORWAY_COST;
  }

  /** A* shortest path from `from` to `to` (or the nearest of several targets), inclusive, or null. */
  path(from: number, to: number | number[]): number[] | null {
    const targets = typeof to === 'number' ? [to] : to;
    if (targets.includes(from)) return [from];
    const h = (n: number) => Math.min(...targets.map((t) => this.heuristic(n, t)));
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open = new MinHeap();
    open.push(from, h(from));
    const closed = new Set<number>();
    while (open.size) {
      const cur = open.pop();
      if (targets.includes(cur)) return rebuild(prev, cur);
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const n of this.neighbors(cur)) {
        if (closed.has(n)) continue;
        const ng = g.get(cur)! + this.cost(cur, n);
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          prev.set(n, cur);
          open.push(n, ng + h(n));
        }
      }
    }
    return null;
  }

  /**
   * Dijkstra outward from `source`, calling `visit` for each node in distance order.
   * `pathTo(node)` gives the route from `source` to that node. Stop by returning true.
   */
  explore(source: number | number[], visit: (node: number, dist: number, pathTo: () => number[]) => boolean): void {
    const sources = typeof source === 'number' ? [source] : source;
    const g = new Map<number, number>(sources.map((s) => [s, 0]));
    const prev = new Map<number, number>();
    const open = new MinHeap();
    for (const s of sources) open.push(s, 0);
    const closed = new Set<number>();
    while (open.size) {
      const cur = open.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (visit(cur, g.get(cur)!, () => rebuild(prev, cur))) return;
      for (const n of this.neighbors(cur)) {
        if (closed.has(n)) continue;
        const ng = g.get(cur)! + this.cost(cur, n);
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          prev.set(n, cur);
          open.push(n, ng);
        }
      }
    }
  }
}

/** Walk `prev` links back from `to` to the search's start (where links run out). */
function rebuild(prev: Map<number, number>, to: number, _from?: number): number[] {
  const out = [to];
  let c = to;
  while (prev.has(c)) {
    c = prev.get(c)!;
    out.push(c);
  }
  return out.reverse();
}

class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!, lastKey = this.keys.pop()!;
    if (this.items.length) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
