[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi

PixiJS v8 renderer for the **SpriteStudio 7** player. High-performance **direct drawing** (batched meshes) driven by a Rust/WebAssembly core.

> **Who this is for:** app developers already building on PixiJS v8 who want to play SpriteStudio `.ssab` animations in their app.
> **Install:** `npm install @spritestudio/ssplayer-pixi@beta pixi.js` (needs `pixi.js@^8` as a peer dependency)
> **Not what you need?** → [ssplayer-webgl](../ssplayer-webgl/README.md) if you're not on Pixi, or [ssplayer-core](../ssplayer-core/README.md) to build your own renderer.

> **Beta line.** While 7.0.0 is in prerelease the packages publish under the `beta` dist-tag only, so the `@beta` above is required; it becomes optional once 7.0.0 ships to `latest`.

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

## Install

```bash
npm install @spritestudio/ssplayer-pixi@beta pixi.js
```

`pixi.js` (v8) is a **peer dependency** — install it alongside the player if your app
doesn't already depend on it.

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
player.attachRenderer(app.renderer); // optional — see the mask note below
await player.load('/Ringo.ssab');   // textures load from the .ssab's own directory
await player.setAnimation('run');   // loop = -1 (infinite) by default

player.position.set(640, 480);
app.stage.addChild(player);

player.play();
```

> **`attachRenderer` and masks.** Mask / clipping parts are drawn through an
> offscreen coverage pass, which needs a renderer — and the player is only handed
> one when it is first drawn. Without `attachRenderer` the parts a mask governs are
> therefore held back for exactly one frame (never drawn unclipped), and masking is
> correct from the second. Pass the renderer up front and it is correct from the
> first frame. Animations without masks render identically either way, so this is
> only worth doing if you have any.

> **Reference *and* embedded ssab both work.** `load()` handles either variant:
> an ssab that references external texture files (fetched as sibling PNGs), or one
> converted with `--embedded`, whose textures are inlined and decoded straight from
> the binary — no sibling fetch, so the whole animation loads as a single
> self-contained request. Verified against both in `examples/pixi-example`.

## Use from a CDN (no build step)

Don't want a bundler? This package also ships a browser build you can load straight
from a CDN. **The one thing you must do by hand is point the loader at the WASM
binary.** The runtime is a separate `.wasm` file, and outside a bundler (a classic
`<script>`, or any CDN context) the automatic path resolution bundlers rely on
isn't available — so pass its URL to `SSPlayer.initialize(wasmUrl)`.

> **Pin the WASM to the same version as the player you load.** The `.wasm` and its
> JS glue share an ABI, so a floating `@latest` on one and a pinned version on the
> other can desync. Use an exact version (e.g. `@7.0.0-beta.1`) on **both** the
> `ssplayer-pixi` bundle and the `ssplayer-core` `.wasm`.

### Classic `<script>` — global `SSPixiPlayer`

`pixi.js` is a peer dependency, so load Pixi's own global build first; the player
bundle reads `window.PIXI`. The renderer class is `SSPixiPlayer.SSPlayer`.

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
    await player.setAnimation('run');
    player.position.set(640, 480);
    app.stage.addChild(player);
    player.play();
  })();
</script>
```

### ESM via CDN — `<script type="module">`

Prefer native modules without a build step? Import from an ESM CDN (esm.sh below).
Same rule: pass the WASM URL explicitly.

```html
<script type="module">
  import { Application } from 'https://esm.sh/pixi.js@8';
  import { SSPlayer } from 'https://esm.sh/@spritestudio/ssplayer-pixi@7.0.0-beta.1';

  await SSPlayer.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const app = new Application();
  await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
  document.body.appendChild(app.canvas);

  const player = new SSPlayer();
  await player.load('./Ringo.ssab');
  await player.setAnimation('run');
  player.position.set(640, 480);
  app.stage.addChild(player);
  player.play();
</script>
```

A runnable copy of both is in [`examples/cdn`](../../examples/cdn/).

## Playback API (excerpt)

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

player.frame;                       // get/set the current frame
player.speedScale = 1.5;            // playback speed multiplier
player.loopCount;                   // configured loop count (-1 = infinite)
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

Run the bundled PixiJS example to see the renderer in action — handy when
customising the source or verifying a fix:

```bash
cd examples/pixi-example
pnpm run dev             # start the dev server
```

The example consumes the **built** package via a workspace reference, so re-run
`pnpm run build` from the repo root after editing `src/` here.
