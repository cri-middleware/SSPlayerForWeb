import { describe, expect, it, vi } from 'vitest';
import { SSPlayer } from './SSPlayer.js';

/**
 * A ticking player rebuilds its drawing only when the tick changed it: the drawn
 * frame moved, the track stack moved the pose, a child moved, or a command left
 * a change for the tick to draw. Anything else re-uploads every mesh for the
 * frame already on screen — through a pause, and on the ticks between two
 * frames while subFrameEnabled is off.
 *
 * The player is built without its constructor, and its frame data comes back
 * empty, so a repaint is counted where it asks the runtime for the frame.
 */
function tickingPlayer() {
  const state = { frame: 3, held: false, stackInMotion: false, childrenMoved: false, stackStopsOnUpdate: false };
  const getFrameData = vi.fn(() => null);
  const player = Object.create(SSPlayer.prototype) as SSPlayer;
  Object.assign(player, {
    internalPlayer: {
      isTicking: true,
      get isHeld() { return state.held; },
      get isStackInMotion() { return state.stackInMotion; },
      get childrenMoved() { return state.childrenMoved; },
      update: () => { if (state.stackStopsOnUpdate) state.stackInMotion = false; },
      getFrameNo: () => state.frame,
      getDrawFrame: () => state.frame,
      currentAnimation: 'walk',
      getRootAffine: () => null,
      setPartColorOverride: () => true,
      runtimeManager: { getFrameData },
    },
    pollEvents: vi.fn(),
    debugText: { visible: false },
    _frameListeners: { size: 0 },
    renderer: null,
    maskEnabled: true,
    _drawnFrame: NaN,
    _drawnAnimation: '',
    _drawnAffine: new Float32Array(6),
    _drawnAffineActive: false,
    _drawnMaskEnabled: true,
    _drawnWithRenderer: false,
    _redrawPending: false,
  });
  // update() is the ticker callback.
  const tick = () => (player as unknown as { update(t: { deltaMS: number }): void }).update({ deltaMS: 16 });
  return { player, state, getFrameData, tick };
}

describe('a ticking player', () => {
  it('draws a frame once while it stays the drawn frame', () => {
    const { state, getFrameData, tick } = tickingPlayer();
    tick();
    tick();
    state.frame = 4;
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(2);
  });

  it('redraws every tick while the track stack moves the pose', () => {
    const { state, getFrameData, tick } = tickingPlayer();
    state.stackInMotion = true;
    tick();
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(3);
  });

  it('draws the tick a fade ends on, then stops', () => {
    const { state, getFrameData, tick } = tickingPlayer();
    tick();
    state.stackInMotion = true;
    state.stackStopsOnUpdate = true;
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(2);
  });

  it('keeps its drawing through a pause, though the stack is mid-fade', () => {
    const { state, getFrameData, tick } = tickingPlayer();
    tick();
    state.held = true;
    state.stackInMotion = true;
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(1);
  });

  it('redraws while a child moves, paused or not', () => {
    const { state, getFrameData, tick } = tickingPlayer();
    tick();
    state.held = true;
    state.childrenMoved = true;
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(3);
  });

  it('draws an override taken mid-tick on the next tick, once', () => {
    const { player, getFrameData, tick } = tickingPlayer();
    tick();
    player.setPartColorOverride(0, [1, 0, 0, 1]);
    expect(getFrameData).toHaveBeenCalledTimes(1);
    tick();
    tick();
    expect(getFrameData).toHaveBeenCalledTimes(2);
  });
});
