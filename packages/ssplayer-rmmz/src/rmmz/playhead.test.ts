import { describe, expect, it } from 'vitest';
import { applyPlayhead, readPlayhead } from './playhead.js';
import type { SSPlayer } from '../SSPlayer.js';

function stubPlayer(state: Partial<{ isPlaying: boolean; isPausing: boolean; isFinished: boolean }> = {}) {
  const calls: string[] = [];
  const player = {
    currentAnimation: 'wait',
    isPlaying: true,
    isPausing: false,
    isFinished: false,
    ...state,
    get frameNo() {
      return 12.5;
    },
    set frameNo(n: number) {
      calls.push(`frameNo ${n}`);
    },
    pause: () => calls.push('pause'),
    stop: () => calls.push('stop'),
  };
  return { player: player as unknown as SSPlayer, calls };
}

describe('readPlayhead', () => {
  it('reads a running player as playing, with its animation and frame', () => {
    const { player } = stubPlayer();
    expect(readPlayhead(player)).toEqual({ animation: 'wait', frame: 12.5, state: 'playing' });
  });

  it('reads a paused or stopped player as paused', () => {
    expect(readPlayhead(stubPlayer({ isPausing: true }).player).state).toBe('paused');
    expect(readPlayhead(stubPlayer({ isPlaying: false }).player).state).toBe('paused');
  });

  it('reads a finished run as ended', () => {
    expect(readPlayhead(stubPlayer({ isPlaying: false, isFinished: true }).player).state).toBe('ended');
  });

  it('keeps a restored finished run ended until it plays again', () => {
    expect(readPlayhead(stubPlayer({ isPlaying: false }).player, true).state).toBe('ended');
    expect(readPlayhead(stubPlayer().player, true).state).toBe('playing');
  });
});

describe('applyPlayhead', () => {
  it('seeks a playing run without stopping it', () => {
    const { player, calls } = stubPlayer();
    expect(applyPlayhead(player, { animation: 'wait', frame: 30, state: 'playing' })).toBe(true);
    expect(calls).toEqual(['frameNo 30']);
  });

  it('holds a paused run before seeking, since starting rewinds', () => {
    const { player, calls } = stubPlayer();
    applyPlayhead(player, { animation: 'wait', frame: 30, state: 'paused' });
    expect(calls).toEqual(['pause', 'frameNo 30']);
  });

  it('stops a finished run on the frame it ended on', () => {
    const { player, calls } = stubPlayer();
    applyPlayhead(player, { animation: 'wait', frame: 59, state: 'ended' });
    expect(calls).toEqual(['stop', 'frameNo 59']);
  });

  it('leaves a player set up with another animation alone', () => {
    const { player, calls } = stubPlayer();
    expect(applyPlayhead(player, { animation: 'attack1', frame: 30, state: 'paused' })).toBe(false);
    expect(calls).toEqual([]);
  });
});
