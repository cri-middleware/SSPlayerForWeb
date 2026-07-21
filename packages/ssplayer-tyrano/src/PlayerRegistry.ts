import type { SSCanvasPlayer, SSPartOverride } from '@spritestudio/ssplayer-webgl';

/**
 * A live SS player mounted into a Tyrano layer. The `meta` block is everything
 * needed to reconstruct the player on save/load (§3.3) — kept here so the
 * SaveLoadBridge (PT2) can serialise a registry snapshot without reaching into
 * the player internals.
 */
export interface SSPlayerEntry {
  player: SSCanvasPlayer;
  canvas: HTMLCanvasElement;
  /**
   * `drawingBuffer px / logical px` used to build this player's transform.
   * Kept so `[ss_pos]` / `[ss_move]` can re-map logical coords the same way
   * `[ss_new]` did (see LayerCanvas.toTransform).
   */
  bufferScale: number;
  /** Active `[ss_move]` RAF handle, if a tween is running (0 = none). */
  tween?: number;
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
     * Per-part overrides set by the `[ss_part_*]` tags. The runtime keeps its
     * own table on the WASM context, which `[ss_restore]` rebuilds from
     * scratch — so the list is mirrored here to be re-applied then.
     */
    overrides?: SSPartOverride[];
  };
}

/**
 * `name -> SSCanvasPlayer` map held in module scope, mirroring how TyranoScript
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
    entry.player.destroy();
    entry.canvas.remove();
    this.entries.delete(name);
  }

  /** Tear down every player (scene transition / layer clear — §3.3). */
  destroyAll(): void {
    for (const name of this.names()) this.destroy(name);
  }
}
