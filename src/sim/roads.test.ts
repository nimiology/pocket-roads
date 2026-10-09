import { describe, expect, it } from 'vitest';
import { Grid, Terrain } from './grid';
import { Inventory, RoadNetwork } from './roads';

/** 10x6 grid with a 2-wide vertical river at x=4..5 and a mountain at x=8, y=0..5. */
function setup(inv: Partial<Inventory> = {}) {
  const g = new Grid(10, 6);
  for (let y = 0; y < 6; y++) {
    g.set(4, y, Terrain.Water);
    g.set(5, y, Terrain.Water);
    g.set(8, y, Terrain.Mountain);
  }
  const net = new RoadNetwork(g, { roads: 20, bridges: 1, tunnels: 1, roundabouts: 0, lights: 0, motorways: 0, ...inv });
  const at = (x: number, y: number) => net.idx(x, y);
  /** Draw a stroke through the given tiles; returns how many steps succeeded. */
  const stroke = (...pts: [number, number][]) => {
    if (!net.placeTile(at(...pts[0]))) return 0;
    let ok = 1;
    for (let k = 1; k < pts.length; k++) {
      if (!net.connect(at(...pts[k - 1]), at(...pts[k]))) break;
      ok++;
    }
    return ok;
  };
  return { g, net, at, stroke };
}

describe('RoadNetwork', () => {
  it('charges one road tile per land tile and refunds on removal', () => {
    const { net, at, stroke } = setup();
    expect(stroke([0, 0], [1, 0], [2, 0], [2, 1])).toBe(4);
    expect(net.available().roads).toBe(16);
    net.removeTile(at(1, 0));
    expect(net.available().roads).toBe(17);
    expect(net.hasEdge(at(0, 0), at(1, 0))).toBe(false);
  });

  it('stops drawing when out of road tiles', () => {
    const { net, stroke } = setup({ roads: 2, bridges: 0, tunnels: 0 });
    expect(stroke([0, 0], [1, 0], [2, 0])).toBe(2);
    expect(net.available().roads).toBe(0);
  });

  it('connecting two existing tiles is free', () => {
    const { net, at, stroke } = setup();
    stroke([0, 0], [1, 0]);
    stroke([0, 1], [1, 1]);
    const before = net.available().roads;
    expect(net.connect(at(0, 0), at(0, 1))).toBe(true);
    expect(net.available().roads).toBe(before);
  });

  it('rejects crossing diagonals', () => {
    const { net, at, stroke } = setup();
    stroke([0, 0], [1, 1]);
    stroke([1, 0]);
    expect(net.connect(at(1, 0), at(0, 1))).toBe(false);
  });

  it('uses one bridge per water crossing regardless of length', () => {
    const { net, stroke } = setup();
    expect(stroke([2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2])).toBe(6);
    expect(net.used()).toMatchObject({ roads: 4, bridges: 1, tunnels: 0 });
  });

  it('cannot start a second bridge without inventory', () => {
    const { stroke } = setup();
    stroke([3, 0], [4, 0], [5, 0], [6, 0]);
    expect(stroke([3, 3], [4, 3])).toBe(1);
  });

  it('requires bridges to be straight with no junctions', () => {
    const { net, at, stroke } = setup({ roads: 20, bridges: 2, tunnels: 0 });
    stroke([3, 2], [4, 2]);
    expect(net.connect(at(4, 2), at(5, 3))).toBe(false); // turn on water
    expect(net.connect(at(4, 2), at(5, 2))).toBe(true);
    stroke([3, 1]);
    expect(net.connect(at(3, 1), at(4, 2))).toBe(false); // junction on water
  });

  it('removing any bridge tile removes the whole bridge', () => {
    const { net, at, stroke } = setup();
    stroke([3, 2], [4, 2], [5, 2], [6, 2]);
    net.removeTile(at(5, 2));
    expect(net.hasTile(at(4, 2))).toBe(false);
    expect(net.hasTile(at(3, 2))).toBe(true);
    expect(net.available().bridges).toBe(1);
  });

  it('prunes bridges that do not reach the far bank', () => {
    const { net, at, stroke } = setup();
    stroke([3, 2], [4, 2]);
    net.pruneDanglingSpans();
    expect(net.hasTile(at(4, 2))).toBe(false);
    expect(net.available().bridges).toBe(1);
  });

  it('builds tunnels through mountains', () => {
    const { net, stroke } = setup();
    expect(stroke([7, 1], [8, 1], [9, 1])).toBe(3);
    net.pruneDanglingSpans();
    expect(net.used().tunnels).toBe(1);
  });

  it('respects isBuildable', () => {
    const { net, at, stroke } = setup();
    net.isBuildable = (x) => x < 2;
    expect(stroke([0, 0], [1, 0], [2, 0])).toBe(2);
    expect(net.placeTile(at(3, 3))).toBe(false);
  });

  it('places junction tools only on junctions, and refunds them once traffic clears', () => {
    const { net, at, stroke } = setup({ roundabouts: 1, lights: 1 });
    stroke([0, 2], [1, 2], [2, 2], [3, 2]);
    stroke([2, 0], [2, 1], [2, 2]);
    expect(net.placeSpecial(at(1, 2), 'light')).toBe(false); // only two links
    expect(net.placeSpecial(at(2, 2), 'roundabout')).toBe(true);
    expect(net.placeSpecial(at(2, 2), 'light')).toBe(false); // occupied
    net.inventory.roundabouts = 2;
    stroke([3, 1], [3, 2]);
    expect(net.placeSpecial(at(3, 2), 'roundabout')).toBe(false); // right next to another roundabout
    net.inventory.roundabouts = 1;
    expect(net.available().roundabouts).toBe(0);
    net.closeSpecial(at(2, 2));
    expect(net.specialAt(at(2, 2))).toBeNull();
    net.finishClosing(() => true);
    expect(net.available().roundabouts).toBe(0); // still busy
    net.finishClosing(() => false);
    expect(net.available().roundabouts).toBe(1);
  });

  it('builds motorways between road tiles, never over mountains', () => {
    const { net, at, stroke } = setup({ roads: 40, motorways: 2 });
    stroke([0, 0], [0, 1]);
    stroke([7, 1], [7, 2]);
    stroke([9, 1], [9, 2]);
    stroke([1, 1], [2, 1]);
    expect(net.motorwayProblem(at(0, 1), at(2, 1))).toBe('too short');
    expect(net.motorwayProblem(at(0, 1), at(9, 1))).toBe('crosses a mountain');
    net.isBuildable = (x, y) => !(x === 3 && y === 1); // a building in the way
    expect(net.motorwayProblem(at(0, 1), at(7, 1))).toBe('blocked by a building');
    net.isBuildable = () => true;
    expect(net.placeMotorway(at(0, 1), at(7, 1))).toBe(true); // over the river is fine
    expect(net.available().motorways).toBe(1);
    expect(net.motorwayNear(3.5, 1.5)).toBe(net.motorways[0]);
    net.removeTile(at(7, 1));
    expect(net.motorways).toHaveLength(0);
  });
});
