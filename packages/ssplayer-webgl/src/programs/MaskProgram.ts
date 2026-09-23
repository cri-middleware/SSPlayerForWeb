import { ATTR_LOC, createGLProgram } from './PartsColorProgram.js';

// Mask *coverage write* program.
// Rasterises a mask writer's geometry into the hardware stencil buffer. Colour
// output is irrelevant — the renderer disables colour writes and only the
// stencil op (increment / invert) takes effect — so the fragment just performs
// the cutout: discard where the writer's texture alpha is at or below the
// threshold, leaving the covered texels to update the stencil.
//
// Shares aPosition/aUV with PartsColorProgram at the same ATTR_LOC slots so the
// renderer's single VAO / attribute layout drives it unchanged; aColor/aVarg
// stay enabled but unused here.
export const MASK_VERT = `
attribute vec2 aPosition;
attribute vec2 aUV;

uniform mat3 uProjection;
uniform mat3 uTransform;

varying vec2 vUV;

void main() {
  vec3 p = uProjection * uTransform * vec3(aPosition, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = aUV;
}
`;

export const MASK_FRAG = `
precision mediump float;

varying vec2 vUV;

uniform sampler2D uTexture;
uniform float uThreshold;   // (255 - mask) / 255; < 0 => no cutout (whole geometry writes)

void main() {
  // uThreshold < 0 marks a textureless / pure-shape writer: its whole geometry
  // is the mask, so never discard. Otherwise cut out texels whose alpha
  // fails the threshold before they reach the stencil.
  if (uThreshold >= 0.0 && texture2D(uTexture, vUV).a <= uThreshold) discard;
  gl_FragColor = vec4(1.0);   // colour masked off; value irrelevant
}
`;

export class MaskProgram {
  public program: WebGLProgram;

  public aPosition: number;
  public aUV: number;

  public uProjection: WebGLUniformLocation | null;
  public uTransform: WebGLUniformLocation | null;
  public uTexture: WebGLUniformLocation | null;
  public uThreshold: WebGLUniformLocation | null;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.program = createGLProgram(gl, MASK_VERT, MASK_FRAG, [
      { name: 'aPosition', loc: ATTR_LOC.position },
      { name: 'aUV', loc: ATTR_LOC.uv },
    ]);

    this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
    this.aUV = gl.getAttribLocation(this.program, 'aUV');

    this.uProjection = gl.getUniformLocation(this.program, 'uProjection');
    this.uTransform = gl.getUniformLocation(this.program, 'uTransform');
    this.uTexture = gl.getUniformLocation(this.program, 'uTexture');
    this.uThreshold = gl.getUniformLocation(this.program, 'uThreshold');
  }

  public destroy(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.program) {
      gl.deleteProgram(this.program);
    }
  }
}
