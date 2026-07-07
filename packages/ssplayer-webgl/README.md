[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-webgl

Lightweight, zero-dependency **WebGL1/2** renderer for the **SpriteStudio 7** player, driven by a Rust/WebAssembly core — with a drop-in **`<ss-player>` custom element** for declarative, zero-JavaScript use.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](../../docs/).

## ✨ Why SpriteStudio with plain WebGL?

- **Drop it in with a single HTML tag.** The built-in **`<ss-player>` custom
  element** plays a `.ssab` declaratively — `<ss-player src="chara.ssab"
  animation="idle" autoplay>` — with no build step and no JavaScript, in any
  framework or plain HTML. Prefer code? The `SSCanvasPlayer` class gives full
  imperative control over the same renderer.
- **A whole scene, not just a character.** SpriteStudio composes characters,
  backgrounds, effects, and UI onto a single timeline, so one `.ssab` can be a
  complete animated piece — a full banner, splash, or cut-in, not just one sprite.
- **When you can't (or won't) ship an engine.** Embeddable widgets, a
  landing-page hero, or any placement on a strict byte budget — where pulling in
  a full framework is too much weight, and you'd otherwise hand-roll a WebGL
  animation system or fall back to video. Editor-crafted bone / mesh / particle
  animation with **zero dependencies** and a tiny footprint, rendering into a
  plain `<canvas>`.
- **A lighter alternative to `<video>` — and smoother.** It scales freely at
  runtime, loops seamlessly, and reacts to input, instead of a fixed-size clip
  that just plays back. And because playback is **sub-frame interpolated** (on by
  default), motion renders at the display's exact refresh rate — no judder from a
  clip baked at a fixed frame rate.
- **Pay only for what you use.** Tree-shakeable entry points: the `./lite` build
  trims to Normal + blend for the tightest bundle when size is the budget, and
  the audio adapter loads only when a sound-bearing animation is set.

Put together, that's exactly what the **tightest, sandboxed embed slots** ask for —
zero dependencies, a single self-contained `.ssab` (embedded), one drop-in HTML
tag, and a byte-budgeted `./lite` build — so it fits size- and sandbox-constrained
placements where a heavier player simply won't.

## Quick start

```ts
import { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';

// 1. Load the WASM runtime once for the whole app.
await SSCanvasPlayer.initialize();

// 2. Create a player on a canvas, load a .ssab, and pick an animation.
const canvas = document.querySelector('canvas')!;
const player = new SSCanvasPlayer(canvas, {
  maxDPR: 2,                 // cap devicePixelRatio for fill-rate control
  powerPreference: 'low-power',
  pauseWhenHidden: true,     // pause when the tab/element is not visible
  backgroundColor: 0x1a1a2e, // opaque backdrop; omit for a transparent canvas
});

await player.load('/Ringo.ssab');   // optional 2nd arg: assetBaseUrl for textures
await player.setAnimation('run');

player.play();                       // drives itself via requestAnimationFrame
```

`SSCanvasPlayer` accepts either an `HTMLCanvasElement` or an existing `WebGL(2)RenderingContext` as its target, so it can share a context with your own renderer.

> **Reference *and* embedded ssab both work.** `load()` (and the element's `src`)
> take either variant; `--embedded` ssab render from inlined textures with no
> sibling fetch — the whole animation loads as a single self-contained request.
> Verified against both in `examples/webgl-example`.

## Entry points

Import only what you need — all three are tree-shakeable (`sideEffects: false`):

| Import | Contents |
|---|---|
| `@spritestudio/ssplayer-webgl` | Full renderer: all blend modes + the lazily-loaded Web Audio adapter. |
| `@spritestudio/ssplayer-webgl/lite` | Minimal build — **Normal + blend only**, no exotic blend modes, smallest bundle. |
| `@spritestudio/ssplayer-webgl/element` | The `<ss-player>` Custom Element (see below). |

## `<ss-player>` Web Component

A thin, declarative skin over `SSCanvasPlayer`. It is **not** auto-registered (to keep `sideEffects: false`), so call `defineSSPlayerElement()` once to register the tag.

```ts
import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
defineSSPlayerElement();
```

```html
<ss-player src="chara.ssab" animation="idle" autoplay
           max-dpr="2" power-preference="low-power"
           style="width:320px;height:480px"></ss-player>
```

For inline / `ArrayBuffer` assets (attributes can't carry buffers), drive it imperatively:

```ts
const el = document.querySelector('ss-player')!;
await el.ready;
await el.loadBuffer(ssabArrayBuffer, new Map([[0x1234abcd, imageBitmap]]));
el.play();
```

Observed attributes (`src`, `animation`, `speed`) react live; construction-time options (`max-dpr`, `power-preference`, `antialias`, `stencil`, `pause-when-hidden`) are read once at connect. Player events are re-dispatched as DOM `CustomEvent`s.

## Playback & events

`SSCanvasPlayer` exposes the same facade as the other renderers:

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

// Timeline events — each subscription returns an unsubscribe function.
const off = player.onUserData((e) => console.log('userData', e.partName));
player.onSignal((e) => console.log('signal', e.commandId));
player.onAudio((e) => console.log('audio', e.soundName));  // notification hook — audio plays by default (see below)
player.onAnimationEnd(() => {});
player.onAnimationLoop(() => {});
off();
```

Sound "just works": if a loaded `.ssab` references audio and no `audioManager` is set, a default `SSWebAudioManager` is lazily imported and wired up (a separate chunk fetched only when needed). Set `autoAudio: false` to take full manual control.

> **Note on additive blend modes:** additive / backdrop-reading modes (Add, Screen, Mul, …) composite against the framebuffer, so set an opaque `backgroundColor` when your animation uses them. On a transparent canvas they can render baked-on-black glows as opaque blocks — inherent to premultiplied-alpha compositing.

## Working from source

WASM binaries are **not tracked in git**. From the repo root, obtain the WASM,
then build the packages:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

## Try your changes

Run the bundled WebGL example to see the renderer (and the `<ss-player>` element)
in action — handy when customising the source or verifying a fix:

```bash
cd examples/webgl-example
pnpm run dev             # start the dev server
```

The example consumes the **built** package via a workspace reference, so re-run
`pnpm run build` from the repo root after editing `src/` here.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
