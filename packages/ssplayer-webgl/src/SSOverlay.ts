import { SSSurface, type SSSurfaceOptions } from './SSSurface.js';
import type { SSPlayer, SSPlayerOptions } from './SSPlayer.js';

export interface SSOverlayOptions extends Omit<SSSurfaceOptions, 'autoStart' | 'flipY'> {
  /** Stacking order of the overlay canvas. Default 0 — behind positioned UI. */
  zIndex?: number;
  /**
   * Also read each host element's computed `opacity` into its player's alpha
   * (default off).
   *
   * Off, an element is only a position. On, it is a position *and* a fade — which
   * is what lets a host engine keep animating these elements with its own tooling
   * and have the animation follow. `ssplayer-tyranoscript` turns it on so
   * TyranoScript's `[anim opacity=]` / `[kanim]` still fade an SS character after
   * the character stopped being a canvas.
   *
   * Costs a `getComputedStyle` per tracked element per frame, so it is opt-in.
   */
  followOpacity?: boolean;
  /**
   * Where to mount the overlay canvas. Defaults to `document.body`, which makes
   * it viewport-sized. Pass a positioned element to scope an overlay to a
   * scroll container instead — note that costs another WebGL context.
   */
  container?: HTMLElement;
}

/**
 * One WebGL context for a whole page of animations, positioned by DOM elements.
 *
 * An overlay is a full-viewport, transparent, pointer-events-none `<canvas>`
 * fixed behind the page's own content. Elements register with it and get an
 * {@link SSPlayer}; every frame the overlay reads each element's rect and writes
 * it into that player's `box`, so the animation is drawn where the element is
 * without the element owning a canvas at all.
 *
 * This is what makes an arbitrary number of animations viable on one page:
 * browsers cap live WebGL contexts at roughly 8-16, and this costs **one**
 * regardless of how many elements register. The same page built from one canvas
 * per animation starts blanking canvases at around a dozen.
 *
 * What it gives up, and why:
 *
 * - **One z-index.** Everything drawn here shares the overlay canvas's place in
 *   the stacking order, so page content cannot be interleaved between two
 *   overlay animations. An element that must sit in normal flow wants its own
 *   surface instead.
 * - **Rectangular clipping only.** Clipping is a scissor rect, so `border-radius`,
 *   `clip-path`, `filter` and CSS transforms on the host element do not shape the
 *   animation — it is not drawn inside that element's box, only at its position.
 * - **Blend modes composite against the overlay**, which is transparent, so
 *   framebuffer-reading blends (Add / Screen / Mul) have nothing behind them
 *   unless the player opts into its own `backdrop`.
 *
 * Positions are read once per frame, all before anything is written, so the
 * per-frame layout reads stay cheap. Off-screen players are skipped entirely.
 */
export class SSOverlay {
  private static readonly instances = new Map<string, SSOverlay>();

  /**
   * The overlay for `id`, created on first use. Sharing one id is the whole
   * point — every extra overlay is another WebGL context.
   */
  public static getOrCreate(id = 'default', options: SSOverlayOptions = {}): SSOverlay {
    let overlay = SSOverlay.instances.get(id);
    if (!overlay) {
      overlay = new SSOverlay(id, options);
      SSOverlay.instances.set(id, overlay);
    }
    return overlay;
  }

  public readonly surface: SSSurface;
  public readonly canvas: HTMLCanvasElement;

  private readonly entries = new Map<SSPlayer, HTMLElement>();
  private readonly computedStyles = new WeakMap<HTMLElement, CSSStyleDeclaration>();
  private readonly io: IntersectionObserver | null;
  private readonly onResize: () => void;
  // A hidden tab gets no animation frames. Restart the clock on the way back, or
  // the first tick plays the whole absence at once, every event in it included.
  private readonly onVisibilityChange = (): void => { this.lastTime = performance.now(); };
  // Declared with the other fields so it exists before the constructor's first
  // resize() call, which fires it.
  private readonly _resizeListeners = new Set<() => void>();
  private rafId = 0;
  private lastTime = 0;

  private constructor(public readonly id: string, private options: SSOverlayOptions) {
    const container = options.container ?? document.body;

    this.canvas = document.createElement('canvas');
    const style = this.canvas.style;
    style.position = options.container ? 'absolute' : 'fixed';
    style.inset = '0';
    style.width = '100%';
    style.height = '100%';
    // Never eat clicks: the page's own elements stay interactive, and the
    // animation is decoration drawn over/behind them.
    style.pointerEvents = 'none';
    style.zIndex = String(options.zIndex ?? 0);
    container.appendChild(this.canvas);

    // autoStart is off: the overlay owns the frame, because boxes have to be
    // written from layout BEFORE the surface draws.
    this.surface = new SSSurface(this.canvas, { ...options, autoStart: false, pauseWhenHidden: false });
    this.surface.sharedOverlay = true;

    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.resize();

    // Per-element gating, not per-surface: the overlay canvas always intersects
    // the viewport, so a surface-level observer would keep every animation on the
    // page running however far it had scrolled away.
    this.io = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((records) => {
          for (const record of records) {
            for (const [player, el] of this.entries) {
              if (el === record.target) player.visible = record.isIntersecting;
            }
          }
        })
      : null;

    this.start();
  }

  /** Create a player positioned by `el`, and start tracking it. */
  public createPlayer(el: HTMLElement, options?: SSPlayerOptions): SSPlayer {
    const player = this.surface.createPlayer(options);
    this.attach(el, player);
    return player;
  }

  /** Track `el`'s rect as `player`'s box. */
  public attach(el: HTMLElement, player: SSPlayer): void {
    this.entries.set(player, el);
    // Assume off-screen until the observer says otherwise, so a player far down
    // a long page never paints a frame before it is scrolled to.
    if (this.io) {
      player.visible = false;
      this.io.observe(el);
    }
  }

  /** Stop tracking `player`. Does not destroy it. */
  public detach(player: SSPlayer): void {
    const el = this.entries.get(player);
    if (el && this.io) {
      // Only unobserve when no other player is riding the same element.
      let shared = false;
      for (const [other, otherEl] of this.entries) {
        if (other !== player && otherEl === el) { shared = true; break; }
      }
      if (!shared) this.io.unobserve(el);
    }
    this.entries.delete(player);
  }

  /** How many players this overlay is drawing — all on one context. */
  public get size(): number {
    return this.entries.size;
  }

  /**
   * Called after the overlay has resized its canvas, so hosts that placed
   * players in **drawing-buffer pixels** can recompute those coordinates.
   *
   * A player's transform is stored in buffer pixels, and a resize changes how
   * many of those there are per CSS pixel — so a host that converted once, when
   * the player was created, is left holding coordinates for a canvas that no
   * longer exists, and its characters drift on the next window resize. There is
   * nothing the overlay can fix on their behalf: only the host knows what the
   * numbers meant. Returns an unsubscribe function.
   */
  public onResized(listener: () => void): () => void {
    this._resizeListeners.add(listener);
    return () => this._resizeListeners.delete(listener);
  }

  /**
   * `getComputedStyle` for `el`, cached. The declaration it returns is live, so one
   * lookup per element serves every frame.
   */
  private computedStyleOf(el: HTMLElement): CSSStyleDeclaration {
    let s = this.computedStyles.get(el);
    if (!s) {
      s = getComputedStyle(el);
      this.computedStyles.set(el, s);
    }
    return s;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.surface.resize(Math.max(1, rect.width), Math.max(1, rect.height));
    // After the surface, so a listener reading `canvas.width` sees the new size.
    // Fired even when the size did not actually change (the surface clamps DPR
    // and may keep the same buffer): re-placing is idempotent, and suppressing
    // it would need this class to track the buffer size it last reported.
    for (const cb of [...this._resizeListeners]) {
      try {
        cb();
      } catch (e) {
        console.error('[SSOverlay] resize listener failed:', e);
      }
    }
  }

  private start(): void {
    if (this.rafId) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const delta = Math.max(0, now - this.lastTime);
      this.lastTime = now;

      // Read every rect first, then write. Interleaving reads and writes here is
      // what turns a scrolling page into layout thrash.
      const origin = this.canvas.getBoundingClientRect();
      const dpr = this.canvas.width / Math.max(1, origin.width);
      const followOpacity = this.options.followOpacity ?? false;
      // forEach, not `for (const [player, el] of …)`: destructuring a Map entry
      // allocates the [k, v] pair per element per frame.
      this.entries.forEach((el, player) => {
        if (!player.visible) return;
        const r = el.getBoundingClientRect();
        player.setBox(
          (r.left - origin.left) * dpr,
          (r.top - origin.top) * dpr,
          r.width * dpr,
          r.height * dpr,
        );
        if (followOpacity) {
          // Computed, not inline: this has to see the value a CSS transition or a
          // host engine's own animation is currently on, not the one an author
          // typed. Reading it here keeps the animation fading in step with the
          // element rather than a frame behind it.
          const opacity = Number.parseFloat(this.computedStyleOf(el).opacity);
          player.alpha = Number.isFinite(opacity) ? opacity : 1;
        }
      });

      for (const player of this.entries.keys()) {
        if (player.visible) player.update(delta);
      }
      this.surface.draw();

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Tear the overlay down and remove its canvas. */
  public destroy(): void {
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = 0; }
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.io?.disconnect();
    this.entries.clear();
    this.surface.destroy();
    this.canvas.remove();
    SSOverlay.instances.delete(this.id);
  }
}
