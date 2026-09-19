// SSPlayer — a PixiJS v5 DisplayObject (Container) that plays a SpriteStudio
// animation by driving ssplayer-webgl's SSWebGLRenderer against RPG Maker MZ's
// shared WebGL context (spec §2.2 / §0 Layer 3).
//
// Unlike ssplayer-pixi's SSPlayer this class does NOT own a Ticker: playback is
// advanced only when the host RMMZ sprite calls `update(deltaMs)` from its own
// `update()`, so the animation stays perfectly in step with MZ time and pauses
// with the game (spec §7.3). Drawing happens in `_render`, called by Pixi at the
// container's Z position, so MZ handles Z-order and the transform chain.
// Opacity is inherited too, but not automatically: Pixi applies worldAlpha in its
// own batch shader, which the raw GL draw bypasses, so SSPlayerRenderer feeds it
// to the SS renderer by hand as a world tint.
//
// The actual GL draw + WebGL-state protection lives in SSPlayerRenderer (a
// registered PIXI.ObjectRenderer); this class only decides WHAT to draw and
// owns the core player, resource manager and event dispatch.

import {
  DirectInternalPlayer,
  hashString,
  initializeWasm,
  ssFormat,
  SSOverridePriority,
  SSPartFollower,
  type SSBlendOp,
  type IAudioManager,
  type SSTextureEntry,
  type WebPlaybackDirection,
  type WebPlaybackStyle,
  type SSPartFollowOptions,
  type SSPartAttachment as SSPartAttachmentOf,
} from '@spritestudio/ssplayer-webgl';
import type { Container as PixiContainer, Renderer } from 'pixi.js';
import { getMZGl, getPIXI, type GL, type RMMZBitmap } from './rmmzGlobals.js';
import { RMMZResourceManager } from './rmmz/RMMZResourceManager.js';
import { registerSSPlayerRenderer, SSPLAYER_PLUGIN_NAME } from './SSPlayerRenderer.js';

export type Unsubscribe = () => void;

/**
 * A live part attachment created by {@link SSPlayer.attachToPart}: `target`
 * follows the part each frame until `detach()` is called.
 */
export type SSPartAttachment = SSPartAttachmentOf<PixiContainer>;

export interface SSUserDataEvent {
  partIndex: number;
  partName: string;
  /**
   * The frame the key is authored on — not necessarily the frame it was
   * noticed on, since one tick can step across several.
   */
  frameNo: number;
  integer?: number;
  str?: string;
  rect?: { left: number; top: number; right: number; bottom: number };
  point?: { x: number; y: number };
}
export interface SSSignalEvent {
  partIndex: number;
  partName: string;
  /**
   * The frame the key is authored on — not necessarily the frame it was
   * noticed on, since one tick can step across several.
   */
  frameNo: number;
  active: boolean;
  commandId: number;
  params: Record<string, boolean | number | string>;
}
export interface SSAudioEvent {
  partIndex: number;
  partName: string;
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

// SSPlayer extends the host PixiJS Container. RMMZ provides PixiJS v5 as a
// global, so we resolve the base class at construction time from window.PIXI
// rather than importing a (possibly duplicate) copy. The declared base type is
// PixiContainer for the type checker.
const PIXI = getPIXI();
const ContainerBase: typeof PixiContainer = PIXI ? PIXI.Container : (class {} as any);

export class SSPlayer extends (ContainerBase as { new (): PixiContainer }) {
  /** Loads the WASM runtime once. Call before constructing any SSPlayer. */
  public static async initialize(wasmUrl?: string | URL | BufferSource | WebAssembly.Module): Promise<void> {
    // rmmz bundles the no-SIMD (scalar) runtime build — RPG Maker MZ's bundled
    // NW.js lacks WebAssembly SIMD — so skip ssplayer-core's SIMD precondition.
    await initializeWasm(wasmUrl as any, { requireSimd: false });
  }

  public readonly internalPlayer: DirectInternalPlayer;
  public readonly resourceManager: RMMZResourceManager;
  private readonly _gl: GL;

  private _userDataListeners = new Set<(e: SSUserDataEvent) => void>();
  private _signalListeners = new Set<(e: SSSignalEvent) => void>();
  private _audioListeners = new Set<(e: SSAudioEvent) => void>();
  private _frameListeners = new Set<(frame: number) => void>();

  // Part following. The bookkeeping is core's (shared with ssplayer-pixi, which
  // had the same code); only the write onto a Pixi object is ours. Unlike
  // ssplayer-pixi we don't clear children per frame (drawing goes through
  // _render), so an addAsChild target is a plain child and needs no re-add.
  private readonly _follower: SSPartFollower<PixiContainer>;
  // Reused PIXI.Matrix (v5) for full-affine application; created lazily since
  // PIXI is only guaranteed present once MZ has booted.
  private _attachMatrix: any = null;
  private _animStartedListeners = new Set<() => void>();
  private _animFinishedListeners = new Set<() => void>();
  private _animLoopedListeners = new Set<() => void>();

  /**
   * @param gl the MZ shared WebGL context. Defaults to `Graphics._app.renderer.gl`
   *           — so construct SSPlayer only after MZ has booted its Pixi app.
   */
  constructor(gl?: GL) {
    super();
    this._gl = gl ?? getMZGl();
    this.resourceManager = new RMMZResourceManager(this._gl);
    this.internalPlayer = new DirectInternalPlayer(this.resourceManager);
    this._follower = new SSPartFollower<PixiContainer>(this.internalPlayer, {
      addChild: (t) => { this.addChild(t); },
      // Only un-parent what is still ours: a host that re-parented the target
      // itself must not have it yanked out from under it.
      removeChild: (t) => { if (t.parent === (this as unknown as PixiContainer)) this.removeChild(t); },
      setVisible: (t, v) => { t.visible = v; },
      applyAffine: (t, affine) => {
        // PIXI.Matrix is (a, b, c, d, tx, ty) = (m00, m10, m01, m11, tx, ty).
        const PIXIrt = getPIXI();
        if (!PIXIrt) return;
        if (!this._attachMatrix) this._attachMatrix = new PIXIrt.Matrix();
        this._attachMatrix.set(affine[0], affine[2], affine[1], affine[3], affine[4], affine[5]);
        t.transform.setFromMatrix(this._attachMatrix);
      },
      applyDecomposed: (t, d, axes) => {
        if (axes.position) t.position.set(d.x, d.y);
        if (axes.rotation) t.rotation = d.rotation;
        if (axes.scale) t.scale.set(d.scaleX, d.scaleY);
      },
    });
    registerSSPlayerRenderer(); // idempotent Renderer.registerPlugin('ssplayer', ...)
  }

  /** True when `gl` is the context this player's textures were uploaded to. */
  public matchesContext(gl: GL): boolean {
    return this._gl === gl;
  }

  // --- Loading & playback (thin wrappers over the core player) ---

  public async load(ssabUrl: string): Promise<void> {
    // Fetched here rather than through the core's own load() only for the error
    // message: MZ users hit this via a plugin command, and "404 on <url>" is
    // worth far more to them than "Failed to load SSAB". Forward the ssab URL so
    // the core resolves textures relative to it (siblings of the .ssab — the
    // structure ssconverter emits).
    const res = await fetch(ssabUrl);
    if (!res.ok) throw new Error(`[ssplayer-rmmz] failed to load SSAB: ${res.status} ${res.statusText}`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    this.bindResource(buffer, ssabUrl);
    await this.prepareResources();
  }

  /**
   * Bind an already-fetched .ssab (bytes). Pair with setAnimation. Pass the ssab's
   * source URL (when known) so textures resolve relative to it; omit for inline
   * bytes whose textures are supplied by other means.
   *
   * Binding only reads the pack's tables; follow with {@link prepareResources}
   * to pull in its textures up front (`load()` does), or the first setAnimation
   * pays for them.
   */
  public bindResource(buffer: Uint8Array, ssabUrl?: string): void {
    this.internalPlayer.bindResource(buffer, ssabUrl);
    // Direct render mode + Y-down, matching ssplayer-pixi (MZ world space is y-down).
    this.internalPlayer.runtimeManager.context.set_render_mode(0);
    this.internalPlayer.runtimeManager.context.set_coordinate_system(1);
  }

  /**
   * Load the bound pack's textures and instance packs (once). Awaiting this
   * after {@link bindResource} keeps `setAnimation` a pure runtime switch.
   */
  public prepareResources(): Promise<void> {
    return this.internalPlayer.prepareResources();
  }

  /**
   * Animation names in the loaded .ssab (table order). Empty until load().
   * A copy, so callers may keep or sort it; the core holds the original.
   */
  public getAnimationNames(): string[] {
    return [...this.internalPlayer.animationNames];
  }

  /**
   * Select `animationName`. If empty, the first animation in the .ssab is used;
   * if a non-existent name is given, we warn (listing the real names) and fall
   * back to the first — so authors who mistype in the plugin command still see
   * *something*, and get the exact names in the console.
   *
   * Playback settings are separate properties — set {@link loopCount} after this.
   */
  public setAnimation(animationName: string): void {
    const names = this.getAnimationNames();
    let target = animationName;
    if (!target) {
      target = names[0] ?? '';
    } else if (names.length > 0 && !names.includes(target)) {
      console.warn(
        `[ssplayer-rmmz] animation "${target}" not found. Available: ${names.join(', ')}. Using "${names[0]}".`,
      );
      target = names[0];
    }
    this.internalPlayer.setAnimation(target);
  }

  public play(startFrame = -1): void {
    this.internalPlayer.play(startFrame);
    this._animStartedListeners.forEach((cb) => cb());
  }
  public pause(): void {
    this.internalPlayer.pause();
  }
  public resume(): void {
    this.internalPlayer.resume();
  }
  /**
   * Ends playback. The playhead **stays where it stands** — nothing rewinds, so
   * the sprite keeps drawing the frame it stopped on. `play()` is what returns
   * to the head; `setFrameNo()` seeks anywhere else.
   */
  public stop(): void {
    this.internalPlayer.stop();
  }

  /**
   * Advance the animation by `deltaMs` and dispatch its events. Call this from
   * the host RMMZ sprite's `update()` — never from a private timer (spec §7.3).
   */
  public update(deltaMs: number): void {
    if (!this.internalPlayer.isPlaying) return;
    const pausing = this.internalPlayer.isPausing;
    this.internalPlayer.update(deltaMs);
    if (!pausing) this.pollEvents();

    // World matrices are now final for this frame: drive followers, then notify
    // per-frame listeners (the point getPartTransform is valid for this frame).
    if (this._follower.size > 0) this._follower.update();
    if (this._frameListeners.size > 0) {
      const f = this.internalPlayer.getFrameNo();
      this._frameListeners.forEach((cb) => cb(f));
    }
  }

  // --- Accessors ---

  public get currentAnimation(): string {
    return this.internalPlayer.currentAnimation;
  }
  public get frameNo(): number {
    return this.internalPlayer.getFrameNo();
  }
  public set frameNo(value: number) {
    this.internalPlayer.setFrameNo(value);
  }
  public get totalFrames(): number {
    return this.internalPlayer.getTotalFrames();
  }
  public get frameRate(): number {
    return this.internalPlayer.getFrameRate();
  }
  public set frameRate(value: number) {
    this.internalPlayer.setFrameRate(value);
  }
  public get isPlaying(): boolean {
    return this.internalPlayer.isPlaying;
  }
  /**
   * Whether the last {@link update} crossed a loop boundary. A **pulse**, true
   * only inside the tick that crossed — take {@link onAnimationLooped} instead if
   * you would rather have it delivered than polled.
   */
  public get justLooped(): boolean {
    return this.internalPlayer.justLooped;
  }

  public get isPausing(): boolean {
    return this.internalPlayer.isPausing;
  }

  /**
   * Whether every configured loop has played.
   *
   * A **state**, not a pulse: it latches on completion and stays true until
   * the next {@link play} or {@link setAnimation}. Never true under an
   * infinite loop count, and **not raised by {@link stop}** — so unlike
   * `!isPlaying` it tells a run that ended on its own apart from one that was
   * stopped. Take {@link onAnimationFinished} for the one-shot edge.
   */
  public get isFinished(): boolean {
    return this.internalPlayer.isFinished;
  }
  /**
   * Whether the playhead is walking forwards right now — the instantaneous
   * heading, so a ping-pong on its return leg reads false while the configured
   * direction still reads Forward. Gate an audio backend on this: SpriteStudio
   * has no reverse audio, so `onAudio` still reports every key it crosses (as
   * the Godot and Unity players do) and it is the *playing* that is suppressed.
   */
  public get isPlayingForward(): boolean {
    return this.internalPlayer.isPlayingForward;
  }
  public get speedScale(): number {
    return this.internalPlayer.getSpeedScale();
  }
  public set speedScale(speed: number) {
    this.internalPlayer.setSpeedScale(speed);
  }
  public get loopCount(): number {
    return this.internalPlayer.getLoopCount();
  }
  public set loopCount(value: number) {
    this.internalPlayer.setLoopCount(value);
  }

  /**
   * Mirror the drawn animation horizontally.
   *
   * Not the same as `player.scale.x = -1`. This mirrors only what we draw; our
   * Container transform is untouched, so targets attached with
   * {@link attachToPart} — and anything else MZ has parented onto us — are not
   * mirrored along with the artwork. They still follow the mirrored pose,
   * because {@link getPartTransform} reports it. Use `scale.x` when you do want
   * the whole subtree mirrored.
   */
  public get flipX(): boolean {
    return this.internalPlayer.flipX;
  }
  public set flipX(value: boolean) {
    this.internalPlayer.flipX = value;
  }

  /** Mirror the drawn animation vertically. See {@link flipX}. */
  public get flipY(): boolean {
    return this.internalPlayer.flipY;
  }
  public set flipY(value: boolean) {
    this.internalPlayer.flipY = value;
  }

  /**
   * Shift the drawn animation horizontally, in animation-local pixels, without
   * moving this Container — the artwork sits off its authored origin while our
   * position keeps marking the logical spot. Applied after {@link flipX}, so
   * flipping does not mirror the offset itself.
   */
  public get offsetX(): number {
    return this.internalPlayer.offsetX;
  }
  public set offsetX(value: number) {
    this.internalPlayer.offsetX = value;
  }

  /** Shift the drawn animation vertically (Y-down). See {@link offsetX}. */
  public get offsetY(): number {
    return this.internalPlayer.offsetY;
  }
  public set offsetY(value: number) {
    this.internalPlayer.offsetY = value;
  }
  public get audioManager(): IAudioManager | null {
    return this.internalPlayer.audioManager;
  }
  public set audioManager(value: IAudioManager | null) {
    this.internalPlayer.audioManager = value;
  }

  // --- Part overrides (65_override_layer) ---
  //
  // Thin pass-throughs to the core player, which owns the contract (see
  // InternalPlayerBase): part is a name or an index, false means the part is
  // unknown or the runtime rejected the call, and the runtime keeps the override
  // itself — nothing is re-applied per frame here.
  //
  // An override changes the output without changing the frame number, which is
  // invisible here because MZ re-renders every game frame through `_render`
  // whether or not the animation is advancing. Nothing needs invalidating.

  /** Resolve a part name to its index, or -1 if the part is not in the current animation. */
  public findPartIndex(partName: string): number {
    return this.internalPlayer.findPartIndex(partName);
  }

  /** Force-hide a part (or revert it to the animation), optionally cascading to its descendants. */
  public setPartVisibilityOverride(part: number | string, hide: boolean, cascade = false): boolean {
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

  public getCellmapNames(): string[] {
    return this.internalPlayer.getCellmapNames();
  }

  /** Cell names in the named cell map (for discovering cell-override targets). */
  public getCellNames(cellmapName: string): string[] {
    return this.internalPlayer.getCellNames(cellmapName);
  }

  /**
   * Runtime texture replacement: bind an MZ `Bitmap` for a cell-map / external-
   * texture name (costume changes, dynamic expressions), or pass `null` to
   * restore the original. `cellmapName` is a {@link getReplaceableTextureNames}
   * entry — a cell-map name (`common`) or a TextureChange target file name
   * (`common.png`).
   *
   * The bitmap's pixels are uploaded into a GL texture this player owns and frees;
   * MZ keeps owning the `Bitmap`. Load it however you like — e.g.
   * `ImageManager.loadBitmap('spritestudio/', 'costume_b')`; if it is not ready
   * yet the upload is deferred to its load listener. It must be a same-size,
   * same-layout atlas as the original (UVs are normalized by the bound texture's
   * size). Instance children share this player's textures, so a name used by a
   * child's sub-animation is replaced there too.
   */
  public setCellmapTexture(cellmapName: string, bitmap: RMMZBitmap | null): void {
    if (bitmap === null) {
      this.internalPlayer.setCellmapTexture(cellmapName, null);
      return;
    }
    const hash = hashString(cellmapName);
    const upload = (bmp: RMMZBitmap) => {
      if (bmp.isError()) return;
      this.resourceManager.setOverrideTextureFromSource(hash, bmp.canvas, bmp.width, bmp.height);
    };
    if (bitmap.isReady()) upload(bitmap);
    else bitmap.addLoadListener(upload);
  }

  /** The current runtime texture override for `cellmapName` (never the original), or undefined. */
  public getCellmapTexture(cellmapName: string): SSTextureEntry | undefined {
    return this.internalPlayer.getCellmapTexture(cellmapName) as SSTextureEntry | undefined;
  }

  /** Names {@link setCellmapTexture} can replace (cell-map names + TextureChange targets). */
  public getReplaceableTextureNames(): string[] {
    return this.internalPlayer.getReplaceableTextureNames();
  }

  public setAnimationSection(startFrame: number, endFrame: number): void {
    this.internalPlayer.setAnimationSection(startFrame, endFrame);
  }
  public setPlaybackDirection(direction: WebPlaybackDirection, style: WebPlaybackStyle): void {
    this.internalPlayer.setPlaybackDirection(direction, style);
  }

  /** The configured heading — not the instantaneous one, which is {@link isPlayingForward}. */
  public getPlaybackDirection(): WebPlaybackDirection {
    return this.internalPlayer.getPlaybackDirection();
  }

  /** What the playhead does at the far end of the section. */
  public getPlaybackStyle(): WebPlaybackStyle {
    return this.internalPlayer.getPlaybackStyle();
  }

  /** First and last frame of the range being played — the section once one is set. */
  public get startFrame(): number {
    return this.internalPlayer.getAnimationSectionStart();
  }
  public get endFrame(): number {
    return this.internalPlayer.getAnimationSectionEnd();
  }

  /** Sub-frame interpolation: whether what is drawn may sit between two authored frames. */
  public get subFrameEnabled(): boolean {
    return this.internalPlayer.subFrameEnabled;
  }
  public set subFrameEnabled(value: boolean) {
    this.internalPlayer.subFrameEnabled = value;
  }

  /** On (the default) keeps playback on the wall clock; off advances one frame per tick. */
  public get frameSkipEnabled(): boolean {
    return this.internalPlayer.isFrameSkipEnabled();
  }
  public set frameSkipEnabled(value: boolean) {
    this.internalPlayer.setFrameSkipEnabled(value);
  }

  // --- Events (drained each update() via pollEvents; ported from ssplayer-pixi) ---

  public onUserData(l: (e: SSUserDataEvent) => void): Unsubscribe {
    this._userDataListeners.add(l);
    return () => this._userDataListeners.delete(l);
  }
  public onSignal(l: (e: SSSignalEvent) => void): Unsubscribe {
    this._signalListeners.add(l);
    return () => this._signalListeners.delete(l);
  }
  public onAudio(l: (e: SSAudioEvent) => void): Unsubscribe {
    this._audioListeners.add(l);
    return () => this._audioListeners.delete(l);
  }
  /**
   * Fires when playback heads out — a `play()`, including one an autoplay or a
   * host script issued rather than the caller. Not a resume: lifting a pause
   * carries on, it does not start.
   */
  public onAnimationStarted(l: () => void): Unsubscribe {
    this._animStartedListeners.add(l);
    return () => this._animStartedListeners.delete(l);
  }
  public onAnimationFinished(l: () => void): Unsubscribe {
    this._animFinishedListeners.add(l);
    return () => this._animFinishedListeners.delete(l);
  }
  public onAnimationLooped(l: () => void): Unsubscribe {
    this._animLoopedListeners.add(l);
    return () => this._animLoopedListeners.delete(l);
  }

  /**
   * Fires once per advanced frame from `update()`, after the timeline advanced
   * and its world matrices are final — the point at which {@link getPartTransform}
   * is valid for the new frame. Returns an unsubscribe function.
   */
  public onFrame(l: (frame: number) => void): Unsubscribe {
    this._frameListeners.add(l);
    return () => this._frameListeners.delete(l);
  }

  // --- Part following ---

  /**
   * The part's current-frame transform as a 2D affine `[m00, m01, m10, m11, tx,
   * ty]` in animation-local (Y-down) space, or null if the part is unknown. Read
   * after a frame advanced (e.g. from `onFrame`). Pass `out` to avoid allocation.
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
   * part is a poor {@link attachToPart} target: its node transform sits near the
   * character root, not on the drawn mesh. Follow a NULL / bone / joint part
   * placed there instead. Following is not blocked — this only flags the target.
   */
  public isPartSkinnedMesh(part: number | string): boolean | null {
    return this.internalPlayer.isPartSkinnedMesh(part);
  }

  /**
   * Make `target` (a PixiJS display object) follow `part` (name or index) every
   * frame — a weapon, effect or hitbox tracking a null part. By default the
   * target is added as a child of this player (so it inherits the player's own
   * transform and lands exactly on the part) and its position, rotation and
   * scale are all driven; see {@link SSPartFollowOptions}. With all three axes on
   * the full affine is applied (mirror preserved; a part's own skew is not
   * carried — the runtime keeps it out of the world matrix, matching
   * SpriteStudio); otherwise only the enabled axes are written. Attaching the
   * same target twice replaces the
   * earlier attachment. Returns a handle whose `detach()` stops the following.
   */
  public attachToPart(part: number | string, target: PixiContainer, options: SSPartFollowOptions = {}): SSPartAttachment {
    return this._follower.attach(part, target, options);
  }

  /** Stop following for `target`; reverses the parenting / visibility the attach set up. */
  public detachFromPart(target: PixiContainer): void {
    this._follower.detach(target);
  }

  private pollEvents(): void {
    const ctx = this.internalPlayer.runtimeManager.context;
    const { looped, finished } = this.internalPlayer.pollPlaybackEvents();
    if (finished && this._animFinishedListeners.size > 0) {
      this._animFinishedListeners.forEach((cb) => cb());
    }
    if (looped && this._animLoopedListeners.size > 0) {
      this._animLoopedListeners.forEach((cb) => cb());
    }

    const count = ctx.get_passed_event_count();
    if (count <= 0) return;
    if (this._userDataListeners.size === 0 && this._signalListeners.size === 0 && this._audioListeners.size === 0) {
      return;
    }

    const anim = this.internalPlayer.runtimeManager.getCurrentAnimationData();
    if (!anim) return;

    for (let i = 0; i < count; i++) {
      const eventIdx = ctx.get_passed_event_index(i);
      const events = anim.events(eventIdx);
      if (!events) continue;
      if (this._userDataListeners.size > 0) this.dispatchUserData(events);
      if (this._signalListeners.size > 0) this.dispatchSignals(events);
      // Audio keys are reported whichever way the playhead is walking — the
      // observation channel is not the playback. SpriteStudio has no reverse
      // audio, so it is the backend that gates on `isPlayingForward`
      // (RMMZAudioManager.bindToPlayer does), exactly as the Godot and Unity
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
      const ev: SSUserDataEvent = { partIndex, partName: mgr.getPartName(partIndex) ?? '', frameNo: events.frameIndex() };
      const intEntry = val.integer();
      if (intEntry) ev.integer = intEntry.value();
      const str = val.str();
      if (str !== null) ev.str = str;
      const rect = val.rect();
      if (rect) ev.rect = { left: rect.left(), top: rect.top(), right: rect.right(), bottom: rect.bottom() };
      const point = val.point();
      if (point) ev.point = { x: point.v1(), y: point.v2() };
      this._userDataListeners.forEach((cb) => cb(ev));
    }
  }

  private dispatchSignals(events: ssFormat.EventsPerFrame): void {
    const mgr = this.internalPlayer.runtimeManager;
    const n = events.signalsLength();
    for (let j = 0; j < n; j++) {
      const sig = events.signals(j);
      const val = sig?.value();
      if (!sig || !val) continue;
      if (!val.active()) continue;

      const params: Record<string, boolean | number | string> = {};
      const pn = val.paramsLength();
      for (let k = 0; k < pn; k++) {
        const param = val.params(k);
        if (!param) continue;
        const paramId = param.paramId();
        if (paramId === null) continue;

        let boxed: boolean | number | string | undefined;
        switch (param.valueType()) {
          case ssFormat.SignalCommandParamValue.Bool:
            boxed = (param.value(new ssFormat.BoolValueEntry()) as ssFormat.BoolValueEntry | null)?.value();
            break;
          case ssFormat.SignalCommandParamValue.Index:
          case ssFormat.SignalCommandParamValue.Integer:
            boxed = (param.value(new ssFormat.IntValueEntry()) as ssFormat.IntValueEntry | null)?.value();
            break;
          case ssFormat.SignalCommandParamValue.Floating:
            boxed = (param.value(new ssFormat.FloatValueEntry()) as ssFormat.FloatValueEntry | null)?.value();
            break;
          case ssFormat.SignalCommandParamValue.Text: {
            const s = (param.value(new ssFormat.StringValueEntry()) as ssFormat.StringValueEntry | null)?.value();
            boxed = s ?? undefined;
            break;
          }
          default:
            continue;
        }
        if (boxed !== undefined) params[paramId] = boxed;
      }

      const partIndex = sig.partIndex();
      this._signalListeners.forEach((cb) =>
        cb({
          partIndex,
          partName: mgr.getPartName(partIndex) ?? '',
        frameNo: events.frameIndex(),
          active: true,
          commandId: Number(val.commandId() ?? 0),
          params,
        }),
      );
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
      this._audioListeners.forEach((cb) =>
        cb({
          partIndex,
          partName: mgr.getPartName(partIndex) ?? '',
        frameNo: events.frameIndex(),
          soundListNameHash: val.soundListNameHash(),
          soundNameHash: val.soundNameHash(),
          soundName: val.soundName(),
          loopNum: val.loopNum(),
        }),
      );
    }
  }

  // --- Pixi render hook (spec §2.2) ---

  // Container._render is Pixi's per-object custom-draw hook, invoked at this
  // container's Z position (after its parent chain's transform/alpha is applied,
  // and inside renderAdvanced when filters/masks are present — so MZ screen
  // effects wrap us correctly). We forward to the registered ObjectRenderer.
  protected _render(renderer: Renderer): void {
    if (!this.internalPlayer.currentAnimation) return;
    const objectRenderer = (renderer as any).plugins?.[SSPLAYER_PLUGIN_NAME];
    if (!objectRenderer) return;
    (renderer as any).batch.setObjectRenderer(objectRenderer);
    objectRenderer.render(this);
  }

  public override destroy(options?: any): void {
    // Detach followers first so a host-owned target is neither destroyed nor
    // left hidden by our teardown.
    this._follower.detachAll();
    // Immediately free WASM memory (spec §10.1) rather than waiting for GC.
    this.internalPlayer?.destroy();
    this.resourceManager?.destroy();
    super.destroy(options);
  }
}
