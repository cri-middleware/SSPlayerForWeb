export const PARTS_COLOR_VERT = `
attribute vec2 aPosition;
attribute vec2 aUV;
attribute vec4 aColor;
attribute vec4 aVarg;

uniform mat3 uProjection;
uniform mat3 uTransform;

varying vec2 vUV;
varying vec4 vColor;
varying vec4 vVarg;

void main() {
  vec3 p = uProjection * uTransform * vec3(aPosition, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  vUV = aUV;
  vColor = aColor;
  vVarg = aVarg;
}
`;

export const PARTS_COLOR_FRAG = `
precision mediump float;

varying vec2 vUV;
varying vec4 vColor;
varying vec4 vVarg;

uniform sampler2D uTexture;
uniform vec4 uColor;

void main() {
  vec4 texColor = texture2D(uTexture, vUV);
  if (texColor.a == 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  
  float rate = vVarg.x;
  float isMix = vVarg.y;
  float isMul = vVarg.z;
  float isAddSub = vVarg.w;
  
  vec3 straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);
  
  vec3 mixColor    = mix(straightTexRGB, vColor.rgb, rate);
  vec3 mulColor    = straightTexRGB * mix(vec3(1.0), vColor.rgb, rate);
  vec3 addSubColor = straightTexRGB + (vColor.rgb * rate * sign(isAddSub));
  
  vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);
  float outA = texColor.a * vColor.a;
  
  gl_FragColor = vec4(outRgb * outA, outA) * uColor;
}
`;

export class PartsColorProgram {
  public program: WebGLProgram;
  
  public aPosition: number;
  public aUV: number;
  public aColor: number;
  public aVarg: number;
  
  public uProjection: WebGLUniformLocation | null;
  public uTransform: WebGLUniformLocation | null;
  public uTexture: WebGLUniformLocation | null;
  public uColor: WebGLUniformLocation | null;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.program = this.createProgram(gl, PARTS_COLOR_VERT, PARTS_COLOR_FRAG);
    
    this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
    this.aUV = gl.getAttribLocation(this.program, 'aUV');
    this.aColor = gl.getAttribLocation(this.program, 'aColor');
    this.aVarg = gl.getAttribLocation(this.program, 'aVarg');
    
    this.uProjection = gl.getUniformLocation(this.program, 'uProjection');
    this.uTransform = gl.getUniformLocation(this.program, 'uTransform');
    this.uTexture = gl.getUniformLocation(this.program, 'uTexture');
    this.uColor = gl.getUniformLocation(this.program, 'uColor');
  }

  private createProgram(gl: WebGLRenderingContext | WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
    const vert = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vert, vertSrc);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compile error:', gl.getShaderInfoLog(vert));
    }

    const frag = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(frag, fragSrc);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compile error:', gl.getShaderInfoLog(frag));
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(prog));
    }
    
    // Shader cleanup
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    return prog;
  }

  public destroy(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.program) {
      gl.deleteProgram(this.program);
    }
  }
}
