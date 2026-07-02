import { DirectInternalPlayer, IAudioManager, initializeWasm } from '@spritestudio/ssplayer-core';
import { SSWebGLRenderer } from './SSWebGLRenderer.js';
import { SSWebGLResourceManager } from './SSWebGLResourceManager.js';

export interface SSCanvasPlayerOptions {
  premultipliedAlpha?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  maxDPR?: number;
  powerPreference?: 'low-power' | 'high-performance' | 'default';
  pauseWhenHidden?: boolean;
  autoStart?: boolean;
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
  private tickerId: number = 0;
  private lastTime: number = 0;
  private _isPlaying: boolean = false;
  private transformMatrix = new Float32Array([1, 0, 0, 1, 0, 0]); // [a, b, c, d, tx, ty]

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
        powerPreference: options.powerPreference ?? 'low-power'
      };
      this.gl = (this.canvas.getContext('webgl2', glAttrs) || this.canvas.getContext('webgl', glAttrs)) as any;
    } else {
      this.gl = target;
      this.canvas = this.gl.canvas as HTMLCanvasElement;
    }

    this.renderer = new SSWebGLRenderer(this.gl);
    this.resourceManager = new SSWebGLResourceManager(this.gl);
    this.internalPlayer = new DirectInternalPlayer(this.resourceManager);

    if (options.autoStart) {
      this.startTicker();
    }
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

  public async load(ssabUrl: string, assetBaseUrl?: string): Promise<void> {
    await this.internalPlayer.load(ssabUrl, assetBaseUrl);
    this.configureContext();
  }

  public async setAnimation(name: string): Promise<void> {
    await this.internalPlayer.setAnimation(name);
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

  public startTicker(): void {
    if (this.tickerId) return;
    this.lastTime = performance.now();
    const tick = (now: number) => {
      const deltaMs = now - this.lastTime;
      this.lastTime = now;
      this.update(deltaMs);
      this.draw();
      this.tickerId = requestAnimationFrame(tick);
    };
    this.tickerId = requestAnimationFrame(tick);
  }

  public stopTicker(): void {
    if (this.tickerId) {
      cancelAnimationFrame(this.tickerId);
      this.tickerId = 0;
    }
  }

  public update(deltaMs: number): void {
    if (this._isPlaying) {
      this.internalPlayer.update(deltaMs);
    }
  }

  public draw(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
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

  public onUserData(cb: any): () => void { return () => {}; }
  public onSignal(cb: any): () => void { return () => {}; }
  public onAudio(cb: any): () => void { return () => {}; }
  public onAnimationEnd(cb: any): () => void { return () => {}; }
  public onAnimationLoop(cb: any): () => void { return () => {}; }

  public set audioManager(v: IAudioManager | null) {
    this.internalPlayer.audioManager = v;
  }

  public destroy(): void {
    this.stopTicker();
    this.renderer.destroy();
    this.resourceManager.destroy();
  }
}
