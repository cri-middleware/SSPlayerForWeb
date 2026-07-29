import type { SSPlayer } from '@spritestudio/ssplayer-webgl';

// Zoom range for the wheel. Wide enough to inspect a tiny part or to fit a
// large animation, tight enough that a stray scroll can't lose the asset.
const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
// Wheel delta → scale factor. exp() keeps the zoom perceptually even (one notch
// always changes the size by the same ratio, whatever the current scale).
const ZOOM_SENSITIVITY = 0.002;

/**
 * Pan (drag) / zoom (wheel) of the animation inside the canvas, plus the
 * default view every newly-shown animation starts from.
 *
 * SSPlayer has no scene graph, so the view lives here and is pushed to the
 * player through setTransform() — the same call that would otherwise just centre
 * the animation once at startup.
 */
export class ViewControls {
  private x = 0;
  private y = 0;
  private scale = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private player: SSPlayer, private canvas: HTMLCanvasElement) {
    this.reset();
    this.setupDrag();
    this.setupZoom();
  }

  /**
   * Restore the default view: centred in the drawing buffer, unscaled. Called for
   * every newly-shown animation (ssab load / animation switch) so a pan-and-zoom
   * from the previous one never hides the new one.
   */
  public reset(): void {
    // setTransform is relative to the player's box centre, so centred is simply 0,0.
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.apply();
  }

  private apply(): void {
    this.player.setTransform({ x: this.x, y: this.y, scaleX: this.scale, scaleY: this.scale });
  }

  /**
   * Client (CSS px) → drawing-buffer pixels measured **from the box centre**,
   * which is the space setTransform() works in. Keeping the cursor in the same
   * space as `this.x/y` is what lets zoomAt() anchor correctly. The buffer is a
   * fixed 1280x960; if CSS ever scales the canvas, the ratio below keeps the
   * cursor mapping honest.
   */
  private toBuffer(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.canvas.width / rect.width) - this.canvas.width / 2,
      y: (e.clientY - rect.top) * (this.canvas.height / rect.height) - this.canvas.height / 2,
    };
  }

  private setupDrag(): void {
    // Drag anywhere on the canvas, not just on the animation: an animation that
    // has been scaled down or dragged off-screen can still be brought back. The
    // DOM controls sit above the canvas, so a click on them never starts a drag.
    this.canvas.style.cursor = 'grab';

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      const p = this.toBuffer(e);
      this.lastX = p.x;
      this.lastY = p.y;
      // Capture so a drag that leaves the canvas keeps tracking (and still ends).
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grabbing';
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const p = this.toBuffer(e);
      this.x += p.x - this.lastX;
      this.y += p.y - this.lastY;
      this.lastX = p.x;
      this.lastY = p.y;
      this.apply();
    });

    const endDrag = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.canvas.style.cursor = 'grab';
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
  }

  private setupZoom(): void {
    // passive: false so preventDefault() sticks — otherwise ctrl+wheel / a
    // trackpad pinch zooms the whole page instead of the animation.
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.toBuffer(e);
      // deltaMode: 0 = pixels, 1 = lines, 2 = pages.
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      this.zoomAt(p.x, p.y, Math.exp(-delta * ZOOM_SENSITIVITY));
    }, { passive: false });
  }

  /** Scale about (px, py) so the point under the cursor stays put. */
  private zoomAt(px: number, py: number, factor: number): void {
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const k = next / this.scale;
    this.x = px + (this.x - px) * k;
    this.y = py + (this.y - py) * k;
    this.scale = next;
    this.apply();
  }
}
