[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-webgl

Lightweight, zero-dependency **WebGL1/2** renderer for the **SpriteStudio** player, driven by a Rust/WebAssembly core — with a drop-in **`<ss-player>` custom element** for declarative, zero-JavaScript use.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](https://cri-middleware.github.io/SSPlayerForWeb/); the same pages for this version are in this package's `docs/` (start at `docs/README.md`), readable offline, and in `skills/ssplayer-webgl/` as an Agent Skill, which pnpm 12.11 or later links into your coding agent's skills directory after `pnpm approve @spritestudio/ssplayer-webgl`.

> **Who this is for:** web developers with no framework — drop a SpriteStudio player into any page, either as a single `<ss-player>` HTML tag or via the `SSPlayer` JS API, with zero runtime dependencies.
> **Install:** `npm install @spritestudio/ssplayer-webgl`
> **Not what you need?** → [package table](../../README.md#-which-package-should-i-use) — already on PixiJS or RPG Maker MZ? there's a dedicated renderer for that.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** —
the `<ss-player>` element running in your browser; drop your own `.ssab` file onto the
page to play it.

## ✨ Why SpriteStudio with plain WebGL?

- **Artist-made animation, no animation code.** Breathing characters, swaying hair, slash and magic effects — an artist builds them visually in a dedicated 2D editor (SpriteStudio), with bone rigs, mesh deformation and particles over the PNG / WebP art you already have. This player just plays the exported `.ssab`.
- **One HTML tag — or full control from JS.** `<ss-player src="chara.ssab" animation="idle" autoplay>` plays it with no build step and no JavaScript, in plain HTML or inside any framework. From code, `SSPlayer` drives the same renderer — with timeline event callbacks, per-part overrides at runtime, and crossfading or track layering between animations.
- **Whole scenes — banners, splashes, cut-ins.** Characters, backgrounds, effects and UI composed on one timeline play back as a single animation from a single `.ssab`.
- **A lighter alternative to `<video>`.** It scales freely, loops seamlessly and reacts to input, and **sub-frame interpolation** (on by default) renders at the display's refresh rate instead of a clip's baked frame rate.
- **Fits tight embed slots.** Zero dependencies, a plain `<canvas>`, and one self-contained `.ssab` with its textures embedded. When bytes are the budget, the `./lite` build leaves out `SSOverlay`, the shared texture cache and the audio adapter, which the full build loads only for an animation that has sound.

## Quick start

**Using it in your app?** Read on — install, convert, play. Everything after that (events,
per-part overrides, textures) is the same path further in, in the
[WebGL guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/webgl).
**Working on the renderer?** [For contributors](#for-contributors--building-from-source) below, then [CONTRIBUTING.md](../../CONTRIBUTING.md).

1. **Install** with `npm install @spritestudio/ssplayer-webgl` — or, with no bundler, load it
   from a CDN: [the snippets](https://cri-middleware.github.io/SSPlayerForWeb/usage/webgl#without-a-bundler-cdn).
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

3. **Play** it — with the `<ss-player>` element:

   ```ts
   import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
   defineSSPlayerElement();   // registers the <ss-player> tag (once per app)
   ```

   ```html
   <ss-player src="/Ringo/Ringo.ssab" animation="run" autoplay style="width:640px;height:480px"></ss-player>
   ```

   or from code, on a canvas of your own:

   ```ts
   import { SSSurface } from '@spritestudio/ssplayer-webgl';

   await SSSurface.initialize();   // once for the whole app
   const surface = new SSSurface(document.querySelector('canvas')!, { autoStart: true });
   const player = surface.createPlayer();
   await player.load('/Ringo/Ringo.ssab');   // textures load from the .ssab's own directory
   player.setAnimation('run');
   player.setPlacement({});   // fit the animation's canvas into the surface
   player.play();
   ```

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with.

**Read next:** [WebGL guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/webgl) · [Basic playback](https://cri-middleware.github.io/SSPlayerForWeb/usage/basic) ·
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

Run the bundled WebGL example to see the renderer (and the `<ss-player>` element)
in action — handy when customising the source or verifying a fix:

```bash
pnpm run deploy-examples   # once: converts the SDK's sample projects into examples/*/public (not tracked in git)
cd examples/webgl-example
pnpm run dev             # start the dev server
```

(`pnpm run example` does this and every earlier step for you.)

The example consumes the **built** package via a workspace reference, so re-run
`pnpm run build` from the repo root after editing `src/` here.
