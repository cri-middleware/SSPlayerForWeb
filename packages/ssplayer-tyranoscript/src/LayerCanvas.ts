import type { SSPlayer } from '@spritestudio/ssplayer-webgl';
import type { TyranoKag } from './tyranoTypes.js';

/**
 * DOM glue between a TyranoScript layer `div` and an `SSPlayer`.
 *
 * TyranoScript renders by stacking absolutely-positioned layer divs
 * (`<number>_<fore|back>`, e.g. `.0_fore`, with `base` for the background). We
 * reach the layer through Tyrano's own `kag.layer.getLayer(layer, page)` — the
 * same API TyranoScript's own character plugins use (it handles the class naming and
 * avoids building an invalid `.0_fore` selector by hand).
 *
 * **Each character is a `<div>`, not a canvas.** One `SSOverlay` per
 * `(layer, page)` owns the single canvas that draws every SS character on that
 * layer and positions each one from its div's rect. That is what keeps the WebGL
 * context count at "layers in use" rather than "characters on screen" — browsers
 * allow only about 8-16 contexts, which a cast of characters would exhaust.
 *
 * Keeping a real element per character is not incidental. TyranoScript
 * identifies a named element purely by a CSS class (`$.setName` is
 * `addClass(name)`), and `[anim]` / `[kanim]` find it with
 * `getLayer(layer,page).find(".<name>")`. Because the character is still an
 * element those tags keep working: moving the div moves the animation with it,
 * and the overlay reads the div's computed opacity so a fade fades the
 * animation. Drawing on a shared canvas costs only what CSS *transforms* used to
 * do — see the note on {@link toTransform}.
 *
 * Coordinate model:
 *  - Tyrano places things in **logical top-left pixels** at the game resolution
 *    (`config.scWidth × scHeight`).
 *  - `SSPlayer` uses a **Y-down** system (it calls `set_coordinate_system(1)` on
 *    load) and its `setTransform({x,y})` is relative to the **centre of its box**
 *    — here, the character div's rect in drawing-buffer pixels. The buffer is
 *    `logical × dpr`, so a logical coordinate is multiplied by the buffer scale
 *    both to land where the author expects and to stay crisp on HiDPI.
 */

/** Which sub-page of a numbered layer to mount on. */
export type LayerPage = 'fore' | 'back';

/**
 * Resolve a Tyrano layer to its DOM element via `kag.layer.getLayer`. `layer` is
 * a numbered layer (`"0"`, `"1"`) or `"base"` for the background; `page` selects
 * the fore/back sub-layer. Shows the layer (matching the character plugins) and
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
 * Create the `<div>` that represents one SS character on `layerEl`, sized to the
 * game resolution and pinned at `left:0; top:0` (Tyrano layers are already
 * positioned), so SS content shares the layer's coordinate origin.
 *
 * The div draws nothing; the layer's overlay reads its rect. Sizing it to the
 * whole game rather than to the character is deliberate — it makes
 * `[anim left= top=]` move the character by the same offset it would have moved a
 * full-screen canvas, so scenarios written against the canvas-per-character build
 * behave identically.
 */
export function createCharacterElement(
  layerEl: HTMLElement,
  logicalW: number,
  logicalH: number,
  name: string,
): HTMLDivElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = `${logicalW}px`;
  el.style.height = `${logicalH}px`;
  // Overlay only — never eat clicks meant for Tyrano's own UI on the layer.
  el.style.pointerEvents = 'none';
  // Tag it so it is addressable exactly like a TyranoScript "character": Tyrano
  // identifies a named element purely by a CSS class, and [anim]/[kanim] target
  // it via getLayer(layer,page).find(".<name>"). `ss-player` is a stable marker
  // for bulk selection.
  el.classList.add('ss-player');
  if (name) el.classList.add(name);
  layerEl.appendChild(el);
  return el;
}

/**
 * Pending fade timers, keyed by element. Module-level (not on the entry) so the
 * fade helpers stay usable on any element, and so a second fade on the same
 * element cancels the first instead of racing it to the final style.
 */
const fadeTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** Cancel a fade started by {@link setElementVisible} (teardown / re-target). */
export function cancelElementFade(el: HTMLElement): void {
  const pending = fadeTimers.get(el);
  if (pending === undefined) return;
  clearTimeout(pending);
  fadeTimers.delete(el);
}

/**
 * Show or hide a character, optionally fading over `timeMs`. Resolves once the
 * fade has finished (immediately when `timeMs <= 0`), so a tag can either await
 * it (`wait="true"`) or fire and forget.
 *
 * This animates CSS on the element even though the element draws nothing: the
 * overlay reads its computed opacity into the player's alpha every frame, so a
 * CSS transition fades the animation. Driving the same property Tyrano's own
 * `[anim]` drives means an author mixing the two gets the browser's normal
 * last-write-wins behaviour, exactly as before.
 *
 * Hiding ends at `display:none` rather than `opacity:0` on purpose: a
 * laid-out-but-invisible element still has a rect, whereas `display:none` drops
 * out of the overlay's IntersectionObserver, which stops advancing and drawing
 * that player entirely while it stays loaded — that is the whole point of
 * `[ss_hide]` over `[ss_free]`.
 */
export function setElementVisible(
  el: HTMLElement,
  visible: boolean,
  timeMs = 0,
): Promise<void> {
  cancelElementFade(el);
  const time = Math.max(0, timeMs);

  if (time <= 0) {
    el.style.transition = '';
    el.style.opacity = visible ? '1' : '0';
    el.style.display = visible ? '' : 'none';
    return Promise.resolve();
  }

  if (visible) {
    // Lay the element out at zero opacity first: a `display:none` element has no
    // transition start value, so without this the fade-in would just pop.
    el.style.transition = '';
    el.style.opacity = '0';
    el.style.display = '';
    void el.offsetWidth; // force a reflow so the start value is committed
  }
  el.style.transition = `opacity ${time}ms linear`;
  el.style.opacity = visible ? '1' : '0';

  return new Promise<void>((resolve) => {
    const id = setTimeout(() => {
      fadeTimers.delete(el);
      el.style.transition = '';
      if (!visible) el.style.display = 'none';
      resolve();
    }, time);
    fadeTimers.set(el, id);
  });
}

/**
 * Map an author-facing placement (logical px + author scale) to the
 * `SSPlayer.setTransform` arguments (buffer px + composed scale). Split out so it
 * can be unit-tested without a GL context.
 *
 * `origin` is the centre of the player's box. TyranoScript addresses the screen
 * from its top-left while `setTransform` is relative to that centre, so it is
 * subtracted here — which also means `[ss_new]` with no position resolves to
 * `{0,0}`, dead centre, rather than to a screen-midpoint magic number.
 *
 * This is also where `[anim]`'s CSS `scale` / `rotate` stop reaching the
 * animation: the overlay derives the box from the div's rect, so a CSS transform
 * moves and resizes the *box* without scaling or rotating what is drawn in it.
 * The docs already point at `[ss_pos]` / `[ss_move]` for accurate scale, since
 * `[anim]`'s pivot was the screen centre rather than the character anyway.
 */
export function toTransform(
  x: number,
  y: number,
  scale: number,
  bufferScale: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): { x: number; y: number; scaleX: number; scaleY: number } {
  return {
    x: x * bufferScale - origin.x,
    y: y * bufferScale - origin.y,
    scaleX: scale * bufferScale,
    scaleY: scale * bufferScale,
  };
}

/** The centre of `player`'s box, to hand {@link toTransform}. */
export function boxOrigin(player: SSPlayer): { x: number; y: number } {
  const box = player.box;
  return { x: box.w / 2, y: box.h / 2 };
}
