import { DirectInternalPlayer, IAudioManager, ssFormat, SSBlendOp, SSOverridePriority, WebPlaybackDirection, WebPlaybackStyle } from '@spritestudio/ssplayer-core';
import { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
import type { SSSurface } from './SSSurface.js';

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
  /**
   * The frame the key is authored on — not necessarily the frame it was
   * noticed on, since one tick can step across several.
   */
  frameNo: number;
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
  /**
   * The frame the key is authored on — not necessarily the frame it was
   * noticed on, since one tick can step across several.
   */
  frameNo: number;
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
  /**
   * The frame the key is authored on — not necessarily the frame it was
   * noticed on, since one tick can step across several.
   */
  frameNo: number;
  soundListNameHash: number;
  soundNameHash: number;
  soundName: string | null;
  loopNum: number;
}

/** Unsubscribe handle returned by the `onX` event-registration methods. */
export type Unsubscribe = () => void;

/** A player's destination rectangle, in the surface's drawing-buffer pixels. */
export interface SSPlayerBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SSPlayerOptions {
  /**
   * Automatically play the animation's sounds (default `true`).
   *
   * When the loaded SSAB references sounds and no `audioManager` has been set, the
   * player creates a default `SSWebAudioManager` while loading and wires it up —
   * so sound "just works" with zero consumer code, like ssplayer-pixi. The audio
   * adapter is loaded via a **dynamic import**, so it is a separate chunk fetched
   * only for a sound-bearing pack: packs without sound (and the `./lite` build)
   * never pull in any audio code, keeping the default bundle within the size
   * budget.
   *
   * Set to `false` for full manual control (attach your own `IAudioManager`, or
   * none) — nothing audio-related is then loaded automatically. Attaching your own
   * manager *after* `load()` also works, but with `autoAudio` left on the default
   * one has been created by then.
   */
  autoAudio?: boolean;
  /**
   * Supply the player's texture manager instead of letting it build a plain
   * {@link SSWebGLResourceManager} on the surface's context.
   *
   * This is the hook for hosts that resolve textures through their own engine:
   * `ssplayer-rmmz` subclasses it to load through RPG Maker MZ's `ImageManager`
   * so SS atlases go through the same cache (and the same encryption) as every
   * other game asset. Must belong to the same GL context as the surface.
   */
  resourceManager?: SSWebGLResourceManager;
}

/**
 * One SpriteStudio animation drawn onto an {@link SSSurface}.
 *
 * A Player owns everything that belongs to *an animation*: the runtime handle, the
 * timeline, its transform, its events. It owns nothing GL-scoped — the context, the
 * renderer, the ticker and the per-frame clear all belong to the Surface, which is
 * why one Surface can carry any number of Players on a single WebGL context.
 *
 * ```ts
 * const surface = new SSSurface(canvas, { autoStart: true });
 * const player = surface.createPlayer();
 * await player.load('chara.ssab');
 * player.setAnimation('idle');
 * player.play();
 * ```
 */
export class SSPlayer {
  public internalPlayer: DirectInternalPlayer;
  /**
   * This player's textures. One manager per player (per player *tree* — instance
   * children inherit it, see InternalPlayerBase.createChildPlayer), keyed by the
   * cell-map hash, which is only unique within one `.ssab`.
   *
   * URL-loaded atlases are delegated to the surface's shared cache, so several
   * players showing the same character upload it once. Embedded and
   * caller-supplied textures stay private to this player.
   */
  public resourceManager: SSWebGLResourceManager;

  /** The surface this player draws onto. */
  public readonly surface: SSSurface;

  // --- Box ---
  // Null means "track the whole surface", so a player follows surface resizes
  // without the host re-setting anything. An explicit box pins it — that is what
  // overlay mode writes every frame from getBoundingClientRect().
  private _box: SSPlayerBox | null = null;

  // --- Transform, composed lazily ---
  // Stored as authored parameters rather than a baked matrix because the box may
  // move or resize (surface resize, overlay scroll) after setTransform() ran; the
  // final matrix is built at draw time in renderTransform().
  private _x = 0;
  private _y = 0;
  private _scaleX = 1;
  private _scaleY = 1;
  private _rotation = 0;
  private readonly _matrix = new Float32Array(6); // [m00, m01, m10, m11, tx, ty]

  // --- Colour ---
  private _alpha = 1;
  private _tintRgb = 0xffffff;
  // Premultiplied (rgb * a, a) — the form uColor must receive; see SSWebGLRenderer._tint.
  private readonly _tintVec = new Float32Array([1, 1, 1, 1]);
  private readonly _opaqueTintVec = new Float32Array([1, 1, 1, 1]);

  /** Clip drawing to {@link box} with a scissor rect. Off by default: it breaks the batch. */
  public clip = false;

  /**
   * Clear {@link box} to this opaque `0xRRGGBB` before drawing, so framebuffer-reading
   * blend modes (Add / Screen / Mul) have a real backdrop. Null = draw straight onto
   * whatever the surface already holds. Costs a batch break when set, which is why
   * it is opt-in.
   */
  public backdrop: number | null = null;

  /** Draw order within the surface; lower draws first. Ties keep insertion order. */
  public order = 0;

  /**
   * Skip this player entirely when false — no draw, and the host should skip
   * {@link update} too. Distinct from `alpha = 0`, which is an author-facing
   * fade: this is for a host that knows the player cannot be seen, such as an
   * overlay whose element has scrolled out of the viewport.
   */
  public visible = true;

  private readonly _userDataListeners = new Set<(e: SSUserDataEvent) => void>();
  private readonly _signalListeners = new Set<(e: SSSignalEvent) => void>();
  private readonly _audioListeners = new Set<(e: SSAudioEvent) => void>();
  private readonly _animStartedListeners = new Set<() => void>();
  private readonly _animFinishedListeners = new Set<() => void>();
  private readonly _animLoopedListeners = new Set<() => void>();
  private readonly _frameListeners = new Set<(frame: number) => void>();
  // Guards the one-time default-audio auto-wire (see ensureAutoAudio).
  private _audioAutoWired = false;

  /**
   * Prefer {@link SSSurface.createPlayer}. Constructing directly is equivalent —
   * the player registers itself with `surface` either way, so there is only one
   * lifecycle to reason about.
   */
  constructor(surface: SSSurface, public options: SSPlayerOptions = {}) {
    this.surface = surface;
    this.resourceManager = options.resourceManager
      ?? new SSWebGLResourceManager(surface.gl, surface.textureCache);
    this.internalPlayer = new DirectInternalPlayer(this.resourceManager);
    surface.add(this);
  }

  // --- Box ------------------------------------------------------------------

  /**
   * Destination rectangle in the surface's drawing-buffer pixels. Defaults to the
   * whole surface and follows its resizes until set explicitly.
   *
   * {@link setTransform} is relative to this box's **centre**, matching SS's own
   * centre origin — so a player is centred in its box with no host maths.
   */
  public get box(): SSPlayerBox {
    // A copy: `_box` is written in place by setBox (every frame, under SSOverlay),
    // so a host holding the live object would see it mutate — and `player.box =
    // saved` would become a self-assignment that restores nothing.
    return { x: this.boxX, y: this.boxY, w: this.boxW, h: this.boxH };
  }

  public set box(v: SSPlayerBox) {
    this.setBox(v.x, v.y, v.w, v.h);
  }

  /** Set destination rectangle in place without allocating a box object. */
  public setBox(x: number, y: number, w: number, h: number): void {
    if (this._box) {
      this._box.x = x;
      this._box.y = y;
      this._box.w = w;
      this._box.h = h;
    } else {
      this._box = { x, y, w, h };
    }
  }

  // Allocation-free reads of the resolved box for the per-frame callers
  // (renderTransform, the Surface's scissor), which the `box` getter is not.
  // `surface.canvas`, not `surface.drawingBufferSize` — that allocates too.
  /** @internal */ public get boxX(): number { return this._box ? this._box.x : 0; }
  /** @internal */ public get boxY(): number { return this._box ? this._box.y : 0; }
  /** @internal */ public get boxW(): number { return this._box ? this._box.w : this.surface.canvas.width; }
  /** @internal */ public get boxH(): number { return this._box ? this._box.h : this.surface.canvas.height; }

  /** Revert to tracking the whole surface. */
  public resetBox(): void {
    this._box = null;
  }

  // --- Colour ---------------------------------------------------------------

  /** 0..1 opacity for the whole player. Multiplies the animation's own part alphas. */
  public get alpha(): number { return this._alpha; }
  public set alpha(v: number) {
    this._alpha = v < 0 ? 0 : v > 1 ? 1 : v;
    this.syncTint();
  }

  /** `0xRRGGBB` multiplied into every part. White (default) leaves colours untouched. */
  public get tint(): number { return this._tintRgb; }
  public set tint(v: number) {
    this._tintRgb = v & 0xffffff;
    this.syncTint();
  }

  private syncTint(): void {
    const a = this._alpha;
    const c = this._tintRgb;
    // Premultiplied: uColor multiplies component-wise against an already
    // premultiplied fragment, so RGB must be scaled by alpha too.
    this._tintVec[0] = (((c >> 16) & 0xff) / 255) * a;
    this._tintVec[1] = (((c >> 8) & 0xff) / 255) * a;
    this._tintVec[2] = ((c & 0xff) / 255) * a;
    this._tintVec[3] = a;
  }

  /** @internal The premultiplied `uColor` value for this player. */
  public get tintVector(): Float32Array { return this._tintVec; }

  /**
   * @internal The same tint at full opacity.
   *
   * Used for the offscreen half of a group-alpha fade: the player is drawn opaque
   * so overlapping parts resolve at full coverage, and the alpha is applied once
   * when that image is composited (see SSGroupAlpha).
   */
  public get opaqueTintVector(): Float32Array {
    const c = this._tintRgb;
    const v = this._opaqueTintVec;
    v[0] = ((c >> 16) & 0xff) / 255;
    v[1] = ((c >> 8) & 0xff) / 255;
    v[2] = (c & 0xff) / 255;
    v[3] = 1;
    return v;
  }

  /** Whether this player contributes anything to the frame. */
  public get isVisible(): boolean {
    return this.visible && this._alpha > 0 && !!this.internalPlayer.currentAnimation;
  }

  // --- Loading --------------------------------------------------------------

  public async loadBuffer(
    ssab: ArrayBuffer | Uint8Array,
    textures: Map<number, TexImageSource | ArrayBuffer | string>,
  ): Promise<void> {
    this.internalPlayer.bindResource(new Uint8Array(ssab));
    this.configureContext();
    for (const [hash, src] of textures.entries()) {
      if (typeof src === 'string') {
        await this.resourceManager.loadTexture(src, hash);
      } else if (src instanceof ArrayBuffer || src instanceof Uint8Array) {
        await this.resourceManager.loadTextureFromBytes(src instanceof ArrayBuffer ? new Uint8Array(src) : src, hash);
      } else {
        this.resourceManager.bindTextureSource(src as TexImageSource, hash, (src as any).width as number, (src as any).height as number);
      }
    }
    // Finish the pack's asset load here, like `load()` does, so `setAnimation`
    // stays a pure runtime switch. Textures the caller just supplied are already
    // in the manager under their hash and are not fetched again; this resolves
    // what the caller could not — embedded textures and instance packs.
    await this.internalPlayer.prepareResources();
    await this.ensureAutoAudio();
  }

  public async load(ssabUrl: string): Promise<void> {
    await this.internalPlayer.load(ssabUrl);
    this.configureContext();
    await this.ensureAutoAudio();
  }

  /**
   * Animation names in the loaded pack, in table order; empty until `load` /
   * `loadBuffer` resolves. Use it to pick a default (`[0]`) or to validate a
   * name before {@link setAnimation}, which otherwise fails only at play time.
   * The list is read out of the pack when it is bound, so this costs nothing and
   * needs no second read of the `.ssab`.
   */
  public getAnimationNames(): readonly string[] {
    return this.internalPlayer.animationNames;
  }

  /**
   * Select an animation. Synchronous: `load()` / `loadBuffer()` have already
   * brought in everything the pack needs, so a switch is a runtime reset.
   */
  public setAnimation(name: string): void {
    // Safety net for a player driven through the core directly (bytes bound
    // without going through load/loadBuffer): wiring is a no-op once done, and
    // attaching a manager starts its own preload.
    void this.ensureAutoAudio();
    this.internalPlayer.setAnimation(name);
  }

  /** Direct render mode + Y-down coordinate system, matching the WebGL projection. */
  private configureContext(): void {
    const ctx = this.internalPlayer.runtimeManager.context;
    ctx.set_render_mode(0); // Direct
    ctx.set_coordinate_system(1); // YDown
  }

  /**
   * Lazily create + wire a default `SSWebAudioManager` so sound plays with zero
   * consumer code (mirrors ssplayer-pixi's auto-behaviour). No-op when:
   * `options.autoAudio === false`, an `audioManager` is already set (consumer
   * supplied one), already attempted, or the current SSAB has no sounds.
   *
   * The adapter is pulled in via a **dynamic import**, so it lands in a separate
   * chunk fetched only here, only when sounds exist — the base player and the
   * `./lite` build stay audio-free (size budget). Failures (e.g. an environment
   * without dynamic import) are swallowed so the animation still plays silently;
   * opt out with `autoAudio: false` + your own `IAudioManager`.
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
      // Attaching starts the pack's sound preload; finish it here so callers of
      // load() get the sounds in memory, not merely on their way.
      await this.internalPlayer.preloadSounds();
    } catch (e) {
      console.warn('[SSPlayer] Failed to auto-load the audio adapter; sound disabled. Attach an IAudioManager manually if needed.', e);
    }
  }

  // --- Playback -------------------------------------------------------------

  // --- Transport ---
  //
  // Four distinct verbs, passed straight through to the core (and so to the
  // runtime, which owns the state machine). Nothing is mirrored on this object:
  // a copy of "am I playing" is exactly what drifts from the runtime the first
  // time a call is a no-op there — `resume()` on a stopped animation being the
  // one that used to leave this player reporting itself as playing forever.

  /** Head-out: rewinds to the section start (or `startFrame`) and re-arms the loop count. */
  public play(startFrame?: number): void {
    this.internalPlayer.play(startFrame);
    this._animStartedListeners.forEach(cb => cb());
  }

  /** Holds playback in place. Idempotent, and ignored while nothing is playing. */
  public pause(): void {
    this.internalPlayer.pause();
  }

  /**
   * Lifts a {@link pause}, carrying on from the same frame. Idempotent, and a
   * no-op on a stopped animation — starting one is {@link play}'s job, and it
   * rewinds.
   */
  public resume(): void {
    this.internalPlayer.resume();
  }

  /**
   * Ends playback. The playhead **stays where it stands** — nothing rewinds, so
   * the canvas keeps drawing the frame it stopped on. `play()` is what returns
   * to the head; `setFrameNo()` seeks anywhere else.
   */
  public stop(): void {
    this.internalPlayer.stop();
  }

  public get frameNo(): number { return this.internalPlayer.getFrameNo(); }
  public set frameNo(v: number) { this.internalPlayer.setFrame(v); }

  /** Frames in the current playback range, inclusive of both ends. */
  public get totalFrames(): number { return this.internalPlayer.getTotalFrames(); }

  /**
   * First / last frame of the current playback range. These follow
   * {@link setAnimationSection}: without one they are the animation's own bounds,
   * with one they are the section's.
   */
  public get startFrame(): number { return this.internalPlayer.getAnimationSectionStart(); }
  public get endFrame(): number { return this.internalPlayer.getAnimationSectionEnd(); }

  /** Playback rate in frames per second. Defaults to the animation's authored fps. */
  public get frameRate(): number { return this.internalPlayer.getFrameRate(); }
  public set frameRate(v: number) { this.internalPlayer.setFrameRate(v); }

  /** The animation currently set up, or `''` before the first `setAnimation`. */
  public get currentAnimation(): string { return this.internalPlayer.currentAnimation; }

  /**
   * Whether a playback session is live — **true while paused as well**, since a
   * pause is a hold rather than a stop. `isPlaying && !isPausing` is "currently
   * advancing"; {@link isPausing} is what tells the two apart.
   *
   * False before the first {@link play} and after {@link stop}, and false again
   * once a finite loop count runs out (the runtime parks the playhead on the
   * final frame and ends the session — {@link onAnimationFinished} is what reports
   * that, since `!isPlaying` cannot tell a completion from a `stop()`).
   */
  public get isPlaying(): boolean { return this.internalPlayer.isPlaying; }

  /** Whether playback is paused (as opposed to stopped or never started). */
  /**
   * Whether the last {@link update} crossed a loop boundary. A **pulse**, true
   * only inside the tick that crossed — take {@link onAnimationLooped} instead if
   * you would rather have it delivered than polled.
   */
  public get justLooped(): boolean {
    return this.internalPlayer.justLooped;
  }

  public get isPausing(): boolean { return this.internalPlayer.isPausing; }

  /**
   * Whether every configured loop has played.
   *
   * A **state**, not a pulse: it latches on completion and stays true until
   * the next {@link play} or {@link setAnimation}. Never true under an
   * infinite loop count, and **not raised by {@link stop}** — so unlike
   * `!isPlaying` it tells a run that ended on its own apart from one that was
   * stopped. Take {@link onAnimationFinished} for the one-shot edge.
   */
  public get isFinished(): boolean { return this.internalPlayer.isFinished; }

  /**
   * Whether the playhead is walking forwards right now — the instantaneous
   * heading, so a ping-pong on its return leg reads false while
   * {@link getPlaybackDirection} still reads Forward.
   *
   * Gate an audio backend on this: SpriteStudio has no reverse audio, so
   * {@link onAudio} still reports every key it crosses (as the Godot and Unity
   * players do) and it is the *playing* that has to be suppressed.
   */
  public get isPlayingForward(): boolean { return this.internalPlayer.isPlayingForward; }

  public get speedScale(): number { return this.internalPlayer.getSpeedScale(); }
  public set speedScale(v: number) { this.internalPlayer.setSpeedScale(v); }

  /**
   * How many times the animation plays: `-1` for forever, `n > 0` for n times.
   * The runtime normalises anything `<= 0` to `-1`, so reading back a `0` you
   * wrote gives `-1`.
   *
   * **Assigning restarts the loop budget**, even with the value it already has:
   * the runtime resets its remaining-loop counter on every write. So drive it
   * from the value you last *requested*, never from a read-back comparison —
   * `if (player.loopCount !== wanted) player.loopCount = wanted` re-writes on
   * every frame when `wanted` is `0` (it reads back as `-1`), and an animation
   * whose budget is reset every frame never finishes.
   */
  public get loopCount(): number { return this.internalPlayer.getLoopCount(); }
  public set loopCount(v: number) { this.internalPlayer.setLoopCount(v); }

  /** URL the loaded pack came from; empty for packs bound as bytes without one. */
  public get ssabUrl(): string { return this.internalPlayer.ssabUrl; }

  public get subFrameEnabled(): boolean { return this.internalPlayer.subFrameEnabled; }
  public set subFrameEnabled(v: boolean) { this.internalPlayer.subFrameEnabled = v; }

  /**
   * Whether the runtime may skip frames to keep up with wall-clock time (on by
   * default). Turning it off only gives you every frame if sub-frame
   * interpolation is off too — otherwise the timeline still advances by
   * fractional amounts and the timing drifts.
   */
  public get frameSkipEnabled(): boolean { return this.internalPlayer.isFrameSkipEnabled(); }
  public set frameSkipEnabled(v: boolean) { this.internalPlayer.setFrameSkipEnabled(v); }

  /**
   * Limit playback to `[startFrame, endFrame]`. This narrows the range every
   * other frame API reports and loops within — {@link startFrame},
   * {@link endFrame} and {@link totalFrames} all follow it.
   */
  public setAnimationSection(startFrame: number, endFrame: number): void {
    this.internalPlayer.setAnimationSection(startFrame, endFrame);
  }

  /** Play forwards or backwards, once through or ping-ponging. */
  public setPlaybackDirection(direction: WebPlaybackDirection, style: WebPlaybackStyle): void {
    this.internalPlayer.setPlaybackDirection(direction, style);
  }

  public getPlaybackDirection(): WebPlaybackDirection { return this.internalPlayer.getPlaybackDirection(); }
  public getPlaybackStyle(): WebPlaybackStyle { return this.internalPlayer.getPlaybackStyle(); }

  // --- Transform ------------------------------------------------------------

  /**
   * Position / scale / rotate this player **relative to its {@link box} centre**.
   * `{}` centres it in the box.
   */
  public setTransform(t: {
    x?: number; y?: number; scaleX?: number; scaleY?: number; rotation?: number;
  }): void {
    this._x = t.x ?? 0;
    this._y = t.y ?? 0;
    this._scaleX = t.scaleX ?? 1;
    this._scaleY = t.scaleY ?? 1;
    this._rotation = t.rotation ?? 0;
  }

  /**
   * What {@link setTransform} last received, with its defaults filled in — the
   * same shape, so `setTransform(getTransform())` is a no-op.
   *
   * Note this is the *authored* placement, not where the player is on screen:
   * the box it is relative to may have moved since (a surface resize, an overlay
   * scroll), which is why the matrix is only composed at draw time.
   */
  public getTransform(): { x: number; y: number; scaleX: number; scaleY: number; rotation: number } {
    return { x: this._x, y: this._y, scaleX: this._scaleX, scaleY: this._scaleY, rotation: this._rotation };
  }

  /**
   * Mirror the drawn animation horizontally.
   *
   * Distinct from `setTransform({ scaleX: -1 })` in two ways worth knowing.
   * `setTransform` REPLACES the whole placement (anything you omit goes back to
   * its default), so a later `setTransform` call would drop a flip expressed
   * that way; this survives. And it applies underneath the placement, in the
   * animation's own space, so it composes with — rather than fights — whatever
   * scale and rotation are set.
   */
  public get flipX(): boolean { return this.internalPlayer.flipX; }
  public set flipX(v: boolean) { this.internalPlayer.flipX = v; }

  /** Mirror the drawn animation vertically. See {@link flipX}. */
  public get flipY(): boolean { return this.internalPlayer.flipY; }
  public set flipY(v: boolean) { this.internalPlayer.flipY = v; }

  /**
   * Shift the drawn animation horizontally, in **animation-local pixels**, which
   * is not the same unit as {@link setTransform}'s `x`: this rides under the
   * placement, so it is scaled and rotated by it, and it nudges the artwork off
   * its authored origin rather than moving the player. Applied after
   * {@link flipX}, so flipping does not mirror the offset itself.
   */
  public get offsetX(): number { return this.internalPlayer.offsetX; }
  public set offsetX(v: number) { this.internalPlayer.offsetX = v; }

  /** Shift the drawn animation vertically (Y-down). See {@link offsetX}. */
  public get offsetY(): number { return this.internalPlayer.offsetY; }
  public set offsetY(v: number) { this.internalPlayer.offsetY = v; }

  /**
   * @internal The affine the renderer wants, in drawing-buffer pixels:
   * `[m00, m01, m10, m11, tx, ty]` = translate(boxCentre + xy) × rotate × scale,
   * matching GeometryBuilder.composeAffine. Rebuilt per frame because the box can
   * move underneath a transform that was set once.
   */
  public renderTransform(): Float32Array {
    const cos = Math.cos(this._rotation);
    const sin = Math.sin(this._rotation);
    const m = this._matrix;
    m[0] = cos * this._scaleX;   // m00
    m[1] = -sin * this._scaleY;  // m01
    m[2] = sin * this._scaleX;   // m10
    m[3] = cos * this._scaleY;   // m11
    m[4] = this.boxX + this.boxW / 2 + this._x; // tx
    m[5] = this.boxY + this.boxH / 2 + this._y; // ty
    return m;
  }

  // --- Per-frame ------------------------------------------------------------

  /** @internal Advance the timeline and drain its events. Driven by the Surface. */
  public update(deltaMs: number): void {
    // A held player is still live — the core advances `independent` effect /
    // instance slots on the real delta while the timeline is frozen — so this
    // gates on `isPlaying` (true across a pause) and not on "advancing". A
    // stopped one advances nothing at all, so it can be skipped outright.
    if (!this.internalPlayer.isPlaying) return;
    // internalPlayer.update() moves the timeline only while playing and not held;
    // otherwise it still advances `independent` slots, but passes no events and
    // reaches no frame — so skip polling and the per-frame listeners then. Read
    // the condition before the update, since the update can change it.
    const advancing = !this.internalPlayer.isPausing;
    this.internalPlayer.update(deltaMs);
    if (!advancing) return;

    // Drain the events accumulated by this update (user-data / signal / audio +
    // animation end/loop) right away, while the runtime's passed-event buffer is
    // still valid. Must run on the same tick that advanced — including the tick a
    // non-looping animation finishes on.
    this.pollEvents();

    // World matrices are final for this frame: notify per-frame listeners (the
    // point getPartTransform is valid for the new frame).
    if (this._frameListeners.size > 0) {
      const f = this.internalPlayer.getFrameNo();
      this._frameListeners.forEach(cb => cb(f));
    }
  }

  // --- Part overrides (65_override_layer) ---
  //
  // Thin pass-throughs to the core player, which owns the contract (see
  // InternalPlayerBase): part is a name or an index, false means the part is
  // unknown or the runtime rejected the call, and the runtime keeps the override
  // itself — nothing is re-applied per frame here.
  //
  // An override changes the output without changing the frame number. That is
  // invisible here because the Surface draws unconditionally: its ticker paints
  // every frame even while stopped, and a host driving frames by hand already
  // calls draw() itself. Nothing needs invalidating.

  /** Resolve a part name to its index, or -1 if the part is not in the current animation. */
  public findPartIndex(partName: string): number {
    return this.internalPlayer.findPartIndex(partName);
  }

  /** Number of parts in the current animation; indices run `0 .. count - 1`. */
  /**
   * Part names in part-index order, empty before an animation is set up.
   *
   * A part authored without a name reads as the empty string, so the list stays
   * aligned with the `partIndex` every event carries. `length` is the part
   * count — there is no separate accessor for it.
   */
  public getPartNames(): string[] {
    return this.internalPlayer.getPartNames();
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
    rgba: number,
    blendOp: SSBlendOp = SSBlendOp.Mix,
    priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
  ): boolean {
    return this.internalPlayer.setPartColorOverride(part, rgba, blendOp, priority);
  }

  /** Override a Normal part's colour with four `0xRRGGBBAA` corners (left-top, right-top, left-bottom, right-bottom). */
  public setPartColorOverrideCorners(
    part: number | string,
    corners: readonly [number, number, number, number],
    blendOp: SSBlendOp = SSBlendOp.Mix,
    priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
  ): boolean {
    return this.internalPlayer.setPartColorOverrideCorners(part, corners, blendOp, priority);
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
  public getCellmapNames(): string[] {
    return this.internalPlayer.getCellmapNames();
  }

  /** Cell names in the named cell map (for discovering cell-override targets). */
  public getCellNames(cellmapName: string): string[] {
    return this.internalPlayer.getCellNames(cellmapName);
  }

  // --- Part following: transform read-out ---

  /**
   * The part's current-frame transform as a 2D affine `[m00, m01, m10, m11, tx,
   * ty]` in animation-local (Y-down) space, or null if the part is unknown. Read
   * after a frame advanced (e.g. from onFrame). Pass `out` to avoid allocation.
   * Compose it with {@link renderTransform} to reach drawing-buffer pixels.
   */
  public getPartTransform(part: number | string, out?: Float32Array): Float32Array | null {
    return this.internalPlayer.getPartTransform(part, out);
  }

  /** Whether the part is hidden on the current frame (animation `hide`), or null if unknown. */
  public isPartHidden(part: number | string): boolean | null {
    return this.internalPlayer.isPartHidden(part);
  }

  /**
   * Whether the part is a skinned (bone-bound) mesh, or null if unknown. Such a
   * part is a poor part-following target: its node transform — what
   * {@link getPartTransform} reports — sits near the character root, not on the
   * drawn mesh. Follow a NULL / bone / joint part placed there instead.
   */
  public isPartSkinnedMesh(part: number | string): boolean | null {
    return this.internalPlayer.isPartSkinnedMesh(part);
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

  /**
   * Fires when playback heads out — a `play()`, including one an autoplay or a
   * host script issued rather than the caller. Not a resume: lifting a pause
   * carries on, it does not start.
   */
  public onAnimationStarted(listener: () => void): Unsubscribe {
    this._animStartedListeners.add(listener);
    return () => { this._animStartedListeners.delete(listener); };
  }

  /** Fires once every configured loop has played. Never under an infinite loop count, nor on stop(). */
  public onAnimationFinished(listener: () => void): Unsubscribe {
    this._animFinishedListeners.add(listener);
    return () => { this._animFinishedListeners.delete(listener); };
  }

  /** Fires on each loop boundary crossing. */
  public onAnimationLooped(listener: () => void): Unsubscribe {
    this._animLoopedListeners.add(listener);
    return () => { this._animLoopedListeners.delete(listener); };
  }

  /**
   * Fires once per advanced frame from update(), after the timeline advanced and
   * its world matrices are final — the point at which {@link getPartTransform} is
   * valid for the new frame. Returns an unsubscribe function.
   */
  public onFrame(listener: (frame: number) => void): Unsubscribe {
    this._frameListeners.add(listener);
    return () => { this._frameListeners.delete(listener); };
  }

  /**
   * Drain and dispatch the events accumulated by the last runtime update:
   * user-data / signal / audio, plus animation end (edge) and loop (pulse).
   * Called from update() right after `internalPlayer.update()`, while the
   * runtime's passed-event buffer is still valid. Safe with no listeners / no
   * animation.
   */
  private pollEvents(): void {
    const ctx = this.internalPlayer.runtimeManager.context;

    const { looped, finished } = this.internalPlayer.pollPlaybackEvents();
    if (finished && this._animFinishedListeners.size > 0) {
      this._animFinishedListeners.forEach(cb => cb());
    }
    if (looped && this._animLoopedListeners.size > 0) {
      this._animLoopedListeners.forEach(cb => cb());
    }

    const count = ctx.get_passed_event_count();
    if (count <= 0) return;
    if (this._userDataListeners.size === 0 && this._signalListeners.size === 0 && this._audioListeners.size === 0) return;

    const anim = this.internalPlayer.runtimeManager.getCurrentAnimationData();
    if (!anim) return;

    for (let i = 0; i < count; i++) {
      // get_passed_event_index returns the index into this animation's per-frame
      // events table (single-source playback: always primary).
      const eventIdx = ctx.get_passed_event_index(i);
      const events = anim.events(eventIdx);
      if (!events) continue;
      if (this._userDataListeners.size > 0) this.dispatchUserData(events);
      if (this._signalListeners.size > 0) this.dispatchSignals(events);
      // Audio keys are reported whichever way the playhead is walking — the
      // observation channel is not the playback. SpriteStudio has no reverse
      // audio, so it is the backend that gates on {@link isPlayingForward}
      // (SSWebAudioManager.bindToPlayer does), exactly as the Godot and Unity
      // players do. Suppressing the event instead used to hide the key from
      // hosts doing something other than playing a sound with it.
      if (this._audioListeners.size > 0) this.dispatchAudios(events);
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
      const ev: SSUserDataEvent = { partIndex, partName: mgr.getPartName(partIndex), frameNo: events.frameIndex() };
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
    for (let i = 0; i < n; i++) {
      const sig = events.signals(i);
      const val = sig?.value();
      if (!sig || !val) continue;
      // Only active signals are dispatched (mirrors the Godot / Unity players).
      if (!val.active()) continue;

      const params: Record<string, boolean | number | string> = {};
      const paramCount = val.paramsLength();
      for (let p = 0; p < paramCount; p++) {
        const param = val.params(p);
        if (!param) continue;
        const paramId = param.paramId();
        if (paramId === null) continue;
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
        frameNo: events.frameIndex(),
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
        frameNo: events.frameIndex(),
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

  /**
   * Remove this player from its surface and free **its own** resources: the core
   * player's WASM allocation (SSAB resource, runtime context, instance/effect slot
   * handles) and its textures.
   *
   * It does not touch anything the Surface owns — the renderer's GL objects and the
   * context outlive it, so tearing one player down never blanks its siblings.
   */
  public destroy(): void {
    this.surface.remove(this);
    this.internalPlayer?.destroy();
    this.resourceManager.destroy();
  }
}
