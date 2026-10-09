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
pnpm add @spritestudio/ssplayer-webgl@beta
```

## Highlights

- **No dependencies**: works on its own, with no external library such as PixiJS or
  Three.js.
- **Web Components**: ships a Custom Element, so you can add `<ss-player>` to your HTML
  and play an animation without writing any JavaScript.
- Provides `SSSurface` + `SSPlayer`, which draw and update automatically, and
  `SSWebGLRenderer`, which you can wire into your own rendering loop.

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
element with the `hidden` attribute is not displayed.

**Size and fit.** The box the animation is fitted to is its authored canvas — the canvas size set in
SpriteStudio — of the animation the pack was loaded on. It stays when `animation` changes, so a character
does not rescale between the animations of one pack. An element the page gives no size is as large as that
canvas, one canvas unit to a CSS pixel; given only a width, it takes the canvas's aspect ratio for its
height.

A failure — a `src` that does not load, an `animation` the pack does not have, a runtime that
will not start — is dispatched as an `error` event on the element (its `detail` is the error)
and logged with `console.error`.

**Overlay or standalone.** Browsers cap how many WebGL contexts a page may hold, so by default every
`<ss-player>` shares **one overlay canvas** laid over the page, and the element is only the
box the animation is drawn in. That makes any number of elements cheap, and it means the
element's own CSS does not shape the animation: `transform`, `filter`, `clip-path` and
`border-radius` on the element do not reach it, and it does not share the element's place
in the stacking order. Add `standalone` to give an element its own canvas, where all of those
apply — the choice for an element that needs a CSS effect, an opaque backdrop or its own stacking
context. The context options above configure that private context, so they have no
effect on an overlay element; the shared overlay takes its options from
`SSOverlay.getOrCreate(id, options)`.

To control it from JavaScript, grab the DOM element and call `play()` or `stop()`. See
[Basic playback](/usage/basic) for the full API.

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

  // Options let you enable autoplay or configure the WebGL context
  const surface = new SSSurface(canvas, { autoStart: true });
  const player = surface.createPlayer();
  await player.load('/assets/Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // fit the animation's canvas into the surface
  player.play();
}

main().catch(console.error);
```

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
and pass it as `frame`: `player.setPlacement({ frame: player.canvasRect })`.
