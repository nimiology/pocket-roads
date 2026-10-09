import { Destination, House, PARKING_SPOTS } from './buildings';
import { DriveGraph } from './pathfind';

/** Centre-to-centre spacing between cars queued in one lane (car length is 0.4). */
export const MIN_GAP = 0.5;
/** Distance before a node's centre where cars wait for the junction or a parking spot. */
export const STOP = 0.32;
const ACCEL = 3;
/** Cars only ask for a junction or spot once this close to the stop line, so queues keep their order. */
const REQUEST_DIST = 0.1;
/** After a car with another movement has waited this long, no more cars may tag along. */
const PLATOON_PATIENCE = 1;
/** Speed multiplier on motorway lanes. */
export const MOTORWAY_SPEED = 2.2;
/** Cars allowed inside a roundabout at once (only if their stretches of ring don't overlap). */
export const ROUNDABOUT_CAP = 3;
/** Sideways offset of a car from the road centreline (right-hand traffic); shared with rendering. */
export const LANE_OFFSET = 0.13;
/** Distance from a roundabout's centre where cars wait, then leave the lane to merge onto the ring. */
export const RING_ENTRY = 0.64;
/** Radius cars circulate at, around the island. */
export const RING_R = 0.4;
/** How far round from its arm a car joins (and leaves) the ring, in radians. */
export const RING_MERGE = 0.75;
/** Extra angle kept clear around each car's stretch of ring (a car is ~1 rad long on this ring). */
const RING_GAP = 0.6;

/**
 * The stretch of ring a car drives through roundabout b from arm a to arm c: it starts at angle
 * `from` and sweeps `sweep` radians anticlockwise as seen from above (right-hand traffic).
 * Angles are atan2(z, x) with z pointing down the screen, so anticlockwise means decreasing.
 */
export function ringArc(a: number, b: number, c: number, w: number): { from: number; sweep: number } {
  const ang = (n: number) => Math.atan2(Math.floor(n / w) - Math.floor(b / w), (n % w) - (b % w));
  // How far round (anticlockwise) the exit arm is from the entry arm; a U-turn goes all the way.
  let turn = ang(a) - ang(c);
  while (turn <= 1e-6) turn += Math.PI * 2;
  while (turn > Math.PI * 2 + 1e-6) turn -= Math.PI * 2;
  // Join and leave the ring a little way from each arm, but never so far that a tight right turn
  // has its join point past its leave point (which would send it round a full lap).
  const merge = Math.min(RING_MERGE, turn / 2 - 0.12);
  return { from: ang(a) - merge, sweep: turn - 2 * merge };
}

/** Roundabouts: cars queue this far back from the centre, clear of cars swinging out of the ring. */
const RING_WAIT = 0.82;

/** Where cars wait before a junction, measured back from its centre. */
function stopDist(isRoundabout: boolean): number {
  return isRoundabout ? RING_WAIT : STOP;
}

/** How far past a junction's centre a car must get before it no longer holds the junction. */
function clearDist(isRoundabout: boolean): number {
  return isRoundabout ? RING_ENTRY : STOP;
}

/** Whether two ring stretches (plus clearance) overlap anywhere on the circle. */
function arcsOverlap(p: { from: number; sweep: number }, q: { from: number; sweep: number }): boolean {
  // Sample one arc finely and test each point against the other, both padded by RING_GAP / 2.
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const inside = (x: number, r: { from: number; sweep: number }) => norm(r.from + RING_GAP / 2 - x) <= r.sweep + RING_GAP;
  for (let k = 0; k <= 24; k++) if (inside(p.from + RING_GAP / 2 - (p.sweep + RING_GAP) * (k / 24), q)) return true;
  return false;
}
/** Traffic-light timing (seconds): shortest green, longest green while the other axis waits, all-red gap. */
export const LIGHT_MIN_GREEN = 1.5;
export const LIGHT_MAX_GREEN = 7;
export const LIGHT_CLEAR = 0.7;
/** Cars this close to a light's stop line count as waiting for it. */
const LIGHT_DETECT = 0.8;

/** One junction's light: which axis has green, since when, and whether it's in the all-red gap. */
export interface Light {
  axis: 0 | 1;
  since: number;
  /** All-red until this time (switch pending), or -Infinity. */
  clearUntil: number;
}

/** Which light phase a car coming from a into b belongs to: 0 = east–west, 1 = north–south. */
export function approachAxis(a: number, b: number, w: number): 0 | 1 {
  const dx = (b % w) - (a % w), dy = Math.floor(b / w) - Math.floor(a / w);
  if (Math.abs(dx) !== Math.abs(dy)) return Math.abs(dx) > Math.abs(dy) ? 0 : 1;
  return dx * dy > 0 ? 0 : 1;
}


export interface Car {
  id: number;
  house: House;
  dest: Destination;
  state: 'toDest' | 'parked' | 'toHome';
  /** Route as tile indices; the car is between path[seg] and path[seg + 1]. */
  path: number[];
  seg: number;
  /** Distance travelled along the current segment. */
  t: number;
  speed: number;
  parkTimer: number;
  /** Parking spot index held at `dest`, or -1. */
  spot: number;
  /** Junction nodes this car currently holds. */
  locks: Set<number>;
  /** Game time this car started waiting at a stop line, or Infinity. */
  waitingSince: number;
}

interface Lock {
  holders: Set<Car>;
  /** "from>to" of the movement currently allowed through. */
  movement: string;
  /** When a car with a different movement first got turned away, or Infinity. */
  contestedSince: number;
  /** Roundabouts: the stretch of ring each car inside is driving, and the arms it enters and leaves by. */
  arcs?: Map<Car, { from: number; sweep: number; in: number; out: number }>;
}

export interface TrafficHooks {
  /** Car reached the last node of its path. */
  arrive(car: Car): void;
}

/**
 * Lane-based car movement: cars keep a gap to the car ahead in their lane,
 * take turns through junctions (nodes with 3+ links), only enter a junction when
 * their exit lane has room, and reserve a parking spot before turning in.
 * Roundabouts admit several cars at once; traffic lights admit a whole axis at a time.
 */
export class Traffic {
  private locks = new Map<number, Lock>();
  /** Traffic-light state per junction, created when the first car arrives. */
  readonly lights = new Map<number, Light>();
  /** Cars per directed edge, rebuilt each step. */
  private lanes = new Map<number, Car[]>();

  constructor(
    private graph: DriveGraph,
    private tileCount: number,
    private speed: number,
    private gridW: number,
    /** Active roundabout or light on a junction tile. */
    private specialAt: (i: number) => 'roundabout' | 'light' | null = () => null,
  ) {}

  /** Cars currently holding junction `node`. */
  holders(node: number): number {
    return this.locks.get(node)?.holders.size ?? 0;
  }

  /** Whether any car is on either lane of the link a–b. */
  linkBusy(a: number, b: number): boolean {
    return this.carsOn(a, b).length > 0 || this.carsOn(b, a).length > 0;
  }

  private laneKey(a: number, b: number) {
    return a * this.tileCount + b;
  }

  carsOn(a: number, b: number): Car[] {
    return this.lanes.get(this.laneKey(a, b)) ?? [];
  }

  isJunction(node: number): boolean {
    return this.graph.neighbors(node).length >= 3;
  }

  step(cars: Car[], dt: number, now: number, hooks: TrafficHooks): void {
    this.indexLanes(cars);
    this.updateLights(now);
    // Longest-waiting cars get first claim on junctions and spots.
    const order = cars.filter((c) => c.state !== 'parked').sort((a, b) => a.waitingSince - b.waitingSince || a.id - b.id);
    for (const car of order) this.advance(car, dt, now, hooks);
  }

  /**
   * Demand-actuated lights: green stays while it's being used, and flips (after an all-red gap)
   * once the other axis has cars waiting and the green axis is idle or has had its maximum.
   */
  private updateLights(now: number) {
    for (const [node, light] of this.lights) {
      if (this.specialAt(node) !== 'light') {
        this.lights.delete(node);
        continue;
      }
      if (light.clearUntil > -Infinity) {
        // Switch once the gap has passed and the box is empty.
        if (now >= light.clearUntil && this.holders(node) === 0) {
          light.axis = (1 - light.axis) as 0 | 1;
          light.since = now;
          light.clearUntil = -Infinity;
        }
        continue;
      }
      const demand = this.lightDemand(node);
      const green = now - light.since;
      const otherWaiting = demand[1 - light.axis] > 0;
      if (otherWaiting && green >= LIGHT_MIN_GREEN && (demand[light.axis] === 0 || green >= LIGHT_MAX_GREEN)) {
        light.clearUntil = now + LIGHT_CLEAR;
      }
    }
  }

  /** Cars approaching junction `node` on each axis, not yet through it. */
  private lightDemand(node: number): [number, number] {
    const out: [number, number] = [0, 0];
    for (const a of this.graph.neighbors(node)) {
      const len = this.graph.length(a, node);
      for (const c of this.carsOn(a, node)) {
        if (!c.locks.has(node) && c.t >= len - STOP - LIGHT_DETECT && c.path[c.path.length - 1] !== node) out[approachAxis(a, node, this.gridW)]++;
      }
    }
    return out;
  }

  /** Light at a junction for display: green axis, or null during the all-red gap / before first use. */
  lightAt(node: number, now: number): { axis: 0 | 1; green: boolean; amber: boolean } | null {
    const l = this.lights.get(node);
    if (!l) return null;
    return { axis: l.axis, green: l.clearUntil === -Infinity, amber: l.clearUntil > -Infinity && now < l.clearUntil };
  }

  private indexLanes(cars: Car[]) {
    this.lanes.clear();
    for (const c of cars) {
      if (c.state === 'parked' || c.seg >= c.path.length - 1) continue;
      const k = this.laneKey(c.path[c.seg], c.path[c.seg + 1]);
      const list = this.lanes.get(k);
      if (list) list.push(c);
      else this.lanes.set(k, [c]);
    }
  }

  /** Speed factor for a car on (or just entering/leaving) a roundabout's ring, else 1. */
  private ringFactor(car: Car, len: number): number {
    const { path, seg, t } = car;
    let arc: { sweep: number } | null = null;
    if (seg + 2 < path.length && t > len - RING_ENTRY && this.specialAt(path[seg + 1]) === 'roundabout') {
      arc = ringArc(path[seg], path[seg + 1], path[seg + 2], this.gridW);
    } else if (seg > 0 && t < RING_ENTRY && this.specialAt(path[seg]) === 'roundabout') {
      arc = ringArc(path[seg - 1], path[seg], path[seg + 1], this.gridW);
    }
    if (!arc) return 1;
    // Drawn route ≈ merge curve in + arc + merge curve out; the path it maps onto is 2 × RING_ENTRY.
    const drawn = 0.7 + arc.sweep * RING_R;
    return Math.min(1, (2 * RING_ENTRY) / drawn) * 0.8;
  }

  /** True when the lane a→b has space for a car entering at its start. */
  laneHasRoom(a: number, b: number, except?: Car): boolean {
    return this.carsOn(a, b).every((c) => c === except || c.t >= MIN_GAP);
  }

  /**
   * True when a car crossing junction b can get fully out of it onto lane b→c, after
   * `ahead` other cars already crossing toward that lane.
   */
  private canClearJunction(b: number, c: number, ahead: number): boolean {
    // Past a roundabout the exit lane must have room beyond the ring's edge.
    const need = this.specialAt(b) === 'roundabout' ? RING_ENTRY + MIN_GAP * 0.5 : STOP + MIN_GAP * (ahead + 1);
    return this.carsOn(b, c).every((o) => o.t >= need - 1e-9);
  }

  /** Free distance ahead of `car` before it would be too close to the next car. */
  private gapAhead(car: Car): number {
    const a = car.path[car.seg], b = car.path[car.seg + 1];
    let best = Infinity;
    for (const o of this.carsOn(a, b)) {
      // Ties go to the lower id so two cars launched together don't block each other.
      if (o !== car && (o.t > car.t || (o.t === car.t && o.id < car.id))) best = Math.min(best, o.t - car.t);
    }
    if (best === Infinity && car.seg + 2 < car.path.length) {
      const len = this.graph.length(a, b);
      const c = car.path[car.seg + 2];
      for (const o of this.carsOn(b, c)) best = Math.min(best, len - car.t + o.t);
    }
    return best - MIN_GAP;
  }

  private advance(car: Car, dt: number, now: number, hooks: TrafficHooks) {
    const a = car.path[car.seg], b = car.path[car.seg + 1];
    const len = this.graph.length(a, b);
    const last = car.seg + 1 === car.path.length - 1;
    let allowed = this.gapAhead(car);

    if (last) {
      allowed = Math.min(allowed, len - car.t);
    } else if (car.t <= len - stopDist(this.specialAt(b) === 'roundabout') + 1e-9) {
      // Before the stop line: may we continue through node b?
      const toStop = len - stopDist(this.specialAt(b) === 'roundabout') - car.t;
      if (!(toStop <= REQUEST_DIST && this.clearToPass(car, now))) {
        allowed = Math.min(allowed, toStop);
        if (toStop < 0.05 && car.waitingSince === Infinity) car.waitingSince = now;
      }
    }

    // Faster on motorways. On a roundabout the drawn ring is longer than the 2 × RING_ZONE of path
    // it maps onto, so slow down in proportion and every car circulates at the same visible speed.
    const top = this.speed * (len > 1.5 ? MOTORWAY_SPEED : 1) * this.ringFactor(car, len);
    car.speed = Math.min(top, car.speed + ACCEL * dt);
    const move = Math.max(0, Math.min(car.speed * dt, allowed));
    if (move < car.speed * dt) car.speed = move / dt;
    car.t += move;

    // Cross into following segments.
    while (car.seg < car.path.length - 1) {
      const segLen = this.graph.length(car.path[car.seg], car.path[car.seg + 1]);
      if (car.t < segLen - 1e-9) break;
      if (car.seg + 1 === car.path.length - 1) {
        car.t = segLen;
        hooks.arrive(car);
        return;
      }
      car.t -= segLen;
      car.seg++;
    }
    this.releasePassed(car);
  }

  /**
   * Junction and parking checks for the node ahead. Grants the junction lock (and
   * parking spot) when available; otherwise the car must wait at the stop line.
   */
  private clearToPass(car: Car, now: number): boolean {
    const a = car.path[car.seg], b = car.path[car.seg + 1], c = car.path[car.seg + 2];
    const intoParking = car.state === 'toDest' && car.seg + 2 === car.path.length - 1 && car.dest.parkingTiles.includes(c);
    if (intoParking && car.spot < 0 && freeSpot(car.dest) < 0) return false;

    if (this.isJunction(b) && !car.locks.has(b)) {
      const lock = this.locks.get(b) ?? { holders: new Set<Car>(), movement: '', contestedSince: Infinity };
      const free = lock.holders.size === 0;
      // Don't block the box: enter only if we can get all the way out onto the exit lane.
      if (!intoParking && !this.canClearJunction(b, c, lock.holders.size)) return false;
      this.locks.set(b, lock);
      const special = this.specialAt(b);
      if (special === 'roundabout') {
        // Yield to cars already circulating: enter only if our stretch of ring is clear of theirs.
        if (lock.holders.size >= ROUNDABOUT_CAP) return false;
        const arc = { ...ringArc(a, b, c, this.gridW), in: a, out: c };
        lock.arcs ??= new Map();
        for (const [other, oa] of lock.arcs) {
          if (!lock.holders.has(other)) continue;
          // Overlapping stretch of ring, or entering by an arm someone is leaving by (and vice versa):
          // the two merge curves sit side by side on that arm and would clip.
          if (arcsOverlap(arc, oa) || oa.out === a || oa.in === c) return false;
        }
        lock.arcs.set(car, arc);
        return this.grant(car, b, lock, intoParking);
      }
      if (special === 'light') {
        const axis = approachAxis(a, b, this.gridW);
        let light = this.lights.get(b);
        // An idle light turns green for whoever arrives first.
        if (!light) this.lights.set(b, (light = { axis, since: now, clearUntil: -Infinity }));
        const mv = `axis${axis}`;
        // Green axis flows freely once the other axis has cleared the box.
        if (axis !== light.axis || light.clearUntil > -Infinity || (!free && lock.movement !== mv)) return false;
        lock.movement = mv;
        return this.grant(car, b, lock, intoParking);
      }
      const mv = `${a}>${c}`;
      const tagAlong = !free && lock.movement === mv && now - lock.contestedSince < PLATOON_PATIENCE;
      if (!free && !tagAlong) {
        if (lock.movement !== mv && lock.contestedSince === Infinity) lock.contestedSince = now;
        return false;
      }
      if (free) {
        lock.movement = mv;
        lock.contestedSince = Infinity;
      }
      return this.grant(car, b, lock, intoParking);
    }
    return this.grant(car, b, null, intoParking);
  }

  /** Let the car through node b: take the junction lock if any, and its parking spot if turning in. */
  private grant(car: Car, b: number, lock: Lock | null, intoParking: boolean): boolean {
    if (lock) {
      lock.holders.add(car);
      car.locks.add(b);
    }
    if (intoParking && car.spot < 0) {
      car.spot = freeSpot(car.dest, car.dest.parkingTiles.indexOf(car.path[car.path.length - 1]));
      car.dest.spots[car.spot] = car.id;
    }
    car.waitingSince = Infinity;
    return true;
  }

  /** Drop junction locks the car has driven clear of. */
  private releasePassed(car: Car) {
    for (const node of car.locks) {
      const stillNear =
        (car.path[car.seg + 1] === node) || (car.path[car.seg] === node && car.t < clearDist(this.specialAt(node) === 'roundabout'));
      if (!stillNear) this.release(car, node);
    }
  }

  private release(car: Car, node: number) {
    car.locks.delete(node);
    const lock = this.locks.get(node);
    if (!lock) return;
    lock.holders.delete(car);
    lock.arcs?.delete(car);
    if (lock.holders.size === 0) this.locks.delete(node);
  }

  releaseLocks(car: Car): void {
    for (const node of [...car.locks]) this.release(car, node);
  }

  /** Forget everything a car holds (it vanished, or its route was replaced). */
  releaseAll(car: Car): void {
    this.releaseLocks(car);
    this.releaseSpot(car);
  }

  releaseSpot(car: Car): void {
    if (car.spot >= 0 && car.dest.spots[car.spot] === car.id) car.dest.spots[car.spot] = null;
    car.spot = -1;
  }
}

/** A free spot, preferring the two bays on parking tile `tile` (0 or 1) where the car drives in. */
export function freeSpot(d: Destination, tile = 0): number {
  const order = tile === 1 ? [2, 3, 0, 1] : [0, 1, 2, 3];
  for (const i of order.slice(0, PARKING_SPOTS)) if (d.spots[i] === null) return i;
  return -1;
}
