// SpriteStudio "integration shader" library for the WebGL renderer.
//
// SpriteStudio's shader feature is a per-part attribute (ssae tag `SHDR`), not a
// part type: a Normal part references one of the built-in `ss-*` shaders by id
// (hashed to `id_hash` via FNV-1a) plus param0..7. The runtime decodes it and
// exposes it on FrameData (`parts(i).shader()` → index, `shaders(idx)` →
// idHash/params); this file supplies the matching GPU fragment programs so the
// renderer can apply the effect.
//
// The 13 shader bodies are the GLSL ES 1.00 ports of the authoritative SS6-SDK
// GLSL already migrated for the sibling ssplayer-pixi renderer (its
// `SSShaderLib.ts`, GLSL ES 3.00 version — the source of truth). Each computes
// a `Pixel` (vec4) then reuses this
// renderer's PartColor tail (`ssFinish`, identical math to PartsColorProgram),
// because our per-vertex `aVarg` encodes the blend as `[rate, isMix, isMul,
// isAddSub]`. ss-blur is the lone exception: it skips the PartColor composite and
// just multiplies by the part colour (mirrors the SS6 reference).
//
// GLSL ES 3.00 → 1.00 conversion applied:
//   `in`/`out` varyings   → `varying` (shared vertex stage = PARTS_COLOR_VERT)
//   `out vec4 finalColor` → `gl_FragColor`
//   `texture(t,uv)`       → `texture2D(t,uv)` (only in ssTex)
//   fragment precision    → `precision mediump float;` (matches PartsColorProgram)
//   ss-move's dynamic loop → constant upper bound (128) + `break` (WebGL1 §8-1
//                            allows only constant loop bounds; iCount is already
//                            clamped to ≤128 so the visible result is unchanged).
//
// Limitations (v1, same as ssplayer-pixi): map0/map1 inputs are not bound (the
// bundled Shader.ssab uses none); shader × mask clipping is not combined (the
// renderer falls back to the plain masked path); only Normal parts dispatch here.

import { ssShaderIdHash } from '@spritestudio/ssplayer-core';
import { PARTS_COLOR_VERT, ATTR_LOC, createGLProgram } from './PartsColorProgram.js';

// ---------------------------------------------------------------------------
// Shared GLSL ES 1.00 preamble + helpers, prepended to every ss-* fragment.
// `uColor` mirrors ssplayer-pixi's world tint (there Pixi supplies Pixi's own
// `(tint.rgb * worldAlpha, worldAlpha)`); here the renderer feeds the per-player
// tint passed to `render()`, premultiplied as `(rgb * a, a)` and identity when
// the caller sets none — same value as the plain parts-color program uses.
// `uParams[2]` packs param0..7.
// ---------------------------------------------------------------------------
const GL_HEAD = `
precision mediump float;

varying vec2 vUV;
varying vec4 vColor;
varying vec4 vVarg;

uniform sampler2D uTexture;
uniform vec4 uColor;
uniform vec4 uParams[2];
uniform vec4 uCellRect;
uniform vec2 uPixelSize;

#define ss_param0 uParams[0].x
#define ss_param1 uParams[0].y
#define ss_param2 uParams[0].z
#define ss_param3 uParams[0].w
#define ss_param4 uParams[1].x
#define ss_param5 uParams[1].y
#define ss_param6 uParams[1].z
#define ss_param7 uParams[1].w
#define TEXTURE_PIXEL_SIZE uPixelSize
#define ss_cell_rect uCellRect

const float PI = 3.141592653589793;

// Sample + un-premultiply: the SS shader math expects straight-alpha colour, but
// our textures are premultiplied (UNPACK_PREMULTIPLY_ALPHA_WEBGL). Transparent
// texels (rgb already 0) stay 0 thanks to the max() guard.
vec4 ssTex(vec2 uv) {
  vec4 c = texture2D(uTexture, uv);
  return vec4(c.rgb / max(c.a, 0.0001), c.a);
}

// PartColor composite (straight-space) + output alpha + re-premultiply + world
// tint — the exact tail PartsColorProgram uses, with the sampled texel replaced
// by the shader-computed Pixel.
vec4 ssFinish(vec4 Pixel) {
  float rate = vVarg.x;
  float isMix = vVarg.y;
  float isMul = vVarg.z;
  float isAddSub = vVarg.w;
  vec3 p = Pixel.rgb;
  vec3 mixColor = mix(p, vColor.rgb, rate);
  vec3 mulColor = p * mix(vec3(1.0), vColor.rgb, rate);
  vec3 addSubColor = p + (vColor.rgb * rate * sign(isAddSub));
  vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);
  float outA = Pixel.a * vColor.a;
  return vec4(outRgb * outA, outA) * uColor;
}
`;

/** Assemble a full GLSL ES 1.00 fragment shader: head + optional helpers + main. */
function frag(body: string, helpers = ''): string {
  return `${GL_HEAD}${helpers}\nvoid main() {\n${body}\n}\n`;
}

// ===========================================================================
// Per-shader bodies. Each computes `Pixel` then `gl_FragColor = ssFinish(Pixel)`.
// ===========================================================================

// --- ss-sepia ---
const SEPIA = `
  float fPower = ss_param0;
  vec4 Pixel = ssTex(vUV);
  float gray = dot(Pixel.rgb, vec3(0.298912, 0.586611, 0.114478));
  vec3 GrayRgb = vec3(gray);
  vec3 SepiaRgb = GrayRgb * vec3(1.07, 0.74, 0.43);
  vec3 toned = mix(SepiaRgb, GrayRgb, step(fPower, 0.0));
  vec3 mixed_rgb = mix(Pixel.rgb, toned, abs(fPower));
  gl_FragColor = ssFinish(vec4(mixed_rgb, Pixel.a));
`;

// --- ss-hsb ---
const HSB_HELPERS = `
vec4 ss_rgb_to_hsb(vec4 color) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(color.bg, K.wz), vec4(color.gb, K.xy), step(color.b, color.g));
  vec4 q = mix(vec4(p.xyw, color.r), vec4(color.r, p.yzx), step(p.x, color.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec4(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x, color.a);
}
vec4 ss_hsb_to_rgb(vec4 hsb) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(hsb.xxx + K.xyz) * 6.0 - K.www);
  return vec4(hsb.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsb.y), hsb.w);
}
`;
const HSB = `
  float fHue = ss_param0;
  float fSaturation = ss_param1;
  float fBrightness = ss_param2;
  vec4 Pixel = ssTex(vUV);
  vec4 hsb = ss_rgb_to_hsb(Pixel);
  hsb.x += fHue;
  hsb.y = clamp(hsb.y + fSaturation, 0.0, 1.0);
  hsb.z = clamp(hsb.z + fBrightness, 0.0, 1.0);
  if (hsb.x < 0.0) hsb.x += 1.0;
  if (hsb.x > 1.0) hsb.x -= 1.0;
  vec4 shifted = ss_hsb_to_rgb(hsb);
  gl_FragColor = ssFinish(vec4(shifted.rgb, shifted.a));
`;

// --- ss-step ---
const STEP = `
  float fThreshold = ss_param0;
  float fStage = ss_param1;
  float fColor = ss_param2;
  vec4 Pixel = ssTex(vUV);
  float d = 1.0 + 255.0 * abs(fStage);
  float e = 1.0e-10;
  float t = abs(fThreshold);
  float b = abs(step(fThreshold, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
  float r = clamp(floor((b - t) / (t + e) * 256.0 / d) * d / 256.0, 0.0, 1.0);
  float c = step(t, b) * r;
  vec3 v = mix(vec3(c), Pixel.rgb * c, fColor);
  gl_FragColor = ssFinish(vec4(v, Pixel.a));
`;

// --- ss-pix ---
const PIX = `
  float fPower = ss_param0;
  vec2 px = TEXTURE_PIXEL_SIZE;
  float v = 1.0 + 96.0 * fPower;
  vec2 step_uv = vec2(v * px.x, v * px.y);
  vec2 Coord = floor(vUV / step_uv) * step_uv;
  vec4 Pixel = ssTex(Coord);
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-noise ---
const NOISE_HELPERS = `
float ss_noise_rand(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;
const NOISE = `
  float fPower = ss_param0;
  float fColor = ss_param1;
  float fPhase = ss_param2;
  vec2 Coord = vUV;
  vec2 px = TEXTURE_PIXEL_SIZE;
  vec2 u = floor(Coord / px) * px;
  vec4 Pixel = ssTex(Coord);
  vec2 t = u + vec2(fPhase);
  vec3 c;
  c.r = ss_noise_rand(t);
  c.g = mix(c.r, ss_noise_rand(t * c.r), fColor);
  c.b = mix(c.g, ss_noise_rand(t * c.g), fColor);
  Pixel.rgb = clamp(mix(Pixel.rgb, c.rgb, fPower), 0.0, 1.0);
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-bmask ---
const BMASK = `
  float fBrightness = ss_param0;
  vec4 Pixel = ssTex(vUV);
  float b = abs(step(fBrightness, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
  if (b <= abs(fBrightness)) discard;
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-outline ---
const OUTLINE = `
  float fThreshold = ss_param0;
  float fRatio = abs(fThreshold);
  float e = 1.0e-5;
  vec2 px = TEXTURE_PIXEL_SIZE;
  float lo = 0.0;
  lo += step(ssTex(vUV + vec2(-px.x, 0.0)).a, fRatio);
  lo += step(ssTex(vUV + vec2(px.x, 0.0)).a, fRatio);
  lo += step(ssTex(vUV + vec2(0.0, -px.y)).a, fRatio);
  lo += step(ssTex(vUV + vec2(0.0, px.y)).a, fRatio);
  vec4 center = ssTex(vUV);
  float hi = step(fRatio + e, center.a);
  float v = min(hi * lo, 1.0);
  if (v <= 0.0) discard;
  gl_FragColor = ssFinish(vec4(vec3(v), v));
`;

// --- ss-blur (does NOT use the PartColor composite; multiplies by part colour) ---
const BLUR = `
  float fFocus = ss_param0;
  vec2 px = TEXTURE_PIXEL_SIZE;
  vec2 d = vec2(fFocus * px.x * 16.0, fFocus * px.y * 16.0);
  vec2 tc = vUV;
  vec4 sum = ssTex(tc);
  sum += ssTex(vec2(tc.x + d.x, tc.y + d.y));
  sum += ssTex(vec2(tc.x + d.x, tc.y));
  sum += ssTex(vec2(tc.x, tc.y + d.y));
  sum += ssTex(vec2(tc.x - d.x, tc.y - d.y));
  sum += ssTex(vec2(tc.x + d.x, tc.y - d.y));
  sum += ssTex(vec2(tc.x - d.x, tc.y + d.y));
  sum += ssTex(vec2(tc.x - d.x, tc.y));
  sum += ssTex(vec2(tc.x, tc.y - d.y));
  vec4 Pixel = sum / 9.0;
  vec4 c = Pixel * vColor;
  gl_FragColor = vec4(c.rgb * c.a, c.a) * uColor;
`;

// --- ss-wave ---
const WAVE = `
  float fWidth = ss_param0;
  float fHeight = ss_param1;
  float fPhase = ss_param2;
  vec2 Coord = vUV;
  vec2 px = TEXTURE_PIXEL_SIZE;
  float l = 384.0 * fHeight * 0.5;
  float s = l * sin(Coord.y * 384.0 * fWidth * 0.5 + PI * 2.0 * fPhase) * px.x;
  vec4 Pixel = ssTex(vec2(Coord.x + s, Coord.y));
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-move (directional smear; WebGL1 needs a constant loop bound + break) ---
const MOVE = `
  float fDistance = ss_param0;
  float fDirection = ss_param1;
  float fPower = ss_param2;
  vec2 Coord = vUV;
  vec2 px = TEXTURE_PIXEL_SIZE;
  int iCount = int(floor(abs(fDistance) * 96.0));
  if (iCount > 128) iCount = 128;
  vec2 Vel = vec2(sin(fDirection * PI) * px.x, cos(fDirection * PI) * px.y) * sign(fDistance);
  Coord += Vel * float(iCount);
  Coord -= Vel;
  vec4 Pixel = ssTex(Coord);
  for (int i = 1; i < 128; i++) {
    if (i >= iCount) break;
    Coord -= Vel;
    Pixel = mix(ssTex(Coord), Pixel, 0.96 * abs(fPower));
  }
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-scatter ---
const SCATTER_HELPERS = `
float ss_scatter_rand(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;
const SCATTER = `
  float fPower = ss_param0;
  float fRatio = ss_param1;
  float fPhase = ss_param2;
  vec2 Coord = vUV;
  vec2 px = TEXTURE_PIXEL_SIZE;
  vec2 u = floor(Coord / px) * px;
  vec2 t = u + vec2(fPhase);
  float r = ss_scatter_rand(t) * PI * 2.0 - PI;
  float r2 = step(ss_scatter_rand(t * r), fRatio);
  vec2 v = vec2(sin(r), cos(r)) * px * 96.0 * fPower * r2;
  vec4 Pixel = ssTex(Coord + v);
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-circle (cell rect → polar unwrap; needs uCellRect) ---
const CIRCLE = `
  float fPhase = ss_param0;
  float fDirection = ss_param1;
  float e = 1.0e-10;
  vec2 px = TEXTURE_PIXEL_SIZE;
  vec2 uv1 = vec2(px.x + e, px.y + e);
  vec2 lt_uv = ss_cell_rect.xy;
  vec2 rb_uv = ss_cell_rect.zw;
  vec2 center_uv = (lt_uv + rb_uv) * 0.5;
  vec2 tx = vUV / uv1;
  vec2 c = center_uv / uv1;
  vec2 lt = lt_uv / uv1;
  vec2 rb = rb_uv / uv1;
  vec2 dd = rb - lt;
  vec2 v = tx - c;
  float r = min(abs(rb.x - c.x), abs(rb.y - c.y)) + e;
  float dis = length(v);
  if (dis > r) discard;
  vec2 nv = (dis > e) ? (v / dis) : vec2(1.0, 0.0);
  float uu = 1.0 - dis / r;
  float vv = (atan(nv.y, nv.x) / PI + 1.0) * 0.5 + fPhase;
  if (vv < 0.0) vv += 1.0;
  if (vv > 1.0) vv -= 1.0;
  if (fDirection <= 0.0) vv = 1.0 - vv;
  vec2 st = dd * vec2(uu, vv) * uv1;
  vec4 Pixel = ssTex(lt_uv + st);
  gl_FragColor = ssFinish(Pixel);
`;

// --- ss-spot (radial spotlight; needs uCellRect) ---
const SPOT = `
  float fPower = ss_param0;
  float fDecay = ss_param1;
  float fColor = ss_param2;
  float e = 1.0e-10;
  float p = abs(fPower);
  float d_abs = abs(fDecay);
  vec2 px = TEXTURE_PIXEL_SIZE;
  vec2 uv1 = vec2(px.x + e, px.y + e);
  vec2 lt_uv = ss_cell_rect.xy;
  vec2 rb_uv = ss_cell_rect.zw;
  vec2 center_uv = (lt_uv + rb_uv) * 0.5;
  vec2 c = center_uv / uv1;
  vec2 rb = rb_uv / uv1;
  float l = min(abs(rb.x - c.x), abs(rb.y - c.y)) + e;
  vec2 t = vUV / uv1;
  vec2 v = c - t;
  float fR = max(p / (length(v / l) + e) - p, 0.0);
  float fL = max(p - length(v / l), 0.0);
  fR = clamp(mix(fR, fL, d_abs), 0.0, 1.0);
  vec3 sampled = ssTex(vUV).rgb;
  vec4 Pixel = vec4(mix(vec3(1.0), sampled, fColor), fR);
  gl_FragColor = ssFinish(Pixel);
`;

// Built-in ss-* shaders, by the readable SpriteStudio shader id (the label). The
// id ↔ `idHash` pairing is core's (`ssShaderIdHash`), shared with ssplayer-pixi:
// what reaches a player on the `SHDR` attribute is the hash, and which program
// that names has nothing to do with how the program is written. The thirteen
// values it used to carry as literals are pinned by core's
// `ss_shader_id_hashes_are_stable`, so nothing is assumed here either.
const SS_SHADERS: { id: string; frag: string }[] = [
  { id: 'ss-sepia', frag: frag(SEPIA) },
  { id: 'ss-hsb', frag: frag(HSB, HSB_HELPERS) },
  { id: 'ss-step', frag: frag(STEP) },
  { id: 'ss-pix', frag: frag(PIX) },
  { id: 'ss-noise', frag: frag(NOISE, NOISE_HELPERS) },
  { id: 'ss-bmask', frag: frag(BMASK) },
  { id: 'ss-outline', frag: frag(OUTLINE) },
  { id: 'ss-blur', frag: frag(BLUR) },
  { id: 'ss-wave', frag: frag(WAVE) },
  { id: 'ss-move', frag: frag(MOVE) },
  { id: 'ss-scatter', frag: frag(SCATTER, SCATTER_HELPERS) },
  { id: 'ss-circle', frag: frag(CIRCLE) },
  { id: 'ss-spot', frag: frag(SPOT) },
];

/** id_hash (ssruntime `PartAttributeShader.idHash()`) → GLSL ES 1.00 fragment source. */
export const SS_SHADER_SOURCES: Map<number, string> = new Map(
  SS_SHADERS.map((s) => [ssShaderIdHash(s.id), s.frag] as const)
);

/**
 * A compiled `ss-*` integration-shader program. Shares the parts-color vertex
 * stage and the fixed ATTR_LOC attribute slots (so the renderer's single VAO /
 * attribute layout drives it unchanged), adding the per-part `ss` uniforms
 * (param0..7, cell rect, pixel size). One instance per id_hash, reused across all
 * parts/textures — the texture is bound to a unit and the uniforms are set
 * imperatively per draw, so no per-part/per-texture pooling is needed (unlike
 * ssplayer-pixi, whose Shader objects bake in their resources).
 */
export class SsShaderProgram {
  public program: WebGLProgram;

  public uProjection: WebGLUniformLocation | null;
  public uTransform: WebGLUniformLocation | null;
  public uTexture: WebGLUniformLocation | null;
  public uColor: WebGLUniformLocation | null;
  public uParams: WebGLUniformLocation | null;
  public uCellRect: WebGLUniformLocation | null;
  public uPixelSize: WebGLUniformLocation | null;

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext, fragSrc: string) {
    this.program = createGLProgram(gl, PARTS_COLOR_VERT, fragSrc, [
      { name: 'aPosition', loc: ATTR_LOC.position },
      { name: 'aUV', loc: ATTR_LOC.uv },
      { name: 'aColor', loc: ATTR_LOC.color },
      { name: 'aVarg', loc: ATTR_LOC.varg },
    ]);

    this.uProjection = gl.getUniformLocation(this.program, 'uProjection');
    this.uTransform = gl.getUniformLocation(this.program, 'uTransform');
    this.uTexture = gl.getUniformLocation(this.program, 'uTexture');
    this.uColor = gl.getUniformLocation(this.program, 'uColor');
    // Array uniform base: most drivers accept the bare name; fall back to `[0]`.
    this.uParams = gl.getUniformLocation(this.program, 'uParams') ?? gl.getUniformLocation(this.program, 'uParams[0]');
    this.uCellRect = gl.getUniformLocation(this.program, 'uCellRect');
    this.uPixelSize = gl.getUniformLocation(this.program, 'uPixelSize');
  }

  public destroy(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (this.program) gl.deleteProgram(this.program);
  }
}
