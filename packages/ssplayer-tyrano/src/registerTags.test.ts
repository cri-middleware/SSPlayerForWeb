import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the WebGL renderer so no GL context / WASM is needed. ------------
// The fake is defined INSIDE the factory (vi.mock is hoisted above module
// scope). Each constructed player is recorded on `SSCanvasPlayer.instances` so
// tests can assert on the calls the adapter made; we reach the class back via
// the (now-mocked) import below.
vi.mock('@spritestudio/ssplayer-webgl', async () => {
  // The part-override store is pure data policy with no imports of its own, so
  // the REAL implementation is pulled straight from core's source — the adapter
  // must be tested against it, not against a second copy of the same rules.
  const store = await import('../../ssplayer-core/src/PartOverride.js');

  class FakeSSCanvasPlayer {
    static initialize = vi.fn().mockResolvedValue(undefined);
    static instances: FakeSSCanvasPlayer[] = [];

    _playing = false;
    _endListeners = new Set<() => void>();
    _loopListeners = new Set<() => void>();
    _frameListeners = new Set<(frame: number) => void>();
    _audioListeners = new Set<(e: unknown) => void>();
    audioManager: unknown = null;
    internalPlayer = { setLoop: vi.fn() };
    resize = vi.fn();
    load = vi.fn().mockResolvedValue(undefined);
    setAnimation = vi.fn().mockResolvedValue(undefined);
    setTransform = vi.fn();
    play = vi.fn(() => { this._playing = true; });
    pause = vi.fn(() => { this._playing = false; });
    resume = vi.fn(() => { this._playing = true; });
    stop = vi.fn(() => { this._playing = false; });
    destroy = vi.fn();
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
    onAnimationEnd(cb: () => void) { this._endListeners.add(cb); return () => this._endListeners.delete(cb); }
    onAnimationLoop(cb: () => void) { this._loopListeners.add(cb); return () => this._loopListeners.delete(cb); }
    onFrame(cb: (frame: number) => void) { this._frameListeners.add(cb); return () => this._frameListeners.delete(cb); }
    onAudio(cb: (e: unknown) => void) { this._audioListeners.add(cb); return () => this._audioListeners.delete(cb); }
    _fireEnd() { for (const cb of [...this._endListeners]) cb(); }
    _fireFrame(frame: number) { for (const cb of [...this._frameListeners]) cb(frame); }
    _fireAudio(e: unknown) { for (const cb of [...this._audioListeners]) cb(e); }

    constructor(
      public canvas: HTMLCanvasElement,
      public options: unknown,
    ) {
      FakeSSCanvasPlayer.instances.push(this);
    }
  }
  return {
    ...store,
    SSCanvasPlayer: FakeSSCanvasPlayer,
    SSRuntimeManager: {
      extractAnimationNames: vi.fn(() => ['Anime_1', 'Anime_2']),
    },
  };
});

import { SSCanvasPlayer as SSCanvasPlayerMock } from '@spritestudio/ssplayer-webgl';
import { registerSSTags, getRegistry, __resetStateForTest } from './registerTags.js';
import { SAVE_KEY, type SavedPlayer } from './SaveLoadBridge.js';
import type { TyranoGlobal, TyranoMasterTag } from './tyranoTypes.js';

// Typed handle to the mocked class (with the test-only static `instances`).
const FakeSSCanvasPlayer = SSCanvasPlayerMock as unknown as {
  initialize: ReturnType<typeof vi.fn>;
  instances: Array<{
    canvas: HTMLCanvasElement;
    internalPlayer: { setLoop: ReturnType<typeof vi.fn> };
    load: ReturnType<typeof vi.fn>;
    setAnimation: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
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
  }>;
};

// --- Mock TyranoScript harness -------------------------------------------

interface Harness {
  tyrano: TyranoGlobal;
  nextOrder: ReturnType<typeof vi.fn>;
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
}

function makeTyrano(): Harness {
  const nextOrder = vi.fn();
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

  const tyrano: TyranoGlobal = {
    kag: {
      ftag: { master_tag: { text }, nextOrder, startTag: vi.fn() },
      config: { scWidth: 1280, scHeight: 720 },
      stat: { f: {}, current_speaker: '', charas: {}, jcharas: {} },
      variable: { f: {}, sf: {}, tf: {} },
      layer: { getLayer },
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
    FakeSSCanvasPlayer.instances = [];
    FakeSSCanvasPlayer.initialize.mockClear();
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
      'ss_show',
      'ss_stop',
      'ss_wait',
    ]);
    expect(tags.ss_new.vital).toEqual(['name', 'storage']);
  });

  it('ss_init initializes the WASM runtime and advances', async () => {
    const { tyrano, nextOrder } = makeTyrano();
    registerSSTags(tyrano);
    await runTag(tyrano.kag.ftag.master_tag.ss_init, { wasm: 'others/plugin/ssplayer/rt.wasm' }, nextOrder);
    expect(FakeSSCanvasPlayer.initialize).toHaveBeenCalledWith('data/others/plugin/ssplayer/rt.wasm');
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
    expect(FakeSSCanvasPlayer.instances).toHaveLength(1);
    const p = FakeSSCanvasPlayer.instances[0];
    expect(layer.querySelector('canvas')).toBe(p.canvas);
    // Textures resolve relative to the .ssab's own directory — no base arg is passed.
    expect(p.load).toHaveBeenCalledWith('data/others/ssdata/Basic.ssab');
    expect(p.setAnimation).toHaveBeenCalledWith('Anime_1');
    expect(p.internalPlayer.setLoop).toHaveBeenCalledWith(-1); // loop=true → infinite
    expect(p.play).toHaveBeenCalled();

    // Coordinate mapping: logical (640,360) → buffer px at dpr 1 (jsdom) = (640,360).
    expect(p.setTransform).toHaveBeenCalledWith({ x: 640, y: 360, scaleX: 1, scaleY: 1 });

    expect(getRegistry().has('chr')).toBe(true);
  });

  it('ss_new picks the first animation when anime= is omitted (fetch path)', async () => {
    const { tyrano, nextOrder, addLayer } = makeTyrano();
    registerSSTags(tyrano);
    const tags = tyrano.kag.ftag.master_tag;
    addLayer('0', 'fore');

    // The adapter fetches the ssab bytes to read its animation names.
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) });
    vi.stubGlobal('fetch', fetchMock);

    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'others/ssdata/Basic.ssab' }, nextOrder);

    expect(fetchMock).toHaveBeenCalledWith('data/others/ssdata/Basic.ssab');
    const p = FakeSSCanvasPlayer.instances[0];
    // extractAnimationNames mock → ['Anime_1', 'Anime_2']; first is chosen.
    expect(p.setAnimation).toHaveBeenCalledWith('Anime_1');
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

    expect(FakeSSCanvasPlayer.instances).toHaveLength(0);
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
    const p = FakeSSCanvasPlayer.instances[0];
    p.setAnimation.mockClear();
    p.play.mockClear();

    await runTag(tags.ss_play, { name: 'chr', anime: 'Anime_2', loop: 'false' }, nextOrder);

    expect(p.setAnimation).toHaveBeenCalledWith('Anime_2');
    expect(p.internalPlayer.setLoop).toHaveBeenLastCalledWith(1); // loop=false → once
    expect(p.play).toHaveBeenCalled();
  });

  // --- PT2: lifecycle (save/load, free, pause) ----------------------------

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

  it('ss_free destroys the player, detaches the canvas, and clears the save slot', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    const layer = document.getElementsByClassName('0_fore')[0];
    expect(layer.querySelector('canvas')).toBe(p.canvas);

    await runTag(h.tags.ss_free, { name: 'chr' }, h.nextOrder);

    expect(p.destroy).toHaveBeenCalled();
    expect(layer.querySelector('canvas')).toBeNull();
    expect(getRegistry().has('chr')).toBe(false);
    expect(savedSlot(h)).toEqual({});
  });

  it('ss_pause / ss_resume / ss_stop drive the player and update the save slot', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];

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
    FakeSSCanvasPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    // Two fresh players rebuilt, registered under their names.
    expect(FakeSSCanvasPlayer.instances).toHaveLength(2);
    expect(getRegistry().names().sort()).toEqual(['bg', 'chr']);
    const [chr, bg] = FakeSSCanvasPlayer.instances; // insertion order: chr then bg
    expect(chr.play).toHaveBeenCalled(); // was playing → resume playback
    expect(bg.pause).toHaveBeenCalled(); // was paused → stay paused
    expect(bg.play).not.toHaveBeenCalled();
  });

  it('ss_free_all tears down every player and empties the save slot', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1' }, h.nextOrder);
    expect(getRegistry().names()).toHaveLength(2);

    await runTag(h.tags.ss_free_all, {}, h.nextOrder);

    expect(getRegistry().names()).toHaveLength(0);
    expect(savedSlot(h)).toEqual({});
    for (const p of FakeSSCanvasPlayer.instances) expect(p.destroy).toHaveBeenCalled();
  });

  // --- PT3: ss_wait / ss_pos / ss_move / audio ----------------------------

  it('ss_wait defers nextOrder until the animation ends', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
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
    const p = FakeSSCanvasPlayer.instances[0];
    p.stop(); // not playing
    await runTag(h.tags.ss_wait, { name: 'chr' }, h.nextOrder);
    // runTag already asserts nextOrder fired; no listeners needed.
    expect(p.isPlaying).toBe(false);
  });

  it('ss_pos repositions instantly via setTransform and updates the save slot', async () => {
    const h = await withPlayer(); // created at x=100 y=200
    const p = FakeSSCanvasPlayer.instances[0];
    p.setTransform.mockClear();

    await runTag(h.tags.ss_pos, { name: 'chr', x: 300, y: 50, scale: 2 }, h.nextOrder);

    // dpr 1 in jsdom → bufferScale 1: transform == logical coords, scale composed.
    expect(p.setTransform).toHaveBeenCalledWith({ x: 300, y: 50, scaleX: 2, scaleY: 2 });
    expect(savedSlot(h).chr).toMatchObject({ x: 300, y: 50, scale: 2 });
  });

  it('ss_move commits the destination to the save slot (instant when time=0)', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    p.setTransform.mockClear();

    await runTag(h.tags.ss_move, { name: 'chr', x: 800, y: 100, time: 0 }, h.nextOrder);

    expect(savedSlot(h).chr).toMatchObject({ x: 800, y: 100 });
    // time=0 → instant set to the target.
    expect(p.setTransform).toHaveBeenLastCalledWith({ x: 800, y: 100, scaleX: 1, scaleY: 1 });
  });

  it('audio: onAudio events play through window.Howl (howler)', async () => {
    const played: Array<{ src: string[]; loop: boolean }> = [];
    class FakeHowl {
      _loop = false;
      constructor(public opts: { src: string[] }) {}
      loop(v: boolean) { this._loop = v; return this; }
      volume() { return this; }
      stop() { return this; }
      unload() {}
      play() { played.push({ src: this.opts.src, loop: this._loop }); return 1; }
    }
    vi.stubGlobal('Howl', FakeHowl);

    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    // The Tyrano audio manager was attached (autoAudio replaced).
    expect(p.audioManager).toBeTruthy();

    p._fireAudio({ soundName: 'attack_se', loopNum: 1 });
    expect(played).toEqual([{ src: ['data/sound/attack_se.ogg'], loop: false }]);

    p._fireAudio({ soundName: 'bgm_loop', loopNum: 0 }); // 0 → loop
    expect(played[1]).toEqual({ src: ['data/sound/bgm_loop.ogg'], loop: true });

    vi.unstubAllGlobals();
  });

  // --- Part overrides (65_override_layer) ---------------------------------
  //
  // Each tag has to do two things: drive the live player now, and mirror the
  // change into the save slot so [ss_restore] can put it back on a player whose
  // WASM context (and its override table) was rebuilt from nothing.

  it('ss_part_color applies the override and mirrors it into the save slot', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];

    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#0033FFBF' }, h.nextOrder);

    // Defaults: blend="mix" (0), priority="anime" (HoldUntilNextAnimation = 1).
    expect(p.setPartColorOverride).toHaveBeenCalledWith('apple', 0, 0x0033ffbf, 1);
    expect(savedSlot(h).chr.overrides).toEqual([
      { kind: 'color', part: 'apple', blendOp: 0, rgba: 0x0033ffbf, priority: 1 },
    ]);
  });

  it('ss_part_color reads blend and priority as words as well as numbers', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];

    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#F00', blend: 'mul', priority: 'permanent' }, h.nextOrder);
    expect(p.setPartColorOverride).toHaveBeenLastCalledWith('apple', 1, 0xff0000ff, 2);

    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#F00', blend: '3', priority: '0' }, h.nextOrder);
    expect(p.setPartColorOverride).toHaveBeenLastCalledWith('apple', 3, 0xff0000ff, 0);
  });

  it('ss_part_color leaves the player alone when the colour cannot be read', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];

    // Errors are logged and the scenario still advances — a typo must not stall it.
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: 'crimson' }, h.nextOrder);

    expect(p.setPartColorOverride).not.toHaveBeenCalled();
    expect(savedSlot(h).chr.overrides ?? []).toEqual([]);
  });

  it('ss_part_visible and ss_part_cell record alongside each other', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];

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
    const p = FakeSSCanvasPlayer.instances[0];
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

  // --- PT3.5: show / hide / fade, z-order, chained animations, speaker link --
  //
  // Parity with the official Spine ([spine_new]/[spine_show]/[spine_hide]/
  // [spine_fadein]/[spine_anim next_motion]) and Live2D ([live2d_new jname=])
  // plugins. The through-line: a player can exist without being on screen, and
  // animation follow-ups must not block the scenario the way [ss_wait] does.

  /** True when the canvas is currently laid out and fully opaque. */
  const shown = (canvas: HTMLCanvasElement): boolean =>
    canvas.style.display !== 'none' && canvas.style.opacity !== '0';

  it('ss_new visible="false" loads the player without displaying it', async () => {
    const h = makeTyrano();
    registerSSTags(h.tyrano);
    const tags = h.tyrano.kag.ftag.master_tag;
    h.addLayer('0', 'fore');
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);

    await runTag(tags.ss_new, { name: 'chr', storage: 'a.ssab', anime: 'Anime_1', visible: 'false' }, h.nextOrder);

    const p = FakeSSCanvasPlayer.instances[0];
    // Loaded and registered (that is the point of preloading) but off screen.
    expect(p.load).toHaveBeenCalled();
    expect(shown(p.canvas)).toBe(false);
    expect((h.tyrano.kag.stat.f[SAVE_KEY] as Record<string, SavedPlayer>).chr.visible).toBe(false);
  });

  it('ss_show reveals a preloaded player, repositioning it as it appears', async () => {
    const h = makeTyrano();
    registerSSTags(h.tyrano);
    const tags = h.tyrano.kag.ftag.master_tag;
    h.addLayer('0', 'fore');
    await runTag(tags.ss_init, { wasm: 'rt.wasm' }, h.nextOrder);
    await runTag(tags.ss_new, { name: 'chr', storage: 'a.ssab', anime: 'Anime_1', visible: 'false' }, h.nextOrder);
    const p = FakeSSCanvasPlayer.instances[0];
    p.setAnimation.mockClear();

    await runTag(tags.ss_show, { name: 'chr', x: 400, y: 300, scale: 2, anime: 'Anime_2' }, h.nextOrder);

    expect(shown(p.canvas)).toBe(true);
    expect(p.setTransform).toHaveBeenLastCalledWith({ x: 400, y: 300, scaleX: 2, scaleY: 2 });
    expect(p.setAnimation).toHaveBeenCalledWith('Anime_2');
    expect(savedSlot(h).chr).toMatchObject({ visible: true, x: 400, y: 300, anime: 'Anime_2' });
  });

  it('ss_hide takes the player off screen without destroying it', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    expect(shown(p.canvas)).toBe(true);

    await runTag(h.tags.ss_hide, { name: 'chr' }, h.nextOrder);

    expect(shown(p.canvas)).toBe(false);
    // Unlike [ss_free]: still loaded, still registered, still in the save.
    expect(p.destroy).not.toHaveBeenCalled();
    expect(getRegistry().has('chr')).toBe(true);
    expect(savedSlot(h).chr.visible).toBe(false);

    await runTag(h.tags.ss_show, { name: 'chr' }, h.nextOrder);
    expect(shown(p.canvas)).toBe(true);
  });

  it('ss_fadeout hides every player and ss_fadein brings back only the visible ones', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1' }, h.nextOrder);
    const [chr, bg] = FakeSSCanvasPlayer.instances;
    // 'bg' is individually hidden before the blanket fade.
    await runTag(h.tags.ss_hide, { name: 'bg' }, h.nextOrder);

    await runTag(h.tags.ss_fadeout, { time: 0 }, h.nextOrder);
    expect(shown(chr.canvas)).toBe(false);
    expect(shown(bg.canvas)).toBe(false);

    await runTag(h.tags.ss_fadein, { time: 0 }, h.nextOrder);
    // 'chr' comes back; 'bg' stays hidden because it was hidden on its own.
    expect(shown(chr.canvas)).toBe(true);
    expect(shown(bg.canvas)).toBe(false);
  });

  it('ss_show cannot override a blanket ss_fadeout', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    await runTag(h.tags.ss_fadeout, { time: 0 }, h.nextOrder);

    await runTag(h.tags.ss_show, { name: 'chr', time: 0 }, h.nextOrder);

    // The player is marked visible, but the layer-wide fade still wins…
    expect(savedSlot(h).chr.visible).toBe(true);
    expect(shown(p.canvas)).toBe(false);
    // …until the fade is lifted.
    await runTag(h.tags.ss_fadein, { time: 0 }, h.nextOrder);
    expect(shown(p.canvas)).toBe(true);
  });

  it('zindex orders players inside one layer, from ss_new and ss_pos alike', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1', zindex: 5 }, h.nextOrder);
    const [chr, bg] = FakeSSCanvasPlayer.instances;
    expect(bg.canvas.style.zIndex).toBe('5');
    expect(chr.canvas.style.zIndex).toBe('');

    await runTag(h.tags.ss_pos, { name: 'chr', zindex: 10 }, h.nextOrder);
    expect(chr.canvas.style.zIndex).toBe('10');
    expect(savedSlot(h).chr.zindex).toBe(10);
  });

  it('ss_play next= chains to a follow-up animation without blocking the scenario', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    p.setAnimation.mockClear();

    // The tag advances immediately — the whole point versus [ss_wait].
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_2');
    // `next=` with no loop= plays the first animation once (else the end never comes).
    expect(p.internalPlayer.setLoop).toHaveBeenLastCalledWith(1);
    expect(savedSlot(h).chr.next).toEqual({ anime: 'Anime_1', loop: -1, atframe: undefined });

    p._fireEnd();
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
    expect(p.internalPlayer.setLoop).toHaveBeenLastCalledWith(-1); // idle loops
    await vi.waitFor(() => expect(savedSlot(h).chr).toMatchObject({ anime: 'Anime_1', next: undefined }));
  });

  it('ss_play atframe= chains early, at the given frame', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];
    p.setAnimation.mockClear();

    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1', atframe: 20 }, h.nextOrder);

    p._fireFrame(19);
    expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_2'); // not yet
    p._fireFrame(20);
    await vi.waitFor(() => expect(p.setAnimation).toHaveBeenLastCalledWith('Anime_1'));
  });

  it('a new ss_play cancels a follow-up that has not fired yet', async () => {
    const h = await withPlayer();
    const p = FakeSSCanvasPlayer.instances[0];

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
    const p = FakeSSCanvasPlayer.instances[0];
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
    const p = FakeSSCanvasPlayer.instances[0];
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
    const p = FakeSSCanvasPlayer.instances[0];
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

  it('ss_restore brings back visibility, z-order, follow-ups and speaker links', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_pos, { name: 'chr', zindex: 7 }, h.nextOrder);
    await runTag(h.tags.ss_chara, { name: 'chr', jname: 'あかね', talk: 'Talk', idle: 'Idle' }, h.nextOrder);
    await runTag(h.tags.ss_play, { name: 'chr', anime: 'Anime_2', next: 'Anime_1' }, h.nextOrder);
    await runTag(h.tags.ss_new, { name: 'bg', storage: 'b.ssab', anime: 'Anime_1', visible: 'false' }, h.nextOrder);

    FakeSSCanvasPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    const [chr, bg] = FakeSSCanvasPlayer.instances;
    expect(chr.canvas.style.zIndex).toBe('7');
    expect(shown(chr.canvas)).toBe(true);
    expect(shown(bg.canvas)).toBe(false); // preloaded-but-hidden stays hidden

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

    FakeSSCanvasPlayer.instances.length = 0;
    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    expect(shown(FakeSSCanvasPlayer.instances[0].canvas)).toBe(false);
    await runTag(h.tags.ss_fadein, { time: 0 }, h.nextOrder);
    expect(shown(FakeSSCanvasPlayer.instances[0].canvas)).toBe(true);
  });

  it('ss_restore re-applies the saved overrides to the rebuilt player', async () => {
    const h = await withPlayer();
    await runTag(h.tags.ss_part_color, { name: 'chr', part: 'apple', color: '#0033FF', priority: 'permanent' }, h.nextOrder);
    await runTag(h.tags.ss_part_visible, { name: 'chr', part: 'heta' }, h.nextOrder);

    await runTag(h.tags.ss_restore, {}, h.nextOrder);

    // A second player was built; it must carry the overrides the first one had.
    const restored = FakeSSCanvasPlayer.instances[1];
    expect(restored).toBeDefined();
    expect(restored.setPartColorOverride).toHaveBeenCalledWith('apple', 0, 0x0033ffff, 2);
    expect(restored.setPartVisibilityOverride).toHaveBeenCalledWith('heta', true, false);
  });
});
