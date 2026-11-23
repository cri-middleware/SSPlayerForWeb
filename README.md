[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for Web

**Professional 2D animation for the Web — authored by an artist, played in any page or app.**

A high-performance player for **[SpriteStudio](https://www.webtech.co.jp/eng/spritestudio/)** animations (`.ssab`) on the Web.

## ✨ Why use SpriteStudio on the Web?

- **Bring your sprites — and whole scenes — to life.** Breathing and blinking, swaying hair and clothes, flashy slash and magic effects: the motion is built visually in a dedicated editor (SpriteStudio) with bone rigs, mesh deformation and particles, and the browser just plays the exported `.ssab`. Combine characters, backgrounds, effects and UI on one timeline to play a banner, splash screen or cutscene as a single animation.
- **A lighter, interactive alternative to `<video>`.** It animates the raster sprite art you already have (PNG / WebP), so painted characters move exactly as drawn. Unlike a `.gif` or an `.mp4`, it scales freely, loops seamlessly, reacts to user input, and renders with **sub-frame interpolation** (on by default) at the display's refresh rate rather than a baked-in frame rate.
- **Fits your stack — from an HTML tag to PixiJS and game engines.** Drop a zero-dependency `<ss-player>` tag into any page, add an `SSPlayer` container that batches with your PixiJS v8 stage or a `@pixi/ui` button drawn by an animation, or set up a code-free plugin in a game engine's editor — the table below matches each environment to its package.
- **Connected to your app or game logic.** Timeline keys placed by the artist (user data, signals, audio cues) arrive as callbacks, per-part overrides swap a part's colour, cell or visibility at runtime, and animations crossfade or layer across tracks.
- **One WebAssembly core, zero-parse loading, and browser-side conversion.** `.ssab` is a FlatBuffers binary read in place, and poses come from the SDK's SIMD-optimised Rust core compiled to WebAssembly — the same core every official SpriteStudio player uses. And [`ssconverter-core`](./packages/ssconverter-core) (WASM) converts `.sspj` → `.ssab` right in the browser, Node, or an editor plugin — no native toolchain needed.

## 🌐 Try it live

No install — these run entirely in your browser:

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — convert `.sspj` → `.ssab` entirely client-side (start here)
- ▶️ **[Standalone WebGL example](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — zero-dependency standalone renderer (the `<ss-player>` Web Component). *Supports D&D of `.ssab` files.*
- ▶️ **[PixiJS example](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — for PixiJS v8 apps. *Supports D&D of `.ssab` files.*
- ▶️ **[RPG Maker MZ example](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — a sample MZ project (SpriteStudio pictures)
- ▶️ **[TyranoScript example](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** — a visual-novel scene driven by `[ss_*]` tags
- 🎨 **[Part override example](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** — swap a part's colour, cell or visibility at runtime (PixiJS)
- 📂 **[.sspj preview](https://cri-middleware.github.io/SSPlayerForWeb/examples/sspj-preview/)** — drop a `.sspj` folder to convert and play it in the same tab, with a seek bar and clickable event markers (WebGL or PixiJS)

## 📚 Documentation

Comprehensive documentation lives in the `docs/` folder (hosted via VitePress) and is structured step-by-step according to what you want to do:

- [**Documentation site (hosted)**](https://cri-middleware.github.io/SSPlayerForWeb/)
- [**Documentation (English)**](./docs/index.md) · [**日本語ドキュメント**](./docs/ja/index.md)
- [**For AI assistants**](https://cri-middleware.github.io/SSPlayerForWeb/llms.txt) — these docs as Markdown: `llms.txt` indexes the English pages and `llms-full.txt` holds all of them in one file; each Japanese page is available as `.md` under `ja/`; each npm package carries the same pages in its `docs/` folder and as an Agent Skill in `skills/` ([installing the skill](https://cri-middleware.github.io/SpriteStudio-Docs/ai/docs/))
- [**SpriteStudio Docs (portal)**](https://cri-middleware.github.io/SpriteStudio-Docs/) — the SDK and every official player in one place, with a [plugin](https://cri-middleware.github.io/SpriteStudio-Docs/ai/) that tells your coding assistant about SpriteStudio

## 🎯 Which Package Should I Use?

Each renderer bundles the WASM core, so you install just one package — pick the row that matches your environment. Each package's README explains **why you'd choose SpriteStudio for that specific stack** (PixiJS, plain WebGL, …).

| Your environment | Package | Runnable example |
|---|---|---|
| **Standalone / no framework** (`<ss-player>` Web Component) | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **PixiJS v8 app** | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **Buttons drawn by animations in a PixiJS v8 app** (`@pixi/ui`) | [`@spritestudio/ssplayer-pixi-ui`](./packages/ssplayer-pixi-ui) | [examples/pixi-example](./examples/pixi-example) (`ui.html`) |
| **Building your own renderer** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **Converting `.sspj` → `.ssab`** | [`ssconverter-web`](./packages/ssconverter-web) (Web tool + Node CLI) | — |
| **Embedding conversion in your own app/service** | [`@spritestudio/ssconverter-core`](./packages/ssconverter-core) | — |

**Game-engine integrations** — plugins installed from GitHub Releases rather than npm, set up in the engine's editor with no code; each package's README has its own Quick start.

| Your environment | Package | Runnable example |
|---|---|---|
| **RPG Maker MZ** (PixiJS v5) | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **TyranoScript** (visual-novel engine) | [`@spritestudio/ssplayer-tyranoscript`](./packages/ssplayer-tyranoscript) | [examples/tyranoscript-example](./examples/tyranoscript-example) |
| **TyranoBuilder** (visual-novel editor) | [`@spritestudio/ssplayer-tyranobuilder`](./packages/ssplayer-tyranobuilder) | [examples/tyranobuilderexample](./examples/tyranobuilderexample) |

## 🚀 Quick Start

**Using it in your own project?** Read on — install a renderer, convert your `.sspj`, play. Everything after the first animation (events, per-part overrides, custom textures) is the same path further in, under [Customization](./docs/customize/events.md).
**Working on SSPlayerForWeb itself?** [CONTRIBUTING.md](./CONTRIBUTING.md), the [Build Guide](./docs/development/build.md) — which also builds a changed version for your own app or game and checks it in RPG Maker MZ and the Tyrano hosts — and [How the Player Is Put Together](./docs/development/architecture.md) for how the packages fit together and why.

No Rust or WASM toolchain is needed — the WASM ships inside each renderer package, and projects are authored in **SpriteStudio 7.6 or later**. (For PixiJS, RPG Maker MZ, TyranoScript or TyranoBuilder, see that package's README in the tables above.)

1. **Install** the standalone renderer (or load it from a [CDN](./docs/usage/webgl.md#without-a-bundler-cdn) with no bundler):

   ```bash
   npm install @spritestudio/ssplayer-webgl
   ```

2. **Convert** your `.sspj` folder in the browser with [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) (or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)), and extract the resulting folder into the directory your app serves as-is (such as `public/`):

   ```
   public/
   └── Ringo/            ← from the converter's output
       ├── Ringo.ssab
       ├── Ringo.png
       └── …
   ```

3. **Play** it with the `<ss-player>` element (or via the `SSSurface` / `SSPlayer` JS API):

   ```ts
   import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
   defineSSPlayerElement();   // register <ss-player> once per app
   ```

   ```html
   <ss-player src="/Ringo/Ringo.ssab" animation="wait1" autoplay style="width:640px;height:480px"></ss-player>
   ```

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with, and [Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) a good one for effects. To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).

**Read next:** [Installation](./docs/setup/install.md) · [Quick Start](./docs/setup/quickstart.md) · [Preparing assets (`.sspj` → `.ssab`)](./docs/usage/assets.md) · [Limitations & Scope](./docs/limitations.md) · [Migrating from SS6Player for Web](./docs/migration_from_ss6.md)

## 🎬 Samples

Ready-to-run example apps live under [`examples/`](./examples/) — one per renderer, each linked from the per-environment tables above, plus three that are not tied to one renderer: [`examples/sspj-preview`](./examples/sspj-preview) converts a `.sspj` folder you drop on it and plays the result in the same tab, with a seek bar and a strip of event markers you can click (`ssconverter-core` + `ssplayer-webgl` or `ssplayer-pixi`, switched on the page; no server and no build step), [`examples/part-follow`](./examples/part-follow) pins an HTML element to a part's live transform, and [`examples/cdn`](./examples/cdn) is three single-file pages that load the players straight from a CDN with no bundler and no `npm install`.

Several of them run live, in [Try it live](#-try-it-live) above. Running one from a checkout is in [CONTRIBUTING.md](./CONTRIBUTING.md#development-environment).

For the PixiJS and WebGL examples, you can drag and drop a folder containing an `.ssab` file (and its textures) or an embedded `.ssab` file directly into the browser to play your own assets.

## 🔗 Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the portal for the SDK and every official player
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the core SDK providing `libssruntime` and `libssconverter`
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — desktop GUI tool for converting `.sspj` to `.ssab` without a player

## 📄 License

This project is licensed under the BSD-3-Clause License. See [LICENSE.md](./LICENSE.md) for details; a Japanese reference translation is in [LICENSE.ja.md](./LICENSE.ja.md).

For the licenses of the bundled `SpriteStudio-SDK` and other third-party libraries, see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Need help? See [SUPPORT.md](./SUPPORT.md); participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
