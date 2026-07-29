import { initializeWasm } from '@spritestudio/ssplayer-core';
import { SSWebGLRenderer } from './SSWebGLRenderer.js';
import { SSPlayer, type SSPlayerOptions } from './SSPlayer.js';
import { SSGroupAlpha } from './SSGroupAlpha.js';

export interface SSSurfaceOptions {
  premultipliedAlpha?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  maxDPR?: number;
  powerPreference?: 'low-power' | 'high-performance' | 'default';
  pauseWhenHidden?: boolean;
  autoStart?: boolean;
  /**
   * Opaque backdrop colour (0xRRGGBB) to clear each frame to. When omitted the
   * surface is cleared TRANSPARENT (0,0,0,0) for overlay use.
   *
   * Set this when an animation uses additive / backdrop-reading blend modes
   * (Add, Screen, Mul, …): those composite against the framebuffer, so they are
   * only correct when a real opaque backdrop is present. On a transparent surface
   * an additive sprite whose texture is a glow baked on an opaque black background
   * renders that black as an opaque block (it has nothing to add onto). This is
   * inherent to premultiplied-alpha compositing — ssplayer-pixi avoids it the same
   * way, by rendering on an opaque `backgroundColor`.
   *
   * For a single player that needs its own backdrop on a shared surface, use
   * {@link SSPlayer.backdrop} instead.
   */
  backgroundColor?: number;
  /**
   * Invert the vertical axis. Needed for **borrowed** contexts whose framebuffer Y
   * convention is opposite a standalone canvas's default framebuffer — RPG Maker
   * MZ's shared context, where SS otherwise draws upside-down. Owned surfaces
   * leave this off.
   */
  flipY?: boolean;
}

/**
 * A WebGL context's worth of SpriteStudio state, and any number of
 * {@link SSPlayer}s drawn into it.
 *
 * This is the unit the browser's WebGL context cap applies to: **contexts scale
 * with surfaces, not with players**. One surface can carry a whole scene.
 *
 * Three modes, chosen by what you construct it with and how you drive it:
 *
 * - **owned** — pass a `<canvas>`. The surface creates the context and owns the
 *   rAF ticker, the per-frame clear, `resize()`, context-loss recovery and
 *   visibility gating.
 * - **borrowed** — pass an existing `WebGLRenderingContext`. The surface touches
 *   none of the above: the host drives `update()` / `draw()` and owns the frame.
 *   This is how `ssplayer-rmmz` rides RPG Maker MZ's own context.
 * - **overlay** — an owned surface whose canvas covers the viewport, with each
 *   player's {@link SSPlayer.box} driven from a DOM element's rect. Built on top
 *   of the above; see SURFACE_PLAYER_SPEC.md §7.
 *
 * ```ts
 * await SSSurface.initialize();
 * const surface = new SSSurface(canvas, { autoStart: true });
 * const player = surface.createPlayer();
 * await player.load('chara.ssab');
 * await player.setAnimation('idle');
 * player.play();
 * ```
 */
export class SSSurface {
  static async initialize(wasm?: string | URL | ArrayBuffer | Uint8Array): Promise<void> {
    // WASM SIMD support is validated inside initializeWasm (core), so the same clear
    // error surfaces here on unsupported engines — callers can catch it to fall back.
    // Omit `wasm` to use wasm-bindgen's default resolution (the bundler serves the
    // runtime shipped with ssplayer-core); pass a URL/ArrayBuffer for inline/custom loads.
    if (wasm instanceof ArrayBuffer || wasm instanceof Uint8Array) {
      const module = await WebAssembly.compile(wasm as BufferSource);
      await initializeWasm(module);
    } else {
      await initializeWasm(wasm);
    }
  }

  public readonly gl: WebGLRenderingContext | WebGL2RenderingContext;
  public readonly canvas: HTMLCanvasElement;
  public readonly renderer: SSWebGLRenderer;
  /** False for a borrowed context: the host owns the frame, the clear and the canvas. */
  public readonly owned: boolean;

  private readonly players: SSPlayer[] = [];
  // Set when a player's `order` may no longer match the array; the list is
  // re-sorted lazily at draw time so N sets in one frame cost one sort.
  private _orderDirty = false;

  private _rafId = 0;
  private lastTime = 0;
  private _wantTicker = false;

  // --- Visibility gating (pauseWhenHidden) ---
  // Whether the canvas currently intersects the viewport. Starts true so hosts
  // without IntersectionObserver (or with pauseWhenHidden:false) always run.
  private _intersecting = true;
  private _io: IntersectionObserver | null = null;
  private _onVisibilityChange: (() => void) | null = null;

  // --- Context loss recovery ---
  private _contextLost = false;
  private _onContextLost: ((e: Event) => void) | null = null;
  private _onContextRestored: (() => void) | null = null;

  // Per-frame clear colour. Transparent by default; opaque when
  // options.backgroundColor is set (see SSSurfaceOptions.backgroundColor).
  private _clearColor: [number, number, number, number] = [0, 0, 0, 0];

  // Warn once per surface, not once per frame, when a player draws
  // framebuffer-reading blend modes with no backdrop anywhere (see checkBackdrop).
  private _warnedNoBackdrop = false;

  // Offscreen pass for fading a player as one image instead of part by part.
  // Built on first use, so a surface whose players are all opaque never allocates
  // a framebuffer (see SSGroupAlpha).
  private _groupAlpha: SSGroupAlpha | null = null;

  constructor(
    target: HTMLCanvasElement | WebGLRenderingContext | WebGL2RenderingContext,
    public options: SSSurfaceOptions = {},
  ) {
    if (typeof HTMLCanvasElement !== 'undefined' && target instanceof HTMLCanvasElement) {
      this.owned = true;
      this.canvas = target;
      const glAttrs = {
        alpha: true,
        premultipliedAlpha: options.premultipliedAlpha ?? true,
        stencil: options.stencil ?? true,
        antialias: options.antialias ?? false,
        powerPreference: options.powerPreference ?? 'low-power',
        // Ad-friendly context attrs: keep the drawing buffer disposable (we clear + redraw
        // every frame), never fail on a "slow GPU" caveat (widen device reach),
        // and hint desynchronized presentation for lower-latency low-power draw.
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
        desynchronized: true,
      };
      this.gl = (this.canvas.getContext('webgl2', glAttrs) || this.canvas.getContext('webgl', glAttrs)) as
        WebGLRenderingContext | WebGL2RenderingContext;
      if (!this.gl) {
        // Say why. Without this the failure surfaces further down as a confusing
        // "cannot read property createShader of null" from the renderer. The
        // usual cause is the context cap: every surface holds one for its
        // lifetime, and browsers allow only ~8-16 at once.
        throw new Error(
          '[SSSurface] Could not get a WebGL context for this canvas. Either WebGL is unavailable, ' +
          'or too many contexts are already live — browsers cap them at roughly 8-16 per page, and ' +
          'each surface holds one. Put several players on one surface instead of one surface each.',
        );
      }
    } else {
      this.owned = false;
      this.gl = target as WebGLRenderingContext | WebGL2RenderingContext;
      this.canvas = this.gl.canvas as HTMLCanvasElement;
    }

    this.renderer = new SSWebGLRenderer(this.gl);

    if (options.backgroundColor !== undefined) {
      const c = options.backgroundColor;
      this._clearColor = [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255, 1];
    }

    // A borrowed context belongs to the host: it owns the frame loop, the clear and
    // the context-loss lifecycle (MZ signals us through its own `contextChange`).
    // Installing our own listeners or rAF there would fight it.
    if (this.owned) {
      this.registerContextLossHandlers();
      if (options.autoStart) this.startTicker();
    }
  }

  /** Drawing-buffer size in device pixels — the space player boxes live in. */
  public get drawingBufferSize(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  // --- Players --------------------------------------------------------------

  /** Construct a player on this surface and add it. */
  public createPlayer(options?: SSPlayerOptions): SSPlayer {
    return new SSPlayer(this, options);
  }

  /**
   * Add a player. Called for you by the {@link SSPlayer} constructor, so you only
   * need this to move a player between surfaces. Idempotent.
   */
  public add(player: SSPlayer): void {
    if (this.players.indexOf(player) !== -1) return;
    this.players.push(player);
    this._orderDirty = true;
  }

  /** Remove a player without destroying it. Idempotent. */
  public remove(player: SSPlayer): void {
    const i = this.players.indexOf(player);
    if (i !== -1) this.players.splice(i, 1);
  }

  /** Players in draw order (front of the array draws first). */
  public get children(): readonly SSPlayer[] {
    this.sortIfNeeded();
    return this.players;
  }

  /** Call after changing any player's `order` so the next draw re-sorts. */
  public invalidateOrder(): void {
    this._orderDirty = true;
  }

  private sortIfNeeded(): void {
    if (!this._orderDirty) return;
    // Decorate-sort-undecorate to keep it stable on `order` ties, so players added
    // in a given sequence keep that sequence (Array.prototype.sort is only
    // guaranteed stable in modern engines, and this also avoids re-comparing).
    const decorated = this.players.map((p, i) => ({ p, i }));
    decorated.sort((a, b) => (a.p.order - b.p.order) || (a.i - b.i));
    for (let i = 0; i < decorated.length; i++) this.players[i] = decorated[i].p;
    this._orderDirty = false;
  }

  // --- Frame ----------------------------------------------------------------

  /** Advance every player's timeline. Owned surfaces call this from their ticker. */
  public update(deltaMs: number): void {
    for (const player of this.players) player.update(deltaMs);
  }

  /**
   * Clear (owned only) and draw every player in order.
   *
   * A borrowed surface never clears: the host's framebuffer already holds its own
   * scene, and wiping it would erase the host's frame.
   */
  public draw(): void {
    // Drawing on a lost context is a no-op at best; skip until it is restored
    // (isContextLost() also catches a loss that fired before our handler ran).
    if (this._contextLost || this.gl.isContextLost()) return;

    const gl = this.gl;
    this.sortIfNeeded();

    if (this.owned) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      const [r, g, b, a] = this._clearColor;
      // The full clear must not be scissored — disable first, in case a previous
      // frame's clipped player left the test enabled after an exception.
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(r, g, b, a);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    }

    const flipY = this.options.flipY ?? false;
    for (const player of this.players) {
      if (!player.isVisible) continue;

      // Scissor and backdrop are pure GL state around the draw — the renderer does
      // not need to know about either. Both break the batch, which is why they are
      // opt-in per player.
      const clipped = player.clip || player.backdrop !== null;
      if (clipped) {
        const box = player.box;
        gl.enable(gl.SCISSOR_TEST);
        // Scissor is Y-up from the bottom-left; boxes are Y-down from the top-left.
        gl.scissor(
          Math.round(box.x),
          Math.round(this.canvas.height - (box.y + box.h)),
          Math.max(0, Math.round(box.w)),
          Math.max(0, Math.round(box.h)),
        );
      }
      if (player.backdrop !== null) {
        const c = player.backdrop;
        gl.clearColor(((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }

      this.checkBackdrop(player);

      // A partly transparent player is drawn opaque into an offscreen texture and
      // composited once, so overlapping parts inside it do not accumulate
      // coverage and darken the seams. Fully opaque players skip all of it.
      const fading = player.alpha < 1;
      if (fading) {
        this._groupAlpha ??= new SSGroupAlpha(gl);
        this._groupAlpha.begin(this.canvas.width, this.canvas.height);
      }

      this.renderer.render(
        player.internalPlayer,
        player.resourceManager,
        player.renderTransform(),
        flipY,
        // Opaque for the offscreen pass: the alpha is applied once, on composite.
        fading ? player.opaqueTintVector : player.tintVector,
      );

      if (fading) {
        this._groupAlpha!.end(player.alpha);
        // No state to restore: render() re-binds its program and forces a blend
        // re-apply on entry, and it leaves no VAO bound for the composite to
        // disturb.
      }

      if (clipped) gl.disable(gl.SCISSOR_TEST);
    }
  }

  /**
   * Warn once when a player draws with no opaque backdrop anywhere. Add / Screen /
   * Mul read the framebuffer, so with nothing behind them a glow baked on opaque
   * black renders as a black box — which reads as broken art, not a broken setup.
   * The warning is what makes it diagnosable.
   *
   * Deliberately cheap and approximate: it fires on the absence of a backdrop, not
   * on detecting those blend ops, because per-part blend inspection every frame
   * would cost more than the problem.
   */
  private checkBackdrop(player: SSPlayer): void {
    if (this._warnedNoBackdrop) return;
    if (!this.owned) return; // the host's framebuffer is the backdrop
    if (this.options.backgroundColor !== undefined || player.backdrop !== null) return;
    if (this.players.length < 2) return; // a lone player on a transparent surface is the normal overlay/ad case
    this._warnedNoBackdrop = true;
    console.warn(
      '[SSSurface] Several players share a transparent surface with no backdrop. ' +
      'Add / Screen / Mul blend modes read the framebuffer and will composite against ' +
      'each other rather than against a real backdrop. Set `backgroundColor` on the surface, ' +
      'or `backdrop` on the affected player.',
    );
  }

  // --- Ticker ---------------------------------------------------------------

  public startTicker(): void {
    if (!this.owned) return;
    this._wantTicker = true;
    this.ensureVisibilityWatch();
    this._syncTicker();
  }

  public stopTicker(): void {
    this._wantTicker = false;
    this._syncTicker();
  }

  /**
   * Whether the internal RAF loop should currently run: the user asked for it
   * (`startTicker`), the context is alive, and — when `pauseWhenHidden` is on —
   * the canvas is on-screen and the tab is foregrounded.
   */
  private get _shouldRun(): boolean {
    const docHidden = typeof document !== 'undefined' && document.hidden;
    return this._wantTicker && !this._contextLost && this._intersecting && !docHidden;
  }

  /** Start or stop the RAF loop to match `_shouldRun` (idempotent). */
  private _syncTicker(): void {
    if (this._shouldRun && !this._rafId) {
      // Reset the clock so the first frame after a pause/restore uses a normal
      // delta instead of the whole idle gap.
      this.lastTime = performance.now();
      const tick = (now: number) => {
        const deltaMs = now - this.lastTime;
        this.lastTime = now;
        this.update(deltaMs);
        this.draw();
        this._rafId = this._shouldRun ? requestAnimationFrame(tick) : 0;
      };
      this._rafId = requestAnimationFrame(tick);
    } else if (!this._shouldRun && this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  /**
   * Lazily wire the visibility gating used by `pauseWhenHidden` (default on):
   * an IntersectionObserver pauses the ticker when the canvas scrolls off-screen
   * and `visibilitychange` pauses it when the tab is backgrounded (saves battery
   * and satisfies ad viewability). No-op when pauseWhenHidden is false or the APIs
   * are unavailable (then the ticker simply always runs).
   *
   * This is surface-level: every player on the surface runs or none do. Per-player
   * gating needs per-player bounds and belongs to overlay mode.
   */
  private ensureVisibilityWatch(): void {
    if (this.options.pauseWhenHidden === false) return;
    if (this._io || this._onVisibilityChange) return; // already set up

    if (typeof IntersectionObserver !== 'undefined') {
      // Until the observer's first callback we don't know if we're on-screen;
      // assume hidden so an off-screen canvas never paints an initial frame.
      this._intersecting = false;
      this._io = new IntersectionObserver((entries) => {
        this._intersecting = entries[entries.length - 1].isIntersecting;
        this._syncTicker();
      });
      this._io.observe(this.canvas);
    }
    if (typeof document !== 'undefined') {
      this._onVisibilityChange = () => this._syncTicker();
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  // --- Sizing ---------------------------------------------------------------

  /**
   * Size the drawing buffer to `cssW × cssH` at the device pixel ratio, clamped by
   * `maxDPR` to bound fill-rate on HiDPI.
   *
   * Only the backing store is written — **CSS is the host's business**. Size the
   * canvas element yourself (a stylesheet, a layout, `style.width`); a library that
   * writes inline styles fights whatever the host already set.
   *
   * Players tracking the whole surface follow this automatically.
   */
  public resize(cssW: number, cssH: number, dpr?: number): void {
    const r = Math.min(dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1), this.options.maxDPR ?? 2);
    this.canvas.width = Math.max(1, Math.round(cssW * r));
    this.canvas.height = Math.max(1, Math.round(cssH * r));
  }

  // --- Context loss ---------------------------------------------------------

  /**
   * Subscribe to `webglcontextlost` / `webglcontextrestored`. Mobile webviews drop
   * the GL context aggressively; without this the canvas goes blank permanently. On
   * loss we must `preventDefault()` (otherwise the browser never fires a restore)
   * and stop drawing; on restore we rebuild every GL object and re-upload every
   * player's textures, then resume.
   */
  private registerContextLossHandlers(): void {
    this._onContextLost = (e: Event) => {
      e.preventDefault();
      this._contextLost = true;
      this._syncTicker(); // halt the RAF while the context is gone
    };
    this._onContextRestored = () => { void this.restoreContext(); };
    this.canvas.addEventListener('webglcontextlost', this._onContextLost as EventListener, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
  }

  /**
   * Rebuild GPU state after the context is restored: the renderer's GL objects
   * (programs / buffers / VAO) synchronously, then every player's textures from
   * their retained sources. Only after textures are back do we clear the lost flag
   * and resume — so we never draw a frame with missing textures.
   *
   * On a shared surface this is one operation for all players, which also means one
   * loss blanks every player until it completes.
   */
  public async restoreContext(): Promise<void> {
    // The offscreen target died with the context; drop it and let the next fade
    // rebuild it rather than carrying dangling GL names around.
    this._groupAlpha?.destroy();
    this._groupAlpha = null;
    this.renderer.restoreContext();
    await Promise.all(this.players.map(async (player) => {
      try {
        await player.resourceManager.restoreContext();
      } catch (e) {
        console.warn('[SSSurface] Texture restore after context loss failed; some parts may render blank.', e);
      }
    }));
    this._contextLost = false;
    this._syncTicker();
    // For manually-driven hosts (no ticker frame coming) repaint the current frame
    // now — but not while gated off-screen (an on-screen manual host keeps
    // _intersecting true because it never wired the observer).
    if (!this._rafId && this._intersecting) this.draw();
  }

  /** @internal Let a borrowed host tell us its context was recreated. */
  public contextChange(): void {
    this.renderer.restoreContext();
  }

  // --- Teardown -------------------------------------------------------------

  /**
   * Destroy the surface and everything it owns: the renderer's GL objects, plus
   * every player still attached (and therefore their WASM allocations and
   * textures).
   */
  public destroy(): void {
    this.stopTicker();

    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._onVisibilityChange = null;

    if (this._onContextLost) {
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost as EventListener);
      this._onContextLost = null;
    }
    if (this._onContextRestored) {
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      this._onContextRestored = null;
    }

    // destroy() splices from this.players, so iterate a copy.
    for (const player of [...this.players]) player.destroy();
    this.players.length = 0;

    this._groupAlpha?.destroy();
    this._groupAlpha = null;
    this.renderer.destroy();
  }
}
