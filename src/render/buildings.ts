import * as THREE from 'three';
import { Buildings, CAPACITY, Destination, Dir, House, destTiles } from '../sim/buildings';
import { CONFIG } from '../sim/game';
import { PALETTE } from './palette';

const HOUSE_W = 0.56;
const HOUSE_H = 0.3;
const ROOF_H = 0.3;
const DEST_H = 0.42;
const PIN_R = 0.085;
const RING_IN = 1.42;
const RING_OUT = 1.6;

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
/** Triangular prism along local X: the house roof. */
const roofGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);

/** Houses, destinations (with parking lots) and their waiting pins. */
export class BuildingRenderer {
  readonly group = new THREE.Group();
  private built = 0;
  private pins: THREE.InstancedMesh;
  private colorMats = PALETTE.colors.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  private roofMats = PALETTE.colors.map((c) => new THREE.MeshLambertMaterial({ color: new THREE.Color(c).offsetHSL(0, -0.05, -0.06), flatShading: true }));
  private roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.road });
  private parkingMat = new THREE.MeshLambertMaterial({ color: PALETTE.parking });
  private lineMat = new THREE.MeshLambertMaterial({ color: PALETTE.parkingLine });
  private ringBgMat = new THREE.MeshBasicMaterial({ color: PALETTE.warning, transparent: true, opacity: 0.18, depthWrite: false });
  private ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.warning, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private ringBgGeo = new THREE.RingGeometry(RING_IN, RING_OUT, 48).rotateX(-Math.PI / 2);
  /** Warning ring per overflowing destination: faint full track plus a filled arc. */
  private rings = new Map<number, { group: THREE.Group; arc: THREE.Mesh; fill: number }>();

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.pins = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(PIN_R, PIN_R, 0.04, 14),
      new THREE.MeshLambertMaterial({ color: PALETTE.pin }),
      2048,
    );
    this.pins.count = 0;
    this.pins.castShadow = true;
    this.pins.frustumCulled = false;
    scene.add(this.pins);
  }

  clear(): void {
    for (const r of this.rings.values()) r.arc.geometry.dispose();
    this.rings.clear();
    this.group.clear();
    this.built = 0;
    this.pins.count = 0;
  }

  /** Add meshes for buildings spawned since last call and refresh pins. */
  sync(b: Buildings): void {
    const all = [...b.houses, ...b.dests].sort((p, q) => p.id - q.id);
    for (const bld of all.slice(this.built)) {
      if (bld.kind === 'house') this.addHouse(bld);
      else this.addDest(bld);
    }
    this.built = all.length;
    this.updatePins(b.dests);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: THREE.Vector3, scale: THREE.Vector3, rotY = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos);
    m.scale.copy(scale);
    m.rotation.y = rotY;
    m.castShadow = m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  private addHouse(h: House) {
    const cx = h.x + 0.5, cz = h.y + 0.5;
    const yaw = dirYaw(h.dir);
    // Driveway from the house to the centre of its access tile, where it meets any road there.
    this.mesh(boxGeo, this.roadMat, new THREE.Vector3(cx + h.dir[0] * 0.5, 0.01, cz + h.dir[1] * 0.5), new THREE.Vector3(1, 0.02, 0.3), yaw);
    this.mesh(boxGeo, this.colorMats[h.color], new THREE.Vector3(cx, HOUSE_H / 2, cz), new THREE.Vector3(HOUSE_W, HOUSE_H, HOUSE_W), yaw);
    // Roof ridge runs across the driveway direction.
    // roofGeo spans y in [-0.5, 1] and z in [-0.87, 0.87] before scaling.
    this.mesh(roofGeo, this.roofMats[h.color], new THREE.Vector3(cx, HOUSE_H + 0.5 * ROOF_H, cz),
      new THREE.Vector3(HOUSE_W + 0.04, ROOF_H, (HOUSE_W + 0.08) / 1.732), yaw + Math.PI / 2);
  }

  private addDest(d: Destination) {
    const { building, parking } = destTiles(d.x, d.y, d.side);
    const along = new THREE.Vector3(-d.side[1], 0, d.side[0]); // axis the two halves run along
    const yaw = Math.atan2(-along.z, along.x);
    const bc = centerOf(building), pc = centerOf(parking);

    // Building half: a long block; circle destinations get rounded ends.
    const mat = this.colorMats[d.color];
    if (d.shape === 'square') {
      this.mesh(boxGeo, mat, bc.clone().setY(DEST_H / 2), new THREE.Vector3(1.84, DEST_H, 0.84), yaw);
    } else {
      this.mesh(boxGeo, mat, bc.clone().setY(DEST_H / 2), new THREE.Vector3(1.0, DEST_H, 0.84), yaw);
      for (const s of [-0.5, 0.5]) this.mesh(cylGeo, mat, bc.clone().addScaledVector(along, s).setY(DEST_H / 2), new THREE.Vector3(0.84, DEST_H, 0.84));
    }

    // Parking half: a pad with lines between the four spots, plus a link to the access tile.
    this.mesh(boxGeo, this.parkingMat, pc.clone().setY(0.01), new THREE.Vector3(1.9, 0.02, 0.9), yaw);
    for (const s of [-0.5, 0, 0.5]) {
      this.mesh(boxGeo, this.lineMat, pc.clone().addScaledVector(along, s).setY(0.022), new THREE.Vector3(0.035, 0.005, 0.7), yaw);
    }
    const [door] = parking;
    this.mesh(boxGeo, this.roadMat, new THREE.Vector3(door[0] + 0.5 + d.side[0] * 0.5, 0.008, door[1] + 0.5 + d.side[1] * 0.5),
      new THREE.Vector3(1, 0.016, 0.34), dirYaw(d.side));
  }

  private updatePins(dests: Destination[]) {
    const m = new THREE.Matrix4();
    let n = 0;
    for (const d of dests) {
      const { building } = destTiles(d.x, d.y, d.side);
      const bc = centerOf(building);
      const along = new THREE.Vector3(-d.side[1], 0, d.side[0]);
      const across = new THREE.Vector3(d.side[0], 0, d.side[1]);
      const perRow = 5;
      const shown = Math.min(d.pins, CAPACITY[d.shape] + CONFIG.maxExtraPins);
      const rows = Math.ceil(shown / perRow);
      for (let k = 0; k < shown && n < this.pins.instanceMatrix.count; k++) {
        const col = k % perRow, row = Math.floor(k / perRow);
        const p = bc.clone()
          .addScaledVector(along, (col - (perRow - 1) / 2) * 0.24)
          .addScaledVector(across, (row - (rows - 1) / 2) * 0.19)
          .setY(DEST_H + 0.02);
        this.pins.setMatrixAt(n++, m.makeTranslation(p.x, p.y, p.z));
      }
    }
    this.pins.count = n;
    this.pins.instanceMatrix.needsUpdate = true;
  }

  /** Grow, shrink and pulse the overflow rings; call every frame. */
  updateWarnings(dests: Destination[], time: number): void {
    for (const d of dests) {
      let r = this.rings.get(d.id);
      if (d.overflow <= 0) {
        if (r) {
          r.arc.geometry.dispose();
          this.group.remove(r.group);
          this.rings.delete(d.id);
        }
        continue;
      }
      if (!r) {
        const group = new THREE.Group();
        group.position.set(d.x + 1, 0.05, d.y + 1);
        const bg = new THREE.Mesh(this.ringBgGeo, this.ringBgMat);
        const arc = new THREE.Mesh(new THREE.BufferGeometry(), this.ringMat);
        bg.renderOrder = arc.renderOrder = 2;
        group.add(bg, arc);
        this.group.add(group);
        r = { group, arc, fill: -1 };
        this.rings.set(d.id, r);
      }
      if (Math.abs(r.fill - d.overflow) > 0.004) {
        r.fill = d.overflow;
        r.arc.geometry.dispose();
        // Fills clockwise from 12 o'clock as seen from above.
        r.arc.geometry = new THREE.RingGeometry(RING_IN, RING_OUT, 64, 1, Math.PI / 2, -Math.PI * 2 * d.overflow).rotateX(-Math.PI / 2);
      }
    }
    // Pulse faster as the worst ring nears full.
    const worst = Math.max(0, ...dests.map((d) => d.overflow));
    this.ringMat.opacity = 0.75 + 0.25 * Math.sin(time * (4 + worst * 10));
  }
}

export function dirYaw(d: Dir): number {
  return Math.atan2(-d[1], d[0]);
}

function centerOf(tiles: [number, number][]): THREE.Vector3 {
  const x = tiles.reduce((s, t) => s + t[0], 0) / tiles.length + 0.5;
  const z = tiles.reduce((s, t) => s + t[1], 0) / tiles.length + 0.5;
  return new THREE.Vector3(x, 0, z);
}
