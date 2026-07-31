import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What matters here is texture *ownership*, not pixels: which textures this
 * manager may free when its player goes away, and which belong to Pixi's global,
 * deliberately-shared `Assets` cache and must survive. Getting that wrong blanks
 * out a sibling player still drawing with the same atlas — a bug this package
 * has already had once.
 *
 * Pixi is mocked rather than booted: `Assets` is a global cache with real
 * network and GPU behaviour behind it, and none of that is what these rules are
 * about. The fake keeps the two things the manager actually depends on — alias
 * registration and the cache lookup.
 */

const assetsState = {
  registered: new Map<string, string>(), // alias -> url
  cache: new Map<string, FakeTexture>(),
  loadCalls: [] as string[],
  failFor: new Set<string>(),
};

class FakeTexture {
  public destroyed = false;
  constructor(public readonly label: string) {}
  destroy(_destroySource?: boolean) { this.destroyed = true; }
}

vi.mock('pixi.js', () => ({
  Assets: {
    resolver: { hasKey: (alias: string) => assetsState.registered.has(alias) },
    add: ({ alias, src }: { alias: string; src: string }) => { assetsState.registered.set(alias, src); },
    cache: { has: (alias: string) => assetsState.cache.has(alias) },
    load: async (alias: string) => {
      assetsState.loadCalls.push(alias);
      const url = assetsState.registered.get(alias)!;
      if (assetsState.failFor.has(url)) throw new Error(`404 ${url}`);
      const tex = new FakeTexture(url);
      assetsState.cache.set(alias, tex);
      return tex;
    },
    get: (alias: string) => assetsState.cache.get(alias),
    // Present so that a regression reintroducing the unload-on-destroy bug fails
    // on the assertion about shared state, not on a missing mock method.
    unload: async (alias: string) => { assetsState.cache.delete(alias); },
  },
  Texture: class {
    public destroyed = false;
    constructor(public readonly opts: unknown) {}
    destroy(_destroySource?: boolean) { this.destroyed = true; }
  },
  ImageSource: class {
    constructor(public readonly opts: unknown) {}
  },
}));

const { PixiResourceManager } = await import('./PixiResourceManager.js');

beforeEach(() => {
  assetsState.registered.clear();
  assetsState.cache.clear();
  assetsState.loadCalls.length = 0;
  assetsState.failFor.clear();
  // jsdom has no createImageBitmap; the manager only forwards the result.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 32 })));
});

describe('URL-loaded textures live in the shared Assets cache', () => {
  it('loads a hash once, however many managers ask for it', async () => {
    const a = new PixiResourceManager();
    const b = new PixiResourceManager();

    await a.loadTexture('/chara/atlas.png', 0x1111);
    await b.loadTexture('/chara/atlas.png', 0x1111);

    expect(assetsState.loadCalls).toEqual(['4369']); // one load, keyed by hash
    expect(a.getTexture(0x1111)).toBe(b.getTexture(0x1111));
  });

  it('does NOT unload them on destroy — a sibling may still be drawing', async () => {
    const a = new PixiResourceManager();
    const b = new PixiResourceManager();
    await a.loadTexture('/chara/atlas.png', 0x1111);
    await b.loadTexture('/chara/atlas.png', 0x1111);
    const shared = b.getTexture(0x1111);

    a.destroy();

    // The regression this guards: destroy() used to Assets.unload() the hash,
    // blanking out every other player that had loaded the same atlas.
    expect(b.getTexture(0x1111)).toBe(shared);
    expect((shared as unknown as FakeTexture).destroyed).toBe(false);
  });

  it('swallows a failed load rather than rejecting', async () => {
    // Deliberate, and a difference from ssplayer-webgl, which rejects: here a
    // 404 atlas leaves the pack loading "successfully" and rendering untextured.
    assetsState.failFor.add('/missing.png');
    const console_error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rm = new PixiResourceManager();

    await expect(rm.loadTexture('/missing.png', 0x2222)).resolves.toBeUndefined();

    expect(rm.getTexture(0x2222)).toBeUndefined();
    expect(console_error).toHaveBeenCalled();
    console_error.mockRestore();
  });
});

describe('embedded textures are owned by the manager', () => {
  it('are freed on destroy', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTextureFromBytes(new Uint8Array([1, 2, 3]), 0x3333);
    const tex = rm.getTexture(0x3333)!;

    rm.destroy();

    expect((tex as unknown as FakeTexture).destroyed).toBe(true);
    expect(rm.getTexture(0x3333)).toBeUndefined();
  });

  it('are decoded once per hash', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTextureFromBytes(new Uint8Array([1, 2, 3]), 0x3333);
    const first = rm.getTexture(0x3333);
    await rm.loadTextureFromBytes(new Uint8Array([4, 5, 6]), 0x3333);

    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
    expect(rm.getTexture(0x3333)).toBe(first);
  });

  it('are never shared with another manager, even under the same hash', async () => {
    // Two packs can carry the same cell-map name with completely different
    // pixels, so an embedded texture must not leak across players the way a
    // URL-keyed one does.
    const a = new PixiResourceManager();
    const b = new PixiResourceManager();
    await a.loadTextureFromBytes(new Uint8Array([1]), 0x3333);

    expect(b.getTexture(0x3333)).toBeUndefined();
  });

  it('win over the Assets cache when both hold the same hash', async () => {
    // The resolution order getTexture encodes: this player's own bytes first.
    const rm = new PixiResourceManager();
    await rm.loadTexture('/chara/atlas.png', 0x4444);
    const fromCache = rm.getTexture(0x4444);
    await rm.loadTextureFromBytes(new Uint8Array([1]), 0x4444);

    expect(rm.getTexture(0x4444)).not.toBe(fromCache);
  });
});
