---
description: The renderer for apps already built on PixiJS v8, which draws many characters together with batched Direct Drawing.
---

# PixiJS

`@spritestudio/ssplayer-pixi` is the renderer for apps already built on **PixiJS v8**.
It uses **Direct Drawing (batch rendering)** to draw large numbers of characters
together.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — a PixiJS
v8 app playing several animations; drop a `.ssab` onto it to play your own.

🎨 **[Part override demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** —
the same renderer swapping a part's colour, cell and visibility at runtime (see
[Part control](../customize/part-overrides.md)).

## Install

```bash
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

`pixi.js@^8.19` is a peer dependency.

## Highlights

- `SSPlayer` extends PixiJS's `Container`, so the usual Pixi APIs — `position`,
  `scale`, `eventMode`, and so on — work as they normally do.
- It registers itself with `Ticker.shared`, so **you don't need to call `update()`
  every frame**.
- Dispose of it with `player.destroy()`, which also frees the WASM-side resources.

For minimal code see [Quick Start](../setup/quickstart.md); for playback control see
[Basic playback](./basic.md). To make a display object of your own (a weapon, effect or
hitbox) follow a part every frame, see [Part tracking](../customize/part-following.md). To recolour,
hide or re-cell a single part at run time, see
[Part control](../customize/part-overrides.md) — `SSPlayer` carries the same override methods as the
WebGL player, and re-renders the current frame when one is set while playback is stopped.

To make an animation a button — its labels playing hover, pressed, disabled and focus, and its parts
taking the pointer — see [UI buttons (PixiJS)](./pixi-ui.md).

## Masks on the first frame

Mask and clipping parts are drawn through an offscreen pass that needs the renderer, and a player
is handed the renderer only when it is first drawn. Until then, the parts a mask governs are held
back for one frame — never drawn unclipped — and masking is right from the second. To have it right
from the first, pass the renderer before loading:

```ts
player.attachRenderer(app.renderer);
```

An animation without masks draws the same either way.

## Blend modes and background

SpriteStudio's "read the background" blend modes (Screen / Exclusion / Invert) are
implemented as fixed-function GPU blends that read the actual framebuffer. That means
the `Application`'s `backgroundColor` becomes the background they composite against. See
[Shaders & blend modes](../customize/shaders.md) for details.

## Without a bundler (CDN)

The package also ships browser builds you can load straight from a CDN. **The one thing to do by
hand is point the loader at the WASM binary** with `SSPlayer.initialize(wasmUrl)`: the runtime is a
separate `.wasm` file, and outside a bundler nothing resolves its path for you.

::: warning Copy the URL pair as printed
The `.wasm` and the JS that loads it share an ABI, so both the `ssplayer-pixi` bundle and the
`ssplayer-core` `.wasm` carry an exact version — a floating `@latest` on one can desync it from the
other. The two versions need not be equal, since the packages are released independently; a pair
as printed always works together.
:::

### Classic `<script>` — global `SSPixiPlayer`

`pixi.js` is a peer dependency, so load Pixi's own global build first: the player bundle reads
`window.PIXI`. The player class is `SSPixiPlayer.SSPlayer`.

```html
<script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-pixi@7.0.0-beta.1/dist/browser/ssplayer-pixi.browser.min.js"></script>
<script>
  const { SSPlayer } = SSPixiPlayer;
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm';

  (async () => {
    // Pass the explicit WASM URL — no bundler means no automatic resolution.
    await SSPlayer.initialize(WASM_URL);

    const app = new PIXI.Application();
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
    document.body.appendChild(app.canvas);

    const player = new SSPlayer();
    await player.load('./Ringo.ssab');   // serve over http(s), not file://
    player.setAnimation('run');
    player.position.set(640, 730);   // Ringo's origin is at its feet
    app.stage.addChild(player);
    player.play();
  })();
</script>
```

### ESM from a CDN — `<script type="module">`

Native modules with no build step, from an ESM CDN (esm.sh here). The same rule applies: pass the
WASM URL. The import also names the runtime's version with `?deps=`: without it, esm.sh serves the
newest `ssplayer-core` in the range the player declares, which can be a later one than the WASM.

```html
<script type="module">
  import { Application } from 'https://esm.sh/pixi.js@8';
  import { SSPlayer } from 'https://esm.sh/@spritestudio/ssplayer-pixi@7.0.0-beta.1?deps=@spritestudio/ssplayer-core@7.0.0-beta.1';

  await SSPlayer.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const app = new Application();
  await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
  document.body.appendChild(app.canvas);

  const player = new SSPlayer();
  await player.load('./Ringo.ssab');
  player.setAnimation('run');
  player.position.set(640, 730);   // Ringo's origin is at its feet
  app.stage.addChild(player);
  player.play();
</script>
```

A runnable copy of the classic `<script>` version is
[`examples/cdn/pixi.html`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/cdn/pixi.html).
