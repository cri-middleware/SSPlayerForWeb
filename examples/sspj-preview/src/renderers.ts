// The renderers this page can play a pack through, behind one shape.
//
// ssplayer-webgl and ssplayer-pixi rasterise the same frames separately —
// blending, masking and the SpriteStudio shaders are each written twice, and
// PixiJS twice again for WebGPU and WebGL — so a project that looks right in
// one has not been checked in the others. What they share is the player's API:
// the page and the timeline drive every one of them through the same calls, and
// nothing outside this file and `pixiRenderer.ts` knows which one is running.
//
// Each mount brings its own <canvas>. A canvas keeps the first kind of context
// it hands out, so one that has held WebGL cannot give PixiJS WebGPU; a fresh
// canvas per switch sidesteps that.

import { SSSurface, type SSPlayer as WebGLPlayer } from '@spritestudio/ssplayer-webgl';

import type { TimelinePlayer } from './timeline.js';

export type RendererKind = 'webgl' | 'pixi-webgpu' | 'pixi-webgl';

/** What the page asks of a player on top of the timeline: loading and choosing. */
export type PreviewPlayer = TimelinePlayer &
  Pick<WebGLPlayer, 'load' | 'getAnimationNames' | 'setAnimation'> & {
    /**
     * Narrower than either renderer's, which disagree on what a texture may be.
     * The page never supplies one: every pack it converts carries its own.
     */
    loadBuffer(ssab: Uint8Array, textures: Map<number, never>): Promise<void>;
    readonly internalPlayer: Pick<WebGLPlayer['internalPlayer'], 'setInstancePackProvider'>;
  };

export interface MountedRenderer {
  readonly player: PreviewPlayer;
  /** What is actually drawing. PixiJS falls back from WebGPU to WebGL without saying so. */
  readonly backend: string;
  destroy(): void;
}

/**
 * The drawing buffer, the same for every renderer so a switch changes nothing
 * but the rasteriser. Fixed rather than following the window, as in the other
 * examples: the effect-heavy test projects are fill-rate bound.
 */
export const BUFFER = { width: 1280, height: 960, background: 0x1a1a2e } as const;

/** Put a renderer's canvas into `stage`, ahead of `before`, with one player on it. */
export async function mountRenderer(
  kind: RendererKind,
  stage: HTMLElement,
  before: Node | null,
): Promise<MountedRenderer> {
  if (kind === 'webgl') return mountWebGL(stage, before);
  // Fetched on first use: PixiJS is most of this page's weight otherwise, for a
  // renderer most visits never pick.
  const { mountPixi } = await import('./pixiRenderer.js');
  return mountPixi(kind === 'pixi-webgpu' ? 'webgpu' : 'webgl', stage, before);
}

async function mountWebGL(stage: HTMLElement, before: Node | null): Promise<MountedRenderer> {
  await SSSurface.initialize();
  const canvas = document.createElement('canvas');
  canvas.width = BUFFER.width;
  canvas.height = BUFFER.height;
  stage.insertBefore(canvas, before);

  const surface = new SSSurface(canvas, { autoStart: true, backgroundColor: BUFFER.background });
  return {
    // Centred in the canvas at scale 1, which is where a player sits until told
    // otherwise.
    player: surface.createPlayer(),
    backend:
      typeof WebGL2RenderingContext !== 'undefined' && surface.gl instanceof WebGL2RenderingContext
        ? 'WebGL 2'
        : 'WebGL 1',
    destroy: () => {
      surface.destroy();
      canvas.remove();
    },
  };
}
