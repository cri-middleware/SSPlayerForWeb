import { SSCanvasPlayer, type SSCanvasPlayerOptions } from './SSCanvasPlayer.js';
import { SSRuntimeManager } from '@spritestudio/ssplayer-core';

/**
 * Optional `<ss-player>` Custom Element wrapper around {@link SSCanvasPlayer}.
 *
 * Native Custom Elements only — no framework dependency.
 * Lives behind the `@spritestudio/ssplayer-webgl/element` subpath and is NOT
 * auto-registered (`sideEffects: false` is preserved): call
 * {@link defineSSPlayerElement} to register the tag, so ads that don't use the
 * element pay nothing.
 *
 * The element is a thin, declarative skin over the already-complete player facade;
 * all rendering/loading logic stays in `SSCanvasPlayer`. It targets the WebGL
 * player specifically — the future wgpu/WebGPU player is a separate product (two
 * independent renderers), so this element does no WebGPU capability detection.
 *
 * Declarative usage:
 * ```html
 * <ss-player src="chara.ssab" animation="idle" autoplay
 *            max-dpr="2" power-preference="low-power" style="width:320px;height:480px">
 * </ss-player>
 * ```
 *
 * Imperative usage (inline / ArrayBuffer ads — attributes can't carry buffers):
 * ```ts
 * const el = document.querySelector('ss-player')!;
 * await el.ready;
 * await el.loadBuffer(ssabArrayBuffer, new Map([[0x1234abcd, imageBitmap]]));
 * el.play();
 * ```
 */
export class SSPlayerElement extends HTMLElement {
  static get observedAttributes(): string[] {
    // Construction-time options (max-dpr / power-preference / antialias / stencil /
    // pause-when-hidden) are read once at connect and are intentionally NOT observed:
    // the GL context is created up front and getContext() ignores attributes on a
    // context that already exists, so they can't change reactively.
    return ['src', 'animation', 'speed'];
  }

  private _player: SSCanvasPlayer | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;

  // Monotonic guard: every (re)load / connect / disconnect bumps this. Async
  // continuations (fetch, setAnimation) compare against it and bail if a newer
  // load started or the element was torn down — prevents races and use-after-destroy.
  private _loadToken = 0;

  // Settles once the player is constructed (wasm ready), and REJECTS if that
  // never happens. Re-created on each connect so imperative callers can
  // `await el.ready` before loadBuffer/play. See connectedCallback.
  private _readyPromise: Promise<void> = Promise.resolve();

  // Player-event unsubscribers, torn down on disconnect. The player's on* hooks
  // are re-dispatched as DOM CustomEvents (see wireEvents). Audio playback itself
  // is opt-in: attach an SSWebAudioManager to `el.player` to hear `onAudio` sounds
  // (the 'audio' CustomEvent is still emitted regardless, for host wiring).
  private _unsubscribe: Array<() => void> = [];

  /**
   * Resolves when the player exists and wasm is initialised (safe to load/play).
   * Rejects if the element can never become ready — wasm init failed, or the
   * element was disconnected (or a newer connect superseded this one) while it
   * was still initialising. It always settles, so `await el.ready` cannot hang.
   */
  public get ready(): Promise<void> {
    return this._readyPromise;
  }

  /** The underlying facade, or null before connect / after disconnect. */
  public get player(): SSCanvasPlayer | null {
    return this._player;
  }

  async connectedCallback(): Promise<void> {
    if (!this._canvas) this.buildDom();
    // Captured as locals, not fields: a re-connect installs a fresh promise, and
    // this cycle must still be able to settle the one it handed out.
    let readyResolve!: () => void;
    let readyReject!: (reason: unknown) => void;
    this._readyPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // Awaiting `ready` is optional (declarative hosts never do), so keep a failed
    // init from surfacing as an unhandled rejection. Callers that DO await it
    // still get the rejection — this only marks the promise as handled.
    this._readyPromise.catch(() => {});

    const token = ++this._loadToken;
    try {
      // Global, idempotent wasm init (deduped across every element). Resolution
      // order: this element's `wasm` attribute → a page-wide default set once via
      // setSSPlayerWasmUrl() (e.g. from the CDN bundle's `data-wasm`) → the
      // bundler-resolved default. Only the first element to connect actually runs
      // init; later elements reuse the cached promise (their `wasm` is ignored).
      await ensureWasm(this.getAttribute('wasm') ?? _defaultWasmUrl ?? undefined);
      if (token !== this._loadToken || !this.isConnected) {
        // No player will be built for this cycle, so `ready` must not be left
        // pending forever — a caller awaiting it would hang with no error.
        readyReject(new Error('<ss-player>: disconnected before it became ready.'));
        return;
      }

      this.createPlayer();
      this.applyResize();

      // Keep the drawing buffer matched to the element's box (DPR clamp
      // lives in SSCanvasPlayer.resize) and re-centre on every size change.
      this._resizeObserver = new ResizeObserver(() => this.applyResize());
      this._resizeObserver.observe(this);

      readyResolve();

      const src = this.getAttribute('src');
      if (src) await this.loadSrc(src, token);
    } catch (err) {
      // A no-op once `ready` has resolved (a later loadSrc failure only emits
      // the DOM event); before that it reports the init failure to the awaiter.
      readyReject(err);
      this.dispatchEvent(new CustomEvent('error', { detail: err }));
    }
  }

  disconnectedCallback(): void {
    this._loadToken++; // invalidate any in-flight load
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    for (const off of this._unsubscribe) off();
    this._unsubscribe = [];
    // destroy() stops the ticker and frees GL resources + wasm handles. The canvas
    // (and its GL context) is kept so a re-connect can reuse it; a fresh renderer is
    // built on reconnect. Playback state is not preserved across a disconnect.
    this._player?.destroy();
    this._player = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    // Before connect the player doesn't exist yet; connectedCallback reads the
    // current attribute values, so there's nothing to react to here.
    const player = this._player;
    if (!player) return;

    switch (name) {
      case 'src':
        if (newValue) this.loadSrc(newValue, ++this._loadToken).catch((err) => this.emit('error', err));
        break;
      case 'animation':
        if (newValue) this.applyAnimation(newValue).catch((err) => this.emit('error', err));
        break;
      case 'speed':
        player.speedScale = this.numAttr('speed') ?? 1;
        break;
    }
  }

  // --- Imperative API (mirrors the facade; usable after `await el.ready`) --------

  public play(startFrame?: number): void { this._player?.play(startFrame); }
  public pause(): void { this._player?.pause(); }
  public resume(): void { this._player?.resume(); }
  public stop(): void { this._player?.stop(); }

  public async setAnimation(name: string): Promise<void> {
    await this.applyAnimation(name);
  }

  /**
   * Load from raw bytes + a texture map (inline / playable-ad path). Requires the
   * element to be connected (`await el.ready` first). Picks the animation from the
   * `animation` attribute, else the first animation in the ssab.
   */
  public async loadBuffer(
    ssab: ArrayBuffer | Uint8Array,
    textures: Map<number, TexImageSource | ArrayBuffer | string>
  ): Promise<void> {
    const player = this._player;
    if (!player) throw new Error('<ss-player>: not connected yet — await el.ready first.');
    const token = ++this._loadToken;
    await player.loadBuffer(ssab, textures);
    if (token !== this._loadToken) return;
    const anim = this.getAttribute('animation')
      ?? SSRuntimeManager.extractAnimationNames(ssab instanceof Uint8Array ? ssab : new Uint8Array(ssab))[0];
    if (anim) await this.applyAnimation(anim);
    if (token !== this._loadToken) return;
    this.emit('load');
  }

  // --- Internals ----------------------------------------------------------------

  private buildDom(): void {
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // Author sizes the element via CSS/attributes; the canvas fills the host box.
    style.textContent = ':host{display:inline-block;position:relative}canvas{display:block;width:100%;height:100%}';
    this._canvas = document.createElement('canvas');
    root.append(style, this._canvas);
  }

  private createPlayer(): void {
    const options: SSCanvasPlayerOptions = {
      autoStart: true, // ticker drives draw immediately (a no-op until an animation loads); play() gates advancing
      maxDPR: this.numAttr('max-dpr'),
      powerPreference: this.powerAttr(),
      antialias: this.hasAttribute('antialias'),
      // Tri-state: the facade default is ON, so an absent attribute must pass
      // `undefined` (inherit) rather than a `false` that would switch the
      // gating off — opt out explicitly with pause-when-hidden="false".
      pauseWhenHidden: this.boolAttr('pause-when-hidden'),
      backgroundColor: this.colorAttr('background'),
    };
    this._player = new SSCanvasPlayer(this._canvas!, options);
    const speed = this.numAttr('speed');
    if (speed !== undefined) this._player.speedScale = speed;
    this.wireEvents();
  }

  private wireEvents(): void {
    const player = this._player!;
    // Re-dispatch player events as DOM CustomEvents so declarative hosts can
    // listen on the element. 'audio' carries the sound reference only — actual
    // playback requires an SSWebAudioManager attached to `el.player`.
    this._unsubscribe.push(
      player.onAnimationEnd(() => this.emit('ended')),
      player.onAnimationLoop(() => this.emit('loop')),
      player.onUserData((e: unknown) => this.emit('userdata', e)),
      player.onSignal((e: unknown) => this.emit('signal', e)),
      player.onAudio((e: unknown) => this.emit('audio', e)),
    );
  }

  private async loadSrc(src: string, token: number): Promise<void> {
    const player = this._player;
    if (!player) return;
    // URL path: the facade fetches the ssab + its textures relative to the URL.
    await player.load(src);
    if (token !== this._loadToken) return;

    let anim = this.getAttribute('animation');
    if (!anim) {
      // No instance-level animation-name accessor exists, so re-fetch the ssab bytes
      // once to pick the first animation (browser-cached; mirrors the example).
      const buf = new Uint8Array(await (await fetch(src)).arrayBuffer());
      if (token !== this._loadToken) return;
      anim = SSRuntimeManager.extractAnimationNames(buf)[0] ?? null;
    }
    if (anim) await this.applyAnimation(anim);
    if (token !== this._loadToken) return;
    this.emit('load');
  }

  private async applyAnimation(name: string): Promise<void> {
    const player = this._player;
    if (!player) return;
    await player.setAnimation(name);
    // Without `autoplay` the element stays paused on the first frame (poster-like);
    // draw() still renders it since it's independent of the playing state.
    if (this.hasAttribute('autoplay')) player.play();
  }

  private applyResize(): void {
    const player = this._player;
    const canvas = this._canvas;
    if (!player || !canvas) return;
    const rect = this.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    player.resize(w, h);
    // SS origin and the renderer's projection origin are both centre; translate by
    // half the (post-DPR) drawing-buffer size to centre the animation in the canvas.
    player.setTransform({ x: canvas.width / 2, y: canvas.height / 2 });
  }

  private emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * Read an opt-out boolean attribute: absent → `undefined` (keep the option's
   * own default), `="false"` → false, present in any other form (including the
   * bare attribute) → true. Plain `hasAttribute` can only express default-off.
   */
  private boolAttr(name: string): boolean | undefined {
    const v = this.getAttribute(name);
    if (v === null) return undefined;
    return v.trim().toLowerCase() !== 'false';
  }

  private numAttr(name: string): number | undefined {
    const v = this.getAttribute(name);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  private powerAttr(): SSCanvasPlayerOptions['powerPreference'] {
    const v = this.getAttribute('power-preference');
    return v === 'high-performance' || v === 'low-power' || v === 'default' ? v : undefined;
  }

  /** Parse an opaque backdrop colour attribute: `#RRGGBB`, `0xRRGGBB`, or `RRGGBB`. */
  private colorAttr(name: string): number | undefined {
    const v = this.getAttribute(name);
    if (v === null) return undefined;
    const hex = v.trim().replace(/^#/, '').replace(/^0x/i, '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined;
    return parseInt(hex, 16);
  }
}

// Module-level, deduped wasm init shared by every element instance (core caches the
// underlying init promise too, but this avoids re-compiling an ArrayBuffer per element).
let _wasmInit: Promise<void> | null = null;
function ensureWasm(wasm?: string): Promise<void> {
  if (!_wasmInit) {
    // Cache the success only: a failed init (bad URL, offline) must stay
    // retryable, or the next element to connect would inherit the same
    // rejection forever. Matches initializeWasm() in the core.
    _wasmInit = SSCanvasPlayer.initialize(wasm).catch((e) => {
      _wasmInit = null;
      throw e;
    });
  }
  return _wasmInit;
}

// Page-wide default WASM URL, applied to every <ss-player> that lacks a `wasm`
// attribute. Set it ONCE (before elements connect) instead of repeating the URL on
// each tag. The CDN bundle wires this from the loading `<script data-wasm="…">`.
let _defaultWasmUrl: string | undefined;
export function setSSPlayerWasmUrl(url: string): void {
  _defaultWasmUrl = url;
}

/**
 * Register the `<ss-player>` Custom Element. Opt-in (not called on import) so the
 * element stays tree-shakeable. Idempotent; pass a custom `tag` to avoid a name
 * clash with another SS player build on the same page.
 */
export function defineSSPlayerElement(tag = 'ss-player'): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(tag)) customElements.define(tag, SSPlayerElement);
}
