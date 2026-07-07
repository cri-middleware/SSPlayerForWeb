[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi

PixiJS v8 renderer for the **SpriteStudio 7** player. High-performance **direct drawing** (batched meshes) driven by a Rust/WebAssembly core.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](../../docs/).

## ✨ Why SpriteStudio with PixiJS?

- **Pixi renders; it doesn't author animation.** Anything past `AnimatedSprite`
  and spritesheets — bone rigs, mesh deformation, particle effects — means
  hand-building an animation system or reaching for another runtime. SpriteStudio 7
  is that dedicated 2D editor, and this player drops the finished animation
  straight onto your stage.
- **A whole scene, not just a character.** Compose characters, backgrounds,
  effects, and UI on one timeline in the editor, then bring the entire cutscene or
  full-screen sequence into your Pixi stage as a single animation — not just one
  rigged sprite.
- **Zero-friction integration.** `SSPlayer` **is** a Pixi `Container` and
  self-drives from `Ticker.shared` — no bespoke per-frame `update()`. It draws
  through Pixi's own BatchRenderer (direct / batched meshes), so it batches
  alongside the rest of your scene at full performance.
- **Your existing art, plus game hooks.** The PNG / WebP art you already have
  animates as-is, and timeline events (`onUserData` / `onSignal` / `onAudio`)
  surface as callbacks you wire straight into game logic.
- **Smooth at any refresh rate.** Playback is **sub-frame interpolated** (on by
  default), rendering each frame at its exact display time — so motion stays fluid
  on 120Hz+ displays and in slow motion, instead of snapping to integer frames.

## Quick start

Load the WASM once, create an `SSPlayer`, add it to the stage, and `play()`:

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
app.stage.addChild(player);

player.play();
```

> **Reference *and* embedded ssab both work.** `load()` handles either variant:
> an ssab that references external texture files (fetched as sibling PNGs), or one
> converted with `--embedded`, whose textures are inlined and decoded straight from
> the binary — no sibling fetch, so the whole animation loads as a single
> self-contained request. Verified against both in `examples/pixi-example`.

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
player.onAudio((e) => console.log('audio', e.soundName));  // notification hook — audio also plays by default (see below)
player.onAnimationEnd(() => {});
player.onAnimationLoop(() => {});

off(); // stop listening
```

**Audio just works by default.** When a loaded `.ssab` contains sounds and you
haven't set `player.audioManager`, `load()` attaches a default `SSWebAudioManager`
that plays them — no consumer code needed. To customise or replace playback,
assign your own `IAudioManager` to `player.audioManager` **before** `load()` (the
default is only attached when none is set). `onAudio` fires either way, so you can
also drive sound entirely yourself.

## Working from source

WASM binaries are **not tracked in git**. From the repo root, obtain the WASM,
then build the packages:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

## Try your changes

Run the bundled PixiJS example to see the renderer in action — handy when
customising the source or verifying a fix:

```bash
cd examples/pixi-example
pnpm run dev             # start the dev server
```

The example consumes the **built** package via a workspace reference, so re-run
`pnpm run build` from the repo root after editing `src/` here.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
