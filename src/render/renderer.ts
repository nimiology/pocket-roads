import * as THREE from 'three';
import { Bounds, Terrain, boundsHeight, boundsWidth, inBounds } from '../sim/grid';
import { MapData } from '../sim/mapgen';
import { mulberry32 } from '../sim/rng';
import { PALETTE } from './palette';

/** Instanced scenery whose instances each belong to a tile, so they can fade outside the play area. */
interface Scenery {
  mesh: THREE.InstancedMesh;
  tiles: number[];
  colors: string[];
}

const TRUNK_GEO = new THREE.CylinderGeometry(0.025, 0.035, 0.12, 6).translate(0, 0.06, 0);
/** Canopy styles: round, tall cone, squat cone. */
const CANOPY_GEOS = [
  new THREE.IcosahedronGeometry(0.13, 0).translate(0, 0.2, 0),
  new THREE.ConeGeometry(0.12, 0.3, 7).translate(0, 0.25, 0),
  new THREE.ConeGeometry(0.15, 0.2, 7).translate(0, 0.19, 0),
];

/** A tree that may stand on a tile; hidden while a road or building occupies it. */
interface TreeSpot {
  tile: number;
  x: number;
  z: number;
  scale: number;
  kind: number;
}

const LAND_TOP = 0;
const WATER_TOP = -0.14;
const TILE_DEPTH = 0.5;
/** Camera offset direction: mostly overhead with a slight tilt toward the viewer. */
const CAM_OFFSET = new THREE.Vector3(0, 40, 12);
const OUTSIDE_FADE = 0.6;

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  /** Camera framing: world-space point looked at, and visible world height. Smoothed toward target. */
  readonly view = { x: 0, z: 0, height: 12 };
  readonly viewTarget = { x: 0, z: 0, height: 12 };

  private sun: THREE.DirectionalLight;
  private mapGroup = new THREE.Group();
  private tiles?: THREE.InstancedMesh;
  private scenery: Scenery[] = [];
  private tileColors: string[] = [];
  private treeSpots: TreeSpot[] = [];
  private trees?: Scenery[];
  private bounds?: Bounds;
  private gridLines?: THREE.LineSegments;
  private map?: MapData;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(PALETTE.background);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);

    this.scene.add(new THREE.HemisphereLight('#ffffff', '#b3a78f', 1.6));
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.mapGroup);
  }

  setMap(map: MapData): void {
    this.map = map;
    this.mapGroup.clear();
    this.tiles?.dispose();
    for (const sc of this.scenery) sc.mesh.dispose();
    this.scenery = [];
    this.clearTrees();
    const { grid } = map;

    // Tiles: one box per tile; water tiles sit lower so the river reads as inset.
    const tileGeo = new THREE.BoxGeometry(1, TILE_DEPTH, 1);
    const tileMat = new THREE.MeshLambertMaterial();
    this.tiles = new THREE.InstancedMesh(tileGeo, tileMat, grid.w * grid.h);
    this.tiles.receiveShadow = true;
    const m = new THREE.Matrix4();
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const top = grid.get(x, y) === Terrain.Water ? WATER_TOP : LAND_TOP;
        m.makeTranslation(x + 0.5, top - TILE_DEPTH / 2, y + 0.5);
        this.tiles.setMatrixAt(y * grid.w + x, m);
      }
    }
    this.mapGroup.add(this.tiles);

    const rng = mulberry32(map.seed);
    const terr = (x: number, y: number) => (grid.contains(x, y) ? grid.get(x, y) : Terrain.Land);
    const near = (x: number, y: number, t: Terrain, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ((dx || dy) && grid.contains(x + dx, y + dy) && grid.get(x + dx, y + dy) === t) return true;
      return false;
    };

    // Water reads deeper away from the shore.
    this.tileColors = [];
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const t = grid.get(x, y);
        this.tileColors.push(t === Terrain.Water ? (near(x, y, Terrain.Land, 1) ? PALETTE.water : PALETTE.waterDeep)
          : t === Terrain.Mountain ? PALETTE.mountainBase : PALETTE.land);
      }
    }

    // Mountains: stacked terraces like contour lines; tiles deep inside a range get more tiers.
    // Wide tiers overlap their neighbours, so each level merges into one scalloped plateau.
    const tierGeo = new THREE.CylinderGeometry(1, 1.04, 1, 20);
    const tiers = [{ r: 0.76, h: 0.12 }, { r: 0.64, h: 0.11 }, { r: 0.54, h: 0.1 }];
    const tierMats: THREE.Matrix4[][] = [[], [], []];
    const tierTiles: number[][] = [[], [], []];
    const q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.get(x, y) !== Terrain.Mountain) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && terr(x + dx, y + dy) === Terrain.Mountain) n++;
        const count = n >= 8 ? 3 : n >= 5 ? 2 : 1;
        let base = 0;
        for (let k = 0; k < count; k++) {
          const { r, h } = tiers[k];
          // Same height per level (flat terraces), slight wobble in outline only.
          const jr = r * (0.96 + rng() * 0.08), jh = h;
          p.set(x + 0.5 + (rng() - 0.5) * 0.08, base + jh / 2, y + 0.5 + (rng() - 0.5) * 0.08);
          tierMats[k].push(new THREE.Matrix4().compose(p, q, sc.set(jr, jh, jr)));
          tierTiles[k].push(y * grid.w + x);
          base += jh;
        }
      }
    }
    tiers.forEach((_, k) => {
      if (!tierMats[k].length) return;
      const mesh = new THREE.InstancedMesh(tierGeo, new THREE.MeshLambertMaterial(), tierMats[k].length);
      tierMats[k].forEach((mm, i) => mesh.setMatrixAt(i, mm));
      mesh.castShadow = mesh.receiveShadow = true;
      this.addScenery(mesh, tierTiles[k], tierTiles[k].map(() => PALETTE.mountainTiers[k]));
    });

    // Shores: a sandy bank on the water side of every land edge.
    const bankMats: THREE.Matrix4[] = [], bankTiles: number[] = [];
    const bankH = LAND_TOP - WATER_TOP;
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.get(x, y) !== Terrain.Water) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!grid.contains(x + dx, y + dy) || grid.get(x + dx, y + dy) === Terrain.Water) continue;
          const w = 0.13;
          p.set(x + 0.5 + dx * (0.5 - w / 2), WATER_TOP + bankH / 2 - 0.004, y + 0.5 + dy * (0.5 - w / 2));
          sc.set(dx ? w : 1, bankH, dy ? w : 1);
          bankMats.push(new THREE.Matrix4().compose(p, q, sc));
          bankTiles.push(y * grid.w + x);
        }
      }
    }
    if (bankMats.length) {
      const banks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), bankMats.length);
      bankMats.forEach((mm, i) => banks.setMatrixAt(i, mm));
      banks.receiveShadow = true;
      this.addScenery(banks, bankTiles, bankTiles.map(() => PALETTE.sand));
    }

    // Trees: clustered along mountain feet and thinly elsewhere, never on water.
    this.treeSpots = [];
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (grid.get(x, y) !== Terrain.Land) continue;
        const chance = near(x, y, Terrain.Mountain, 1) ? 0.55 : near(x, y, Terrain.Mountain, 2) ? 0.25 : 0.05;
        if (rng() > chance) continue;
        const n = 1 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          this.treeSpots.push({
            tile: y * grid.w + x, x: x + 0.2 + rng() * 0.6, z: y + 0.2 + rng() * 0.6,
            scale: 0.75 + rng() * 0.5, kind: Math.floor(rng() * 3),
          });
        }
      }
    }

    const cx = grid.w / 2, cz = grid.h / 2;
    this.sun.position.set(cx - 14, 30, cz - 10);
    this.sun.target.position.set(cx, 0, cz);
    const r = Math.max(grid.w, grid.h) * 0.75;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 100 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Fade everything outside the playable area and frame the camera on it. */
  setBounds(b: Bounds, instant = false): void {
    const map = this.map;
    if (!map || !this.tiles) return;
    this.bounds = b;
    const { grid } = map;
    const outside = new THREE.Color(PALETTE.outside);
    const c = new THREE.Color();
    const tint = (base: string, x: number, y: number) =>
      c.set(base).lerp(outside, inBounds(b, x, y) ? 0 : OUTSIDE_FADE);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        this.tiles.setColorAt(y * grid.w + x, tint(this.tileColors[y * grid.w + x], x, y));
      }
    }
    this.tiles.instanceColor!.needsUpdate = true;
    for (const sc of [...this.scenery, ...(this.trees ?? [])]) this.tintScenery(sc);

    this.buildGridLines(b);

    this.viewTarget.x = (b.x0 + b.x1) / 2;
    this.viewTarget.z = (b.y0 + b.y1) / 2;
    this.viewTarget.height = this.fitHeight(b);
    if (instant) Object.assign(this.view, this.viewTarget);
  }

  private addScenery(mesh: THREE.InstancedMesh, tiles: number[], colors: string[]): Scenery {
    const sc = { mesh, tiles, colors };
    this.scenery.push(sc);
    this.mapGroup.add(mesh);
    this.tintScenery(sc);
    return sc;
  }

  private tintScenery(sc: Scenery) {
    const outside = new THREE.Color(PALETTE.outside), c = new THREE.Color();
    const w = this.map?.grid.w ?? 1;
    sc.tiles.forEach((t, i) => {
      const inside = !this.bounds || inBounds(this.bounds, t % w, Math.floor(t / w));
      sc.mesh.setColorAt(i, c.set(sc.colors[i]).lerp(outside, inside ? 0 : OUTSIDE_FADE));
    });
    if (sc.mesh.instanceColor) sc.mesh.instanceColor.needsUpdate = true;
  }

  private clearTrees() {
    for (const sc of this.trees ?? []) {
      this.mapGroup.remove(sc.mesh);
      sc.mesh.dispose(); // geometry is shared and kept
    }
    this.trees = undefined;
  }

  /** Show the trees whose tiles are still free; call when roads or buildings change. */
  syncTrees(isFree: (tile: number) => boolean): void {
    this.clearTrees();
    const spots = this.treeSpots.filter((s) => isFree(s.tile));
    if (!spots.length) return;
    const trunkGeo = TRUNK_GEO, canopies = CANOPY_GEOS;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial(), spots.length);
    trunks.castShadow = true;
    const make = (t: TreeSpot) => m.compose(new THREE.Vector3(t.x, 0, t.z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.x * 7.1), s.setScalar(t.scale));
    spots.forEach((t, i) => trunks.setMatrixAt(i, make(t)));
    this.trees = [{ mesh: trunks, tiles: spots.map((t) => t.tile), colors: spots.map(() => PALETTE.trunk) }];
    canopies.forEach((geo, kind) => {
      const mine = spots.filter((t) => t.kind === kind);
      if (!mine.length) return;
      const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: true }), mine.length);
      mesh.castShadow = true;
      mine.forEach((t, i) => mesh.setMatrixAt(i, make(t)));
      this.trees!.push({ mesh, tiles: mine.map((t) => t.tile), colors: mine.map((t) => PALETTE.leaves[(t.kind + Math.floor(t.z * 3)) % 3]) });
    });
    for (const sc of this.trees) {
      this.mapGroup.add(sc.mesh);
      this.tintScenery(sc);
    }
  }

  /** Visible world height needed to show bounds with a margin, given the viewport aspect. */
  fitHeight(b: Bounds): number {
    const aspect = this.aspect();
    const tilt = Math.cos(Math.atan2(CAM_OFFSET.z, CAM_OFFSET.y));
    return Math.max(boundsHeight(b) * tilt, boundsWidth(b) / aspect) * 1.12;
  }

  private buildGridLines(b: Bounds): void {
    if (this.gridLines) {
      this.mapGroup.remove(this.gridLines);
      this.gridLines.geometry.dispose();
    }
    const pts: number[] = [];
    const yy = LAND_TOP + 0.002;
    for (let x = b.x0; x <= b.x1; x++) pts.push(x, yy, b.y0, x, yy, b.y1);
    for (let y = b.y0; y <= b.y1; y++) pts.push(b.x0, yy, y, b.x1, yy, y);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: PALETTE.gridLine, transparent: true, opacity: 0.045 });
    this.gridLines = new THREE.LineSegments(geo, mat);
    this.mapGroup.add(this.gridLines);
  }

  aspect(): number {
    const el = this.renderer.domElement.parentElement!;
    return el.clientWidth / Math.max(1, el.clientHeight);
  }

  resize(): void {
    const el = this.renderer.domElement.parentElement!;
    this.renderer.setSize(el.clientWidth, el.clientHeight);
  }

  /** Convert a screen point (client px) to a world point on the ground plane. */
  screenToGround(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -LAND_TOP), hit);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 6);
    this.view.x += (this.viewTarget.x - this.view.x) * k;
    this.view.z += (this.viewTarget.z - this.view.z) * k;
    this.view.height += (this.viewTarget.height - this.view.height) * k;

    const halfH = this.view.height / 2, halfW = halfH * this.aspect();
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
    const target = new THREE.Vector3(this.view.x, 0, this.view.z);
    this.camera.position.copy(target).add(CAM_OFFSET);
    this.camera.lookAt(target);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
