import type { IResourceManager } from '@spritestudio/ssplayer-core';

// Retained creation info for a texture, kept so every texture can be rebuilt
// after a GL context loss (SPEC §8-9 / §9). We keep the *smallest recoverable*
// form: a URL (re-fetched), the encoded bytes (re-decoded — far smaller than the
// decoded RGBA), or a caller-owned TexImageSource (re-uploaded as-is; the caller
// must keep it alive if it wants restore to work for that entry).
type TexSource =
  | { kind: 'url'; url: string }
  | { kind: 'bytes'; bytes: Uint8Array }
  | { kind: 'source'; source: TexImageSource; width: number; height: number };

export class SSWebGLResourceManager implements IResourceManager {
  private textures = new Map<number, { tex: WebGLTexture; width: number; height: number }>();
  // Creation info per hash, used by restoreContext() to rebuild after a context loss.
  private sources = new Map<number, TexSource>();

  constructor(private gl: WebGLRenderingContext | WebGL2RenderingContext) {}

  public async loadTexture(url: string, hash: number): Promise<void> {
    if (this.textures.has(hash)) return;
    this.sources.set(hash, { kind: 'url', url });
    return this.uploadFromUrl(url, hash);
  }

  /**
   * Decode raw (encoded) image bytes — e.g. a PNG embedded in the SSAB via the
   * converter's `--embedded` mode — and upload them as a texture under `hash`.
   */
  public async loadTextureFromBytes(bytes: Uint8Array, hash: number): Promise<void> {
    if (this.textures.has(hash)) return;
    this.sources.set(hash, { kind: 'bytes', bytes });
    return this.uploadFromBytes(bytes, hash);
  }

  public bindTextureSource(source: TexImageSource, hash: number, width: number, height: number): void {
    this.sources.set(hash, { kind: 'source', source, width, height });
    this.createTextureFromSource(source, hash, width, height);
  }

  private uploadFromUrl(url: string, hash: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.createTextureFromSource(img, hash, img.width, img.height);
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  private async uploadFromBytes(bytes: Uint8Array, hash: number): Promise<void> {
    const blob = new Blob([bytes as BlobPart]);
    const bitmap = await createImageBitmap(blob);
    this.createTextureFromSource(bitmap, hash, bitmap.width, bitmap.height);
    bitmap.close?.();
  }

  private createTextureFromSource(source: TexImageSource, hash: number, width: number, height: number): void {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Failed to create WebGLTexture');

    gl.bindTexture(gl.TEXTURE_2D, tex);

    // Premultiplied alpha is essential for SS
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    // NPOT textures require CLAMP_TO_EDGE and no mipmap in WebGL1
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.textures.set(hash, { tex, width, height });
  }

  public getTexture(hash: number): { tex: WebGLTexture; width: number; height: number } | undefined {
    return this.textures.get(hash);
  }

  /**
   * Rebuild every texture after a GL context loss (SPEC §8-9 / §9). The old
   * WebGLTexture handles died with the context, so drop them and re-upload from
   * the retained creation info. URL / bytes sources re-decode asynchronously;
   * caller-owned TexImageSources re-upload synchronously (skipped if the caller
   * let the source go — e.g. a closed ImageBitmap — so one dead source can't
   * abort the whole restore).
   */
  public async restoreContext(): Promise<void> {
    this.textures.clear();
    const tasks: Promise<void>[] = [];
    for (const [hash, src] of this.sources) {
      if (src.kind === 'url') {
        tasks.push(this.uploadFromUrl(src.url, hash));
      } else if (src.kind === 'bytes') {
        tasks.push(this.uploadFromBytes(src.bytes, hash));
      } else {
        try {
          this.createTextureFromSource(src.source, hash, src.width, src.height);
        } catch (e) {
          console.warn(`[SSWebGLResourceManager] Could not restore texture ${hash} from its source; it may have been released.`, e);
        }
      }
    }
    await Promise.all(tasks);
  }

  public destroy(): void {
    const gl = this.gl;
    for (const { tex } of this.textures.values()) {
      gl.deleteTexture(tex);
    }
    this.textures.clear();
    this.sources.clear();
  }
}
