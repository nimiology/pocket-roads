import { GameRenderer } from '../render/renderer';

const MIN_HEIGHT = 6;

/**
 * Wheel zooms toward the cursor; middle-drag or space+left-drag pans.
 * Left and right drags are left free for road drawing and erasing.
 * On touch screens one finger draws; two fingers pan and pinch-zoom.
 */
export class CameraControls {
  private panning = false;
  private spaceHeld = false;
  private last = { x: 0, y: 0 };
  /** Fingers currently on the screen, by pointer id. */
  private touches = new Map<number, { x: number; y: number }>();

  constructor(private r: GameRenderer, private maxHeight: () => number, private mapSize: () => { w: number; h: number }) {
    const el = r.renderer.domElement;
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    window.addEventListener('keydown', (e) => { if (e.code === 'Space') this.spaceHeld = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceHeld = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomAt(e.clientX, e.clientY, Math.exp(e.deltaY * 0.0015));
  };

  /** Zoom by `factor` keeping the ground under screen point (x, y) fixed. */
  private zoomAt(x: number, y: number, factor: number) {
    const before = this.r.screenToGround(x, y);
    const h = Math.min(this.maxHeight(), Math.max(MIN_HEIGHT, this.r.view.height * factor));
    this.r.view.height = this.r.viewTarget.height = h;
    this.r.update(0);
    const after = this.r.screenToGround(x, y);
    if (before && after) this.shift(before.x - after.x, before.z - after.z);
  }

  private pinch() {
    const [a, b] = [...this.touches.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) };
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      return;
    }
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault();
      this.panning = true;
      this.last = { x: e.clientX, y: e.clientY };
    }
  };

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      if (this.touches.size < 2) {
        this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        return;
      }
      const before = this.pinch();
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = this.pinch();
      const a = this.r.screenToGround(before.x, before.y), b = this.r.screenToGround(after.x, after.y);
      if (a && b) this.shift(a.x - b.x, a.z - b.z);
      if (before.d > 0 && after.d > 0) this.zoomAt(after.x, after.y, before.d / after.d);
      return;
    }
    if (!this.panning) return;
    const a = this.r.screenToGround(this.last.x, this.last.y);
    const b = this.r.screenToGround(e.clientX, e.clientY);
    if (a && b) this.shift(a.x - b.x, a.z - b.z);
    this.last = { x: e.clientX, y: e.clientY };
  };

  private onUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
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
    return this.panning || this.spaceHeld || this.touches.size >= 2;
  }
}
