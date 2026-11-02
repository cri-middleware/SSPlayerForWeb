---
description: The standalone WebGL renderer with no engine dependency, used as the ss-player Web Component or through SSSurface and SSPlayer directly.
---

# WebGL & Web Components

`@spritestudio/ssplayer-webgl` is a standalone WebGL 1/2 renderer with no dependency on
an external rendering engine such as PixiJS. It suits setups that want to keep
dependencies and file size low — ad banners, simple web pages — and drops straight into
frameworkless pages.

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../examples/webgl/" target="_blank" rel="noreferrer">Live demo</a>** — the
`<ss-player>` Web Component in a frameworkless page; drop a `.ssab` onto it to play your
own.

## Install

It is published on npm.

```bash
pnpm add @spritestudio/ssplayer-webgl
```

## Highlights

- **No dependencies**: works on its own, with no external library such as PixiJS.
- **Web Components**: ships a Custom Element, so you can add `<ss-player>` to your HTML
  and play an animation without writing any JavaScript.
- Provides `SSSurface` + `SSPlayer`, which draw and update automatically, and
  `SSWebGLRenderer`, which you can wire into your own rendering loop.

## Entry points

All three are tree-shakeable (`sideEffects: false`), so a bundle carries only what you import:

| Import | Contents |
|---|---|
| `@spritestudio/ssplayer-webgl` | Everything, including `SSOverlay`, the shared texture cache and the Web Audio adapter (fetched only for a pack with sound). |
| `@spritestudio/ssplayer-webgl/lite` | The same `SSSurface`, `SSPlayer` and `SSWebGLRenderer`, exported without `SSOverlay`, `SSWebGLTextureCache` and `SSWebAudioManager`. |
| `@spritestudio/ssplayer-webgl/element` | The `<ss-player>` Custom Element. |

Importing `/element` does not register the tag, since that would be a side effect: call
`defineSSPlayerElement()` once. An app that never imports it does not carry it.

## Using the Web Component (`<ss-player>`)

The Custom Element is the quickest way to get started.

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  // Register the <ss-player> tag with the browser
  defineSSPlayerElement();
</script>

<!-- src = the ssab file, animation = the animation name to play -->
<ss-player 
  src="/assets/Ringo.ssab" 
  animation="run" 
  autoplay 
  speed-scale="1.0" 
  style="width: 640px; height: 480px;">
</ss-player>
```

### Attributes

| Attribute | |
|---|---|
| `src` | The `.ssab` to load. Setting it again loads another pack. |
| `animation` | The animation to start on; the first one in the pack when absent. |
| `autoplay` | Play as soon as the animation is set up. Absent, the element holds its first frame. |
| `speed-scale` | Playback speed as a multiple of the authored rate. |
| `fit` | How the animation is scaled to the element's box: `contain` (default), `cover` or `none`. `none` draws at the authored scale with the origin at the box's centre. |
| `align` | Which point of the animation's canvas lands on the matching point of the box: `center` (default), `top`, `bottom`, `left`, `right`, `top-left`, `top-right`, `bottom-left` or `bottom-right`. |
| `flip-x`, `flip-y` | Mirror the animation. `align` follows the mirror. |
| `standalone` | Draw on the element's own canvas and WebGL context. See below. |
| `max-dpr`, `power-preference`, `antialias`, `background`, `pause-when-hidden` | Configure a `standalone` element's context. Read once, at connect. |

`src`, `animation`, `speed-scale`, `fit`, `align`, `flip-x` and `flip-y` react when they change. An
element with the `hidden` attribute is not displayed. A `standalone` element has `pause-when-hidden` on by default:
playback stops while its canvas is off-screen or the tab is in the background, and
`pause-when-hidden="false"` keeps it running. An overlay element always stops while it is off-screen.

**Size and fit.** The box the animation is fitted to is its authored canvas — the canvas size set in
SpriteStudio — of the animation the pack was loaded on. It stays when `animation` changes, so a character
does not rescale between the animations of one pack. An element the page gives no size is as large as that
canvas, one canvas unit to a CSS pixel; given only a width, it takes the canvas's aspect ratio for its
height.

A failure — a `src` that does not load, an `animation` the pack does not have, a runtime that
will not start — is dispatched as an `error` event on the element (its `detail` is the error)
and logged with `console.error`.

The player's events are dispatched on the element as DOM `CustomEvent`s, so you can
`addEventListener` for them: `animationstarted`, `animationfinished`, `animationlooped`,
`userdata`, `signal` and `audio`, with the payload in `detail`, and `load` once a pack is set up.
The names are those of the player's `onAnimationStarted`, `onUserData` and the like, lower-cased.

**Overlay or standalone.** Browsers cap how many WebGL contexts a page may hold, so by default every
`<ss-player>` shares **one overlay canvas** laid over the page, and the element is only the
box the animation is drawn in. That makes any number of elements cheap, and it means the
element's own CSS does not shape the animation: `transform`, `filter`, `clip-path` and
`border-radius` on the element do not reach it, and it does not share the element's place
in the stacking order. Add `standalone` to give an element its own canvas, where all of those
apply — the choice for an element that needs a CSS effect, an opaque backdrop or its own stacking
context. The context options above configure that private context, so they have no
effect on an overlay element; the shared overlay takes its options from
`SSOverlay.getOrCreate('default', options)` (`SSOverlay` is exported from `@spritestudio/ssplayer-webgl`).
Call it before the first `<ss-player>` connects, because that element creates the overlay with none.
An element's `overlay="<id>"` attribute names another overlay, which costs another WebGL context.

To control it from JavaScript, `await el.ready`, then call `play()`, `pause()`, `resume()`, `stop()` or
`setAnimation(name)` on the element. The rest of the playback API in [Basic playback](/usage/basic)
is on `el.player`, the `SSPlayer` underneath.

The element deliberately carries only the playback verbs; everything else — including the
per-part overrides — is reached through `el.player`, the `SSPlayer` underneath:

```js
const el = document.querySelector('ss-player');
await el.ready;
el.player.setPartColorOverride('apple', 0x0033ffbf);
```

The part-transform read-out is reached the same way. This player has no scene graph, so
following a part means reading `el.player.getPartTransform()` from `onFrame()` and placing
your own element — see [Part tracking](/customize/part-following).

## Using SSSurface and SSPlayer directly

You can also initialize a player against a canvas directly from TypeScript /
JavaScript.

```ts
import { SSSurface } from '@spritestudio/ssplayer-webgl';

async function main() {
  await SSSurface.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  // autoStart runs the surface's draw loop (play() below starts the animation); the other options configure the WebGL context
  const surface = new SSSurface(canvas, { autoStart: true });
  const player = surface.createPlayer();
  await player.load('/assets/Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // fit the animation's canvas into the surface
  player.play();
}

main().catch(console.error);
```

`SSSurface` also takes an existing `WebGLRenderingContext` or `WebGL2RenderingContext` in place
of a canvas, so it can draw in a context your own renderer owns.

### Fitting into a box

A player draws into its `box` — the whole surface unless you set one. Without a placement it draws at the
authored scale with its origin at the box's centre. `setPlacement` fits it into the box instead, and keeps
it fitted as the box moves or resizes:

```ts
player.setPlacement({ fit: 'cover', align: 'bottom' }); // {} is contain and center
player.setTransform({ x: 8 });                          // added after the fit; its scale multiplies the fit's
player.setPlacement(null);                              // back to the authored scale
```

The box that is fitted is the authored canvas of the animation playing, so each animation is fitted by its
own canvas. To keep one scale across a pack, read `player.canvasRect` once, after the first `setAnimation`,
and pass it as `frame`: `const frame = player.canvasRect; if (frame) player.setPlacement({ frame });` (`canvasRect` is `null` until an animation is set up).

## Without a bundler (CDN)

The package also ships browser builds you can load straight from a CDN. **The one thing to do by
hand is point the loader at the WASM binary**: the runtime is a separate `.wasm` file, and outside
a bundler nothing resolves its path for you.

::: warning Copy the URL pair as printed
The `.wasm` and the JS that loads it share an ABI, so both URLs carry an exact version — a floating
`@latest` on one can desync it from the other. The two versions need not be equal, since the
packages are released independently: `ssplayer-webgl@7.0.1` may pair with `ssplayer-core@7.0.0`.
The snippets below are rewritten from the published packages on every release, so a pair as
printed always works together.
:::

### `<ss-player>` with no JavaScript

A self-registering bundle defines `<ss-player>` as it loads, so animations play straight from
markup. A classic `<script>` cannot locate the runtime by itself, so give the WASM URL once for the
page with `data-wasm`, and copy both lines together:

```html
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ss-player.element.min.js"
        data-wasm="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm"></script>

<ss-player src="chara.ssab" animation="run"  autoplay style="width:640px;height:480px"></ss-player>
<ss-player src="boss.ssab"  animation="idle" autoplay style="width:640px;height:480px"></ss-player>
```

There are three ways to give the WASM URL. The runtime starts once per page, with the URL the first `<ss-player>` to connect finds: its own `wasm="…"` if it has one, otherwise the page default set by 1 or 2 (a later call replaces an earlier one). Elements that connect afterwards reuse the runtime already started, whatever their `wasm` says.

1. **`data-wasm` on the script tag** — the page default, once, as above.
2. **`SSWebGLPlayerElement.setSSPlayerWasmUrl(url)`** — the page default, once in JavaScript, before the elements connect.
3. **`wasm="…"` on a `<ss-player>`** — wins over the page default when that element is the first to connect.

Leave it out and nothing renders, but not silently: the console shows
`[ss-player] WebAssembly runtime failed to initialise` and the URL it needs. With a bundler you do
not need this bundle — import `/element` and call `defineSSPlayerElement()`.

### Classic `<script>` — global `SSWebGLPlayer`

There are no peer dependencies to load first. The surface class is `SSWebGLPlayer.SSSurface`.

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
      autoStart: true,
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

### ESM from a CDN — `<script type="module">`

Native modules with no build step, from an ESM CDN (esm.sh here). The same rule applies: pass the
WASM URL.

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script type="module">
  import { SSSurface } from 'https://esm.sh/@spritestudio/ssplayer-webgl@7.0.0-beta.1';

  await SSSurface.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const surface = new SSSurface(document.getElementById('stage'), { autoStart: true, backgroundColor: 0x1a1a2e });
  const player = surface.createPlayer();
  await player.load('./Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // fit the animation's canvas into the surface
  player.play();
</script>
```

Runnable copies of the `<ss-player>` and classic `<script>` versions are in
[`examples/cdn`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/examples/cdn)
(`ss-player.html` and `webgl.html`).
