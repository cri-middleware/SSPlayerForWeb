import type {
  SSPlayer,
  SSOverlay,
  SSPartOverride,
  WebPlaybackDirection,
  WebPlaybackStyle,
} from '@spritestudio/ssplayer-webgl';
import { cancelElementFade } from './LayerCanvas.js';
import type { TyranoAudioManager } from './TyranoAudioManager.js';

/**
 * A queued follow-up animation armed by `[ss_play next=]` — the Spine plugin's
 * `next_motion` / `in_frame_next_motion`. Lets an author write "entrance, then
 * idle" WITHOUT blocking the scenario the way `[ss_wait]` does.
 */
export interface SSNextAnime {
  /** Animation to switch to once the current one ends (or reaches `atframe`). */
  anime: string;
  /** Loop count for the follow-up (`-1` infinite, matching `[ss_play loop=]`). */
  loop: number;
  /** Frame that triggers the switch early; omitted → wait for the end. */
  atframe?: number;
}

/** Playback heading set by `[ss_direction]`. */
export interface SSPlayback {
  direction: WebPlaybackDirection;
  style: WebPlaybackStyle;
}

/**
 * Frame range set by `[ss_section]`. `-1` on either side means that edge of
 * the animation, which is how the runtime reads an out-of-range value.
 */
export interface SSSection {
  start: number;
  end: number;
}

/**
 * A speaker binding made by `[ss_chara]` — the Live2D plugin's `jname` + `lip`.
 * While the bound character is the one talking, the player shows `talk`; when
 * the text finishes it goes back to `idle`.
 */
export interface SSCharaBinding {
  /** Speaker to match: a `#name` display name or a Tyrano chara id. */
  jname: string;
  /** Animation played while this character's text is being typed out. */
  talk: string;
  /** Animation to return to afterwards; empty → whatever the scenario last set. */
  idle: string;
}

/**
 * A live SS player mounted into a Tyrano layer. The `meta` block is everything
 * needed to reconstruct the player on save/load — kept here so the
 * SaveLoadBridge can serialise a registry snapshot without reaching into
 * the player internals.
 */
export interface SSPlayerEntry {
  player: SSPlayer;
  /**
   * The overlay drawing this player — one per `(layer, page)`, SHARED with every
   * other SS character on that layer. Never destroy it from here: that would
   * blank the whole layer.
   */
  overlay: SSOverlay;
  /**
   * The character's element. It draws nothing; the overlay reads its rect and
   * opacity. It exists so `[anim]` / `[kanim]` can still find the character by
   * its name class (see LayerCanvas).
   */
  element: HTMLElement;
  /**
   * This player's own audio manager, when audio is on. The player's teardown
   * stops its sounds; the registry unloads them.
   */
  audio?: TyranoAudioManager;
  /**
   * The game's logical width (`config.scWidth`), the denominator of the
   * buffer-scale conversion. The numerator — the overlay's drawing-buffer width
   * — is deliberately NOT cached: it changes whenever the window resizes, and a
   * ratio captured at `[ss_new]` left later `[ss_pos]` / `[ss_move]` placing
   * against a canvas that no longer existed.
   */
  logicalWidth: number;
  /** Active `[ss_move]` RAF handle, if a tween is running (0 = none). */
  tween?: number;
  /**
   * Unsubscribers for the player-event listeners arming `meta.next`. Held on
   * the entry (not captured in a closure) so a second `[ss_play]` — or
   * `[ss_free]` — can cancel a chain that has not fired yet.
   */
  chain?: Array<() => void>;
  meta: {
    name: string;
    storage: string;
    anime: string;
    layer: string;
    page: string;
    x: number;
    y: number;
    scale: number;
    loop: number;
    /**
     * Whether the canvas is currently shown. `[ss_new visible="false"]` loads a
     * player without displaying it (preload); `[ss_show]` / `[ss_hide]` flip it.
     */
    visible: boolean;
    /** Stacking order within the layer (`[ss_new]` / `[ss_pos]` `zindex=`). */
    zindex?: number;
    /** Pending `[ss_play next=]` follow-up, if one is armed. */
    next?: SSNextAnime;
    /** Speaker binding from `[ss_chara]`, if one is set. */
    chara?: SSCharaBinding;
    /**
     * Per-part overrides set by the `[ss_part_*]` tags. The runtime keeps its
     * own table on the WASM context, which `[ss_restore]` rebuilds from
     * scratch — so the list is mirrored here to be re-applied then.
     */
    overrides?: SSPartOverride[];
    /** `[ss_speed]`; absent means as authored. The runtime keeps it across animation changes. */
    speed?: number;
    /** `[ss_direction]`; absent means forward, once through. Kept across animation changes too. */
    playback?: SSPlayback;
    /**
     * `[ss_section]`. Unlike speed and direction, the runtime drops it on an
     * animation change — a frame number means nothing in another animation —
     * so every path that switches animations drops it here as well.
     */
    section?: SSSection;
  };
}

/**
 * Drop the listeners arming `entry.meta.next`. Call before starting new
 * playback (the old follow-up is no longer wanted) and on teardown.
 */
export function clearChain(entry: SSPlayerEntry): void {
  if (!entry.chain) return;
  for (const off of entry.chain) off();
  entry.chain = undefined;
}

/**
 * `name -> SSPlayer` map held in module scope, mirroring how TyranoScript
 * tracks `[chara]` actors. Every `[ss_*]` tag looks the target up here by
 * `name`; `[ss_free]` removes it. Kept as a class (not a bare Map) so the
 * save/load bridge and teardown can share one clear ownership point.
 */
export class PlayerRegistry {
  private readonly entries = new Map<string, SSPlayerEntry>();

  set(entry: SSPlayerEntry): void {
    // Replacing an existing name would orphan its GL context — callers should
    // `[ss_free]` first. Guard so a duplicate `[ss_new]` doesn't leak silently.
    const prev = this.entries.get(entry.meta.name);
    if (prev) {
      console.warn(
        `[ss] player "${entry.meta.name}" already exists; freeing the old one before replacing.`,
      );
      this.destroy(entry.meta.name);
    }
    this.entries.set(entry.meta.name, entry);
  }

  get(name: string): SSPlayerEntry | undefined {
    return this.entries.get(name);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Remove a single player: free its WASM/GL resources and drop its element. */
  destroy(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (entry.tween) cancelAnimationFrame(entry.tween);
    clearChain(entry);
    cancelElementFade(entry.element);
    // Detach before destroy so the overlay stops tracking a dead player, then
    // free only what this player owns. The overlay, its canvas and its GL context
    // belong to the layer and outlive every character on it.
    entry.overlay.detach(entry.player);
    entry.player.destroy();
    entry.audio?.releaseAll();
    entry.element.remove();
    this.entries.delete(name);
  }

  /** Tear down every player (scene transition / layer clear). */
  destroyAll(): void {
    for (const name of this.names()) this.destroy(name);
  }
}
