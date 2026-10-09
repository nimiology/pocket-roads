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
    const tile = parking[car.spot >> 1];
    const along = [-d.side[1], d.side[0]];
    const s = (car.spot & 1 ? 0.22 : -0.22);
    return {
      x: tile[0] + 0.5 + along[0] * s,
      z: tile[1] + 0.5 + along[1] * s,
      heading: Math.atan2(-d.side[1], -d.side[0]),
    };
  }
  const a = center(car.path[car.seg]);
  const b = center(car.path[Math.min(car.seg + 1, car.path.length - 1)]);
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const f = Math.min(1, car.t / len);
  const heading = Math.atan2(dz, dx);
  // Right-hand side of travel direction (dx, dz) on a screen where +z points down is (-dz, dx).
  const ox = (-dz / len) * LANE_OFFSET, oz = (dx / len) * LANE_OFFSET;
  return { x: a[0] + dx * f + ox, z: a[1] + dz * f + oz, heading };
}
