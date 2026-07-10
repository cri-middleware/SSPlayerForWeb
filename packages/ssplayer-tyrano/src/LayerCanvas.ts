import type { TyranoKag } from './tyranoTypes.js';

/**
 * DOM glue between a TyranoScript layer `div` and an `SSCanvasPlayer`'s canvas
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
 *  - `SSCanvasPlayer` uses a **Y-down** system (it calls `set_coordinate_system(1)`
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
 * `SSCanvasPlayer.resize`; memory: webgl-perf-fillrate).
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
 * Map an author-facing placement (logical px + author scale) to the
 * `SSCanvasPlayer.setTransform` arguments (buffer px + composed scale). Split
 * out so it can be unit-tested without a GL context.
 */
export function toTransform(
  x: number,
  y: number,
  scale: number,
  bufferScale: number,
): { x: number; y: number; scaleX: number; scaleY: number } {
  return {
    x: x * bufferScale,
    y: y * bufferScale,
    scaleX: scale * bufferScale,
    scaleY: scale * bufferScale,
  };
}
