// PartsColor shader variant for parts clipped by a mask (the bit-packed
// coverage *replay*; see SpriteStudio-SDK/libs/ssruntime/docs/09_mask.ja.md
// §3-2). Colour is computed exactly as PartsColorShader, then the fragment is
// discarded (output 0) when it fails the mask test.
//
// Per-vertex aMaskUV = (u, v, thisRank, visibleInside):
//   - (u, v): this part's position mapped into the coverage texture's UV space
//     (the mask bounding box normalised to [0,1]); computed CPU-side so no
//     per-context uniforms are needed for it and parts still batch.
//   - thisRank: the part's rank in draw_order (for scope tests).
//   - visibleInside: 1 = show inside the mask, 0 = show outside (PartData
//     visible_inside_mask).
// Per-context uniforms (one mask group): uMaskMeta[i] = (drawRank, bit,
// opInvert, isClipping) for each of uMaskCount writers, and the coverage
// texture (uMaskTexture, sampled NEAREST). The replay walks the writers in
// draw order, reconstructs the stencil (increment / invert ops) honouring each
// writer's scope, then keeps the fragment iff (stencil != 0) == visibleInside.
// Outside the coverage bbox a fragment is treated as "no writer" (kept unless
// visibleInside).

// Uses only float arithmetic (no integer / bit-wise operators) so it compiles
// on WebGL1 (GLSL ES 1.00) as well as WebGL2 — bit extraction is done with
// pow/mod/floor, and the 8-bit stencil increment/invert with float math
// (~x & 0xFF == 255 - x for x in [0,255]).
const MASKED_GLSL_REPLAY = `
    bool maskPasses(vec4 cov, vec2 cuv, float thisRank, float visInside) {
        float count = floor(uMaskCount + 0.5);
        if (count < 0.5) return true;
        if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) return visInside <= 0.5;
        float stencil = 0.0;
        for (int i = 0; i < 24; i++) {
            if (float(i) >= count) break;
            vec4 m = uMaskMeta[i];
            bool active = (m.w > 0.5) ? (thisRank > m.x) : (thisRank < m.x);
            if (!active) continue;
            float bit = floor(m.y + 0.5);
            float chan = floor(bit / 8.0);
            float cval = chan < 0.5 ? cov.r : (chan < 1.5 ? cov.g : cov.b);
            float byteV = floor(cval * 255.0 + 0.5);
            float bitpos = bit - chan * 8.0;
            float bitSet = mod(floor(byteV / pow(2.0, bitpos)), 2.0);
            if (bitSet < 0.5) continue;
            if (m.z > 0.5) stencil = 255.0 - stencil;     // invert (8-bit)
            else stencil = mod(stencil + 1.0, 256.0);     // increment
        }
        bool masked = stencil >= 0.5;
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
    in vec4 vMaskUV;

    uniform sampler2D uTexture;
    uniform sampler2D uMaskTexture;
    uniform vec4 uColor; // PixiJS automatically provides this with (tint.rgb * worldAlpha, worldAlpha)
    uniform vec4 uMaskMeta[24];
    uniform float uMaskCount;
${MASKED_GLSL_REPLAY}
    void main() {
        vec4 texColor = texture(uTexture, vUV);
        if (texColor.a == 0.0) {
            finalColor = vec4(0.0);
            return;
        }

        vec4 cov = texture(uMaskTexture, clamp(vMaskUV.xy, 0.0, 1.0));
        if (!maskPasses(cov, vMaskUV.xy, vMaskUV.z, vMaskUV.w)) {
            finalColor = vec4(0.0);
            return;
        }

        // vVarg: [rate, Mix_Flag, Mul_Flag, AddSub_Flag]
        float rate = vVarg.x;
        float isMix = vVarg.y;
        float isMul = vVarg.z;
        float isAddSub = vVarg.w;

        // 1. Un-premultiply texture color
        vec3 straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);

        // 2. Base blend colors
        vec3 mixColor = mix(straightTexRGB, vColor.rgb, rate * vColor.a);
        vec3 mulColor = straightTexRGB * mix(vec3(1.0), vColor.rgb, rate * vColor.a);
        vec3 addSubColor = straightTexRGB + (vColor.rgb * rate * vColor.a * sign(isAddSub));

        // 3. Output straight color
        vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

        // 4. Re-premultiply
        finalColor = vec4(outRgb * texColor.a, texColor.a) * uColor;
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
  uMaskMeta: array<vec4<f32>, 24>,
  uMaskCount: f32,
}
@group(3) @binding(0) var<uniform> maskUniforms : MaskUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vColor: vec4<f32>,
  @location(2) vVarg: vec4<f32>,
  @location(3) vMaskUV: vec4<f32>,
}

fn maskPasses(cov: vec4<f32>, cuv: vec2<f32>, thisRank: f32, visInside: f32) -> bool {
  let count = i32(maskUniforms.uMaskCount + 0.5);
  if (count == 0) { return true; }
  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) { return visInside <= 0.5; }
  var stencil: i32 = 0;
  for (var i: i32 = 0; i < 24; i = i + 1) {
    if (i >= count) { break; }
    let m = maskUniforms.uMaskMeta[i];
    let isClip = m.w > 0.5;
    // "active" is a reserved word in WGSL, hence inScope. The comparisons are
    // parenthesised so "< ... >" isn't parsed as a template list.
    let inScope = select((thisRank < m.x), (thisRank > m.x), isClip);
    if (!inScope) { continue; }
    let bit = i32(m.y + 0.5);
    let chan = bit / 8;
    let cval = select(select(cov.b, cov.g, chan == 1), cov.r, chan == 0);
    let byteV = i32(cval * 255.0 + 0.5);
    let shift = u32(bit - chan * 8);
    if (((byteV >> shift) & 1) == 0) { continue; }
    if (m.z > 0.5) { stencil = (~stencil) & 255; }
    else { stencil = (stencil + 1) & 255; }
  }
  let masked = stencil != 0;
  return masked == (visInside > 0.5);
}

@fragment
fn mainFrag(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(uTexture, uTextureSampler, in.vUV);
  let cov = textureSample(uMaskTexture, uMaskSampler, clamp(in.vMaskUV.xy, vec2<f32>(0.0), vec2<f32>(1.0)));
  if (texColor.a == 0.0) {
      return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  if (!maskPasses(cov, in.vMaskUV.xy, in.vMaskUV.z, in.vMaskUV.w)) {
      return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let rate = in.vVarg.x;
  let isMix = in.vVarg.y;
  let isMul = in.vVarg.z;
  let isAddSub = in.vVarg.w;

  // 1. Un-premultiply texture color
  let straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);

  // 2. Blend
  let mixColor = mix(straightTexRGB, in.vColor.rgb, rate * in.vColor.a);
  let mulColor = straightTexRGB * mix(vec3<f32>(1.0, 1.0, 1.0), in.vColor.rgb, rate * in.vColor.a);
  let addSubColor = straightTexRGB + (in.vColor.rgb * rate * in.vColor.a * sign(isAddSub));

  // 3. Output straight color
  let outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

  // 4. Re-premultiply
  return vec4<f32>(outRgb * texColor.a, texColor.a) * localUniforms.uColor;
}
`,
        entryPoint: 'mainFrag'
    }
};
