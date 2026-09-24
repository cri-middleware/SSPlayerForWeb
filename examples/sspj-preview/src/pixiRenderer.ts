// The PixiJS half of `renderers.ts`, in a module of its own so the page only
// fetches PixiJS when the reader picks it.

import { SSPlayer } from '@spritestudio/ssplayer-pixi';
import { Application } from 'pixi.js';

import { BUFFER, type MountedRenderer } from './renderers.js';

export async function mountPixi(
  preference: 'webgpu' | 'webgl',
  stage: HTMLElement,
  before: Node | null,
): Promise<MountedRenderer> {
  await SSPlayer.initialize();
  const app = new Application();
  await app.init({
    width: BUFFER.width,
    height: BUFFER.height,
    backgroundColor: BUFFER.background,
    preference,
  });
  stage.insertBefore(app.canvas, before);

  const player = new SSPlayer();
  // Before the first draw, or the parts a mask clips are held back for one
  // frame while the player waits to learn its renderer.
  player.attachRenderer(app.renderer);
  // Where ssplayer-webgl puts a player by default: origin at the centre, scale 1.
  player.position.set(app.screen.width / 2, app.screen.height / 2);
  app.stage.addChild(player);

  return {
    player,
    backend: app.renderer.name === 'webgpu' ? 'WebGPU' : 'WebGL',
    destroy: () => {
      // First, so it leaves the shared ticker before the stage goes.
      player.destroy();
      app.destroy({ removeView: true });
    },
  };
}
