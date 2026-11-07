import { createGLProgram } from './programs/PartsColorProgram.js';

type GL = WebGLRenderingContext | WebGL2RenderingContext;

const VERT = `
attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAG = `
precision mediump float;
uniform sampler2D uTexture;
uniform float uAlpha;
varying vec2 vUV;
void main() {
  // The offscreen pass writes premultiplied colour, so scaling all four channels
  // keeps it premultiplied and the result composites with ONE / 1-SRC_ALPHA.
  gl_FragColor = texture2D(uTexture, vUV) * uAlpha;
}
`;

/**
 * Group opacity for a whole player.
 *
 * Fading a player by multiplying its world tint is per-*part*: each part is
 * composited at that alpha in turn, so wherever two parts overlap the coverage
 * accumulates — two halves of a character at 0.5 leave the overlap at 0.75, and
 * a fading character visibly darkens along every seam. That is inherent to
 * per-fragment alpha and no shader can undo it, because the compositing is
 * order-dependent.
 *
 * What an author means by "fade this character" is: draw it whole, then make the
 * result transparent. So that is what this does — render the player opaque into
 * an offscreen texture, then composite that texture once at the player's alpha.
 * Overlaps inside the character are resolved at full opacity first, exactly as
 * CSS opacity on a canvas does.
 *
 * Only players with `alpha < 1` take this path; anything fully opaque draws
 * straight to the target and pays nothing.
 */
export class SSGroupAlpha {
  private framebuffer: WebGLFramebuffer | null = null;
  private texture: WebGLTexture | null = null;
  private scissored = false;
  private width = 0;
  private height = 0;

  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private uTexture: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  // [x, y, u, v] × 4, rewritten per composite because the quad tracks the box.
  private readonly verts = new Float32Array(16);

  constructor(private gl: GL) {}

  /**
   * Point rendering at the offscreen texture, sized to `width × height` (the
   * drawing buffer), and clear it.
   *
   * The whole target is cleared, not just the player's box. A box positions a
   * player; it does not bound what the player draws — SS content routinely
   * extends past it, and only an explicit `clip` limits that. Clearing (and
   * later compositing) box-sized would slice the character along the box edge
   * and leave whatever the previous fading player wrote outside it.
   */
  public begin(width: number, height: number): void {
    const gl = this.gl;
    this.ensureTarget(width, height);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    // Scissor may still be on from a clipped player; a partial clear here is
    // exactly the bug described above. It comes back on for the composite.
    this.scissored = gl.isEnabled(gl.SCISSOR_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  /**
   * Return to the default framebuffer and composite what was drawn, at `alpha`.
   *
   * Covers the whole target for the same reason {@link begin} clears all of it:
   * the player's box says where it sits, not how far it reaches. Anything the
   * player did not touch is transparent in the texture and composites to nothing,
   * so a full-surface quad costs fill rate but never clips the character.
   */
  public end(alpha: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (this.scissored) gl.enable(gl.SCISSOR_TEST);
    this.ensureProgram();

    // Full target, in clip space, sampling the texture 1:1.
    const v = this.verts;
    v[0] = -1; v[1] = 1; v[2] = 0; v[3] = 1;
    v[4] = 1; v[5] = 1; v[6] = 1; v[7] = 1;
    v[8] = -1; v[9] = -1; v[10] = 0; v[11] = 0;
    v[12] = 1; v[13] = -1; v[14] = 1; v[15] = 0;

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.uTexture) gl.uniform1i(this.uTexture, 0);
    if (this.uAlpha) gl.uniform1f(this.uAlpha, alpha);

    // Premultiplied source over whatever the surface already holds.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // The player's last batch may have left a subtract in place.
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
  }

  private ensureProgram(): void {
    const gl = this.gl;
    if (this.program) return;
    this.program = createGLProgram(gl, VERT, FRAG, [
      { name: 'aPosition', loc: 0 },
      { name: 'aUV', loc: 1 },
    ]);
    this.uTexture = gl.getUniformLocation(this.program, 'uTexture');
    this.uAlpha = gl.getUniformLocation(this.program, 'uAlpha');
    this.buffer = gl.createBuffer();
  }

  private ensureTarget(width: number, height: number): void {
    const gl = this.gl;
    if (this.framebuffer && this.width === width && this.height === height) return;
    this.releaseTarget();

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);

    // Masks write to the stencil buffer, so the offscreen target needs one too or
    // a masked part would render unmasked only while its player is fading.
    const stencil = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, stencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.STENCIL_INDEX8, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.STENCIL_ATTACHMENT, gl.RENDERBUFFER, stencil);
    this.stencil = stencil;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.width = width;
    this.height = height;
  }

  private stencil: WebGLRenderbuffer | null = null;

  private releaseTarget(): void {
    const gl = this.gl;
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.stencil) gl.deleteRenderbuffer(this.stencil);
    this.framebuffer = null;
    this.texture = null;
    this.stencil = null;
    this.width = 0;
    this.height = 0;
  }

  /** Drop every GL object. Also the recovery path after a context loss. */
  public destroy(): void {
    const gl = this.gl;
    this.releaseTarget();
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    this.program = null;
    this.buffer = null;
    this.uTexture = null;
    this.uAlpha = null;
  }
}
