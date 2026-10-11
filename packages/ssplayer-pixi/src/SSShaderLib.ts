// SpriteStudio "integration shader" library for the Pixi renderer.
//
// SpriteStudio's shader feature is a per-part attribute (ssae tag `SHDR`), not a
// part type: a Normal part references one of the built-in `ss-*` shaders by id
// (hashed to `id_hash` via FNV-1a) plus param0..7 and up to two extra maps. The
// runtime decodes it and exposes it on FrameData (`parts(i).shader()` → index,
// `shaders(idx)` → idHash/params/maps); this file supplies the matching GPU
// fragment programs so the renderer can actually apply the effect.
//
// The 13 shader bodies are ports of the authoritative SS6-SDK GLSL as already
// migrated by the sibling SSPlayerForGodot project
// (ss_player/shaders/ss_<name>.fs). Each Godot `.fs` computes a `Pixel` (vec4)
// then runs the PartColor composite + output. Here we keep ONLY the `Pixel`
// computation per shader and reuse this renderer's existing PartColor tail
// (the same math as PartsColorShader), because Pixi's per-vertex `aVarg`
// encodes the blend as `[rate, isMix, isMul, isAddSub]` whereas Godot's
// `CUSTOM0` packs `[rate, blendIdx, pma]` — the tails are not interchangeable.
//
// Godot built-in → Pixi mapping used by the ported bodies:
//   TEXTURE/UV/COLOR        → uTexture / vUV / vColor (shared vertex stage)
//   TEXTURE_PIXEL_SIZE      → uPixelSize uniform (1/texW, 1/texH)
//   ss_cell_rect            → uCellRect uniform (cell UV bounds; circle/spot)
//   ss_param0..7            → uParams[0..1] (packed 2×vec4)
//   PI                      → const
//   ss_input_texture()      → ssTex(): samples then un-premultiplies, since
//                             Pixi textures are premultiplied but the SS math
//                             operates on straight-alpha colour.
//   ss_partcolor_blend()+ss_output_color() → ssFinish(): Pixi's PartColor
//                             composite + premultiply + world-tint (uColor).
//
// Limitations (v1): map0/map1 inputs are not bound (the bundled Shader.ssab
// uses none); shader × mask clipping is not combined (the renderer falls back
// to the plain masked path); only Normal parts dispatch through here.

import { ssShaderIdHash } from '@spritestudio/ssplayer-core';
import { PartsColorShader, PartsColorShaderWGSL } from './PartsColorShader.js';



// ---------------------------------------------------------------------------
// GLSL — shared preamble + helpers.
// With no `#version 300 es`, PixiJS compiles these as GLSL ES 1.00 on WebGL2 as
// well, defining `in`, `finalColor` and `texture` onto their ES 1.00 forms; ES
// 3.00-only code fails to link and the part draws nothing. `finalColor` is the
// fragment output (see PartsColorShader); `uColor` is Pixi's
// (tint.rgb * worldAlpha, worldAlpha).
// ---------------------------------------------------------------------------
const GL_HEAD = `
in vec2 vUV;
in vec4 vColor;
in vec4 vVarg;

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

// Sample + un-premultiply: the SS shader math expects straight-alpha colour,
// but Pixi textures are premultiplied. Transparent texels (rgb already 0)
// stay 0 thanks to the max() guard, matching the SS6/Godot reference.
vec4 ssTex(vec2 uv) {
    vec4 c = texture(uTexture, uv);
    return vec4(c.rgb / max(c.a, 0.0001), c.a);
}

// PartColor composite (straight-space) + output alpha + re-premultiply + world
// tint — the exact tail PartsColorShader uses, with the sampled texel replaced
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

// ---------------------------------------------------------------------------
// WGSL — shared preamble + helpers. Mirrors PartsColorShaderWGSL's bind groups
// (globals @group(0), localUniforms @group(1), texture @group(2)); the SS
// params live in a dedicated UniformGroup at @group(3).
// `textureSampleLevel` (not `textureSample`) is used so sampling is legal in
// the non-uniform control flow of the looping / discarding shaders.
// ---------------------------------------------------------------------------
const WGSL_HEAD = `
struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uTextureSampler: sampler;

struct SsUniforms {
  uParams: array<vec4<f32>, 2>,
  uCellRect: vec4<f32>,
  uPixelSize: vec2<f32>,
}
@group(3) @binding(0) var<uniform> ssUniforms : SsUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vVarg: vec4<f32>,
}

const PI: f32 = 3.141592653589793;

fn ssTex(uv: vec2<f32>) -> vec4<f32> {
  let c = textureSampleLevel(uTexture, uTextureSampler, uv, 0.0);
  return vec4<f32>(c.rgb / max(c.a, 0.0001), c.a);
}

fn ssFinish(Pixel: vec4<f32>, vColor: vec4<f32>, vVarg: vec4<f32>) -> vec4<f32> {
  let rate = vVarg.x;
  let isMix = vVarg.y;
  let isMul = vVarg.z;
  let isAddSub = vVarg.w;
  let p = Pixel.rgb;
  let mixColor = mix(p, vColor.rgb, rate);
  let mulColor = p * mix(vec3<f32>(1.0), vColor.rgb, rate);
  let addSubColor = p + (vColor.rgb * rate * sign(isAddSub));
  let outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);
  let outA = Pixel.a * vColor.a;
  return vec4<f32>(outRgb * outA, outA) * localUniforms.uColor;
}
`;

// Aliases injected at the top of every WGSL mainFrag so the ported bodies can
// read `ss_param0` / `TEXTURE_PIXEL_SIZE` / `vUV` etc. like the GLSL bodies.
const WGSL_PARAM_DECL = `
  let ss_param0 = ssUniforms.uParams[0].x;
  let ss_param1 = ssUniforms.uParams[0].y;
  let ss_param2 = ssUniforms.uParams[0].z;
  let ss_param3 = ssUniforms.uParams[0].w;
  let ss_param4 = ssUniforms.uParams[1].x;
  let ss_param5 = ssUniforms.uParams[1].y;
  let ss_param6 = ssUniforms.uParams[1].z;
  let ss_param7 = ssUniforms.uParams[1].w;
  let TEXTURE_PIXEL_SIZE = ssUniforms.uPixelSize;
  let ss_cell_rect = ssUniforms.uCellRect;
  let vUV = in.vUV;
  let vColor = in.vColor;
  let vVarg = in.vVarg;
`;

type GLProgram = { vertex: string; fragment: string };
type GPUProgram = { vertex: { source: string; entryPoint: string }; fragment: { source: string; entryPoint: string } };

function gl(body: string, helpers = ''): GLProgram {
    return {
        vertex: PartsColorShader.vertex,
        fragment: `${GL_HEAD}${helpers}\nvoid main() {\n${body}\n}\n`,
    };
}

function gpu(body: string, helpers = ''): GPUProgram {
    return {
        vertex: PartsColorShaderWGSL.vertex,
        fragment: {
            source: `${WGSL_HEAD}${helpers}\n@fragment\nfn mainFrag(in: VertexOutput) -> @location(0) vec4<f32> {\n${WGSL_PARAM_DECL}\n${body}\n}\n`,
            entryPoint: 'mainFrag',
        },
    };
}

// ===========================================================================
// Per-shader bodies. Each computes `Pixel` then `finalColor = ssFinish(Pixel)`
// (GLSL) / `return ssFinish(...)` (WGSL). ss-blur is the lone exception: it
// skips the PartColor composite and just multiplies by the part colour (mirrors
// the SS6 reference). Comments on param semantics live in the catalog below.
// ===========================================================================

// --- ss-sepia ---
const SEPIA_GL = `
    float fPower = ss_param0;
    vec4 Pixel = ssTex(vUV);
    float gray = dot(Pixel.rgb, vec3(0.298912, 0.586611, 0.114478));
    vec3 GrayRgb = vec3(gray);
    vec3 SepiaRgb = GrayRgb * vec3(1.07, 0.74, 0.43);
    vec3 toned = mix(SepiaRgb, GrayRgb, step(fPower, 0.0));
    vec3 mixed_rgb = mix(Pixel.rgb, toned, abs(fPower));
    finalColor = ssFinish(vec4(mixed_rgb, Pixel.a));
`;
const SEPIA_WGSL = `
  let fPower = ss_param0;
  let Pixel = ssTex(vUV);
  let gray = dot(Pixel.rgb, vec3<f32>(0.298912, 0.586611, 0.114478));
  let GrayRgb = vec3<f32>(gray);
  let SepiaRgb = GrayRgb * vec3<f32>(1.07, 0.74, 0.43);
  let toned = mix(SepiaRgb, GrayRgb, step(fPower, 0.0));
  let mixed_rgb = mix(Pixel.rgb, toned, abs(fPower));
  return ssFinish(vec4<f32>(mixed_rgb, Pixel.a), vColor, vVarg);
`;

// --- ss-hsb ---
const HSB_GL_HELPERS = `
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
const HSB_GL = `
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
    finalColor = ssFinish(vec4(shifted.rgb, shifted.a));
`;
const HSB_WGSL_HELPERS = `
fn ss_rgb_to_hsb(color: vec4<f32>) -> vec4<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(color.bg, K.wz), vec4<f32>(color.gb, K.xy), step(color.b, color.g));
  let q = mix(vec4<f32>(p.xyw, color.r), vec4<f32>(color.r, p.yzx), step(p.x, color.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec4<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x, color.a);
}
fn ss_hsb_to_rgb(hsb: vec4<f32>) -> vec4<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(hsb.xxx + K.xyz) * 6.0 - K.www);
  return vec4<f32>(hsb.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), hsb.y), hsb.w);
}
`;
const HSB_WGSL = `
  let fHue = ss_param0;
  let fSaturation = ss_param1;
  let fBrightness = ss_param2;
  let Pixel = ssTex(vUV);
  var hsb = ss_rgb_to_hsb(Pixel);
  hsb.x = hsb.x + fHue;
  hsb.y = clamp(hsb.y + fSaturation, 0.0, 1.0);
  hsb.z = clamp(hsb.z + fBrightness, 0.0, 1.0);
  if (hsb.x < 0.0) { hsb.x = hsb.x + 1.0; }
  if (hsb.x > 1.0) { hsb.x = hsb.x - 1.0; }
  let shifted = ss_hsb_to_rgb(hsb);
  return ssFinish(vec4<f32>(shifted.rgb, shifted.a), vColor, vVarg);
`;

// --- ss-step ---
const STEP_GL = `
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
    finalColor = ssFinish(vec4(v, Pixel.a));
`;
const STEP_WGSL = `
  let fThreshold = ss_param0;
  let fStage = ss_param1;
  let fColor = ss_param2;
  let Pixel = ssTex(vUV);
  let d = 1.0 + 255.0 * abs(fStage);
  let e = 1.0e-10;
  let t = abs(fThreshold);
  let b = abs(step(fThreshold, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
  let r = clamp(floor((b - t) / (t + e) * 256.0 / d) * d / 256.0, 0.0, 1.0);
  let c = step(t, b) * r;
  let v = mix(vec3<f32>(c), Pixel.rgb * c, fColor);
  return ssFinish(vec4<f32>(v, Pixel.a), vColor, vVarg);
`;

// --- ss-pix ---
const PIX_GL = `
    float fPower = ss_param0;
    vec2 px = TEXTURE_PIXEL_SIZE;
    float v = 1.0 + 96.0 * fPower;
    vec2 step_uv = vec2(v * px.x, v * px.y);
    vec2 Coord = floor(vUV / step_uv) * step_uv;
    vec4 Pixel = ssTex(Coord);
    finalColor = ssFinish(Pixel);
`;
const PIX_WGSL = `
  let fPower = ss_param0;
  let px = TEXTURE_PIXEL_SIZE;
  let v = 1.0 + 96.0 * fPower;
  let step_uv = vec2<f32>(v * px.x, v * px.y);
  let Coord = floor(vUV / step_uv) * step_uv;
  let Pixel = ssTex(Coord);
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-noise ---
const NOISE_GL_HELPERS = `
float ss_noise_rand(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;
const NOISE_GL = `
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
    finalColor = ssFinish(Pixel);
`;
const NOISE_WGSL_HELPERS = `
fn ss_noise_rand(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
`;
const NOISE_WGSL = `
  let fPower = ss_param0;
  let fColor = ss_param1;
  let fPhase = ss_param2;
  let Coord = vUV;
  let px = TEXTURE_PIXEL_SIZE;
  let u = floor(Coord / px) * px;
  var Pixel = ssTex(Coord);
  let t = u + vec2<f32>(fPhase);
  var c = vec3<f32>(0.0);
  c.r = ss_noise_rand(t);
  c.g = mix(c.r, ss_noise_rand(t * c.r), fColor);
  c.b = mix(c.g, ss_noise_rand(t * c.g), fColor);
  Pixel = vec4<f32>(clamp(mix(Pixel.rgb, c, fPower), vec3<f32>(0.0), vec3<f32>(1.0)), Pixel.a);
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-bmask ---
const BMASK_GL = `
    float fBrightness = ss_param0;
    vec4 Pixel = ssTex(vUV);
    float b = abs(step(fBrightness, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
    if (b <= abs(fBrightness)) discard;
    finalColor = ssFinish(Pixel);
`;
const BMASK_WGSL = `
  let fBrightness = ss_param0;
  let Pixel = ssTex(vUV);
  let b = abs(step(fBrightness, 0.0) - max(Pixel.r, max(Pixel.g, Pixel.b)));
  if (b <= abs(fBrightness)) { discard; }
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-outline ---
const OUTLINE_GL = `
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
    finalColor = ssFinish(vec4(vec3(v), v));
`;
const OUTLINE_WGSL = `
  let fThreshold = ss_param0;
  let fRatio = abs(fThreshold);
  let e = 1.0e-5;
  let px = TEXTURE_PIXEL_SIZE;
  var lo = 0.0;
  lo = lo + step(ssTex(vUV + vec2<f32>(-px.x, 0.0)).a, fRatio);
  lo = lo + step(ssTex(vUV + vec2<f32>(px.x, 0.0)).a, fRatio);
  lo = lo + step(ssTex(vUV + vec2<f32>(0.0, -px.y)).a, fRatio);
  lo = lo + step(ssTex(vUV + vec2<f32>(0.0, px.y)).a, fRatio);
  let center = ssTex(vUV);
  let hi = step(fRatio + e, center.a);
  let v = min(hi * lo, 1.0);
  if (v <= 0.0) { discard; }
  return ssFinish(vec4<f32>(vec3<f32>(v), v), vColor, vVarg);
`;

// --- ss-blur (does NOT use the PartColor composite; multiplies by part colour) ---
const BLUR_GL = `
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
    finalColor = vec4(c.rgb * c.a, c.a) * uColor;
`;
const BLUR_WGSL = `
  let fFocus = ss_param0;
  let px = TEXTURE_PIXEL_SIZE;
  let d = vec2<f32>(fFocus * px.x * 16.0, fFocus * px.y * 16.0);
  let tc = vUV;
  var sum = ssTex(tc);
  sum = sum + ssTex(vec2<f32>(tc.x + d.x, tc.y + d.y));
  sum = sum + ssTex(vec2<f32>(tc.x + d.x, tc.y));
  sum = sum + ssTex(vec2<f32>(tc.x, tc.y + d.y));
  sum = sum + ssTex(vec2<f32>(tc.x - d.x, tc.y - d.y));
  sum = sum + ssTex(vec2<f32>(tc.x + d.x, tc.y - d.y));
  sum = sum + ssTex(vec2<f32>(tc.x - d.x, tc.y + d.y));
  sum = sum + ssTex(vec2<f32>(tc.x - d.x, tc.y));
  sum = sum + ssTex(vec2<f32>(tc.x, tc.y - d.y));
  let Pixel = sum / 9.0;
  let c = Pixel * vColor;
  return vec4<f32>(c.rgb * c.a, c.a) * localUniforms.uColor;
`;

// --- ss-wave ---
const WAVE_GL = `
    float fWidth = ss_param0;
    float fHeight = ss_param1;
    float fPhase = ss_param2;
    vec2 Coord = vUV;
    vec2 px = TEXTURE_PIXEL_SIZE;
    float l = 384.0 * fHeight * 0.5;
    float s = l * sin(Coord.y * 384.0 * fWidth * 0.5 + PI * 2.0 * fPhase) * px.x;
    vec4 Pixel = ssTex(vec2(Coord.x + s, Coord.y));
    finalColor = ssFinish(Pixel);
`;
const WAVE_WGSL = `
  let fWidth = ss_param0;
  let fHeight = ss_param1;
  let fPhase = ss_param2;
  let Coord = vUV;
  let px = TEXTURE_PIXEL_SIZE;
  let l = 384.0 * fHeight * 0.5;
  let s = l * sin(Coord.y * 384.0 * fWidth * 0.5 + PI * 2.0 * fPhase) * px.x;
  let Pixel = ssTex(vec2<f32>(Coord.x + s, Coord.y));
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-move (directional smear; bounded sample loop) ---
// ES 1.00 refuses a loop bound that is not a constant, so the loop runs to the
// cap and breaks at the count.
const MOVE_GL = `
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
    finalColor = ssFinish(Pixel);
`;
const MOVE_WGSL = `
  let fDistance = ss_param0;
  let fDirection = ss_param1;
  let fPower = ss_param2;
  var Coord = vUV;
  let px = TEXTURE_PIXEL_SIZE;
  var iCount = i32(floor(abs(fDistance) * 96.0));
  if (iCount > 128) { iCount = 128; }
  let Vel = vec2<f32>(sin(fDirection * PI) * px.x, cos(fDirection * PI) * px.y) * sign(fDistance);
  Coord = Coord + Vel * f32(iCount);
  Coord = Coord - Vel;
  var Pixel = ssTex(Coord);
  for (var i: i32 = 1; i < iCount; i = i + 1) {
    Coord = Coord - Vel;
    Pixel = mix(ssTex(Coord), Pixel, 0.96 * abs(fPower));
  }
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-scatter ---
const SCATTER_GL_HELPERS = `
float ss_scatter_rand(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;
const SCATTER_GL = `
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
    finalColor = ssFinish(Pixel);
`;
const SCATTER_WGSL_HELPERS = `
fn ss_scatter_rand(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}
`;
const SCATTER_WGSL = `
  let fPower = ss_param0;
  let fRatio = ss_param1;
  let fPhase = ss_param2;
  let Coord = vUV;
  let px = TEXTURE_PIXEL_SIZE;
  let u = floor(Coord / px) * px;
  let t = u + vec2<f32>(fPhase);
  let r = ss_scatter_rand(t) * PI * 2.0 - PI;
  let r2 = step(ss_scatter_rand(t * r), fRatio);
  let v = vec2<f32>(sin(r), cos(r)) * px * 96.0 * fPower * r2;
  let Pixel = ssTex(Coord + v);
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-circle (cell rect → polar unwrap; needs uCellRect) ---
const CIRCLE_GL = `
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
    finalColor = ssFinish(Pixel);
`;
const CIRCLE_WGSL = `
  let fPhase = ss_param0;
  let fDirection = ss_param1;
  let e = 1.0e-10;
  let px = TEXTURE_PIXEL_SIZE;
  let uv1 = vec2<f32>(px.x + e, px.y + e);
  let lt_uv = ss_cell_rect.xy;
  let rb_uv = ss_cell_rect.zw;
  let center_uv = (lt_uv + rb_uv) * 0.5;
  let tx = vUV / uv1;
  let c = center_uv / uv1;
  let lt = lt_uv / uv1;
  let rb = rb_uv / uv1;
  let dd = rb - lt;
  let v = tx - c;
  let r = min(abs(rb.x - c.x), abs(rb.y - c.y)) + e;
  let dis = length(v);
  if (dis > r) { discard; }
  let nv = select(vec2<f32>(1.0, 0.0), v / dis, dis > e);
  let uu = 1.0 - dis / r;
  var vv = (atan2(nv.y, nv.x) / PI + 1.0) * 0.5 + fPhase;
  if (vv < 0.0) { vv = vv + 1.0; }
  if (vv > 1.0) { vv = vv - 1.0; }
  if (fDirection <= 0.0) { vv = 1.0 - vv; }
  let st = dd * vec2<f32>(uu, vv) * uv1;
  let Pixel = ssTex(lt_uv + st);
  return ssFinish(Pixel, vColor, vVarg);
`;

// --- ss-spot (radial spotlight; needs uCellRect) ---
const SPOT_GL = `
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
    finalColor = ssFinish(Pixel);
`;
const SPOT_WGSL = `
  let fPower = ss_param0;
  let fDecay = ss_param1;
  let fColor = ss_param2;
  let e = 1.0e-10;
  let p = abs(fPower);
  let d_abs = abs(fDecay);
  let px = TEXTURE_PIXEL_SIZE;
  let uv1 = vec2<f32>(px.x + e, px.y + e);
  let lt_uv = ss_cell_rect.xy;
  let rb_uv = ss_cell_rect.zw;
  let center_uv = (lt_uv + rb_uv) * 0.5;
  let c = center_uv / uv1;
  let rb = rb_uv / uv1;
  let l = min(abs(rb.x - c.x), abs(rb.y - c.y)) + e;
  let t = vUV / uv1;
  let v = c - t;
  var fR = max(p / (length(v / l) + e) - p, 0.0);
  let fL = max(p - length(v / l), 0.0);
  fR = clamp(mix(fR, fL, d_abs), 0.0, 1.0);
  let sampled = ssTex(vUV).rgb;
  let Pixel = vec4<f32>(mix(vec3<f32>(1.0), sampled, fColor), fR);
  return ssFinish(Pixel, vColor, vVarg);
`;

export interface SsShaderProgram {
    gl: GLProgram;
    gpu: GPUProgram;
}

// id string → program. The renderer keys by id_hash; see SS_SHADER_SOURCES.
const DEFS: { id: string; gl: GLProgram; gpu: GPUProgram }[] = [
    { id: 'ss-sepia', gl: gl(SEPIA_GL), gpu: gpu(SEPIA_WGSL) },
    { id: 'ss-hsb', gl: gl(HSB_GL, HSB_GL_HELPERS), gpu: gpu(HSB_WGSL, HSB_WGSL_HELPERS) },
    { id: 'ss-step', gl: gl(STEP_GL), gpu: gpu(STEP_WGSL) },
    { id: 'ss-pix', gl: gl(PIX_GL), gpu: gpu(PIX_WGSL) },
    { id: 'ss-noise', gl: gl(NOISE_GL, NOISE_GL_HELPERS), gpu: gpu(NOISE_WGSL, NOISE_WGSL_HELPERS) },
    { id: 'ss-bmask', gl: gl(BMASK_GL), gpu: gpu(BMASK_WGSL) },
    { id: 'ss-outline', gl: gl(OUTLINE_GL), gpu: gpu(OUTLINE_WGSL) },
    { id: 'ss-blur', gl: gl(BLUR_GL), gpu: gpu(BLUR_WGSL) },
    { id: 'ss-wave', gl: gl(WAVE_GL), gpu: gpu(WAVE_WGSL) },
    { id: 'ss-move', gl: gl(MOVE_GL), gpu: gpu(MOVE_WGSL) },
    { id: 'ss-scatter', gl: gl(SCATTER_GL, SCATTER_GL_HELPERS), gpu: gpu(SCATTER_WGSL, SCATTER_WGSL_HELPERS) },
    { id: 'ss-circle', gl: gl(CIRCLE_GL), gpu: gpu(CIRCLE_WGSL) },
    { id: 'ss-spot', gl: gl(SPOT_GL), gpu: gpu(SPOT_WGSL) },
];

/** id_hash (FNV-1a of the SS shader id) → GLSL/WGSL program for the renderer. */
export const SS_SHADER_SOURCES: Map<number, SsShaderProgram> = new Map(
    DEFS.map((d) => [ssShaderIdHash(d.id), { gl: d.gl, gpu: d.gpu }] as const)
);
