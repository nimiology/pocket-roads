import { describe, expect, it } from 'vitest';
import { Terrain, boundsHeight, boundsWidth } from './grid';
import { MAP_H, MAP_W, generateMap } from './mapgen';

describe('generateMap', () => {
  it('is deterministic for a seed', () => {
    const a = generateMap(42), b = generateMap(42);
    expect(Array.from(a.grid.terrain)).toEqual(Array.from(b.grid.terrain));
  });

  it('varies between seeds', () => {
    expect(Array.from(generateMap(1).grid.terrain)).not.toEqual(Array.from(generateMap(2).grid.terrain));
  });

  it('has water on every map and a mostly-land starting area', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { grid, stages } = generateMap(seed);
      const full = { x0: 0, y0: 0, x1: MAP_W, y1: MAP_H };
      expect(grid.count(Terrain.Water, full)).toBeGreaterThan(0);
      const start = stages[0];
      const area = boundsWidth(start) * boundsHeight(start);
      expect(grid.count(Terrain.Land, start) / area).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('grows stages monotonically up to the full map', () => {
    const { stages } = generateMap(7);
    for (let i = 1; i < stages.length; i++) {
      expect(stages[i].x0).toBeLessThanOrEqual(stages[i - 1].x0);
      expect(stages[i].x1).toBeGreaterThanOrEqual(stages[i - 1].x1);
      expect(stages[i].y0).toBeLessThanOrEqual(stages[i - 1].y0);
      expect(stages[i].y1).toBeGreaterThanOrEqual(stages[i - 1].y1);
    }
    expect(stages.at(-1)).toEqual({ x0: 0, y0: 0, x1: MAP_W, y1: MAP_H });
  });
});
