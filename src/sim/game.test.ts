import { describe, expect, it } from 'vitest';
import { CAPACITY, DIRS4, HOUSE_CARS } from './buildings';
import { CONFIG, Game } from './game';
import { Grid } from './grid';
import { MapData, generateMap } from './mapgen';
import { MIN_GAP, approachAxis } from './traffic';

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

/** Advance the sim; `pick` takes the first upgrade whenever a week ends. */
function run(game: Game, seconds: number, each?: () => void, pick = true) {
  for (let t = 0; t < seconds; t += 1 / 30) {
    if (pick && game.upgrades) game.chooseUpgrade(0);
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

  it('ends the game when an unserved destination overflows', () => {
    const game = new Game(flatMap(7));
    const d = game.buildings.dests[0];
    run(game, 400, () => {
      expect(d.pins).toBeLessThanOrEqual(CAPACITY[d.shape] + CONFIG.maxExtraPins);
    });
    expect(game.over?.dest).toBe(d);
    const frozen = game.time;
    run(game, 5);
    expect(game.time).toBe(frozen);
  });

  it('drains the warning ring once deliveries catch up', () => {
    const game = new Game(flatMap(2));
    game.net.inventory.roads = 500;
    const d = game.buildings.dests[0];
    d.pins = CAPACITY[d.shape] + 2;
    run(game, 5);
    expect(d.overflow).toBeGreaterThan(0);
    for (const h of game.buildings.houses) connect(game, h.access, d.access);
    run(game, 90);
    expect(game.over).toBeNull();
    expect(d.pins).toBeLessThanOrEqual(CAPACITY[d.shape]);
    expect(d.overflow).toBe(0);
  });

  it('ends each week with roads, an upgrade pick and periodic growth', () => {
    const game = new Game(generateMap(4));
    game.sandbox = true;
    const roads = game.net.inventory.roads;
    run(game, CONFIG.weekSeconds + 1, undefined, false);
    expect(game.week).toBe(1);
    expect(game.upgrades).toHaveLength(2);
    expect(game.upgrades![0]).not.toEqual(game.upgrades![1]);
    // The clock holds while the player decides.
    const t = game.time;
    run(game, 10, undefined, false);
    expect(game.time).toBe(t);
    const pick = game.upgrades![0];
    game.chooseUpgrade(0);
    expect(game.upgrades).toBeNull();
    expect(game.net.inventory.roads).toBe(roads + CONFIG.weeklyRoads + (pick.roads ?? 0));
    expect(game.stage).toBe(0);
    run(game, CONFIG.weekSeconds, undefined, false);
    game.chooseUpgrade(1);
    expect(game.week).toBe(2);
    expect(game.stage).toBe(1);
  });

  it('routes over a motorway and drives it faster', () => {
    const game = new Game({ seed: 1, grid: new Grid(30, 20), stages: [{ x0: 0, y0: 0, x1: 30, y1: 20 }] });
    const { net } = game;
    net.inventory.roads = 500;
    net.inventory.motorways = 1;
    // A long road along a row no building sits on, then a motorway over it.
    const row = [...Array(30).keys()].find((y) => [...Array(30).keys()].every((x) => !game.buildings.isOccupied(net.idx(x, y)) && !game.buildings.isAccess(net.idx(x, y))))!;
    const a = net.idx(2, row), b = net.idx(20, row);
    net.placeTile(a);
    for (let x = 3; x <= 20; x++) net.connect(net.idx(x - 1, row), net.idx(x, row));
    expect(game.graph.path(a, b)).toHaveLength(19);
    expect(net.placeMotorway(a, b)).toBe(true);
    expect(game.graph.path(a, b)).toEqual([a, b]);
    // Closing it keeps the lane for cars already on it but stops new routes.
    net.closeMotorway(net.motorways[0]);
    expect(game.graph.path(a, b)).toHaveLength(19);
    expect(game.graph.hasLane(a, b)).toBe(true);
  });

  it('opens destination lots on several sides, and cars use any connected entrance', () => {
    const game = new Game(flatMap(1));
    game.net.inventory.roads = 500;
    const d = game.buildings.dests[0];
    expect(d.entrances.length).toBeGreaterThanOrEqual(3);
    const sides = new Set(d.entrances.map((e) => e.access - e.door));
    expect(sides.size).toBe(3); // front plus both ends
    // Connect only through a side entrance, never the main one.
    const side = d.entrances.find((e) => e.access - e.door !== d.access - d.door)!;
    for (const h of game.buildings.houses) connect(game, h.access, side.access);
    expect(game.net.hasTile(d.access)).toBe(false);
    run(game, 60, () => checkInvariants(game));
    expect(game.score).toBeGreaterThan(2);
  });

  it('turns a house to face a new road', () => {
    const game = new Game(flatMap(6));
    const h = game.buildings.houses[0];
    const dir = DIRS4.find((d) => (d[0] !== h.dir[0] || d[1] !== h.dir[1]) && game.buildings.isAccessOk(h.x + d[0], h.y + d[1], game.bounds))!;
    const old = h.access;
    expect(game.turnHouse(h, dir)).toBe(true);
    expect(h.access).toBe(game.net.idx(h.x + dir[0], h.y + dir[1]));
    expect(game.buildings.byAccess.get(old)?.includes(h) ?? false).toBe(false);
    expect(game.buildings.byAccess.get(h.access)).toContain(h);
    // Roads at the new access tile now reach the house.
    game.net.placeTile(h.access);
    expect(game.graph.neighbors(h.tile)).toEqual([h.access]);
  });

  it('classifies light approaches by axis', () => {
    const w = 30;
    expect(approachAxis(5, 6, w)).toBe(0);
    expect(approachAxis(5, 5 + w, w)).toBe(1);
  });

  it('keeps traffic rules on a busy network', () => {
    const game = new Game(flatMap(11));
    game.net.inventory.roads = 2000;
    const linked = new Set<number>();
    let maxCars = 0;
    run(game, 400, () => {
      for (const h of game.buildings.houses) {
        if (linked.has(h.id)) continue;
        const d = game.buildings.dests.find((x) => x.color === h.color)!;
        connect(game, h.access, d.access);
        linked.add(h.id);
      }
      for (const d of game.buildings.dests) if (!linked.has(d.id)) {
        const h = game.buildings.houses.find((x) => x.color === d.color);
        if (h) connect(game, h.access, d.access);
        linked.add(d.id);
      }
      checkInvariants(game);
      checkTraffic(game);
      maxCars = Math.max(maxCars, game.cars.length);
    });
    expect(maxCars).toBeGreaterThan(8);
    expect(game.score).toBeGreaterThan(40);
  });
});

function checkTraffic(game: Game) {
  // Cars sharing a lane keep their spacing (cars still waiting inside a house are exempt).
  const lanes = new Map<string, number[]>();
  for (const c of game.cars) {
    if (c.state === 'parked' || (c.seg === 0 && c.t === 0)) continue;
    const k = `${c.path[c.seg]}>${c.path[c.seg + 1]}`;
    lanes.set(k, [...(lanes.get(k) ?? []), c.t]);
  }
  for (const ts of lanes.values()) {
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) expect(ts[i] - ts[i - 1]).toBeGreaterThanOrEqual(MIN_GAP - 1e-6);
  }
  // Each junction lets one movement through at a time.
  const movements = new Map<number, Set<string>>();
  for (const c of game.cars) {
    for (const node of c.locks) {
      const i = c.path.indexOf(node);
      const set = movements.get(node) ?? new Set<string>();
      set.add(`${c.path[i - 1]}>${c.path[i + 1]}`);
      movements.set(node, set);
    }
  }
  for (const set of movements.values()) expect(set.size).toBe(1);
  // Parking spots are never double-booked, and every parked car holds one.
  for (const d of game.buildings.dests) {
    const held = d.spots.filter((x) => x !== null);
    expect(new Set(held).size).toBe(held.length);
  }
  for (const c of game.cars) if (c.state === 'parked') expect(c.dest.spots[c.spot]).toBe(c.id);
}
