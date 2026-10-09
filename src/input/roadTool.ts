import { GameRenderer } from '../render/renderer';
import { RoadRenderer } from '../render/roads';
import { DIRS4, Dir, House } from '../sim/buildings';
import { RoadNetwork } from '../sim/roads';
import { ToolKind } from '../ui/toolbar';

/** Max cursor offset on the cross axis (from tile centre) that still turns an exit into a diagonal step. */
const DIAGONAL_SLACK = 0.4;
/** Right-clicks this close to a motorway's centreline remove the motorway rather than the road below. */
const MOTORWAY_HIT = 0.3;

export interface RoadToolHooks {
  tool(): ToolKind;
  /** The selected tool ran out; fall back to drawing roads. */
  toolSpent(): void;
  houseAt(i: number): House | undefined;
  /** Building's access tile when pressing on a destination, else the tile itself. */
  strokeStart(i: number): number;
  turnHouse(h: House, dir: Dir): boolean;
  /** Whether `to` is a building that can be entered from road tile `from` (a driveway or lot entrance). */
  entersBuilding(from: number, to: number): boolean;
}

/**
 * Left-drag draws a road through the tiles under the cursor, right-drag erases.
 * Drawing advances one 8-connected step at a time toward the cursor, so fast drags leave no gaps.
 * Dragging out of a house turns its driveway to face the drag. With a junction tool selected a
 * click places it; with the motorway tool a drag links two road tiles. Right-click removes tools.
 */
export class RoadTool {
  private mode: 'draw' | 'erase' | 'motorway' | null = null;
  private current = -1;
  /** The stroke's first tile isn't placed until the drag reaches a neighbour, so a tap builds nothing. */
  private startPending = false;
  /** House the stroke started on; its facing is decided by the first drag direction. */
  private fromHouse: House | null = null;
  private motorwayStart = -1;

  constructor(
    private r: GameRenderer,
    private roads: RoadRenderer,
    private getNet: () => RoadNetwork,
    private isPanning: () => boolean,
    private hooks: RoadToolHooks,
  ) {
    const el = r.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', () => this.roads.setHover(0, 0, null));
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', () => this.cancel());
  }

  /** Abandon the current stroke (a second finger turned it into a pan or pinch). */
  private cancel() {
    if (this.mode === 'draw') this.getNet().pruneDanglingSpans();
    if (this.mode === 'motorway') this.roads.setMotorwayPreview(null);
    this.mode = null;
    this.fromHouse = null;
    this.roads.setHover(0, 0, null);
  }

  private tileAt(e: PointerEvent): { x: number; y: number; px: number; py: number } | null {
    const p = this.r.screenToGround(e.clientX, e.clientY);
    if (!p) return null;
    return { x: Math.floor(p.x), y: Math.floor(p.z), px: p.x, py: p.z };
  }

  private onDown = (e: PointerEvent) => {
    if (this.isPanning()) return this.cancel();
    if (!e.isPrimary || (e.button !== 0 && e.button !== 2)) return;
    const t = this.tileAt(e);
    const net = this.getNet();
    if (!t || !net.grid.contains(t.x, t.y)) return;
    const tile = net.idx(t.x, t.y);
    if (e.button === 2 || this.hooks.tool() === 'erase') {
      this.mode = 'erase';
      // A click on a tool takes the tool away and leaves the road under it.
      if (net.specialAt(tile)) net.closeSpecial(tile);
      else {
        const m = net.motorwayNear(t.px, t.py, MOTORWAY_HIT);
        if (m && !m.closing) net.closeMotorway(m);
        else net.removeTile(tile);
      }
      return this.updateHover(e);
    }
    const tool = this.hooks.tool();
    if (tool === 'roundabouts' || tool === 'lights') {
      if (net.placeSpecial(tile, tool === 'roundabouts' ? 'roundabout' : 'light') && net.available()[tool] <= 0) this.hooks.toolSpent();
      return this.updateHover(e);
    }
    if (tool === 'motorways') {
      if (net.hasTile(tile) && !net.isSpanTile(tile)) {
        this.mode = 'motorway';
        this.motorwayStart = tile;
      }
      return this.updateHover(e);
    }
    const house = this.hooks.houseAt(tile);
    if (house) {
      this.mode = 'draw';
      this.fromHouse = house;
      return this.updateHover(e);
    }
    const i = this.hooks.strokeStart(tile);
    const [sx, sy] = net.xy(i);
    if (net.hasTile(i) || (net.isBuildable(sx, sy) && !net.isSpanTile(i))) {
      this.mode = 'draw';
      this.beginAt(i);
    }
    this.updateHover(e);
  };

  private beginAt(i: number) {
    this.current = i;
    this.startPending = !this.getNet().hasTile(i);
  }

  private onMove = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    if (this.mode && this.isPanning()) return this.cancel();
    const t = this.tileAt(e);
    const net = this.getNet();
    if (t && this.mode === 'erase' && net.grid.contains(t.x, t.y)) {
      const i = net.idx(t.x, t.y);
      // Dragging only erases roads; tools are removed by clicking them.
      if (!net.specials.has(i)) net.removeTile(i);
    }
    if (t && this.mode === 'draw' && this.fromHouse) this.leaveHouse(t.px, t.py);
    if (t && this.mode === 'draw' && !this.fromHouse) this.extendToward(t.px, t.py);
    this.updateHover(e);
  };

  /** Once the drag clears the house tile, face the house that way and start the road at its new driveway. */
  private leaveHouse(px: number, py: number) {
    const h = this.fromHouse!;
    const dx = px - (h.x + 0.5), dy = py - (h.y + 0.5);
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= 0.5) return;
    const want: Dir = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    const dir = DIRS4.find((d) => d[0] === want[0] && d[1] === want[1])!;
    // If it can't face that way (another building, water...), keep the old driveway.
    this.hooks.turnHouse(h, dir);
    this.fromHouse = null;
    this.beginAt(h.access);
  }

  private onUp = (e: PointerEvent) => {
    if (!e.isPrimary) return;
    // No cursor stays behind after a finger lifts.
    if (e.pointerType === 'touch') this.roads.setHover(0, 0, null);
    const net = this.getNet();
    if (this.mode === 'draw') net.pruneDanglingSpans();
    if (this.mode === 'motorway') {
      const end = this.motorwayEnd(e);
      if (end >= 0 && net.placeMotorway(this.motorwayStart, end) && net.available().motorways <= 0) this.hooks.toolSpent();
      this.roads.setMotorwayPreview(null);
    }
    this.mode = null;
    this.fromHouse = null;
  };

  private motorwayEnd(e: PointerEvent): number {
    const t = this.tileAt(e);
    const net = this.getNet();
    return t && net.grid.contains(t.x, t.y) ? net.idx(t.x, t.y) : -1;
  }

  private extendToward(px: number, py: number) {
    const net = this.getNet();
    for (let guard = 0; guard < 64; guard++) {
      const [cx, cy] = net.xy(this.current);
      const dx = px - (cx + 0.5), dy = py - (cy + 0.5);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax <= 0.5 && ay <= 0.5) return;
      // Step along an axis when the cursor leaves through that side; step diagonally when it
      // leaves near a corner (or is far away in both axes).
      let sx = ax > 0.5 || (ay > 0.5 && ax > DIAGONAL_SLACK) ? Math.sign(dx) : 0;
      let sy = ay > 0.5 || (ax > 0.5 && ay > DIAGONAL_SLACK) ? Math.sign(dy) : 0;
      // Bridges and tunnels must be straight. Inside one, keep going the way it started as long as
      // the cursor is still ahead; stepping onto one, aim at the cursor in 8 directions, so a
      // slightly wobbly diagonal drag still builds a clean diagonal crossing.
      const back = net.isSpanTile(this.current) ? [...net.neighbors(this.current)] : [];
      if (back.length === 1) {
        const [bx, by] = net.xy(back[0]);
        sx = cx - bx;
        sy = cy - by;
        if (sx * dx + sy * dy <= 0) return;
      } else {
        const oct = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
        const ox = Math.round(Math.cos(oct * Math.PI / 4)), oy = Math.round(Math.sin(oct * Math.PI / 4));
        const span = (x: number, y: number) => net.grid.contains(x, y) && net.isSpanTile(net.idx(x, y));
        if (span(cx + sx, cy + sy) || span(cx + ox, cy + oy)) [sx, sy] = [ox, oy];
      }
      const nx = cx + sx, ny = cy + sy;
      if (!net.grid.contains(nx, ny)) return;
      const next = net.idx(nx, ny);
      // Dragging into a building through one of its entrances: the road ends here, connected.
      if (this.hooks.entersBuilding(this.current, next)) {
        if (this.startPending && net.placeTile(this.current)) this.startPending = false;
        return;
      }
      const placedStart = this.startPending;
      if (placedStart && !net.placeTile(this.current)) return;
      if (!net.connect(this.current, next)) {
        // Don't leave a lone start tile behind if the very first step was refused.
        if (placedStart) net.removeTile(this.current);
        return;
      }
      this.startPending = false;
      this.current = next;
    }
  }

  private updateHover(e: PointerEvent) {
    const t = this.tileAt(e);
    const net = this.getNet();
    if (!t || !net.grid.contains(t.x, t.y) || this.isPanning()) {
      this.roads.setHover(0, 0, null);
      return;
    }
    const tile = net.idx(t.x, t.y);
    if (this.mode === 'erase') return this.roads.setHover(t.x, t.y, 'erase');
    if (this.mode === 'motorway') {
      const end = this.motorwayEnd(e);
      this.roads.setHover(t.x, t.y, null);
      this.roads.setMotorwayPreview(net.xy(this.motorwayStart), [t.px - 0.5, t.py - 0.5],
        end >= 0 && !net.motorwayProblem(this.motorwayStart, end));
      return;
    }
    const tool = this.hooks.tool();
    if (tool === 'roundabouts' || tool === 'lights') {
      return this.roads.setHover(t.x, t.y, net.canPlaceSpecial(tile, tool === 'roundabouts' ? 'roundabout' : 'light') ? 'ok' : 'bad');
    }
    if (tool === 'motorways') return this.roads.setHover(t.x, t.y, net.hasTile(tile) && !net.isSpanTile(tile) ? 'ok' : 'bad');
    if (this.hooks.houseAt(tile)) return this.roads.setHover(t.x, t.y, 'ok');
    const i = this.hooks.strokeStart(tile);
    const [sx, sy] = net.xy(i);
    const ok = net.hasTile(i) || (net.isBuildable(sx, sy) && !net.isSpanTile(i) && net.available().roads > 0);
    this.roads.setHover(t.x, t.y, ok ? 'ok' : 'bad');
  }
}
