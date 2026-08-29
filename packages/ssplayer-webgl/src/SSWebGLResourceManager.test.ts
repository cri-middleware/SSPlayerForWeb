import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
import { SSWebGLTextureCache } from './SSWebGLTextureCache.js';

/**
 * What matters here is the sharing boundary, not the pixels: which textures a
 * surface shares between its players, which stay private, and which a player is
 * allowed to delete when it goes. Getting that wrong either wastes VRAM or —
 * worse — frees a texture a sibling is still drawing with.
 */

let nextTexture = 0;
const deleted: unknown[] = [];
// URLs the fake Image was asked to fetch, in order.
const requested: string[] = [];

function fakeGl() {
  return {
    createTexture: vi.fn(() => ({ id: ++nextTexture })),
    deleteTexture: vi.fn((t: unknown) => { deleted.push(t); }),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    getParameter: vi.fn(() => false),
    TEXTURE_2D: 1, RGBA: 2, UNSIGNED_BYTE: 3, CLAMP_TO_EDGE: 4, LINEAR: 5,
    TEXTURE_WRAP_S: 6, TEXTURE_WRAP_T: 7, TEXTURE_MIN_FILTER: 8, TEXTURE_MAG_FILTER: 9,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 10,
  } as unknown as WebGLRenderingContext;
}

// jsdom never fires Image load events, so resolve them synchronously instead.
beforeEach(() => {
  deleted.length = 0;
  requested.length = 0;
  // jsdom has no createImageBitmap; the manager only forwards the result.
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 32, close: () => {} })));
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = '';
    width = 64;
    height = 32;
    set src(v: string) { requested.push(v); queueMicrotask(() => this.onload?.()); }
  });
});

describe('SSWebGLResourceManager sharing', () => {
  it('uploads a URL once for every player on the same surface', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    const b = new SSWebGLResourceManager(gl, cache);

    await a.loadTexture('/chara/atlas.png', 0x1111);
    await b.loadTexture('/chara/atlas.png', 0x1111);

    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(a.getTexture(0x1111)).toBe(b.getTexture(0x1111));
  });

  it('shares by URL, not by cell-map hash', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    const b = new SSWebGLResourceManager(gl, cache);

    // Two unrelated .ssab files can both contain a cell map called "chara", so
    // the hash collides while the images are completely different. Sharing on
    // the hash would hand one character the other's atlas.
    await a.loadTexture('/project-a/chara.png', 0x1111);
    await b.loadTexture('/project-b/chara.png', 0x1111);

    expect(gl.createTexture).toHaveBeenCalledTimes(2);
    expect(a.getTexture(0x1111)).not.toBe(b.getTexture(0x1111));
  });

  it('collapses concurrent requests for the same URL into one upload', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    const b = new SSWebGLResourceManager(gl, cache);

    await Promise.all([
      a.loadTexture('/chara/atlas.png', 0x1111),
      b.loadTexture('/chara/atlas.png', 0x2222),
    ]);

    expect(gl.createTexture).toHaveBeenCalledTimes(1);
  });

  it('keeps caller-supplied textures private to their player', () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    const b = new SSWebGLResourceManager(gl, cache);

    // Same hash, different pixels: whoever supplied it meant it for their player.
    a.bindTextureSource({} as TexImageSource, 0x1111, 8, 8);
    b.bindTextureSource({} as TexImageSource, 0x1111, 8, 8);

    expect(a.getTexture(0x1111)).not.toBe(b.getTexture(0x1111));
  });

  it('frees only what a player uploaded itself', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    const b = new SSWebGLResourceManager(gl, cache);

    await a.loadTexture('/chara/atlas.png', 0x1111);
    a.bindTextureSource({} as TexImageSource, 0x2222, 8, 8);
    await b.loadTexture('/chara/atlas.png', 0x1111);

    const shared = b.getTexture(0x1111)!.tex;
    const own = a.getTexture(0x2222)!.tex;

    a.destroy();

    // Its own texture goes; the shared atlas stays, because b is still drawing
    // with it. That is the trap ssplayer-pixi hit by unloading from destroy().
    expect(deleted).toContain(own);
    expect(deleted).not.toContain(shared);
  });

  it('lets the surface free the shared textures', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    await a.loadTexture('/chara/atlas.png', 0x1111);
    const shared = a.getTexture(0x1111)!.tex;

    a.destroy();
    expect(deleted).not.toContain(shared);

    cache.destroy();
    expect(deleted).toContain(shared);
  });

  it('re-uploads once for all players after a context loss', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const a = new SSWebGLResourceManager(gl, cache);
    const b = new SSWebGLResourceManager(gl, cache);
    await a.loadTexture('/chara/atlas.png', 0x1111);
    await b.loadTexture('/chara/atlas.png', 0x1111);
    (gl.createTexture as ReturnType<typeof vi.fn>).mockClear();

    // The surface invalidates the cache first, then restores each player.
    cache.invalidate();
    await Promise.all([a.restoreContext(), b.restoreContext()]);

    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(a.getTexture(0x1111)).toBe(b.getTexture(0x1111));
  });

  it('works standalone, with no cache to share through', async () => {
    const gl = fakeGl();
    const a = new SSWebGLResourceManager(gl);
    const b = new SSWebGLResourceManager(gl);

    await a.loadTexture('/chara/atlas.png', 0x1111);
    await b.loadTexture('/chara/atlas.png', 0x1111);

    // Each owns its copy — and may therefore free it.
    expect(gl.createTexture).toHaveBeenCalledTimes(2);
    const own = a.getTexture(0x1111)!.tex;
    a.destroy();
    expect(deleted).toContain(own);
  });
});

describe('reset() — a new pack replaces the previous pack textures', () => {
  it('loads the new atlas under a hash the previous pack also used', async () => {
    const gl = fakeGl();
    const rm = new SSWebGLResourceManager(gl, new SSWebGLTextureCache(gl));
    const HASH = 0x1111;

    await rm.loadTexture('/projectA/texture.png', HASH);
    rm.reset();
    await rm.loadTexture('/projectB/texture.png', HASH);

    expect(requested).toEqual(['/projectA/texture.png', '/projectB/texture.png']);
  });

  it('frees the textures it owns, and only those', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const shared = new SSWebGLResourceManager(gl, cache);
    const standalone = new SSWebGLResourceManager(gl);

    await shared.loadTexture('/chara/atlas.png', 0x1111);
    await standalone.loadTexture('/chara/atlas.png', 0x1111);
    await shared.loadTextureFromBytes(new Uint8Array([1, 2, 3]), 0x2222);
    const fromCache = shared.getTexture(0x1111)!.tex;
    const embedded = shared.getTexture(0x2222)!.tex;
    const owned = standalone.getTexture(0x1111)!.tex;

    shared.reset();
    standalone.reset();

    expect(deleted).toContain(embedded);
    expect(deleted).toContain(owned);
    expect(deleted).not.toContain(fromCache);
    expect(shared.getTexture(0x1111)).toBeUndefined();
  });

  it('does not resurrect the old pack textures on a later context loss', async () => {
    const gl = fakeGl();
    const cache = new SSWebGLTextureCache(gl);
    const rm = new SSWebGLResourceManager(gl, cache);
    await rm.loadTexture('/projectA/texture.png', 0x1111);

    rm.reset();
    await rm.loadTexture('/projectB/texture.png', 0x1111);
    requested.length = 0;
    cache.invalidate(); // as the Surface does, before restoring each player
    await rm.restoreContext();

    expect(requested).toEqual(['/projectB/texture.png']);
  });
});
