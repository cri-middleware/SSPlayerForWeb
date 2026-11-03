// RMMZAudioManager — satisfies ssplayer-core's IAudioManager by routing SS
// sound events to RPG Maker MZ's AudioManager. The core never plays
// audio itself; it emits SSAudioEvents which we forward here (via bindToPlayer).
//
// SS sounds are MZ SE (audio/se/), started through `AudioManager.playSe` so the
// game's SE volume, other plugins' patches and the game's own "Stop SE" all
// reach them. MZ SE are one-shot and `playSe` returns nothing, so the manager
// picks the buffer MZ just made off `AudioManager._seBuffers`, MZ's list of the
// SE it is playing. Holding it is what lets a sound play `loopNum` times, and
// lets a player's teardown stop its own sounds rather than every SE in the game.

import type { IAudioManager, SoundAsset } from '@spritestudio/ssplayer-webgl';
import type { SSPlayer, SSAudioEvent, Unsubscribe } from '../SSPlayer.js';

interface RMMZAudioBufferSpec {
  name: string;
  volume: number;
  pitch: number;
  pan: number;
  pos?: number;
}
/** The part of MZ's `WebAudio` we use. */
interface RMMZWebAudio {
  name?: string;
  play(loop: boolean): void;
  /** Loaded and not destroyed. */
  isReady(): boolean;
  /** Called once, when the sound ends or is stopped or destroyed. */
  addStopListener(listener: () => void): void;
  destroy(): void;
}
interface RMMZAudioManagerGlobal {
  playSe(se: RMMZAudioBufferSpec): void;
  loadStaticSe?(se: RMMZAudioBufferSpec): void;
  updateSeParameters?(buffer: RMMZWebAudio, se: RMMZAudioBufferSpec): void;
  _seBuffers?: RMMZWebAudio[];
}

function mzAudio(): RMMZAudioManagerGlobal | null {
  return (globalThis as any).AudioManager ?? null;
}

/**
 * Play `se` the way the game plays one and return the buffer MZ made for it, or
 * null when MZ did not start one: it skips a sound already started this frame,
 * and a plugin may have replaced the SE path altogether.
 */
function playSe(am: RMMZAudioManagerGlobal, se: RMMZAudioBufferSpec): RMMZWebAudio | null {
  const newest = (): RMMZWebAudio | undefined => am._seBuffers?.[am._seBuffers.length - 1];
  const before = newest();
  am.playSe(se);
  const after = newest();
  return after && after !== before && after.name === se.name ? after : null;
}

export interface RMMZAudioOptions {
  /** Default SE volume (0..100). Default 90. */
  volume?: number;
  /** Default SE pitch (50..150). Default 100. */
  pitch?: number;
  /** Default SE pan (-100..100). Default 0. */
  pan?: number;
}

export class RMMZAudioManager implements IAudioManager {
  /** The sounds this manager started that have not ended yet. */
  private readonly playing = new Set<RMMZWebAudio>();

  constructor(private readonly opts: RMMZAudioOptions = {}) {}

  private spec(name: string): RMMZAudioBufferSpec {
    return {
      name,
      volume: this.opts.volume ?? 90,
      pitch: this.opts.pitch ?? 100,
      pan: this.opts.pan ?? 0,
    };
  }

  /** Preload each SE so the first play doesn't stall (MZ caches static SE). */
  public async preload(sounds: SoundAsset[]): Promise<void> {
    const am = mzAudio();
    if (!am?.loadStaticSe) return;
    for (const s of sounds) am.loadStaticSe(this.spec(s.name));
  }

  /**
   * Play one SE `loopNum` times. Despite its name, `loopNum` is a play count,
   * 1 or more: SpriteStudio audio has no infinite loop, so every sound ends on
   * its own. Each further play starts when the previous one ends.
   */
  public play(name: string, loopNum = 1): void {
    const am = mzAudio();
    if (!am || !name) return;
    const buffer = playSe(am, this.spec(name));
    if (!buffer) return;
    this.playing.add(buffer);
    let more = Math.max(1, loopNum) - 1;
    const onStop = (): void => {
      // MZ calls this for an ending and for a destroy alike — the game's
      // "Stop SE", a scene change, stopAll() below. Only a destroy empties the
      // buffer, and only after this returns, so look once it has.
      queueMicrotask(() => {
        if (more > 0 && buffer.isReady()) {
          more -= 1;
          am.updateSeParameters?.(buffer, this.spec(name));
          buffer.play(false);
          buffer.addStopListener(onStop);
        } else {
          this.playing.delete(buffer);
        }
      });
    };
    buffer.addStopListener(onStop);
  }

  /**
   * Stop the sounds this manager started. Every other SE — the game's, another
   * player's — keeps playing.
   */
  public stopAll(): void {
    for (const buffer of this.playing) buffer.destroy();
    this.playing.clear();
  }

  /**
   * Attach to `player`: set it as the player's audioManager (so setAnimation
   * preloads through us) and play each onAudio event. Call BEFORE setAnimation.
   *
   * Sounds only while the playhead walks **forwards**: SpriteStudio has no
   * reverse audio. The player reports
   * every key it crosses either way — the gate belongs here, on the playing.
   * Nor does a key on the frame a seek landed on: the playhead did not cross it.
   */
  public bindToPlayer(player: SSPlayer): Unsubscribe {
    player.audioManager = this;
    return player.onAudio((e: SSAudioEvent) => {
      if (e.soundName && player.isPlayingForward && !player.isSeekLanding(e.frameNo)) this.play(e.soundName, e.loopNum);
    });
  }
}
