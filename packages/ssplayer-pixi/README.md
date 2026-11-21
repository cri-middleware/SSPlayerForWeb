[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi

PixiJS v8 renderer for the **SpriteStudio** player. High-performance **direct drawing** (batched meshes) driven by a Rust/WebAssembly core.

> **Who this is for:** app developers already building on PixiJS v8 who want to play SpriteStudio `.ssab` animations in their app.
> **Install:** `npm install @spritestudio/ssplayer-pixi pixi.js` (needs `pixi.js@^8.19` as a peer dependency)
> **Not what you need?** → [ssplayer-webgl](../ssplayer-webgl/README.md) if you're not on Pixi, or [ssplayer-core](../ssplayer-core/README.md) to build your own renderer.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — a
PixiJS v8 app playing `.ssab`; drop your own file onto the page to play it.

🎨 **[Part override demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** —
per-part colour / cell / visibility overrides at runtime (source in
`examples/override-example`).

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](https://cri-middleware.github.io/SSPlayerForWeb/); the same pages for this version are in this package's `docs/` (start at `docs/README.md`), readable offline, and in `skills/ssplayer-pixi/` as an Agent Skill; [Docs for Your Assistant](https://cri-middleware.github.io/SpriteStudio-Docs/ai/docs/#-as-an-agent-skill) says how your package manager links it into your coding agent's skills directory.

## ✨ Why SpriteStudio with PixiJS?

- **Pixi renders; SpriteStudio animates.** Past `AnimatedSprite` and spritesheets — bone rigs, mesh deformation, particle effects — you would be hand-building an animation system. SpriteStudio is a dedicated 2D editor where an artist builds that motion over the PNG / WebP art you already have, and this player drops the result onto your stage.
- **Whole scenes, not just a character.** Characters, backgrounds, effects and UI composed on one timeline arrive on your stage as a single animation — a cutscene or a full-screen sequence.
- **Just a Pixi `Container`.** `SSPlayer` drives itself from `Ticker.shared` — no per-frame `update()` to write — and draws through Pixi's own batching, alongside the rest of your scene.
- **Game hooks, overrides and motion blending.** Events the artist placed arrive as callbacks (`onUserData` / `onSignal` / `onAudio`) that you wire straight into game logic, per-part overrides swap colour, cell or visibility at runtime, and animations crossfade or layer across tracks.
- **Smooth at any refresh rate.** **Sub-frame interpolation** (on by default) renders each frame at its exact display time, so motion stays fluid on 120 Hz+ displays and in slow motion.

## Quick start

**Using it in your app?** Read on — install, convert, play. Everything after that (events,
per-part overrides, textures) is the same path further in, in the
[PixiJS guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi).
**Working on the renderer?** [For contributors](#for-contributors--building-from-source) below, then [CONTRIBUTING.md](../../CONTRIBUTING.md).

1. **Install** with `npm install @spritestudio/ssplayer-pixi pixi.js` — `pixi.js` v8 is a peer
   dependency. With no bundler, load both from a CDN:
   [the snippets](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi#without-a-bundler-cdn).
2. **Convert** your `.sspj` (SpriteStudio 7.6 or later) in the browser with
   [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/): drop the project folder on it and extract the ZIP it
   downloads into the folder your app serves as-is — Vite's `public/`, for example. The `.ssab`
   loads its textures from beside it; check **Embedded Assets** to carry them inside instead
   ([Preparing assets](https://cri-middleware.github.io/SSPlayerForWeb/usage/assets)).

   ```
   public/
   └── Ringo/            ← the folder in the ZIP
       ├── Ringo.ssab
       └── Ringo.png
   ```

3. **Play** it — an `SSPlayer` is a Pixi `Container` that drives itself from `Ticker.shared`:

   ```ts
   import { Application } from 'pixi.js';
   import { SSPlayer } from '@spritestudio/ssplayer-pixi';

   await SSPlayer.initialize();   // once for the whole app

   const app = new Application();
   await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
   document.body.appendChild(app.canvas);

   const player = new SSPlayer();
   player.attachRenderer(app.renderer);   // optional: masks right from the first frame
   await player.load('/Ringo/Ringo.ssab');      // textures load from the .ssab's own directory
   player.setAnimation('run');
   player.position.set(640, 730);         // Ringo's origin is at its feet
   app.stage.addChild(player);
   player.play();
   ```

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with.

**Read next:** [PixiJS guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi) · [Basic playback](https://cri-middleware.github.io/SSPlayerForWeb/usage/basic) ·
[Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations)

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
pnpm run deploy-examples   # once: converts the SDK's sample projects into examples/*/public (not tracked in git)
cd examples/pixi-example
pnpm run dev             # start the dev server
```

(`pnpm run example` does this and every earlier step for you.)

The example consumes the **built** package via a workspace reference, so re-run
`pnpm run build` from the repo root after editing `src/` here.
