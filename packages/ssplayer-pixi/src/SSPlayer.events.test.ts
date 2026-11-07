import { ListenerSet } from '@spritestudio/ssplayer-core';
import { describe, expect, it, vi } from 'vitest';
import { SSPlayer } from './SSPlayer.js';

/**
 * A listener that sets up another animation clears what the update reported in
 * the runtime, so the player reads it before telling anyone.
 *
 * The player is built without its constructor, so its listener sets are given here.
 */
describe('event listeners', () => {
  it('hear what the update reported though the first of them sets up an animation', () => {
    const order: string[] = [];
    const player = Object.create(SSPlayer.prototype) as SSPlayer;
    Object.assign(player, {
      internalPlayer: {
        pollPlaybackEvents: () => ({ looped: true, finished: true }),
        runtimeManager: {
          capturePassedEvents: () => {
            order.push('read');
            return [{ source: 3 }];
          },
          getPartName: () => 'part',
          getEventsOf: () => ({
            frameIndex: () => 5,
            usersLength: () => 1,
            users: () => ({
              partIndex: () => 0,
              value: () => ({ integer: () => null, str: () => 'key', rect: () => null, point: () => null }),
            }),
            signalsLength: () => 0,
            audiosLength: () => 0,
          }),
        },
      },
      _userDataListeners: new ListenerSet(),
      _signalListeners: new ListenerSet(),
      _audioListeners: new ListenerSet(),
      _animFinishedListeners: new ListenerSet(),
      _animLoopedListeners: new ListenerSet(),
    });
    player.onAnimationFinished(() => order.push('finished'));
    player.onAnimationLooped(() => order.push('looped'));
    player.onUserData((event) => order.push(`user data ${event.str} from ${event.source}`));

    (player as unknown as { pollEvents(): void }).pollEvents();

    expect(order).toEqual(['read', 'finished', 'looped', 'user data key from 3']);
  });

  it('stop the tick where one of them destroyed the player', () => {
    const player = Object.create(SSPlayer.prototype) as SSPlayer;
    const internalPlayer = {
      destroyed: false,
      isTicking: true,
      isHeld: false,
      isStackInMotion: false,
      update: vi.fn(),
      getFrameNo: vi.fn(),
      pollPlaybackEvents: () => ({ looped: true, finished: true }),
      runtimeManager: { capturePassedEvents: () => [] },
    };
    const looped = vi.fn();
    Object.assign(player, {
      internalPlayer,
      _userDataListeners: new ListenerSet(),
      _signalListeners: new ListenerSet(),
      _audioListeners: new ListenerSet(),
      _animFinishedListeners: new ListenerSet(),
      _animLoopedListeners: new ListenerSet(),
    });
    player.onAnimationFinished(() => { internalPlayer.destroyed = true; });
    player.onAnimationLooped(looped);

    (player as unknown as { update(ticker: { deltaMS: number }): void }).update({ deltaMS: 16 });

    expect(looped).not.toHaveBeenCalled();
    expect(internalPlayer.getFrameNo).not.toHaveBeenCalled();
  });
});
