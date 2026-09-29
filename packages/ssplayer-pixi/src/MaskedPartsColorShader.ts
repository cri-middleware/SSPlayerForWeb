// PartsColor shader variant for parts clipped by a mask (the bit-packed
// coverage *replay*). Colour is computed exactly as PartsColorShader, then the
// fragment is discarded (output 0) when it fails the mask test.
//
// Per-vertex aMaskUV = (u, v, thisSeq, visibleInside):
//   - (u, v): this part's position mapped into the coverage texture's UV space
//     (the mask bounding box normalised to [0,1]); computed CPU-side so no
//     per-context uniforms are needed for it and parts still batch.
//   - thisSeq: the part's number on the instance tree's draw sequence.
//   - visibleInside: 1 = show inside the mask, 0 = show outside (composed
//     visible_inside_mask).
// Per-tree uniforms (one mask group): uMaskMeta[i] = (open, close, bit,
// opInvert) for each of uMaskCount writers, the coverage texture (uMaskTexture,
// sampled NEAREST) and its tile grid uMaskTiles = (columns, rows). One tile holds
// 24 writer bits in its R/G/B channels; past 24 writers the texture is split
// into 2 and then 4 tiles, each a copy of the same bbox at a lower resolution,
// and writer `bit` lives in tile floor(bit / 24). A writer reaches the part when
// open < thisSeq < close, a negative close meaning it never closes (see
// MaskTreePlanner). The replay reconstructs the coverage (increment / invert
// ops) from the writers that reach the part, then keeps the fragment iff
// (covered) == visibleInside. Outside the coverage bbox, or with no writer at
// all, a fragment is covered by nothing: kept unless visibleInside — a part
// that draws only inside a mask draws nowhere without one.
//
// The sequence values are compared exactly, so they are read at highp: at
// mediump a large instance tree would run out of exact integers.
//
// The two ops are accumulated SEPARATELY: invert and
// increment/decrement are each self-inverse but do not commute, so folding both
// into one accumulator makes a mixed overlap depend on writer order. Unlike the
// GPU-stencil path there is no bit budget to divide here — these are shader
// locals — so the two planes cost nothing and carry no overlap limit.

// Uses only float arithmetic (no integer / bit-wise operators) so it compiles
// on WebGL1 (GLSL ES 1.00) as well as WebGL2 — bit extraction is done with
// pow/mod/floor, and the parity plane toggles with 1.0 - x instead of a xor.
const MASKED_GLSL_REPLAY = `
    vec4 coverageTile(vec2 cuv, float tile) {
        // Nudge off the far edge so a uv of exactly 1 stays inside its tile.
        vec2 inTile = clamp(cuv, 0.0, 0.9999);
        vec2 cell = vec2(mod(tile, uMaskTiles.x), floor(tile / uMaskTiles.x));
        return texture(uMaskTexture, (inTile + cell) / uMaskTiles);
    }

    bool maskPasses(vec2 cuv, highp float thisSeq, float visInside) {
        float writerCount = floor(uMaskCount + 0.5);
        if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) return visInside <= 0.5;
        // One sample per tile, read once rather than per writer.
        vec4 cov0 = coverageTile(cuv, 0.0);
        vec4 cov1 = writerCount > 24.5 ? coverageTile(cuv, 1.0) : vec4(0.0);
        vec4 cov2 = writerCount > 48.5 ? coverageTile(cuv, 2.0) : vec4(0.0);
        vec4 cov3 = writerCount > 72.5 ? coverageTile(cuv, 3.0) : vec4(0.0);
        float parity = 0.0;  // invert writers (mask_influence 1): odd overlap covers
        float counter = 0.0; // increment writers (mask_influence 0): any overlap covers
        for (int i = 0; i < 96; i++) {
            if (float(i) >= writerCount) break;
            highp vec4 m = uMaskMeta[i];
            bool active = thisSeq > m.x && (m.y < 0.0 || thisSeq < m.y);
            if (!active) continue;
            float tileBit = floor(m.z + 0.5);
            float tile = floor(tileBit / 24.0);
            vec4 cov = tile < 0.5 ? cov0 : (tile < 1.5 ? cov1 : (tile < 2.5 ? cov2 : cov3));
            float bit = tileBit - tile * 24.0;
            float chan = floor(bit / 8.0);
            float cval = chan < 0.5 ? cov.r : (chan < 1.5 ? cov.g : cov.b);
            float byteV = floor(cval * 255.0 + 0.5);
            float bitpos = bit - chan * 8.0;
            float bitSet = mod(floor(byteV / pow(2.0, bitpos)), 2.0);
            if (bitSet < 0.5) continue;
            if (m.w > 0.5) parity = 1.0 - parity;  // invert
            else counter += 1.0;                   // increment
        }
        bool masked = (parity > 0.5) || (counter > 0.5); // union of both planes
        return masked == (visInside > 0.5);
    }
`;

export const MaskedPartsColorShader = {
    vertex: `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aColor;
    in vec4 aVarg;
    in vec4 aMaskUV;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    out vec2 vUV;
    out vec4 vColor;
    out vec4 vVarg;
    out vec4 vMaskUV;

    void main() {
        gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
        vVarg = aVarg;
        vMaskUV = aMaskUV;
    }
`,
    fragment: `
    in vec2 vUV;
    in vec4 vColor;
    in vec4 vVarg;
    in highp vec4 vMaskUV;

    uniform sampler2D uTexture;
    uniform sampler2D uMaskTexture;
    uniform vec4 uColor; // PixiJS automatically provides this with (tint.rgb * worldAlpha, worldAlpha)
    uniform highp vec4 uMaskMeta[96];
    uniform float uMaskCount;
    uniform vec2 uMaskTiles;
${MASKED_GLSL_REPLAY}
    void main() {
        vec4 texColor = texture(uTexture, vUV);
        if (texColor.a == 0.0) {
            finalColor = vec4(0.0);
            return;
        }

        if (!maskPasses(vMaskUV.xy, vMaskUV.z, vMaskUV.w)) {
            finalColor = vec4(0.0);
            return;
        }

        // vVarg: [rate, Mix_Flag, Mul_Flag, AddSub_Flag]
        float rate = vVarg.x;
        
        // Fast path for parts without parts-color (rate == 0)
        if (rate == 0.0) {
            float outA = texColor.a * vColor.a;
            finalColor = vec4(texColor.rgb * vColor.a, outA) * uColor;
            return;
        }

        float isMix = vVarg.y;
        float isMul = vVarg.z;
        float isAddSub = vVarg.w;

        // 1. Un-premultiply texture color
        vec3 straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);

        // 2. Base blend colors. Blend strength is 'rate' ALONE; parts-color alpha
        // (vColor.a) drives output alpha, not tint strength.
        vec3 mixColor = mix(straightTexRGB, vColor.rgb, rate);
        vec3 mulColor = straightTexRGB * mix(vec3(1.0), vColor.rgb, rate);
        vec3 addSubColor = straightTexRGB + (vColor.rgb * rate * sign(isAddSub));

        // 3. Output straight color
        vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

        // 4. Output alpha = texture alpha x parts-color alpha; re-premultiply,
        //    then fold hierarchy alpha / world tint via uColor.
        float outA = texColor.a * vColor.a;
        finalColor = vec4(outRgb * outA, outA) * uColor;
    }
`
};

export const MaskedPartsColorShaderWGSL = {
    vertex: {
        source: `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
}
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

struct VertexInput {
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
  @location(2) aColor: vec4<f32>,
  @location(3) aVarg: vec4<f32>,
  @location(4) aMaskUV: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vVarg: vec4<f32>,
  @location(3) vMaskUV: vec4<f32>,
}

@vertex
fn mainVert(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let pos = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix * vec3<f32>(in.aPosition, 1.0);
  out.position = vec4<f32>(pos.xy, 0.0, 1.0);
  out.vUV = in.aUV;
  out.vColor = in.aColor;
  out.vVarg = in.aVarg;
  out.vMaskUV = in.aMaskUV;
  return out;
}
`,
        entryPoint: 'mainVert'
    },
    fragment: {
        source: `
struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
}
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uTextureSampler: sampler;
@group(2) @binding(2) var uMaskTexture: texture_2d<f32>;
@group(2) @binding(3) var uMaskSampler: sampler;

struct MaskUniforms {
  uMaskMeta: array<vec4<f32>, 96>,
  uMaskCount: f32,
  uMaskTiles: vec2<f32>,
}
@group(3) @binding(0) var<uniform> maskUniforms : MaskUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vVarg: vec4<f32>,
  @location(3) vMaskUV: vec4<f32>,
}

fn coverageTile(cuv: vec2<f32>, tile: f32) -> vec4<f32> {
  // Nudge off the far edge so a uv of exactly 1 stays inside its tile.
  let tiles = maskUniforms.uMaskTiles;
  let inTile = clamp(cuv, vec2<f32>(0.0), vec2<f32>(0.9999));
  let cell = vec2<f32>(tile - floor(tile / tiles.x) * tiles.x, floor(tile / tiles.x));
  return textureSampleLevel(uMaskTexture, uMaskSampler, (inTile + cell) / tiles, 0.0);
}

// Mirrors MASKED_GLSL_REPLAY, including the split of the invert and
// increment ops into two independent accumulators.
fn maskPasses(cuv: vec2<f32>, thisSeq: f32, visInside: f32) -> bool {
  let writerCount = i32(maskUniforms.uMaskCount + 0.5);
  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) { return visInside <= 0.5; }
  // One sample per tile, read once rather than per writer.
  var covs = array<vec4<f32>, 4>(
    coverageTile(cuv, 0.0), coverageTile(cuv, 1.0), coverageTile(cuv, 2.0), coverageTile(cuv, 3.0));
  var parity: i32 = 0;  // invert writers (mask_influence 1): odd overlap covers
  var counter: i32 = 0; // increment writers (mask_influence 0): any overlap covers
  for (var i: i32 = 0; i < 96; i = i + 1) {
    if (i >= writerCount) { break; }
    let m = maskUniforms.uMaskMeta[i];
    // "active" is a reserved word in WGSL, hence inScope. The comparisons are
    // parenthesised so "< ... >" isn't parsed as a template list.
    let inScope = (thisSeq > m.x) && ((m.y < 0.0) || (thisSeq < m.y));
    if (!inScope) { continue; }
    let tileBit = i32(m.z + 0.5);
    let tile = tileBit / 24;
    let cov = covs[tile];
    let bit = tileBit - tile * 24;
    let chan = bit / 8;
    let cval = select(select(cov.b, cov.g, chan == 1), cov.r, chan == 0);
    let byteV = i32(cval * 255.0 + 0.5);
    let shift = u32(bit - chan * 8);
    if (((byteV >> shift) & 1) == 0) { continue; }
    if (m.w > 0.5) { parity = parity ^ 1; }
    else { counter = counter + 1; }
  }
  let masked = (parity != 0) || (counter != 0); // union of both planes
  return masked == (visInside > 0.5);
}

@fragment
fn mainFrag(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(uTexture, uTextureSampler, in.vUV);
  if (texColor.a == 0.0) {
      return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  if (!maskPasses(in.vMaskUV.xy, in.vMaskUV.z, in.vMaskUV.w)) {
      return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let rate = in.vVarg.x;
  
  if (rate == 0.0) {
      let outA = texColor.a * in.vColor.a;
      return vec4<f32>(texColor.rgb * in.vColor.a, outA) * localUniforms.uColor;
  }

  let isMix = in.vVarg.y;
  let isMul = in.vVarg.z;
  let isAddSub = in.vVarg.w;

  // 1. Un-premultiply texture color
  let straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);

  // 2. Blend strength is 'rate' ALONE; parts-color alpha (vColor.a) drives
  // output alpha, not tint strength.
  let mixColor = mix(straightTexRGB, in.vColor.rgb, rate);
  let mulColor = straightTexRGB * mix(vec3<f32>(1.0, 1.0, 1.0), in.vColor.rgb, rate);
  let addSubColor = straightTexRGB + (in.vColor.rgb * rate * sign(isAddSub));

  // 3. Output straight color
  let outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

  // 4. Output alpha = texture alpha x parts-color alpha; re-premultiply,
  //    then fold hierarchy alpha / world tint via uColor.
  let outA = texColor.a * in.vColor.a;
  return vec4<f32>(outRgb * outA, outA) * localUniforms.uColor;
}
`,
        entryPoint: 'mainFrag'
    }
};
