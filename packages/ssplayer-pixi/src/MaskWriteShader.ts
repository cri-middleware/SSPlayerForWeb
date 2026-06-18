// Shader for the SpriteStudio mask *coverage* pass (bit-packed bitmap method;
// see SpriteStudio-SDK/libs/ssruntime/docs/09_mask.ja.md §3-2).
//
// Each mask writer (a PartType-Mask part, or a draw-as-mask Shape) is assigned
// one bit (0..23) and rasterised into an offscreen RGBA8 RenderTexture with
// ADDITIVE blending: it writes its bit into one of the R/G/B channels (8 bits
// each = 24 writers). The masked-content shader later replays these bits in
// draw order to reconstruct the stencil (see MaskedPartsColorShader).
//
// The mask "value" (PartState.mask, 0..255) is a per-writer alpha cutoff: a
// texel contributes only where its texture alpha exceeds (1 - mask/255). The
// threshold rides in aVarg.x and the writer's pre-encoded bit colour in aColor
// (one channel set to bit/255), both filled per-vertex so writers never need
// per-draw uniforms. A threshold < 0 (textureless shapes) passes everything.
// Output alpha is forced to 1 because premultiplied additive blending scales
// rgb by src alpha.

export const MaskWriteShader = {
    vertex: `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aColor;
    in vec4 aVarg;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    out vec2 vUV;
    out vec4 vBitColor;
    out float vThreshold;

    void main() {
        gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vUV = aUV;
        vBitColor = aColor;
        vThreshold = aVarg.x;
    }
`,
    fragment: `
    in vec2 vUV;
    in vec4 vBitColor;
    in float vThreshold;

    uniform sampler2D uTexture;

    void main() {
        float a = texture(uTexture, vUV).a;
        if (a <= vThreshold) {
            discard;
        }
        finalColor = vec4(vBitColor.rgb, 1.0);
    }
`
};

export const MaskWriteShaderWGSL = {
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
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vBitColor: vec4<f32>,
  @location(2) vThreshold: f32,
}

@vertex
fn mainVert(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let pos = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix * vec3<f32>(in.aPosition, 1.0);
  out.position = vec4<f32>(pos.xy, 0.0, 1.0);
  out.vUV = in.aUV;
  out.vBitColor = in.aColor;
  out.vThreshold = in.aVarg.x;
  return out;
}
`,
        entryPoint: 'mainVert'
    },
    fragment: {
        source: `
@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uTextureSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vBitColor: vec4<f32>,
  @location(2) vThreshold: f32,
}

@fragment
fn mainFrag(in: VertexOutput) -> @location(0) vec4<f32> {
  let a = textureSample(uTexture, uTextureSampler, in.vUV).a;
  if (a <= in.vThreshold) {
    discard;
  }
  return vec4<f32>(in.vBitColor.rgb, 1.0);
}
`,
        entryPoint: 'mainFrag'
    }
};
