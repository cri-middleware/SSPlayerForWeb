---
description: The blend modes both renderers implement as fixed-function GPU blending, and the SS integration shaders.
---

# Shaders and blend modes

Both renderers implement the same feature set with the same results — `ssplayer-webgl` in raw GLSL,
`ssplayer-pixi` in Pixi shaders (GLSL and WGSL, so it works on the WebGPU backend too).

## Blend modes

Blend modes are **fixed-function GPU blending**, not a post-process. The modes that read the
background (**Screen / Exclusion / Invert**, and additive) composite against whatever is already in
the framebuffer. Shader output is premultiplied, and alpha always blends as premultiplied coverage.

| SpriteStudio mode | How it is drawn |
|---|---|
| Mix, Add, Sub, Mul | Exact fixed-function equivalents |
| Screen, Exclusion, Invert | Exact; these read the backdrop |
| Mulalpha, Mul2 | Approximated as **Mul** |
| Screen2 | Approximated as **Screen** |
| Div2, Overlay2 | Approximated as **Mix** |

The last three rows have no GPU-native equivalent, so they are the modes most likely to differ from
the editor. Everything else should match.

### The backdrop has to be right

A backdrop-reading mode is only correct when there is a real backdrop to read. Getting this wrong
is the usual cause of "the blend looks nothing like the editor".

**PixiJS** — the backdrop is the `Application`'s `backgroundColor`. Match it to your authoring
environment.

**WebGL** — pass `backgroundColor` when the animation uses additive or backdrop-reading modes:

```ts
const surface = new SSSurface(canvas, { backgroundColor: 0x000000 });
const player = surface.createPlayer();
```

```html
<ss-player src="/assets/Effect.ssab" animation="fire" standalone background="#000000"></ss-player>
```

`background` configures the element's own context, so it takes effect on a `standalone` element only.
An element on the shared overlay (the default) has no opaque backdrop to read; give its player one
with `el.player.backdrop = 0x000000` (any player on a shared surface has `player.backdrop`).

::: warning Transparent canvas + additive
With `backgroundColor` omitted, the canvas is cleared **fully transparent** so it can sit as an
overlay. An additive sprite then has nothing to add onto: a glow whose texture was baked on opaque
black renders that black as a solid block. This is inherent to premultiplied-alpha compositing —
`ssplayer-pixi` avoids it the same way, by drawing on an opaque `backgroundColor`.
:::

## SS integration shaders

SpriteStudio's integration shaders (the `SHDR` attribute, `ss-*`) are ported to both renderers. Cell
rectangles are computed from the UV corners, so effects that sample around the cell stay inside it.

The thirteen built-ins are supported: `ss-sepia`, `ss-hsb`, `ss-step`, `ss-pix`, `ss-noise`,
`ss-bmask`, `ss-outline`, `ss-blur`, `ss-wave`, `ss-move`, `ss-scatter`, `ss-circle`, `ss-spot`.
A shader id that is not one of these falls back to plain drawing.

Programs are compiled on first use and cached per shader id, and a frame with no shader parts skips
the whole path — so shader-free animations pay nothing for this feature being present.

::: warning A masked part loses its shader
When a part is both a mask target and carries an `ss-*` shader, it draws through the masking path
with the plain program and the shader is dropped. Both renderers behave this way.
If a part needs both, split it into two parts at authoring time.
:::

Shader parts also break batching — see [Performance tuning](./performance.md#what-breaks-batching).

::: tip Validating the look
Prioritize **matching the look in the SpriteStudio editor** over the spec values.
The surest approach is to line up the samples (`BlendMode.ssab` / `Shader.ssab` /
`PartsColor.ssab`, etc.) in `examples/pixi-example` and compare them side by side.
:::
