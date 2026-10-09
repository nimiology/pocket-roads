import { Bounds, Grid, Terrain, inBounds } from './grid';

export type Dir = readonly [number, number];
export const DIRS4: readonly Dir[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const HOUSE_CARS = 2;
export const CAPACITY = { circle: 10, square: 7 } as const;
export const PARKING_SPOTS = 4;

export interface House {
  kind: 'house';
  id: number;
  color: number;
  x: number;
  y: number;
  /** Direction from the house to its access tile. */
  dir: Dir;
  tile: number;
  /** Road tile in front of the driveway; a road here connects the house. */
  access: number;
  idleCars: number;
  spawnedAt: number;
}

export interface Destination {
  kind: 'dest';
  id: number;
  color: number;
  shape: 'circle' | 'square';
  /** Top-left of the 2x2 footprint. */
  x: number;
  y: number;
  /** Outward direction of the parking side. */
  side: Dir;
  buildingTiles: number[];
  parkingTiles: number[];
  /** Parking tile cars drive into. */
  door: number;
  access: number;
  pins: number;
  /** Cars currently on their way to collect a pin here. */
  assigned: number;
  /** Id of the car holding each parking spot, or null. */
  spots: (number | null)[];
  pinTimer: number;
  spawnedAt: number;
}

export type Building = House | Destination;

/** Owns all buildings and which tiles they occupy or need kept clear. */
export class Buildings {
  readonly houses: House[] = [];
  readonly dests: Destination[] = [];
  /** Building id per tile, or -1. */
  readonly occupant: Int32Array;
  /** Buildings reachable through each access tile. */
  readonly byAccess = new Map<number, Building[]>();
  /** Building whose endpoint node (house tile or destination door) is this tile. */
  readonly byEndpoint = new Map<number, Building>();
  private readonly byId = new Map<number, Building>();
  private nextId = 0;
  version = 0;

  constructor(readonly grid: Grid) {
    this.occupant = new Int32Array(grid.w * grid.h).fill(-1);
  }

  idx(x: number, y: number): number {
    return y * this.grid.w + x;
  }

  isOccupied(i: number): boolean {
    return this.occupant[i] !== -1;
  }

  /** Building standing on tile i, if any. */
  at(i: number): Building | undefined {
    return this.byId.get(this.occupant[i]);
  }

  isAccess(i: number): boolean {
    return this.byAccess.has(i);
  }

  endpoint(b: Building): number {
    return b.kind === 'house' ? b.tile : b.door;
  }

  /** Free land a building could stand on: in bounds, not road, not occupied, not someone's access. */
  isFreeLand(x: number, y: number, bounds: Bounds, isRoad: (i: number) => boolean): boolean {
    if (!this.grid.contains(x, y) || !inBounds(bounds, x, y)) return false;
    const i = this.idx(x, y);
    return this.grid.get(x, y) === Terrain.Land && !isRoad(i) && !this.isOccupied(i) && !this.isAccess(i);
  }

  /** A tile that can serve as an access tile: land in bounds that isn't a building. Roads are fine. */
  isAccessOk(x: number, y: number, bounds: Bounds): boolean {
    if (!this.grid.contains(x, y) || !inBounds(bounds, x, y)) return false;
    return this.grid.get(x, y) === Terrain.Land && !this.isOccupied(this.idx(x, y));
  }

  addHouse(x: number, y: number, dir: Dir, color: number, now: number): House {
    const h: House = {
      kind: 'house', id: this.nextId++, color, x, y, dir,
      tile: this.idx(x, y), access: this.idx(x + dir[0], y + dir[1]),
      idleCars: HOUSE_CARS, spawnedAt: now,
    };
    this.houses.push(h);
    this.register(h, [h.tile]);
    return h;
  }

  addDest(x: number, y: number, side: Dir, color: number, shape: Destination['shape'], now: number): Destination {
    const tiles = destTiles(x, y, side);
    const door = this.idx(tiles.parking[0][0], tiles.parking[0][1]);
    const d: Destination = {
      kind: 'dest', id: this.nextId++, color, shape, x, y, side,
      buildingTiles: tiles.building.map(([tx, ty]) => this.idx(tx, ty)),
      parkingTiles: tiles.parking.map(([tx, ty]) => this.idx(tx, ty)),
      door,
      access: this.idx(tiles.parking[0][0] + side[0], tiles.parking[0][1] + side[1]),
      pins: 0, assigned: 0, spots: Array(PARKING_SPOTS).fill(null), pinTimer: 0, spawnedAt: now,
    };
    this.dests.push(d);
    this.register(d, [...d.buildingTiles, ...d.parkingTiles]);
    return d;
  }

  private register(b: Building, tiles: number[]) {
    this.byId.set(b.id, b);
    for (const t of tiles) this.occupant[t] = b.id;
    const list = this.byAccess.get(b.access) ?? [];
    list.push(b);
    this.byAccess.set(b.access, list);
    this.byEndpoint.set(this.endpoint(b), b);
    this.version++;
  }
}

/** Footprint of a 2x2 destination: the half on `side` is parking, the other half is the building. */
export function destTiles(x: number, y: number, side: Dir) {
  const all: [number, number][] = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
  const onSide = ([tx, ty]: [number, number]) =>
    (side[0] === 1 && tx === x + 1) || (side[0] === -1 && tx === x) ||
    (side[1] === 1 && ty === y + 1) || (side[1] === -1 && ty === y);
  return { parking: all.filter(onSide), building: all.filter((t) => !onSide(t)) };
}
