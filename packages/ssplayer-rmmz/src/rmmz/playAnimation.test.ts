import { describe, expect, it, vi } from 'vitest';
import { playAnimation } from './playAnimation.js';
import type { SSPlayer } from '../SSPlayer.js';

/**
 * A `transition` above 0 crossfades and leaves the picture playing; anything
 * else cuts as setAnimation does. Whether another animation was set up is what
 * tells a caller that the runtime dropped the non-Permanent overrides and the
 * tracks.
 *
 * The player is a stub that records the calls in order.
 */
function stubPlayer(clockPlaying = true) {
  const calls: string[] = [];
  const player = {
    currentAnimation: 'walk',
    getAnimationNames: () => ['walk', 'attack1'],
    setAnimation(name: string) {
      calls.push(`setAnimation ${name}`);
      this.currentAnimation = name;
    },
    crossfade: (track: number, name: string, ms: number) => calls.push(`crossfade ${track} ${name} ${ms}`),
    set loopCount(n: number) { calls.push(`loopCount ${n}`); },
    play: () => calls.push('play'),
    resume: () => calls.push('resume'),
    internalPlayer: { runtimeManager: { context: { is_clock_playing: vi.fn(() => clockPlaying) } } },
  };
  return { player: player as unknown as SSPlayer, calls };
}

describe('playAnimation', () => {
  it('cuts at a transition of 0', () => {
    const { player, calls } = stubPlayer();
    expect(playAnimation(player, 'attack1', 1, 0)).toBe(true);
    expect(calls).toEqual(['setAnimation attack1', 'loopCount 1', 'play']);
  });

  it('reports no setup for a cut to the animation already set up', () => {
    const { player } = stubPlayer();
    expect(playAnimation(player, 'walk', -1, 0)).toBe(false);
  });

  it('crossfades above 0, and lifts a hold rather than restarting a running clock', () => {
    const { player, calls } = stubPlayer(true);
    expect(playAnimation(player, 'attack1', -1, 300)).toBe(false);
    expect(calls).toEqual(['crossfade 0 attack1 300', 'loopCount -1', 'resume']);
  });

  it('starts a stopped clock after a crossfade', () => {
    const { player, calls } = stubPlayer(false);
    expect(playAnimation(player, 'attack1', -1, 300)).toBe(false);
    expect(calls).toEqual(['crossfade 0 attack1 300', 'loopCount -1', 'play']);
  });

  it('cuts to an unknown name, so the fallback to the first animation applies', () => {
    const { player, calls } = stubPlayer();
    expect(playAnimation(player, 'missing', -1, 300)).toBe(true);
    expect(calls[0]).toBe('setAnimation missing');
  });
});
