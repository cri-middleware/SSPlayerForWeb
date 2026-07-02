import { DirectInternalPlayer, IAudioManager, SSRuntimeManager, initializeWasm } from '@spritestudio/ssplayer-core';
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
  static async initialize(wasm: string | URL | ArrayBuffer | Uint8Array): Promise<void> {
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

  public async loadBuffer(
    ssab: ArrayBuffer | Uint8Array,
    textures: Map<number, TexImageSource | ArrayBuffer | string>
  ): Promise<void> {
    this.internalPlayer.bindResource(new Uint8Array(ssab));
    // Load textures into resourceManager
    for (const [hash, src] of textures.entries()) {
      if (typeof src === 'string') {
        await this.resourceManager.loadTexture(src, hash);
      } else if (src instanceof ArrayBuffer || src instanceof Uint8Array) {
        const blob = new Blob([src as BlobPart]);
        const bitmap = await createImageBitmap(blob);
        this.resourceManager.bindTextureSource(bitmap, hash, bitmap.width, bitmap.height);
      } else {
        this.resourceManager.bindTextureSource(src as TexImageSource, hash, (src as any).width as number, (src as any).height as number);
      }
    }
  }

  public async load(ssabUrl: string, assetBaseUrl?: string): Promise<void> {
    await this.internalPlayer.load(ssabUrl, assetBaseUrl);
    this.internalPlayer.runtimeManager.context.set_render_mode(0); // Direct
    this.internalPlayer.runtimeManager.context.set_coordinate_system(1); // YDown
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
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // Compute projection
    const projection = new Float32Array([
      2.0 / cw, 0, 0,
      0, -2.0 / ch, 0,
      -1, 1, 1
    ]);

    if (this.renderer['partsColorProgram'].uProjection) {
      gl.useProgram(this.renderer['partsColorProgram'].program);
      gl.uniformMatrix3fv(this.renderer['partsColorProgram'].uProjection, false, projection);
    }

    this.renderer.render(this.internalPlayer, this.resourceManager, this.transformMatrix);
  }

  public setTransform(t: {
    x?: number; y?: number; scaleX?: number; scaleY?: number;
    rotation?: number; anchorX?: number; anchorY?: number;
  }): void {
    // simplified transform update
    const x = t.x ?? 0;
    const y = t.y ?? 0;
    const sx = t.scaleX ?? 1;
    const sy = t.scaleY ?? 1;
    this.transformMatrix[0] = sx;
    this.transformMatrix[3] = sy;
    this.transformMatrix[4] = x;
    this.transformMatrix[5] = y;
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
