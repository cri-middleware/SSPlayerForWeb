import type { IResourceManager } from '@spritestudio/ssplayer-core';

export class SSWebGLResourceManager implements IResourceManager {
  private textures = new Map<number, { tex: WebGLTexture; width: number; height: number }>();

  constructor(private gl: WebGLRenderingContext | WebGL2RenderingContext) {}

  public async loadTexture(url: string, hash: number): Promise<void> {
    if (this.textures.has(hash)) return;

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

  public bindTextureSource(source: TexImageSource, hash: number, width: number, height: number): void {
    this.createTextureFromSource(source, hash, width, height);
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

  public destroy(): void {
    const gl = this.gl;
    for (const { tex } of this.textures.values()) {
      gl.deleteTexture(tex);
    }
    this.textures.clear();
  }
}
