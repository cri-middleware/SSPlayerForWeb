[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for Web

**Professional 2D animation for the Web — one WebAssembly-powered core, rendered through modern PixiJS or a zero-dependency standalone WebGL engine.**

A high-performance player for **[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** animations (`.ssab`) on the Web. Animate the sprite art you already have (PNG / WebP) in a dedicated editor, then play it back in the browser through the rendering engine of your choice — no video files, no re-authoring.

## 🌐 Try it live

No install — these run entirely in your browser (🚧 live once the first release is published):

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — convert `.sspj` → `.ssab` entirely client-side (start here)
- ▶️ **[Standalone WebGL example](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — zero-dependency standalone renderer (the `<ss-player>` Web Component). *Supports D&D of `.ssab` files.*
- ▶️ **[PixiJS example](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — for PixiJS v8 apps. *Supports D&D of `.ssab` files.*
- ▶️ **[RPG Maker MZ example](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — a sample MZ project (SpriteStudio pictures)
- ▶️ **[TyranoScript example](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** — a visual-novel scene driven by `[ss_*]` tags (beta)
- 🎨 **[Part override example](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** — swap a part's colour, cell or visibility at runtime (PixiJS)

## 📚 Documentation

Comprehensive documentation lives in the `docs/` folder (hosted via VitePress) and is structured step-by-step according to what you want to do:

- [**Documentation site (hosted)**](https://cri-middleware.github.io/SSPlayerForWeb/) — 🚧 live after the first release
- [**Documentation (English)**](./docs/index.md) · [**日本語ドキュメント**](./docs/ja/index.md)
- [**For AI assistants**](https://cri-middleware.github.io/SSPlayerForWeb/llms.txt) — these docs as Markdown: `llms.txt` indexes the pages and `llms-full.txt` holds all of them in one file — 🚧 live after the first release
- [**SpriteStudio Docs (portal)**](https://cri-middleware.github.io/SpriteStudio-Docs/) — the SDK and every official player in one place — 🚧 live after the first release

### Quick Links
- [Installation](./docs/setup/install.md)
- [Quick Start](./docs/setup/quickstart.md)
- [Basic Usage](./docs/usage/basic.md)
- [Limitations & Scope](./docs/limitations.md)
- [Migrating from SS6Player for Web](./docs/migration_from_ss6.md)

## 🎯 Which Package Should I Use?

Each renderer bundles the WASM core, so you install just one package — pick the row that matches your environment. Each package's README explains **why you'd choose SpriteStudio for that specific stack** (PixiJS, plain WebGL, …).

| Your environment | Package | Runnable example |
|---|---|---|
| **Standalone / no framework** (`<ss-player>` Web Component) | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **PixiJS v8 app** | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **Building your own renderer** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **Converting `.sspj` → `.ssab`** | [`ssconverter-web`](./packages/ssconverter-web) (Web tool + Node CLI) | — |
| **Embedding conversion in your own app/service** | [`@spritestudio/ssconverter-core`](./packages/ssconverter-core) | — |

**Game-engine integrations** — thin adapters on top of `ssplayer-webgl`, installed as plugin bundles rather than from npm. RPG Maker MZ is **alpha**; the two Tyrano integrations are **beta**:

| Your environment | Package | Runnable example |
|---|---|---|
| **RPG Maker MZ** (PixiJS v5) | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **TyranoScript** (visual-novel engine) | [`@spritestudio/ssplayer-tyranoscript`](./packages/ssplayer-tyranoscript) | [examples/tyranoscript-example](./examples/tyranoscript-example) |
| **TyranoBuilder** (visual-novel editor) | [`@spritestudio/ssplayer-tyranobuilder`](./packages/ssplayer-tyranobuilder) | [examples/tyranobuilderexample](./examples/tyranobuilderexample) |

## 🚀 Quick Start

**Using it in your own project?** Read on. Everything after the first animation —
events, per-part overrides, custom textures — is the same path further in, under
[Customization](./docs/customize/events.md).
**Working on SSPlayerForWeb itself?** [Running the examples from a checkout](#running-the-examples-from-a-checkout) below, then [CONTRIBUTING.md](./CONTRIBUTING.md).

### Install it

> 🚧 The packages are **not published to npm yet** — this path opens up after the first release. Until then, the checkout route below is the way to try things locally.

No Rust or WASM toolchain needed — the WASM ships inside each renderer package. Install the renderer for your environment (see the table above), convert your `.sspj` → `.ssab` (authored in **SpriteStudio 7.5 or later**), and play it in a few lines. The full walkthrough lives in the docs:

**[Installation](./docs/setup/install.md)** · **[Quick Start](./docs/setup/quickstart.md)** · **[Preparing assets (.sspj → .ssab)](./docs/usage/assets.md)**

### Running the examples from a checkout

🚧 This is the second door — evaluating SpriteStudio Player for Web before the packages ship, or working on it.

**Prerequisites:** [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) (this repo uses pnpm workspaces). 🚧 The SDK has published no release yet, so there is no pre-built WASM core to download: until it does, the WASM is built from source, which needs **Rust** (via [rustup](https://rustup.rs/)) and **wasm-pack** (`cargo install wasm-pack`).

```bash
git clone --recursive https://github.com/cri-middleware/SSPlayerForWeb.git
cd SSPlayerForWeb
pnpm run example                         # every step below, then the <ss-player> demo in your browser
```

`pnpm run example` runs each step below only when its output is missing, and `pnpm run example example=pixi` picks another example (`override`, `part-follow` and `sspj-preview` too). By hand:

```bash
git submodule update --init --recursive  # SpriteStudio-SDK (sample source + core)
pnpm install                             # install deps & initialize the workspace
pnpm run build:wasm                      # build the WASM from source (Rust + wasm-pack)
pnpm run build                           # build all TypeScript packages
pnpm run deploy-examples                 # generate the .ssab assets the examples load
cd examples/webgl-example
pnpm run dev                             # open the dev server and see the animation
```
The examples consume the **built** packages via workspace references — re-run `pnpm run build` whenever you change TypeScript under `packages/`, `pnpm run build:wasm` whenever you change the Rust core, and `pnpm run deploy-examples` if you edit the sample projects.

**Once the SDK publishes a release**, `pnpm run download:wasm` fetches the pre-built WASM in place of `pnpm run build:wasm`, and no Rust toolchain is needed. Contributing the change back? [CONTRIBUTING.md](./CONTRIBUTING.md) covers the coding standards and WASM FFI rules.

## 💡 Overview

### Monorepo Structure

This project uses `pnpm` workspaces, layered so that rendering stays fully decoupled from the animation logic:

```mermaid
flowchart TD
    subgraph conv ["Conversion (author-time)"]
        direction LR
        sspj[".sspj"] --> convcore["ssconverter-core<br/>(WASM)"] --> ssab[".ssab"]
        convweb["ssconverter-web<br/>browser UI + Node CLI"] -. wraps .-> convcore
        tyranob["ssplayer-tyranobuilder<br/>TyranoBuilder editor (beta)"] -. wraps .-> convcore
    end

    subgraph play ["Playback (run-time)"]
        core["ssplayer-core<br/>(WASM, engine-agnostic)"]
        webgl["ssplayer-webgl<br/>standalone WebGL + &lt;ss-player&gt;"]
        pixi["ssplayer-pixi<br/>PixiJS v8"]
        rmmz["ssplayer-rmmz<br/>RPG Maker MZ (alpha)"]
        tyrano["ssplayer-tyranoscript<br/>TyranoScript (beta)"]
        core --> webgl
        core --> pixi
        webgl --> rmmz
        webgl --> tyrano
    end

    tyranob -. ships .-> tyrano
    ssab ==>|feeds| core
```

- **[`ssplayer-core`](./packages/ssplayer-core)** does the timeline and WASM work, then hands each frame to a renderer as plain draw data — no DOM, no engine assumptions. Every renderer is a thin binding on top of it, so adding one (see the [ROADMAP](./ROADMAP.md)) touches only that package; `ssplayer-rmmz` and `ssplayer-tyranoscript` further build on `ssplayer-webgl`, and `ssplayer-tyranobuilder` is author-time tooling that ships the TyranoScript runtime and converts `.sspj` inside the editor.
- **[`ssconverter-core`](./packages/ssconverter-core)** is a separate WASM core (a build of the Rust `libssconverter`) with the same bytes-in / bytes-out design, so the same converter runs in the browser, Node, a Worker, or an edge runtime — the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) covers the same step outside a build.

Per-package details live in each package's README, linked from the tables above.

## 🎬 Samples

Ready-to-run example apps live under [`examples/`](./examples/) — one per renderer, each linked from the per-environment tables above, plus three that are not tied to one renderer: [`examples/sspj-preview`](./examples/sspj-preview) converts a `.sspj` folder you drop on it and plays the result in the same tab, with a seek bar and a strip of event markers you can click (`ssconverter-core` + `ssplayer-webgl` or `ssplayer-pixi`, switched on the page; no server and no build step), [`examples/part-follow`](./examples/part-follow) pins an HTML element to a part's live transform, and [`examples/cdn`](./examples/cdn) is three single-file pages that load the players straight from a CDN with no bundler and no `npm install`. Build the packages first ([Quick Start](#running-the-examples-from-a-checkout)), then start any example's dev server. For the PixiJS and WebGL examples, you can drag and drop a folder containing an `.ssab` file (and its textures) or an embedded `.ssab` file directly into the browser to play your own assets.

## 🔗 Related Repositories

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the core SDK providing `libssruntime` and `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — desktop GUI tool for converting `.sspj` to `.ssab`.

## 📄 License

This project is licensed under the BSD-3-Clause License. See [LICENSE.md](./LICENSE.md) for details.

For the licenses of the bundled `SpriteStudio-SDK` and other third-party libraries, see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Need help? See [SUPPORT.md](./SUPPORT.md); participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
