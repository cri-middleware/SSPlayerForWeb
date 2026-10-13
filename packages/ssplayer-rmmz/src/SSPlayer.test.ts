import { describe, expect, it, vi } from 'vitest';

// The MZ host calls update() from its sprite's update(), and MZ renders us — which
// is what evaluates a frame — only after that. Followers and onFrame listeners
// driven from update() therefore read the world matrices of the frame rendered
// last time unless update() evaluates the new one first.
//
// No PIXI global here, so SSPlayer extends a plain class and skips the renderer
// plugin; the core is faked down to what update() touches.

const fake = vi.hoisted(() => ({ order: [] as string[], followers: 0 }));

vi.mock('@spritestudio/ssplayer-webgl', async () => ({
  // The real one, from source: listener dispatch is what onFrame rides on.
  ListenerSet: (await import('../../ssplayer-core/src/ListenerSet.js')).ListenerSet,
  SSWebGLResourceManager: class {
    constructor(_gl: unknown) {}
  },
  DirectInternalPlayer: class {
    isPlaying = true;
    isTicking = true;
    isHeld = false;
    runtimeManager = { context: { get_passed_event_count: () => 0 } };
    update = vi.fn(() => fake.order.push('update'));
    evaluateDrawFrame = vi.fn(() => fake.order.push('evaluate'));
    pollPlaybackEvents = vi.fn(() => ({ looped: false, finished: false }));
    getFrameNo = vi.fn(() => 0);
    constructor(_rm: unknown) {}
  },
  SSPartFollower: class {
    get size() {
      return fake.followers;
    }
    update = vi.fn(() => fake.order.push('follow'));
    constructor(_source: unknown, _adapter: unknown) {}
  },
  initializeWasm: vi.fn(),
  hashString: vi.fn(() => 0),
  SSBlendOp: {},
  ssFormat: {},
  SSOverridePriority: { HoldUntilNextAnimation: 1 },
}));

const { SSPlayer } = await import('./SSPlayer.js');

function makePlayer(followers: number) {
  fake.order.length = 0;
  fake.followers = followers;
  return new SSPlayer({} as WebGLRenderingContext);
}

describe('SSPlayer.update', () => {
  it('evaluates the frame before it drives followers and onFrame', () => {
    const player = makePlayer(1);
    player.onFrame(() => fake.order.push('listener'));

    player.update(16);

    expect(fake.order).toEqual(['update', 'evaluate', 'follow', 'listener']);
  });

  it('evaluates for an onFrame listener alone', () => {
    const player = makePlayer(0);
    player.onFrame(() => fake.order.push('listener'));

    player.update(16);

    expect(fake.order).toEqual(['update', 'evaluate', 'listener']);
  });

  it('evaluates nothing ahead of the render when nothing reads', () => {
    const player = makePlayer(0);

    player.update(16);

    expect(fake.order).toEqual(['update']);
  });
});
