import type { IAudioManager, SoundAsset, SSPlayer, Unsubscribe } from '@spritestudio/ssplayer-webgl';
import { resolveDataPath } from './storagePath.js';

// SS audio routed through TyranoScript's bundled **howler.js** (`window.Howl`).
// The SS runtime plays no sound itself: it emits `onAudio` events (sound
// name + loop count) and the host plays them. We use howler directly rather
// than `[playse]` because a KAG tag would try to advance the scenario
// (`nextOrder`) — playing straight through howler can never disturb scenario
// flow, and howler is always present in a TyranoScript project.
//
// Sound files live in the Tyrano project (default `data/sound/`); an SS sound
// name maps to `<dir>/<name>.<ext>` under `data/`, resolved the way every other
// path in this adapter is, unless a custom `resolve` is given.
//
// One manager per player. The player's own teardown calls `stopAll()` on its
// manager, which is right for its sounds and wrong for anyone else's — with a
// shared manager, `[ss_free]` on one character would silence every other one.

/** The engine's SE volume (0..1), read the way `[playse]` reads it. */
function engineSeVolume(): number {
  const g = globalThis as {
    TYRANO?: { kag?: { config?: Record<string, unknown> } };
    $?: { parseVolume?: (volume: unknown) => number };
  };
  const setting = g.TYRANO?.kag?.config?.defaultSeVolume;
  if (setting === undefined || setting === '') return 1;
  const volume = typeof g.$?.parseVolume === 'function' ? g.$.parseVolume(setting) : Number(setting) / 100;
  return Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1;
}

/** Minimal shape of the howler `Howl` we use (avoids a howler dependency). */
interface HowlLike {
  /** Start a new sound, or with an id, play that one again. Returns the id. */
  play(id?: number): number;
  stop(): HowlLike;
  volume(v: number): HowlLike;
  on(event: 'end', listener: () => void, id?: number): HowlLike;
  /** Without a listener, drops every `end` listener. */
  off(event: 'end', listener?: () => void, id?: number): HowlLike;
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
  /**
   * The game's SE volume (0..1), multiplied in when a sound starts and on
   * {@link TyranoAudioManager.refreshVolume}. Default: the engine's own
   * `config.defaultSeVolume` — what the config screen's slider sets through
   * `[seopt]`, and what `[playse]` plays at.
   */
  seVolume?: () => number;
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
    return resolveDataPath(`${this.opts.dir ?? 'sound'}/${file}`);
  }

  /** What a sound plays at right now: this manager's volume × the game's SE volume. */
  private currentVolume(): number {
    return (this.opts.volume ?? 1) * (this.opts.seVolume ?? engineSeVolume)();
  }

  private howlFor(url: string): HowlLike | null {
    const Howl = (globalThis as { Howl?: HowlCtor }).Howl;
    if (!Howl) {
      console.warn('[TyranoAudioManager] window.Howl (howler.js) not found — is this running inside TyranoScript?');
      return null;
    }
    let h = this.howls.get(url);
    if (!h) {
      h = new Howl({ src: [url], volume: this.currentVolume() });
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

  /**
   * Play one SS sound `loopNum` times. Despite its name, `loopNum` is a play
   * count, 1 or more: SpriteStudio audio has no infinite loop, so every sound
   * ends on its own. Each further play starts when the previous one ends.
   */
  play(name: string, loopNum = 1): void {
    const h = this.howlFor(this.urlFor(name));
    if (!h) return;
    h.volume(this.currentVolume());
    let more = Math.max(1, loopNum) - 1;
    const id = h.play();
    if (more === 0) return;
    const again = (): void => {
      if (more-- > 0) h.play(id);
      else h.off('end', again, id);
    };
    h.on('end', again, id);
  }

  /**
   * Re-apply the volume to every sound this manager holds — a looping one keeps
   * playing at whatever volume it started with otherwise. Call after the game's
   * SE volume changes.
   */
  refreshVolume(): void {
    const volume = this.currentVolume();
    for (const h of this.howls.values()) h.volume(volume);
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

  /** Stop every sound this manager is playing, and the plays still due after them. */
  stopAll(): void {
    for (const h of this.howls.values()) h.off('end').stop();
  }

  /**
   * Attach to a player: set it as the player's audio manager (so `setAnimation`
   * preloads through us) and play each `onAudio` event. Returns the `onAudio`
   * unsubscribe. Call BEFORE `setAnimation`.
   *
   * Sounds only while the playhead walks **forwards**: SpriteStudio has no
   * reverse audio. The player reports
   * every key it crosses either way — the gate belongs here, on the playing.
   */
  bindToPlayer(player: SSPlayer): Unsubscribe {
    player.audioManager = this;
    return player.onAudio((e) => {
      if (e.soundName && player.isPlayingForward) this.play(e.soundName, e.loopNum);
    });
  }
}
