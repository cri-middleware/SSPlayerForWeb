# Quick start

Here is the minimum code to play a `.ssab`. Both the dependency-free `ssplayer-webgl`
and the PixiJS v8 `ssplayer-pixi` paths are shown — pick the one that fits your setup.

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
  src="/Ringo.ssab"
  animation="run"
  autoplay
  style="width: 640px; height: 480px;">
</ss-player>
```

To supply your own canvas and drive playback yourself, use `SSCanvasPlayer`.

```ts
import { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';

async function main() {
  // Initialize the WASM runtime once for the whole app
  await SSCanvasPlayer.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  const player = new SSCanvasPlayer(canvas, { autoStart: true });
  await player.load('/Ringo.ssab');   // 2nd arg sets the texture assetBaseUrl
  await player.setAnimation('run');    // loop defaults to -1 (infinite)
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
  await player.load('/Ringo.ssab');   // 2nd arg sets the texture assetBaseUrl
  await player.setAnimation('run');    // loop defaults to -1 (infinite)

  player.position.set(640, 480);
  app.stage.addChild(player);

  // 3. Start playback
  player.play();
}

main().catch(console.error);
```

## Common pitfalls

- **Call `initialize()` only once**: initializing the WASM runtime once at app startup
  is enough (`SSCanvasPlayer.initialize()` / `SSPlayer.initialize()`).
- **Don't call `update()` with Pixi**: `SSPlayer` is registered with `Ticker.shared`
  automatically.
- **No `.ssab`**: see [Preparing assets](/usage/assets) for converting from `.sspj`.
- **Textures don't appear**: check the base URL for textures via the 2nd argument of
  `load(url, assetBaseUrl)`.

Next, explore the playback-control API in [Basic playback](/usage/basic).
