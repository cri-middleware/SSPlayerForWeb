import { DirectInternalPlayer, IAudioManager, initializeWasm, ssFormat, SSBlendOp, SSOverridePriority } from '@spritestudio/ssplayer-core';
import { SSWebGLRenderer } from './SSWebGLRenderer.js';
import { SSWebGLResourceManager } from './SSWebGLResourceManager.js';

// --- Animation event payloads (06_playback_control.ja.md) ---
// Event extraction lives here in the renderer package (not core): it reads the
// SSAB events table for the current animation via the runtime manager's
// introspection accessors, parses the FlatBuffer payloads, and dispatches typed
// callbacks. Driven once per frame from update() (see pollEvents). Mirrors
// ssplayer-pixi/src/SSPlayer.ts (memory: events-handled-in-pixi-not-core).

/**
 * A user-data event fired by a part on the frame it was authored. Optional
 * fields mirror the SSAB payload: each is present only if that value type was
 * authored (an authored integer of `0` is still present, distinct from absent).
 */
export interface SSUserDataEvent {
    partIndex: number;
    partName: string | null;
    integer?: number;
    str?: string;
    /** User-data rectangle as authored (left/top/right/bottom). */
    rect?: { x1: number; y1: number; x2: number; y2: number };
    /** User-data point as authored. */
    point?: { x: number; y: number };
}

/**
 * A signal event fired by a part. `params` maps each command parameter id to
 * its authored value (bool / int / float / string). Only **active** signals are
 * dispatched (mirroring the Godot / Unity players and the porting guide).
 */
export interface SSSignalEvent {
    partIndex: number;
    partName: string | null;
    active: boolean;
    commandId: string | null;
    params: Record<string, boolean | number | string>;
}

/**
 * An audio event fired by a part: the SSAB sound reference (hashes + alias
 * name) plus loop count. The runtime plays no audio — the host resolves the
 * sound and plays it on its own audio engine (11_optional_features.ja.md).
 * Attach an {@link IAudioManager} (e.g. `SSWebAudioManager`) to actually play it.
 */
export interface SSAudioEvent {
    partIndex: number;
    partName: string | null;
    soundListNameHash: number;
    soundNameHash: number;
    soundName: string | null;
    loopNum: number;
}

/** Unsubscribe handle returned by the `onX` event-registration methods. */
export type Unsubscribe = () => void;

export interface SSCanvasPlayerOptions {
  premultipliedAlpha?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  maxDPR?: number;
  powerPreference?: 'low-power' | 'high-performance' | 'default';
  pauseWhenHidden?: boolean;
  autoStart?: boolean;
  /**
   * Automatically play the animation's sounds (default `true`).
   *
   * When the loaded SSAB references sounds and no `audioManager` has been set, the
   * player lazily creates a default {@link SSWebAudioManager} on `setAnimation`
   * and wires it up — so sound "just works" with zero consumer code, like
   * ssplayer-pixi. The audio adapter is loaded via a **dynamic import**, so it is
   * a separate chunk that is fetched only when a sound-bearing animation is set:
   * animations without sound (and the `./lite` build) never pull in any audio
   * code, keeping the default bundle within the size budget.
   *
   * Set to `false` for full manual control (attach your own `IAudioManager`, or
   * none) — nothing audio-related is then loaded automatically.
   */
  autoAudio?: boolean;
  /**
   * Opaque backdrop colour (0xRRGGBB) to clear each frame to. When omitted the
   * canvas is cleared TRANSPARENT (0,0,0,0) for overlay use.
   *
   * Set this when the animation uses additive / backdrop-reading blend modes
   * (Add, Screen, Mul, …): those composite against the framebuffer, so they are
   * only correct when a real opaque backdrop is present. On a transparent canvas
   * an additive sprite whose texture is a glow baked on an opaque black
   * background renders that black as an opaque block (it has nothing to add
   * onto). This is inherent to premultiplied-alpha compositing — ssplayer-pixi
   * avoids it the same way, by rendering on an opaque `backgroundColor`.
   */
  backgroundColor?: number;
}

export class SSCanvasPlayer {
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

  public internalPlayer!: DirectInternalPlayer;
  public renderer!: SSWebGLRenderer;
  public resourceManager!: SSWebGLResourceManager;

  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | WebGL2RenderingContext;
  // Active requestAnimationFrame handle (0 = not scheduled). The internal ticker
  // runs only while `_wantTicker` (user intent) AND the canvas is visible AND the
  // context is not lost — see _syncTicker / _shouldRun.
  private _rafId: number = 0;
  private lastTime: number = 0;
  private _wantTicker: boolean = false;
  private _isPlaying: boolean = false;

  // --- Visibility gating (pauseWhenHidden) ---
  // Whether the canvas currently intersects the viewport. Starts true so hosts
  // without IntersectionObserver (or with pauseWhenHidden:false) always run.
  private _intersecting: boolean = true;
  private _io: IntersectionObserver | null = null;
  private _onVisibilityChange: (() => void) | null = null;

  // --- Context loss recovery ---
  private _contextLost: boolean = false;
  private _onContextLost: ((e: Event) => void) | null = null;
  private _onContextRestored: (() => void) | null = null;
  private transformMatrix = new Float32Array([1, 0, 0, 1, 0, 0]); // [a, b, c, d, tx, ty]
  // Per-frame clear colour. Transparent by default; an opaque backdrop when
  // options.backgroundColor is set (see SSCanvasPlayerOptions.backgroundColor).
  private _clearColor: [number, number, number, number] = [0, 0, 0, 0];

  // --- Animation event listeners (06_playback_control.ja.md) ---
  private readonly _userDataListeners = new Set<(e: SSUserDataEvent) => void>();
  private readonly _signalListeners = new Set<(e: SSSignalEvent) => void>();
  private readonly _audioListeners = new Set<(e: SSAudioEvent) => void>();
  private readonly _animEndListeners = new Set<() => void>();
  private readonly _animLoopListeners = new Set<() => void>();
  private readonly _frameListeners = new Set<(frame: number) => void>();
  // Guards the one-time default-audio auto-wire (see ensureAutoAudio).
  private _audioAutoWired = false;

  constructor(
    target: HTMLCanvasElement | WebGLRenderingContext | WebGL2RenderingContext,
    public options: SSCanvasPlayerOptions = {}
  ) {
    if (target instanceof HTMLCanvasElement) {
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
      this.gl = (this.canvas.getContext('webgl2', glAttrs) || this.canvas.getContext('webgl', glAttrs)) as any;
    } else {
      this.gl = target;
      this.canvas = this.gl.canvas as HTMLCanvasElement;
    }

    this.renderer = new SSWebGLRenderer(this.gl);
    this.resourceManager = new SSWebGLResourceManager(this.gl);
    this.internalPlayer = new DirectInternalPlayer(this.resourceManager);

    if (options.backgroundColor !== undefined) {
      const c = options.backgroundColor;
      this._clearColor = [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255, 1];
    }

    this.registerContextLossHandlers();

    if (options.autoStart) {
      this.startTicker();
    }
  }

  /**
   * Subscribe to `webglcontextlost` / `webglcontextrestored`.
   * Mobile webviews drop the GL context aggressively; without this the canvas
   * goes blank permanently. On loss we must `preventDefault()` (otherwise the
   * browser never fires a restore) and stop drawing; on restore we rebuild every
   * GL object and re-upload textures, then resume.
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
   * Rebuild GPU state after the context is restored: renderer GL objects
   * (programs / buffers / VAO) synchronously, then textures asynchronously from
   * their retained sources. Only after textures are back do we clear the lost
   * flag and resume — so we never draw a frame with missing textures.
   */
  private async restoreContext(): Promise<void> {
    this.renderer.restoreContext();
    try {
      await this.resourceManager.restoreContext();
    } catch (e) {
      console.warn('[SSCanvasPlayer] Texture restore after context loss failed; some parts may render blank.', e);
    }
    this._contextLost = false;
    this._syncTicker();
    // For manually-driven hosts (no ticker frame coming) repaint the current
    // frame now — but not while gated off-screen (an on-screen manual host keeps
    // _intersecting true because it never wired the observer).
    if (!this._rafId && this._intersecting) this.draw();
  }

  /** Direct render mode + Y-down coordinate system, matching the WebGL projection. */
  private configureContext(): void {
    const ctx = this.internalPlayer.runtimeManager.context;
    ctx.set_render_mode(0); // Direct
    ctx.set_coordinate_system(1); // YDown
  }

  public async loadBuffer(
    ssab: ArrayBuffer | Uint8Array,
    textures: Map<number, TexImageSource | ArrayBuffer | string>
  ): Promise<void> {
    this.internalPlayer.bindResource(new Uint8Array(ssab));
    this.configureContext();
    // Load textures into resourceManager
    for (const [hash, src] of textures.entries()) {
      if (typeof src === 'string') {
        await this.resourceManager.loadTexture(src, hash);
      } else if (src instanceof ArrayBuffer || src instanceof Uint8Array) {
        await this.resourceManager.loadTextureFromBytes(src instanceof ArrayBuffer ? new Uint8Array(src) : src, hash);
      } else {
        this.resourceManager.bindTextureSource(src as TexImageSource, hash, (src as any).width as number, (src as any).height as number);
      }
    }
  }

  public async load(ssabUrl: string): Promise<void> {
    await this.internalPlayer.load(ssabUrl);
    this.configureContext();
  }

  public async setAnimation(name: string): Promise<void> {
    // Auto-wire a default audio manager BEFORE setAnimation, since the core
    // preloads the animation's sounds there (only when an audioManager is set).
    await this.ensureAutoAudio();
    await this.internalPlayer.setAnimation(name);
  }

  /**
   * Lazily create + wire a default {@link SSWebAudioManager} so sound plays with
   * zero consumer code (mirrors ssplayer-pixi's auto-behaviour). No-op when:
   * `options.autoAudio === false`, an `audioManager` is already set (consumer
   * supplied one), already attempted, or the current SSAB has no sounds.
   *
   * The adapter is pulled in via a **dynamic import**, so it lands in a separate
   * chunk fetched only here, only when sounds exist — the base player and the
   * `./lite` build stay audio-free (size budget). Failures (e.g. an
   * environment without dynamic import) are swallowed so the animation still
   * plays silently; opt out with `autoAudio: false` + your own `IAudioManager`.
   */
  private async ensureAutoAudio(): Promise<void> {
    if (this.options.autoAudio === false) return;
    if (this._audioAutoWired || this.internalPlayer.audioManager) return;
    if (this.internalPlayer.runtimeManager.getSounds().length === 0) return;
    this._audioAutoWired = true;
    try {
      const { SSWebAudioManager } = await import('./SSWebAudioManager.js');
      // bindToPlayer sets `this.audioManager` and subscribes onAudio → play.
      new SSWebAudioManager().bindToPlayer(this);
    } catch (e) {
      console.warn('[SSCanvasPlayer] Failed to auto-load the audio adapter; sound disabled. Attach an IAudioManager manually if needed.', e);
    }
  }

  public play(startFrame?: number): void {
    this.internalPlayer.play(startFrame);
    this._isPlaying = true;
  }

  public pause(): void {
    this.internalPlayer.pause();
    this._isPlaying = false;
  }

  public resume(): void {
    this.internalPlayer.resume();
    this._isPlaying = true;
  }

  public stop(): void {
    this.internalPlayer.stop();
    this._isPlaying = false;
  }

  public get frame(): number { return this.internalPlayer.getFrameNo(); }
  public set frame(v: number) { this.internalPlayer.setFrame(v); }

  public get isPlaying(): boolean { return this._isPlaying; }
  public set speedScale(v: number) { this.internalPlayer.setSpeed(v); }

  public get subFrameEnabled(): boolean { return this.internalPlayer.subFrameEnabled; }
  public set subFrameEnabled(v: boolean) { this.internalPlayer.subFrameEnabled = v; }

  // --- Part overrides (65_override_layer) ---
  //
  // Thin pass-throughs to the core player, which owns the contract (see
  // InternalPlayerBase): part is a name or an index, false means the part is
  // unknown or the runtime rejected the call, and the runtime keeps the override
  // itself — nothing is re-applied per frame here.
  //
  // An override changes the output without changing the frame number. That is
  // invisible to this player because draw() is unconditional: the RAF ticker
  // paints every frame even while stopped, and a host driving frames by hand
  // already calls draw() itself. Nothing needs invalidating here.

  /** Resolve a part name to its index, or -1 if the part is not in the current animation. */
  public findPartIndex(partName: string): number {
    return this.internalPlayer.findPartIndex(partName);
  }

  /** Force-hide a part (or revert it to the animation), optionally cascading to its descendants. */
  public setPartVisibilityOverride(part: number | string, hide: boolean, cascade: boolean = false): boolean {
    return this.internalPlayer.setPartVisibilityOverride(part, hide, cascade);
  }

  /** Clear a part's visibility override (revert it to the animation). */
  public clearPartVisibilityOverride(part: number | string): boolean {
    return this.internalPlayer.clearPartVisibilityOverride(part);
  }

  /** Override a Normal part's colour with a single `0xRRGGBBAA` value (all four corners). */
  public setPartColorOverride(
    part: number | string,
    blendOp: SSBlendOp,
    rgba: number,
    priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
  ): boolean {
    return this.internalPlayer.setPartColorOverride(part, blendOp, rgba, priority);
  }

  /** Override a Normal part's colour with four `0xRRGGBBAA` corners (left-top, right-top, left-bottom, right-bottom). */
  public setPartColorOverrideCorners(
    part: number | string,
    blendOp: SSBlendOp,
    corners: readonly [number, number, number, number],
    priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
  ): boolean {
    return this.internalPlayer.setPartColorOverrideCorners(part, blendOp, corners, priority);
  }

  /** Clear a part's colour override (revert it to the animation). */
  public clearPartColorOverride(part: number | string): boolean {
    return this.internalPlayer.clearPartColorOverride(part);
  }

  /** Make a Normal / mask part draw a different cell, named by its cell map (without .ssce) and cell name. */
  public setPartCellOverride(
    part: number | string,
    cellmapName: string,
    cellName: string,
    priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
  ): boolean {
    return this.internalPlayer.setPartCellOverride(part, cellmapName, cellName, priority);
  }

  /** Clear a part's cell override (revert it to the animation). */
  public clearPartCellOverride(part: number | string): boolean {
    return this.internalPlayer.clearPartCellOverride(part);
  }

  /** Clear every per-part override on this player. */
  public clearAllPartOverrides(): boolean {
    return this.internalPlayer.clearAllPartOverrides();
  }

  /** Cell-map names in the loaded .ssab (for discovering cell-override targets). */
  public getCellMapNames(): string[] {
    return this.internalPlayer.getCellMapNames();
  }

  /** Cell names in the named cell map (for discovering cell-override targets). */
  public getCellNames(cellmapName: string): string[] {
    return this.internalPlayer.getCellNames(cellmapName);
  }

  // --- Part following: transform read-out ---
  // This player draws to a canvas with no scene graph, so there is no managed
  // attach; read a part's transform here and drive your own DOM/canvas element
  // (compose the affine with this player's own screen transform). Pair with
  // onFrame to update every frame.

  /**
   * The part's current-frame transform as a 2D affine `[m00, m01, m10, m11, tx,
   * ty]` in animation-local (Y-down) space, or null if the part is unknown. Read
   * after a frame advanced (e.g. from onFrame). Pass `out` to avoid allocation.
   */
  public getPartTransform(part: number | string, out?: Float32Array): Float32Array | null {
    return this.internalPlayer.getPartTransform(part, out);
  }

  /** Whether the part is hidden on the current frame (animation `hide`), or null if unknown. */
  public isPartHidden(part: number | string): boolean | null {
    return this.internalPlayer.isPartHidden(part);
  }

  public startTicker(): void {
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
   * and `visibilitychange` pauses it when the tab is backgrounded (saves
   * battery and satisfies ad viewability). No-op when pauseWhenHidden is
   * false or the APIs are unavailable (then the ticker simply always runs).
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

  public update(deltaMs: number): void {
    if (!this._isPlaying) return;
    // While paused, internalPlayer.update() still advances `independent` slots but
    // does NOT move the timeline, so no events are passed — skip polling then.
    const pausing = this.internalPlayer.isPausing;
    this.internalPlayer.update(deltaMs);
    if (!pausing) {
      // Drain the events accumulated by this update (user-data / signal / audio +
      // animation end/loop) right away, while the runtime's passed-event buffer is
      // still valid. Must run on the same tick that advanced — including the tick a
      // non-looping animation finishes on.
      this.pollEvents();
    }

    // World matrices are final for this frame: notify per-frame listeners (the
    // point getPartTransform is valid for the new frame).
    if (this._frameListeners.size > 0) {
      const f = this.internalPlayer.getFrameNo();
      this._frameListeners.forEach(cb => cb(f));
    }
  }

  public draw(): void {
    // Drawing on a lost context is a no-op at best; skip until it is restored
    // (isContextLost() also catches a loss that fired before our handler ran).
    if (this._contextLost || this.gl.isContextLost()) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const [r, g, b, a] = this._clearColor;
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // Projection and all other program/blend state is set up in renderer.render().
    this.renderer.render(this.internalPlayer, this.resourceManager, this.transformMatrix);
  }

  public setTransform(t: {
    x?: number; y?: number; scaleX?: number; scaleY?: number;
    rotation?: number; anchorX?: number; anchorY?: number;
  }): void {
    const x = t.x ?? 0;
    const y = t.y ?? 0;
    const sx = t.scaleX ?? 1;
    const sy = t.scaleY ?? 1;
    const rot = t.rotation ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // Full 2D affine [m00,m01,m10,m11,tx,ty] = translate * rotate * scale, matching
    // GeometryBuilder.composeAffine. (anchorX/anchorY are not yet applied.)
    const m = this.transformMatrix;
    m[0] = cos * sx;  // m00
    m[1] = -sin * sy; // m01
    m[2] = sin * sx;  // m10
    m[3] = cos * sy;  // m11
    m[4] = x;         // tx
    m[5] = y;         // ty
  }

  public resize(cssW: number, cssH: number, dpr?: number): void {
    const r = Math.min(dpr ?? window.devicePixelRatio, this.options.maxDPR ?? 2);
    this.canvas.width = cssW * r;
    this.canvas.height = cssH * r;
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
  }

  // --- Animation events (06_playback_control.ja.md) ---
  //
  // Listeners are drained each frame by update() via pollEvents(). Each
  // registration returns an unsubscribe function. The runtime plays no audio —
  // onAudio hands the sound reference to the host (attach an IAudioManager such
  // as SSWebAudioManager to actually play it).

  /** Registers a user-data event listener. Returns an unsubscribe function. */
  public onUserData(listener: (e: SSUserDataEvent) => void): Unsubscribe {
    this._userDataListeners.add(listener);
    return () => { this._userDataListeners.delete(listener); };
  }

  /** Registers a signal event listener (active signals only). Returns an unsubscribe function. */
  public onSignal(listener: (e: SSSignalEvent) => void): Unsubscribe {
    this._signalListeners.add(listener);
    return () => { this._signalListeners.delete(listener); };
  }

  /** Registers an audio event listener. Returns an unsubscribe function. */
  public onAudio(listener: (e: SSAudioEvent) => void): Unsubscribe {
    this._audioListeners.add(listener);
    return () => { this._audioListeners.delete(listener); };
  }

  /** Fires once every configured loop has played. Never under an infinite loop count, nor on stop(). */
  public onAnimationEnd(listener: () => void): Unsubscribe {
    this._animEndListeners.add(listener);
    return () => { this._animEndListeners.delete(listener); };
  }

  /** Fires on each loop boundary crossing. */
  public onAnimationLoop(listener: () => void): Unsubscribe {
    this._animLoopListeners.add(listener);
    return () => { this._animLoopListeners.delete(listener); };
  }

  /**
   * Fires once per advanced frame from update(), after the timeline advanced and
   * its world matrices are final — the point at which {@link getPartTransform} is
   * valid for the new frame. This player has no scene graph, so follow a part by
   * reading getPartTransform here and positioning your own element (compose it
   * with this player's own screen transform). Returns an unsubscribe function.
   */
  public onFrame(listener: (frame: number) => void): Unsubscribe {
    this._frameListeners.add(listener);
    return () => { this._frameListeners.delete(listener); };
  }

  /**
   * Drain and dispatch the events accumulated by the last runtime update:
   * user-data / signal / audio, plus animation end (edge) and loop (pulse).
   * Called from update() right after `internalPlayer.update()`, while the
   * runtime's passed-event buffer is still valid. Reads event payloads from the
   * current animation's SSAB events table via the runtime manager's
   * introspection accessors. Safe with no listeners / no animation.
   */
  private pollEvents(): void {
    const ctx = this.internalPlayer.runtimeManager.context;

    const { looped, finished } = this.internalPlayer.pollPlaybackEvents();
    if (finished && this._animEndListeners.size > 0) {
      this._animEndListeners.forEach(cb => cb());
    }
    if (looped && this._animLoopListeners.size > 0) {
      this._animLoopListeners.forEach(cb => cb());
    }

    const count = ctx.get_passed_event_count();
    if (count <= 0) return;
    if (this._userDataListeners.size === 0 && this._signalListeners.size === 0 && this._audioListeners.size === 0) return;

    const anim = this.internalPlayer.runtimeManager.getCurrentAnimationData();
    if (!anim) return;

    // is_playing_forward() handles the Forward/Backward/PingPong direction state;
    // getSpeed() handles user-level time reversal. Audio only plays going forward.
    const isPlayingForward = (ctx.is_playing_forward() === (this.internalPlayer.getSpeed() >= 0));

    for (let i = 0; i < count; i++) {
      // get_passed_event_index returns the index into this animation's per-frame
      // events table (single-source playback: always primary).
      const eventIdx = ctx.get_passed_event_index(i);
      const events = anim.events(eventIdx);
      if (!events) continue;
      if (this._userDataListeners.size > 0) this.dispatchUserData(events);
      if (this._signalListeners.size > 0) this.dispatchSignals(events);
      if (this._audioListeners.size > 0 && isPlayingForward) this.dispatchAudios(events);
    }
  }

  private dispatchUserData(events: ssFormat.EventsPerFrame): void {
    const mgr = this.internalPlayer.runtimeManager;
    const n = events.usersLength();
    for (let j = 0; j < n; j++) {
      const user = events.users(j);
      const val = user?.value();
      if (!user || !val) continue;
      const partIndex = user.partIndex();
      const ev: SSUserDataEvent = { partIndex, partName: mgr.getPartName(partIndex) };
      const intEntry = val.integer();
      if (intEntry) ev.integer = intEntry.value();
      const str = val.str();
      if (str !== null) ev.str = str;
      const rect = val.rect();
      if (rect) ev.rect = { x1: rect.x1(), y1: rect.y1(), x2: rect.x2(), y2: rect.y2() };
      const point = val.point();
      if (point) ev.point = { x: point.v1(), y: point.v2() };
      this._userDataListeners.forEach(cb => cb(ev));
    }
  }

  private dispatchSignals(events: ssFormat.EventsPerFrame): void {
    const mgr = this.internalPlayer.runtimeManager;
    const n = events.signalsLength();
    for (let j = 0; j < n; j++) {
      const sig = events.signals(j);
      const val = sig?.value();
      if (!sig || !val) continue;
      // Skip inactive signals (Godot / Unity / porting-guide behaviour).
      if (!val.active()) continue;

      const params: Record<string, boolean | number | string> = {};
      const pn = val.paramsLength();
      for (let k = 0; k < pn; k++) {
        const param = val.params(k);
        if (!param) continue;
        const paramId = param.paramId();
        if (paramId === null) continue;

        // Resolve the param's union value (Bool/Index/Integer/Floating/Text).
        let boxed: boolean | number | string | undefined;
        switch (param.valueType()) {
          case ssFormat.SignalCommandParamValue.Bool:
            boxed = (param.value(new ssFormat.BoolValueEntry()) as ssFormat.BoolValueEntry | null)?.value(); break;
          case ssFormat.SignalCommandParamValue.Index:
          case ssFormat.SignalCommandParamValue.Integer:
            boxed = (param.value(new ssFormat.IntValueEntry()) as ssFormat.IntValueEntry | null)?.value(); break;
          case ssFormat.SignalCommandParamValue.Floating:
            boxed = (param.value(new ssFormat.FloatValueEntry()) as ssFormat.FloatValueEntry | null)?.value(); break;
          case ssFormat.SignalCommandParamValue.Text: {
            const s = (param.value(new ssFormat.StringValueEntry()) as ssFormat.StringValueEntry | null)?.value();
            boxed = s ?? undefined; break;
          }
          default: continue;
        }
        if (boxed !== undefined) params[paramId] = boxed;
      }

      const partIndex = sig.partIndex();
      const ev: SSSignalEvent = {
        partIndex,
        partName: mgr.getPartName(partIndex),
        active: true,
        commandId: val.commandId(),
        params,
      };
      this._signalListeners.forEach(cb => cb(ev));
    }
  }

  private dispatchAudios(events: ssFormat.EventsPerFrame): void {
    const mgr = this.internalPlayer.runtimeManager;
    const n = events.audiosLength();
    for (let j = 0; j < n; j++) {
      const audio = events.audios(j);
      const val = audio?.value();
      if (!audio || !val) continue;
      const partIndex = audio.partIndex();
      const ev: SSAudioEvent = {
        partIndex,
        partName: mgr.getPartName(partIndex),
        soundListNameHash: val.soundListNameHash(),
        soundNameHash: val.soundNameHash(),
        soundName: val.soundName(),
        loopNum: val.loopNum(),
      };
      this._audioListeners.forEach(cb => cb(ev));
    }
  }

  public get audioManager(): IAudioManager | null {
    return this.internalPlayer.audioManager;
  }
  public set audioManager(v: IAudioManager | null) {
    this.internalPlayer.audioManager = v;
  }

  public destroy(): void {
    this.stopTicker();

    // Tear down visibility gating (pauseWhenHidden).
    if (this._io) { this._io.disconnect(); this._io = null; }
    if (this._onVisibilityChange && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this._onVisibilityChange = null;

    // Tear down context-loss handlers.
    if (this._onContextLost) {
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost as EventListener);
      this._onContextLost = null;
    }
    if (this._onContextRestored) {
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      this._onContextRestored = null;
    }

    // Free the core player's WASM allocation (SSAB resource, runtime context,
    // instance/effect slot handles). Mirrors ssplayer-pixi's SSPlayer.destroy();
    // without this the entire DirectInternalPlayer leaks on every teardown.
    this.internalPlayer?.destroy();

    this.renderer.destroy();
    this.resourceManager.destroy();
  }
}
