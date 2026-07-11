# WebGL & Web Components

`@spritestudio/ssplayer-webgl` is a standalone WebGL 1/2 renderer with no dependency on
an external rendering engine such as PixiJS. It suits setups that want to keep
dependencies and file size low — ad banners, simple web pages — and drops straight into
frameworkless pages.

## Install

It is published on npm.

```bash
pnpm add @spritestudio/ssplayer-webgl
```

## Highlights

- **No dependencies**: works on its own, with no external library such as PixiJS or
  Three.js.
- **Web Components**: ships a Custom Element, so you can add `<ss-player>` to your HTML
  and play an animation without writing any JavaScript.
- Provides `SSCanvasPlayer`, which draws and updates automatically, and
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
  speed="1.0" 
  style="width: 640px; height: 480px;">
</ss-player>
```

To control it from JavaScript, grab the DOM element and call `play()` or `stop()`. See
[Basic playback](/usage/basic) for the full API.

## Using SSCanvasPlayer directly

You can also initialize a player against a canvas directly from TypeScript /
JavaScript.

```ts
import { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';

async function main() {
  await SSCanvasPlayer.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  // Options let you enable autoplay or configure the WebGL context
  const player = new SSCanvasPlayer(canvas, { autoStart: true });
  await player.load('/assets/Ringo.ssab');
  await player.setAnimation('run');
  player.play();
}

main().catch(console.error);
```
