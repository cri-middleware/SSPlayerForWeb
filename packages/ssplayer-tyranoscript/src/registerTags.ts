import {
  applyPartOverrides,
  parsePartOverrideColor,
  SSPartOverrideStore,
  SSOverlay,
  SSSurface,
  type SSPlayer,
  type SSBlendOp,
  type SSOverridePriority,
  type SSPartOverride,
} from '@spritestudio/ssplayer-webgl';
import {
  clearChain,
  PlayerRegistry,
  type SSCharaBinding,
  type SSNextAnime,
  type SSPlayerEntry,
} from './PlayerRegistry.js';
import {
  boxOrigin,
  createCharacterElement,
  getLayerElement,
  setElementVisible,
  toTransform,
  type LayerPage,
} from './LayerCanvas.js';
import {
  persistGlobalState,
  persistPlayers,
  readGlobalState,
  readSavedPlayers,
} from './SaveLoadBridge.js';
import { attachTalkHooks, speakerMatches } from './CharaTalkBridge.js';
import { TyranoAudioManager } from './TyranoAudioManager.js';
import type { TyranoGlobal, TyranoKag } from './tyranoTypes.js';

// ---------------------------------------------------------------------------
// Adapter state (module scope, like Tyrano's own `[chara]` bookkeeping).
// ---------------------------------------------------------------------------

/** Live players keyed by `name`. Shared by every `[ss_*]` tag. */
const registry = new PlayerRegistry();

interface AdapterState {
  /** Whether `[ss_init]` has run the runtime initialiser (WASM ready). */
  initialized: boolean;
  /** In-flight init promise so a second `[ss_init]` awaits the first. */
  initPromise: Promise<void> | null;
  /**
   * `[ss_fadeout]` blanket-hide. Kept apart from each player's own `visible`
   * flag so `[ss_fadein]` restores exactly the players that were shown before.
   */
  layerHidden: boolean;
  /** Whether the `[ss_chara]` speaker hooks have been wired onto `[text]`. */
  talkHooked: boolean;
  /** Player currently showing its talk animation (`[ss_chara]`), if any. */
  talking: string | null;
  /** Whether the automatic `load-beforemaking` restore hook is wired. */
  restoreHooked: boolean;
  /**
   * An automatic restore already running for the load in progress. `[ss_restore]`
   * awaits it instead of doing the work twice, so a `make.ks` written the
   * old way still blocks the scenario until the players are back.
   */
  restorePromise: Promise<void> | null;
  /** Watches layers for canvases the engine removed without going through us. */
  detachObserver: MutationObserver | null;
}

const state: AdapterState = {
  initialized: false,
  initPromise: null,
  layerHidden: false,
  talkHooked: false,
  talking: null,
  restoreHooked: false,
  restorePromise: null,
  detachObserver: null,
};

/** Audio routing config (set by `[ss_init]`; see TyranoAudioManager). */
interface AudioState {
  enabled: boolean;
  manager: TyranoAudioManager | null;
  dir?: string;
  ext?: string;
  volume?: number;
}
const audio: AudioState = { enabled: true, manager: null };

/** Lazily build the shared Tyrano audio manager (null when audio is disabled). */
function ensureAudioManager(): TyranoAudioManager | null {
  if (!audio.enabled) return null;
  if (!audio.manager) {
    audio.manager = new TyranoAudioManager({ dir: audio.dir, ext: audio.ext, volume: audio.volume });
  }
  return audio.manager;
}

// ---------------------------------------------------------------------------
// Small coercion / path helpers. Tyrano hands attribute values through as
// strings (its `pm` defaults are the only typed values), so normalise here.
// ---------------------------------------------------------------------------

function num(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Map a Tyrano `loop` attribute to `SSPlayer.loopCount`:
 *  - `"true"` / omitted → `-1` (infinite, the SS default),
 *  - `"false"` → `1` (play once),
 *  - a number string → that many loops.
 */
function loopCount(value: unknown): number {
  if (value === undefined || value === null || value === '' || value === 'true' || value === true) {
    return -1;
  }
  if (value === 'false' || value === false) return 1;
  return num(value, -1);
}

/** Read a Tyrano boolean attribute (`"true"` / `"false"`), falling back when omitted. */
function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || String(value) === 'true';
}

/** Log a failure with its stack, for anyone who has a console open. */
function logFailure(label: string, err: unknown): void {
  console.error(`[ss] ${label} failed:`, (err as Error)?.stack ?? err);
}

/**
 * Throw unless `anime` is one of the pack's animations.
 *
 * Checked when the tag runs, before anything changes. `next=` and `[ss_chara]`
 * switch animations later, after the scenario has moved past the tag, so a
 * misspelt name would surface where no line can be blamed for it; and a switch
 * failing halfway leaves the player changed by a tag that reported failure.
 */
function requireAnimation(player: SSPlayer, storage: string, attr: string, anime: string): void {
  if (player.getAnimationNames().includes(anime)) return;
  throw new Error(`${attr}="${anime}" is not in ${storage}.`);
}

// Part-override attributes are written by hand in a scenario, so the tags take
// readable words as well as the raw runtime numbers.
// Maps, not object literals: a plain object would resolve inherited keys, so
// blend="constructor" (or "__proto__") would pass the "is it a known name?"
// check and hand a function to the runtime instead of falling back to num().
const BLEND_OPS = new Map<string, number>([
  ['mix', 0], ['mul', 1], ['multiply', 1], ['add', 2], ['sub', 3], ['subtract', 3],
]);
const PRIORITIES = new Map<string, number>([
  ['keyframe', 0], ['anime', 1], ['animation', 1], ['permanent', 2],
]);

/** `blend="mul"` (or `blend="1"`) → the runtime's blend-op number. */
function blendOp(value: unknown): SSBlendOp {
  const key = String(value ?? '').trim().toLowerCase();
  const named = BLEND_OPS.get(key);
  return (named !== undefined ? named : num(value, 0)) as SSBlendOp;
}

/** `priority="permanent"` (or `priority="2"`) → the runtime's priority number. */
function priorityMode(value: unknown): SSOverridePriority {
  const key = String(value ?? '').trim().toLowerCase();
  const named = PRIORITIES.get(key);
  return (named !== undefined ? named : num(value, 1)) as SSOverridePriority;
}

/**
 * Resolve a `storage=` value the way TyranoScript resolves every other one.
 *
 * `$.parseStorage(path, folder)` is the engine's own resolver — the same call
 * behind `[image]`, `[bg]` and the rest. Passing `data` as the folder keeps the
 * meaning this adapter has always had (a bare path hangs off `data/`), while
 * handing the engine the parts that are easy to get subtly wrong: `..` and `.`
 * segments, doubled slashes, and http(s) pass-through.
 *
 * The early exits come first because `parseStorage` would rewrite them: it
 * treats its result as project-relative, so a root-absolute or protocol-relative
 * URL must not go through it. Older engines have no `parseStorage`, hence the
 * fallback.
 */
function resolveDataPath(p: string): string {
  if (/^(https?:)?\/\//.test(p) || p.startsWith('/')) return p;

  const parse = (globalThis as { $?: { parseStorage?: (s: string, folder?: string) => string } }).$
    ?.parseStorage;
  if (typeof parse === 'function') return parse(p, 'data');

  if (p.startsWith('./') || p.startsWith('data/')) return p;
  return `data/${p}`;
}

function gameResolution(kag: TyranoKag): { w: number; h: number } {
  return { w: num(kag.config?.scWidth, 1280), h: num(kag.config?.scHeight, 720) };
}

/**
 * Live overlays, keyed `<layer>_<page>`. One overlay owns one canvas and one GL
 * context and draws every SS character on that layer, which is what keeps the
 * context count at "layers in use" rather than "characters on screen".
 *
 * Tracked here as well as inside SSOverlay so teardown can drop them: a scene
 * transition replaces Tyrano's layer divs, and an overlay still parented to the
 * old one would draw nowhere.
 */
const overlays = new Map<string, SSOverlay>();

/** Get (or lazily create) the overlay that draws `layer`/`page`. */
function overlayFor(layer: string, page: LayerPage, layerEl: HTMLElement, dpr: number): SSOverlay {
  const key = `${layer}_${page}`;
  const existing = overlays.get(key);
  // A scene transition rebuilds the layer divs, so an overlay whose canvas is no
  // longer inside the current layer element is stale — drop it and start again.
  if (existing && existing.canvas.parentElement === layerEl) return existing;
  existing?.destroy();

  const overlay = SSOverlay.getOrCreate(`ss_${key}`, {
    container: layerEl,
    // Reads each character div's computed opacity into its player's alpha, so
    // Tyrano's own [anim opacity=] / [kanim] still fade the animation.
    followOpacity: true,
    maxDPR: Math.min(dpr, 2),
  });
  // A placement is stored in logical pixels but pushed to the renderer in
  // drawing-buffer pixels, and a resize changes the ratio between them. Without
  // this, every character on the layer drifts the first time the window is
  // resized — and stays wrong until the scenario happens to move it again.
  overlay.onResized(() => {
    for (const name of registry.names()) {
      const entry = registry.get(name);
      if (entry && entry.overlay === overlay) applyPlacement(entry);
    }
  });
  overlays.set(key, overlay);
  return overlay;
}

/** Destroy every overlay (scene teardown). Players must already be gone. */
function destroyOverlays(): void {
  for (const overlay of overlays.values()) overlay.destroy();
  overlays.clear();
}

/** Apply a `zindex=` as this player's draw order within its layer. */
function setPlayerOrder(entry: SSPlayerEntry, zindex?: number): void {
  entry.player.order = zindex !== undefined && Number.isFinite(zindex) ? zindex : 0;
  entry.overlay.surface.invalidateOrder();
}

/**
 * `drawingBuffer px / logical px` for this overlay, right now.
 *
 * Derived at every use rather than captured when the player was created: the
 * overlay resizes its canvas with the window, and a ratio captured at `[ss_new]`
 * would place `[ss_pos]` / `[ss_move]` against a canvas that no longer exists.
 */
function bufferScaleOf(overlay: SSOverlay, logicalW: number): number {
  return overlay.canvas.width / Math.max(1, logicalW);
}

/**
 * The override list for one player: the saved copy on `meta` (mirrored into
 * `stat.f` by persist), the live copy on the runtime. The store keeps the two in
 * step, so no tag has to remember the three-step dance by hand.
 */
function overridesOf(entry: SSPlayerEntry, persist: () => void): SSPartOverrideStore {
  return new SSPartOverrideStore({
    read: () => entry.meta.overrides,
    write: (list) => { entry.meta.overrides = list; persist(); },
    player: () => entry.player,
  });
}

/** Push a player's stored placement to the renderer, at the current buffer scale. */
function applyPlacement(entry: SSPlayerEntry): void {
  const { player, meta, overlay } = entry;
  player.setTransform(
    toTransform(meta.x, meta.y, meta.scale, bufferScaleOf(overlay, entry.logicalWidth), boxOrigin(player)),
  );
}

// ---------------------------------------------------------------------------
// Player construction — shared by [ss_new] and [ss_restore].
// ---------------------------------------------------------------------------

/** Normalized placement/animation options for {@link createPlayer}. */
interface CreateOpts {
  name: string;
  storage: string;
  anime: string;
  layer: string;
  page: LayerPage;
  x: number;
  y: number;
  scale: number;
  loop: number;
  /** Whether to display the canvas right away (`false` = preload only). */
  visible: boolean;
  /** Stacking order within the layer, when the author set one. */
  zindex?: number;
  /** Follow-up animation to re-arm (restore path). */
  next?: SSNextAnime;
  /** Speaker binding to re-bind (restore path). */
  chara?: SSCharaBinding;
  /** Per-part overrides to re-apply once the animation is set up (restore path). */
  overrides?: SSPartOverride[];
}

/**
 * Build one SS player: resolve the layer, mount a canvas, load the ssab, set the
 * animation + transform + loop, and register it. Does NOT start playback — the
 * caller decides (so restore can honour the saved playing/paused state). Throws
 * (with a clear message) on any missing prerequisite so the calling tag can log
 * and still advance.
 */
async function createPlayer(kag: TyranoKag, opts: CreateOpts): Promise<SSPlayerEntry> {
  if (!state.initialized) {
    throw new Error('call [ss_init] before creating players.');
  }
  const layerEl = getLayerElement(kag, opts.layer, opts.page);
  if (!layerEl) throw new Error(`layer "${opts.layer}" (${opts.page}) not found on the page.`);

  const storageUrl = resolveDataPath(opts.storage);
  const { w, h } = gameResolution(kag);
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;

  const element = createCharacterElement(layerEl, w, h, opts.name);
  // Apply visibility before the (awaited) load so a preloading `[ss_new
  // visible="false"]` never flashes on screen for a frame.
  void setElementVisible(element, opts.visible && !state.layerHidden, 0);

  // One overlay — one canvas, one GL context — per (layer, page), shared by every
  // SS character on that layer. followOpacity is what keeps `[anim opacity=]`,
  // `[kanim]`, `[ss_fadein]` and `[ss_hide]` working now that the character is a
  // div: the overlay reads the element's computed opacity into the player's alpha
  // every frame.
  const overlay = overlayFor(opts.layer, opts.page, layerEl, dpr);
  // Disable the default Web Audio manager; we route SS sounds through
  // TyranoScript's howler instead (attached below, before setAnimation so the
  // core preloads through it). When audio is disabled, nothing is attached.
  const player = overlay.createPlayer(element, { autoAudio: false });
  // Draw order within the layer. Tyrano layers stack by layer number; within one
  // layer the characters share a canvas, so ordering is a draw-order key rather
  // than a CSS z-index.
  if (opts.zindex !== undefined) {
    player.order = opts.zindex;
    overlay.surface.invalidateOrder();
  }
  ensureAudioManager()?.bindToPlayer(player);

  let anime = opts.anime;
  try {
    await player.load(storageUrl);

    // Pick the animation: the given name, else the pack's first animation. The
    // player already read the names when it bound the pack, so this no longer
    // costs a second download of the same `.ssab`.
    if (anime) requireAnimation(player, opts.storage, 'anime', anime);
    else anime = player.getAnimationNames()[0] ?? '';
    if (!anime) throw new Error(`no animation found in "${opts.storage}".`);
    player.setAnimation(anime);

    player.loopCount = opts.loop;
    // A fresh player means a fresh WASM context, whose override table starts
    // empty — so a restore has to put the saved overrides back. Must run after
    // setAnimation: before that, part names cannot resolve.
    applyPartOverrides(player, opts.overrides);
  } catch (err) {
    // Not registered yet, so nothing else will ever free these: the element
    // would stay on the layer answering `[anim name=]`, and the player would
    // keep its WASM allocation on the overlay.
    overlay.detach(player);
    player.destroy();
    element.remove();
    throw err;
  }

  const entry: SSPlayerEntry = {
    player,
    overlay,
    element,
    logicalWidth: w,
    meta: {
      name: opts.name,
      storage: opts.storage,
      anime,
      layer: opts.layer,
      page: opts.page,
      x: opts.x,
      y: opts.y,
      scale: opts.scale,
      loop: opts.loop,
      visible: opts.visible,
      zindex: opts.zindex,
      next: opts.next,
      chara: opts.chara,
      overrides: opts.overrides,
    },
  };
  registry.set(entry);
  // Placement must come after the entry exists, since it reads meta and the
  // current buffer scale through it.
  applyPlacement(entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Follow-up animations (`[ss_play next=]`) — the Spine plugin's `next_motion`.
// ---------------------------------------------------------------------------

/**
 * Arm `entry.meta.next` on the live player: when the current animation reaches
 * `atframe` or ends, whichever comes first, switch to the follow-up and keep
 * playing. Unlike
 * `[ss_wait]` this never touches the scenario, so the text keeps flowing while
 * a character finishes its entrance and settles into an idle loop.
 *
 * `onFrame` is optional on the player interface only in the sense that a very
 * old build may not have it; the current renderer always does, so `atframe`
 * simply falls back to the end-of-animation trigger if it is missing.
 */
function armChain(entry: SSPlayerEntry, persist: () => void): void {
  clearChain(entry);
  const next = entry.meta.next;
  if (!next) return;

  const { player, meta } = entry;
  const fire = (): void => {
    clearChain(entry);
    meta.next = undefined;
    meta.anime = next.anime;
    meta.loop = next.loop;
    try {
      player.setAnimation(next.anime);
      // The author DID ask for this animation change (they wrote `next=`), so
      // drop the overrides a new setup discards, exactly like [ss_play].
      overridesOf(entry, persist).pruneForNewAnimation();
      player.loopCount = next.loop;
      player.play();
      persist();
    } catch (err) {
      logFailure('next animation', err);
    }
  };

  // The end fires the follow-up even under `atframe=`. An `atframe` past the
  // last frame, or a finite loop that runs out first, never reaches the frame —
  // and a chain waiting only for it leaves the character stopped for good.
  const chain: Array<() => void> = [player.onAnimationFinished(fire)];
  if (next.atframe !== undefined && typeof player.onFrame === 'function') {
    const target = next.atframe;
    chain.push(player.onFrame((frame) => { if (frame >= target) fire(); }));
  }
  entry.chain = chain;
}

// ---------------------------------------------------------------------------
// Tag registration.
// ---------------------------------------------------------------------------

/**
 * Register the `[ss_*]` KAG custom tags onto `TYRANO.kag.ftag.master_tag`.
 *
 * Idempotent and safe to call from the plugin's `main.js` on load. Pass an
 * explicit `tyrano` for testing; otherwise the global `TYRANO` is used. Returns
 * `false` (a no-op) when no TyranoScript runtime is present, so importing the
 * ESM build outside Tyrano never throws.
 */
export function registerSSTags(tyrano?: TyranoGlobal): boolean {
  const kag = tyrano?.kag ?? (globalThis as { TYRANO?: TyranoGlobal }).TYRANO?.kag;
  if (!kag) return false;

  const ftag = kag.ftag;
  const nextOrder = () => ftag.nextOrder();
  /** Mirror the live registry into the save target (§3.3). */
  const persist = () => {
    persistPlayers(kag, registry);
    persistGlobalState(kag, { layerHidden: state.layerHidden });
  };

  /**
   * Report a tag's failure to the author, not only to the console.
   *
   * TyranoBuilder's ordinary preview has no console, so a failure logged and
   * nothing else — a mistyped `storage=`, a `[ss_play]` before its `[ss_new]` —
   * did nothing and said nothing. `kag.error` is how the engine reports its own
   * tags' mistakes, and it decides whether anyone sees it: only with
   * `debugMenu.visible` on, which a TyranoBuilder project has and its export
   * turns off. It names the line the scenario is on, so call this before
   * advancing past the tag.
   */
  const report = (label: string, err: unknown): void => {
    logFailure(label, err);
    kag.error?.(`[${label}] ${(err as Error)?.message ?? String(err)}`);
  };

  /** Run async tag work, then advance — even on error, so the scenario never stalls. */
  const runThenAdvance = (label: string, work: () => Promise<void>): void => {
    work()
      .catch((err) => report(label, err))
      .finally(nextOrder);
  };

  /**
   * Tag work whose tail is a visual effect: `wait="true"` advances the
   * scenario only once the effect has finished (the `[spine_fadein wait=]` /
   * `[live2d_fadein wait=]` convention), `wait="false"` advances at once and
   * lets it play out behind the following tags.
   *
   * `work` does the tag's own work synchronously and returns the effect, so a
   * mistake in the tag is reported while the scenario is still on its line even
   * when the effect is not waited for.
   */
  const runThenAdvanceOrNot = (label: string, wait: boolean, work: () => Promise<unknown>): void => {
    let effect: Promise<unknown>;
    try {
      effect = work();
    } catch (err) {
      report(label, err);
      nextOrder();
      return;
    }
    if (wait) {
      effect.catch((err) => report(label, err)).finally(nextOrder);
      return;
    }
    // Settles after the scenario has moved on, where `report` would name the
    // wrong line.
    effect.catch((err) => logFailure(label, err));
    nextOrder();
  };

  /** Run synchronous tag work, then advance (errors reported, never stalls). */
  const runSync = (label: string, work: () => void): void => {
    try {
      work();
    } catch (err) {
      report(label, err);
    } finally {
      nextOrder();
    }
  };

  /** Look up a player by name or throw a clear "call [ss_new] first" error. */
  const lookup = (name: string): SSPlayerEntry => {
    const entry = registry.get(name);
    if (!entry) throw new Error(`player "${name}" not found (call [ss_new] first).`);
    return entry;
  };

  /**
   * Push a player's effective visibility to its canvas. A player is on screen
   * only when it is itself visible AND no `[ss_fadeout]` is in force.
   */
  const applyVisibility = (entry: SSPlayerEntry, timeMs: number): Promise<void> =>
    setElementVisible(entry.element, entry.meta.visible && !state.layerHidden, timeMs);

  /** Every live entry, for the bulk tags. */
  const allEntries = (): SSPlayerEntry[] =>
    registry.names().map((n) => registry.get(n)).filter((e): e is SSPlayerEntry => !!e);

  /** Attributes shared by `[ss_play]` and `[ss_show]`'s optional entrance animation. */
  interface PlaybackAttrs {
    anime?: unknown;
    loop?: unknown;
    start?: unknown;
    next?: unknown;
    nextloop?: unknown;
    atframe?: unknown;
  }

  /**
   * Switch animation (when asked), arm any `next=` follow-up, and play. Shared
   * so `[ss_show anime=]` behaves exactly like `[ss_play]` — an entrance
   * animation that hands over to an idle loop is the common case for both.
   */
  const applyPlayback = (entry: SSPlayerEntry, pm: PlaybackAttrs): void => {
    const { player, meta } = entry;
    const nextAnime = String(pm.next ?? '');
    const hasAtframe = pm.atframe !== undefined && pm.atframe !== '';

    if (pm.anime) requireAnimation(player, meta.storage, 'anime', String(pm.anime));
    if (nextAnime) requireAnimation(player, meta.storage, 'next', nextAnime);

    // Whatever follow-up the previous [ss_play] armed is superseded by this one.
    clearChain(entry);

    if (pm.anime) {
      meta.anime = String(pm.anime);
      player.setAnimation(meta.anime);
      // Setting up an animation makes the runtime drop every override but the
      // Permanent ones; keep the saved mirror in step so a later [ss_restore]
      // cannot resurrect what the runtime discarded.
      overridesOf(entry, persist).pruneForNewAnimation();
    }
    if (pm.loop !== undefined && pm.loop !== '') {
      meta.loop = loopCount(pm.loop);
    } else if (nextAnime && !hasAtframe) {
      // `next=` means "play this, then that", and the end of an infinite loop
      // never arrives — so an unstated loop plays once here, matching the
      // Spine plugin's [spine_anim], whose `loop` also defaults to false.
      meta.loop = 1;
    } else {
      // The default, never the previous tag's value: that can be the `1` a
      // pending `next=` set for an entrance, and whether it still is depends on
      // how fast the scenario got here — a player who clicks through quickly
      // would get this animation once and then a frozen character.
      meta.loop = -1;
    }
    meta.next = nextAnime
      ? {
          anime: nextAnime,
          loop: pm.nextloop !== undefined && pm.nextloop !== '' ? loopCount(pm.nextloop) : -1,
          atframe: hasAtframe ? num(pm.atframe, 0) : undefined,
        }
      : undefined;

    player.loopCount = meta.loop;
    player.play(num(pm.start, -1));
    armChain(entry, persist);
  };

  // --- [ss_chara]: speaker-linked talk / idle switching --------------------
  //
  // Transient decoration over whatever the scenario last set, so these swaps
  // deliberately do NOT touch `meta.anime`: a save taken mid-line must not
  // restore the character frozen in their talk animation.

  const switchAnimation = (entry: SSPlayerEntry, anime: string, loop: number): void => {
    if (!anime) return;
    const { player, meta } = entry;
    try {
      player.setAnimation(anime);
      // setAnimation drops the non-Permanent overrides; the author never
      // asked for that here, so put them straight back.
      overridesOf(entry, persist).reapply();
      player.loopCount = loop;
      player.play();
    } catch (err) {
      logFailure('ss_chara animation switch', err);
    }
  };

  /** Return the currently-talking player (if any) to its idle animation. */
  const stopTalking = (): void => {
    const name = state.talking;
    state.talking = null;
    if (!name) return;
    const entry = registry.get(name);
    const chara = entry?.meta.chara;
    if (!entry || !chara) return;
    // An explicit idle= loops forever; falling back to the scenario's own
    // animation restores the loop count the scenario chose for it.
    switchAnimation(entry, chara.idle || entry.meta.anime, chara.idle ? -1 : entry.meta.loop);
  };

  /** Wire the engine's text-output bracket to talk/idle switching (once). */
  const ensureTalkHooks = (): void => {
    if (state.talkHooked) return;
    state.talkHooked = true; // set first: on failure we warn exactly once
    const wired = attachTalkHooks(kag, {
      onTalkStart: (speaker) => {
        stopTalking();
        if (!speaker) return;
        for (const entry of allEntries()) {
          const chara = entry.meta.chara;
          if (!chara || !speakerMatches(kag, chara.jname, speaker)) continue;
          state.talking = entry.meta.name;
          switchAnimation(entry, chara.talk, -1);
          break;
        }
      },
      onTalkStop: stopTalking,
    });
    if (!wired) {
      console.warn(
        '[ss_chara] this TyranoScript build exposes no text-output hook; speaker linkage is inactive.',
      );
    }
  };

  // [ss_init wasm=] — initialize the WASM runtime once. Async: advances only
  // after WASM is ready.
  ftag.master_tag['ss_init'] = {
    pm: { wasm: '', audio: 'true', sounddir: '', soundext: '', sevolume: '' },
    start(pm) {
      // Audio routing config (TyranoAudioManager via howler). Re-buildable, so
      // reset the cached manager if settings changed.
      audio.enabled = String(pm.audio) !== 'false';
      if (pm.sounddir) audio.dir = String(pm.sounddir);
      if (pm.soundext) audio.ext = String(pm.soundext);
      if (pm.sevolume !== undefined && pm.sevolume !== '') audio.volume = num(pm.sevolume, 1);
      audio.manager = null;
      if (state.initialized) {
        nextOrder();
        return;
      }
      runThenAdvance('ss_init', async () => {
        if (!state.initPromise) {
          // The drop-in main.js is an IIFE bundle, so core's default
          // (`import.meta.url`-based) WASM resolution is unavailable — the path
          // must be explicit. Warn early rather than fail cryptically later.
          if (!pm.wasm) {
            console.warn(
              '[ss_init] no wasm= given. In the TyranoScript plugin build the runtime path is required, ' +
                'e.g. [ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"].',
            );
          }
          const wasm = pm.wasm ? resolveDataPath(String(pm.wasm)) : undefined;
          state.initPromise = SSSurface.initialize(wasm);
        }
        await state.initPromise;
        state.initialized = true;
      });
    },
  };

  // [ss_new name= storage= anime= layer= page= x= y= scale= loop= visible= zindex=]
  // — create a player, load the ssab, mount its canvas on the layer, set
  // animation, play. `visible="false"` loads WITHOUT displaying (the Spine /
  // Live2D plugins' `[*_new]` + `[*_show]` split), so a heavy .ssab can be
  // preloaded during a quiet moment and revealed instantly later with [ss_show].
  ftag.master_tag['ss_new'] = {
    vital: ['name', 'storage'],
    pm: {
      anime: '', layer: '0', page: 'fore', x: 0, y: 0, scale: 1, loop: 'true',
      visible: 'true', zindex: '',
    },
    start(pm) {
      runThenAdvance('ss_new', async () => {
        const entry = await createPlayer(kag, {
          name: String(pm.name),
          storage: String(pm.storage),
          anime: String(pm.anime ?? ''),
          layer: String(pm.layer),
          page: String(pm.page) as LayerPage,
          x: num(pm.x, 0),
          y: num(pm.y, 0),
          scale: num(pm.scale, 1),
          loop: loopCount(pm.loop),
          visible: bool(pm.visible, true),
          zindex: pm.zindex === undefined || pm.zindex === '' ? undefined : num(pm.zindex, 0),
        });
        observeLayerOf(entry);
        entry.player.play();
        persist();
      });
    },
  };

  // [ss_play name= anime= loop= start= next= nextloop= atframe=] — (re)play,
  // optionally switching animation. `next=` queues a follow-up animation that
  // starts when this one ends (or at `atframe=`) WITHOUT blocking the scenario
  // — the Spine plugin's `next_motion` / `in_frame_next_motion`. Use it for
  // "entrance, then idle loop" while the text keeps flowing; use [ss_wait] when
  // you do want the scenario to hold.
  ftag.master_tag['ss_play'] = {
    vital: ['name'],
    pm: { anime: '', loop: '', start: '', next: '', nextloop: '', atframe: '' },
    start(pm) {
      runSync('ss_play', () => {
        applyPlayback(lookup(String(pm.name)), pm);
        persist();
      });
    },
  };

  // [ss_show name= x= y= scale= zindex= anime= loop= next= time= wait=] — reveal
  // a player created with `visible="false"` (or hidden by [ss_hide]), optionally
  // repositioning and playing an entrance animation as it appears. Mirrors
  // [spine_show] / [live2d_show].
  ftag.master_tag['ss_show'] = {
    vital: ['name'],
    pm: {
      x: '', y: '', scale: '', zindex: '', anime: '', loop: '', start: '',
      next: '', nextloop: '', atframe: '', time: 0, wait: 'true',
    },
    start(pm) {
      runThenAdvanceOrNot('ss_show', bool(pm.wait, true), () => {
        const entry = lookup(String(pm.name));
        const m = entry.meta;
        // First, so a misspelt animation fails the tag before anything moves.
        if (pm.anime) applyPlayback(entry, pm);
        // Placement before the fade, so a fade-in never shows the old position.
        if (pm.zindex !== undefined && pm.zindex !== '') {
          m.zindex = num(pm.zindex, 0);
          setPlayerOrder(entry, m.zindex);
        }
        m.x = num(pm.x, m.x);
        m.y = num(pm.y, m.y);
        m.scale = num(pm.scale, m.scale);
        applyPlacement(entry);
        m.visible = true;
        persist();
        return applyVisibility(entry, num(pm.time, 0));
      });
    },
  };

  // [ss_hide name= time= wait=] — take a player off screen WITHOUT destroying
  // it ([spine_hide] / [live2d_hide]). The .ssab stays loaded, so [ss_show]
  // brings it back instantly; the renderer's own off-screen gating stops the
  // GPU work meanwhile. Use [ss_free] when you are done with it for good.
  ftag.master_tag['ss_hide'] = {
    vital: ['name'],
    pm: { time: 0, wait: 'true' },
    start(pm) {
      runThenAdvanceOrNot('ss_hide', bool(pm.wait, true), () => {
        const entry = lookup(String(pm.name));
        entry.meta.visible = false;
        persist();
        return applyVisibility(entry, num(pm.time, 0));
      });
    },
  };

  // [ss_fadein] / [ss_fadeout] time= wait= — fade every SS player at once, e.g.
  // around a scene change ([spine_fadein] / [live2d_fadeout]). The blanket flag
  // is kept apart from each player's own `visible`, so a fade-in brings back
  // exactly the players that were on screen before the fade-out.
  ftag.master_tag['ss_fadeout'] = {
    pm: { time: 1000, wait: 'true' },
    start(pm) {
      runThenAdvanceOrNot('ss_fadeout', bool(pm.wait, true), () => {
        state.layerHidden = true;
        persist();
        const time = num(pm.time, 1000);
        return Promise.all(allEntries().map((e) => applyVisibility(e, time)));
      });
    },
  };
  ftag.master_tag['ss_fadein'] = {
    pm: { time: 1000, wait: 'true' },
    start(pm) {
      runThenAdvanceOrNot('ss_fadein', bool(pm.wait, true), () => {
        state.layerHidden = false;
        persist();
        const time = num(pm.time, 1000);
        return Promise.all(allEntries().map((e) => applyVisibility(e, time)));
      });
    },
  };

  // [ss_chara name= jname= talk= idle=] — link a player to a speaker so it
  // plays `talk` while that character's text is being typed out and returns to
  // `idle` when the line ends. The Live2D plugin's `jname` + `lip="text"`,
  // expressed the way SpriteStudio works: a whole animation, not a mouth
  // parameter. `jname` accepts either the `#name` display name or the Tyrano
  // chara id, and defaults to the player's own name. `talk=""` unbinds.
  ftag.master_tag['ss_chara'] = {
    vital: ['name'],
    pm: { jname: '', talk: '', idle: '' },
    start(pm) {
      runSync('ss_chara', () => {
        const entry = lookup(String(pm.name));
        const talk = String(pm.talk ?? '');
        if (!talk) {
          if (state.talking === entry.meta.name) state.talking = null;
          entry.meta.chara = undefined;
          persist();
          return;
        }
        const idle = String(pm.idle ?? '');
        requireAnimation(entry.player, entry.meta.storage, 'talk', talk);
        if (idle) requireAnimation(entry.player, entry.meta.storage, 'idle', idle);
        entry.meta.chara = { jname: String(pm.jname || entry.meta.name), talk, idle };
        ensureTalkHooks();
        persist();
      });
    },
  };

  // [ss_stop] / [ss_pause] / [ss_resume] name= — per-player playback control.
  ftag.master_tag['ss_stop'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_stop', () => {
        lookup(String(pm.name)).player.stop();
        persist();
      });
    },
  };
  ftag.master_tag['ss_pause'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_pause', () => {
        lookup(String(pm.name)).player.pause();
        persist();
      });
    },
  };
  ftag.master_tag['ss_resume'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_resume', () => {
        lookup(String(pm.name)).player.resume();
        persist();
      });
    },
  };

  // --- Part overrides ---
  //
  // "Make this part this colour / this cell / hidden NOW", winning over the
  // keyframed animation — the SS6 PartsColorChange / CellChangeParts / HideSet
  // equivalents. Each tag applies the change to the live player and mirrors it
  // into the player's meta, so a save taken afterwards restores it.
  //
  // Attributes are read as words (blend="mul", priority="permanent") as well as
  // the raw runtime numbers, since they are written by hand in a scenario.

  /** Apply one override now and remember it for save/restore. */
  const setOverride = (name: string, entry: SSPartOverride): void => {
    overridesOf(lookup(name), persist).set(entry);
  };

  // [ss_part_color name= part= color= blend= priority=] — tint one part.
  // `color` is #RRGGBB or #RRGGBBAA (alpha defaults to opaque). Normal parts only.
  ftag.master_tag['ss_part_color'] = {
    vital: ['name', 'part', 'color'],
    pm: { blend: 'mix', priority: 'anime' },
    start(pm) {
      runSync('ss_part_color', () => {
        const rgba = parsePartOverrideColor(String(pm.color));
        if (rgba === null) {
          throw new Error(`cannot read color "${pm.color}" (try #FF0000 or #FF0000BF).`);
        }
        setOverride(String(pm.name), {
          kind: 'color',
          part: String(pm.part),
          blendOp: blendOp(pm.blend),
          rgba,
          priority: priorityMode(pm.priority),
        });
      });
    },
  };

  // [ss_part_visible name= part= hide= cascade=] — force-hide a part (hide=false
  // reverts it). `cascade` takes the descendants with it, which a keyframed hide
  // never does. Visibility has no priority mode.
  ftag.master_tag['ss_part_visible'] = {
    vital: ['name', 'part'],
    pm: { hide: 'true', cascade: 'false' },
    start(pm) {
      runSync('ss_part_visible', () => {
        setOverride(String(pm.name), {
          kind: 'visibility',
          part: String(pm.part),
          hide: bool(pm.hide, true),
          cascade: bool(pm.cascade, false),
        });
      });
    },
  };

  // [ss_part_cell name= part= cellmap= cell= priority=] — make a part draw
  // another cell. `cellmap` carries no .ssce extension. Normal / mask parts only.
  ftag.master_tag['ss_part_cell'] = {
    vital: ['name', 'part', 'cellmap', 'cell'],
    pm: { priority: 'anime' },
    start(pm) {
      runSync('ss_part_cell', () => {
        setOverride(String(pm.name), {
          kind: 'cell',
          part: String(pm.part),
          cellmap: String(pm.cellmap),
          cell: String(pm.cell),
          priority: priorityMode(pm.priority),
        });
      });
    },
  };

  // [ss_part_clear name= part=] — drop the overrides on one part, or on every
  // part when `part` is omitted.
  ftag.master_tag['ss_part_clear'] = {
    vital: ['name'],
    pm: { part: '' },
    start(pm) {
      runSync('ss_part_clear', () => {
        const entry = lookup(String(pm.name));
        overridesOf(entry, persist).clear(String(pm.part ?? '') || undefined);
      });
    },
  };

  // [ss_free name=] — destroy one player: WASM/GL teardown + canvas removal +
  // registry + save-state cleanup (§3.3).
  ftag.master_tag['ss_free'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_free', () => {
        registry.destroy(String(pm.name));
        persist();
      });
    },
  };

  // [ss_free_all] — tear down every player (e.g. on scene transition / layer
  // clear, where the DOM is reset and the players would otherwise leak).
  ftag.master_tag['ss_free_all'] = {
    start() {
      runSync('ss_free_all', () => {
        registry.destroyAll();
        // Nothing left to draw on this layer, so release its context too —
        // [ss_free_all] is the scene-transition tag, and holding an overlay for a
        // layer that may not come back is exactly the leak this tag exists to
        // avoid. The next [ss_new] lazily builds a fresh one.
        destroyOverlays();
        persist();
      });
    },
  };

  // [ss_pause_all] / [ss_resume_all] — bulk pause/resume, e.g. around a menu /
  // save / config screen (the renderer keeps running during ordinary text waits
  // by design; a host that wants those screens frozen calls these).
  ftag.master_tag['ss_pause_all'] = {
    start() {
      runSync('ss_pause_all', () => {
        for (const name of registry.names()) registry.get(name)?.player.pause();
        persist();
      });
    },
  };
  ftag.master_tag['ss_resume_all'] = {
    start() {
      runSync('ss_resume_all', () => {
        for (const name of registry.names()) registry.get(name)?.player.resume();
        persist();
      });
    },
  };

  // [ss_wait name=] — pause the scenario until the animation finishes. Does NOT
  // call nextOrder in start(); instead advances on the next animation end (or,
  // for a looping animation that never "ends", on the next loop) — the async-tag
  // idiom. No-op advance if the player isn't currently playing.
  ftag.master_tag['ss_wait'] = {
    vital: ['name'],
    start(pm) {
      let entry: SSPlayerEntry;
      try {
        entry = lookup(String(pm.name));
      } catch (err) {
        report('ss_wait', err);
        nextOrder();
        return;
      }
      const { player } = entry;
      // "Not advancing", not "not live": `isPlaying` stays true across a pause
      // (a pause is a hold, not a stop), and a held player's animation-end
      // listener can never fire — so waiting on one would block the scenario
      // until something else resumed it.
      if (!player.isPlaying || player.isPausing) {
        nextOrder();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        unsubEnd();
        unsubLoop();
        nextOrder();
      };
      const unsubEnd = player.onAnimationFinished(finish);
      const unsubLoop = player.onAnimationLooped(finish);
    },
  };

  // [ss_pos name= x= y= scale= zindex=] — instant reposition/scale via the
  // renderer's internal transform (anchor-accurate absolute placement, unlike a
  // CSS [anim]). `zindex` reorders players sharing one layer, which creation
  // order alone cannot do. Omitted attributes keep their current value.
  ftag.master_tag['ss_pos'] = {
    vital: ['name'],
    pm: { x: '', y: '', scale: '', zindex: '' },
    start(pm) {
      runSync('ss_pos', () => {
        const entry = lookup(String(pm.name));
        if (entry.tween) {
          cancelAnimationFrame(entry.tween);
          entry.tween = 0;
        }
        const m = entry.meta;
        m.x = num(pm.x, m.x);
        m.y = num(pm.y, m.y);
        m.scale = num(pm.scale, m.scale);
        if (pm.zindex !== undefined && pm.zindex !== '') {
          m.zindex = num(pm.zindex, 0);
          setPlayerOrder(entry, m.zindex);
        }
        applyPlacement(entry);
        persist();
      });
    },
  };

  // [ss_move name= x= y= scale= time= wait=] — tween to a new position/scale
  // over `time` ms (default 500), easing out. Non-blocking by default (like
  // Tyrano's [anim]); `wait="true"` holds the scenario until it lands. The save
  // state is updated to the target immediately so a mid-tween save restores at
  // the destination. Falls back to an instant set where rAF is unavailable.
  ftag.master_tag['ss_move'] = {
    vital: ['name'],
    pm: { x: '', y: '', scale: '', time: '500', wait: 'false' },
    start(pm) {
      // `wait` defers the advance to the tween's end. Kept outside runSync (which
      // always advances) so only the failure path falls back to advancing now.
      const wait = bool(pm.wait, false);
      let advanceIn = -1;
      const finish = (): void => {
        if (wait && advanceIn > 0) setTimeout(nextOrder, advanceIn);
        else nextOrder();
      };
      try {
        const entry = lookup(String(pm.name));
        const m = entry.meta;
        const fromX = m.x;
        const fromY = m.y;
        const fromS = m.scale;
        const toX = num(pm.x, m.x);
        const toY = num(pm.y, m.y);
        const toS = num(pm.scale, m.scale);
        const time = num(pm.time, 500);
        // Commit the destination to meta/save up front.
        m.x = toX;
        m.y = toY;
        m.scale = toS;
        persist();

        if (entry.tween) {
          cancelAnimationFrame(entry.tween);
          entry.tween = 0;
        }
        const raf = (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame;
        const now = () => (globalThis.performance?.now?.() ?? 0);
        if (time <= 0 || typeof raf !== 'function') {
          applyPlacement(entry); // meta already holds the destination
          finish();
          return;
        }
        advanceIn = time;
        const start = now();
        const step = (t: number): void => {
          const p = Math.min(1, (t - start) / time);
          const e = 1 - (1 - p) * (1 - p); // easeOutQuad
          // Re-read the buffer scale each frame rather than closing over it: a
          // window resize mid-tween must not send the character off course.
          entry.player.setTransform(
            toTransform(
              fromX + (toX - fromX) * e,
              fromY + (toY - fromY) * e,
              fromS + (toS - fromS) * e,
              bufferScaleOf(entry.overlay, entry.logicalWidth),
              boxOrigin(entry.player),
            ),
          );
          entry.tween = p < 1 ? raf(step) : 0;
        };
        entry.tween = raf(step);
        finish();
      } catch (err) {
        report('ss_move', err);
        nextOrder();
      }
    },
  };

  /**
   * Release players whose canvas the engine has taken out of the DOM.
   *
   * A scenario can clear a layer without going through `[ss_free]` —
   * `[freeimage layer=]` empties the layer's children, and a project may do the
   * same by hand. The canvas disappears, but the player behind it keeps its GL
   * context and its WASM allocation, and stays in the registry answering to its
   * name. Left alone, a game that clears layers between scenes leaks one player
   * per scene.
   *
   * Watching the DOM rather than wrapping tags is deliberate. `[cm]` and
   * `[clearfix]`, the obvious suspects, turn out to touch only the message,
   * free and fix layers — never the character layers a player sits on — so a
   * tag-name list would have been both wrong and impossible to keep complete
   * across engine versions. A removal is a removal whatever caused it.
   */
  const watchForDetachedCanvases = (): void => {
    if (state.detachObserver || typeof MutationObserver !== 'function') return;

    state.detachObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          for (const name of registry.names()) {
            const entry = registry.get(name);
            if (!entry) continue;
            // The canvas itself, or an ancestor that took it with it.
            if (removed !== entry.element && !(removed as Element).contains?.(entry.element)) {
              continue;
            }
            // `destroy()` detaches the canvas too, so `[ss_free]` and
            // `destroyAll()` land here as well — by then the entry is already
            // gone from the registry and this loop simply does not see it.
            registry.destroy(name);
            persist();
          }
        }
      }
    });
  };

  /** Start watching the layer a player was just mounted on. */
  const observeLayerOf = (entry: SSPlayerEntry): void => {
    watchForDetachedCanvases();
    const parent = entry.element.parentElement;
    if (!parent) return;
    // Not `subtree`: a message layer mutates on every character typed out, and
    // this only ever needs the layer's own child list.
    state.detachObserver?.observe(parent, { childList: true });
  };

  /** Rebuild every player from the saved state (§3.3). */
  const restoreSavedPlayers = async (): Promise<void> => {
    // Tear down stale players first: module state survives a load, the DOM does
    // not. The overlays go with them — a load rebuilds Tyrano's layer divs, and
    // an overlay parented to the old one would draw nowhere.
    registry.destroyAll();
    destroyOverlays();
    state.talking = null;
    // Read the blanket-fade flag BEFORE rebuilding: createPlayer consults it
    // to decide whether a restored player is shown at all.
    state.layerHidden = readGlobalState(kag).layerHidden;
    const saved = readSavedPlayers(kag);
    let needsTalkHooks = false;
    // One player that cannot come back — a pack renamed since the save — must
    // not take the rest of the scene with it.
    const failed: string[] = [];
    for (const s of saved) {
      let entry: SSPlayerEntry;
      try {
        entry = await createPlayer(kag, {
          name: s.name,
          storage: s.storage,
          anime: s.anime,
          layer: s.layer,
          page: s.page as LayerPage,
          x: s.x,
          y: s.y,
          scale: s.scale,
          loop: s.loop,
          // Saves written before these fields existed default to "shown".
          visible: s.visible !== false,
          zindex: s.zindex,
          next: s.next,
          chara: s.chara,
          overrides: s.overrides,
        });
      } catch (err) {
        logFailure(`restoring "${s.name}"`, err);
        failed.push(`"${s.name}" (${(err as Error)?.message ?? String(err)})`);
        continue;
      }
      observeLayerOf(entry);
      if (s.playing) entry.player.play();
      else entry.player.pause();
      // After play/pause: starting playback rewinds, so seeking first would be
      // undone. A save written before frames were recorded has no frame.
      if (typeof s.frame === 'number') entry.player.frameNo = s.frame;
      // Re-arm the follow-up only for a player that is actually running;
      // a paused one would sit on a listener that can never fire.
      if (s.next && s.playing) armChain(entry, persist);
      if (s.chara) needsTalkHooks = true;
    }
    if (needsTalkHooks) ensureTalkHooks();
    persist();
    if (failed.length) throw new Error(`could not restore ${failed.join(', ')}.`);
  };

  // Restore without the scenario having to ask.
  //
  // A TyranoScript save holds variables and a scenario position, not the screen,
  // so anything built imperatively — including our canvases — has to be
  // re-created on load. The engine's window for that is `make.ks`, which it
  // `call`s just before resuming, and which is why the Spine and Live2D plugins
  // make authors write a `[*_restore]` there by hand.
  //
  // It also fires `load-beforemaking` immediately before that call, with the
  // saved variables already applied — so the plugin can do it itself. The
  // listener is registered without `temp`, which the engine documents as "delete
  // when a save is loaded", so it survives every load; `system: true` marks it as
  // ours rather than an author's.
  //
  // `kag.on` is guarded: older TyranoScript builds have no event system, and
  // there `[ss_restore]` in `make.ks` remains the way to do it.
  if (!state.restoreHooked && typeof kag.on === 'function') {
    state.restoreHooked = true;

    // `snapsave-start` is the first thing the engine does when taking a save,
    // before it deep-clones `stat` — so this is the one moment where writing
    // the current frame into the mirror gets it into the save file. Anywhere
    // later is too late: `storage-save` fires after the write, and the menu
    // saves a snapshot captured earlier rather than reading `stat` again.
    kag.on('snapsave-start', () => persist(), { system: true });

    kag.on(
      'load-beforemaking',
      () => {
        // `trigger` does not await, so the scenario resumes while this runs;
        // a `[ss_restore]` still sitting in make.ks awaits it below.
        //
        // Logged only: the scenario is already moving, so the engine's error
        // dialog would name whatever line it has reached. A `[ss_restore]` that
        // adopts this pass reports the failure against its own line.
        const pass = restoreSavedPlayers();
        pass.catch((err) => logFailure('automatic restore', err));
        state.restorePromise = pass;
      },
      { system: true },
    );
  }

  // [ss_restore] — restore explicitly. No longer required: `[plugin
  // name="ssplayer"]` wires the automatic hook above. Kept for engines without
  // an event system, for scenarios that want the load to *block* until the
  // players are back, and for anyone who already has it in `make.ks`.
  ftag.master_tag['ss_restore'] = {
    start() {
      runThenAdvance('ss_restore', async () => {
        // Never rebuild twice for one load: adopt the automatic pass instead.
        const running = state.restorePromise;
        state.restorePromise = null;
        await (running ?? restoreSavedPlayers());
      });
    },
  };

  return true;
}

/** Exposed for tests / teardown hooks. */
export function getRegistry(): PlayerRegistry {
  return registry;
}

/** Reset adapter state — test-only; lets each test start from a clean slate. */
export function __resetStateForTest(): void {
  registry.destroyAll();
  destroyOverlays();
  state.initialized = false;
  state.initPromise = null;
  state.layerHidden = false;
  state.talkHooked = false;
  state.talking = null;
  state.restoreHooked = false;
  state.restorePromise = null;
  state.detachObserver?.disconnect();
  state.detachObserver = null;
}
