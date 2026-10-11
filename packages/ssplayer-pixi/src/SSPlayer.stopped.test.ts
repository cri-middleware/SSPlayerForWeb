import { describe, expect, it, vi } from 'vitest';
import { SSPlayer } from './SSPlayer.js';

/**
 * A stopped player does not rebuild its drawing every tick, since nothing
 * advances. It still has to repaint when what it draws from changes without
 * playback: a seek, another animation, a flip or an offset. Missing one leaves
 * the old frame on screen while ssplayer-webgl, which draws every frame, shows
 * the new one.
 *
 * The player is built without its constructor, and its frame data comes back
 * empty, so a repaint is counted where it asks the runtime for the frame.
 */
function stoppedPlayer() {
  const state = { frame: 3, animation: 'walk', affine: null as Float32Array | null };
  const getFrameData = vi.fn(() => null);
  const player = Object.create(SSPlayer.prototype) as SSPlayer;
  Object.assign(player, {
    internalPlayer: {
      isPlaying: false,
      getDrawFrame: () => state.frame,
      get currentAnimation() { return state.animation; },
      getRootAffine: () => state.affine,
      runtimeManager: { getFrameData },
    },
    renderer: null,
    maskEnabled: true,
    _drawnFrame: NaN,
    _drawnAnimation: '',
    _drawnAffine: new Float32Array(6),
    _drawnAffineActive: false,
    _drawnMaskEnabled: true,
    _drawnWithRenderer: false,
  });
  // update() is the ticker callback.
  const tick = () => (player as unknown as { update(t: { deltaMS: number }): void }).update({ deltaMS: 16 });
  return { player, state, getFrameData, tick };
}

describe('a stopped player', () => {
  it('draws its current frame once and then leaves it', () => {
    const { getFrameData, tick } = stoppedPlayer();
    tick();
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('repaints after a seek', () => {
    const { state, getFrameData, tick } = stoppedPlayer();
    tick();
    state.frame = 10;
    tick();
    expect(getFrameData).toHaveBeenLastCalledWith(10);
    expect(getFrameData).toHaveBeenCalledTimes(2);
  });

  it('repaints after switching animation', () => {
    const { state, getFrameData, tick } = stoppedPlayer();
    tick();
    state.animation = 'jump';
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(2);
  });

  it('repaints after a flip or an offset, and after either is undone', () => {
    const { state, getFrameData, tick } = stoppedPlayer();
    tick();
    state.affine = new Float32Array([-1, 0, 0, 1, 0, 0]);
    tick();
    state.affine[4] = 200;
    tick();
    state.affine = null;
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(4);
  });

  it('repaints when masking is switched', () => {
    const { player, getFrameData, tick } = stoppedPlayer();
    tick();
    player.maskEnabled = false;
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(2);
  });
});
