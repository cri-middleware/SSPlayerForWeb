[**English**](./README.md) | [**日本語**](./README.ja.md)

# SSPlayerForWeb

**Professional 2D animation for the Web — one WebAssembly-powered core, from modern PixiJS to legacy RPG Maker MZ and standalone WebGL.**

A high-performance player for **[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** animations (`.ssab`) on the Web. Animate the sprite art you already have (PNG / WebP) in a dedicated editor, then play it back in the browser through the rendering engine of your choice — no video files, no re-authoring.

## 🌐 Try it live

No install — these run entirely in your browser (🚧 live once the first release is published):

- ▶️ **[PixiJS example](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — the recommended renderer
- ▶️ **[Standalone WebGL example](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — the `<ss-player>` Web Component
- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — convert `.sspj` → `.ssab` entirely client-side

## 📚 Documentation

Comprehensive documentation lives in the `docs/` folder (hosted via VitePress) and is structured step-by-step according to what you want to do:

- [**Documentation site (hosted)**](https://cri-middleware.github.io/SSPlayerForWeb/) — 🚧 live after the first release
- [**ドキュメント (日本語)**](./docs/index.md) — full documentation (English documentation is a work in progress).

### Quick Links (Japanese)
- [Installation](./docs/setup/install.md)
- [Quick Start](./docs/setup/quickstart.md)
- [Basic Usage](./docs/usage/basic.md)
- [Asset Preparation](./docs/usage/assets.md)
- [PixiJS Integration](./docs/usage/pixi.md)
- [WebGL Standalone & Web Components](./docs/usage/webgl.md)

### Where to read, by goal
You only need to read as far as your goal requires:

| You are… | Your goal | Where to read |
|---|---|---|
| **A general user** | Just get animations running | [Quick Start](./docs/setup/quickstart.md) → [Basic Usage](./docs/usage/basic.md) |
| **A customization user** | Polish expressions and add logic | Above + [Customization](./docs/customize/events.md) |
| **An SDK / player developer** | Extend or contribute to the core | Above + [CONTRIBUTING.md](./CONTRIBUTING.md) |

## 🎯 Which Package Should I Use?

This is a `pnpm` monorepo of focused packages. Install the renderer that matches your environment — each one bundles the WASM core, so you don't pull it in separately. Each package's README explains **why you'd choose SpriteStudio for that specific stack** (PixiJS, plain WebGL, RPG Maker MZ, …).

| Your environment | Package | Runnable example |
|---|---|---|
| **PixiJS v8** (recommended, fastest) | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **Standalone WebGL / `<ss-player>` Web Component** | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **RPG Maker MZ** (PixiJS v5) | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **Building your own renderer** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **Converting `.sspj` → `.ssab`** | [`ssconverter-web`](./packages/ssconverter-web) (Web tool + Node CLI) | — |
| **Embedding conversion in your own app/service** | [`@spritestudio/ssconverter-core`](./packages/ssconverter-core) | — |

## 🚀 Quick Start

### Prerequisites
- **Node.js** and **pnpm** (this repo uses pnpm workspaces).
- The WASM core is **not tracked in git**, so a fresh clone must obtain it once. How depends on what you're doing:
  - **General & customization users** — **download** the pre-built binaries. No extra toolchain.
  - **SDK / player developers** who change the Rust core — **build from source**, which additionally needs **Rust (via [rustup](https://rustup.rs/))** and **wasm-pack** (`cargo install wasm-pack`).

> Consuming the published npm packages does **not** require any of this — the WASM ships inside each renderer package.

### 1. Try the Examples
```bash
# From the repo root
pnpm install               # install deps & initialize the workspace
./scripts/download-sdk.sh  # fetch the pre-built WASM (Windows: scripts\download-sdk.ps1)
pnpm run build             # build all TypeScript packages

cd examples/pixi-example
pnpm run dev               # open the dev server and see the animation
```
`pnpm run download:wasm` runs the same download cross-platform. The examples consume the **built** packages via workspace references, so re-run `pnpm run build` from the root whenever you change TypeScript under `packages/`.

> **SDK / player developers** modifying the Rust core build the WASM from source instead: run `pnpm run build:wasm` (Windows: `build:wasm:win`) in place of `download-sdk`. This needs the Rust / wasm-pack toolchain — see [CONTRIBUTING.md](./CONTRIBUTING.md).

### 2. Import into Your Project
1. **Convert**: Turn your `.sspj` into `.ssab` with [`ssconverter-web`](./docs/usage/assets.md) or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases).
2. **Install**: `npm install @spritestudio/ssplayer-pixi pixi.js` (or the renderer for your environment — see the table above).
3. **Play**: Load the `.ssab` and attach it to the `SSPlayer` container.

For advanced setups, see the [Installation Guide](./docs/setup/install.md).

## 💡 Overview

### Monorepo Structure

This project uses `pnpm` workspaces. The core is deliberately decoupled from any rendering engine, so each renderer is a thin binding on top of the same WASM logic.

**Core**
- **[`@spritestudio/ssplayer-core`](./packages/ssplayer-core)** — the engine-agnostic core. Manages WASM initialization, time updates, and zero-copy data extraction, with zero dependencies on the DOM or any rendering engine.

**Renderers (engine bindings)**
- **[`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi)** — optimized for PixiJS v8. Uses direct drawing (BatchRenderer) for maximum performance.
- **[`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl)** — standalone, dependency-free WebGL1/2 renderer, including a `<ss-player>` Web Component.
- **[`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz)** — for RPG Maker MZ (PixiJS v5). Uses SceneGraph drawing for seamless integration with the engine's Sprite tree.

**Conversion (`.sspj` → `.ssab`)**
- **[`@spritestudio/ssconverter-core`](./packages/ssconverter-core)** — the engine-agnostic converter core (a WebAssembly build of the Rust `libssconverter`) with an ergonomic TypeScript API. Bytes in, bytes out — no filesystem or DOM — so the same core runs in the browser, Node, a Worker, or an edge runtime.
- **[`ssconverter-web`](./packages/ssconverter-web)** — host built on `ssconverter-core`: a browser converter UI plus a Node.js CLI (`ssconverter-web-cli`). Run `download:wasm` and you have a converter matched to the runtime's `.ssab` schema, no Rust toolchain required.
- **[SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases)** — desktop GUI tool for the same `.sspj` → `.ssab` conversion.

## 🎬 Samples

Ready-to-run example apps live under the [examples folder](./examples/). Build the packages first (see [Quick Start](#1-try-the-examples)), then start any example's dev server.

- [pixi-example](./examples/pixi-example) — PixiJS v8 renderer (`@spritestudio/ssplayer-pixi`).
- [webgl-example](./examples/webgl-example) — standalone WebGL renderer and `<ss-player>` Web Component (`@spritestudio/ssplayer-webgl`).
- [rmmz-example](./examples/rmmz-example) — RPG Maker MZ / PixiJS v5 integration (`@spritestudio/ssplayer-rmmz`).

## 🔗 Related Repositories

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the core SDK providing `libssruntime` and `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — desktop GUI tool for converting `.sspj` to `.ssab`.

## 📄 License

This project is licensed under the BSD-3-Clause License. See [LICENSE.md](./LICENSE.md) for details.
