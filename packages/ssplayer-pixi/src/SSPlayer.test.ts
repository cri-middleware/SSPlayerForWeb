import { describe, expect, it, vi } from 'vitest';
import type { Texture } from 'pixi.js';
import { SSPlayer } from './SSPlayer.js';

/**
 * A texture swap changes the output without changing the frame number, and the
 * ticker early-returns while stopped — so the swap itself has to repaint, the
 * same as a part override does.
 *
 * The player is built without its constructor: only the playback state and the
 * render hook matter here, not a GL context or a loaded `.ssab`.
 */
function stubPlayer(isPlaying: boolean) {
  const player = Object.create(SSPlayer.prototype) as SSPlayer;
  const renderFrame = vi.fn();
  Object.assign(player, {
    internalPlayer: { isPlaying, isTicking: isPlaying, getDrawFrame: () => 7, setCellmapTexture: vi.fn() },
    renderFrame,
  });
  return { player, renderFrame };
}

describe('setCellmapTexture', () => {
  const texture = {} as Texture;

  it('re-renders the current frame when the player is stopped', () => {
    const { player, renderFrame } = stubPlayer(false);

    player.setCellmapTexture('common', texture);

    expect(renderFrame).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('re-renders the current frame when a swap is cleared while stopped', () => {
    const { player, renderFrame } = stubPlayer(false);

    player.setCellmapTexture('common', null);

    expect(renderFrame).toHaveBeenCalledExactlyOnceWith(7);
  });

  it('leaves the repaint to the next tick while playing', () => {
    const { player, renderFrame } = stubPlayer(true);

    player.setCellmapTexture('common', texture);

    expect(renderFrame).not.toHaveBeenCalled();
  });
});
