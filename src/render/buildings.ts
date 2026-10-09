import * as THREE from 'three';
import { Buildings, CAPACITY, Destination, Dir, House, destTiles } from '../sim/buildings';
import { CONFIG } from '../sim/game';
import { PALETTE, shade } from './palette';
import { gableRoof, roundedBox, roundedRect, roundedSlab, slab } from './shapes';

const HOUSE_W = 0.5;
const WALL_H = 0.2;
const ROOF_H = 0.24;
const DEST_H = 0.36;
const PIN_R = 0.08;
const POP_TIME = 0.5;

/** Overshoots past 1 then settles: a springy pop. */
function easeOutBack(t: number): number {
  const c = 1.9;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

// Shared geometry: built once, reused by every building.
const wallGeo = roundedBox(HOUSE_W, WALL_H, HOUSE_W * 0.86, 0.04).translate(0, WALL_H / 2, 0);
const roofGeo = gableRoof(HOUSE_W + 0.06, HOUSE_W * 0.86 + 0.08, ROOF_H);
const chimneyGeo = roundedBox(0.07, 0.12, 0.07, 0.015);
const padGeo = roundedSlab(0.74, 0.74, 0.02, 0.12, 0.008);
const squareGeo = roundedSlab(1.8, 0.86, DEST_H, 0.14, 0.04);
const squareRoofGeo = roundedSlab(1.56, 0.62, 0.02, 0.08, 0.008);
const circleGeo = slab(roundedRect(1.82, 0.86, 0.43), DEST_H, 0.04);
const circleRoofGeo = slab(roundedRect(1.5, 0.56, 0.28), 0.02, 0.008);
const unitGeo = roundedBox(0.16, 0.07, 0.12, 0.02);
const lotGeo = roundedSlab(1.98, 0.98, 0.026, 0.14, 0.01);
const kerbGeo = roundedBox(1.9, 0.05, 0.08, 0.025);
/** Pins: a white puck sitting on a slightly larger dark rim, readable on every building colour. */
const pinGeo = new THREE.CylinderGeometry(PIN_R, PIN_R, 0.035, 18).translate(0, 0.025, 0);
const pinRimGeo = new THREE.CylinderGeometry(PIN_R + 0.018, PIN_R + 0.018, 0.02, 18).translate(0, 0.01, 0);
const RING_IN = 1.42;
const RING_OUT = 1.6;

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

/** Houses, destinations (with parking lots) and their waiting pins. */
export class BuildingRenderer {
  readonly group = new THREE.Group();
  private built = 0;
  /** Meshes per house, so a turned house can be rebuilt facing its new way. */
  private houseMeshes = new Map<number, { dir: Dir; meshes: THREE.Mesh[] }>();
  private pinLayout: { pos: THREE.Vector3; born: number }[] = [];
  private pinBorn = new Map<number, number[]>();
  private popping: { meshes: THREE.Mesh[]; scales: THREE.Vector3[]; born: number }[] = [];
  /** Entrance stubs per destination, recoloured when roads reach them. */
  private entranceMeshes = new Map<number, { access: number; mesh: THREE.Mesh }[]>();
  private pins: THREE.InstancedMesh;
  private pinRims: THREE.InstancedMesh;
  private colorMats = PALETTE.colors.map((c) => new THREE.MeshLambertMaterial({ color: c }));
  /** Lighter tint for roofs of destinations and the walls of houses. */
  private paleMats = PALETTE.colors.map((c) => new THREE.MeshLambertMaterial({ color: shade(c, 0.1, -0.08) }));
  private wallMats = PALETTE.colors.map((c) => new THREE.MeshLambertMaterial({ color: shade(c, 0.32, -0.25) }));
  /** Per colour: [sunny slope, shaded slope]. */
  private roofMats = PALETTE.colors.map((c) => [
    new THREE.MeshLambertMaterial({ color: shade(c, 0.04) }),
    new THREE.MeshLambertMaterial({ color: shade(c, -0.1) }),
  ]);
  private roadMat = new THREE.MeshLambertMaterial({ color: PALETTE.road });
  private padMat = new THREE.MeshLambertMaterial({ color: PALETTE.pad });
  private parkingMat = new THREE.MeshLambertMaterial({ color: PALETTE.parking });
  private stubMat = new THREE.MeshLambertMaterial({ color: PALETTE.pad });
  private curbMat = new THREE.MeshLambertMaterial({ color: PALETTE.curb });
  private lineMat = new THREE.MeshLambertMaterial({ color: PALETTE.parkingLine });
  private unitMat = new THREE.MeshLambertMaterial({ color: '#f4f1ea' });
  private chimneyMat = new THREE.MeshLambertMaterial({ color: '#8a8173' });
  private ringBgMat = new THREE.MeshBasicMaterial({ color: PALETTE.warning, transparent: true, opacity: 0.18, depthWrite: false });
  private ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.warning, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  private ringBgGeo = new THREE.RingGeometry(RING_IN, RING_OUT, 48).rotateX(-Math.PI / 2);
  /** Warning ring per overflowing destination: faint full track plus a filled arc. */
  private rings = new Map<number, { group: THREE.Group; arc: THREE.Mesh; fill: number }>();

  /** Map width, for turning tile indices into positions; set when a map loads. */
  gridW = 1;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.pins = new THREE.InstancedMesh(pinGeo, new THREE.MeshLambertMaterial({ color: PALETTE.pin }), 2048);
    this.pinRims = new THREE.InstancedMesh(pinRimGeo, new THREE.MeshLambertMaterial({ color: PALETTE.pinRim }), 2048);
    for (const m of [this.pins, this.pinRims]) {
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      scene.add(m);
    }
  }

  clear(): void {
    for (const r of this.rings.values()) r.arc.geometry.dispose();
    this.rings.clear();
    this.houseMeshes.clear();
    this.entranceMeshes.clear();
    this.pinBorn.clear();
    this.pinLayout = [];
    this.popping = [];
    this.group.clear();
    this.built = 0;
    this.pins.count = this.pinRims.count = 0;
  }

  /** Add meshes for buildings spawned since last call and refresh pins. */
  sync(b: Buildings): void {
    const all = [...b.houses, ...b.dests].sort((p, q) => p.id - q.id);
    for (const bld of all.slice(this.built)) {
      if (bld.kind === 'house') this.addHouse(bld);
      else this.addDest(bld);
    }
    this.built = all.length;
    for (const h of b.houses) {
      const rec = this.houseMeshes.get(h.id);
      if (rec && rec.dir !== h.dir) {
        for (const m of rec.meshes) this.group.remove(m);
        this.addHouse(h);
      }
    }
    this.updatePins(b.dests);
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], pos: THREE.Vector3, scale: THREE.Vector3, rotY = 0) {
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
    const first = this.group.children.length;
    const one = new THREE.Vector3(1, 1, 1);
    // Driveway from the house to the centre of its access tile, where it meets any road there.
    this.mesh(boxGeo, this.roadMat, new THREE.Vector3(cx + h.dir[0] * 0.55, 0.012, cz + h.dir[1] * 0.55), new THREE.Vector3(0.9, 0.024, 0.26), yaw);
    this.mesh(padGeo, this.padMat, new THREE.Vector3(cx, 0, cz), one, yaw);
    // Walls in a pale tint; the ridge runs across the driveway so the gable faces the street.
    this.mesh(wallGeo, this.wallMats[h.color], new THREE.Vector3(cx, 0.02, cz), one, yaw + Math.PI / 2);
    this.mesh(roofGeo, this.roofMats[h.color], new THREE.Vector3(cx, 0.02 + WALL_H, cz), one, yaw + Math.PI / 2);
    // Chimney on the back half of the roof.
    const back = new THREE.Vector3(-h.dir[0], 0, -h.dir[1]).multiplyScalar(0.12);
    const side = new THREE.Vector3(-h.dir[1], 0, h.dir[0]).multiplyScalar(0.12);
    this.mesh(chimneyGeo, this.chimneyMat, new THREE.Vector3(cx, 0.02 + WALL_H + ROOF_H * 0.62, cz).add(back).add(side), one);
    this.houseMeshes.set(h.id, { dir: h.dir, meshes: this.group.children.slice(first) as THREE.Mesh[] });
    this.popFrom(first);
  }

  private addDest(d: Destination) {
    const first = this.group.children.length;
    const { building, parking } = destTiles(d.x, d.y, d.side);
    const along = new THREE.Vector3(-d.side[1], 0, d.side[0]); // axis the two halves run along
    const yaw = Math.atan2(-along.z, along.x);
    const bc = centerOf(building), pc = centerOf(parking);
    const one = new THREE.Vector3(1, 1, 1);

    // Building: a bevelled block (stadium for circle types), a paler roof panel and rooftop units.
    const round = d.shape === 'circle';
    this.mesh(round ? circleGeo : squareGeo, this.colorMats[d.color], bc.clone(), one, yaw);
    this.mesh(round ? circleRoofGeo : squareRoofGeo, this.paleMats[d.color], bc.clone().setY(DEST_H), one, yaw);
    const across = new THREE.Vector3(d.side[0], 0, d.side[1]);
    for (const s of round ? [-0.7, 0.7] : [-0.74, 0.74]) {
      // Rooftop units sit at the ends, clear of the pins in the middle.
      this.mesh(unitGeo, this.unitMat, bc.clone().addScaledVector(along, s).setY(DEST_H + 0.055), one, yaw + Math.PI / 2);
    }

    // Parking: an asphalt lot with four nose-in bays painted along the building side, a low kerb
    // against the building, and an open aisle in front. Cars can drive in from three sides.
    this.mesh(lotGeo, this.parkingMat, pc.clone(), one, yaw);
    const back = across.clone().multiplyScalar(-1);
    this.mesh(kerbGeo, this.curbMat, pc.clone().addScaledVector(back, 0.45).setY(0.05), one, yaw);
    const LINE_Y = 0.028, BAY_DEPTH = 0.44;
    for (const s of [-0.96, -0.5, 0, 0.5, 0.96]) {
      this.mesh(boxGeo, this.lineMat, pc.clone().addScaledVector(along, s * 0.98).addScaledVector(back, 0.41 - BAY_DEPTH / 2).setY(LINE_Y),
        new THREE.Vector3(0.028, 0.004, BAY_DEPTH), yaw);
    }
    // Aisle edge line with a gap at each bay so the lot reads as a car park, not a slab.
    this.mesh(boxGeo, this.lineMat, pc.clone().addScaledVector(back, 0.41 - BAY_DEPTH).setY(LINE_Y), new THREE.Vector3(1.9, 0.004, 0.022), yaw);

    // Entrance stubs from the lot edge to each entrance's access tile; pale until a road arrives.
    const stubs: { access: number; mesh: THREE.Mesh }[] = [];
    for (const e of d.entrances) {
      const dx = (e.access % this.gridW) - (e.door % this.gridW), dz = Math.floor(e.access / this.gridW) - Math.floor(e.door / this.gridW);
      const door = new THREE.Vector3((e.door % this.gridW) + 0.5, 0.013, Math.floor(e.door / this.gridW) + 0.5);
      const mesh = this.mesh(boxGeo, this.stubMat, door.addScaledVector(new THREE.Vector3(dx, 0, dz), 0.72), new THREE.Vector3(0.56, 0.026, 0.3), dirYaw([dx, dz]));
      mesh.castShadow = false;
      stubs.push({ access: e.access, mesh });
    }
    this.entranceMeshes.set(d.id, stubs);
    this.popFrom(first);
  }

  /** Show which lot entrances are connected; call when roads change. */
  updateEntrances(hasRoad: (tile: number) => boolean): void {
    for (const stubs of this.entranceMeshes.values()) {
      for (const s of stubs) s.mesh.material = hasRoad(s.access) ? this.roadMat : this.stubMat;
    }
  }

  private updatePins(dests: Destination[]) {
    const now = performance.now() / 1000;
    this.pinLayout = [];
    for (const d of dests) {
      const { building } = destTiles(d.x, d.y, d.side);
      const bc = centerOf(building);
      const along = new THREE.Vector3(-d.side[1], 0, d.side[0]);
      const across = new THREE.Vector3(d.side[0], 0, d.side[1]);
      const perRow = 5;
      const shown = Math.min(d.pins, CAPACITY[d.shape] + CONFIG.maxExtraPins);
      const rows = Math.ceil(shown / perRow);
      // Birth times per pin slot, so new pins pop in rather than appear.
      const born = this.pinBorn.get(d.id) ?? [];
      while (born.length < shown) born.push(now);
      born.length = shown;
      this.pinBorn.set(d.id, born);
      for (let k = 0; k < shown; k++) {
        const col = k % perRow, row = Math.floor(k / perRow);
        const p = bc.clone()
          .addScaledVector(along, (col - (perRow - 1) / 2) * 0.25)
          .addScaledVector(across, (row - (rows - 1) / 2) * 0.2 + 0.02)
          .setY(DEST_H + 0.02);
        this.pinLayout.push({ pos: p, born: born[k] });
      }
    }
  }

  /** Per-frame animation: buildings popping in, pins popping in. */
  animate(): void {
    const now = performance.now() / 1000;
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const pop = this.popping[i];
      const t = Math.min(1, (now - pop.born) / POP_TIME);
      const s = Math.max(0.001, easeOutBack(t));
      pop.meshes.forEach((m, k) => m.scale.copy(pop.scales[k]).multiplyScalar(s));
      if (t >= 1) this.popping.splice(i, 1);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const n = Math.min(this.pinLayout.length, this.pins.instanceMatrix.count);
    for (let k = 0; k < n; k++) {
      const { pos, born } = this.pinLayout[k];
      m.compose(pos, q, sc.setScalar(Math.max(0.001, easeOutBack(Math.min(1, (now - born) / 0.3)))));
      this.pins.setMatrixAt(k, m);
      this.pinRims.setMatrixAt(k, m);
    }
    for (const mesh of [this.pins, this.pinRims]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Start a pop-in for meshes added since group child index `first`. */
  private popFrom(first: number) {
    const meshes = this.group.children.slice(first) as THREE.Mesh[];
    this.popping.push({ meshes, scales: meshes.map((m) => m.scale.clone()), born: performance.now() / 1000 });
    for (const m of meshes) m.scale.multiplyScalar(0.001);
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
