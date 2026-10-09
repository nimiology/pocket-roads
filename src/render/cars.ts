import * as THREE from 'three';
import { destTiles } from '../sim/buildings';
import { Car, Game } from '../sim/game';
import { PALETTE, shade } from './palette';
import { roundedBox } from './shapes';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { deckHeight, deckSwing } from './roads';

const MAX_CARS = 1024;
import { LANE_OFFSET, RING_ENTRY, RING_R, ringArc } from '../sim/traffic';
/** Road surface height; car parts are modelled with their wheels on y = 0. */
const CAR_Y = 0.034;

// Car facing +X, ~0.4 long. Parts are separate instanced meshes so each can have its own material.
const BODY = roundedBox(0.4, 0.075, 0.205, 0.035).translate(0, 0.022 + 0.0375, 0);
const GLASS = roundedBox(0.23, 0.06, 0.18, 0.03).translate(-0.025, 0.09 + 0.02, 0);
const ROOF = roundedBox(0.15, 0.022, 0.165, 0.01).translate(-0.035, 0.15, 0);
const WHEELS = mergeGeometries([[0.12, 0.1], [0.12, -0.1], [-0.12, 0.1], [-0.12, -0.1]].map(([x, z]) =>
  new THREE.CylinderGeometry(0.038, 0.038, 0.03, 12).rotateX(Math.PI / 2).translate(x, 0.038, z)))!;
const HEADLIGHTS = mergeGeometries([0.065, -0.065].map((z) => roundedBox(0.02, 0.022, 0.045, 0.008).translate(0.198, 0.07, z)))!;
const TAILLIGHTS = mergeGeometries([0.07, -0.07].map((z) => roundedBox(0.02, 0.02, 0.04, 0.008).translate(-0.198, 0.07, z)))!;

export interface CarPose {
  x: number;
  z: number;
  /** Heading in world XZ, radians from +X toward +Z. */
  heading: number;
  /** Height above the road (on a motorway deck). */
  lift?: number;
}

/** Instanced car bodies and cabins positioned from the simulation each frame. */
export class CarRenderer {
  private parts: THREE.InstancedMesh[];
  private body: THREE.InstancedMesh;
  private roof: THREE.InstancedMesh;
  private colors = PALETTE.colors.map((c) => new THREE.Color(c));
  private roofColors = PALETTE.colors.map((c) => shade(c, 0.14, -0.1));
  /** Bay each car last parked in, so it can be animated pulling out. */
  private lastBay = new Map<number, CarPose>();

  constructor(scene: THREE.Scene) {
    const make = (geo: THREE.BufferGeometry, color?: string) => {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial(color ? { color } : {}), MAX_CARS);
      // Instances move every frame; a cached bounding sphere would cull them.
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.body = make(BODY);
    this.roof = make(ROOF);
    // Allocate instance colors up front so the shader is compiled with per-instance color support.
    for (let i = 0; i < MAX_CARS; i++) {
      this.body.setColorAt(i, this.colors[0]);
      this.roof.setColorAt(i, this.roofColors[0]);
    }
    this.parts = [this.body, make(GLASS, PALETTE.glass), this.roof, make(WHEELS, '#2b2b2f'), make(HEADLIGHTS, '#fff6d8'), make(TAILLIGHTS, '#e5483a')];
  }

  update(game: Game): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    let n = 0;
    const isRoundabout = (i: number) => game.net.specialAt(i) === 'roundabout';
    const isMotorway = (a: number, b: number) => game.net.motorways.some((m) => (m.a === a && m.b === b) || (m.a === b && m.b === a));
    const seen = new Set<number>();
    for (const car of game.cars) {
      if (n >= MAX_CARS) break;
      seen.add(car.id);
      let p = carPose(car, game.map.grid.w, isRoundabout, isMotorway);
      const last = car.path.length - 2;
      const segLength = car.seg <= last ? game.graph.length(car.path[car.seg], car.path[car.seg + 1]) : 1;
      // Once a home-bound car is past its first lane it has left the lot for good. Forget the bay,
      // so a reroute (which restarts the path at segment 0) can't glide it back from there.
      if (car.state !== 'parked' && (car.state !== 'toHome' || car.seg > 0)) this.lastBay.delete(car.id);
      if (car.state === 'parked') this.lastBay.set(car.id, p);
      else if (car.state === 'toDest' && car.seg === last && car.spot >= 0) {
        // Glide from the lot entrance into the reserved bay.
        p = mixPose(p, bayPose(car.dest, car.spot), smooth(car.t / segLength));
      } else if (car.state === 'toHome' && car.seg === 0 && this.lastBay.has(car.id)) {
        // Reverse out of the bay onto the lot's exit lane.
        p = mixPose(this.lastBay.get(car.id)!, p, smooth(car.t / segLength));
      }
      q.setFromAxisAngle(up, -p.heading);
      m.compose(pos.set(p.x, CAR_Y + (p.lift ?? 0), p.z), q, one);
      for (const part of this.parts) part.setMatrixAt(n, m);
      this.body.setColorAt(n, this.colors[car.house.color]);
      this.roof.setColorAt(n, this.roofColors[car.house.color]);
      n++;
    }
    for (const id of this.lastBay.keys()) if (!seen.has(id)) this.lastBay.delete(id);
    for (const mesh of this.parts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.body.instanceColor!.needsUpdate = true;
    this.roof.instanceColor!.needsUpdate = true;
  }
}

export function carPose(
  car: Car, gridW: number,
  isRoundabout: (node: number) => boolean = () => false,
  isMotorway: (a: number, b: number) => boolean = () => false,
): CarPose {
  const center = (i: number) => [(i % gridW) + 0.5, Math.floor(i / gridW) + 0.5];
  if (car.state === 'parked') return bayPose(car.dest, car.spot);
  const { path, seg, t } = car;
  const node = (k: number) => center(path[Math.max(0, Math.min(path.length - 1, k))]);
  const len = segLen(node(seg), node(seg + 1));
  let pose: CarPose;
  if (seg + 2 < path.length && isRoundabout(path[seg + 1]) && t > len - RING_ENTRY) {
    // Entering a roundabout: merge onto the ring and drive round the island instead of cutting across.
    pose = ringPose(path[seg], path[seg + 1], path[seg + 2], gridW, (t - (len - RING_ENTRY)) / (2 * RING_ENTRY));
  } else if (seg > 0 && isRoundabout(path[seg]) && t < RING_ENTRY) {
    pose = ringPose(path[seg - 1], path[seg], path[seg + 1], gridW, 0.5 + t / (2 * RING_ENTRY));
  } else if (t > len - TURN_R && seg + 2 < path.length) {
    // Round the corner through a node: blend from the end of the incoming lane to the
    // start of the outgoing lane along a quadratic curve, except at the route's endpoints.
    pose = corner(node(seg), node(seg + 1), node(seg + 2), (t - (len - TURN_R)) / (2 * TURN_R));
  } else if (t < TURN_R && seg > 0) {
    pose = corner(node(seg - 1), node(seg), node(seg + 1), 0.5 + t / (2 * TURN_R));
  } else {
    pose = lanePoint(node(seg), node(seg + 1), t);
  }
  // On a motorway link: climb the ramps onto the deck. (Checked explicitly, not by length, so
  // no other long hop ever lifts a car into the air.)
  if (isMotorway(path[seg], path[seg + 1])) {
    pose.lift = deckHeight(t, len);
    // Follow the deck as it swings off to one side of the road and back.
    const a = node(seg), b = node(seg + 1);
    const sign = path[seg] < path[seg + 1] ? 1 : -1;
    const { off, slope } = deckSwing(t, len);
    const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
    pose.x += -uz * off * sign;
    pose.z += ux * off * sign;
    pose.heading += Math.atan(slope * sign);
  }
  return pose;
}

/** Where a car sits in parking bay `spot`: nose-in against the building. */
export function bayPose(d: Car['dest'], spot: number): CarPose {
  const { parking } = destTiles(d.x, d.y, d.side);
  const tile = parking[Math.max(0, spot) >> 1];
  const along = [-d.side[1], d.side[0]];
  const s = (spot & 1 ? 0.245 : -0.245);
  return {
    x: tile[0] + 0.5 + along[0] * s - d.side[0] * 0.19,
    z: tile[1] + 0.5 + along[1] * s - d.side[1] * 0.19,
    heading: Math.atan2(-d.side[1], -d.side[0]),
  };
}

/** Blend two poses (w = 0 → a, 1 → b), turning the short way round. */
export function mixPose(a: CarPose, b: CarPose, w: number): CarPose {
  let dh = b.heading - a.heading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w, heading: a.heading + dh * w, lift: (a.lift ?? 0) * (1 - w) + (b.lift ?? 0) * w };
}

/**
 * A car's drive through a roundabout as a polyline: a Hermite merge from the entry lane onto the
 * ring, an arc round the island, and a Hermite merge off onto the exit lane. Cached per movement.
 */
const ringRoutes = new Map<string, { pts: number[][]; cum: number[] }>();

function ringRoute(a: number, b: number, c: number, gridW: number) {
  const key = `${a},${b},${c},${gridW}`;
  let route = ringRoutes.get(key);
  if (route) return route;
  const P = (i: number) => [(i % gridW) + 0.5, Math.floor(i / gridW) + 0.5];
  const [bx, bz] = P(b), [ax, az] = P(a), [cx, cz] = P(c);
  const norm = (x: number, z: number) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  const u = norm(bx - ax, bz - az), v = norm(cx - bx, cz - bz);
  // Lane points at the ring's edge, kept to the right-hand side of the road.
  const pIn = [bx - u[0] * RING_ENTRY - u[1] * LANE_OFFSET, bz - u[1] * RING_ENTRY + u[0] * LANE_OFFSET];
  const pOut = [bx + v[0] * RING_ENTRY - v[1] * LANE_OFFSET, bz + v[1] * RING_ENTRY + v[0] * LANE_OFFSET];
  const { from, sweep } = ringArc(a, b, c, gridW);
  const onRing = (th: number) => [bx + Math.cos(th) * RING_R, bz + Math.sin(th) * RING_R];
  // Anticlockwise from above = decreasing angle; tangent is (sin θ, −cos θ).
  const tangent = (th: number) => [Math.sin(th), -Math.cos(th)];
  const hermite = (p0: number[], t0: number[], p1: number[], t1: number[], n: number) => {
    const k = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 1.3;
    const out: number[][] = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n, s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      out.push([0, 1].map((d) => h00 * p0[d] + h10 * k * t0[d] + h01 * p1[d] + h11 * k * t1[d]));
    }
    return out;
  };
  const th0 = from, th1 = from - sweep;
  const arcSteps = Math.max(2, Math.ceil(sweep / 0.12));
  const pts = [
    ...hermite(pIn, u, onRing(th0), tangent(th0), 12),
    ...Array.from({ length: arcSteps }, (_, i) => onRing(th0 - sweep * ((i + 1) / arcSteps))),
    ...hermite(onRing(th1), tangent(th1), pOut, v, 12).slice(1),
  ];
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  route = { pts, cum };
  ringRoutes.set(key, route);
  return route;
}

/** Pose at fraction s (0..1, by distance) along a roundabout movement. */
function ringPose(a: number, b: number, c: number, gridW: number, s: number): CarPose {
  const { pts, cum } = ringRoute(a, b, c, gridW);
  const d = Math.max(0, Math.min(1, s)) * cum[cum.length - 1];
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const f = (d - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  const p = pts[i - 1], q = pts[i];
  return { x: p[0] + (q[0] - p[0]) * f, z: p[1] + (q[1] - p[1]) * f, heading: Math.atan2(q[1] - p[1], q[0] - p[0]) };
}

const TURN_R = 0.3;

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function segLen(a: number[], b: number[]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Point `t` along the right-hand lane from a to b. */
function lanePoint(a: number[], b: number[], t: number): CarPose {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  // Right-hand side of travel direction (ux, uz) on a screen where +z points down is (-uz, ux).
  return { x: a[0] + ux * t - uz * LANE_OFFSET, z: a[1] + uz * t + ux * LANE_OFFSET, heading: Math.atan2(uz, ux) };
}

/** Curve through node b from lane a→b into lane b→c; s in [0, 1]. */
function corner(a: number[], b: number[], c: number[], s: number): CarPose {
  const inLen = segLen(a, b);
  const p0 = lanePoint(a, b, inLen - TURN_R);
  const p2 = lanePoint(b, c, TURN_R);
  const pIn = lanePoint(a, b, inLen), pOut = lanePoint(b, c, 0);
  // Control point: where the two lane centrelines meet near the node.
  const cx = (pIn.x + pOut.x) / 2, cz = (pIn.z + pOut.z) / 2;
  const u = 1 - s;
  const x = u * u * p0.x + 2 * u * s * cx + s * s * p2.x;
  const z = u * u * p0.z + 2 * u * s * cz + s * s * p2.z;
  const tx = 2 * u * (cx - p0.x) + 2 * s * (p2.x - cx);
  const tz = 2 * u * (cz - p0.z) + 2 * s * (p2.z - cz);
  return { x, z, heading: Math.atan2(tz, tx) };
}
