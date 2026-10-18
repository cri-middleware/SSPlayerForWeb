---
description: The minimum code to play a .ssab with ssplayer-webgl or ssplayer-pixi, and the common pitfalls.
---

# Quick start

Here is the minimum code to play a `.ssab`. Both the dependency-free `ssplayer-webgl`
and the PixiJS v8 `ssplayer-pixi` paths are shown — pick the one that fits your setup.

::: tip No SpriteStudio data of your own yet?
The [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is Japanese only, but the downloads themselves are
language-neutral. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good
character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one
if you want effects.
:::

## ssplayer-webgl (no dependencies)

The simplest option is the `<ss-player>` Web Component, which plays back with almost no
JavaScript.

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  // Register the <ss-player> tag with the browser
  defineSSPlayerElement();
</script>

<!-- src points to the ssab file, animation names the animation to play -->
<ss-player
  src="/Ringo/Ringo.ssab"
  animation="run"
  autoplay
  style="width: 640px; height: 480px;">
</ss-player>
```

To supply your own canvas and drive playback yourself, use `SSPlayer`.

```ts
import { SSSurface } from '@spritestudio/ssplayer-webgl';

async function main() {
  // Initialize the WASM runtime once for the whole app
  await SSSurface.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  const surface = new SSSurface(canvas, { autoStart: true });
  const player = surface.createPlayer();
  await player.load('/Ringo/Ringo.ssab');   // textures load from the .ssab's own directory
  player.setAnimation('run');    // loopCount defaults to -1 (infinite)
  player.setPlacement({});       // fit the animation's canvas into the surface
  player.play();
}

main().catch(console.error);
```

## ssplayer-pixi (PixiJS v8)

`SSPlayer` extends the PixiJS `Container` and updates **automatically** from
`Ticker.shared`. Just add it to the stage and call `play()` — no per-frame `update()`
is needed.

```ts
import { Application } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';

async function main() {
  // 1. Initialize the WASM runtime once for the whole app
  await SSPlayer.initialize();

  const app = new Application();
  await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
  document.body.appendChild(app.canvas);

  // 2. Create the player, load the .ssab, and select an animation
  const player = new SSPlayer();
  await player.load('/Ringo/Ringo.ssab');   // textures load from the .ssab's own directory
  player.setAnimation('run');    // loopCount defaults to -1 (infinite)

  player.position.set(640, 730);   // Ringo's origin is at its feet
  app.stage.addChild(player);

  // 3. Start playback
  player.play();
}

main().catch(console.error);
```

## Common pitfalls

- **Call `initialize()` only once**: initializing the WASM runtime once at app startup
  is enough (`SSSurface.initialize()` / `SSPlayer.initialize()`).
- **Don't call `update()` with Pixi**: `SSPlayer` is registered with `Ticker.shared`
  automatically.
- **No `.ssab`**: see [Preparing assets](/usage/assets) for converting from `.sspj`.
- **Textures don't appear**: textures load from the `.ssab`'s own directory — make sure
  the texture files sit next to the `.ssab` (or use an `--embedded` `.ssab`).

Next, explore the playback-control API in [Basic playback](/usage/basic).
