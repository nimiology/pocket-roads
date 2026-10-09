import { Buildings } from './buildings';
import { RoadNetwork } from './roads';

/**
 * Driving graph: road edges plus driveways joining each building's endpoint
 * (house tile or destination door) to its access tile when a road is there.
 * Building endpoints have only their driveway, so routes can't pass through them.
 */
export class DriveGraph {
  constructor(private net: RoadNetwork, private buildings: Buildings) {}

  neighbors(i: number): number[] {
    const out: number[] = [];
    const b = this.buildings.byEndpoint.get(i);
    if (b) {
      if (this.net.hasTile(b.access)) out.push(b.access);
      return out;
    }
    for (const n of this.net.neighbors(i)) out.push(n);
    if (this.net.hasTile(i)) for (const bb of this.buildings.byAccess.get(i) ?? []) out.push(this.buildings.endpoint(bb));
    return out;
  }

  hasEdge(a: number, b: number): boolean {
    return this.neighbors(a).includes(b);
  }

  cost(a: number, b: number): number {
    const w = this.net.grid.w;
    return (a % w !== b % w && Math.floor(a / w) !== Math.floor(b / w)) ? Math.SQRT2 : 1;
  }

  heuristic(a: number, b: number): number {
    const w = this.net.grid.w;
    const dx = Math.abs((a % w) - (b % w)), dy = Math.abs(Math.floor(a / w) - Math.floor(b / w));
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  }

  /** A* shortest path from `from` to `to`, inclusive of both, or null if unreachable. */
  path(from: number, to: number): number[] | null {
    if (from === to) return [from];
    const g = new Map<number, number>([[from, 0]]);
    const prev = new Map<number, number>();
    const open = new MinHeap();
    open.push(from, this.heuristic(from, to));
    const closed = new Set<number>();
    while (open.size) {
      const cur = open.pop();
      if (cur === to) return rebuild(prev, from, to);
      if (closed.has(cur)) continue;
      closed.add(cur);
      for (const n of this.neighbors(cur)) {
        if (closed.has(n)) continue;
        const ng = g.get(cur)! + this.cost(cur, n);
        if (ng < (g.get(n) ?? Infinity)) {
          g.set(n, ng);
          prev.set(n, cur);
          open.push(n, ng + this.heuristic(n, to));
        }
      }
    }
    return null;
  }

  /**
   * Dijkstra outward from `source`, calling `visit` for each node in distance order.
   * `pathTo(node)` gives the route from `source` to that node. Stop by returning true.
   */
  explore(source: number, visit: (node: number, dist: number, pathTo: () => number[]) => boolean): void {
    const g = new Map<number, number>([[source, 0]]);
    const prev = new Map<number, number>();
    const open = new MinHeap();
    open.push(source, 0);
    const closed = new Set<number>();
    while (open.size) {
      const cur = open.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (visit(cur, g.get(cur)!, () => rebuild(prev, source, cur))) return;
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

function rebuild(prev: Map<number, number>, from: number, to: number): number[] {
  const out = [to];
  let c = to;
  while (c !== from) {
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
