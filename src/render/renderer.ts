import * as THREE from 'three';
import { Bounds, Terrain, boundsHeight, boundsWidth, inBounds } from '../sim/grid';
import { MapData } from '../sim/mapgen';
import { mulberry32 } from '../sim/rng';
import { PALETTE } from './palette';

const LAND_TOP = 0;
const WATER_TOP = -0.14;
const TILE_DEPTH = 0.5;
/** Camera offset direction: mostly overhead with a slight tilt toward the viewer. */
const CAM_OFFSET = new THREE.Vector3(0, 40, 12);
const OUTSIDE_FADE = 0.6;
const HILL_R = 0.82;

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
  private hills?: THREE.InstancedMesh;
  private hillTiles: number[] = [];
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
    this.scene.add(this.sun, this.sun.target, this.mapGroup);
  }

  setMap(map: MapData): void {
    this.map = map;
    this.mapGroup.clear();
    this.tiles?.dispose();
    this.hills?.dispose();
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

    // Mountains: a faceted hill on each mountain tile, with jittered size so ranges look organic.
    this.hillTiles = [];
    for (let i = 0; i < grid.terrain.length; i++) if (grid.terrain[i] === Terrain.Mountain) this.hillTiles.push(i);
    const hillGeo = new THREE.SphereGeometry(HILL_R, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const hillMat = new THREE.MeshLambertMaterial();
    this.hills = new THREE.InstancedMesh(hillGeo, hillMat, Math.max(1, this.hillTiles.length));
    this.hills.count = this.hillTiles.length;
    this.hills.castShadow = true;
    this.hills.receiveShadow = true;
    const rng = mulberry32(map.seed);
    const q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    this.hillTiles.forEach((idx, i) => {
      const x = idx % grid.w, y = Math.floor(idx / grid.w);
      const height = 0.22 + rng() * 0.3;
      q.setFromEuler(new THREE.Euler(0, rng() * Math.PI * 2, 0));
      s.set(1 + rng() * 0.15, height / HILL_R, 1 + rng() * 0.15);
      p.set(x + 0.5 + (rng() - 0.5) * 0.15, 0, y + 0.5 + (rng() - 0.5) * 0.15);
      this.hills!.setMatrixAt(i, m.compose(p, q, s));
    });
    this.mapGroup.add(this.hills);

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
    if (!map || !this.tiles || !this.hills) return;
    const { grid } = map;
    const outside = new THREE.Color(PALETTE.outside);
    const c = new THREE.Color();
    const tint = (base: string, x: number, y: number) =>
      c.set(base).lerp(outside, inBounds(b, x, y) ? 0 : OUTSIDE_FADE);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const t = grid.get(x, y);
        const base = t === Terrain.Water ? PALETTE.water : t === Terrain.Mountain ? PALETTE.mountainBase : PALETTE.land;
        this.tiles.setColorAt(y * grid.w + x, tint(base, x, y));
      }
    }
    this.hillTiles.forEach((idx, i) => {
      this.hills!.setColorAt(i, tint(PALETTE.mountain, idx % grid.w, Math.floor(idx / grid.w)));
    });
    this.tiles.instanceColor!.needsUpdate = true;
    if (this.hills.instanceColor) this.hills.instanceColor.needsUpdate = true;

    this.buildGridLines(b);

    this.viewTarget.x = (b.x0 + b.x1) / 2;
    this.viewTarget.z = (b.y0 + b.y1) / 2;
    this.viewTarget.height = this.fitHeight(b);
    if (instant) Object.assign(this.view, this.viewTarget);
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
