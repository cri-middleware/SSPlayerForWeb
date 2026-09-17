import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two rules: texture identity is the URL, never the cell-map hash (which is
 * unique only within one `.ssab`); and ownership — which textures this manager
 * may free, and which belong to the shared `Assets` cache and must survive.
 *
 * Pixi is mocked rather than booted: the fake keeps the one thing the manager
 * depends on — a URL-keyed load-once cache.
 */

const assetsState = {
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
    load: async (url: string) => {
      if (assetsState.failFor.has(url)) throw new Error(`404 ${url}`);
      const hit = assetsState.cache.get(url);
      if (hit) return hit;
      assetsState.loadCalls.push(url);
      const tex = new FakeTexture(url);
      assetsState.cache.set(url, tex);
      return tex;
    },
    // Present so that a regression reintroducing the unload-on-destroy bug fails
    // on the assertion about shared state, not on a missing mock method.
    unload: async (url: string) => { assetsState.cache.delete(url); },
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
  assetsState.cache.clear();
  assetsState.loadCalls.length = 0;
  assetsState.failFor.clear();
  // jsdom has no createImageBitmap; the manager only forwards the result.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 32 })));
});

describe('URL-loaded textures live in the shared Assets cache', () => {
  it('loads a URL once, however many managers ask for it', async () => {
    const a = new PixiResourceManager();
    const b = new PixiResourceManager();

    await a.loadTexture('/chara/atlas.png', 0x1111);
    await b.loadTexture('/chara/atlas.png', 0x1111);

    expect(assetsState.loadCalls).toEqual(['/chara/atlas.png']); // one load, keyed by URL
    expect(a.getTexture(0x1111)).toBe(b.getTexture(0x1111));
  });

  it('does NOT share on the hash — two projects, one cell-map name', async () => {
    const a = new PixiResourceManager();
    const b = new PixiResourceManager();

    await a.loadTexture('/projectA/texture.png', 0x1111);
    await b.loadTexture('/projectB/texture.png', 0x1111);

    expect((a.getTexture(0x1111) as unknown as FakeTexture).label).toBe('/projectA/texture.png');
    expect((b.getTexture(0x1111) as unknown as FakeTexture).label).toBe('/projectB/texture.png');
    expect(assetsState.loadCalls).toHaveLength(2);
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

describe('reset() — the core calls it whenever a new pack is bound', () => {
  it('lets the next pack load its own texture under a shared hash', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTexture('/projectA/texture.png', 0x1111);

    rm.reset();
    await rm.loadTexture('/projectB/texture.png', 0x1111);

    expect((rm.getTexture(0x1111) as unknown as FakeTexture).label).toBe('/projectB/texture.png');
  });

  it('re-decodes embedded bytes for the next pack', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTextureFromBytes(new Uint8Array([1, 2, 3]), 0x3333);
    const first = rm.getTexture(0x3333)!;

    rm.reset();
    await rm.loadTextureFromBytes(new Uint8Array([4, 5, 6]), 0x3333);

    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(2);
    expect(rm.getTexture(0x3333)).not.toBe(first);
    expect((first as unknown as { destroyed: boolean }).destroyed).toBe(true);
  });

  it('leaves the shared Assets cache alone', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTexture('/chara/atlas.png', 0x1111);
    const tex = rm.getTexture(0x1111)!;

    rm.reset();

    expect((tex as unknown as FakeTexture).destroyed).toBe(false);
    expect(assetsState.cache.has('/chara/atlas.png')).toBe(true);
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

  it('are decoded once per hash within one pack', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTextureFromBytes(new Uint8Array([1, 2, 3]), 0x3333);
    const first = rm.getTexture(0x3333);
    await rm.loadTextureFromBytes(new Uint8Array([4, 5, 6]), 0x3333);

    expect(globalThis.createImageBitmap).toHaveBeenCalledTimes(1);
    expect(rm.getTexture(0x3333)).toBe(first);
  });

  it('are never shared with another manager, even under the same hash', async () => {
    // Two packs can carry the same cell-map name with completely different
    // pixels, so an embedded texture must stay private to its player.
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

  it('block a later URL load of the same hash', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTextureFromBytes(new Uint8Array([1]), 0x5555);

    await rm.loadTexture('/resolved/but/bogus.png', 0x5555);

    expect(assetsState.loadCalls).toEqual([]);
  });
});

describe('runtime texture overrides (setCellmapTexture)', () => {
  it('shadow the loaded texture and restore it when cleared', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTexture('/chara/atlas.png', 0x1111);
    const original = rm.getTexture(0x1111);
    const override = new FakeTexture('override');

    rm.setOverrideTexture(0x1111, override as never);
    expect(rm.getTexture(0x1111)).toBe(override);
    expect(rm.getOverrideTexture(0x1111)).toBe(override);

    rm.clearOverrideTexture(0x1111);
    // Cleared without a reload — the original texture object is still there.
    expect(rm.getTexture(0x1111)).toBe(original);
    expect(rm.getOverrideTexture(0x1111)).toBeUndefined();
  });

  it('win over an embedded texture too', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTextureFromBytes(new Uint8Array([1]), 0x3333);
    const override = new FakeTexture('override');

    rm.setOverrideTexture(0x3333, override as never);

    expect(rm.getTexture(0x3333)).toBe(override);
  });

  it('are caller-owned: never destroyed, only forgotten, on reset', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTexture('/chara/atlas.png', 0x1111);
    const override = new FakeTexture('override');
    rm.setOverrideTexture(0x1111, override as never);

    rm.reset();

    expect(override.destroyed).toBe(false); // the caller still owns it
    expect(rm.getOverrideTexture(0x1111)).toBeUndefined(); // but the binding is gone
  });

  it('getOverrideTexture returns nothing for a merely-loaded texture', async () => {
    const rm = new PixiResourceManager();
    await rm.loadTexture('/chara/atlas.png', 0x1111);

    expect(rm.getOverrideTexture(0x1111)).toBeUndefined();
  });
});
