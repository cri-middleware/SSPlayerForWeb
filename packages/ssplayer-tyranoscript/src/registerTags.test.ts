import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the WebGL renderer so no GL context / WASM is needed. ------------
// The fakes are defined INSIDE the factory (vi.mock is hoisted above module
// scope). Each player the adapter builds is recorded on `SSSurface.instances` so
// tests can assert on the calls it made; we reach the class back via the
// (now-mocked) import below.
//
// The surface/player split is mirrored here rather than flattened: the adapter
// constructs a surface and asks it for a player, and `surface.destroy()` is what
// tears the player down (the surface owns the GL context). Collapsing the two
// would stop the mock exercising that ownership.
vi.mock('@spritestudio/ssplayer-webgl', async () => {
  // The part-override store is pure data policy with no imports of its own, so
  // the REAL implementation is pulled straight from core's source — the adapter
  // must be tested against it, not against a second copy of the same rules.
  const store = await import('../../ssplayer-core/src/PartOverride.js');

  class FakePlayer {
    _playing = false;
    // The instantaneous heading, which the audio manager gates playback on
    // (SpriteStudio has no reverse audio). Forward unless a test says otherwise.
    _playingForward = true;
    _endListeners = new Set<() => void>();
    _loopListeners = new Set<() => void>();
    _frameListeners = new Set<(frame: number) => void>();
    _audioListeners = new Set<(e: unknown) => void>();
    _signalListeners = new Set<(e: { commandId: string | null }) => void>();
    audioManager: unknown = null;
    // `loopCount` is a real accessor on the player, so the fake records writes
    // through one too — asserting on a plain field would not catch the adapter
    // going back to poking `internalPlayer` directly.
    _loopWrites: number[] = [];
    get loopCount() { return this._loopWrites[this._loopWrites.length - 1] ?? -1; }
    set loopCount(v: number) { this._loopWrites.push(v); }
    frameNo = 0;
    speedScale = 1;
    order = 0;
    alpha = 1;
    // The overlay drives this from the element rect; tests only need the size,
    // since boxOrigin() halves it to place logical coordinates.
    box = { x: 0, y: 0, w: 1280, h: 720 };
    load = vi.fn().mockResolvedValue(undefined);
    // Read out of the pack when it is bound, so the adapter can pick a default
    // animation without downloading the .ssab a second time, and can reject a
    // name the pack does not have before changing anything.
    getAnimationNames = vi.fn(() => ['Anime_1', 'Anime_2', 'Talk', 'Idle']);
    setAnimation = vi.fn().mockResolvedValue(undefined);
    setTransform = vi.fn();
    setAnimationSection = vi.fn();
    setPlaybackDirection = vi.fn();
    // The runtime's three states, as the real player reports them: a pause is a
    // hold, so `isPlaying` stays true across one and `isPausing` is what tells
    // "held" from "stopped". A fake that folded the two into one flag would let
    // the adapter's paused/stopped handling drift without a test noticing.
    _pausing = false;
    play = vi.fn(() => { this._playing = true; this._pausing = false; });
    pause = vi.fn(() => { if (this._playing) this._pausing = true; });
    resume = vi.fn(() => { this._pausing = false; });
    stop = vi.fn(() => { this._playing = false; this._pausing = false; });
    // Like the core: teardown stops every sound on the player's audio manager.
    destroy = vi.fn(() => { (this.audioManager as { stopAll?: () => void } | null)?.stopAll?.(); });
    // Part overrides: the real player returns false when the runtime rejects a
    // call; the fake accepts everything so the adapter's own bookkeeping is what
    // these tests exercise.
    setPartColorOverride = vi.fn(() => true);
    setPartCellOverride = vi.fn(() => true);
    setPartVisibilityOverride = vi.fn(() => true);
    clearPartColorOverride = vi.fn(() => true);
    clearPartCellOverride = vi.fn(() => true);
    clearPartVisibilityOverride = vi.fn(() => true);
    clearAllPartOverrides = vi.fn(() => true);
    get isPlaying() { return this._playing; }
    get isPausing() { return this._pausing; }
    get isPlayingForward() { return this._playingForward; }
    onAnimationFinished(cb: () => void) { this._endListeners.add(cb); return () => this._endListeners.delete(cb); }
    onAnimationLooped(cb: () => void) { this._loopListeners.add(cb); return () => this._loopListeners.delete(cb); }
    onFrame(cb: (frame: number) => void) { this._frameListeners.add(cb); return () => this._frameListeners.delete(cb); }
    onAudio(cb: (e: unknown) => void) { this._audioListeners.add(cb); return () => this._audioListeners.delete(cb); }
    onSignal(cb: (e: { commandId: string | null }) => void) { this._signalListeners.add(cb); return () => this._signalListeners.delete(cb); }
    get currentAnimation() { return String(this.setAnimation.mock.calls.at(-1)?.[0] ?? ''); }
    _fireEnd() { for (const cb of [...this._endListeners]) cb(); }
    _fireFrame(frame: number) { for (const cb of [...this._frameListeners]) cb(frame); }
    _fireAudio(e: unknown) { for (const cb of [...this._audioListeners]) cb(e); }
    _fireLoop() { for (const cb of [...this._loopListeners]) cb(); }
    _fireSignal(commandId: string) { for (const cb of [...this._signalListeners]) cb({ commandId }); }

    // The character's element, exposed here so the existing assertions can reach
    // it from the player they were handed. It is a plain div now: the overlay
    // owns the only canvas on the layer.
    constructor(public element: HTMLElement, public options: unknown) {}
  }

  // One overlay per (layer, page), shared by every character on that layer —
  // mirrored here rather than flattened, because "destroying a character must
  // not destroy the layer's context" is exactly what these tests should catch.
  class FakeSSOverlay {
    static instances: FakePlayer[] = [];
    static live = new Map<string, FakeSSOverlay>();
    static getOrCreate = vi.fn((id: string, options?: { container?: HTMLElement }) => {
      let o = FakeSSOverlay.live.get(id);
      if (!o) {
        o = new FakeSSOverlay(id, options?.container ?? document.body);
        FakeSSOverlay.live.set(id, o);
      }
      return o;
    });

    players: FakePlayer[] = [];
    canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    surface = { invalidateOrder: vi.fn() };
    destroyed = false;

    // Resize notification. Real, not a stub returning undefined: the adapter
    // re-places every player on the layer from here, and `_fireResize` lets a
    // test drive that without a real window resize.
    resizeListeners = new Set<() => void>();
    onResized = (cb: () => void) => {
      this.resizeListeners.add(cb);
      return () => this.resizeListeners.delete(cb);
    };
    _fireResize() { for (const cb of [...this.resizeListeners]) cb(); }

    constructor(public id: string, container: HTMLElement) {
      container.appendChild(this.canvas);
    }

    createPlayer(el: HTMLElement, options?: unknown) {
      const player = new FakePlayer(el, options);
      this.players.push(player);
      FakeSSOverlay.instances.push(player);
      return player;
    }

    detach = vi.fn((player: FakePlayer) => {
      const i = this.players.indexOf(player);
      if (i !== -1) this.players.splice(i, 1);
    });

    destroy = vi.fn(() => {
      this.destroyed = true;
      this.canvas.remove();
      FakeSSOverlay.live.delete(this.id);
    });
  }

  return {
    ...store,
    SSOverlay: FakeSSOverlay,
    SSSurface: { initialize: vi.fn().mockResolvedValue(undefined) },
  };
});

import { SSOverlay as SSOverlayMock, SSSurface as SSSurfaceMock } from '@spritestudio/ssplayer-webgl';
import { registerSSTags, getRegistry, __resetStateForTest } from './registerTags.js';
import { SAVE_KEY, type SavedPlayer } from './SaveLoadBridge.js';
import type { TyranoGlobal, TyranoMasterTag } from './tyranoTypes.js';

// Typed handle to the mocked class (with the test-only static `instances`).
const FakeSSPlayer = SSOverlayMock as unknown as {
  instances: Array<{
    element: HTMLElement;
    order: number;
    _loopWrites: number[];
    loopCount: number;
    load: ReturnType<typeof vi.fn>;
    setAnimation: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    setAnimationSection: ReturnType<typeof vi.fn>;
    setPlaybackDirection: ReturnType<typeof vi.fn>;
    speedScale: number;
    frameNo: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    setPartColorOverride: ReturnType<typeof vi.fn>;
    setPartCellOverride: ReturnType<typeof vi.fn>;
    setPartVisibilityOverride: ReturnType<typeof vi.fn>;
    clearPartColorOverride: ReturnType<typeof vi.fn>;
    clearPartCellOverride: ReturnType<typeof vi.fn>;
    clearPartVisibilityOverride: ReturnType<typeof vi.fn>;
    clearAllPartOverrides: ReturnType<typeof vi.fn>;
    isPlaying: boolean;
    audioManager: unknown;
    _fireEnd(): void;
    _fireFrame(frame: number): void;
    _fireAudio(e: unknown): void;
    _fireLoop(): void;
    _fireSignal(commandId: string): void;
  }>;
};

// --- Mock TyranoScript harness -------------------------------------------

interface Harness {
  tyrano: TyranoGlobal;
  nextOrder: ReturnType<typeof vi.fn>;
  /** The engine's author-error dialog (`kag.error`). */
  error: ReturnType<typeof vi.fn>;
  /** Create a layer div, register it under `layer_page`, and attach to the DOM. */
  addLayer(layer?: string, page?: string): HTMLElement;
  /** Stand-in for the engine's `[text]` lip-sync bracket, wrapped by [ss_chara]. */
  text: {
    startLipSyncWithText: ReturnType<typeof vi.fn>;
    stopLipSyncWithText: ReturnType<typeof vi.fn>;
  };
  /** Say a line as `speaker`: fires the engine bracket [ss_chara] hooks into. */
  speak(speaker: string): void;
  /** End the current line. */
  endSpeaking(): void;
  /** Fire an engine event, the way `kag.trigger` does. */
  fire(event: string): void;
  /** Options each `kag.on` call was made with, keyed by event name. */
  listenerOptions: Map<string, Record<string, unknown> | undefined>;
}

function makeTyrano(): Harness {
  const nextOrder = vi.fn();
  const error = vi.fn();
  const layerEls = new Map<string, HTMLElement>();

  // TyranoScript's own [text] tag brackets character-by-character output with
  // this pair (it drives the engine's layered-character mouth frames); the
  // originals must keep running once [ss_chara] wraps them. Modelled the way
  // the engine builds master_tag — `object(tyrano.plugin.kag.tag.text)`, i.e.
  // an instance whose methods live on the prototype — so the test sees the
  // wrapper shadow the original rather than overwrite it.
  const textProto = {
    start: vi.fn(),
    startLipSyncWithText: vi.fn(),
    stopLipSyncWithText: vi.fn(),
  };
  const text = Object.create(textProto) as typeof textProto;

  // Mock TyranoScript's layer manager: getLayer returns a jQuery-like wrapper
  // over the registered layer div (mirrors kag.layer.getLayer(layer, page)).
  const getLayer = (layer: string | number, page: string) => {
    const el = layerEls.get(`${layer}_${page}`);
    const els = el ? [el] : [];
    return {
      length: els.length,
      get: (i: number) => els[i],
      show() {
        return this;
      },
      append(child: HTMLElement) {
        el?.appendChild(child);
        return this;
      },
      0: els[0],
    };
  };

  // The engine's event bus (kag.on / kag.trigger). Modelled because the
  // automatic restore hangs off `load-beforemaking`; an engine without it must
  // still work, which is what the `on: undefined` case below covers.
  const listeners = new Map<string, (() => void)[]>();
  const listenerOptions = new Map<string, Record<string, unknown> | undefined>();

  const tyrano: TyranoGlobal = {
    kag: {
      ftag: { master_tag: { text }, nextOrder, startTag: vi.fn() },
      config: { scWidth: 1280, scHeight: 720 },
      stat: { f: {}, current_speaker: '', charas: {}, jcharas: {} },
      variable: { f: {}, sf: {}, tf: {} },
      layer: { getLayer },
      error,
      // The engine's rule, as `kag.js` writes it: a short fixed duration while
      // skipping with `skipEffectIgnore` on, the given one otherwise.
      cutTimeWithSkip: (time: number) =>
        tyrano.kag.stat.is_skip === true && tyrano.kag.config.skipEffectIgnore === 'true' ? 70 : time,
      // `[eval]`: the script runs with the three variable scopes in reach.
      evalScript: (script: string) =>
        new Function('f', 'sf', 'tf', script)(tyrano.kag.stat.f, tyrano.kag.variable.sf, tyrano.kag.variable.tf),
      on: (names: string, callback: () => void, options?: Record<string, unknown>) => {
        for (const name of names.split(' ')) {
          listeners.set(name, [...(listeners.get(name) ?? []), callback]);
          listenerOptions.set(name, options);
        }
      },
    },
  };

  // The wrappers are installed on master_tag.text, so read them back through it.
  const textTag = () => tyrano.kag.ftag.master_tag.text as unknown as {
    startLipSyncWithText: () => void;
    stopLipSyncWithText: () => void;
  };

  return {
    tyrano,
    nextOrder,
    error,
    text: textProto, // the engine's originals, which the wrappers must still call
    addLayer(layer = '0', page = 'fore') {
      const el = document.createElement('div');
      el.className = `${layer}_${page}`;
      document.body.appendChild(el);
      layerEls.set(`${layer}_${page}`, el);
      return el;
    },
    speak(speaker: string) {
      tyrano.kag.stat.current_speaker = speaker;
      textTag().startLipSyncWithText();
    },
    endSpeaking() {
      textTag().stopLipSyncWithText();
    },
    fire(event: string) {
      for (const callback of listeners.get(event) ?? []) callback();
    },
    listenerOptions,
  };
}

/**
 * Fire a registered tag's `start` and wait until it advances the scenario.
 * Merges the tag's `pm` defaults first, exactly as the real Tyrano parser does
 * before invoking a custom tag.
 */
async function runTag(
  tag: TyranoMasterTag,
  pm: Record<string, unknown>,
  nextOrder: ReturnType<typeof vi.fn>,
): Promise<void> {
  const before = nextOrder.mock.calls.length;
  tag.start({ ...(tag.pm ?? {}), ...pm } as Record<string, any>);
  await vi.waitFor(() => expect(nextOrder.mock.calls.length).toBeGreaterThan(before));
}

describe('registerSSTags', () => {
  beforeEach(() => {
    __resetStateForTest();
    FakeSSPlayer.instances = [];
    (SSSurfaceMock as unknown as { initialize: ReturnType<typeof vi.fn> }).initialize.mockClear();
    document.body.innerHTML = '';
  });

  it('returns false when no Tyrano runtime is present', () => {
    expect(registerSSTags({} as TyranoGlobal)).toBe(false);
    expect(registerSSTags(undefined)).toBe(false);
  });

  it('registers the ss_* master tags', () => {
    const { tyrano } = makeTyrano();
    expect(registerSSTags(tyrano)).toBe(true);
    const tags = tyrano.kag.ftag.master_tag;
    // `text` is the engine's own tag, present in the harness; only ss_* are ours.
    expect(Object.keys(tags).filter((n) => n.startsWith('ss_')).sort()).toEqual([
      'ss_chara',
      'ss_direction',
      'ss_fadein',
      'ss_fadeout',
      'ss_free',
      'ss_free_all',
      'ss_hide',
      'ss_init',
      'ss_move',
      'ss_new',
      'ss_part_cell',
      'ss_part_clear',
      'ss_part_color',
      'ss_part_visible',
      'ss_pause',
      'ss_pause_all',
      'ss_play',
      'ss_pos',
      'ss_restore',
      'ss_resume',
      'ss_resume_all',
      'ss_section',
      'ss_seek',
      'ss_show',
      'ss_speed',
      'ss_stop',
      'ss_stop_audio',
      'ss_wait',
      'ss_wait_signal',
    ]);
    expect(tags.ss_new.vital).toEqual(['name', 'storage']);
  });

  it('ss_init initializes the WASM runtime and advances', async () => {
    const { tyrano, nextOrder } = makeTyrano();
    registerSSTags(tyrano);
    await runTag(tyrano.kag.ftag.master_tag.ss_init, { wasm: 'others/plugin/ssplayer/rt.wasm' }, nextOrder);
    expect((SSSurfaceMock as unknown as { initialize: ReturnType<typeof vi.fn> }).initialize).toHaveBeenCalledWith('data/others/plugin/ssplayer/rt.wasm');
  });

  it('ss_new mounts a canvas, loads, plays, and registers the player', async () => {
    const { tyrano, nextOrder, addLayer } = makeTyrano();
    registerSSTags(tyrano);
    const tags = tyrano.kag.ftag.master_tag;
    const layer = addLayer('0', 'fore');

    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, nextOrder);
    await runTag(
      tags.ss_new,
      { name: 'chr', storage: 'others/ssdata/Basic.ssab', anime: 'Anime_1', x: 640, y: 360, scale: 1, loop: 'true' },
      nextOrder,
    );

    // One player was created and its canvas overlaid on the layer.
    expect(FakeSSPlayer.instances).toHaveLength(1);
    const p = FakeSSPlayer.instances[0];
    expect(layer.contains(p.element)).toBe(true);
    // Textures resolve relative to the .ssab's own directory — no base arg is passed.
    expect(p.load).toHaveBeenCalledWith('data/others/ssdata/Basic.ssab');
    expect(p.setAnimation).toHaveBeenCalledWith('Anime_1');
    expect(p._loopWrites).toContain(-1); // loop=true → infinite
    expect(p.play).toHaveBeenCalled();

    // Coordinate mapping: logical (640,360) → buffer px at dpr 1 (jsdom) = (640,360).
    expect(p.setTransform).toHaveBeenCalledWith({ x: 0, y: 0, scaleX: 1, scaleY: 1 });

    expect(getRegistry().has('chr')).toBe(true);
  });

  it('ss_new picks the first animation when anime= is omitted, without re-reading the pack', async () => {
    const { tyrano, nextOrder, addLayer } = makeTyrano();
    registerSSTags(tyrano);
    const tags = tyrano.kag.ftag.master_tag;
    addLayer('0', 'fore');

    // The player already knows the names once it has loaded the pack, so the
    // adapter must ask it rather than downloading the .ssab all over again.
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    vi.stubGlobal('fetch', fetchMock);

    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'others/ssdata/Basic.ssab' }, nextOrder);

    const p = FakeSSPlayer.instances[0];
    expect(p.load).toHaveBeenCalledWith('data/others/ssdata/Basic.ssab');
    expect(p.getAnimationNames).toHaveBeenCalled();
    // getAnimationNames mock → ['Anime_1', …]; first is chosen.
    expect(p.setAnimation).toHaveBeenCalledWith('Anime_1');
    // The regression this guards: a second download of the same pack.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('ss_new errors (without stalling) when the layer is missing', async () => {
    const { tyrano, nextOrder } = makeTyrano();
    registerSSTags(tyrano);
    const tags = tyrano.kag.ftag.master_tag;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, nextOrder);
    // No `.0_fore` div exists → the tag reports an error but still advances.
    await runTag(tags.ss_new, { name: 'x', storage: 'a.ssab', anime: 'Anime_1' }, nextOrder);

    expect(FakeSSPlayer.instances).toHaveLength(0);
    expect(errSpy).toHaveBeenCalled();
    expect(getRegistry().has('x')).toBe(false);
    errSpy.mockRestore();
  });

  it('ss_play switches animation and replays an existing player', async () => {
    const { tyrano, nextOrder, addLayer } = makeTyrano();
    registerSSTags(tyrano);
    const tags = tyrano.kag.ftag.master_tag;
    addLayer('0', 'fore');

    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'a.ssab', anime: 'Anime_1' }, nextOrder);
    const p = FakeSSPlayer.instances[0];
    p.setAnimation.mockClear();
    p.play.mockClear();

    await runTag(tags.ss_play, { name: 'chr', anime: 'Anime_2', loop: 'false' }, nextOrder);

    expect(p.setAnimation).toHaveBeenCalledWith('Anime_2');
    expect(p._loopWrites.at(-1)).toBe(1); // loop=false → once
    expect(p.play).toHaveBeenCalled();
  });

  // --- lifecycle (save/load, free, pause) ----------------------------

  /** Boot an initialized harness with a `.0_fore` layer and one player 'chr'. */
  async function withPlayer(): Promise<Harness & { tags: Record<string, TyranoMasterTag> }> {
    const h = makeTyrano();
    registerSSTags(h.tyrano);
    const tags = h.tyrano.kag.ftag.master_tag;
    h.addLayer('0', 'fore');
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'others/ssdata/a.ssab', anime: 'Anime_1', x: 100, y: 200 }, h.nextOrder);
    return { ...h, tags };
  }

  const savedSlot = (h: Harness): Record<string, SavedPlayer> =>
    (h.tyrano.kag.stat.f[SAVE_KEY] ?? {}) as Record<string, SavedPlayer>;

  it('ss_new mirrors player state into the save target (stat.f)', async () => {
    const h = await withPlayer();
    const slot = savedSlot(h);
    expect(Object.keys(slot)).toEqual(['chr']);
    expect(slot.chr).toMatchObject({
      name: 'chr',
      storage: 'others/ssdata/a.ssab',
      anime: 'Anime_1',
      layer: '0',
      page: 'fore',
      x: 100,
      y: 200,
      playing: true,
    });
  });

  it('ss_free destroys the player and detaches its element, keeping the layer overlay', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const layer = document.getElementsByClassName('0_fore')[0];
    expect(layer.contains(p.element)).toBe(true);

    await runTag(h.tags.ss_free, { name: 'chr' }, h.nextOrder);

    expect(p.destroy).toHaveBeenCalled();
    expect(layer.contains(p.element)).toBe(false);
    // The overlay draws every character on this layer, so freeing one must not
    // take its canvas — and its GL context — with it.
    expect(layer.querySelector('canvas')).not.toBeNull();
    expect(getRegistry().has('chr')).toBe(false);
    expect(savedSlot(h)).toEqual({});
  });

  it('ss_pause / ss_resume / ss_stop drive the player and update the save slot', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_pause, { name: 'chr' }, h.nextOrder);
    expect(p.pause).toHaveBeenCalled();
    expect(savedSlot(h).chr.playing).toBe(false);

    await runTag(h.tags.ss_resume, { name: 'chr' }, h.nextOrder);
    expect(p.resume).toHaveBeenCalled();
    expect(savedSlot(h).chr.playing).toBe(true);

    await runTag(h.tags.ss_stop, { name: 'chr' }, h.nextOrder);
    expect(p.stop).toHaveBeenCalled();
    expect(savedSlot(h).chr.playing).toBe(false);
  });

  it('ss_restore rebuilds every saved player, honouring playing/paused state', async () => {
    const h = await withPlayer();
    // Add a second player and pause it, so the save slot has one playing + one paused.
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'others/ssdata/b.ssab', anime: 'Anime_2' }, h.nextOrder);
    await runTag(h.tags.ss_pause, { name: 'bg' }, h.nextOrder);
    expect(savedSlot(h).chr.playing).toBe(true);
    expect(savedSlot(h).bg.playing).toBe(false);

    // Simulate a load: the DOM canvases are gone but stat.f survives. Restore.
    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    // Two fresh players rebuilt, registered under their names.
    expect(FakeSSPlayer.instances).toHaveLength(2);
    expect(getRegistry().names().sort()).toEqual(['bg', 'chr']);
    const [chr, bg] = FakeSSPlayer.instances; // insertion order: chr then bg
    expect(chr.play).toHaveBeenCalled(); // was playing → resume playback
    expect(bg.pause).toHaveBeenCalled(); // was paused → stay paused
    expect(bg.play).not.toHaveBeenCalled();
  });

  it('restores by itself when the engine loads a save, without make.ks', async () => {
    const h = await withPlayer();
    expect(h.listenerOptions.get('load-beforemaking')).toMatchObject({ system: true });
    // Not `temp`: the engine documents that flag as "delete when a save is
    // loaded", which would drop the hook after the very first load.
    expect(h.listenerOptions.get('load-beforemaking')?.temp).toBeFalsy();

    // A load: stat.f survives, the canvases do not.
    FakeSSPlayer.instances.length = 0;
    h.fire('load-beforemaking');

    // Wait on the registry, not on the constructor: the instance exists from
    // the moment createPlayer starts, but it is only registered once its .ssab
    // has loaded.
    await vi.waitFor(() => expect(getRegistry().names()).toEqual(['chr']));
    expect(FakeSSPlayer.instances).toHaveLength(1);
  });

  it('does not rebuild twice when make.ks still calls ss_restore', async () => {
    const h = await withPlayer();

    FakeSSPlayer.instances.length = 0;
    h.fire('load-beforemaking');
    // make.ks runs immediately after the event, while the restore is in flight.
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    // One rebuild, not two — and [ss_restore] only advanced once it was done,
    // so a scenario written the old way still blocks until the players are back.
    expect(FakeSSPlayer.instances).toHaveLength(1);
    expect(getRegistry().names()).toEqual(['chr']);
  });

  it('still restores through ss_restore on an engine with no event bus', async () => {
    const h = makeTyrano();
    delete (h.tyrano.kag as { on?: unknown }).on;
    registerSSTags(h.tyrano);
    const tags = h.tyrano.kag.ftag.master_tag;
    h.addLayer('0', 'fore');
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'a.ssab', anime: 'Anime_1' }, h.nextOrder);

    FakeSSPlayer.instances.length = 0;
    await runTag(tags.ss_restore, {}, h.nextOrder);
    expect(FakeSSPlayer.instances).toHaveLength(1);
  });

  it('restores the frame the save was taken on', async () => {
    const h = await withPlayer();
    const [live] = FakeSSPlayer.instances;
    live.frameNo = 42;

    // The engine announces a save before it clones `stat`; that is when the
    // frame has to reach the mirror.
    h.fire('snapsave-start');
    expect(savedSlot(h).chr.frame).toBe(42);

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    const [rebuilt] = FakeSSPlayer.instances;
    expect(rebuilt.frameNo).toBe(42);
    // Seeking has to happen after play(), which rewinds.
    expect(rebuilt.play).toHaveBeenCalled();
  });

  it('releases a player whose canvas the engine removed', async () => {
    const h = await withPlayer();
    const [live] = FakeSSPlayer.instances;
    expect(getRegistry().names()).toEqual(['chr']);

    // What [freeimage layer=] does: empty the layer, canvas and all. (Reached
    // through the canvas, because addLayer() would register a fresh element.)
    live.element.parentElement!.replaceChildren();

    await vi.waitFor(() => expect(getRegistry().names()).toEqual([]));
    expect(live.destroy).toHaveBeenCalled();
    // The save slot follows, so a load does not resurrect it.
    expect(Object.keys(savedSlot(h))).toEqual([]);
  });

  it('resolves storage the way the engine resolves every other tag', async () => {
    const parseStorage = vi.fn((storage: string, folder: string) => `./${folder}/${storage}`);
    (globalThis as { $?: unknown }).$ = { parseStorage };

    const h = makeTyrano();
    registerSSTags(h.tyrano);
    h.addLayer('0', 'fore');
    const tags = h.tyrano.kag.ftag.master_tag;
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);
    await runTag(
      tags.ss_new,
      { name: 'chr', storage: 'others/ssdata/a.ssab', anime: 'Anime_1' },
      h.nextOrder,
    );

    // Delegated, with `data` as the folder — which is what this adapter has
    // always meant by a bare path.
    expect(parseStorage).toHaveBeenCalledWith('others/ssdata/a.ssab', 'data');
    expect(FakeSSPlayer.instances[0].load).toHaveBeenCalledWith('./data/others/ssdata/a.ssab');

    delete (globalThis as { $?: unknown }).$;
  });

  it('ss_free_all tears down every player and empties the save slot', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1' }, h.nextOrder);
    expect(getRegistry().names()).toHaveLength(2);

    await runTag(h.tags.ss_free_all, {}, h.nextOrder);

    expect(getRegistry().names()).toHaveLength(0);
    expect(savedSlot(h)).toEqual({});
    for (const p of FakeSSPlayer.instances) expect(p.destroy).toHaveBeenCalled();
  });

  // --- ss_wait / ss_pos / ss_move / audio ----------------------------

  // --- Author-facing errors ------------------------------------------------
  //
  // TyranoBuilder's preview has no console, so a failure has to reach the
  // engine's own error dialog — and while the scenario is still on the tag's
  // line, because that dialog names whatever line the scenario is on.

  /** Whether `error` was shown before the scenario advanced past the tag. */
  const reportedBeforeAdvancing = (h: Harness): boolean =>
    h.error.mock.invocationCallOrder[0] < h.nextOrder.mock.invocationCallOrder.at(-1)!;

  it('shows a tag failure in the engine error dialog, then advances', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTag(h.tags.ss_play, { name: 'ghost' }, h.nextOrder);

    expect(h.error).toHaveBeenCalledWith('[ss_play] player "ghost" not found (call [ss_new] first).');
    expect(reportedBeforeAdvancing(h)).toBe(true);
    expect(errSpy).toHaveBeenCalled(); // the stack still goes to the console
    errSpy.mockRestore();
  });

  it('reports an unwaited ss_show against its own line', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTag(h.tags.ss_show, { name: 'ghost', time: 500, wait: 'false' }, h.nextOrder);

    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('[ss_show] player "ghost"'));
    expect(reportedBeforeAdvancing(h)).toBe(true);
    errSpy.mockRestore();
  });

  it('rejects a misspelt next= at the tag, and changes nothing', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    p.setAnimation.mockClear();

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Wiat' }, h.nextOrder);

    expect(h.error).toHaveBeenCalledWith('[ss_play] next="Wiat" is not in others/ssdata/a.ssab.');
    // Neither half of the tag happened: no switch now, no follow-up later.
    expect(p.setAnimation).not.toHaveBeenCalled();
    p._fireEnd();
    expect(p.setAnimation).not.toHaveBeenCalled();
    expect(savedSlot(h).chr.anime).toBe('Anime_1');
    errSpy.mockRestore();
  });

  it('rejects a misspelt talk= when ss_chara runs, not when the line is spoken', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTag(h.tags.ss_chara, { name: 'chr', talk: 'Tlak' }, h.nextOrder);

    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('[ss_chara] talk="Tlak" is not in'));
    expect(savedSlot(h).chr.chara).toBeUndefined();
    errSpy.mockRestore();
  });

  it('frees what a failed ss_new had built', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const layer = document.getElementsByClassName('0_fore')[0]; // `.0_fore` is not a valid selector

    await runTag(h.tags.ss_new, { name: 'bad', storage: 'others/ssdata/a.ssab', anime: 'Nope' }, h.nextOrder);

    const bad = FakeSSPlayer.instances[1];
    const overlay = (SSOverlayMock as unknown as {
      live: Map<string, { detach: ReturnType<typeof vi.fn> }>;
    }).live.get('ss_0_fore')!;
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('[ss_new] anime="Nope" is not in'));
    expect(getRegistry().has('bad')).toBe(false);
    // Otherwise `[anim name="bad"]` would still find an element on the layer.
    expect(layer.querySelector('.bad')).toBeNull();
    expect(overlay.detach).toHaveBeenCalledWith(bad);
    expect(bad.destroy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('restores the players it can and reports the one it cannot', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'others/ssdata/b.ssab', anime: 'Anime_2' }, h.nextOrder);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // The pack changed after the save: its animation is gone.
    savedSlot(h).chr.anime = 'Removed';

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    expect(getRegistry().names()).toEqual(['bg']);
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('[ss_restore] could not restore "chr"'));
    errSpy.mockRestore();
  });

  it('only logs a failed automatic restore, which no line caused', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    savedSlot(h).chr.anime = 'Removed';

    h.fire('load-beforemaking');

    await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith(
      '[ss] automatic restore failed:', expect.stringContaining('could not restore "chr"'),
    ));
    expect(h.error).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('still advances on an engine without an error dialog', async () => {
    const h = await withPlayer();
    delete (h.tyrano.kag as { error?: unknown }).error;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTag(h.tags.ss_stop, { name: 'ghost' }, h.nextOrder);

    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('ss_wait defers nextOrder until the animation ends', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const before = h.nextOrder.mock.calls.length;

    // Player is playing → ss_wait must NOT advance yet.
    h.tags.ss_wait.start({ name: 'chr' } as Record<string, any>);
    await Promise.resolve();
    expect(h.nextOrder.mock.calls.length).toBe(before);

    // Animation end → now it advances.
    p._fireEnd();
    expect(h.nextOrder.mock.calls.length).toBe(before + 1);
  });

  it('ss_wait advances immediately when the player is not playing', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    p.stop(); // not playing
    await runTag(h.tags.ss_wait, { name: 'chr' }, h.nextOrder);
    // runTag already asserts nextOrder fired; no listeners needed.
    expect(p.isPlaying).toBe(false);
  });

  it('ss_pos repositions instantly via setTransform and updates the save slot', async () => {
    const h = await withPlayer(); // created at x=100 y=200
    const p = FakeSSPlayer.instances[0];
    p.setTransform.mockClear();

    await runTag(h.tags.ss_pos, { name: 'chr', x: 300, y: 50, scale: 2 }, h.nextOrder);

    // dpr 1 in jsdom → bufferScale 1: transform == logical coords, scale composed.
    expect(p.setTransform).toHaveBeenCalledWith({ x: -340, y: -310, scaleX: 2, scaleY: 2 });
    expect(savedSlot(h).chr).toMatchObject({ x: 300, y: 50, scale: 2 });
  });

  it('re-places every player on the layer when the overlay resizes', async () => {
    const h = await withPlayer(); // created at x=100 y=200, scale 1
    const p = FakeSSPlayer.instances[0];
    const overlay = (SSOverlayMock as unknown as { live: Map<string, { canvas: HTMLCanvasElement; _fireResize(): void }> })
      .live.get('ss_0_fore')!;
    p.setTransform.mockClear();

    // The window got wider: the overlay's drawing buffer is now 2x the game's
    // logical width, so the same logical placement is twice as many buffer px.
    overlay.canvas.width = 2560;
    overlay._fireResize();

    // Placement is stored in logical px and re-derived, so it survives the
    // resize instead of drifting on a scale captured at [ss_new].
    expect(p.setTransform).toHaveBeenCalledWith({ x: 200 - 640, y: 400 - 360, scaleX: 2, scaleY: 2 });
  });

  it('ss_move commits the destination to the save slot (instant when time=0)', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    p.setTransform.mockClear();

    await runTag(h.tags.ss_move, { name: 'chr', x: 800, y: 100, time: 0 }, h.nextOrder);

    expect(savedSlot(h).chr).toMatchObject({ x: 800, y: 100 });
    // time=0 → instant set to the target.
    expect(p.setTransform).toHaveBeenLastCalledWith({ x: 160, y: -260, scaleX: 1, scaleY: 1 });
  });

  it('audio: onAudio events play through window.Howl (howler)', async () => {
    const played: string[][] = [];
    class FakeHowl {
      constructor(public opts: { src: string[] }) {}
      volume() { return this; }
      stop() { return this; }
      on() { return this; }
      off() { return this; }
      unload() {}
      play() { played.push(this.opts.src); return 1; }
    }
    vi.stubGlobal('Howl', FakeHowl);

    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    // The Tyrano audio manager was attached (autoAudio replaced).
    expect(p.audioManager).toBeTruthy();

    p._fireAudio({ soundName: 'attack_se', loopNum: 1 });
    expect(played).toEqual([['data/sound/attack_se.ogg']]);

    p._fireAudio({ soundName: 'hit', loopNum: 1 });
    expect(played[1]).toEqual(['data/sound/hit.ogg']);

    // Reverse (or a ping-pong return leg): the player still reports the key —
    // it is an observation channel — but nothing sounds, because SpriteStudio
    // has no reverse audio and the gate lives on the playing, not the report.
    p._playingForward = false;
    p._fireAudio({ soundName: 'attack_se', loopNum: 1 });
    expect(played).toHaveLength(2);
    p._playingForward = true;

    vi.unstubAllGlobals();
  });

  /** A howler stand-in recording what each sound was asked to do. */
  class RecordingHowl {
    static all: RecordingHowl[] = [];
    played = 0;
    stopped = 0;
    unloaded = false;
    volumes: number[] = [];
    constructor(public opts: { src: string[]; volume?: number }) {
      RecordingHowl.all.push(this);
      if (opts.volume !== undefined) this.volumes.push(opts.volume);
    }
    on() { return this; }
    off() { return this; }
    volume(v: number) { this.volumes.push(v); return this; }
    stop() { this.stopped++; return this; }
    unload() { this.unloaded = true; }
    play() { this.played++; return 1; }
  }

  it('audio: plays a sound loopNum times, never forever', async () => {
    // A howler stand-in that can end a sound, the way a finished clip does.
    const plays: number[] = [];
    let ends: Array<() => void> = [];
    class EndingHowl {
      constructor(public opts: { src: string[] }) {}
      volume() { return this; }
      stop() { return this; }
      unload() {}
      on(_event: string, listener: () => void) { ends.push(listener); return this; }
      off(_event: string, listener: () => void) { ends = ends.filter((l) => l !== listener); return this; }
      play(id?: number) { plays.push(id ?? 7); return 7; }
      end() { for (const l of [...ends]) l(); }
    }
    vi.stubGlobal('Howl', EndingHowl);
    await withPlayer();
    const p = FakeSSPlayer.instances[0];

    // loop_num is a play count (SDK: no infinite loop), so 3 is three plays.
    p._fireAudio({ soundName: 'step', loopNum: 3 });
    const howl = (p.audioManager as unknown as { howls: Map<string, EndingHowl> }).howls.get('data/sound/step.ogg')!;
    howl.end();
    howl.end();
    howl.end(); // the third play ends: nothing more
    expect(plays).toEqual([7, 7, 7]);
    expect(ends).toHaveLength(0);

    // And 0, which the old code looped forever on, plays once.
    plays.length = 0;
    p._fireAudio({ soundName: 'step', loopNum: 0 });
    howl.end();
    expect(plays).toEqual([7]);
    vi.unstubAllGlobals();
  });

  it('audio: freeing one player stops and unloads its sounds, and nobody else\'s', async () => {
    RecordingHowl.all = [];
    vi.stubGlobal('Howl', RecordingHowl);
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'others/ssdata/b.ssab' }, h.nextOrder);
    const [chr, bg] = FakeSSPlayer.instances;
    chr._fireAudio({ soundName: 'engine', loopNum: 1 }); // a sound each
    bg._fireAudio({ soundName: 'rain', loopNum: 1 });
    const [engine, rain] = RecordingHowl.all;

    await runTag(h.tags.ss_free, { name: 'chr' }, h.nextOrder);

    expect(engine.stopped).toBeGreaterThan(0);
    expect(engine.unloaded).toBe(true);
    // A shared manager used to take the other character's sound down too.
    expect(rain.stopped).toBe(0);
    expect(rain.unloaded).toBe(false);
    vi.unstubAllGlobals();
  });

  it('[ss_stop_audio] cuts one player\'s sounds, repeats included, and nobody else\'s', async () => {
    class RepeatingHowl {
      static all: RepeatingHowl[] = [];
      stopped = 0;
      ends: Array<() => void> = [];
      constructor(public opts: { src: string[] }) {
        RepeatingHowl.all.push(this);
      }
      volume() { return this; }
      unload() {}
      stop() { this.stopped++; return this; }
      on(_event: string, listener: () => void) { this.ends.push(listener); return this; }
      off(_event: string, listener?: () => void) {
        this.ends = listener ? this.ends.filter((l) => l !== listener) : [];
        return this;
      }
      play() { return 1; }
    }
    vi.stubGlobal('Howl', RepeatingHowl);
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'others/ssdata/b.ssab' }, h.nextOrder);
    const [chr, bg] = FakeSSPlayer.instances;
    chr._fireAudio({ soundName: 'engine', loopNum: 3 });
    bg._fireAudio({ soundName: 'rain', loopNum: 3 });
    const [engine, rain] = RepeatingHowl.all;

    await runTag(h.tags.ss_stop_audio, { name: 'chr' }, h.nextOrder);

    expect(engine.stopped).toBe(1);
    // Each repeat waits on the `end` of the play before it. howler fires no
    // `end` on a stop, so they would not play anyway, but their listeners
    // would stay behind.
    expect(engine.ends).toHaveLength(0);
    expect(rain.stopped).toBe(0);
    expect(rain.ends).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('audio: resolves sound files the way the engine resolves every other path', async () => {
    RecordingHowl.all = [];
    vi.stubGlobal('Howl', RecordingHowl);
    vi.stubGlobal('$', { parseStorage: (path: string, folder: string) => `./${folder}/${path}` });
    await withPlayer();
    FakeSSPlayer.instances[0]._fireAudio({ soundName: 'attack_se', loopNum: 1 });
    expect(RecordingHowl.all[0].opts.src).toEqual(['./data/sound/attack_se.ogg']);
    vi.unstubAllGlobals();
  });

  it('audio: plays at the game\'s SE volume, and follows [seopt] while looping', async () => {
    RecordingHowl.all = [];
    vi.stubGlobal('Howl', RecordingHowl);
    const h = await withPlayer();
    // The engine global the manager reads, with the config screen at 50.
    h.tyrano.kag.config.defaultSeVolume = '50';
    vi.stubGlobal('TYRANO', h.tyrano);
    vi.stubGlobal('$', { parseVolume: (v: string) => Number(v) / 100 });

    FakeSSPlayer.instances[0]._fireAudio({ soundName: 'engine', loopNum: 0 });
    const engine = RecordingHowl.all[0];
    expect(engine.volumes.at(-1)).toBe(0.5);

    // The slider moves: [seopt] sets the volume, then the looping sound follows.
    h.tyrano.kag.config.defaultSeVolume = '20';
    h.fire('tag-seopt');
    await Promise.resolve();
    expect(engine.volumes.at(-1)).toBe(0.2);
    vi.unstubAllGlobals();
  });

  // --- Part overrides -----------------------------------------------------
  //
  // Each tag has to do two things: drive the live player now, and mirror the
  // change into the save slot so [ss_restore] can put it back on a player whose
  // WASM context (and its override table) was rebuilt from nothing.

  it('ss_part_color applies the override and mirrors it into the save slot', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#0033FFBF' }, h.nextOrder);

    // Defaults: blend="mix" (0), priority="anime" (HoldUntilNextAnimation = 1).
    expect(p.setPartColorOverride).toHaveBeenCalledWith('apple', 0x0033ffbf, 0, 1);
    expect(savedSlot(h).chr.overrides).toEqual([
      { kind: 'color', part: 'apple', blendOp: 0, rgba: 0x0033ffbf, priority: 1 },
    ]);
  });

  it('ss_part_color reads blend and priority as words as well as numbers', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#F00', blend: 'mul', priority: 'permanent' }, h.nextOrder);
    expect(p.setPartColorOverride).toHaveBeenLastCalledWith('apple', 0xff0000ff, 1, 2);

    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#F00', blend: '3', priority: '0' }, h.nextOrder);
    expect(p.setPartColorOverride).toHaveBeenLastCalledWith('apple', 0xff0000ff, 3, 0);
  });

  it('ss_part_color reads TyranoScript\'s own 0xRRGGBB colours', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    // What [ptext color=] takes, and what TyranoBuilder's colour picker stores.
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '0x0033ff' }, h.nextOrder);
    expect(p.setPartColorOverride).toHaveBeenLastCalledWith('apple', 0x0033ffff, 0, 1);
  });

  it('ss_part_color leaves the player alone when the colour cannot be read', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    // Errors are logged and the scenario still advances — a typo must not stall it.
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: 'crimson' }, h.nextOrder);

    expect(p.setPartColorOverride).not.toHaveBeenCalled();
    expect(savedSlot(h).chr.overrides ?? []).toEqual([]);
  });

  it('ss_part_visible and ss_part_cell record alongside each other', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_part_visible, { name: 'chr', part: 'heta', cascade: 'true' }, h.nextOrder);
    await runTag(h.tags.ss_part_cell, { name: 'chr', part: 'apple', cellmap: 'Ringo', cell: 'effect3' }, h.nextOrder);

    expect(p.setPartVisibilityOverride).toHaveBeenCalledWith('heta', true, true);
    expect(p.setPartCellOverride).toHaveBeenCalledWith('apple', 'Ringo', 'effect3', 1);
    expect(savedSlot(h).chr.overrides).toEqual([
      { kind: 'visibility', part: 'heta', hide: true, cascade: true },
      { kind: 'cell', part: 'apple', cellmap: 'Ringo', cell: 'effect3', priority: 1 },
    ]);
  });

  it('ss_part_clear drops one part, or every part when none is named', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#F00' }, h.nextOrder);
    await runTag(h.tags.ss_part_visible, { name: 'chr', part: 'heta' }, h.nextOrder);

    await runTag(h.tags.ss_part_clear, { name: 'chr', part: 'apple' }, h.nextOrder);
    expect(p.clearPartColorOverride).toHaveBeenCalledWith('apple');
    expect(savedSlot(h).chr.overrides).toEqual([{ kind: 'visibility', part: 'heta', hide: true, cascade: false }]);

    await runTag(h.tags.ss_part_clear, { name: 'chr' }, h.nextOrder);
    expect(p.clearAllPartOverrides).toHaveBeenCalled();
    expect(savedSlot(h).chr.overrides).toEqual([]);
  });

  it('ss_play with a new anime prunes everything the runtime drops', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#F00', priority: 'permanent' }, h.nextOrder);
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'heta', color: '#0F0' }, h.nextOrder);
    await runTag(h.tags.ss_part_visible, { name: 'chr', part: 'heta' }, h.nextOrder);

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2' }, h.nextOrder);

    // Only the Permanent colour survives a new setup — same rule as the runtime.
    expect(savedSlot(h).chr.overrides).toEqual([
      { kind: 'color', part: 'apple', blendOp: 0, rgba: 0xff0000ff, priority: 2 },
    ]);
  });

  // --- show / hide / fade, z-order, chained animations, speaker link --
  //
  // Parity with the official Spine ([spine_new]/[spine_show]/[spine_hide]/
  // [spine_fadein]/[spine_anim next_motion]) and Live2D ([live2d_new jname=])
  // plugins. The through-line: a player can exist without being on screen, and
  // animation follow-ups must not block the scenario the way [ss_wait] does.

  /**
   * True when the character element is laid out and fully opaque. The overlay
   * reads exactly these two properties — display for whether to track it at all,
   * computed opacity for the player's alpha — so this is the same signal the
   * renderer sees.
   */
  const shown = (el: HTMLElement): boolean =>
    el.style.display !== 'none' && el.style.opacity !== '0';

  it('ss_new visible="false" loads the player without displaying it', async () => {
    const h = makeTyrano();
    registerSSTags(h.tyrano);
    const tags = h.tyrano.kag.ftag.master_tag;
    h.addLayer('0', 'fore');
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);

    await runTag(tags.ss_new, { name: 'chr', storage: 'a.ssab', anime: 'Anime_1', visible: 'false' }, h.nextOrder);

    const p = FakeSSPlayer.instances[0];
    // Loaded and registered (that is the point of preloading) but off screen.
    expect(p.load).toHaveBeenCalled();
    expect(shown(p.element)).toBe(false);
    expect((h.tyrano.kag.stat.f[SAVE_KEY] as Record<string, SavedPlayer>).chr.visible).toBe(false);
  });

  it('ss_show reveals a preloaded player, repositioning it as it appears', async () => {
    const h = makeTyrano();
    registerSSTags(h.tyrano);
    const tags = h.tyrano.kag.ftag.master_tag;
    h.addLayer('0', 'fore');
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'a.ssab', anime: 'Anime_1', visible: 'false' }, h.nextOrder);
    const p = FakeSSPlayer.instances[0];
    p.setAnimation.mockClear();

    await runTag(tags.ss_show, { name: 'chr', x: 400, y: 300, scale: 2, anime: 'Anime_2' }, h.nextOrder);

    expect(shown(p.element)).toBe(true);
    expect(p.setTransform).toHaveBeenLastCalledWith({ x: -240, y: -60, scaleX: 2, scaleY: 2 });
    expect(p.setAnimation).toHaveBeenCalledWith('Anime_2');
    expect(savedSlot(h).chr).toMatchObject({ visible: true, x: 400, y: 300, anime: 'Anime_2' });
  });

  it('ss_hide takes the player off screen without destroying it', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    expect(shown(p.element)).toBe(true);

    await runTag(h.tags.ss_hide, { name: 'chr' }, h.nextOrder);

    expect(shown(p.element)).toBe(false);
    // Unlike [ss_free]: still loaded, still registered, still in the save.
    expect(p.destroy).not.toHaveBeenCalled();
    expect(getRegistry().has('chr')).toBe(true);
    expect(savedSlot(h).chr.visible).toBe(false);

    await runTag(h.tags.ss_show, { name: 'chr' }, h.nextOrder);
    expect(shown(p.element)).toBe(true);
  });

  it('ss_fadeout hides every player and ss_fadein brings back only the visible ones', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1' }, h.nextOrder);
    const [chr, bg] = FakeSSPlayer.instances;
    // 'bg' is individually hidden before the blanket fade.
    await runTag(h.tags.ss_hide, { name: 'bg' }, h.nextOrder);

    await runTag(h.tags.ss_fadeout, { time: 0 }, h.nextOrder);
    expect(shown(chr.element)).toBe(false);
    expect(shown(bg.element)).toBe(false);

    await runTag(h.tags.ss_fadein, { time: 0 }, h.nextOrder);
    // 'chr' comes back; 'bg' stays hidden because it was hidden on its own.
    expect(shown(chr.element)).toBe(true);
    expect(shown(bg.element)).toBe(false);
  });

  it('ss_show cannot override a blanket ss_fadeout', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_fadeout, { time: 0 }, h.nextOrder);

    await runTag(h.tags.ss_show, { name: 'chr', time: 0 }, h.nextOrder);

    // The player is marked visible, but the layer-wide fade still wins…
    expect(savedSlot(h).chr.visible).toBe(true);
    expect(shown(p.element)).toBe(false);
    // …until the fade is lifted.
    await runTag(h.tags.ss_fadein, { time: 0 }, h.nextOrder);
    expect(shown(p.element)).toBe(true);
  });

  it('zindex orders players inside one layer, from ss_new and ss_pos alike', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1', zindex: 5 }, h.nextOrder);
    const [chr, bg] = FakeSSPlayer.instances;
    // Characters share one canvas per layer, so zindex is the player's draw
    // order rather than a CSS z-index on a per-character canvas.
    expect(bg.order).toBe(5);
    expect(chr.order).toBe(0);

    await runTag(h.tags.ss_pos, { name: 'chr', zindex: 10 }, h.nextOrder);
    expect(chr.order).toBe(10);
    expect(savedSlot(h).chr.zindex).toBe(10);
  });

  it('ss_play next= chains to a follow-up animation without blocking the scenario', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    p.setAnimation.mockClear();

    // The tag advances immediately — the whole point versus [ss_wait].
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_2');
    // `next=` with no loop= plays the first animation once (else the end never comes).
    expect(p._loopWrites.at(-1)).toBe(1);
    expect(savedSlot(h).chr.next).toEqual({ anime: 'Anime_1', loop: -1, atframe: undefined });

    p._fireEnd();
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
    expect(p._loopWrites.at(-1)).toBe(-1); // idle loops
    await vi.waitFor(() => expect(savedSlot(h).chr).toMatchObject({ anime: 'Anime_1', next: undefined }));
  });

  it('ss_play atframe= chains early, at the given frame', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    p.setAnimation.mockClear();

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1', atframe: 20 }, h.nextOrder);

    p._fireFrame(19);
    expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_2'); // not yet
    p._fireFrame(20);
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
  });

  it('ss_play atframe= still chains at the end when the animation stops short of that frame', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    p.setAnimation.mockClear();

    // Frame 20 never comes: the animation plays once and ends first.
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', loop: 'false', next: 'Anime_1', atframe: 20 }, h.nextOrder);
    p._fireFrame(19);
    expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_2');
    p._fireEnd();
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
  });

  it('an unstated loop= is the default, not the single play a pending next= set', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    expect(p._loopWrites.at(-1)).toBe(1);
    // The entrance has not ended yet — a quick click gets here before it does.
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_1', next: 'Anime_2', atframe: 10 }, h.nextOrder);
    expect(p._loopWrites.at(-1)).toBe(-1);
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2' }, h.nextOrder);
    expect(p._loopWrites.at(-1)).toBe(-1);
    expect(savedSlot(h).chr.loop).toBe(-1);
  });

  it('a new ss_play cancels a follow-up that has not fired yet', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_1', loop: 'true' }, h.nextOrder);
    p.setAnimation.mockClear();

    p._fireEnd(); // the superseded chain must be gone
    await Promise.resolve();
    expect(p.setAnimation).not.toHaveBeenCalled();
    expect(savedSlot(h).chr.next).toBeUndefined();
  });

  it('ss_chara swaps to the talk animation while its speaker is talking', async () => {
    const h = await withPlayer(); // 'chr' is showing Anime_1
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_chara, { name: 'chr', jname: 'あかね', talk: 'Talk', idle: 'Idle' }, h.nextOrder);
    p.setAnimation.mockClear();

    h.speak('あかね');
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Talk'));
    // The engine's own lip-sync still runs — we wrap it, we don't replace it.
    expect(h.text.startLipSyncWithText).toHaveBeenCalled();
    // Talk is transient decoration: the save still holds the scenario's animation,
    // so a save taken mid-line does not restore the character stuck talking.
    expect(savedSlot(h).chr.anime).toBe('Anime_1');

    h.endSpeaking();
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Idle'));
    expect(h.text.stopLipSyncWithText).toHaveBeenCalled();
  });

  it('ss_chara ignores lines spoken by anyone else, and matches ids via jcharas', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    // Tyrano's own name->id map, as [chara_new name="akane" jname="あかね"] builds it.
    h.tyrano.kag.stat.jcharas = { あかね: 'akane' };
    await runTag(h.tags.ss_chara, { name: 'chr', jname: 'あかね', talk: 'Talk' }, h.nextOrder);
    p.setAnimation.mockClear();

    h.speak('someone_else');
    await Promise.resolve();
    expect(p.setAnimation).not.toHaveBeenCalled();
    h.endSpeaking();

    // `#あかね` reaches the engine as the id `akane`; the binding still matches.
    h.speak('akane');
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Talk'));

    // No idle= → fall back to whatever the scenario last set.
    h.endSpeaking();
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
  });

  it('ss_chara talk="" unbinds the speaker link', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_chara, { name: 'chr', jname: 'あかね', talk: 'Talk' }, h.nextOrder);
    await runTag(h.tags.ss_chara, { name: 'chr', talk: '' }, h.nextOrder);
    p.setAnimation.mockClear();

    h.speak('あかね');
    await Promise.resolve();
    expect(p.setAnimation).not.toHaveBeenCalled();
    expect(savedSlot(h).chr.chara).toBeUndefined();
  });

  it('ss_move wait="true" holds the scenario until the tween lands', async () => {
    const h = await withPlayer();
    const before = h.nextOrder.mock.calls.length;

    h.tags.ss_move.start({ name: 'chr', x: 800, time: 150, wait: 'true' } as Record<string, any>);
    await Promise.resolve();
    expect(h.nextOrder.mock.calls.length).toBe(before); // still moving

    await vi.waitFor(() => expect(h.nextOrder.mock.calls.length).toBe(before + 1));
  });

  // --- Speed, seek, section, direction ---------------------------------------
  //
  // The runtime keeps speed and direction across an animation change and drops
  // the section, and the save has to mirror exactly that.

  it('ss_speed sets the speed, keeps it across an animation change, and saves it', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_speed, { name: 'chr', speed: '0.5' }, h.nextOrder);
    expect(p.speedScale).toBe(0.5);

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2' }, h.nextOrder);
    expect(savedSlot(h).chr.speed).toBe(0.5);

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);
    expect(FakeSSPlayer.instances[0].speedScale).toBe(0.5);
  });

  it('ss_speed refuses a speed that is not a number', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runTag(h.tags.ss_speed, { name: 'chr', speed: 'fast' }, h.nextOrder);
    expect(h.error).toHaveBeenCalledWith('[ss_speed] speed="fast" is not a number.');
    expect(FakeSSPlayer.instances[0].speedScale).toBe(1);
    errSpy.mockRestore();
  });

  it('ss_seek moves the playhead', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_seek, { name: 'chr', frame: '12' }, h.nextOrder);
    expect(FakeSSPlayer.instances[0].frameNo).toBe(12);
  });

  it('ss_section limits playback, taking an omitted side as the edge', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_section, { name: 'chr', start: '5' }, h.nextOrder);
    expect(p.setAnimationSection).toHaveBeenLastCalledWith(5, -1);
    expect(savedSlot(h).chr.section).toEqual({ start: 5, end: -1 });

    await runTag(h.tags.ss_section, { name: 'chr' }, h.nextOrder); // back to the whole animation
    expect(p.setAnimationSection).toHaveBeenLastCalledWith(-1, -1);
    expect(savedSlot(h).chr.section).toBeUndefined();
  });

  it('an animation change drops the section, as the runtime does', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_section, { name: 'chr', start: '5', end: '9' }, h.nextOrder);
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    expect(savedSlot(h).chr.section).toBeUndefined();

    // …and so does the follow-up the chain switches to.
    await runTag(h.tags.ss_section, { name: 'chr', start: '2', end: '3' }, h.nextOrder);
    FakeSSPlayer.instances[0]._fireEnd();
    expect(savedSlot(h).chr.section).toBeUndefined();
  });

  it('restores the section after the animation is set up, which resets it', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_section, { name: 'chr', start: '5', end: '9' }, h.nextOrder);

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    const p = FakeSSPlayer.instances[0];
    expect(p.setAnimationSection).toHaveBeenCalledWith(5, 9);
    expect(p.setAnimationSection.mock.invocationCallOrder[0])
      .toBeGreaterThan(p.setAnimation.mock.invocationCallOrder.at(-1)!);
  });

  it('puts the section back when a talk animation returns to the scenario\'s own', async () => {
    const h = await withPlayer(); // showing Anime_1
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_section, { name: 'chr', start: '5', end: '9' }, h.nextOrder);
    await runTag(h.tags.ss_chara, { name: 'chr', jname: 'あかね', talk: 'Talk' }, h.nextOrder);
    p.setAnimationSection.mockClear();

    h.speak('あかね');
    expect(p.setAnimationSection).not.toHaveBeenCalled(); // not on the talk animation
    h.endSpeaking();
    expect(p.setAnimationSection).toHaveBeenCalledWith(5, 9);
  });

  it('ss_direction takes Godot\'s words, keeps them across a change, and restores them', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];

    await runTag(h.tags.ss_direction, { name: 'chr', direction: 'backward', style: 'pingpong' }, h.nextOrder);
    expect(p.setPlaybackDirection).toHaveBeenLastCalledWith(1, 1);
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2' }, h.nextOrder);
    expect(savedSlot(h).chr.playback).toEqual({ direction: 1, style: 1 });

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);
    expect(FakeSSPlayer.instances[0].setPlaybackDirection).toHaveBeenCalledWith(1, 1);
  });

  it('ss_direction refuses a word it does not know', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runTag(h.tags.ss_direction, { name: 'chr', direction: 'reverse' }, h.nextOrder);
    expect(h.error).toHaveBeenCalledWith('[ss_direction] direction="reverse" must be forward or backward.');
    expect(FakeSSPlayer.instances[0].setPlaybackDirection).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // --- [ss_wait_signal] -----------------------------------------------------

  /** Start `[ss_wait_signal]` and report whether it has advanced yet. */
  const startWaitSignal = (h: Harness, pm: Record<string, unknown>): (() => boolean) => {
    const before = h.nextOrder.mock.calls.length;
    h.tags.ss_wait_signal.start({ ...h.tags.ss_wait_signal.pm, ...pm } as Record<string, any>);
    return () => h.nextOrder.mock.calls.length > before;
  };

  /** Let a deferred give-up run. */
  const settle = () => new Promise<void>((r) => setTimeout(r, 0));

  it('ss_wait_signal holds until the named signal, and stores its command', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const advanced = startWaitSignal(h, { name: 'chr', command: 'hit', var: 'f.sig' });

    p._fireSignal('step');
    await settle();
    expect(advanced()).toBe(false); // another command does not count

    p._fireSignal('hit');
    expect(advanced()).toBe(true);
    expect(h.tyrano.kag.stat.f.sig).toBe('hit');
  });

  it('ss_wait_signal with no command takes the first signal', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const advanced = startWaitSignal(h, { name: 'chr', var: 'tf.sig' });

    p._fireSignal('step');
    expect(advanced()).toBe(true);
    expect(h.tyrano.kag.variable.tf.sig).toBe('step');
    p._fireSignal('hit'); // after the wait, signals write nothing
    expect(h.tyrano.kag.variable.tf.sig).toBe('step');
  });

  it('ss_wait_signal refuses a var that is not a variable, without waiting', async () => {
    const h = await withPlayer();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runTag(h.tags.ss_wait_signal, { name: 'chr', var: 'f.x; alert(1)' }, h.nextOrder);

    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('[ss_wait_signal] var="f.x; alert(1)" is not a variable name'));
    errSpy.mockRestore();
  });

  it('ss_wait_signal reports an animation that finishes without the signal', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const advanced = startWaitSignal(h, { name: 'chr', command: 'hti' });

    p.stop();
    p._fireEnd();
    await settle();

    expect(advanced()).toBe(true);
    expect(h.error).toHaveBeenCalledWith('[ss_wait_signal] "chr" finished "Anime_1" without firing signal "hti".');
    errSpy.mockRestore();
  });

  it('ss_wait_signal takes a signal on the last frame, reported after the end', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const advanced = startWaitSignal(h, { name: 'chr', command: 'hit', var: 'f.sig' });

    // One tick: the end first, then the signals the tick stepped over.
    p.stop();
    p._fireEnd();
    p._fireSignal('hit');
    await settle();

    expect(advanced()).toBe(true);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.tyrano.kag.stat.f.sig).toBe('hit');
  });

  it('ss_wait_signal gives up after a whole loop without the signal', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const advanced = startWaitSignal(h, { name: 'chr', command: 'hit' });

    p._fireLoop(); // may have started after the signal's frame
    await settle();
    expect(advanced()).toBe(false);

    p._fireLoop();
    await settle();
    expect(advanced()).toBe(true);
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining('played a whole loop of "Anime_1"'));
    errSpy.mockRestore();
  });

  it('ss_wait_signal keeps waiting through a next= follow-up', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    const advanced = startWaitSignal(h, { name: 'chr', command: 'hit' });

    p.stop();
    p._fireEnd(); // the follow-up starts on this end
    await settle();
    expect(advanced()).toBe(false);
    expect(h.error).not.toHaveBeenCalled();

    p._fireSignal('hit');
    expect(advanced()).toBe(true);
  });

  it('ss_wait_signal does not wait on a player that is not playing', async () => {
    const h = await withPlayer();
    FakeSSPlayer.instances[0].stop();
    await runTag(h.tags.ss_wait_signal, { name: 'chr', command: 'hit' }, h.nextOrder);
  });

  // --- Skip mode -----------------------------------------------------------
  //
  // While the engine skips with `skipEffectIgnore` on, it cuts its own effects
  // ([chara_show], [chara_hide] …) to a short duration. SS effects follow, or a
  // read-skip would stop at each of them.

  /** Put the engine in skip mode, as `setSkip(true)` leaves it. */
  const startSkipping = (h: Harness, skipEffectIgnore = 'true'): void => {
    h.tyrano.kag.stat.is_skip = true;
    h.tyrano.kag.config.skipEffectIgnore = skipEffectIgnore;
  };

  it('cuts an SS fade to the engine\'s skip duration', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    const before = h.nextOrder.mock.calls.length;
    startSkipping(h);

    h.tags.ss_fadeout.start({ ...h.tags.ss_fadeout.pm } as Record<string, any>); // 1000 ms, waited
    expect(p.element.style.transition).toBe('opacity 70ms linear');
    await vi.waitFor(() => expect(h.nextOrder.mock.calls.length).toBe(before + 1), { timeout: 500 });
  });

  it('cuts a waited ss_move to the engine\'s skip duration', async () => {
    const h = await withPlayer();
    const before = h.nextOrder.mock.calls.length;
    startSkipping(h);

    h.tags.ss_move.start({ name: 'chr', x: 800, time: 1000, wait: 'true' } as Record<string, any>);
    await vi.waitFor(() => expect(h.nextOrder.mock.calls.length).toBe(before + 1), { timeout: 500 });
  });

  it('keeps an instant ss_show instant while skipping', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    await runTag(h.tags.ss_hide, { name: 'chr' }, h.nextOrder);
    startSkipping(h);

    await runTag(h.tags.ss_show, { name: 'chr' }, h.nextOrder); // time defaults to 0
    // The engine's skip duration is longer than 0; taken as is, it would add a fade.
    expect(p.element.style.transition).toBe('');
    expect(shown(p.element)).toBe(true);
  });

  it('leaves SS fades alone when the project keeps effects during skip', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    startSkipping(h, 'false');

    await runTag(h.tags.ss_fadeout, { wait: 'false' }, h.nextOrder);
    expect(p.element.style.transition).toBe('opacity 1000ms linear');
  });

  it('ss_wait_signal still waits while skipping', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    startSkipping(h);
    const advanced = startWaitSignal(h, { name: 'chr', command: 'hit', var: 'f.sig' });

    await settle();
    expect(advanced()).toBe(false); // a branch on f.sig needs the signal
    p._fireSignal('hit');
    expect(advanced()).toBe(true);
  });

  it('ss_wait does not hold a skip', async () => {
    const h = await withPlayer();
    const p = FakeSSPlayer.instances[0];
    startSkipping(h);

    await runTag(h.tags.ss_wait, { name: 'chr' }, h.nextOrder);
    expect(p.isPlaying).toBe(true); // the animation itself plays on
  });

  it('ss_restore brings back visibility, z-order, follow-ups and speaker links', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_pos, { name: 'chr', zindex: 7 }, h.nextOrder);
    await runTag(h.tags.ss_chara, { name: 'chr', jname: 'あかね', talk: 'Talk', idle: 'Idle' }, h.nextOrder);
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1', visible: 'false' }, h.nextOrder);

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    const [chr, bg] = FakeSSPlayer.instances;
    expect(chr.order).toBe(7);
    expect(shown(chr.element)).toBe(true);
    expect(shown(bg.element)).toBe(false); // preloaded-but-hidden stays hidden

    // The speaker link is live again on the rebuilt player.
    chr.setAnimation.mockClear();
    h.speak('あかね');
    await vi.waitFor(() => expect(chr.setAnimation).toHaveBeenLastCalledWith('Talk'));
    h.endSpeaking();
    await vi.waitFor(() => expect(chr.setAnimation).toHaveBeenLastCalledWith('Idle'));

    // …and so is the pending follow-up.
    chr.setAnimation.mockClear();
    chr._fireEnd();
    await vi.waitFor(() => expect(chr.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
  });

  it('ss_restore keeps a blanket ss_fadeout in force across the load', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_fadeout, { time: 0 }, h.nextOrder);

    FakeSSPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    expect(shown(FakeSSPlayer.instances[0].element)).toBe(false);
    await runTag(h.tags.ss_fadein, { time: 0 }, h.nextOrder);
    expect(shown(FakeSSPlayer.instances[0].element)).toBe(true);
  });

  it('ss_restore re-applies the saved overrides to the rebuilt player', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#0033FF', priority: 'permanent' }, h.nextOrder);
    await runTag(h.tags.ss_part_visible, { name: 'chr', part: 'heta' }, h.nextOrder);

    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    // A second player was built; it must carry the overrides the first one had.
    const restored = FakeSSPlayer.instances[1];
    expect(restored).toBeDefined();
    expect(restored.setPartColorOverride).toHaveBeenCalledWith('apple', 0x0033ffff, 0, 2);
    expect(restored.setPartVisibilityOverride).toHaveBeenCalledWith('heta', true, false);
  });
});
