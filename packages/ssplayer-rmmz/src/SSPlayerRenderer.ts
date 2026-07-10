// SSPlayerRenderer — a PixiJS v5 ObjectRenderer plugin (registered as
// 'ssplayer') that draws an SSPlayer by driving ssplayer-webgl's SSWebGLRenderer
// against MZ's shared WebGL context (spec §2.1).
//
// One instance exists per PixiJS Renderer, so it also owns the single shared
// SSWebGLRenderer (mirroring how MZ keeps one Effekseer context). Around the raw
// GL draw it applies the EXACT WebGL-state protection MZ's own Effekseer sprite
// uses (Sprite_Animation.onBeforeRender / onAfterRender in rmmz_sprites.js), so
// MZ's batched sprites, filters and tilemap keep rendering correctly afterwards.

import { SSWebGLRenderer } from '@spritestudio/ssplayer-webgl';
import type { ObjectRenderer as PixiObjectRenderer, Renderer } from 'pixi.js';
import { getMZRenderer, getPIXI, type GL } from './rmmzGlobals.js';
import type { SSPlayer } from './SSPlayer.js';

export const SSPLAYER_PLUGIN_NAME = 'ssplayer';

const PIXI = getPIXI();
const ObjectRendererBase: typeof PixiObjectRenderer = PIXI
  ? PIXI.ObjectRenderer
  : (class {
      renderer: any;
      constructor(renderer: any) {
        this.renderer = renderer;
      }
    } as any);

export class SSPlayerRenderer extends (ObjectRendererBase as { new (renderer: Renderer): PixiObjectRenderer }) {
  private ssRenderer: SSWebGLRenderer | null = null;
  private _gl: GL | null = null;
  // Reused transform scratch: [m00, m01, m10, m11, tx, ty] (see SSWebGLRenderer).
  private _t = new Float32Array(6);

  /** Drop the GL renderer when the context is (re)created; rebuilt on next draw. */
  public contextChange(): void {
    this.ssRenderer = null;
    this._gl = null;
  }

  public render(player: SSPlayer): void {
    const ip = player.internalPlayer;
    if (!ip.animationName) return;

    const renderer = this.renderer as unknown as Renderer & {
      gl: GL;
      resolution: number;
      batch: { flush(): void };
      geometry: { reset(): void };
      texture: { reset(): void };
      state: { reset(): void };
      shader: { reset(): void };
      framebuffer: { reset(): void };
    };
    const gl = renderer.gl;

    if (!this.ssRenderer || this._gl !== gl) {
      this.ssRenderer = new SSWebGLRenderer(gl);
      this._gl = gl;
    }

    // --- MZ Effekseer-style: flush the pending batch before raw GL ---
    renderer.batch.flush();
    renderer.geometry.reset();

    // Compose the draw transform. SSWebGLRenderer uses an internal full-screen
    // projection in DRAWING-BUFFER pixels, so map anime-local -> drawing buffer:
    // worldTransform (anime-local -> logical screen px) scaled by the renderer
    // resolution. Layout expected by SSWebGLRenderer: [m00,m01,m10,m11,tx,ty]
    // where x' = m00*x + m01*y + tx  (Pixi Matrix: x' = a*x + c*y + tx).
    const wt = player.worldTransform as unknown as {
      a: number; b: number; c: number; d: number; tx: number; ty: number;
    };
    const r = renderer.resolution || 1;
    const t = this._t;
    t[0] = wt.a * r;
    t[1] = wt.c * r;
    t[2] = wt.b * r;
    t[3] = wt.d * r;
    t[4] = wt.tx * r;
    t[5] = wt.ty * r;

    this.ssRenderer.render(ip, player.resourceManager, t);

    // --- MZ Effekseer-style: restore Pixi's cached GL state ---
    renderer.texture.reset();
    renderer.geometry.reset();
    renderer.state.reset();
    renderer.shader.reset();
    renderer.framebuffer.reset();
  }

  public destroy(): void {
    this.ssRenderer?.destroy();
    this.ssRenderer = null;
    super.destroy();
  }
}

let _registered = false;

/**
 * Register SSPlayerRenderer as the 'ssplayer' ObjectRenderer plugin. Idempotent.
 * Call this at plugin load (before MZ creates its Renderer) so the plugin is
 * instantiated with the renderer; if the renderer already exists, attach to it
 * directly so late construction still works.
 */
export function registerSSPlayerRenderer(): void {
  const PIXInow = getPIXI();
  if (!PIXInow) return;
  if (!_registered) {
    PIXInow.Renderer.registerPlugin(SSPLAYER_PLUGIN_NAME, SSPlayerRenderer as any);
    _registered = true;
  }
  // Attach to an already-created renderer (SSPlayer constructed after boot).
  const r = getMZRenderer();
  if (r && !r.plugins[SSPLAYER_PLUGIN_NAME]) {
    r.plugins[SSPLAYER_PLUGIN_NAME] = new SSPlayerRenderer(r as unknown as Renderer);
  }
}
