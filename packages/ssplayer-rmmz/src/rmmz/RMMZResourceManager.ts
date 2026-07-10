// RMMZResourceManager — makes SS texture loading go through RPG Maker MZ's own
// ImageManager / Bitmap cache (spec §7.4 Dependency Injection), while reusing
// ssplayer-webgl's SSWebGLResourceManager for the actual GL upload into MZ's
// shared context.
//
// We subclass SSWebGLResourceManager (rather than reimplement it) so the
// renderer keeps getting the exact `{ tex, width, height }` records
// SSWebGLRenderer expects, plus context-loss restore for free. We override only
// `loadTexture`: instead of fetching the PNG ourselves, we ask ImageManager for
// the Bitmap (so MZ owns the cache / can pre-load it during scene transitions),
// then hand its backing canvas to `bindTextureSource` for the GL upload.
//
// Note: this uploads a second copy of the pixels into GL (MZ already holds a
// PIXI.BaseTexture for the same Bitmap). That small VRAM duplication is the v1
// trade for a clean, cache-integrated path; a later phase can reuse MZ's
// existing GLTexture directly.

import { SSWebGLResourceManager } from '@spritestudio/ssplayer-webgl';
import { getImageManager, type GL, type RMMZBitmap } from '../rmmzGlobals.js';

export class RMMZResourceManager extends SSWebGLResourceManager {
  constructor(gl: GL) {
    super(gl);
  }

  /**
   * Load the texture at `url` via MZ's ImageManager and upload it under `hash`.
   * Resolves once the Bitmap's pixels are ready. Falls back to the base class's
   * own fetch when ImageManager is unavailable (e.g. unit tests).
   */
  public override loadTexture(url: string, hash: number): Promise<void> {
    const im = getImageManager();
    if (!im) return super.loadTexture(url, hash);

    const { folder, filename } = splitBitmapUrl(url);
    const bitmap = im.loadBitmap(folder, filename);
    return new Promise<void>((resolve) => {
      const finish = (bmp: RMMZBitmap) => {
        this.bindTextureSource(bmp.canvas, hash, bmp.width, bmp.height);
        resolve();
      };
      if (bitmap.isReady()) finish(bitmap);
      else bitmap.addLoadListener(finish);
    });
  }
}

/**
 * Split an SS texture URL into MZ's (folder, filename-without-extension) shape.
 * ImageManager.loadBitmap expects a folder ending in "/" and an un-extensioned,
 * URL-decoded filename (it re-encodes internally).
 */
export function splitBitmapUrl(url: string): { folder: string; filename: string } {
  const slash = url.lastIndexOf('/');
  const folder = slash >= 0 ? url.slice(0, slash + 1) : 'img/spritestudio/';
  let filename = slash >= 0 ? url.slice(slash + 1) : url;
  const dot = filename.lastIndexOf('.');
  if (dot >= 0) filename = filename.slice(0, dot);
  try {
    filename = decodeURIComponent(filename);
  } catch {
    /* leave as-is if not valid percent-encoding */
  }
  return { folder, filename };
}
