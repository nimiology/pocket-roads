import { GameRenderer } from '../render/renderer';

const MIN_HEIGHT = 6;

/**
 * Wheel zooms toward the cursor; middle-drag or space+left-drag pans.
 * Left and right drags are left free for road drawing and erasing.
 */
export class CameraControls {
  private panning = false;
  private spaceHeld = false;
  private last = { x: 0, y: 0 };

  constructor(private r: GameRenderer, private maxHeight: () => number, private mapSize: () => { w: number; h: number }) {
    const el = r.renderer.domElement;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') this.spaceHeld = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceHeld = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const before = this.r.screenToGround(e.clientX, e.clientY);
    const factor = Math.exp(e.deltaY * 0.0015);
    const h = Math.min(this.maxHeight(), Math.max(MIN_HEIGHT, this.r.view.height * factor));
    this.r.view.height = this.r.viewTarget.height = h;
    this.r.update(0);
    const after = this.r.screenToGround(e.clientX, e.clientY);
    if (before && after) this.shift(before.x - after.x, before.z - after.z);
  };

  private onDown = (e: PointerEvent) => {
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.panning = true;
      this.last = { x: e.clientX, y: e.clientY };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (!this.panning) return;
    const a = this.r.screenToGround(this.last.x, this.last.y);
    const b = this.r.screenToGround(e.clientX, e.clientY);
    if (a && b) this.shift(a.x - b.x, a.z - b.z);
    this.last = { x: e.clientX, y: e.clientY };
  };

  private onUp = () => {
    this.panning = false;
  };

  private shift(dx: number, dz: number) {
    const { w, h } = this.mapSize();
    const v = this.r.view, t = this.r.viewTarget;
    v.x = t.x = Math.min(w, Math.max(0, v.x + dx));
    v.z = t.z = Math.min(h, Math.max(0, v.z + dz));
    this.r.update(0);
  }

  get isPanning(): boolean {
    return this.panning || this.spaceHeld;
  }
}
