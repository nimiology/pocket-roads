import { describe, expect, it } from 'vitest';
import { Game } from '../sim/game';
import { generateMap } from '../sim/mapgen';
import { CarPose, carPose } from './cars';

/**
 * Whether two cars' bodies overlap: separating-axis test on boxes slightly inside the 0.4 × 0.2
 * footprint, so bumpers kissing in a queue doesn't count but driving through each other does.
 */
function carsOverlap(a: CarPose, b: CarPose): boolean {
  const corners = (p: CarPose) => {
    const c = Math.cos(p.heading), s = Math.sin(p.heading), hl = 0.16, hw = 0.09;
    return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([u, v]) => [p.x + c * u - s * v, p.z + s * u + c * v]);
  };
  const ca = corners(a), cb = corners(b);
  for (const p of [a, b]) {
    for (const ang of [p.heading, p.heading + Math.PI / 2]) {
      const ax = [Math.cos(ang), Math.sin(ang)];
      const proj = (cs: number[][]) => cs.map(([x, z]) => x * ax[0] + z * ax[1]);
      const pa = proj(ca), pb = proj(cb);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  }
  return true;
}

describe('car animation', () => {
  it('drives through a roundabout smoothly for every movement', () => {
    const w = 10, at = (x: number, y: number) => y * w + x;
    const center = at(5, 5);
    const arms = [at(6, 5), at(4, 5), at(5, 4), at(5, 6)];
    for (const from of arms) {
      for (const to of arms) {
        if (from === to) continue;
        const back = at(5 + 2 * Math.sign((from % w) - 5), 5 + 2 * Math.sign(Math.floor(from / w) - 5));
        const path = [back, from, center, to];
        let prev: ReturnType<typeof carPose> | null = null;
        for (let seg = 0; seg < 3; seg++) {
          for (let t = 0; t < 1; t += 0.01) {
            const p = carPose({ state: 'toDest', path, seg, t } as never, w, (i) => i === center);
            if (prev) {
              expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(0.05);
              const dh = Math.abs(Math.atan2(Math.sin(p.heading - prev.heading), Math.cos(p.heading - prev.heading)));
              expect(dh).toBeLessThan(0.25); // no sudden swings
            }
            prev = p;
          }
        }
      }
    }
  });

  it('never draws two cars on top of each other inside a roundabout', () => {
    const game = new Game(generateMap(7));
    game.sandbox = true;
    Object.assign(game.net.inventory, { roads: 600, roundabouts: 99 });
    const w = game.map.grid.w;
    const road = (from: number, to: number) => {
      const n = game.net, prev = new Map([[from, from]]), q = [from];
      while (q.length) {
        const c = q.shift()!;
        if (c === to) break;
        const x = c % w, y = Math.floor(c / w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = ny * w + nx;
          if (!n.isBuildable(nx, ny) || prev.has(k) || n.isSpanTile(k)) continue;
          prev.set(k, c);
          q.push(k);
        }
      }
      if (!prev.has(to)) return;
      const p = [to];
      while (p[0] !== from) p.unshift(prev.get(p[0])!);
      n.placeTile(p[0]);
      for (let i = 1; i < p.length; i++) n.connect(p[i - 1], p[i]);
    };
    const isRb = (i: number) => game.net.specialAt(i) === 'roundabout';
    let overlaps = 0, checks = 0;
    for (let step = 0; step < 60 * 300; step++) {
      if (step % 30 === 0) {
        for (const h of game.buildings.houses) {
          const d = game.buildings.dests.find((d) => d.color === h.color);
          if (d && !game.net.hasTile(h.access)) road(h.access, d.access);
        }
        for (const i of [...game.net.adj.keys()]) game.net.placeSpecial(i, 'roundabout');
        // Keep demand high so roundabouts are busy.
        for (const d of game.buildings.dests) d.pins = Math.max(d.pins, 8);
      }
      if (game.upgrades) game.chooseUpgrade(0);
      game.update(1 / 60);
      if (step % 6) continue;
      // Every car drawn near a roundabout: on the ring, merging, or queued at its edge.
      const rbs = [...game.net.specials].filter(([, sp]) => sp.kind === 'roundabout' && !sp.closing).map(([i]) => i);
      const byRb = new Map<number, CarPose[]>();
      for (const c of game.cars) {
        if (c.state === 'parked') continue;
        const p = carPose(c, w, isRb);
        // On the ring or its merge curves, or queued at its entry (stop line is 0.82 back).
        const a = c.path[c.seg], b = c.path[c.seg + 1];
        const len = game.graph.length(a, b);
        const node = isRb(b) && c.t > len - 0.9 && c.seg + 2 < c.path.length ? b : isRb(a) && c.t < 0.64 && c.seg > 0 ? a : -1;
        if (node >= 0 && rbs.includes(node)) byRb.set(node, [...(byRb.get(node) ?? []), p]);
      }
      for (const ps of byRb.values()) {
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
          if (carsOverlap(ps[i], ps[j])) overlaps++;
          checks++;
        }
      }
    }
    expect(game.net.specials.size).toBeGreaterThanOrEqual(3);
    expect(checks).toBeGreaterThan(20);
    expect(overlaps).toBe(0);
  });
});
