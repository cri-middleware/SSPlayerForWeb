---
description: "Frame-rate tuning ordered by how much each buys: resolution and overdraw, not drawing at all, playback options and what breaks batching."
---

# Performance tuning

Ordered roughly by how much they usually buy you. If an animation is dropping frames, start with
resolution — for effect-heavy content it dominates everything else on this page.

## Resolution and overdraw

Most SpriteStudio content is **fill-rate bound**, not CPU bound. Effect and particle parts stack
many large, mostly-transparent quads on top of each other, so the same pixel gets shaded over and
over (*overdraw*). The cost scales with the number of pixels in the drawing buffer multiplied by
how many layers cover each one — which makes the drawing buffer's resolution the single biggest
lever you have. On a 3× device, capping the buffer at 2× removes more than half the work; at 1×,
nearly 90%.

**WebGL** — cap the device pixel ratio. The default cap is already `2`:

```ts
const surface = new SSSurface(canvas, { maxDPR: 1.5 });
const player = surface.createPlayer();
player.resize(cssWidth, cssHeight);       // recomputes the buffer under the cap
```

```html
<ss-player src="/assets/Ringo.ssab" animation="run" standalone max-dpr="1.5"></ss-player>
```

`max-dpr` configures the element's own context, so it takes effect on a `standalone` element. Elements
share one overlay canvas by default, and that canvas is set up once, by
`SSOverlay.getOrCreate(id, { maxDPR: 1.5 })`, before the first element connects.

**PixiJS** — the drawing buffer belongs to the `Application`, so cap it there:

```ts
await app.init({ resolution: Math.min(window.devicePixelRatio, 1.5), autoDensity: true });
```

Turning `antialias` off is worth trying in the same pass — the animation is textured quads, so MSAA
buys little here and costs bandwidth.

::: tip Confirm you are actually fill-rate bound
Shrink the canvas to a quarter of its size and see whether the frame time drops roughly in
proportion. If it does, resolution is your lever. If it barely moves, the cost is elsewhere — look
at draw calls and the per-frame options below.
:::

## Not drawing at all

`pauseWhenHidden` is **on by default** in `ssplayer-webgl`. It wires an `IntersectionObserver` that
halts the ticker when the canvas scrolls off-screen, plus a `visibilitychange` listener that halts
it when the tab is backgrounded. Leave it on unless a player needs to keep advancing while
invisible; opt out explicitly with `pause-when-hidden="false"`.

## Playback options

```ts
player.subFrameEnabled = false;  // disable sub-frame interpolation (on by default); use to reduce load
```

- **`subFrameEnabled`**: **on by default**. Smooths motion on high refresh rates and during
  slow-motion effects. Set it to `false` when running many players at once makes the
  per-frame computation too expensive.
- **`frameSkipEnabled`**: **on by default**. Skips frames to keep playback timing when
  rendering can't keep up — no action needed for performance.

::: warning
`subFrameEnabled` and `frameSkipEnabled` work as a pair. If you turn one off, turn off the
other too — disabling only one leaves playback timing inconsistent.
:::

## What breaks batching

Both renderers draw a frame as a small number of batches. Two authoring choices split those
batches, and the cost is proportional to how many parts are involved:

- **Integration shaders (`ss-*`)**. A batch containing a shader part is drawn **one part at a
  time**, each with its own program and uniforms, so the shader parts composite correctly. Frames
  with no shader parts skip the check entirely and pay nothing. See
  [Shaders & blend modes](/customize/shaders).
- **Masking**. Masked content goes through a separate coverage pre-pass. On PixiJS, set
  `player.maskEnabled = false` to drop that pass for animations that do not use mask parts (the
  WebGL renderer has no such toggle). Without the pass every part draws unclipped, including a
  part set to draw only inside a mask — which SpriteStudio hides when no mask covers it, even in
  an animation with no mask parts at all. An animation with such parts therefore looks different
  with the pass turned off.

Neither is something to avoid on principle — they are just the first thing to look at when one
animation costs far more than another with a similar part count.

## Built-in speedups

You get these without doing anything:

- **Direct Drawing (batched rendering)**: draw operations are batched, so many characters are drawn
  with few draw calls.
- **Zero-Copy**: transforms and geometry are passed as `Float32Array` views that
  reference WASM memory directly, avoiding a per-frame copy.
- **Texture sharing**: atlases are cached by URL — in Pixi's global `Assets` cache on PixiJS, and
  per `SSSurface` on WebGL — so many players of the same character share one GPU texture.

What is **not** shared is the parsed `.ssab`: each `load()` allocates its own WASM-side copy. On
WebGL the GL context belongs to the `SSSurface`, so only players on the same surface share
textures: put a crowd of the same character on one surface. See
[Resources & lifecycle](/customize/resources).

## Measurement tips

The quickest path is to place many instances of the target asset in
`examples/pixi-example` and check the draw-call count and frame time in your
browser's performance panel.
