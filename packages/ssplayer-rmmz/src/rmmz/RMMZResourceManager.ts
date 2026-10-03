// RMMZResourceManager — makes SS texture loading go through RPG Maker MZ's own
// ImageManager / Bitmap cache, while reusing
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
import { getImageManager, hasEncryptedImages, type GL, type RMMZBitmap } from '../rmmzGlobals.js';
import { SSLoadError } from './loadError.js';

export class RMMZResourceManager extends SSWebGLResourceManager {
  constructor(gl: GL) {
    super(gl);
  }

  /**
   * Load the texture at `url` via MZ's ImageManager and upload it under `hash`.
   * Resolves once the Bitmap's pixels are ready. Falls back to the base class's
   * own fetch when ImageManager is unavailable (e.g. unit tests) or when the
   * texture lives outside img/ in an encrypted deployment (see isDecryptable).
   */
  public override loadTexture(url: string, hash: number): Promise<void> {
    const im = getImageManager();
    if (!im || !isDecryptable(url)) {
      return super.loadTexture(url, hash).catch((e: unknown) => {
        throw new SSLoadError(url, `[ssplayer-rmmz] failed to load SS texture "${url}": ${String(e)}`);
      });
    }

    const { folder, filename } = splitBitmapUrl(url);
    const bitmap = im.loadBitmap(folder, filename);
    // ImageManager caches the Bitmap even when it failed, so without this a
    // Retry on the "Failed to load" screen would be handed the same failure.
    if (bitmap.isError()) bitmap.retry();
    return new Promise<void>((resolve, reject) => {
      const finish = (bmp: RMMZBitmap) => {
        if (bmp.isError()) {
          // MZ never calls the load listeners on failure, so isError() is our
          // only signal — without this the caller would await forever. The most
          // common cause is deployment's "Exclude unused files" having deleted
          // the texture; say so rather than just "load failed".
          reject(
            new SSLoadError(
              url,
              `[ssplayer-rmmz] failed to load SS texture "${url}". If this game was deployed ` +
                `with "Exclude unused files", assets under img/ are removed — keep SS assets ` +
                `outside img/, audio/ and effects/ (e.g. spritestudio/) instead.`,
            ),
          );
          return;
        }
        this.bindTextureSource(bmp.canvas, hash, bmp.width, bmp.height);
        resolve();
      };
      if (bitmap.isReady()) finish(bitmap);
      else bitmap.addLoadListener(finish);
      // isReady() is false while loading AND after an error; addLoadListener
      // only fires on success, so poll the error state alongside it.
      if (!bitmap.isReady()) watchForError(bitmap, finish);
    });
  }
}

/**
 * True when ImageManager can be trusted with this URL. In an encrypted
 * deployment MZ appends "_" to every image URL and expects the RPGMV encrypted
 * container — but the deployer only encrypts files under img/ (and audio/), so
 * a texture living anywhere else would 404. Those must bypass ImageManager and
 * be fetched raw.
 */
export function isDecryptable(url: string): boolean {
  return !hasEncryptedImages() || /(^|\/)img\//.test(url);
}

/**
 * Wait for a Bitmap that failed to load. MZ flips `_loadingState` to "error"
 * without notifying listeners, so poll it per frame until the load settles.
 */
function watchForError(bitmap: RMMZBitmap, onSettled: (bmp: RMMZBitmap) => void): void {
  const tick = () => {
    if (bitmap.isReady()) return; // the load listener above handles success
    if (bitmap.isError()) onSettled(bitmap);
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Split an SS texture URL into MZ's (folder, filename-without-extension) shape.
 * ImageManager.loadBitmap expects a folder ending in "/" and an un-extensioned,
 * URL-decoded filename (it re-encodes internally).
 */
export function splitBitmapUrl(url: string): { folder: string; filename: string } {
  const slash = url.lastIndexOf('/');
  const folder = slash >= 0 ? url.slice(0, slash + 1) : 'spritestudio/';
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
