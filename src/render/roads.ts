import * as THREE from 'three';
import { Terrain } from '../sim/grid';
import { RoadNetwork } from '../sim/roads';
import { approachAxis } from '../sim/traffic';
import { PALETTE } from './palette';

const ROAD_W = 0.5;
const ROAD_H = 0.03;
const ROAD_Y = ROAD_H / 2 + 0.004;
const BRIDGE_W = 0.62;
/** Hills overhang their tile, so portals sit this far from the land tile's centre to stay visible. */
const PORTAL_OFFSET = 0.25;
/** Height of a motorway deck, and how far its ramps run from each end. */
export const DECK_Y = 0.26;
export const RAMP = 1.15;

/** Deck height `t` tiles along a motorway of length `len`: an S-curve up each ramp, so it peels off the road smoothly. */
export function deckHeight(t: number, len: number): number {
  const s = Math.max(0, Math.min(1, t / RAMP, (len - t) / RAMP));
  return DECK_Y * s * s * (3 - 2 * s);
}

/** How far the deck swings to the side of the a→b line, so each end branches off the road below it. */
export const DECK_SWING = 0.5;
/** Sideways offset `t` along a motorway (towards the right of travel from its lower-index end), and its slope. */
export function deckSwing(t: number, len: number): { off: number; slope: number } {
  const up = t < len / 2;
  const u = up ? t / RAMP : (len - t) / RAMP;
  if (u >= 1) return { off: DECK_SWING, slope: 0 };
  const s = Math.max(0, u);
  return { off: DECK_SWING * s * s * (3 - 2 * s), slope: (up ? 1 : -1) * DECK_SWING * 6 * s * (1 - s) / RAMP };
}
const DECK_W = 0.44;
const ROUNDABOUT_R = 0.62;
const LAMP_OFFSET = 0.4;

const box = new THREE.BoxGeometry(1, 1, 1);
const disc = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
const arch = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1, false, 0, Math.PI);

type Piece = { geo: THREE.BufferGeometry; color: string; shadow?: boolean; mat?: THREE.Material; matrices: THREE.Matrix4[] };

/** Motorway look: translucent amber glass with a glossy clear coat, gold rails, frosted pillars. */
const GLASS_DECK = new THREE.MeshPhysicalMaterial({
  color: '#e9b545', emissive: '#a86a00', emissiveIntensity: 0.12, metalness: 0.1, roughness: 0.45,
  clearcoat: 0.3, clearcoatRoughness: 0.4, transparent: true, opacity: 0.9, depthWrite: false,
});
const GOLD_RAIL = new THREE.MeshStandardMaterial({ color: '#e8c26a', emissive: '#8a5c08', emissiveIntensity: 0.15, metalness: 0.4, roughness: 0.45 });
const GLASS_PILLAR = new THREE.MeshPhysicalMaterial({
  color: '#ffe9a8', emissive: '#d99a2b', emissiveIntensity: 0.15, roughness: 0.25, clearcoat: 1,
  transparent: true, opacity: 0.5, depthWrite: false,
});

/** Builds road, bridge and tunnel-portal meshes from the road network, plus the hover cursor. */
export class RoadRenderer {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  /** One-off motorway meshes (curved ramps), which own their geometry. */
  private ribbons: THREE.Mesh[] = [];
  private hover: THREE.Mesh;
  private preview: THREE.Mesh;
  /** Traffic-light lamps, recoloured each frame: one per road arm, at that arm's stop line. */
  private lamps: THREE.InstancedMesh;
  private lampInfo: { node: number; axis: 0 | 1 }[] = [];
  private lampColors = { green: new THREE.Color('#3db58a'), amber: new THREE.Color('#f2b230'), red: new THREE.Color('#e5483a') };

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.hover = new THREE.Mesh(
      new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45, depthWrite: false }),
    );
    this.hover.visible = false;
    scene.add(this.hover);
    this.preview = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false }));
    this.preview.visible = false;
    scene.add(this.preview);
    this.lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 12, 8), new THREE.MeshBasicMaterial(), 512);
    for (let i = 0; i < 512; i++) this.lamps.setColorAt(i, this.lampColors.red);
    this.lamps.count = 0;
    this.lamps.frustumCulled = false;
    scene.add(this.lamps);
  }

  /** Ghost of a motorway being dragged from tile `a` to point `b` (tile coords). */
  setMotorwayPreview(a: [number, number] | null, b?: [number, number], ok?: boolean): void {
    this.preview.visible = !!a;
    if (!a || !b) return;
    (this.preview.material as THREE.MeshBasicMaterial).color.set(ok ? '#ffffff' : '#e25b4b');
    const pa = new THREE.Vector3(a[0] + 0.5, 0, a[1] + 0.5), pb = new THREE.Vector3(b[0] + 0.5, 0, b[1] + 0.5);
    this.preview.matrix.copy(segment(pa, pb, DECK_W, DECK_Y, 0.04));
    this.preview.matrixAutoUpdate = false;
  }

  /** Recolour traffic lights from each junction's current state. */
  updateLights(state: (node: number) => { axis: 0 | 1; green: boolean; amber: boolean } | null): void {
    this.lampInfo.forEach(({ node, axis }, k) => {
      const l = state(node);
      // An unused light rests on red for everyone; it turns green the moment a car arrives.
      const c = !l || l.axis !== axis ? this.lampColors.red : l.green ? this.lampColors.green : l.amber ? this.lampColors.amber : this.lampColors.red;
      this.lamps.setColorAt(k, c);
    });
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  setHover(x: number, y: number, state: 'ok' | 'bad' | 'erase' | null): void {
    this.hover.visible = state !== null;
    if (!state) return;
    const mat = this.hover.material as THREE.MeshBasicMaterial;
    mat.color.set(state === 'ok' ? '#ffffff' : state === 'bad' ? '#e25b4b' : '#3a3d42');
    mat.opacity = state === 'ok' ? 0.5 : 0.3;
    this.hover.position.set(x + 0.5, 0.006, y + 0.5);
  }

  private addRibbon(secs: Section[], right: THREE.Vector3, mat: THREE.Material, shadow: boolean) {
    const mesh = new THREE.Mesh(ribbonGeometry(secs, right), mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.ribbons.push(mesh);
  }

  rebuild(net: RoadNetwork): void {
    for (const m of this.meshes) {
      this.group.remove(m);
      m.dispose();
    }
    this.meshes = [];
    for (const r of this.ribbons) {
      this.group.remove(r);
      r.geometry.dispose();
    }
    this.ribbons = [];

    const road: Piece = { geo: box, color: PALETTE.road, matrices: [] };
    const joints: Piece = { geo: disc, color: PALETTE.road, matrices: [] };
    const deck: Piece = { geo: box, color: PALETTE.bridge, shadow: true, matrices: [] };
    const rails: Piece = { geo: box, color: PALETTE.bridgeRail, shadow: true, matrices: [] };
    const portals: Piece = { geo: arch, color: PALETTE.tunnel, shadow: true, matrices: [] };
    const rounds: Piece = { geo: disc, color: PALETTE.road, matrices: [] };
    const islands: Piece = { geo: disc, color: PALETTE.island, shadow: true, matrices: [] };
    const pillars: Piece = { geo: box, color: PALETTE.pillar, mat: GLASS_PILLAR, matrices: [] };
    const stripes: Piece = { geo: box, color: PALETTE.parkingLine, matrices: [] };
    const poles: Piece = { geo: box, color: PALETTE.bridgeRail, matrices: [] };

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

    // Junction tools.
    const lampMatrices: THREE.Matrix4[] = [];
    this.lampInfo = [];
    for (const [i, sp] of net.specials) {
      if (sp.closing) continue;
      const p = center(i);
      if (sp.kind === 'roundabout') {
        rounds.matrices.push(new THREE.Matrix4().compose(p.clone().setY(ROAD_Y + 0.002), new THREE.Quaternion(), new THREE.Vector3(ROUNDABOUT_R * 2, ROAD_H, ROUNDABOUT_R * 2)));
        islands.matrices.push(new THREE.Matrix4().compose(p.clone().setY(ROAD_Y + 0.03), new THREE.Quaternion(), new THREE.Vector3(0.46, 0.06, 0.46)));
      } else {
        for (const n of net.neighbors(i)) {
          // Lamp on the kerb to the right of traffic coming in along this arm, near the stop line.
          const [nx, ny] = net.xy(n);
          const dir = new THREE.Vector3(nx + 0.5 - p.x, 0, ny + 0.5 - p.z).normalize();
          const right = new THREE.Vector3(-dir.z, 0, dir.x);
          const lp = p.clone().addScaledVector(dir, LAMP_OFFSET).addScaledVector(right, -0.3);
          poles.matrices.push(new THREE.Matrix4().compose(lp.clone().setY(0.07), new THREE.Quaternion(), new THREE.Vector3(0.04, 0.14, 0.04)));
          lampMatrices.push(new THREE.Matrix4().makeTranslation(lp.x, 0.17, lp.z));
          this.lampInfo.push({ node: i, axis: approachAxis(n, i, net.grid.w) });
        }
      }
    }
    lampMatrices.forEach((m, k) => this.lamps.setMatrixAt(k, m));
    this.lamps.count = lampMatrices.length;
    this.lamps.instanceMatrix.needsUpdate = true;

    // Motorways: ramps up from each end, a flat deck, pillars underneath.
    for (const m of net.motorways) {
      if (m.closing) continue;
      // Orient from the lower tile index, so the deck swings to the same side cars expect.
      const [lo, hi] = m.a < m.b ? [m.a, m.b] : [m.b, m.a];
      const pa = center(lo), pb = center(hi);
      const dir = pb.clone().sub(pa);
      const len = dir.length();
      dir.normalize();
      const ra = pa.clone().addScaledVector(dir, RAMP), rb = pb.clone().addScaledVector(dir, -RAMP);
      const right = new THREE.Vector3(-dir.z, 0, dir.x);
      // Sample along the length, densely on the ramps. Each end starts as wide as the road and
      // flush with it, then narrows and rises on an S-curve, like a slip road branching off.
      const ts: number[] = [];
      const steps = 14;
      for (let k = 0; k <= steps; k++) ts.push((k / steps) * RAMP);
      for (let k = steps; k >= 0; k--) ts.push(len - (k / steps) * RAMP);
      const ramp = (t: number) => Math.max(0, Math.min(1, t / RAMP, (len - t) / RAMP));
      const smooth = (s: number) => s * s * (3 - 2 * s);
      const deckSec: Section[] = [], railSecs: Section[][] = [[], []];
      for (const t of ts) {
        const c = pa.clone().addScaledVector(dir, t).addScaledVector(right, deckSwing(t, len).off);
        const e = smooth(ramp(t));
        const top = ROAD_Y + 0.004 + (DECK_Y - ROAD_Y) * e;
        const halfW = (ROAD_W + 0.08) / 2 + (DECK_W - ROAD_W - 0.08) / 2 * e;
        deckSec.push({ c, top, halfW, bottom: Math.max(ROAD_Y, top - 0.06) });
        // Rails grow out of the deck edge as it climbs.
        const railH = 0.045 * smooth(Math.min(1, ramp(t) * 2.5));
        railSecs.forEach((sec, i) => sec.push({
          c: c.clone().addScaledVector(right, (i ? 1 : -1) * (halfW - 0.015)),
          top: top + railH, halfW: 0.015, bottom: top - 0.002,
        }));
      }
      this.addRibbon(deckSec, right, GLASS_DECK, true);
      for (const sec of railSecs) this.addRibbon(sec, right, GOLD_RAIL, true);
      ra.addScaledVector(right, DECK_SWING);
      rb.addScaledVector(right, DECK_SWING);
      stripes.matrices.push(beam(ra.clone().setY(DECK_Y + 0.004), rb.clone().setY(DECK_Y + 0.004), 0.035, 0.004));
      const n = Math.max(1, Math.round((len - 2 * RAMP) / 1.4));
      for (let k = 0; k <= n; k++) {
        const q = ra.clone().lerp(rb, k / n);
        // Stop short of the deck's underside so the tops don't show through it.
        const top = DECK_Y - 0.07;
        pillars.matrices.push(new THREE.Matrix4().compose(q.setY(top / 2), new THREE.Quaternion(), new THREE.Vector3(0.12, top, 0.12)));
      }
    }

    for (const piece of [deck, rails, road, joints, portals, rounds, islands, pillars, stripes, poles]) {
      if (!piece.matrices.length) continue;
      const mesh = new THREE.InstancedMesh(piece.geo, piece.mat ?? new THREE.MeshLambertMaterial({ color: piece.color }), piece.matrices.length);
      piece.matrices.forEach((m, k) => mesh.setMatrixAt(k, m));
      mesh.receiveShadow = true;
      mesh.castShadow = !!piece.shadow;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
  }
}

type Section = { c: THREE.Vector3; top: number; bottom: number; halfW: number };

/** A solid strip through cross-sections (top, sides, underside), each a smooth-shaded face. */
function ribbonGeometry(secs: Section[], right: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  const corner = (s: Section, side: number, y: number) => {
    const p = s.c.clone().addScaledVector(right, side * s.halfW);
    return [p.x, y, p.z];
  };
  // Each face is its own strip of vertex pairs so edges stay crisp. Winding faces outward.
  const faces: [(s: Section) => number[], (s: Section) => number[]][] = [
    [(s) => corner(s, 1, s.top), (s) => corner(s, -1, s.top)],
    [(s) => corner(s, -1, s.top), (s) => corner(s, -1, s.bottom)],
    [(s) => corner(s, 1, s.bottom), (s) => corner(s, 1, s.top)],
    [(s) => corner(s, -1, s.bottom), (s) => corner(s, 1, s.bottom)],
  ];
  for (const [l, r] of faces) {
    const base = pos.length / 3;
    for (const s of secs) pos.push(...l(s), ...r(s));
    for (let k = 0; k + 1 < secs.length; k++) {
      const a = base + 2 * k;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A box from a to b (which may differ in height), `width` wide and `h` thick. */
function beam(a: THREE.Vector3, b: THREE.Vector3, width: number, h: number): THREE.Matrix4 {
  const d = b.clone().sub(a);
  const flat = Math.hypot(d.x, d.z);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(d.z, d.x));
  const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(d.y, flat));
  const mid = a.clone().add(b).multiplyScalar(0.5);
  // Sink the box by half its thickness so its top surface runs from a to b.
  return new THREE.Matrix4().compose(mid.setY(mid.y - h / 2), yaw.multiply(pitch), new THREE.Vector3(d.length(), h, width));
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
