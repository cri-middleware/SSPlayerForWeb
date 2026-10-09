[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-webgl

Lightweight, zero-dependency **WebGL1/2** renderer for the **SpriteStudio** player, driven by a Rust/WebAssembly core — with a drop-in **`<ss-player>` custom element** for declarative, zero-JavaScript use.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](../../docs/).

> **Who this is for:** web developers with no framework — drop a SpriteStudio player into any page, either as a single `<ss-player>` HTML tag or via the `SSPlayer` JS API, with zero runtime dependencies.
> **Install:** `npm install @spritestudio/ssplayer-webgl@beta`
> **Not what you need?** → [package table](../../README.md#-which-package-should-i-use) — already on PixiJS or RPG Maker MZ? there's a dedicated renderer for that.

> **Beta line.** While 7.0.0 is in prerelease the packages publish under the `beta` dist-tag only, so the `@beta` above is required; it becomes optional once 7.0.0 ships to `latest`.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** —
the `<ss-player>` element running in your browser; drop your own `.ssab` file onto the
page to play it.

## ✨ Why SpriteStudio with plain WebGL?

- **Artist-made animation, no animation code.** Breathing characters, swaying hair, slash and magic effects — an artist builds them visually in a dedicated 2D editor (SpriteStudio), with bone rigs, mesh deformation and particles over the PNG / WebP art you already have. This player just plays the exported `.ssab`.
- **One HTML tag.** `<ss-player src="chara.ssab" animation="idle" autoplay>` plays it with no build step and no JavaScript, in plain HTML or inside any framework. Prefer code? The `SSPlayer` class drives the same renderer.
- **Whole scenes — banners, splashes, cut-ins.** Characters, backgrounds, effects and UI composed on one timeline play back as a single animation from a single `.ssab`.
- **A lighter alternative to `<video>`.** It scales freely, loops seamlessly and reacts to input, and **sub-frame interpolation** (on by default) renders at the display's refresh rate instead of a clip's baked frame rate.
- **Fits tight embed slots.** Zero dependencies, a plain `<canvas>`, and one self-contained `.ssab` with its textures embedded. When bytes are the budget, the `./lite` build trims to Normal + blend, and the audio adapter loads only for an animation that has sound.

## Usage

Two ways to use it — pick one. Either way, the same [timeline events](#playback--events)
are available: in the JS API you subscribe directly, and the `<ss-player>` element
re-dispatches them as DOM `CustomEvent`s.

### Drop-in — `<ss-player>` Web Component (little/no JS)

The fastest way onto a page: a declarative custom element that wraps
`SSPlayer`. Register the tag once, then use it anywhere in your HTML.

```ts
import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
defineSSPlayerElement();   // registers the <ss-player> tag (once per app)
```

```html
<ss-player src="chara.ssab" animation="idle" autoplay standalone
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

The animation is fitted into the element's box — `fit` (`contain` by default, `cover`, `none`), `align` (`center` by default) and `flip-x` / `flip-y` choose how — and an element given no size takes the authored canvas's. Observed attributes (`src`, `animation`, `speed-scale`, `fit`, `align`, `flip-x`, `flip-y`) react live; construction-time options (`max-dpr`, `power-preference`, `antialias`, `pause-when-hidden`, `background`) are read once at connect, and configure the element's own context, so they apply to a `standalone` element only (elements share one overlay canvas by default). Player events are re-dispatched as DOM `CustomEvent`s. A failure to load — a wrong `src` or `animation`, a runtime that would not start — is dispatched as an `error` event and logged with `console.error`.

`pause-when-hidden` is **on by default** — the ticker stops while the canvas is off-screen or the tab is backgrounded. Turn it off with `pause-when-hidden="false"`.

> **Why call `defineSSPlayerElement()` yourself?** The element is deliberately
> **not** auto-registered on import, so the package keeps its `sideEffects: false`
> tree-shaking contract (see [Entry points](#entry-points)). One call registers
> the tag; if you never import it, it's stripped from your bundle.

### Code-driven — `SSPlayer` (JS API)

Want full imperative control? Use the `SSPlayer` class directly against a `<canvas>`.

```ts
import { SSSurface } from '@spritestudio/ssplayer-webgl';

// 1. Load the WASM runtime once for the whole app.
await SSSurface.initialize();

// 2. Create a player on a canvas, load a .ssab, and pick an animation.
const canvas = document.querySelector('canvas')!;
const surface = new SSSurface(canvas, {
  maxDPR: 2,                 // cap devicePixelRatio for fill-rate control
  powerPreference: 'low-power',
  pauseWhenHidden: true,     // pause when the tab/element is not visible
  backgroundColor: 0x1a1a2e, // opaque backdrop; omit for a transparent canvas
});
const player = surface.createPlayer();

await player.load('/Ringo.ssab');   // textures load from the .ssab's own directory
player.setAnimation('run');
player.setPlacement({});   // fit the animation's canvas into the surface

player.play();                       // drives itself via requestAnimationFrame
```

`SSPlayer` accepts either an `HTMLCanvasElement` or an existing `WebGL(2)RenderingContext` as its target, so it can share a context with your own renderer.

> **Reference *and* embedded ssab both work.** `load()` (and the element's `src`)
> take either variant; `--embedded` ssab render from inlined textures with no
> sibling fetch — the whole animation loads as a single self-contained request.
> Verified against both in `examples/webgl-example`.

## Use from a CDN (no build step)

This package ships a zero-dependency browser build you can load straight from a
CDN. **The one thing you must do by hand is point the loader at the WASM binary.**
The runtime is a separate `.wasm` file, and outside a bundler (a classic
`<script>`, or any CDN context) the automatic path resolution bundlers rely on
isn't available — so pass its URL to `SSSurface.initialize(wasm)`.

> **Copy the URL pair from a snippet below; don't assemble it by hand.** The
> `.wasm` and its JS glue share an ABI, so both URLs must carry an exact version —
> a floating `@latest` on one can desync it from the other. The two versions are
> **not** necessarily identical: packages are released independently, so
> `ssplayer-webgl@7.0.1` may well pair with `ssplayer-core@7.0.0`. The snippets
> here are rewritten from the actual manifests on every release
> (`scripts/sync-doc-versions.mjs`), so the pair as printed is always a valid one.
> If the URL is missing or unreachable the player logs an explicit error and no
> `<ss-player>` renders.

### Declarative `<ss-player>` element — no JS

The most direct option: a separate self-registering bundle defines the `<ss-player>`
custom element on load, so animations play straight from markup. A classic `<script>`
can't self-locate the runtime, so give the WASM URL **once for the whole page** via
`data-wasm` on the script tag — every `<ss-player>` then omits it. Copy both lines
as a unit (the two versions are independent and need not be equal).

```html
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ss-player.element.min.js"
        data-wasm="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm"></script>

<ss-player src="chara.ssab" animation="run"  autoplay style="width:640px;height:480px"></ss-player>
<ss-player src="boss.ssab"  animation="idle" autoplay style="width:640px;height:480px"></ss-player>
```

Three ways to supply the WASM URL (first match wins, per element):

1. **`data-wasm` on the script tag** — once for the page (above). No JS.
2. **`SSWebGLPlayerElement.setSSPlayerWasmUrl(url)`** — once in JS, before the elements connect.
3. **`wasm="…"` on a single `<ss-player>`** — overrides the default for that element.

Leave it out and nothing renders, but it fails loudly: the console gets
`[ss-player] WebAssembly runtime failed to initialise` plus a message naming the URL
you need to pass.

> Bundling with a build tool? You don't need this bundle — `import { defineSSPlayerElement }
> from '@spritestudio/ssplayer-webgl/element'` and call it (kept tree-shakeable). See
> [Entry points](#entry-points).

### Classic `<script>` — global `SSWebGLPlayer`

No peer dependencies to load first. The player class is `SSWebGLPlayer.SSSurface`.

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ssplayer-webgl.browser.min.js"></script>
<script>
  const { SSSurface } = SSWebGLPlayer;
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm';

  (async () => {
    // Pass the explicit WASM URL — no bundler means no automatic resolution.
    await SSSurface.initialize(WASM_URL);

    const surface = new SSSurface(document.getElementById('stage'), {
      backgroundColor: 0x1a1a2e,
    });
    const player = surface.createPlayer();
    await player.load('./Ringo.ssab');   // serve over http(s), not file://
    player.setAnimation('run');
    player.setPlacement({});   // fit the animation's canvas into the surface
    player.play();
  })();
</script>
```

### ESM via CDN — `<script type="module">`

Prefer native modules without a build step? Import from an ESM CDN (esm.sh below).
Same rule: pass the WASM URL explicitly.

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script type="module">
  import { SSSurface } from 'https://esm.sh/@spritestudio/ssplayer-webgl@7.0.0-beta.1';

  await SSSurface.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const surface = new SSSurface(document.getElementById('stage'), { backgroundColor: 0x1a1a2e });
  const player = surface.createPlayer();
  await player.load('./Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // fit the animation's canvas into the surface
  player.play();
</script>
```

Runnable copies of the `<ss-player>` and classic `<script>` versions are in [`examples/cdn`](../../examples/cdn/) (`ss-player.html` and `webgl.html`).

## Entry points

Import only what you need — all three are tree-shakeable (`sideEffects: false`):

| Import | Contents |
|---|---|
| `@spritestudio/ssplayer-webgl` | Full renderer: all blend modes + the lazily-loaded Web Audio adapter. |
| `@spritestudio/ssplayer-webgl/lite` | Minimal build — **Normal + blend only**, no exotic blend modes, smallest bundle. |
| `@spritestudio/ssplayer-webgl/element` | The `<ss-player>` Custom Element (see [Drop-in](#drop-in--ss-player-web-component-littleno-js)). |

## Playback & events

Timeline events apply to **both** usage modes above. `SSPlayer` exposes the same facade as the other renderers:

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

// Timeline events — each subscription returns an unsubscribe function.
const off = player.onUserData((e) => console.log('userData', e.partName));
player.onSignal((e) => console.log('signal', e.commandId));
player.onAudio((e) => console.log('audio', e.soundName));  // notification hook — audio plays by default (see below)
player.onAnimationFinished(() => {});
player.onAnimationLooped(() => {});
off();
```

With the `<ss-player>` element these same events are re-dispatched as DOM `CustomEvent`s, so you can `addEventListener` for them instead: `animationstarted`, `animationfinished`, `animationlooped`, `userdata`, `signal` and `audio` (payload in `detail`), plus `load` once a pack is set up and `error` when one fails. The names are the family's stems lower-cased, the same ones `<ss-player-webgpu>` dispatches.

Per-part overrides (colour / cell / visibility) are on the same facade — `setPartColorOverride`, `setPartCellOverride`, `setPartVisibilityOverride`, `clearAllPartOverrides`. The element keeps only the playback verbs of its own, so reach them through `el.player` (`await el.ready` first).

Sound "just works": if a loaded `.ssab` references audio and no `audioManager` is set, a default `SSWebAudioManager` is lazily imported and wired up (a separate chunk fetched only when needed). Set `autoAudio: false` to take full manual control.

> **Note on additive blend modes:** additive / backdrop-reading modes (Add, Screen, Mul, …) composite against the framebuffer, so set an opaque `backgroundColor` when your animation uses them. On a transparent canvas they can render baked-on-black glows as opaque blocks — inherent to premultiplied-alpha compositing.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

### Working from source

WASM binaries are **not tracked in git**. From the repo root, obtain the WASM,
then build the packages:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

### Try your changes

Run the bundled WebGL example to see the renderer (and the `<ss-player>` element)
in action — handy when customising the source or verifying a fix:

```bash
cd examples/webgl-example
pnpm run dev             # start the dev server
```

The example consumes the **built** package via a workspace reference, so re-run
`pnpm run build` from the repo root after editing `src/` here.
