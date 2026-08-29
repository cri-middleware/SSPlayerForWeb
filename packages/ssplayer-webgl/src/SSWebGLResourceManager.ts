import type { IResourceManager } from '@spritestudio/ssplayer-core';
import type { SSTextureEntry, SSWebGLTextureCache } from './SSWebGLTextureCache.js';

// Retained creation info for a texture, kept so every texture can be rebuilt
// after a GL context loss. We keep the *smallest recoverable*
// form: a URL (re-fetched), the encoded bytes (re-decoded — far smaller than the
// decoded RGBA), or a caller-owned TexImageSource (re-uploaded as-is; the caller
// must keep it alive if it wants restore to work for that entry).
type TexSource =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'source'; source: TexImageSource; width: number; height: number };

/**
 * One player's textures, keyed by the cell-map hash the core asks for.
 *
 * URL-loaded atlases are delegated to the surface's {@link SSWebGLTextureCache}
 * when there is one, so several players showing the same character upload it
 * once. This manager still keeps its own hash → texture mapping, because the
 * hash is only unique within one `.ssab` while the cache is shared across all of
 * them (see the note on keying there).
 *
 * Embedded (`--embedded`) and caller-supplied textures are never shared: they
 * came from *this* player's bytes, and two `.ssab` files can carry the same
 * cell-map name with completely different pixels.
 */
export class SSWebGLResourceManager implements IResourceManager {
  private textures = new Map<number, SSTextureEntry>();
  // Creation info per hash, used by restoreContext() to rebuild after a context loss.
  private sources = new Map<number, TexSource>();
  // Hashes whose texture this manager uploaded itself, and may therefore delete.
  // Anything else came from the shared cache and outlives this player.
  private owned = new Set<number>();

  constructor(
    private gl: WebGLRenderingContext | WebGL2RenderingContext,
    private shared?: SSWebGLTextureCache,
  ) {}

  public async loadTexture(url: string, hash: number): Promise<void> {
    if (this.textures.has(hash)) return;
    this.sources.set(hash, { kind: 'url', url });
    if (this.shared) {
      // Shared: one upload per URL across the whole surface. Not recorded in
      // `owned`, so destroying this player leaves it for its siblings.
      this.textures.set(hash, await this.shared.acquire(url, (u) => this.uploadFromUrl(u)));
      return;
    }
    this.textures.set(hash, await this.uploadFromUrl(url));
    this.owned.add(hash);
  }

  /**
   * Decode raw (encoded) image bytes — e.g. a PNG embedded in the SSAB via the
   * converter's `--embedded` mode — and upload them as a texture under `hash`.
   *
   * Never shared: these bytes belong to one `.ssab`, and a cell-map name is not
   * unique across files.
   */
  public async loadTextureFromBytes(bytes: Uint8Array, hash: number): Promise<void> {
    if (this.textures.has(hash)) return;
    this.sources.set(hash, { kind: 'bytes', bytes });
    this.textures.set(hash, await this.uploadFromBytes(bytes));
    this.owned.add(hash);
  }

  public bindTextureSource(source: TexImageSource, hash: number, width: number, height: number): void {
    this.sources.set(hash, { kind: 'source', source, width, height });
    this.textures.set(hash, this.createTextureFromSource(source, width, height));
    this.owned.add(hash);
  }

  private uploadFromUrl(url: string): Promise<SSTextureEntry> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(this.createTextureFromSource(img, img.width, img.height));
      // `img.onerror` is handed a bare DOM Event, which surfaces to the host as
      // an "Uncaught (in promise) Event" with no message and no indication of
      // which atlas failed — reject with a real Error naming the URL instead.
      img.onerror = () => reject(new Error(`[SSWebGLResourceManager] Failed to load texture: ${url}`));
      img.src = url;
    });
  }

  private async uploadFromBytes(bytes: Uint8Array): Promise<SSTextureEntry> {
    const blob = new Blob([bytes as BlobPart]);
    const bitmap = await createImageBitmap(blob);
    const entry = this.createTextureFromSource(bitmap, bitmap.width, bitmap.height);
    bitmap.close?.();
    return entry;
  }

  private createTextureFromSource(source: TexImageSource, width: number, height: number): SSTextureEntry {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create WebGLTexture');

    gl.bindTexture(gl.TEXTURE_2D, tex);

    // Premultiplied alpha is essential for SS. UNPACK_PREMULTIPLY_ALPHA_WEBGL is
    // CONTEXT state, not texture state, so restore whatever the host had: in a
    // shared context (RPG Maker MZ / PIXI) leaving it set makes the host's next
    // upload of an already-premultiplied atlas premultiply a second time, and its
    // sprites render darkened.
    const prevPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, prevPremultiply);

    // NPOT textures require CLAMP_TO_EDGE and no mipmap in WebGL1
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return { tex, width, height };
  }

  public getTexture(hash: number): SSTextureEntry | undefined {
    return this.textures.get(hash);
  }

  /**
   * Rebuild every texture after a GL context loss. The old WebGLTexture handles
   * died with the context, so drop them and re-create from the retained creation
   * info. URL / bytes sources re-decode asynchronously; caller-owned
   * TexImageSources re-upload synchronously (skipped if the caller let the source
   * go — e.g. a closed ImageBitmap — so one dead source can't abort the whole
   * restore).
   *
   * The surface invalidates the shared cache before calling this, so the first
   * player to ask for a URL re-uploads it and the rest reuse that.
   */
  public async restoreContext(): Promise<void> {
    this.textures.clear();
    this.owned.clear();
    const tasks: Promise<void>[] = [];
    for (const [hash, src] of this.sources) {
      if (src.kind === 'url') {
        tasks.push(this.loadTexture(src.url, hash));
      } else if (src.kind === 'bytes') {
        tasks.push(this.loadTextureFromBytes(src.bytes, hash));
      } else {
        try {
          this.bindTextureSource(src.source, hash, src.width, src.height);
        } catch (e) {
          console.warn(`[SSWebGLResourceManager] Could not restore texture ${hash} from its source; it may have been released.`, e);
        }
      }
    }
    await Promise.all(tasks);
  }

  public reset(): void {
    this.deleteOwned();
    this.textures.clear();
    this.sources.clear();
  }

  /**
   * Delete the textures this player uploaded itself. Shared ones are left alone —
   * a sibling player is probably still drawing with them, and the surface deletes
   * the cache when it goes.
   */
  public destroy(): void {
    this.deleteOwned();
    this.textures.clear();
    this.sources.clear();
  }

  private deleteOwned(): void {
    for (const hash of this.owned) {
      const entry = this.textures.get(hash);
      if (entry) this.gl.deleteTexture(entry.tex);
    }
    this.owned.clear();
  }
}
