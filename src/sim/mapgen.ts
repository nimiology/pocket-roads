import { Bounds, Grid, Terrain, boundsHeight, boundsWidth } from './grid';
import { Rng, makeNoise2D, mulberry32 } from './rng';

export interface MapData {
  seed: number;
  grid: Grid;
  /** Playable area for each growth stage; stage 0 is the starting area, the last is the full map. */
  stages: Bounds[];
}

export const MAP_W = 50;
export const MAP_H = 32;
const START_W = 16;
const START_H = 10;

export function generateMap(seed: number): MapData {
  // Retry deterministically until the starting area is mostly buildable land.
  for (let attempt = 0; attempt < 32; attempt++) {
    const map = tryGenerate(seed, attempt);
    const start = map.stages[0];
    const land = map.grid.count(Terrain.Land, start) / (boundsWidth(start) * boundsHeight(start));
    if (land >= 0.7) return map;
  }
  return tryGenerate(seed, 0);
}

function tryGenerate(seed: number, attempt: number): MapData {
  const rng = mulberry32(seed * 7919 + attempt * 104729);
  const grid = new Grid(MAP_W, MAP_H);
  const stages = growthStages();

  carveRiver(grid, rng, 1.8 + rng() * 0.8);
  const extra = rng();
  if (extra < 0.4) carveRiver(grid, rng, 1.1 + rng() * 0.4);
  else if (extra < 0.8) carveLake(grid, rng, stages[0]);
  placeMountains(grid, rng, stages[0]);

  return { seed, grid, stages };
}

function growthStages(): Bounds[] {
  const stages: Bounds[] = [];
  let w = START_W, h = START_H;
  for (;;) {
    const x0 = Math.floor((MAP_W - w) / 2), y0 = Math.floor((MAP_H - h) / 2);
    stages.push({ x0, y0, x1: x0 + w, y1: y0 + h });
    if (w >= MAP_W && h >= MAP_H) return stages;
    w = Math.min(MAP_W, w + 4);
    h = Math.min(MAP_H, h + 2 + (stages.length % 2));
  }
}

/** A meandering river crossing the whole map, horizontally or vertically. */
function carveRiver(grid: Grid, rng: Rng, width: number): void {
  const vertical = rng() < 0.5;
  const along = vertical ? grid.h : grid.w;
  const across = vertical ? grid.w : grid.h;
  const noise = makeNoise2D(rng, 2);
  const base = across * (0.25 + rng() * 0.5);
  const amp = across * (0.15 + rng() * 0.15);
  const row = rng() * 100;
  for (let u = 0; u < along; u++) {
    const center = base + (noise(u * 0.05, row) - 0.5) * 2 * amp;
    const half = (width + (noise(u * 0.2, row + 50) - 0.5) * 0.6) / 2;
    for (let v = 0; v < across; v++) {
      if (Math.abs(v + 0.5 - center) <= half) {
        const [x, y] = vertical ? [v, u] : [u, v];
        grid.set(x, y, Terrain.Water);
      }
    }
  }
}

/** A blobby lake placed away from the starting area. */
function carveLake(grid: Grid, rng: Rng, start: Bounds): void {
  const noise = makeNoise2D(rng, 2);
  let cx = 0, cy = 0;
  for (let i = 0; i < 20; i++) {
    cx = 3 + rng() * (grid.w - 6);
    cy = 3 + rng() * (grid.h - 6);
    const insideStart = cx > start.x0 - 2 && cx < start.x1 + 2 && cy > start.y0 - 2 && cy < start.y1 + 2;
    if (!insideStart) break;
  }
  const radius = 2.2 + rng() * 2;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.2);
      if (d < radius + (noise(x * 0.3, y * 0.3) - 0.5) * 2.5) grid.set(x, y, Terrain.Water);
    }
  }
}

/** Mountain ranges from thresholded noise, kept sparse near the start and off the water's edge. */
function placeMountains(grid: Grid, rng: Rng, start: Bounds): void {
  const noise = makeNoise2D(rng, 3);
  const scx = (start.x0 + start.x1) / 2, scy = (start.y0 + start.y1) / 2;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (grid.get(x, y) !== Terrain.Land || nearWater(grid, x, y)) continue;
      const distStart = Math.hypot((x - scx) / 1.6, y - scy);
      const threshold = 0.64 + 0.14 * Math.max(0, 1 - distStart / 7);
      if (noise(x * 0.11, y * 0.11) > threshold) grid.set(x, y, Terrain.Mountain);
    }
  }
}

function nearWater(grid: Grid, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++)
      if (grid.contains(x + dx, y + dy) && grid.get(x + dx, y + dy) === Terrain.Water) return true;
  return false;
}
