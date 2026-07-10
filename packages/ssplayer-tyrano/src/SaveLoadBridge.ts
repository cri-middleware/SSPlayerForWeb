import type { PlayerRegistry } from './PlayerRegistry.js';
import type { TyranoKag } from './tyranoTypes.js';

// Save/load bridge. SS players live in the DOM + WASM, neither of which
// TyranoScript's save system captures — so on save we must mirror each player's
// reconstruction data into the SAVE TARGET (`stat`), and on load rebuild the
// live players from it (see the `[ss_restore]` tag, which the author places in
// `make.ks` — the special .ks TyranoScript `call`s on load). This mirrors the
// official Spine plugin's `stat.spine_models` + `[spine_restore]` pattern.
//
// We namespace under `stat.f` (the game-variable save target) with a
// `__`-prefixed key so it never collides with an author's own `f` variables.

/** Key under `TYRANO.kag.stat.f` holding the serialized player map. */
export const SAVE_KEY = '__ssplayers';

/**
 * A single player's reconstruction data. Everything needed to re-run an
 * `[ss_new]`-equivalent, plus whether it was playing. The exact frame is NOT
 * persisted (it changes every tick and `stat` is not a per-frame store) — on
 * restore, playing animations resume from the start, matching the Spine plugin
 * and typical VN expectations. Frame-precise restore is a future enhancement.
 */
export interface SavedPlayer {
  name: string;
  storage: string;
  anime: string;
  layer: string;
  page: string;
  x: number;
  y: number;
  scale: number;
  loop: number;
  playing: boolean;
}

function saveSlot(kag: TyranoKag): Record<string, SavedPlayer> {
  const stat = kag.stat as { f?: Record<string, unknown> };
  // `stat.f` is always present in a booted TyranoScript; guard for tests / early calls.
  if (!stat.f) stat.f = {};
  let slot = stat.f[SAVE_KEY] as Record<string, SavedPlayer> | undefined;
  if (!slot || typeof slot !== 'object') {
    slot = {};
    stat.f[SAVE_KEY] = slot;
  }
  return slot;
}

/**
 * Snapshot every live player from the registry into `stat.f.__ssplayers`. Call
 * this after any tag that creates, changes, or removes a player so a save taken
 * at any moment reflects the current scene (we can't hook TyranoScript's exact
 * save instant, so we keep the mirror continuously current — cheap: a handful
 * of plain objects, not per-frame data).
 */
export function persistPlayers(kag: TyranoKag, registry: PlayerRegistry): void {
  const slot: Record<string, SavedPlayer> = {};
  for (const name of registry.names()) {
    const entry = registry.get(name);
    if (!entry) continue;
    const { meta, player } = entry;
    slot[name] = {
      name: meta.name,
      storage: meta.storage,
      anime: meta.anime,
      layer: meta.layer,
      page: meta.page,
      x: meta.x,
      y: meta.y,
      scale: meta.scale,
      loop: meta.loop,
      playing: player.isPlaying,
    };
  }
  const stat = kag.stat as { f?: Record<string, unknown> };
  if (!stat.f) stat.f = {};
  stat.f[SAVE_KEY] = slot;
}

/** Read the persisted player map restored by TyranoScript's load (empty if none). */
export function readSavedPlayers(kag: TyranoKag): SavedPlayer[] {
  return Object.values(saveSlot(kag));
}
