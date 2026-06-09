import { Shader, Texture } from 'pixi.js';

export const PartsColorShader = {
    vertex: `
    in vec2 aPosition;
    in vec2 aUV;
    in vec4 aColor;
    in vec4 aVarg;

    uniform mat3 uProjectionMatrix;
    uniform mat3 uTransformMatrix;

    out vec2 vUV;
    out vec4 vColor;
    out vec4 vVarg;

    void main() {
        gl_Position = vec4((uProjectionMatrix * uTransformMatrix * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
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

        // Base blend colors
        vec3 mixColor = mix(texColor.rgb, vColor.rgb, rate * vColor.a);
        vec3 mulColor = texColor.rgb * mix(vec3(1.0), vColor.rgb, rate * vColor.a);
        vec3 addSubColor = texColor.rgb + (vColor.rgb * rate * vColor.a * sign(isAddSub));

        // Output color
        vec3 outRgb = mixColor * isMix + mulColor * isMul + addSubColor * abs(isAddSub);

        finalColor = vec4(outRgb * texColor.a, texColor.a);
    }
`
};
