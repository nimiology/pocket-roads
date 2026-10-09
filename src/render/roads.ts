import * as THREE from 'three';
import { Terrain } from '../sim/grid';
import { RoadNetwork } from '../sim/roads';
import { PALETTE } from './palette';

const ROAD_W = 0.5;
const ROAD_H = 0.03;
const ROAD_Y = ROAD_H / 2 + 0.004;
const BRIDGE_W = 0.62;
/** Hills overhang their tile, so portals sit this far from the land tile's centre to stay visible. */
const PORTAL_OFFSET = 0.25;

const box = new THREE.BoxGeometry(1, 1, 1);
const disc = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
const arch = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, 0, Math.PI);

type Piece = { geo: THREE.BufferGeometry; color: string; shadow?: boolean; matrices: THREE.Matrix4[] };

/** Builds road, bridge and tunnel-portal meshes from the road network, plus the hover cursor. */
export class RoadRenderer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private hover: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.hover = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.hover.visible = false;
    scene.add(this.hover);
  }

  setHover(x: number, y: number, state: 'ok' | 'bad' | 'erase' | null): void {
    this.hover.visible = state !== null;
    if (!state) return;
    const mat = this.hover.material as THREE.MeshBasicMaterial;
    mat.color.set(state === 'ok' ? '#ffffff' : state === 'bad' ? '#e25b4b' : '#3a3d42');
    mat.opacity = state === 'ok' ? 0.5 : 0.3;
    this.hover.position.set(x + 0.5, 0.006, y + 0.5);
  }

  rebuild(net: RoadNetwork): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.meshes = [];

    const road: Piece = { geo: box, color: PALETTE.road, matrices: [] };
    const joints: Piece = { geo: disc, color: PALETTE.road, matrices: [] };
    const deck: Piece = { geo: box, color: PALETTE.bridge, shadow: true, matrices: [] };
    const rails: Piece = { geo: box, color: PALETTE.bridgeRail, shadow: true, matrices: [] };
    const portals: Piece = { geo: arch, color: PALETTE.tunnel, shadow: true, matrices: [] };

    const terrain = (i: number) => net.terrainAt(i);
    const center = (i: number) => {
      const [x, y] = net.xy(i);
      return new THREE.Vector3(x + 0.5, 0, y + 0.5);
    };

    for (const [a, b] of net.edges()) {
      const ta = terrain(a), tb = terrain(b);
      const pa = center(a), pb = center(b);
      if (ta === Terrain.Mountain && tb === Terrain.Mountain) continue; // inside the tunnel
      if (ta === Terrain.Water || tb === Terrain.Water) {
        deck.matrices.push(segment(pa, pb, BRIDGE_W, ROAD_Y + 0.01, ROAD_H));
        for (const side of [-1, 1]) rails.matrices.push(segment(pa, pb, 0.05, ROAD_Y + 0.05, 0.07, side * (BRIDGE_W / 2 - 0.02)));
        road.matrices.push(segment(pa, pb, ROAD_W, ROAD_Y + 0.012, ROAD_H));
        continue;
      }
      road.matrices.push(segment(pa, pb, ROAD_W, ROAD_Y, ROAD_H));
      if (ta === Terrain.Mountain || tb === Terrain.Mountain) {
        // Portal sits where the road meets the foot of the hill, facing the land side.
        const [land, mtn] = ta === Terrain.Mountain ? [pb, pa] : [pa, pb];
        const dir = mtn.clone().sub(land).normalize();
        const pos = land.clone().addScaledVector(dir, PORTAL_OFFSET);
        const m = new THREE.Matrix4().compose(
          pos.setY(0),
          // Half-cylinder turned so its flat side is on the ground and its axis follows the road.
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(dir.z, dir.x), Math.PI / 2, 'YXZ')),
          new THREE.Vector3(0.62, 0.16, 0.62),
        );
        portals.matrices.push(m);
      }
    }

    for (const i of net.adj.keys()) {
      if (terrain(i) === Terrain.Mountain) continue;
      const p = center(i);
      const y = terrain(i) === Terrain.Water ? ROAD_Y + 0.012 : ROAD_Y;
      joints.matrices.push(new THREE.Matrix4().compose(p.setY(y), new THREE.Quaternion(), new THREE.Vector3(ROAD_W, ROAD_H, ROAD_W)));
    }

    for (const piece of [deck, rails, road, joints, portals]) {
      if (!piece.matrices.length) continue;
      const mesh = new THREE.InstancedMesh(piece.geo, new THREE.MeshLambertMaterial({ color: piece.color }), piece.matrices.length);
      piece.matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.receiveShadow = true;
      mesh.castShadow = !!piece.shadow;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }
}

/** A flat box from a to b, `width` wide, optionally offset sideways. */
function segment(a: THREE.Vector3, b: THREE.Vector3, width: number, y: number, h: number, side = 0): THREE.Matrix4 {
  const d = b.clone().sub(a);
  const len = d.length();
  const angle = Math.atan2(d.z, d.x);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.x += -Math.sin(angle) * side;
  mid.z += Math.cos(angle) * side;
  return new THREE.Matrix4().compose(
    mid.setY(y),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle),
    new THREE.Vector3(len, h, width),
  );
}
