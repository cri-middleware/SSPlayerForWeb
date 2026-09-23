// RMMZAudioManager — satisfies ssplayer-core's IAudioManager by routing SS
// sound events to RPG Maker MZ's AudioManager (spec §7.4). The core never plays
// audio itself; it emits SSAudioEvents which we forward here (via bindToPlayer).
//
// SS sounds are treated as MZ SE (audio/se/). Note: MZ SE are one-shot — the SS
// `loopNum` (looping SE) is not natively supported by AudioManager.playSe and is
// ignored in v1 (a later phase can route looped sounds to a channel we own).

import type { IAudioManager, SoundAsset } from '@spritestudio/ssplayer-webgl';
import type { SSPlayer, SSAudioEvent, Unsubscribe } from '../SSPlayer.js';

interface RMMZAudioBufferSpec {
  name: string;
  volume: number;
  pitch: number;
  pan: number;
  pos?: number;
}
interface RMMZAudioManagerGlobal {
  playSe(se: RMMZAudioBufferSpec): void;
  loadStaticSe?(se: RMMZAudioBufferSpec): void;
  stopSe?(): void;
}

function mzAudio(): RMMZAudioManagerGlobal | null {
  return (globalThis as any).AudioManager ?? null;
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

  /** Play one SE by name. `loopNum` is ignored in v1 (see file header). */
  public play(name: string, _loopNum = 1): void {
    const am = mzAudio();
    if (am && name) am.playSe(this.spec(name));
  }

  public stopAll(): void {
    mzAudio()?.stopSe?.();
  }

  /**
   * Attach to `player`: set it as the player's audioManager (so setAnimation
   * preloads through us) and play each onAudio event. Call BEFORE setAnimation.
   *
   * Sounds only while the playhead walks **forwards**: SpriteStudio has no
   * reverse audio. The player reports
   * every key it crosses either way — the gate belongs here, on the playing.
   */
  public bindToPlayer(player: SSPlayer): Unsubscribe {
    player.audioManager = this;
    return player.onAudio((e: SSAudioEvent) => {
      if (e.soundName && player.isPlayingForward) this.play(e.soundName, e.loopNum);
    });
  }
}
