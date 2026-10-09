import { GameRenderer } from '../render/renderer';
import { RoadRenderer } from '../render/roads';
import { RoadNetwork } from '../sim/roads';

/** Max cursor offset on the cross axis (from tile centre) that still turns an exit into a diagonal step. */
const DIAGONAL_SLACK = 0.4;

/**
 * Left-drag draws a road through the tiles under the cursor, right-drag erases.
 * Drawing advances one 8-connected step at a time toward the cursor, so fast drags leave no gaps.
 */
export class RoadTool {
  private mode: 'draw' | 'erase' | null = null;
  private current = -1;

  constructor(
    private r: GameRenderer,
    private roads: RoadRenderer,
    private getNet: () => RoadNetwork,
    private isPanning: () => boolean,
  ) {
    const el = r.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', () => this.roads.setHover(0, 0, null));
    window.addEventListener('pointerup', this.onUp);
  }

  private tileAt(e: PointerEvent): { x: number; y: number; px: number; py: number } | null {
    const p = this.r.screenToGround(e.clientX, e.clientY);
    if (!p) return null;
    return { x: Math.floor(p.x), y: Math.floor(p.z), px: p.x, py: p.z };
  }

  private onDown = (e: PointerEvent) => {
    if (this.isPanning() || (e.button !== 0 && e.button !== 2)) return;
    const t = this.tileAt(e);
    const net = this.getNet();
    if (!t || !net.grid.contains(t.x, t.y)) return;
    const i = net.idx(t.x, t.y);
    if (e.button === 2) {
      this.mode = 'erase';
      net.removeTile(i);
    } else if (net.placeTile(i)) {
      this.mode = 'draw';
      this.current = i;
    }
    this.updateHover(e);
  };

  private onMove = (e: PointerEvent) => {
    const t = this.tileAt(e);
    const net = this.getNet();
    if (t && this.mode === 'erase' && net.grid.contains(t.x, t.y)) net.removeTile(net.idx(t.x, t.y));
    if (t && this.mode === 'draw') this.extendToward(t.px, t.py);
    this.updateHover(e);
  };

  private onUp = () => {
    if (this.mode === 'draw') this.getNet().pruneDanglingSpans();
    this.mode = null;
  };

  private extendToward(px: number, py: number) {
    const net = this.getNet();
    for (let guard = 0; guard < 64; guard++) {
      const [cx, cy] = net.xy(this.current);
      const dx = px - (cx + 0.5), dy = py - (cy + 0.5);
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax <= 0.5 && ay <= 0.5) return;
      // Step along an axis when the cursor leaves through that side; step diagonally when it
      // leaves near a corner (or is far away in both axes).
      const sx = ax > 0.5 || (ay > 0.5 && ax > DIAGONAL_SLACK) ? Math.sign(dx) : 0;
      const sy = ay > 0.5 || (ax > 0.5 && ay > DIAGONAL_SLACK) ? Math.sign(dy) : 0;
      const nx = cx + sx, ny = cy + sy;
      if (!net.grid.contains(nx, ny)) return;
      const next = net.idx(nx, ny);
      if (!net.connect(this.current, next)) return;
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
    if (this.mode === 'erase') return this.roads.setHover(t.x, t.y, 'erase');
    const i = net.idx(t.x, t.y);
    const ok = net.hasTile(i) || (net.isBuildable(t.x, t.y) && !net.isSpanTile(i) && net.available().roads > 0);
    this.roads.setHover(t.x, t.y, ok ? 'ok' : 'bad');
  }
}
