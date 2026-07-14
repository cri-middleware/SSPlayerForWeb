import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the WebGL renderer so no GL context / WASM is needed. ------------
// The fake is defined INSIDE the factory (vi.mock is hoisted above module
// scope). Each constructed player is recorded on `SSCanvasPlayer.instances` so
// tests can assert on the calls the adapter made; we reach the class back via
// the (now-mocked) import below.
vi.mock('@spritestudio/ssplayer-webgl', () => {
  class FakeSSCanvasPlayer {
    static initialize = vi.fn().mockResolvedValue(undefined);
    static instances: FakeSSCanvasPlayer[] = [];

    _playing = false;
    _endListeners = new Set<() => void>();
    _loopListeners = new Set<() => void>();
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
    get isPlaying() { return this._playing; }
    onAnimationEnd(cb: () => void) { this._endListeners.add(cb); return () => this._endListeners.delete(cb); }
    onAnimationLoop(cb: () => void) { this._loopListeners.add(cb); return () => this._loopListeners.delete(cb); }
    onAudio(cb: (e: unknown) => void) { this._audioListeners.add(cb); return () => this._audioListeners.delete(cb); }
    _fireEnd() { for (const cb of [...this._endListeners]) cb(); }
    _fireAudio(e: unknown) { for (const cb of [...this._audioListeners]) cb(e); }

    constructor(
      public canvas: HTMLCanvasElement,
      public options: unknown,
    ) {
      FakeSSCanvasPlayer.instances.push(this);
    }
  }
  return {
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
    isPlaying: boolean;
    audioManager: unknown;
    _fireEnd(): void;
    _fireAudio(e: unknown): void;
  }>;
};

// --- Mock TyranoScript harness -------------------------------------------

interface Harness {
  tyrano: TyranoGlobal;
  nextOrder: ReturnType<typeof vi.fn>;
  /** Create a layer div, register it under `layer_page`, and attach to the DOM. */
  addLayer(layer?: string, page?: string): HTMLElement;
}

function makeTyrano(): Harness {
  const nextOrder = vi.fn();
  const layerEls = new Map<string, HTMLElement>();

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
      ftag: { master_tag: {}, nextOrder, startTag: vi.fn() },
      config: { scWidth: 1280, scHeight: 720 },
      stat: { f: {} },
      variable: { f: {}, sf: {}, tf: {} },
      layer: { getLayer },
    },
  };

  return {
    tyrano,
    nextOrder,
    addLayer(layer = '0', page = 'fore') {
      const el = document.createElement('div');
      el.className = `${layer}_${page}`;
      document.body.appendChild(el);
      layerEls.set(`${layer}_${page}`, el);
      return el;
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
    expect(Object.keys(tags).sort()).toEqual([
      'ss_free',
      'ss_free_all',
      'ss_init',
      'ss_move',
      'ss_new',
      'ss_pause',
      'ss_pause_all',
      'ss_play',
      'ss_pos',
      'ss_restore',
      'ss_resume',
      'ss_resume_all',
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
});
