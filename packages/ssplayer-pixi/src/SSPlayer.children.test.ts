import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';

// Only the core player is faked, and only as far as the constructor and
// renderFrame reach: what is pinned is which children a frame clears.
vi.mock('@spritestudio/ssplayer-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spritestudio/ssplayer-core')>();
  return {
    ...actual,
    DirectInternalPlayer: class {
      runtimeManager = { getFrameData: () => ({}) };
      getRootAffine = () => null;
      destroy = vi.fn();
    },
  };
});

import { SSPlayer } from './SSPlayer.js';

type Internals = {
  renderContext: (...args: unknown[]) => void;
  renderFrame(frameNo: number): void;
  _art: Container;
  _attachmentLayer: Container;
  _follower: { size: number; update(): void; detachAll(): void };
};

const made: SSPlayer[] = [];

/** A player whose frame draws one fresh child of its own, as the real one draws meshes. */
function makePlayer() {
  const player = new SSPlayer();
  made.push(player);
  const internals = player as unknown as Internals;
  internals.renderContext = () => {
    internals._art.addChild(new Container());
  };
  return { player, internals };
}

describe('what a frame clears', () => {
  afterEach(() => {
    // Each player registered itself on the shared ticker.
    for (const player of made.splice(0)) player.destroy();
  });

  it('keeps a display object the host parented onto the player', () => {
    const { player, internals } = makePlayer();
    const label = new Container();
    player.addChild(label);

    internals.renderFrame(0);
    internals.renderFrame(1);

    expect(label.parent).toBe(player);
  });

  it('replaces only its own drawing, one frame after another', () => {
    const { internals } = makePlayer();

    internals.renderFrame(0);
    const first = internals._art.children[0];
    internals.renderFrame(1);

    expect(internals._art.children).toHaveLength(1);
    expect(internals._art.children[0]).not.toBe(first);
  });

  it('draws the animation below what the host added, and followers above both', () => {
    const { player, internals } = makePlayer();
    const label = new Container();
    player.addChild(label);
    // A follower is a target the player drives to a part; the layer holding it
    // must end up last however many children the host adds.
    internals._follower = { size: 1, update: () => {}, detachAll: () => {} };

    internals.renderFrame(0);
    const late = new Container();
    player.addChild(late);
    internals.renderFrame(1);

    const order = player.children;
    expect(order.indexOf(internals._art)).toBeLessThan(order.indexOf(label));
    expect(order.indexOf(late)).toBeLessThan(order.indexOf(internals._attachmentLayer));
    expect(order[order.length - 1]).toBe(internals._attachmentLayer);
  });
});
