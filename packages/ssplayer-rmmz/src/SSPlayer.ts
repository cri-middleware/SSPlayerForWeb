// SSPlayer — a PixiJS v5 DisplayObject (Container) that plays a SpriteStudio
// animation by driving ssplayer-webgl's SSWebGLRenderer against RPG Maker MZ's
// shared WebGL context (spec §2.2 / §0 Layer 3).
//
// Unlike ssplayer-pixi's SSPlayer this class does NOT own a Ticker: playback is
// advanced only when the host RMMZ sprite calls `update(deltaMs)` from its own
// `update()`, so the animation stays perfectly in step with MZ time and pauses
// with the game (spec §7.3). Drawing happens in `_render`, called by Pixi at the
// container's Z position, so MZ handles Z-order / opacity / tint inheritance.
//
// The actual GL draw + WebGL-state protection lives in SSPlayerRenderer (a
// registered PIXI.ObjectRenderer); this class only decides WHAT to draw and
// owns the core player, resource manager and event dispatch.

import {
  DirectInternalPlayer,
  initializeWasm,
  ssFormat,
  SSRuntimeManager,
  type IAudioManager,
  type WebPlaybackDirection,
  type WebPlaybackStyle,
} from '@spritestudio/ssplayer-webgl';
import type { Container as PixiContainer, Renderer } from 'pixi.js';
import { getMZGl, getPIXI, type GL } from './rmmzGlobals.js';
import { RMMZResourceManager } from './rmmz/RMMZResourceManager.js';
import { registerSSPlayerRenderer, SSPLAYER_PLUGIN_NAME } from './SSPlayerRenderer.js';

export type Unsubscribe = () => void;

export interface SSUserDataEvent {
  partIndex: number;
  partName: string;
  integer?: number;
  str?: string;
  rect?: { x1: number; y1: number; x2: number; y2: number };
  point?: { x: number; y: number };
}
export interface SSSignalEvent {
  partIndex: number;
  partName: string;
  active: boolean;
  commandId: number;
  params: Record<string, boolean | number | string>;
}
export interface SSAudioEvent {
  partIndex: number;
  partName: string;
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
  // Retained .ssab bytes so we can list animation names
  // (SSRuntimeManager.extractAnimationNames) and validate the requested name.
  private _ssabBuffer: Uint8Array | null = null;

  private _userDataListeners = new Set<(e: SSUserDataEvent) => void>();
  private _signalListeners = new Set<(e: SSSignalEvent) => void>();
  private _audioListeners = new Set<(e: SSAudioEvent) => void>();
  private _animEndListeners = new Set<() => void>();
  private _animLoopListeners = new Set<() => void>();
  private _prevFinished = false;

  /**
   * @param gl the MZ shared WebGL context. Defaults to `Graphics._app.renderer.gl`
   *           — so construct SSPlayer only after MZ has booted its Pixi app.
   */
  constructor(gl?: GL) {
    super();
    this._gl = gl ?? getMZGl();
    this.resourceManager = new RMMZResourceManager(this._gl);
    this.internalPlayer = new DirectInternalPlayer(this.resourceManager);
    registerSSPlayerRenderer(); // idempotent Renderer.registerPlugin('ssplayer', ...)
  }

  /** True when `gl` is the context this player's textures were uploaded to. */
  public matchesContext(gl: GL): boolean {
    return this._gl === gl;
  }

  // --- Loading & playback (thin wrappers over the core player) ---

  public async load(ssabUrl: string): Promise<void> {
    // Fetch the .ssab ourselves (single fetch) so we can retain the bytes for
    // animation-name introspection, then bind it via the public bindResource.
    // Forward the ssab URL so the core resolves textures relative to it (siblings
    // of the .ssab — the structure ssconverter emits).
    const res = await fetch(ssabUrl);
    if (!res.ok) throw new Error(`[ssplayer-rmmz] failed to load SSAB: ${res.status} ${res.statusText}`);
    const buffer = new Uint8Array(await res.arrayBuffer());
    this.bindResource(buffer, ssabUrl);
  }

  /**
   * Bind an already-fetched .ssab (bytes). Pair with setAnimation. Pass the ssab's
   * source URL (when known) so textures resolve relative to it; omit for inline
   * bytes whose textures are supplied by other means.
   */
  public bindResource(buffer: Uint8Array, ssabUrl?: string): void {
    this._ssabBuffer = buffer;
    this.internalPlayer.bindResource(buffer, ssabUrl);
    // Direct render mode + Y-down, matching ssplayer-pixi (MZ world space is y-down).
    this.internalPlayer.runtimeManager.context.set_render_mode(0);
    this.internalPlayer.runtimeManager.context.set_coordinate_system(1);
  }

  /** Animation names in the loaded .ssab (table order). Empty until load(). */
  public getAnimationNames(): string[] {
    return this._ssabBuffer ? SSRuntimeManager.extractAnimationNames(this._ssabBuffer) : [];
  }

  /**
   * Play `animationName`. If empty, the first animation in the .ssab is used; if
   * a non-existent name is given, we warn (listing the real names) and fall back
   * to the first — so authors who mistype in the plugin command still see
   * *something*, and get the exact names in the console.
   */
  public async setAnimation(animationName: string, loop = -1): Promise<void> {
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
    await this.internalPlayer.setAnimation(target);
    this.internalPlayer.setLoop(loop);
  }

  public play(startFrame = -1): void {
    this.internalPlayer.play(startFrame);
  }
  public pause(): void {
    this.internalPlayer.pause();
  }
  public resume(): void {
    this.internalPlayer.resume();
  }
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
  }

  // --- Accessors ---

  public get animationName(): string {
    return this.internalPlayer.animationName;
  }
  public get frame(): number {
    return this.internalPlayer.getFrameNo();
  }
  public set frame(value: number) {
    this.internalPlayer.setFrame(value);
  }
  public get totalFrames(): number {
    return this.internalPlayer.getTotalFrames();
  }
  public get fps(): number {
    return this.internalPlayer.getFrameRate();
  }
  public set fps(value: number) {
    this.internalPlayer.setFrameRate(value);
  }
  public get isPlaying(): boolean {
    return this.internalPlayer.isPlaying;
  }
  public get isPausing(): boolean {
    return this.internalPlayer.isPausing;
  }
  public get speedScale(): number {
    return this.internalPlayer.getSpeed();
  }
  public set speedScale(speed: number) {
    this.internalPlayer.setSpeed(speed);
  }
  public get loopCount(): number {
    return this.internalPlayer.getLoop();
  }
  public set loopCount(value: number) {
    this.internalPlayer.setLoop(value);
  }
  public get audioManager(): IAudioManager | null {
    return this.internalPlayer.audioManager;
  }
  public set audioManager(value: IAudioManager | null) {
    this.internalPlayer.audioManager = value;
  }
  public setAnimationSection(startFrame: number, endFrame: number): void {
    this.internalPlayer.setAnimationSection(startFrame, endFrame);
  }
  public setPlaybackDirection(direction: WebPlaybackDirection, style: WebPlaybackStyle): void {
    this.internalPlayer.setPlaybackDirection(direction, style);
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
  public onAnimationEnd(l: () => void): Unsubscribe {
    this._animEndListeners.add(l);
    return () => this._animEndListeners.delete(l);
  }
  public onAnimationLoop(l: () => void): Unsubscribe {
    this._animLoopListeners.add(l);
    return () => this._animLoopListeners.delete(l);
  }

  private pollEvents(): void {
    const ctx = this.internalPlayer.runtimeManager.context;

    const finished = !ctx.is_playing() && ctx.is_end_frame_reached();
    if (finished && !this._prevFinished && this._animEndListeners.size > 0) {
      this._animEndListeners.forEach((cb) => cb());
    }
    this._prevFinished = finished;

    if (this._animLoopListeners.size > 0 && ctx.is_looped()) {
      this._animLoopListeners.forEach((cb) => cb());
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
      const isPlayingForward = ctx.is_playing_forward() === (this.speedScale >= 0);
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
      const ev: SSUserDataEvent = { partIndex, partName: mgr.getPartName(partIndex) ?? '' };
      const intEntry = val.integer();
      if (intEntry) ev.integer = intEntry.value();
      const str = val.str();
      if (str !== null) ev.str = str;
      const rect = val.rect();
      if (rect) ev.rect = { x1: rect.x1(), y1: rect.y1(), x2: rect.x2(), y2: rect.y2() };
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
    if (!this.internalPlayer.animationName) return;
    const objectRenderer = (renderer as any).plugins?.[SSPLAYER_PLUGIN_NAME];
    if (!objectRenderer) return;
    (renderer as any).batch.setObjectRenderer(objectRenderer);
    objectRenderer.render(this);
  }

  public override destroy(options?: any): void {
    // Immediately free WASM memory (spec §10.1) rather than waiting for GC.
    this.internalPlayer?.destroy();
    this.resourceManager?.destroy();
    super.destroy(options);
  }
}
