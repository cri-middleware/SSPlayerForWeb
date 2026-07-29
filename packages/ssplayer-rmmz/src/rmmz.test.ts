import { afterEach, describe, expect, it, vi } from 'vitest';

// The resource manager extends ssplayer-webgl's SSWebGLResourceManager, which
// pulls the WASM glue. We only test the pure URL-splitting helper, so stub the
// base class to avoid needing a GL context / built package.
const ssRender = vi.fn();
vi.mock('@spritestudio/ssplayer-webgl', () => ({
  SSWebGLResourceManager: class {
    constructor(_gl: unknown) {}
  },
  SSWebGLRenderer: class {
    render = ssRender;
    destroy = vi.fn();
    constructor(_gl: unknown) {}
  },
}));

import { getSelfScriptDir, isMZ } from './rmmzGlobals.js';
import { isDecryptable, splitBitmapUrl } from './rmmz/RMMZResourceManager.js';
import { SSPlayerRenderer } from './SSPlayerRenderer.js';

describe('rmmzGlobals', () => {
  afterEach(() => {
    Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
    delete (globalThis as any).PIXI;
    delete (globalThis as any).Graphics;
  });

  it('isMZ() is false outside a booted MZ runtime', () => {
    expect(isMZ()).toBe(false);
  });

  it('getSelfScriptDir() returns the directory of the current script', () => {
    Object.defineProperty(document, 'currentScript', {
      value: { src: 'https://example.com/game/js/plugins/ssplayer-rpgmakermz.js' },
      configurable: true,
    });
    expect(getSelfScriptDir()).toBe('https://example.com/game/js/plugins/');
  });

  it('getSelfScriptDir() is empty when there is no current script', () => {
    Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
    expect(getSelfScriptDir()).toBe('');
  });
});

describe('splitBitmapUrl', () => {
  it('splits folder + extension-less filename for ImageManager', () => {
    expect(splitBitmapUrl('spritestudio/Ringo/Ringo.png')).toEqual({
      folder: 'spritestudio/Ringo/',
      filename: 'Ringo',
    });
  });

  it('decodes percent-encoded filenames', () => {
    expect(splitBitmapUrl('spritestudio/A%20B/cell%20map.png')).toEqual({
      folder: 'spritestudio/A%20B/',
      filename: 'cell map',
    });
  });

  it('falls back to a default folder when the url has no slash', () => {
    expect(splitBitmapUrl('cellmap.png')).toEqual({
      folder: 'spritestudio/',
      filename: 'cellmap',
    });
  });
});

describe('isDecryptable', () => {
  afterEach(() => {
    delete (globalThis as any).Utils;
  });

  it('is true for every url when the deployment is not encrypted', () => {
    expect(isDecryptable('spritestudio/Ringo/Ringo.png')).toBe(true);
    expect(isDecryptable('img/spritestudio/Ringo/Ringo.png')).toBe(true);
  });

  it('is false outside img/ once images are encrypted', () => {
    (globalThis as any).Utils = { hasEncryptedImages: () => true };
    // MZ only encrypts img/ and audio/, so ImageManager's "url + _" decrypt
    // path would 404 on a texture that lives anywhere else.
    expect(isDecryptable('spritestudio/Ringo/Ringo.png')).toBe(false);
    expect(isDecryptable('img/spritestudio/Ringo/Ringo.png')).toBe(true);
    expect(isDecryptable('https://example.com/game/img/ss/Ringo.png')).toBe(true);
  });
});

describe('SSPlayerRenderer', () => {
  // Minimal stand-in for the bits of PIXI.Renderer the draw path touches.
  const makePixiRenderer = () => ({
    gl: {} as any,
    resolution: 1,
    batch: { flush: vi.fn() },
    geometry: { reset: vi.fn() },
    texture: { reset: vi.fn() },
    state: { reset: vi.fn() },
    shader: { reset: vi.fn() },
    framebuffer: { reset: vi.fn(), current: null as unknown },
  });

  const makePlayer = (worldAlpha: number) => ({
    internalPlayer: { animationName: 'Anime_1' },
    resourceManager: {},
    worldTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    worldAlpha,
  });

  afterEach(() => ssRender.mockClear());

  // Pixi applies worldAlpha inside its own batch shader, which the raw GL draw
  // bypasses — so without feeding it in by hand, [Change Picture Opacity] left SS
  // animations fully opaque while the rest of the scene faded.
  it('feeds MZ opacity to the SS renderer as a premultiplied world tint', () => {
    const r = new SSPlayerRenderer(makePixiRenderer() as any);
    r.render(makePlayer(0.25) as any);

    const tint = ssRender.mock.calls[0][4];
    // (rgb * a, a): uColor multiplies an already-premultiplied fragment, so alpha
    // has to scale RGB too or the animation stays bright while fading out.
    expect(Array.from(tint as Float32Array)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it('draws at full opacity when the host has no alpha', () => {
    const r = new SSPlayerRenderer(makePixiRenderer() as any);
    const player = makePlayer(1) as any;
    delete player.worldAlpha;
    r.render(player);

    expect(Array.from(ssRender.mock.calls[0][4] as Float32Array)).toEqual([1, 1, 1, 1]);
  });

  // SSWebGLRenderer builds its own projection, so it has to be told which way up
  // the destination runs. Pixi flips its own projection only when drawing into an
  // FBO (filters / masks); on the plain path it does not.
  it('does not flip Y when Pixi is drawing to the default framebuffer', () => {
    const r = new SSPlayerRenderer(makePixiRenderer() as any);
    r.render(makePlayer(1) as any);
    expect(ssRender.mock.calls[0][3]).toBe(false);
  });

  it('flips Y when Pixi is drawing into a framebuffer', () => {
    const pixi = makePixiRenderer();
    pixi.framebuffer.current = {}; // a filter or mask is active
    const r = new SSPlayerRenderer(pixi as any);
    r.render(makePlayer(1) as any);
    expect(ssRender.mock.calls[0][3]).toBe(true);
  });

  it('skips a player with no animation set', () => {
    const r = new SSPlayerRenderer(makePixiRenderer() as any);
    const player = makePlayer(1) as any;
    player.internalPlayer.animationName = '';
    r.render(player);

    expect(ssRender).not.toHaveBeenCalled();
  });
});
