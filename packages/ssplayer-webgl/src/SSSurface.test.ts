import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock everything that needs a GPU or the WASM runtime. ------------------
// What is left is the layering this package exists to get right: which object
// owns the context, what order players draw in, how a player's box maps to a
// transform, and who frees what. None of that needs to rasterise a pixel, so
// none of it should need a browser to test.

vi.mock('./SSWebGLRenderer.js', () => ({
  SSWebGLRenderer: class {
    render = vi.fn();
    restoreContext = vi.fn();
    destroy = vi.fn();
    constructor(public gl: unknown) {}
  },
}));

vi.mock('./SSGroupAlpha.js', () => ({
  SSGroupAlpha: class {
    // Constructed lazily by the surface, so counting instances is how a test
    // checks that an all-opaque surface never allocates a framebuffer.
    static instances: unknown[] = [];
    begin = vi.fn();
    end = vi.fn();
    destroy = vi.fn();
    constructor(public gl: unknown) {
      (this.constructor as { instances: unknown[] }).instances.push(this);
    }
  },
}));

vi.mock('./SSWebGLResourceManager.js', () => ({
  SSWebGLResourceManager: class {
    loadTexture = vi.fn().mockResolvedValue(undefined);
    loadTextureFromBytes = vi.fn().mockResolvedValue(undefined);
    bindTextureSource = vi.fn();
    getTexture = vi.fn();
    restoreContext = vi.fn().mockResolvedValue(undefined);
    destroy = vi.fn();
    constructor(public gl: unknown) {}
  },
}));

vi.mock('@spritestudio/ssplayer-core', async () => ({
  // The real one, from source: listener dispatch is behaviour these tests pin
  // (onAnimationStarted), not something to fake.
  ListenerSet: (await import('../../ssplayer-core/src/ListenerSet.js')).ListenerSet,
  // Also the real one: the placement arithmetic is what SSPlayer hands the box to.
  resolvePlacement: (await import('../../ssplayer-core/src/Placement.js')).resolvePlacement,
  initializeWasm: vi.fn().mockResolvedValue(undefined),
  DirectInternalPlayer: class {
    currentAnimation = 'Anime_1';
    isPausing = false;
    isHeld = false;
    audioManager: unknown = null;
    subFrameEnabled = false;
    flipX = false;
    flipY = false;
    canvasRect: { x: number; y: number; width: number; height: number } | null = null;
    getCanvasRect() { return this.canvasRect; }
    runtimeManager = {
      context: { set_render_mode: vi.fn(), set_coordinate_system: vi.fn() },
      getSounds: () => [],
      capturePassedEvents: () => [],
    };
    update = vi.fn();
    destroy = vi.fn();
    play = vi.fn();
    pause = vi.fn();
    resume = vi.fn();
    stop = vi.fn();
    setSpeed = vi.fn();
    getFrameNo = vi.fn(() => 0);
    pollPlaybackEvents = vi.fn(() => ({ looped: false, finished: false }));
    constructor(public rm: unknown) {}
  },
  ssFormat: {},
  SSBlendOp: {},
  SSOverridePriority: { HoldUntilNextAnimation: 1 },
}));

const { SSSurface } = await import('./SSSurface.js');

/**
 * jsdom has no WebGL. The surface only needs the handful of state calls it makes
 * around each player (clear, viewport, scissor); everything that would actually
 * rasterise lives in the mocked renderer.
 */
function fakeGl(canvas: HTMLCanvasElement) {
  return {
    canvas,
    clear: vi.fn(),
    clearColor: vi.fn(),
    viewport: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    scissor: vi.fn(),
    isContextLost: () => false,
    COLOR_BUFFER_BIT: 1,
    STENCIL_BUFFER_BIT: 2,
    SCISSOR_TEST: 4,
  };
}

function makeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = fakeGl(canvas);
  canvas.getContext = vi.fn(() => gl) as unknown as HTMLCanvasElement['getContext'];
  return canvas;
}

describe('SSSurface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('owns the context when built from a canvas, and borrows one when built from a gl', () => {
    expect(new SSSurface(makeCanvas()).owned).toBe(true);

    const canvas = makeCanvas();
    const gl = { canvas } as unknown as WebGLRenderingContext;
    const borrowed = new SSSurface(gl);
    expect(borrowed.owned).toBe(false);
    expect(borrowed.canvas).toBe(canvas);
  });

  it('resizes the drawing buffer without touching CSS', () => {
    const canvas = makeCanvas();
    canvas.style.width = '123px';
    const surface = new SSSurface(canvas, { maxDPR: 2 });

    surface.resize(400, 300, 3); // dpr clamped to maxDPR

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    // The host owns layout. A library that writes inline styles fights whatever
    // the page already set.
    expect(canvas.style.width).toBe('123px');
  });

  it('never lets a resize collapse the buffer to zero', () => {
    const canvas = makeCanvas();
    const surface = new SSSurface(canvas);
    surface.resize(0, 0, 1);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  describe('players', () => {
    it('registers a player on construction and drops it on destroy', () => {
      const surface = new SSSurface(makeCanvas());
      const player = surface.createPlayer();
      expect(surface.children).toContain(player);

      player.destroy();
      expect(surface.children).not.toContain(player);
    });

    it('add is idempotent, so a player cannot be drawn twice', () => {
      const surface = new SSSurface(makeCanvas());
      const player = surface.createPlayer();
      surface.add(player);
      expect(surface.children).toHaveLength(1);
    });

    it('draws in `order`, keeping insertion order for ties', () => {
      const surface = new SSSurface(makeCanvas());
      const a = surface.createPlayer();
      const b = surface.createPlayer();
      const c = surface.createPlayer();

      c.order = -1;
      surface.invalidateOrder();
      expect(surface.children).toEqual([c, a, b]);

      // a and b are still tied at 0 and must not swap.
      a.order = 0; b.order = 0; c.order = 0;
      surface.invalidateOrder();
      expect(surface.children).toEqual([c, a, b]);
    });

    it('destroying the surface destroys every player it carries', () => {
      const surface = new SSSurface(makeCanvas());
      const a = surface.createPlayer();
      const b = surface.createPlayer();

      surface.destroy();

      // The surface owns the GL-scoped resources; each player only frees its own.
      expect(a.internalPlayer.destroy).toHaveBeenCalled();
      expect(b.internalPlayer.destroy).toHaveBeenCalled();
      expect(surface.renderer.destroy).toHaveBeenCalled();
      expect(surface.children).toHaveLength(0);
    });
  });

  describe('drawing', () => {
    it('renders visible players in order and skips fully transparent ones', () => {
      const surface = new SSSurface(makeCanvas());
      const shown = surface.createPlayer();
      const hidden = surface.createPlayer();
      hidden.alpha = 0;

      surface.draw();

      const rendered = (surface.renderer.render as ReturnType<typeof vi.fn>).mock.calls;
      expect(rendered).toHaveLength(1);
      expect(rendered[0][0]).toBe(shown.internalPlayer);
    });

    it('passes an opaque player tint through premultiplied', () => {
      const surface = new SSSurface(makeCanvas());
      const player = surface.createPlayer();
      player.tint = 0x808080;

      surface.draw();

      const tint = (surface.renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][4];
      // uColor multiplies an already-premultiplied fragment, so RGB has to be
      // scaled by alpha too — at alpha 1 that is the tint unchanged.
      expect(Array.from(tint).map((v) => Math.round(v * 255))).toEqual([128, 128, 128, 255]);
    });

    it('draws a fading player opaque and applies its alpha on composite', () => {
      const surface = new SSSurface(makeCanvas());
      const player = surface.createPlayer();
      player.alpha = 0.5;

      surface.draw();

      // Fading by tint would be per-part: overlapping parts each composite at 0.5
      // and the seams darken. The player is drawn opaque instead and faded once,
      // as a whole image.
      const tint = (surface.renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][4];
      expect(Array.from(tint)).toEqual([1, 1, 1, 1]);
    });

    it('does not build an offscreen target for fully opaque players', async () => {
      const { SSGroupAlpha } = await import('./SSGroupAlpha.js');
      const spy = SSGroupAlpha as unknown as { instances: unknown[] };
      spy.instances.length = 0;

      const surface = new SSSurface(makeCanvas());
      surface.createPlayer();
      surface.draw();
      expect(spy.instances).toHaveLength(0);

      // …and is built as soon as one needs fading.
      surface.children[0].alpha = 0.5;
      surface.draw();
      expect(spy.instances).toHaveLength(1);
    });

    it('does not clear a borrowed context — that would erase the host frame', () => {
      const canvas = makeCanvas();
      const gl = fakeGl(canvas);
      const surface = new SSSurface(gl as unknown as WebGLRenderingContext);
      surface.createPlayer();
      surface.draw();

      expect(gl.clear).not.toHaveBeenCalled();
      // …but it still draws the player onto the host's framebuffer.
      expect(surface.renderer.render).toHaveBeenCalledTimes(1);
    });
  });
});

describe('SSPlayer box', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defaults to the whole surface and follows its resizes', () => {
    const canvas = makeCanvas(800, 600);
    const surface = new SSSurface(canvas);
    const player = surface.createPlayer();

    expect(player.box).toEqual({ x: 0, y: 0, w: 800, h: 600 });

    surface.resize(200, 100, 1);
    expect(player.box).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('places an untransformed player at the box centre', () => {
    const surface = new SSSurface(makeCanvas(800, 600));
    const player = surface.createPlayer();

    const m = player.renderTransform();
    // [m00, m01, m10, m11, tx, ty] — centred means tx/ty are the box centre.
    expect(m[4]).toBe(400);
    expect(m[5]).toBe(300);
  });

  it('treats setTransform as an offset from the box centre', () => {
    const surface = new SSSurface(makeCanvas(800, 600));
    const player = surface.createPlayer();

    player.setTransform({ x: 10, y: -20 });
    const m = player.renderTransform();
    expect(m[4]).toBe(410);
    expect(m[5]).toBe(280);
  });

  it('centres on an explicit box, not on the surface', () => {
    const surface = new SSSurface(makeCanvas(800, 600));
    const player = surface.createPlayer();

    // What overlay mode writes from getBoundingClientRect().
    player.box = { x: 100, y: 50, w: 200, h: 100 };
    const m = player.renderTransform();
    expect(m[4]).toBe(200);
    expect(m[5]).toBe(100);

    player.resetBox();
    expect(player.renderTransform()[4]).toBe(400);
  });

  it('recomposes after the box moves under a transform set earlier', () => {
    const surface = new SSSurface(makeCanvas(800, 600));
    const player = surface.createPlayer();
    player.setTransform({ x: 5, y: 5 });

    surface.resize(400, 400, 1);

    // The matrix is built at draw time precisely so this stays correct.
    const m = player.renderTransform();
    expect(m[4]).toBe(205);
    expect(m[5]).toBe(205);
  });

  it('scales and rotates about the box centre', () => {
    const surface = new SSSurface(makeCanvas(800, 600));
    const player = surface.createPlayer();

    player.setTransform({ scaleX: 2, scaleY: 3 });
    const m = player.renderTransform();
    expect(m[0]).toBe(2);
    expect(m[3]).toBe(3);
    expect(m[4]).toBe(400);
  });
});

describe('SSPlayer placement', () => {
  beforeEach(() => vi.clearAllMocks());

  // A 200x100 canvas whose pivot puts it wholly to the right of and below the
  // origin, so a fit that ignores where the box sits shows.
  const CANVAS = { x: 0, y: 0, width: 200, height: 100 };

  function setup(w = 800, h = 600) {
    const surface = new SSSurface(makeCanvas(w, h));
    const player = surface.createPlayer();
    const internal = (player as unknown as { internalPlayer: { canvasRect: typeof CANVAS | null; flipX: boolean; flipY: boolean } }).internalPlayer;
    internal.canvasRect = CANVAS;
    return { surface, player, internal };
  }

  it('draws at the authored scale about the box centre until a placement is set', () => {
    const { player } = setup();
    const m = player.renderTransform();
    expect([m[0], m[3], m[4], m[5]]).toEqual([1, 1, 400, 300]);
  });

  it('fits the authored canvas into the box', () => {
    const { player } = setup(800, 600);
    player.setPlacement({});
    const m = player.renderTransform();
    // 800/200 = 4 and 600/100 = 6: contain takes the smaller. The canvas centre
    // (100, 50) then sits on the box centre.
    expect(m[0]).toBe(4);
    expect(m[3]).toBe(4);
    expect(m[4]).toBeCloseTo(400 - 4 * 100);
    expect(m[5]).toBeCloseTo(300 - 4 * 50);
  });

  it('adds the transform\'s offset after the fit and multiplies its scale into it', () => {
    const { player } = setup(800, 600);
    player.setPlacement({});
    player.setTransform({ x: 10, y: -5, scaleX: 0.5, scaleY: 0.5 });
    const m = player.renderTransform();
    expect(m[0]).toBe(2);
    expect(m[4]).toBeCloseTo(400 - 4 * 100 + 10);
    expect(m[5]).toBeCloseTo(300 - 4 * 50 - 5);
  });

  it('follows the box when it moves and when it resizes', () => {
    const { surface, player } = setup(800, 600);
    player.setPlacement({ align: 'top-left' });

    player.box = { x: 100, y: 50, w: 400, h: 200 };
    let m = player.renderTransform();
    expect(m[0]).toBe(2);
    expect(m[4]).toBeCloseTo(100); // the canvas's left edge on the box's left edge
    expect(m[5]).toBeCloseTo(50);

    player.resetBox();
    surface.resize(200, 100, 1);
    m = player.renderTransform();
    expect(m[0]).toBe(1);
    expect(m[4]).toBeCloseTo(0);
  });

  it('keeps an edge alignment against its edge when the player is mirrored', () => {
    const { player, internal } = setup(800, 600);
    player.setPlacement({ align: 'left' });
    internal.flipX = true;
    const m = player.renderTransform();
    // Mirrored, the canvas spans [tx - 4*200, tx]: its left edge is tx - 800.
    expect(m[4] - 4 * CANVAS.width).toBeCloseTo(0);
  });

  it('takes a frame of its own over the canvas, and clears back to unfitted', () => {
    const { player } = setup(800, 600);
    player.setPlacement({ frame: { x: -100, y: -100, width: 400, height: 300 } });
    expect(player.renderTransform()[0]).toBe(2);

    player.setPlacement(null);
    expect(player.getPlacement()).toBeNull();
    expect(player.renderTransform()[0]).toBe(1);
  });

  it('falls back to the unfitted placement while there is no canvas', () => {
    const { player, internal } = setup(800, 600);
    internal.canvasRect = null;
    player.setPlacement({});
    const m = player.renderTransform();
    expect([m[0], m[4], m[5]]).toEqual([1, 400, 300]);
  });
});

describe('SSPlayer tint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clamps alpha and premultiplies the tint colour', () => {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();

    expect(Array.from(player.tintVector)).toEqual([1, 1, 1, 1]);

    player.alpha = 5;
    expect(player.alpha).toBe(1);
    player.alpha = -1;
    expect(player.alpha).toBe(0);

    player.alpha = 1;
    player.tint = 0xff0000;
    expect(Array.from(player.tintVector)).toEqual([1, 0, 0, 1]);

    player.alpha = 0.5;
    expect(Array.from(player.tintVector)).toEqual([0.5, 0, 0, 0.5]);
  });

  it('counts a zero-alpha player as invisible', () => {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();
    expect(player.isVisible).toBe(true);
    player.alpha = 0;
    expect(player.isVisible).toBe(false);
  });
});

describe('SSPlayer onAnimationStarted', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fires on play, takes more than one listener, and unsubscribes', () => {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();

    const a: number[] = [];
    const b: number[] = [];
    const offA = player.onAnimationStarted(() => a.push(1));
    player.onAnimationStarted(() => b.push(1));

    player.play();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    // Subscribing returns the unsubscribe, and it only detaches its own.
    offA();
    player.play();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  it('keeps the start in flight from a listener added while it is dispatched', () => {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();

    // A host that reacts to one event by waiting for the next must not be
    // handed the one it is reacting to.
    const seen: string[] = [];
    const off = player.onAnimationStarted(() => {
      seen.push('first');
      off();
      player.onAnimationStarted(() => seen.push('next'));
    });

    player.play();
    expect(seen).toEqual(['first']);
    player.play();
    expect(seen).toEqual(['first', 'next']);
  });

  it('does not fire on resume — a resume carries on, it does not start', () => {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();

    let started = 0;
    player.onAnimationStarted(() => started++);

    player.play();
    player.pause();
    player.resume();
    player.stop();

    expect(started).toBe(1);
  });
});

describe('event listeners', () => {
  it('hear what the update reported though the first of them sets up an animation', () => {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();
    const order: string[] = [];
    const ip = player.internalPlayer as unknown as {
      pollPlaybackEvents: () => { looped: boolean; finished: boolean };
      runtimeManager: { capturePassedEvents: () => unknown[]; getEventsOf: () => unknown; getPartName: () => string };
    };
    ip.pollPlaybackEvents = () => ({ looped: true, finished: true });
    ip.runtimeManager.capturePassedEvents = () => {
      order.push('read');
      return [{ source: 3 }];
    };
    ip.runtimeManager.getPartName = () => 'part';
    ip.runtimeManager.getEventsOf = () => ({
      frameIndex: () => 5,
      usersLength: () => 1,
      users: () => ({
        partIndex: () => 0,
        value: () => ({ integer: () => null, str: () => 'key', rect: () => null, point: () => null }),
      }),
      signalsLength: () => 0,
      audiosLength: () => 0,
    });
    player.onAnimationFinished(() => order.push('finished'));
    player.onAnimationLooped(() => order.push('looped'));
    player.onUserData((event) => order.push(`user data ${event.str} from ${event.source}`));

    (player as unknown as { pollEvents(): void }).pollEvents();

    expect(order).toEqual(['read', 'finished', 'looped', 'user data key from 3']);
  });
});

describe('onFrame', () => {
  // The Surface updates every player and then draws them, and the draw is what
  // evaluates a frame. A listener that ran before it read the world matrices of
  // the frame drawn last time.
  function advancingPlayer() {
    const surface = new SSSurface(makeCanvas());
    const player = surface.createPlayer();
    const order: string[] = [];
    const ip = player.internalPlayer as unknown as {
      isPlaying: boolean;
      isTicking: boolean;
      isPausing: boolean;
      isHeld: boolean;
      update: () => void;
      evaluateDrawFrame: ReturnType<typeof vi.fn>;
    };
    ip.isPlaying = true;
    ip.isTicking = true;
    ip.update = () => order.push('update');
    ip.evaluateDrawFrame = vi.fn(() => order.push('evaluate'));
    return { surface, player, ip, order };
  }

  it('fires once the frame it reports has been evaluated', () => {
    const { surface, player, order } = advancingPlayer();
    player.onFrame(() => order.push('listener'));

    surface.update(16);

    expect(order).toEqual(['update', 'evaluate', 'listener']);
  });

  it('evaluates nothing ahead of the draw when nobody listens', () => {
    const { surface, ip } = advancingPlayer();

    surface.update(16);

    expect(ip.evaluateDrawFrame).not.toHaveBeenCalled();
  });

  it('is not called while a pause holds the clock, though track 0 has finished', () => {
    const { surface, player, ip, order } = advancingPlayer();
    player.onFrame(() => order.push('listener'));
    // Track 0 has run out under an overlay, so track 0 reads as not paused.
    ip.isPlaying = false;
    ip.isPausing = false;
    ip.isHeld = true;

    surface.update(16);

    expect(order).toEqual(['update']);
  });
});
