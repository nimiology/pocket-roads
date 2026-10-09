import { describe, expect, it } from 'vitest';
import { CONFIG, Game } from './game';
import { generateMap } from './mapgen';

/** Auto-builds roads from every house to a same-color destination, like a lazy player. */
function autoConnect(game: Game) {
  const n = game.net, w = game.map.grid.w;
  const road = (from: number, to: number) => {
    const prev = new Map([[from, from]]);
    const q = [from];
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
  for (const h of game.buildings.houses) {
    const d = game.buildings.dests.find((d) => d.color === h.color);
    if (d && !n.hasTile(h.access)) road(h.access, d.access);
  }
}

describe('Traffic', () => {
  it('keeps flowing under heavy demand with adjacent junctions (no permanent gridlock)', () => {
    const game = new Game(generateMap(7));
    game.net.inventory.roads = 400;
    game.sandbox = true;
    let jumped = false;
    const scoreAtMinute: number[] = [];
    for (let step = 0; step < 60 * 600; step++) {
      if (step % 30 === 0) autoConnect(game);
      // Once the city has grown, fast-forward the clock to crank up pin demand.
      if (!jumped && game.time > 220) {
        game.time = 2400;
        game.week = Math.floor(game.time / CONFIG.weekSeconds);
        jumped = true;
      }
      if (game.upgrades) game.chooseUpgrade(0);
      game.update(1 / 60);
      if (step % 3600 === 0) scoreAtMinute.push(game.score);
    }
    // Pins keep being delivered every minute of the heavy phase.
    const heavy = scoreAtMinute.slice(5);
    for (let i = 1; i < heavy.length; i++) expect(heavy[i]).toBeGreaterThan(heavy[i - 1]);
  });

  it('never strands cars at traffic lights or roundabouts, even on adjacent junctions', () => {
    for (const kind of ['light', 'roundabout'] as const) {
      const game = new Game(generateMap(7));
      game.sandbox = true;
      Object.assign(game.net.inventory, { roads: 600, lights: 99, roundabouts: 99 });
      let lastMinute = 0;
      for (let step = 0; step < 60 * 420; step++) {
        if (step % 30 === 0) {
          autoConnect(game);
          for (const i of [...game.net.adj.keys()]) game.net.placeSpecial(i, kind);
        }
        if (game.upgrades) game.chooseUpgrade(0);
        if (step === 60 * 360) lastMinute = game.score;
        game.update(1 / 60);
      }
      expect(game.net.specials.size).toBeGreaterThan(5);
      expect(game.cars.filter((c) => c.waitingSince < game.time - 20)).toHaveLength(0);
      expect(game.score - lastMinute).toBeGreaterThan(20);
    }
  });
});

