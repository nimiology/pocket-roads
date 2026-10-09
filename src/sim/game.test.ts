import { describe, expect, it } from 'vitest';
import { HOUSE_CARS } from './buildings';
import { Game } from './game';
import { Grid } from './grid';
import { MapData } from './mapgen';

function flatMap(seed = 1): MapData {
  return { seed, grid: new Grid(30, 20), stages: [{ x0: 0, y0: 0, x1: 30, y1: 20 }] };
}

/** Lay a road between two tiles along a 4-connected path that avoids buildings. */
function connect(game: Game, from: number, to: number) {
  const { grid } = game.map;
  const prev = new Map<number, number>([[from, from]]);
  const queue = [from];
  while (queue.length) {
    const c = queue.shift()!;
    if (c === to) break;
    const x = c % grid.w, y = Math.floor(c / grid.w);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, n = ny * grid.w + nx;
      if (!grid.contains(nx, ny) || prev.has(n) || game.buildings.isOccupied(n)) continue;
      prev.set(n, c);
      queue.push(n);
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  game.net.placeTile(path[0]);
  for (let k = 1; k < path.length; k++) expect(game.net.connect(path[k - 1], path[k])).toBe(true);
}

function checkInvariants(game: Game) {
  for (const h of game.buildings.houses) {
    const out = game.cars.filter((c) => c.house === h).length;
    expect(h.idleCars + out).toBe(HOUSE_CARS);
  }
  for (const d of game.buildings.dests) {
    const coming = game.cars.filter((c) => c.dest === d && c.state !== 'toHome').length;
    expect(d.assigned).toBe(coming);
  }
}

function run(game: Game, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    game.update(1 / 30);
    each?.();
  }
}

describe('Game', () => {
  it('starts with one destination and two houses of the first color', () => {
    const game = new Game(flatMap());
    expect(game.buildings.dests).toHaveLength(1);
    expect(game.buildings.houses).toHaveLength(2);
    expect(game.buildings.houses.every((h) => h.color === 0)).toBe(true);
  });

  it('delivers pins once houses are connected to their destination', () => {
    const game = new Game(flatMap());
    game.net.inventory.roads = 500;
    const d = game.buildings.dests[0];
    for (const h of game.buildings.houses) connect(game, h.access, d.access);
    run(game, 60, () => checkInvariants(game));
    expect(game.score).toBeGreaterThan(3);
  });

  it('sends cars home when their road is removed mid-trip', () => {
    const game = new Game(flatMap(3));
    game.net.inventory.roads = 500;
    const d = game.buildings.dests[0];
    const h = game.buildings.houses[0];
    connect(game, h.access, d.access);
    run(game, 25);
    expect(game.cars.length).toBeGreaterThan(0);
    for (const t of [...game.net.adj.keys()]) game.net.removeTile(t);
    run(game, 1, () => checkInvariants(game));
    expect(game.cars).toHaveLength(0);
    expect(d.assigned).toBe(0);
  });

  it('spawns more houses and new colors over time', () => {
    const game = new Game(flatMap(5));
    run(game, 240);
    expect(game.buildings.houses.length).toBeGreaterThan(10);
    expect(game.colorsInPlay).toBeGreaterThan(1);
  });
});
