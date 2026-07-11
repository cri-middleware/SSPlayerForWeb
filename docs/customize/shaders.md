# Shaders and blend modes

## Blend modes

SpriteStudio's "read the background" blend modes (**Screen / Exclusion / Invert**,
etc.) are implemented as **fixed-function GPU blending** that reads the actual
framebuffer. The background being composited against is the PixiJS `Application`'s
`backgroundColor`. If you want the look to match the editor, first check that the
background color matches your authoring environment.

(Implemented in `ssplayer-pixi`'s `SSBlendModes.ts`.)

## SS integrated shaders

SpriteStudio's integrated shaders (`ss-*`) are ported and applied per part with
pooling. Cell rectangles are computed from the UV corners.

(Implemented in `ssplayer-pixi`'s `SSShaderLib.ts` / `PartsColorShader.ts` /
`EffectShader.ts`, and others.)

::: tip Validating the look
Prioritize **matching the look in the SpriteStudio editor** over the spec values.
The surest approach is to line up the samples (`BlendMode.ssab` / `Shader.ssab` /
`PartsColor.ssab`, etc.) in `examples/pixi-example` and compare them side by side.
:::
