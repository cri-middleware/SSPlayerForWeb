import { afterEach, describe, expect, it, vi } from 'vitest';

// The resource manager extends ssplayer-webgl's SSWebGLResourceManager, which
// pulls the WASM glue. We only test the pure URL-splitting helper, so stub the
// base class to avoid needing a GL context / built package.
vi.mock('@spritestudio/ssplayer-webgl', () => ({
  SSWebGLResourceManager: class {
    constructor(_gl: unknown) {}
  },
}));

import { getSelfScriptDir, isMZ } from './rmmzGlobals.js';
import { isDecryptable, splitBitmapUrl } from './rmmz/RMMZResourceManager.js';

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
