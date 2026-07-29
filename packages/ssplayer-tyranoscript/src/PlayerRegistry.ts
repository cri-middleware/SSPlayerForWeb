import type { SSPlayer, SSSurface, SSPartOverride } from '@spritestudio/ssplayer-webgl';
import { cancelCanvasFade } from './LayerCanvas.js';

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
 * needed to reconstruct the player on save/load (§3.3) — kept here so the
 * SaveLoadBridge (PT2) can serialise a registry snapshot without reaching into
 * the player internals.
 */
export interface SSPlayerEntry {
  player: SSPlayer;
  /**
   * The surface backing this player. One surface per player today, i.e. one GL
   * context per `[ss_new]` — the consolidation to one surface per `(layer, page)`
   * is a separate change (SURFACE_PLAYER_SPEC.md §10).
   */
  surface: SSSurface;
  canvas: HTMLCanvasElement;
  /**
   * `drawingBuffer px / logical px` used to build this player's transform.
   * Kept so `[ss_pos]` / `[ss_move]` can re-map logical coords the same way
   * `[ss_new]` did (see LayerCanvas.toTransform).
   */
  bufferScale: number;
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
 * `name`; `[ss_free]` (PT2) removes it. Kept as a class (not a bare Map) so the
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

  /** Remove a single player: destroy its GL/WASM resources and detach the canvas. */
  destroy(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (entry.tween) cancelAnimationFrame(entry.tween);
    clearChain(entry);
    cancelCanvasFade(entry.canvas);
    // Destroying the surface destroys its players too, and it is the surface that
    // owns the GL context — so this is what actually releases the context.
    entry.surface.destroy();
    entry.canvas.remove();
    this.entries.delete(name);
  }

  /** Tear down every player (scene transition / layer clear — §3.3). */
  destroyAll(): void {
    for (const name of this.names()) this.destroy(name);
  }
}
