// Minimal shader for SpriteStudio Effect (particle) rendering.
//
// Unlike PartsColorShader, effects carry no PartsColor overlay, so their
// meshes have no aVarg at all (see MeshLayout in SSPlayer.ts): each particle's
// per-vertex color (aColor, straight RGBA 0..1) simply modulates the texture,
// with the particle alpha (aColor.a) driving output coverage so particles fade
// in/out. Effects therefore use this dedicated minimal path rather than the
// parts-color blend machinery.
//
// Textures are premultiplied-alpha (PixiJS default). For a premultiplied texel
// and a straight vertex color the modulated premultiplied result is:
//   rgb = texColor.rgb * vColor.rgb * vColor.a
//   a   = texColor.a   * vColor.a
// then scaled by uColor (PixiJS world tint * worldAlpha). Blend mode (normal vs
// additive) is selected per draw command on the Mesh, not in the shader.

export const EffectShader = {
    vertex: `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aColor;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    out vec2 vUV;
    out vec4 vColor;

    void main() {
        gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
    }
`,
    fragment: `
    in vec2 vUV;
    in vec4 vColor;

    uniform sampler2D uTexture;
    uniform vec4 uColor; // PixiJS provides (tint.rgb * worldAlpha, worldAlpha)

    void main() {
        vec4 texColor = texture(uTexture, vUV); // premultiplied alpha
        finalColor = vec4(texColor.rgb * vColor.rgb * vColor.a, texColor.a * vColor.a) * uColor;
    }
`
};

export const EffectShaderWGSL = {
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
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vColor: vec4<f32>,
}

@vertex
fn mainVert(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let pos = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix * vec3<f32>(in.aPosition, 1.0);
  out.position = vec4<f32>(pos.xy, 0.0, 1.0);
  out.vUV = in.aUV;
  out.vColor = in.aColor;
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

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) vUV: vec2<f32>,
  @location(1) vColor: vec4<f32>,
}

@fragment
fn mainFrag(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(uTexture, uTextureSampler, in.vUV); // premultiplied alpha
  return vec4<f32>(texColor.rgb * in.vColor.rgb * in.vColor.a, texColor.a * in.vColor.a) * localUniforms.uColor;
}
`,
        entryPoint: 'mainFrag'
    }
};
