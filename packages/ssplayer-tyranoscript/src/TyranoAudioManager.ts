import type { IAudioManager, SoundAsset, SSPlayer, Unsubscribe } from '@spritestudio/ssplayer-webgl';

// SS audio routed through TyranoScript's bundled **howler.js** (`window.Howl`),
// §3.4. The SS runtime plays no sound itself: it emits `onAudio` events (sound
// name + loop count) and the host plays them. We use howler directly rather
// than `[playse]` because a KAG tag would try to advance the scenario
// (`nextOrder`) — playing straight through howler can never disturb scenario
// flow, and howler is always present in a TyranoScript project.
//
// Sound files live in the Tyrano project (default `data/sound/`); an SS sound
// name maps to `data/<dir>/<name>.<ext>` unless a custom `resolve` is given.

/** Minimal shape of the howler `Howl` we use (avoids a howler dependency). */
interface HowlLike {
  play(): number;
  stop(): HowlLike;
  loop(v: boolean): HowlLike;
  volume(v: number): HowlLike;
  unload(): void;
}
interface HowlCtor {
  new (opts: { src: string[]; loop?: boolean; volume?: number; html5?: boolean }): HowlLike;
}

export interface TyranoAudioOptions {
  /** Folder under `data/` holding the sound files. Default `'sound'`. */
  dir?: string;
  /** Extension appended when the SS sound name has none. Default `'ogg'`. */
  ext?: string;
  /** Master volume (0..1) applied to SS-triggered sounds. Default `1`. */
  volume?: number;
  /** Map an SS sound name to a URL. Overrides `dir`/`ext` when provided. */
  resolve?: (name: string) => string;
}

export class TyranoAudioManager implements IAudioManager {
  private readonly howls = new Map<string, HowlLike>();

  constructor(private readonly opts: TyranoAudioOptions = {}) {}

  /** Resolve an SS sound name to a fetchable URL (Tyrano `data/sound/` by default). */
  private urlFor(name: string): string {
    if (this.opts.resolve) return this.opts.resolve(name);
    const file = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${this.opts.ext ?? 'ogg'}`;
    return `data/${this.opts.dir ?? 'sound'}/${file}`;
  }

  private howlFor(url: string): HowlLike | null {
    const Howl = (globalThis as { Howl?: HowlCtor }).Howl;
    if (!Howl) {
      console.warn('[TyranoAudioManager] window.Howl (howler.js) not found — is this running inside TyranoScript?');
      return null;
    }
    let h = this.howls.get(url);
    if (!h) {
      h = new Howl({ src: [url], volume: this.opts.volume ?? 1 });
      this.howls.set(url, h);
    }
    return h;
  }

  /**
   * Preload the animation's sounds (called by the core on `setAnimation` while an
   * audio manager is attached). howler lazily loads on construction, so we just
   * build a `Howl` per sound; playback later reuses it without a fetch stall.
   */
  async preload(sounds: SoundAsset[]): Promise<void> {
    for (const s of sounds) this.howlFor(this.urlFor(s.name));
  }

  /** Play one SS sound. `loopNum` 0 or >1 loops (SS convention); 1 plays once. */
  play(name: string, loopNum = 1): void {
    const h = this.howlFor(this.urlFor(name));
    if (!h) return;
    h.loop(loopNum === 0 || loopNum > 1);
    h.play();
  }

  release(names: string[]): void {
    for (const name of names) {
      const url = this.urlFor(name);
      this.howls.get(url)?.unload();
      this.howls.delete(url);
    }
  }

  releaseAll(): void {
    for (const h of this.howls.values()) h.unload();
    this.howls.clear();
  }

  stopAll(): void {
    for (const h of this.howls.values()) h.stop();
  }

  /**
   * Attach to a player: set it as the player's audio manager (so `setAnimation`
   * preloads through us) and play each `onAudio` event. Returns the `onAudio`
   * unsubscribe. Call BEFORE `setAnimation`.
   *
   * Sounds only while the playhead walks **forwards**: SpriteStudio has no
   * reverse audio (SDK: 10_introduction/20_limitations). The player reports
   * every key it crosses either way — the gate belongs here, on the playing.
   */
  bindToPlayer(player: SSPlayer): Unsubscribe {
    player.audioManager = this;
    return player.onAudio((e) => {
      if (e.soundName && player.isPlayingForward) this.play(e.soundName, e.loopNum);
    });
  }
}
