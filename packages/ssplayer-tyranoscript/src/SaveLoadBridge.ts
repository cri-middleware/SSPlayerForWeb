import type { SSPartOverride, SSSavedTrack } from '@spritestudio/ssplayer-webgl';
import type {
  PlayerRegistry,
  SSCharaBinding,
  SSNextAnime,
  SSPlayback,
  SSSection,
} from './PlayerRegistry.js';
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
 * Key under `TYRANO.kag.stat.f` holding adapter-wide (not per-player) state.
 * Kept in its own slot so {@link SAVE_KEY} stays a plain `name -> player` map.
 */
export const SAVE_STATE_KEY = '__ssplayer_state';

/** Adapter-wide state that has to survive a save/load. */
export interface SSGlobalState {
  /**
   * Whether `[ss_fadeout]` has hidden every player. Separate from each player's
   * own `visible` flag so `[ss_fadein]` can bring back exactly the players that
   * were visible before the blanket fade — effective visibility is
   * `player.visible && !layerHidden`.
   */
  layerHidden: boolean;
}

/**
 * A single player's reconstruction data. Everything needed to re-run an
 * `[ss_new]`-equivalent, plus whether it was playing and the frame it was on.
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
  /**
   * Frame the animation was on. Refreshed when the engine announces a save is
   * being taken (`snapsave-start`), because that is the only moment the exact
   * frame matters — mirroring it continuously would mean writing to the save
   * target on every tick.
   */
  frame?: number;
  /** Whether the player was displayed (`[ss_show]` / `[ss_hide]` / `visible=`). */
  visible: boolean;
  /** Stacking order within the layer, when the author set one. */
  zindex?: number;
  /** Follow-up animation armed by `[ss_play next=]`, re-armed on restore. */
  next?: SSNextAnime;
  /** Speaker binding from `[ss_chara]`, re-bound on restore. */
  chara?: SSCharaBinding;
  /**
   * Per-part overrides (colour / cell / visibility) set by `[ss_part_*]`. Plain
   * data, so it round-trips through the save; `[ss_restore]` re-applies it to
   * the rebuilt player, whose WASM context starts with an empty override table.
   */
  overrides?: SSPartOverride[];
  /** `[ss_speed]`, `[ss_direction]` and `[ss_section]`, re-applied on restore. */
  speed?: number;
  playback?: SSPlayback;
  section?: SSSection;
  /** `[ss_track]`'s tracks, re-laid on restore. A fade in flight is saved where it ends. */
  tracks?: SSSavedTrack[];
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
      // "Was it advancing", which is what the restore replays: it calls
      // `play()` for true and `pause()` for false, and `isPlaying` alone stays
      // true across a pause — so a paused sprite would come back running.
      playing: player.isPlaying && !player.isPausing,
      frame: player.frameNo,
      visible: meta.visible,
      zindex: meta.zindex,
      next: meta.next,
      chara: meta.chara,
      overrides: meta.overrides,
      speed: meta.speed,
      playback: meta.playback,
      section: meta.section,
      tracks: meta.tracks,
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

/** Mirror the adapter-wide state into the save target (see {@link SAVE_STATE_KEY}). */
export function persistGlobalState(kag: TyranoKag, state: SSGlobalState): void {
  const stat = kag.stat as { f?: Record<string, unknown> };
  if (!stat.f) stat.f = {};
  stat.f[SAVE_STATE_KEY] = { layerHidden: state.layerHidden };
}

/** Read the adapter-wide state a load restored (defaults when absent). */
export function readGlobalState(kag: TyranoKag): SSGlobalState {
  const stat = kag.stat as { f?: Record<string, unknown> };
  const saved = stat.f?.[SAVE_STATE_KEY] as Partial<SSGlobalState> | undefined;
  return { layerHidden: saved?.layerHidden === true };
}
