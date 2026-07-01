# @spritestudio/ssplayer-pixi

PixiJS v8 renderer for the **SpriteStudio 7** player. High-performance **direct drawing** (batched meshes) driven by a Rust/WebAssembly core.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](../../docs/).

## Install

```bash
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

`pixi.js@^8.19` is a **peer dependency**. This package re-exports everything from
`@spritestudio/ssplayer-core`, so you don't need to depend on the core directly.

## Quick start

`SSPlayer` **is** a PixiJS `Container` and drives itself from `Ticker.shared` —
just add it to the stage and call `play()`. No manual per-frame `update()`.

```ts
import { Application } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';

// 1. Load the WASM runtime once for the whole app.
await SSPlayer.initialize();

const app = new Application();
await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
document.body.appendChild(app.canvas);

// 2. Create a player, load a .ssab, and pick an animation.
const player = new SSPlayer();
await player.load('/Ringo.ssab');   // optional 2nd arg: assetBaseUrl for textures
await player.setAnimation('run');   // loop = -1 (infinite) by default

player.position.set(640, 480);
player.subframe = true;             // smooth sub-frame interpolation
app.stage.addChild(player);

player.play();
```

## Playback API (excerpt)

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

player.frame;                       // get/set the current frame
player.speedScale = 1.5;            // playback speed multiplier
player.loopCount;                   // number of completed loops
player.totalFrames; player.startFrame; player.endFrame; player.fps;
player.isPlaying; player.isPausing;

player.setAnimationSection(start, end);
player.setPlaybackDirection(direction, style);
player.getPartsCount();
player.getPartIndexFromName('body');
```

## Events

Timeline events are fired by the runtime each frame. Every subscription returns
an unsubscribe function.

```ts
const off = player.onUserData((e) => console.log('userData', e.partName));
player.onSignal((e) => console.log('signal', e.commandId));
player.onAudio((e) => playSound(e.soundName));  // the runtime never plays audio itself
player.onAnimationEnd(() => {});
player.onAnimationLoop(() => {});

off(); // stop listening
```

Audio is delegated to the host: assign any `IAudioManager` implementation to
`player.audioManager` and handle `onAudio` yourself.

## Working from source

WASM binaries are **not tracked in git**. From the repo root:

```bash
pnpm run build:wasm   # build the ssruntime WASM (needs Rust)
pnpm run build        # build all TS packages
```

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
