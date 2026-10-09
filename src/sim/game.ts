import { Buildings, CAPACITY, DIRS4, Destination, Dir, House, destTiles } from './buildings';
import { Bounds, Terrain, inBounds } from './grid';
import { MapData } from './mapgen';
import { DriveGraph } from './pathfind';
import { Rng, mulberry32 } from './rng';
import { Inventory, RoadNetwork } from './roads';
import { Car, Traffic } from './traffic';

export type { Car } from './traffic';

export const COLOR_COUNT = 6;

export const CONFIG = {
  /** Car speed in tiles per second. */
  carSpeed: 1.6,
  parkSeconds: 1.2,
  houseEvery: 14,
  destEvery: 50,
  /** Seconds between pins for a fresh destination, before difficulty ramps up. */
  pinEvery: { circle: 8, square: 11 },
  /** Pin rate multiplier grows by 1 every this many seconds. */
  difficultyRamp: 300,
  dispatchEvery: 0.4,
  startingInventory: { roads: 30, bridges: 1, tunnels: 1 } as Inventory,
};

export class Game {
  readonly net: RoadNetwork;
  readonly buildings: Buildings;
  readonly graph: DriveGraph;
  readonly traffic: Traffic;
  readonly cars: Car[] = [];
  time = 0;
  score = 0;
  stage = 0;
  colorsInPlay = 0;
  private rng: Rng;
  private nextCarId = 0;
  private houseTimer = 0;
  private destTimer = 0;
  private dispatchTimer = 0;
  private seenNetVersion = 0;
  /** Connected land area id per tile (-1 for water/mountain), to keep clusters on one bank. */
  private region: Int32Array;

  constructor(readonly map: MapData) {
    this.rng = mulberry32(map.seed ^ 0x9e3779b9);
    this.buildings = new Buildings(map.grid);
    this.net = new RoadNetwork(map.grid, { ...CONFIG.startingInventory }, (x, y) =>
      inBounds(this.bounds, x, y) && !this.buildings.isOccupied(this.net.idx(x, y)),
    );
    this.graph = new DriveGraph(this.net, this.buildings);
    this.traffic = new Traffic(this.graph, map.grid.w * map.grid.h, CONFIG.carSpeed);
    this.seenNetVersion = this.net.version;
    this.region = landRegions(map);
    this.spawnNewColor();
  }

  get bounds(): Bounds {
    return this.map.stages[this.stage];
  }

  grow(): boolean {
    if (this.stage >= this.map.stages.length - 1) return false;
    this.stage++;
    return true;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.net.version !== this.seenNetVersion) {
      this.seenNetVersion = this.net.version;
      this.reroute();
    }
    this.spawnTick(dt);
    this.pinTick(dt);
    this.dispatchTimer += dt;
    if (this.dispatchTimer >= CONFIG.dispatchEvery) {
      this.dispatchTimer = 0;
      this.dispatch();
    }
    this.moveCars(dt);
  }

  // ---- spawning -------------------------------------------------------------

  private spawnTick(dt: number) {
    this.houseTimer += dt;
    this.destTimer += dt;
    if (this.houseTimer >= CONFIG.houseEvery) {
      this.houseTimer = 0;
      this.spawnHouse(this.neediestColor());
    }
    if (this.destTimer >= CONFIG.destEvery) {
      this.destTimer = 0;
      const dests = this.buildings.dests.length;
      // Every other new destination introduces a new color until the palette runs out.
      if (dests % 2 === 1 && this.colorsInPlay < COLOR_COUNT) this.spawnNewColor();
      else this.spawnDest(this.neediestColor(), this.colorsInPlay * 2);
    }
  }

  private spawnNewColor() {
    const color = this.colorsInPlay;
    if (!this.spawnDest(color, 4)) return;
    this.colorsInPlay++;
    this.spawnHouse(color);
    this.spawnHouse(color);
  }

  /** Color whose destinations have the most pin demand per car. */
  private neediestColor(): number {
    let best = 0, bestScore = -Infinity;
    for (let c = 0; c < this.colorsInPlay; c++) {
      const demand = this.buildings.dests.filter((d) => d.color === c).reduce((s, d) => s + (d.shape === 'circle' ? 1.4 : 1), 0);
      const cars = this.buildings.houses.filter((h) => h.color === c).length * 2;
      const score = demand / Math.max(1, cars) + this.rng() * 0.05;
      if (score > bestScore) [best, bestScore] = [c, score];
    }
    return best;
  }

  private isRoad = (i: number) => this.net.hasTile(i);

  spawnHouse(color: number): House | null {
    const anchors = [
      ...this.buildings.dests.filter((d) => d.color === color).map((d) => ({ x: d.x + 1, y: d.y + 1, r: [3, 7], tile: d.door })),
      ...this.buildings.houses.filter((h) => h.color === color).map((h) => ({ x: h.x, y: h.y, r: [1, 3], tile: h.tile })),
    ];
    if (!anchors.length) return null;
    for (let tries = 0; tries < 80; tries++) {
      const a = anchors[Math.floor(this.rng() * anchors.length)];
      const ang = this.rng() * Math.PI * 2;
      const dist = a.r[0] + this.rng() * (a.r[1] - a.r[0]);
      const x = Math.round(a.x + Math.cos(ang) * dist), y = Math.round(a.y + Math.sin(ang) * dist);
      if (!this.buildings.isFreeLand(x, y, this.bounds, this.isRoad)) continue;
      // Mostly stay on the anchor's side of rivers and mountains; occasionally force a crossing.
      if (this.region[this.buildings.idx(x, y)] !== this.region[a.tile] && this.rng() < 0.95) continue;
      const dir = this.pickDir((d) => {
        const ax = x + d[0], ay = y + d[1];
        // An access tile must stay clear: road or empty land, never a building.
        return this.buildings.isAccessOk(ax, ay, this.bounds);
      });
      if (!dir) continue;
      return this.buildings.addHouse(x, y, dir, color, this.time);
    }
    return null;
  }

  spawnDest(color: number, minOtherColorDist: number): Destination | null {
    const b = this.bounds;
    for (let tries = 0; tries < 200; tries++) {
      const x = b.x0 + Math.floor(this.rng() * (b.x1 - b.x0 - 1));
      const y = b.y0 + Math.floor(this.rng() * (b.y1 - b.y0 - 1));
      const fits = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([dx, dy]) =>
        this.buildings.isFreeLand(x + dx, y + dy, b, this.isRoad),
      );
      if (!fits) continue;
      const cx = x + 1, cy = y + 1;
      const tooClose = [...this.buildings.dests, ...this.buildings.houses].some((o) => {
        const ox = o.kind === 'dest' ? o.x + 1 : o.x + 0.5, oy = o.kind === 'dest' ? o.y + 1 : o.y + 0.5;
        const d = Math.hypot(ox - cx, oy - cy);
        return o.kind === 'dest' ? d < 5 : o.color !== color && d < minOtherColorDist;
      });
      if (tooClose) continue;
      const side = this.pickDir((s) => {
        const [door] = destTiles(x, y, s).parking;
        return this.buildings.isAccessOk(door[0] + s[0], door[1] + s[1], b);
      });
      if (!side) continue;
      const shape = this.rng() < 0.5 ? 'circle' : 'square';
      return this.buildings.addDest(x, y, side, color, shape, this.time);
    }
    return null;
  }

  private pickDir(ok: (d: Dir) => boolean): Dir | null {
    const dirs = [...DIRS4].sort(() => this.rng() - 0.5);
    return dirs.find(ok) ?? null;
  }

  // ---- demand ---------------------------------------------------------------

  private pinTick(dt: number) {
    const rate = 1 + this.time / CONFIG.difficultyRamp;
    for (const d of this.buildings.dests) {
      d.pinTimer += dt * rate;
      const every = CONFIG.pinEvery[d.shape];
      if (d.pinTimer >= every) {
        d.pinTimer -= every;
        // Overflow and game over arrive in a later milestone; for now cap the pile.
        if (d.pins < CAPACITY[d.shape] + 3) {
          d.pins++;
          this.buildings.version++;
        }
      }
    }
  }

  /** Send idle cars toward destinations whose pins aren't already covered, neediest first. */
  private dispatch() {
    const dests = this.buildings.dests
      .filter((d) => d.pins > d.assigned && this.net.hasTile(d.access))
      .sort((a, b) => b.pins - b.assigned - (a.pins - a.assigned));
    for (const d of dests) {
      let need = d.pins - d.assigned;
      this.graph.explore(d.door, (node, _dist, pathTo) => {
        const b = this.buildings.byEndpoint.get(node);
        if (b?.kind !== 'house' || b.color !== d.color || b.idleCars === 0) return false;
        const route = pathTo().reverse();
        while (b.idleCars > 0 && need > 0) {
          this.launch(b, d, route);
          need--;
        }
        return need === 0;
      });
    }
  }

  private launch(h: House, d: Destination, path: number[]) {
    h.idleCars--;
    d.assigned++;
    this.cars.push({
      id: this.nextCarId++, house: h, dest: d, state: 'toDest', path: [...path], seg: 0, t: 0, speed: 0,
      parkTimer: 0, spot: -1, locks: new Set(), waitingSince: Infinity,
    });
  }

  // ---- movement -------------------------------------------------------------

  private moveCars(dt: number) {
    const done: Car[] = [];
    for (const car of this.cars) {
      if (car.state !== 'parked') continue;
      car.parkTimer -= dt;
      if (car.parkTimer <= 0) this.leaveParking(car, done);
    }
    this.traffic.step(this.cars, dt, this.time, {
      arrive: (car) => this.arrive(car, done),
    });
    if (done.length) this.removeCars(done);
  }

  private arrive(car: Car, done: Car[]) {
    if (car.state === 'toDest') {
      car.state = 'parked';
      car.parkTimer = CONFIG.parkSeconds;
      car.speed = 0;
      this.traffic.releaseLocks(car);
      if (car.spot < 0) {
        // Arrived without a reservation (e.g. route replaced right at the door): squeeze in.
        const free = car.dest.spots.indexOf(null);
        car.spot = free >= 0 ? free : 0;
        car.dest.spots[car.spot] = car.id;
      }
    } else {
      this.traffic.releaseAll(car);
      car.house.idleCars++;
      done.push(car);
    }
  }

  private leaveParking(car: Car, done: Car[]) {
    const d = car.dest;
    const home = this.graph.path(d.door, car.house.tile);
    // Wait in the spot until the exit lane has room.
    if (home && home.length > 1 && !this.traffic.laneHasRoom(home[0], home[1])) return;
    if (d.pins > 0) {
      d.pins--;
      this.score++;
    }
    d.assigned--;
    this.buildings.version++;
    this.traffic.releaseSpot(car);
    if (!home) {
      car.house.idleCars++;
      done.push(car);
      return;
    }
    Object.assign(car, { state: 'toHome', path: home, seg: 0, t: 0, speed: 0 });
  }

  /** After a road edit, re-plan every moving car from the tile it's heading to. */
  private reroute() {
    const lost: Car[] = [];
    for (const car of this.cars) {
      if (car.state === 'parked') continue;
      const a = car.path[car.seg], b = car.path[car.seg + 1];
      if (b === undefined) continue;
      if (!this.graph.hasEdge(a, b)) {
        lost.push(car);
        continue;
      }
      const target = car.state === 'toDest' ? car.dest.door : car.house.tile;
      let rest = this.graph.path(b, target);
      if (!rest && car.state === 'toDest') {
        // Destination cut off: give up the trip and head home instead.
        car.dest.assigned--;
        car.state = 'toHome';
        this.traffic.releaseSpot(car);
        rest = this.graph.path(b, car.house.tile);
      }
      if (!rest) {
        lost.push(car);
        continue;
      }
      car.path = [a, ...rest];
      car.seg = 0;
    }
    for (const car of lost) {
      this.traffic.releaseAll(car);
      if (car.state === 'toDest') car.dest.assigned--;
      car.house.idleCars++;
    }
    if (lost.length) this.removeCars(lost);
  }

  private removeCars(gone: Car[]) {
    const set = new Set(gone);
    for (let i = this.cars.length - 1; i >= 0; i--) if (set.has(this.cars[i])) this.cars.splice(i, 1);
  }
}

function landRegions(map: MapData): Int32Array {
  const { grid } = map;
  const region = new Int32Array(grid.w * grid.h).fill(-1);
  let next = 0;
  for (let start = 0; start < region.length; start++) {
    if (region[start] !== -1 || grid.terrain[start] !== Terrain.Land) continue;
    const stack = [start];
    region[start] = next;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % grid.w, y = Math.floor(i / grid.w);
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy, n = ny * grid.w + nx;
        if (grid.contains(nx, ny) && region[n] === -1 && grid.terrain[n] === Terrain.Land) {
          region[n] = next;
          stack.push(n);
        }
      }
    }
    next++;
  }
  return region;
}
