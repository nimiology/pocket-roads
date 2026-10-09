import * as THREE from 'three';
import { destTiles } from '../sim/buildings';
import { Car, Game } from '../sim/game';
import { PALETTE, shade } from './palette';
import { roundedBox } from './shapes';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DECK_Y, RAMP } from './roads';

const MAX_CARS = 1024;
/** Sideways offset so cars keep to the right-hand side of the road. */
const LANE_OFFSET = 0.11;
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
    for (const car of game.cars) {
      if (n >= MAX_CARS) break;
      const p = carPose(car, game.map.grid.w);
      q.setFromAxisAngle(up, -p.heading);
      m.compose(pos.set(p.x, CAR_Y + (p.lift ?? 0), p.z), q, one);
      for (const part of this.parts) part.setMatrixAt(n, m);
      this.body.setColorAt(n, this.colors[car.house.color]);
      this.roof.setColorAt(n, this.roofColors[car.house.color]);
      n++;
    }
    for (const mesh of this.parts) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.body.instanceColor!.needsUpdate = true;
    this.roof.instanceColor!.needsUpdate = true;
  }
}

export function carPose(car: Car, gridW: number): CarPose {
  const center = (i: number) => [(i % gridW) + 0.5, Math.floor(i / gridW) + 0.5];
  if (car.state === 'parked') {
    const d = car.dest;
    const { parking } = destTiles(d.x, d.y, d.side);
    const tile = parking[Math.max(0, car.spot) >> 1];
    const along = [-d.side[1], d.side[0]];
    const s = (car.spot & 1 ? 0.245 : -0.245);
    // Nose-in, in the bay against the building (opposite the open side).
    return {
      x: tile[0] + 0.5 + along[0] * s - d.side[0] * 0.19,
      z: tile[1] + 0.5 + along[1] * s - d.side[1] * 0.19,
      heading: Math.atan2(-d.side[1], -d.side[0]),
    };
  }
  const { path, seg, t } = car;
  const node = (k: number) => center(path[Math.max(0, Math.min(path.length - 1, k))]);
  const len = segLen(node(seg), node(seg + 1));
  // Round the corner through a node: blend from the end of the incoming lane to the
  // start of the outgoing lane along a quadratic curve, except at the route's endpoints.
  if (t > len - TURN_R && seg + 2 < path.length) {
    return corner(node(seg), node(seg + 1), node(seg + 2), (t - (len - TURN_R)) / (2 * TURN_R));
  }
  if (t < TURN_R && seg > 0) {
    return corner(node(seg - 1), node(seg), node(seg + 1), 0.5 + t / (2 * TURN_R));
  }
  const pose = lanePoint(node(seg), node(seg + 1), t);
  // Only motorway links are longer than a diagonal step: climb the ramps onto the deck.
  if (len > 1.5) pose.lift = DECK_Y * Math.min(1, t / RAMP, (len - t) / RAMP);
  return pose;
}

const TURN_R = 0.3;

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
