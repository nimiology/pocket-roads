import * as THREE from 'three';
import { destTiles } from '../sim/buildings';
import { Car, Game } from '../sim/game';
import { PALETTE } from './palette';

const MAX_CARS = 1024;
/** Sideways offset so cars keep to the right-hand side of the road. */
const LANE_OFFSET = 0.11;
const CAR_Y = 0.06;

export interface CarPose {
  x: number;
  z: number;
  /** Heading in world XZ, radians from +X toward +Z. */
  heading: number;
}

/** Instanced car bodies and cabins positioned from the simulation each frame. */
export class CarRenderer {
  private body: THREE.InstancedMesh;
  private cabin: THREE.InstancedMesh;
  private colors = PALETTE.colors.map((c) => new THREE.Color(c));

  constructor(scene: THREE.Scene) {
    this.body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.11, 0.22), new THREE.MeshLambertMaterial(), MAX_CARS);
    this.cabin = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.08, 0.18), new THREE.MeshLambertMaterial({ color: '#f4f1ea' }), MAX_CARS);
    // Allocate instance colors up front so the shader is compiled with per-instance color support.
    for (let i = 0; i < MAX_CARS; i++) this.body.setColorAt(i, this.colors[0]);
    for (const m of [this.body, this.cabin]) {
      // Instances move every frame; a cached bounding sphere would cull them.
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      scene.add(m);
    }
  }

  update(game: Game): void {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const car of game.cars) {
      if (n >= MAX_CARS) break;
      const p = carPose(car, game.map.grid.w);
      q.setFromAxisAngle(up, -p.heading);
      this.body.setMatrixAt(n, m.compose(new THREE.Vector3(p.x, CAR_Y, p.z), q, one));
      const back = new THREE.Vector3(Math.cos(p.heading), 0, Math.sin(p.heading)).multiplyScalar(-0.03);
      this.cabin.setMatrixAt(n, m.compose(new THREE.Vector3(p.x + back.x, CAR_Y + 0.08, p.z + back.z), q, one));
      this.body.setColorAt(n, this.colors[car.house.color]);
      n++;
    }
    for (const mesh of [this.body, this.cabin]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}

export function carPose(car: Car, gridW: number): CarPose {
  const center = (i: number) => [(i % gridW) + 0.5, Math.floor(i / gridW) + 0.5];
  if (car.state === 'parked') {
    const d = car.dest;
    const { parking } = destTiles(d.x, d.y, d.side);
    const tile = parking[Math.max(0, car.spot) >> 1];
    const along = [-d.side[1], d.side[0]];
    const s = (car.spot & 1 ? 0.22 : -0.22);
    return {
      x: tile[0] + 0.5 + along[0] * s,
      z: tile[1] + 0.5 + along[1] * s,
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
  return lanePoint(node(seg), node(seg + 1), t);
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
