import {
  applyPartOverrides,
  mergePartOverride,
  parsePartOverrideColor,
  prunePartOverridesForNewAnimation,
  removePartOverrides,
  SSCanvasPlayer,
  SSRuntimeManager,
  type SSBlendOp,
  type SSOverridePriority,
  type SSPartOverride,
} from '@spritestudio/ssplayer-webgl';
import { PlayerRegistry, type SSPlayerEntry } from './PlayerRegistry.js';
import { createLayerCanvas, getLayerElement, toTransform, type LayerPage } from './LayerCanvas.js';
import { persistPlayers, readSavedPlayers } from './SaveLoadBridge.js';
import { TyranoAudioManager } from './TyranoAudioManager.js';
import type { TyranoGlobal, TyranoKag } from './tyranoTypes.js';

// ---------------------------------------------------------------------------
// Adapter state (module scope, like Tyrano's own `[chara]` bookkeeping).
// ---------------------------------------------------------------------------

/** Live players keyed by `name`. Shared by every `[ss_*]` tag. */
const registry = new PlayerRegistry();

interface AdapterState {
  /** Whether `[ss_init]` has run `SSCanvasPlayer.initialize` (WASM ready). */
  initialized: boolean;
  /** In-flight init promise so a second `[ss_init]` awaits the first. */
  initPromise: Promise<void> | null;
}

const state: AdapterState = { initialized: false, initPromise: null };

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
 * Map a Tyrano `loop` attribute to `internalPlayer.setLoop`'s count:
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
 * Resolve an author path (ssab / wasm) against the Tyrano data root. Absolute
 * URLs and already-rooted paths pass through; a bare relative path is taken as
 * relative to `data/` (where Tyrano keeps `others/…`). Kept deliberately simple
 * for PT1 — richer resolution (Tyrano's own storage search) is a §7 follow-up.
 */
function resolveDataPath(p: string): string {
  if (/^(https?:)?\/\//.test(p) || p.startsWith('/') || p.startsWith('./') || p.startsWith('data/')) {
    return p;
  }
  return `data/${p}`;
}

function gameResolution(kag: TyranoKag): { w: number; h: number } {
  return { w: num(kag.config?.scWidth, 1280), h: num(kag.config?.scHeight, 720) };
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
    throw new Error('[ss] call [ss_init] before creating players.');
  }
  const layerEl = getLayerElement(kag, opts.layer, opts.page);
  if (!layerEl) throw new Error(`[ss] layer "${opts.layer}" (${opts.page}) not found on the page.`);

  const storageUrl = resolveDataPath(opts.storage);
  const { w, h } = gameResolution(kag);
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;

  const { canvas, bufferScale } = createLayerCanvas(layerEl, w, h, dpr, opts.name);
  // Disable the default Web Audio manager; we route SS sounds through
  // TyranoScript's howler instead (attached below, before setAnimation so the
  // core preloads through it). When audio is disabled, nothing is attached.
  const player = new SSCanvasPlayer(canvas, { autoStart: true, autoAudio: false });
  player.resize(w, h, dpr);
  ensureAudioManager()?.bindToPlayer(player);

  await player.load(storageUrl);

  // Pick the animation: the given name, else the ssab's first animation.
  let anime = opts.anime;
  if (!anime) {
    const buf = new Uint8Array(await (await fetch(storageUrl)).arrayBuffer());
    anime = SSRuntimeManager.extractAnimationNames(buf)[0] ?? '';
  }
  if (!anime) throw new Error(`[ss] no animation found in "${opts.storage}".`);
  await player.setAnimation(anime);

  player.setTransform(toTransform(opts.x, opts.y, opts.scale, bufferScale));
  player.internalPlayer.setLoop(opts.loop);
  // A fresh player means a fresh WASM context, whose override table starts
  // empty — so a restore has to put the saved overrides back. Must run after
  // setAnimation: before that, part names cannot resolve.
  applyPartOverrides(player, opts.overrides);

  const entry: SSPlayerEntry = {
    player,
    canvas,
    bufferScale,
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
      overrides: opts.overrides,
    },
  };
  registry.set(entry);
  return entry;
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
  const persist = () => persistPlayers(kag, registry);

  /** Run async tag work, then advance — even on error, so the scenario never stalls. */
  const runThenAdvance = (label: string, work: () => Promise<void>): void => {
    work()
      .catch((err) => console.error(`[ss] ${label} failed:`, (err as Error)?.stack ?? err))
      .finally(nextOrder);
  };

  /** Run synchronous tag work, then advance (errors logged, never stalls). */
  const runSync = (label: string, work: () => void): void => {
    try {
      work();
    } catch (err) {
      console.error(`[ss] ${label} failed:`, (err as Error)?.stack ?? err);
    } finally {
      nextOrder();
    }
  };

  /** Look up a player by name or throw a clear "call [ss_new] first" error. */
  const lookup = (label: string, name: string): SSPlayerEntry => {
    const entry = registry.get(name);
    if (!entry) throw new Error(`[${label}] player "${name}" not found (call [ss_new] first).`);
    return entry;
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
          state.initPromise = SSCanvasPlayer.initialize(wasm);
        }
        await state.initPromise;
        state.initialized = true;
      });
    },
  };

  // [ss_new name= storage= anime= layer= page= x= y= scale= loop=] — create a
  // player, load the ssab, mount its canvas on the layer, set animation, play.
  ftag.master_tag['ss_new'] = {
    vital: ['name', 'storage'],
    pm: { anime: '', layer: '0', page: 'fore', x: 0, y: 0, scale: 1, loop: 'true' },
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
        });
        entry.player.play();
        persist();
      });
    },
  };

  // [ss_play name= anime= loop= start=] — (re)play, optionally switching animation.
  ftag.master_tag['ss_play'] = {
    vital: ['name'],
    pm: { anime: '', loop: '', start: '' },
    start(pm) {
      runThenAdvance('ss_play', async () => {
        const { player, meta } = lookup('ss_play', String(pm.name));
        if (pm.anime) {
          meta.anime = String(pm.anime);
          await player.setAnimation(meta.anime);
          // Setting up an animation makes the runtime drop every override but
          // the Permanent ones; keep the saved mirror in step so a later
          // [ss_restore] cannot resurrect what the runtime discarded.
          meta.overrides = prunePartOverridesForNewAnimation(meta.overrides);
        }
        if (pm.loop !== undefined && pm.loop !== '') {
          meta.loop = loopCount(pm.loop);
        }
        player.internalPlayer.setLoop(meta.loop);
        player.play(num(pm.start, -1));
        persist();
      });
    },
  };

  // [ss_stop] / [ss_pause] / [ss_resume] name= — per-player playback control.
  ftag.master_tag['ss_stop'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_stop', () => {
        lookup('ss_stop', String(pm.name)).player.stop();
        persist();
      });
    },
  };
  ftag.master_tag['ss_pause'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_pause', () => {
        lookup('ss_pause', String(pm.name)).player.pause();
        persist();
      });
    },
  };
  ftag.master_tag['ss_resume'] = {
    vital: ['name'],
    start(pm) {
      runSync('ss_resume', () => {
        lookup('ss_resume', String(pm.name)).player.resume();
        persist();
      });
    },
  };

  // --- Part overrides (SDK docs: 40_components/65_override_layer) ---
  //
  // "Make this part this colour / this cell / hidden NOW", winning over the
  // keyframed animation — the SS6 PartsColorChange / CellChangeParts / HideSet
  // equivalents. Each tag applies the change to the live player and mirrors it
  // into the player's meta, so a save taken afterwards restores it.
  //
  // Attributes are read as words (blend="mul", priority="permanent") as well as
  // the raw runtime numbers, since they are written by hand in a scenario.

  /** Apply one override now and remember it for save/restore. */
  const setOverride = (label: string, name: string, entry: SSPartOverride): void => {
    const target = lookup(label, name);
    applyPartOverrides(target.player, [entry]);
    target.meta.overrides = mergePartOverride(target.meta.overrides, entry);
    persist();
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
          throw new Error(`[ss_part_color] cannot read color "${pm.color}" (try #FF0000 or #FF0000BF).`);
        }
        setOverride('ss_part_color', String(pm.name), {
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
        setOverride('ss_part_visible', String(pm.name), {
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
        setOverride('ss_part_cell', String(pm.name), {
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
        const entry = lookup('ss_part_clear', String(pm.name));
        const part = String(pm.part ?? '');
        if (part) {
          entry.player.clearPartColorOverride(part);
          entry.player.clearPartCellOverride(part);
          entry.player.clearPartVisibilityOverride(part);
        } else {
          entry.player.clearAllPartOverrides();
        }
        entry.meta.overrides = removePartOverrides(entry.meta.overrides, part || undefined);
        persist();
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
        entry = lookup('ss_wait', String(pm.name));
      } catch (err) {
        console.error(`[ss] ss_wait failed:`, (err as Error)?.stack ?? err);
        nextOrder();
        return;
      }
      const { player } = entry;
      if (!player.isPlaying) {
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
      const unsubEnd = player.onAnimationEnd(finish);
      const unsubLoop = player.onAnimationLoop(finish);
    },
  };

  // [ss_pos name= x= y= scale=] — instant reposition/scale via the renderer's
  // internal transform (anchor-accurate absolute placement, unlike a CSS [anim]).
  // Omitted attributes keep their current value.
  ftag.master_tag['ss_pos'] = {
    vital: ['name'],
    pm: { x: '', y: '', scale: '' },
    start(pm) {
      runSync('ss_pos', () => {
        const entry = lookup('ss_pos', String(pm.name));
        if (entry.tween) {
          cancelAnimationFrame(entry.tween);
          entry.tween = 0;
        }
        const m = entry.meta;
        m.x = num(pm.x, m.x);
        m.y = num(pm.y, m.y);
        m.scale = num(pm.scale, m.scale);
        entry.player.setTransform(toTransform(m.x, m.y, m.scale, entry.bufferScale));
        persist();
      });
    },
  };

  // [ss_move name= x= y= scale= time=] — tween to a new position/scale over
  // `time` ms (default 500), easing out. Non-blocking (like Tyrano's [anim]); the
  // save state is updated to the target immediately so a mid-tween save restores
  // at the destination. Falls back to an instant set where rAF is unavailable.
  ftag.master_tag['ss_move'] = {
    vital: ['name'],
    pm: { x: '', y: '', scale: '', time: '500' },
    start(pm) {
      runSync('ss_move', () => {
        const entry = lookup('ss_move', String(pm.name));
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
          entry.player.setTransform(toTransform(toX, toY, toS, entry.bufferScale));
          return;
        }
        const start = now();
        const step = (t: number): void => {
          const p = Math.min(1, (t - start) / time);
          const e = 1 - (1 - p) * (1 - p); // easeOutQuad
          entry.player.setTransform(
            toTransform(fromX + (toX - fromX) * e, fromY + (toY - fromY) * e, fromS + (toS - fromS) * e, entry.bufferScale),
          );
          entry.tween = p < 1 ? raf(step) : 0;
        };
        entry.tween = raf(step);
      });
    },
  };

  // [ss_restore] — rebuild every player from the saved state (§3.3). Place this
  // in `make.ks` (the .ks TyranoScript `call`s on load), AFTER an [ss_init], so
  // a loaded save re-creates its SS players. Tears down any stale players first
  // (module state survives a load; the DOM canvases do not).
  ftag.master_tag['ss_restore'] = {
    start() {
      runThenAdvance('ss_restore', async () => {
        registry.destroyAll();
        const saved = readSavedPlayers(kag);
        for (const s of saved) {
          const entry = await createPlayer(kag, {
            name: s.name,
            storage: s.storage,
            anime: s.anime,
            layer: s.layer,
            page: s.page as LayerPage,
            x: s.x,
            y: s.y,
            scale: s.scale,
            loop: s.loop,
            overrides: s.overrides,
          });
          if (s.playing) entry.player.play();
          else entry.player.pause();
        }
        persist();
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
  state.initialized = false;
  state.initPromise = null;
}
