import type { TyranoKag } from './tyranoTypes.js';

/**
 * DOM glue between a TyranoScript layer `div` and an `SSPlayer`'s canvas
 * (§3.2). TyranoScript renders by stacking absolutely-positioned layer divs
 * (`<number>_<fore|back>`, e.g. `.0_fore`, with `base` for the background). We
 * overlay one `<canvas>` per player on the requested layer, reaching the layer
 * through Tyrano's own `kag.layer.getLayer(layer, page)` — the same API the
 * official Spine plugin uses (it handles the class naming and avoids building an
 * invalid `.0_fore` selector by hand).
 *
 * Coordinate model (§3.2):
 *  - Tyrano places things in **logical top-left pixels** at the game resolution
 *    (`config.scWidth × scHeight`).
 *  - `SSPlayer` uses a **Y-down** system (it calls `set_coordinate_system(1)`
 *    on load) whose `setTransform({x,y})` places the SS origin at a **drawing-
 *    buffer pixel**. The buffer is `logical × dpr`, so a logical coordinate must
 *    be multiplied by the buffer scale to land where the author expects, and the
 *    same factor keeps the animation crisp (native size) on HiDPI displays.
 */

/** Which sub-page of a numbered layer to mount on. */
export type LayerPage = 'fore' | 'back';

export interface LayerCanvasResult {
  canvas: HTMLCanvasElement;
  /** `drawingBuffer px / logical px` — multiply logical coords by this. */
  bufferScale: number;
}

/**
 * Resolve a Tyrano layer to its DOM element via `kag.layer.getLayer`. `layer` is
 * a numbered layer (`"0"`, `"1"`) or `"base"` for the background; `page` selects
 * the fore/back sub-layer. Shows the layer (matching the Spine plugin) and
 * returns its element, or `null` when the layer isn't on the page yet.
 */
export function getLayerElement(
  kag: TyranoKag,
  layer: string,
  page: LayerPage = 'fore',
): HTMLElement | null {
  const found = kag.layer.getLayer(layer, page);
  if (!found || found.length === 0) return null;
  found.show?.();
  return found.get(0) ?? null;
}

/**
 * Create a `<canvas>` sized to the game resolution, overlay it on `layerEl`, and
 * report the buffer scale used. The canvas fills the layer at `left:0; top:0`
 * (Tyrano layers are already positioned), so SS content shares the layer's
 * coordinate origin.
 *
 * `dpr` is clamped to `maxDPR` to bound fill-rate on HiDPI (mirrors
 * `SSSurface.resize`; memory: webgl-perf-fillrate).
 */
export function createLayerCanvas(
  layerEl: HTMLElement,
  logicalW: number,
  logicalH: number,
  dpr: number,
  name: string,
  maxDPR = 2,
): LayerCanvasResult {
  const scale = Math.min(dpr, maxDPR);
  const canvas = document.createElement('canvas');
  // Backing store at device resolution; CSS box at the logical game size.
  canvas.width = Math.round(logicalW * scale);
  canvas.height = Math.round(logicalH * scale);
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.width = `${logicalW}px`;
  canvas.style.height = `${logicalH}px`;
  // Overlay only — never eat clicks meant for Tyrano's own UI on the layer.
  canvas.style.pointerEvents = 'none';
  // Tag the canvas so it is addressable exactly like a TyranoScript "character":
  // Tyrano identifies a named element purely by a CSS class (`$.setName` does
  // `addClass(name)`), and tags like [anim]/[kanim] target it via
  // getLayer(layer,page).find(".<name>"). Adding the player's name as a class
  // therefore lets authors move/fade the SS canvas with Tyrano's own built-in
  // motion tags — no custom [ss_move] needed for CSS-space effects. `ss-player`
  // is a stable marker for bulk selection.
  canvas.classList.add('ss-player');
  if (name) canvas.classList.add(name);
  layerEl.appendChild(canvas);
  return { canvas, bufferScale: scale };
}

/**
 * Set (or clear, when `zIndex` is undefined) the stacking order of a player's
 * canvas inside its layer. Tyrano layers stack by layer number; within ONE
 * layer several SS canvases would otherwise stack in creation order only, with
 * no way to bring a character to the front later. `z-index` works because the
 * canvases are absolutely positioned (see createLayerCanvas).
 */
export function setCanvasZIndex(canvas: HTMLCanvasElement, zIndex?: number): void {
  canvas.style.zIndex = zIndex === undefined || !Number.isFinite(zIndex) ? '' : String(zIndex);
}

/**
 * Pending fade timers, keyed by canvas. Module-level (not on the entry) so the
 * fade helpers stay usable on any canvas, and so a second fade on the same
 * canvas cancels the first instead of racing it to the final style.
 */
const fadeTimers = new WeakMap<HTMLCanvasElement, ReturnType<typeof setTimeout>>();

/** Cancel a fade started by {@link setCanvasVisible} (teardown / re-target). */
export function cancelCanvasFade(canvas: HTMLCanvasElement): void {
  const pending = fadeTimers.get(canvas);
  if (pending === undefined) return;
  clearTimeout(pending);
  fadeTimers.delete(canvas);
}

/**
 * Show or hide a player's canvas, optionally fading over `timeMs`. Resolves
 * once the fade has finished (immediately when `timeMs <= 0`), so a tag can
 * either await it (`wait="true"`) or fire and forget.
 *
 * Hiding ends at `display:none` rather than `opacity:0` on purpose: an
 * invisible-but-laid-out canvas keeps its `SSSurface` ticker running,
 * whereas `display:none` trips the renderer's own `pauseWhenHidden`
 * IntersectionObserver and stops the GPU work while the player stays loaded
 * (that is the whole point of `[ss_hide]` over `[ss_free]`).
 *
 * CSS transitions are used rather than a RAF loop because the canvas is a plain
 * DOM element here — this is the same axis Tyrano's own `[anim]` animates, so
 * an author mixing the two gets the browser's normal last-write-wins behaviour.
 */
export function setCanvasVisible(
  canvas: HTMLCanvasElement,
  visible: boolean,
  timeMs = 0,
): Promise<void> {
  cancelCanvasFade(canvas);
  const time = Math.max(0, timeMs);

  if (time <= 0) {
    canvas.style.transition = '';
    canvas.style.opacity = visible ? '1' : '0';
    canvas.style.display = visible ? '' : 'none';
    return Promise.resolve();
  }

  if (visible) {
    // Lay the canvas out at zero opacity first: a `display:none` element has no
    // transition start value, so without this the fade-in would just pop.
    canvas.style.transition = '';
    canvas.style.opacity = '0';
    canvas.style.display = '';
    void canvas.offsetWidth; // force a reflow so the start value is committed
  }
  canvas.style.transition = `opacity ${time}ms linear`;
  canvas.style.opacity = visible ? '1' : '0';

  return new Promise<void>((resolve) => {
    const id = setTimeout(() => {
      fadeTimers.delete(canvas);
      canvas.style.transition = '';
      if (!visible) canvas.style.display = 'none';
      resolve();
    }, time);
    fadeTimers.set(canvas, id);
  });
}

/**
 * Map an author-facing placement (logical px + author scale) to the
 * `SSPlayer.setTransform` arguments (buffer px + composed scale). Split
 * out so it can be unit-tested without a GL context.
 */
export function toTransform(
  x: number,
  y: number,
  scale: number,
  bufferScale: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number; scaleX: number; scaleY: number } {
  return {
    // TyranoScript addresses the screen from its top-left; `SSPlayer.setTransform`
    // is relative to the player's box centre (SURFACE_PLAYER_SPEC.md §3.0), so
    // subtract the box centre here. `[ss_new]` with no position then lands on
    // {0,0} — dead centre — which is what it always drew, now said plainly.
    x: x * bufferScale - origin.x,
    y: y * bufferScale - origin.y,
    scaleX: scale * bufferScale,
    scaleY: scale * bufferScale,
  };
}

/** The box centre to hand {@link toTransform}, for a canvas-sized player box. */
export function boxOrigin(canvas: HTMLCanvasElement): { x: number; y: number } {
  return { x: canvas.width / 2, y: canvas.height / 2 };
}
