import { Shader, Texture } from 'pixi.js';

export const PartsColorShader = {
    vertex: `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aColor;
    in vec4 aVarg;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uWorldTransformMatrix;
    uniform mat3 uTransformMatrix;

    out vec2 vUV;
    out vec4 vColor;
    out vec4 vVarg;

    void main() {
        gl_Position = vec4((uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
        vUV = aUV;
        vColor = aColor;
        vVarg = aVarg;
    }
`,
    fragment: `
    in vec2 vUV;
    in vec4 vColor;
    in vec4 vVarg;

    uniform sampler2D uTexture;
    uniform vec4 uColor; // PixiJS automatically provides this with (tint.rgb * worldAlpha, worldAlpha)

    void main() {
        vec4 texColor = texture(uTexture, vUV);
        if (texColor.a == 0.0) {
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

        // 2. Base blend colors. Blend strength is 'rate' ALONE — the parts-color
        // alpha (vColor.a) is the rateAlpha and must NOT modulate the tint
        // strength; it drives the output alpha instead (10_parts_color §1-4).
        // Hierarchy / part opacity is applied separately via uColor (mesh alpha).
        vec3 mixColor = mix(straightTexRGB, vColor.rgb, rate);
        vec3 mulColor = straightTexRGB * mix(vec3(1.0), vColor.rgb, rate);
        vec3 addSubColor = straightTexRGB + (vColor.rgb * rate * sign(isAddSub));

        // 3. Output straight color
        vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

        // 4. Output alpha = texture alpha x parts-color alpha (§1-4: a = p.a * partcolor.a),
        //    re-premultiply, then fold hierarchy alpha / world tint via uColor.
        float outA = texColor.a * vColor.a;
        finalColor = vec4(outRgb * outA, outA) * uColor;
    }
`
};

export const PartsColorShaderWGSL = {
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
  @location(1) vColor: vec4<f32>,
  @location(2) vVarg: vec4<f32>,
}

@vertex
fn mainVert(in: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let pos = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix * vec3<f32>(in.aPosition, 1.0);
  out.position = vec4<f32>(pos.xy, 0.0, 1.0);
  out.vUV = in.aUV;
  out.vColor = in.aColor;
  out.vVarg = in.aVarg;
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
  @location(2) vVarg: vec4<f32>,
}

@fragment
fn mainFrag(in: VertexOutput) -> @location(0) vec4<f32> {
  let texColor = textureSample(uTexture, uTextureSampler, in.vUV);
  if (texColor.a == 0.0) {
      return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let rate = in.vVarg.x;
  let isMix = in.vVarg.y;
  let isMul = in.vVarg.z;
  let isAddSub = in.vVarg.w;

  // 1. Un-premultiply texture color
  let straightTexRGB = texColor.rgb / max(texColor.a, 0.0001);

  // 2. Blend strength is 'rate' ALONE — parts-color alpha (vColor.a) is the
  // rateAlpha and drives output alpha, not tint strength (10_parts_color §1-4).
  let mixColor = mix(straightTexRGB, in.vColor.rgb, rate);
  let mulColor = straightTexRGB * mix(vec3<f32>(1.0, 1.0, 1.0), in.vColor.rgb, rate);
  let addSubColor = straightTexRGB + (in.vColor.rgb * rate * sign(isAddSub));

  // 3. Output straight color
  let outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

  // 4. Output alpha = texture alpha x parts-color alpha (§1-4), re-premultiply,
  //    then fold hierarchy alpha / world tint via uColor.
  let outA = texColor.a * in.vColor.a;
  let finalColor = vec4<f32>(outRgb * outA, outA) * localUniforms.uColor;

  return finalColor;
}
`,
        entryPoint: 'mainFrag'
    }
};
