import { SSSurface, type SSSurfaceOptions } from './SSSurface.js';
import { SSOverlay } from './SSOverlay.js';
import type { SSPlayer } from './SSPlayer.js';
import type { SSAlign, SSFit, SSPlacementBox } from '@spritestudio/ssplayer-core';

/** The attributes that only move the character, so a change re-fits and nothing else. */
const PLACEMENT_ATTRIBUTES = ['fit', 'align', 'flip-x', 'flip-y'];

const FITS: readonly SSFit[] = ['contain', 'cover', 'none'];
const ALIGNS: readonly SSAlign[] = ['center', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];

/**
 * Optional `<ss-player>` Custom Element: one {@link SSSurface} carrying one
 * {@link SSPlayer}.
 *
 * Native Custom Elements only — no framework dependency.
 * Lives behind the `@spritestudio/ssplayer-webgl/element` subpath and is NOT
 * auto-registered (`sideEffects: false` is preserved): call
 * {@link defineSSPlayerElement} to register the tag, so ads that don't use the
 * element pay nothing.
 *
 * The element is a thin, declarative skin over the already-complete player facade;
 * all rendering/loading logic stays in `SSSurface` / `SSPlayer`. It targets the WebGL
 * player specifically — the future wgpu/WebGPU player is a separate product (two
 * independent renderers), so this element does no WebGPU capability detection.
 *
 * The animation is fitted into the element's box, `contain` and `center` by default:
 * `fit` (`contain` / `cover` / `none`) and `align` (`center`, `top`, `bottom-left`, …)
 * choose otherwise, and `flip-x` / `flip-y` mirror it. `fit="none"` draws at the
 * authored scale about the box's centre. The box is the authored canvas of the
 * animation the pack was loaded on, kept when `animation` switches so the character
 * does not rescale between animations. An element given no size takes the canvas's.
 *
 * Declarative usage:
 * ```html
 * <ss-player src="chara.ssab" animation="idle" autoplay standalone
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
    // Construction-time options (max-dpr / power-preference / antialias /
    // pause-when-hidden / background) are read once at connect and are intentionally
    // NOT observed: the GL context is created up front and getContext() ignores
    // attributes on a context that already exists, so they can't change reactively.
    // They configure the element's own surface, so they take effect on a `standalone`
    // element only; the shared overlay is built once, by whichever element comes
    // first, and takes no per-element options.
    return ['src', 'animation', 'speed-scale', ...PLACEMENT_ATTRIBUTES];
  }

  // Overlay mode (the default) shares ONE surface — and so one WebGL context —
  // across every element on the page; `_surface` stays null and `_overlay` holds
  // the shared one. `standalone` opts out into a private canvas + surface, which
  // is what an element needs for CSS effects on the animation, its own opaque
  // backdrop, or a place in the normal stacking order.
  private _surface: SSSurface | null = null;
  private _overlay: SSOverlay | null = null;
  private _player: SSPlayer | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _resizeObserver: ResizeObserver | null = null;
  // Gives the element the authored canvas's size when the page sizes neither axis;
  // it is the only thing in flow (the canvas is laid over the whole box).
  private _sizer: SVGSVGElement | null = null;
  // The box the character is fitted into: the canvas of the animation the pack was
  // loaded on, kept across `animation` switches. A new pack picks it again.
  private _frame: SSPlacementBox | undefined;

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

  /** The underlying player, or null before connect / after disconnect. */
  public get player(): SSPlayer | null {
    return this._player;
  }

  /**
   * The surface backing this element: its own in `standalone` mode, or the
   * shared overlay's otherwise. Null before connect / after disconnect.
   */
  public get surface(): SSSurface | null {
    return this._surface ?? this._overlay?.surface ?? null;
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
      try {
        await ensureWasm(this.getAttribute('wasm') ?? _defaultWasmUrl ?? undefined);
      } catch (err) {
        // ensureWasm has already logged this one, with what to do about it.
        readyReject(err);
        this.emit('error', err);
        return;
      }
      if (token !== this._loadToken || !this.isConnected) {
        // No player will be built for this cycle, so `ready` must not be left
        // pending forever — a caller awaiting it would hang with no error.
        readyReject(new Error('<ss-player>: disconnected before it became ready.'));
        return;
      }

      this.createPlayer();
      this.applyResize();

      // Keep the drawing buffer matched to the element's box (DPR clamp
      // lives in SSSurface.resize); the player re-centres itself with it.
      this._resizeObserver = new ResizeObserver(() => this.applyResize());
      this._resizeObserver.observe(this);

      readyResolve();

      const src = this.getAttribute('src');
      if (src) await this.loadSrc(src, token);
    } catch (err) {
      // A no-op once `ready` has resolved (a later loadSrc failure only reports
      // it); before that it reports the failure to the awaiter.
      readyReject(err);
      this.fail(err);
    }
  }

  disconnectedCallback(): void {
    this._loadToken++; // invalidate any in-flight load
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    for (const off of this._unsubscribe) off();
    this._unsubscribe = [];
    // destroy() stops the ticker and frees GL resources + wasm handles (including
    // every player on the surface, which here is just ours). The canvas (and its GL
    // context) is kept so a re-connect can reuse it; a fresh surface is built on
    // reconnect. Playback state is not preserved across a disconnect.
    // Overlay mode: drop just our player. The overlay is shared with every other
    // element on the page, so destroying it here would blank all of them.
    if (this._overlay && this._player) {
      this._overlay.detach(this._player);
      this._player.destroy();
    } else {
      this._surface?.destroy();
    }
    this._overlay = null;
    this._surface = null;
    this._player = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    // `animation` is compared with what the player plays, below, not with the old
    // attribute value: a crossfade or setAnimation made on the player moves
    // track 0 off the name the attribute still holds, and writing that name back
    // has to switch back to it.
    if (oldValue === newValue && name !== 'animation') return;
    // Before connect the player doesn't exist yet; connectedCallback reads the
    // current attribute values, so there's nothing to react to here.
    const player = this._player;
    if (!player) return;

    switch (name) {
      case 'src':
        if (newValue) this.loadSrc(newValue, ++this._loadToken).catch((err) => this.fail(err));
        break;
      case 'animation':
        // Reflected onto the player synchronously, so an unknown name throws right
        // here — report it like the async paths do.
        if (newValue && newValue !== player.currentAnimation) {
          try { this.applyAnimation(newValue); } catch (err) { this.fail(err); }
        }
        break;
      case 'speed-scale':
        player.speedScale = this.numAttr('speed-scale') ?? 1;
        break;
      case 'fit':
      case 'align':
      case 'flip-x':
      case 'flip-y':
        this.applyPlacement();
        break;
    }
  }

  // --- Imperative API (mirrors the facade; usable after `await el.ready`) --------

  public play(startFrame?: number): void { this._player?.play(startFrame); }
  public pause(): void { this._player?.pause(); }
  public resume(): void { this._player?.resume(); }
  public stop(): void { this._player?.stop(); }

  /** No-op until the player exists (`await el.ready` first). */
  public setAnimation(name: string): void { this.applyAnimation(name); }

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
    const anim = this.getAttribute('animation') ?? player.getAnimationNames()[0];
    if (anim) this.applyAnimation(anim);
    this.pinFrame();
    if (token !== this._loadToken) return;
    this.emit('load');
  }

  // --- Internals ----------------------------------------------------------------

  /** True unless the element opted out of the shared overlay. */
  private get isOverlay(): boolean {
    return !this.hasAttribute('standalone');
  }

  private buildDom(): void {
    const root = this.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    // Author sizes the element via CSS/attributes; the canvas fills the host box.
    // The canvas is laid over the box rather than sitting in flow, so its buffer
    // size, which follows the box, can never feed back into the box.
    style.textContent = ':host{display:inline-block;position:relative}:host([hidden]){display:none}'
      + 'canvas{position:absolute;inset:0;display:block;width:100%;height:100%}'
      + 'svg{display:block;width:100%;height:auto;visibility:hidden}';
    root.append(style);
    this._sizer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this._sizer.setAttribute('aria-hidden', 'true');
    root.append(this._sizer);
    // In overlay mode the element owns no canvas at all — it is just a box whose
    // rect the overlay reads. That is the whole reason the context count stops
    // scaling with the number of elements.
    if (this.isOverlay) return;
    this._canvas = document.createElement('canvas');
    root.append(this._canvas);
  }

  private createPlayer(): void {
    const options: SSSurfaceOptions = {
      autoStart: true, // ticker drives draw immediately (a no-op until an animation loads); play() gates advancing
      maxDPR: this.numAttr('max-dpr'),
      powerPreference: this.powerAttr(),
      antialias: this.hasAttribute('antialias'),
      // Tri-state: the surface default is ON, so an absent attribute must pass
      // `undefined` (inherit) rather than a `false` that would switch the
      // gating off — opt out explicitly with pause-when-hidden="false".
      pauseWhenHidden: this.boolAttr('pause-when-hidden'),
      backgroundColor: this.colorAttr('background'),
    };
    if (this.isOverlay) {
      // Every element lands on the same overlay unless it names another with
      // `overlay`. Each extra overlay is another GL context, so that attribute
      // exists for scroll containers, not for taste.
      this._overlay = SSOverlay.getOrCreate(this.getAttribute('overlay') ?? undefined);
      this._player = this._overlay.createPlayer(this);
    } else {
      this._surface = new SSSurface(this._canvas!, options);
      this._player = this._surface.createPlayer();
    }
    const speed = this.numAttr('speed-scale');
    if (speed !== undefined) this._player.speedScale = speed;
    this.applyPlacement();
    this.wireEvents();
  }

  private wireEvents(): void {
    const player = this._player!;
    // Re-dispatch player events as DOM CustomEvents so declarative hosts can
    // listen on the element, under the family's stems (animationStarted,
    // userData, …) lower-cased as DOM event names are — the names
    // <ss-player-webgpu> dispatches too. 'audio' is the notification: the
    // player plays the sound itself through the SSWebAudioManager it wires up on
    // its own, unless it was constructed with `autoAudio: false`.
    this._unsubscribe.push(
      player.onAnimationStarted(() => this.emit('animationstarted')),
      player.onAnimationFinished(() => this.emit('animationfinished')),
      player.onAnimationLooped(() => this.emit('animationlooped')),
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

    const anim = this.getAttribute('animation') ?? player.getAnimationNames()[0];
    if (anim) this.applyAnimation(anim);
    this.pinFrame();
    if (token !== this._loadToken) return;
    this.emit('load');
  }

  /**
   * Fit against the canvas of the animation a pack was loaded on, and size the
   * element by it when the page has not.
   */
  private pinFrame(): void {
    const rect = this._player?.canvasRect;
    this._frame = rect ?? undefined;
    if (rect && this._sizer) {
      this._sizer.setAttribute('width', String(rect.width));
      this._sizer.setAttribute('height', String(rect.height));
    }
    this.applyPlacement();
  }

  /**
   * Put `fit`, `align`, `flip-x` and `flip-y` on the player. An unknown `fit` or
   * `align` is reported, naming what is accepted, and leaves the placement as it
   * was rather than drawing somewhere the page did not ask for.
   */
  private applyPlacement(): void {
    const player = this._player;
    if (!player) return;
    const fit = this.getAttribute('fit') ?? 'contain';
    const align = this.getAttribute('align') ?? 'center';
    if (!(FITS as readonly string[]).includes(fit)) {
      this.fail(new Error(`<ss-player>: unknown fit "${fit}"; it takes ${FITS.join(', ')}.`));
      return;
    }
    if (!(ALIGNS as readonly string[]).includes(align)) {
      this.fail(new Error(`<ss-player>: unknown align "${align}"; it takes ${ALIGNS.join(', ')}.`));
      return;
    }
    player.flipX = this.hasAttribute('flip-x');
    player.flipY = this.hasAttribute('flip-y');
    player.setPlacement({ fit: fit as SSFit, align: align as SSAlign, frame: this._frame });
  }

  private applyAnimation(name: string): void {
    const player = this._player;
    if (!player) return;
    player.setAnimation(name);
    // Without `autoplay` the element stays paused on the first frame (poster-like);
    // draw() still renders it since it's independent of the playing state.
    if (this.hasAttribute('autoplay')) player.play();
  }

  private applyResize(): void {
    // Overlay mode sizes nothing: the overlay canvas covers the viewport and the
    // player follows this element's rect every frame.
    const surface = this._surface;
    if (!surface) return;
    // The canvas's layout box, not the element's bounding rect: the rect is the
    // bounding box of whatever CSS transform the page put on the element, and a
    // buffer sized from it stretches the picture.
    const canvas = this._canvas!;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    // Drawing buffer only — the shadow stylesheet already sizes the canvas element
    // (`canvas{width:100%;height:100%}`), so nothing writes inline CSS over it.
    surface.resize(w, h);
    // No centring maths here: the player's box tracks the whole surface and its
    // transform is relative to the box centre, so it re-centres on every resize.
  }

  private emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * Report a failure on the `error` event and in the console. A declarative page
   * never listens for the event, and a blank element with an empty console reads
   * as a renderer fault rather than a wrong `src` or animation name.
   */
  private fail(err: unknown): void {
    console.error('[ss-player]', err);
    this.emit('error', err);
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

  private powerAttr(): SSSurfaceOptions['powerPreference'] {
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
    _wasmInit = SSSurface.initialize(wasm).catch((e) => {
      _wasmInit = null;
      // Also log it. This failure is page-wide and fatal — nothing will ever
      // render — but the only channels for it are the element's `error` event
      // and `ready`, and a declarative page subscribes to neither. Worse, the
      // event is dispatched from connectedCallback during parsing, so even a
      // listener added in a <script> AFTER the tag can miss it. Without this
      // line a forgotten wasm URL is a blank canvas and an empty console.
      console.error('[ss-player] WebAssembly runtime failed to initialise. No <ss-player> will render.', e);
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
