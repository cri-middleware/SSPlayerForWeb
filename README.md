[**日本語**](./README.ja.md) | [**English**](./README.md)

# SSPlayerForWeb

A high-performance, WebAssembly-powered player for [OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/) animations on the Web.

This player is designed to be highly adaptable and deployable across various Web graphics engines, ranging from modern PixiJS to legacy environments like RPG Maker MZ (PixiJS v5) and standalone WebGL.

## Documentation

Comprehensive documentation is available in the `docs/` folder (hosted via VitePress):

- [**Documentation (Japanese)**](./docs/index.md) (English documentation is a work in progress)

### Quick Links (Japanese)
- [Installation](./docs/setup/install.md)
- [Quick Start](./docs/setup/quickstart.md)
- [Basic Usage](./docs/usage/basic.md)
- [Asset Preparation](./docs/usage/assets.md)
- [PixiJS Integration](./docs/usage/pixi.md)
- [WebGL Standalone & Web Components](./docs/usage/webgl.md)

## Quick Start

### 1. Try out the Examples
1. **Get the Repo**: Clone or download this repository.
2. **Build WASM**: Run `pnpm run build:wasm` (required if Rust code is modified or not built yet. Requires `rustup` and running `cargo install wasm-pack` beforehand).
3. **Build the packages**: Run `pnpm install` and then `pnpm run build` from the project root.
4. **Run**: Navigate to `examples/pixi-example` and run `pnpm run dev`.

### 2. Import into your Project
1. **Convert**: Use [`ssconverter-web`](./docs/usage/assets.md) or [`SSConverterGUI`](https://github.com/cri-middleware/SSConverterGUI/releases) to convert your `.sspj` to `.ssab`.
2. **Install**: Run `npm install @spritestudio/ssplayer-pixi pixi.js`.
3. **Play**: Load the `.ssab` and attach it to the `SSPlayer` container!

For advanced setups, please refer to the [Installation Guide](./docs/setup/install.md).

## Overview

### Monorepo Structure

This project uses `pnpm` workspaces for package management.

**Core**
- **`@spritestudio/ssplayer-core`**: The engine-agnostic core logic layer. Manages WASM initialization, time updates, and zero-copy data extraction. It has zero dependencies on DOM APIs or specific rendering engines.

**Renderers (Engine Bindings)**
- **`@spritestudio/ssplayer-pixi`**: Optimized for PixiJS v8. Uses direct drawing (BatchRenderer) for maximum performance.
- **`@spritestudio/ssplayer-webgl`**: Standalone lightweight WebGL renderer, including a `<ss-player>` Web Component.
- **`@spritestudio/ssplayer-rmmz`**: Designed for RPG Maker MZ (PixiJS v5). Uses SceneGraph drawing for seamless integration with the engine's Sprite tree.

**Tools**
- **[`SSConverterGUI`](https://github.com/cri-middleware/SSConverterGUI/releases)**: Desktop GUI tool for converting `.sspj` to `.ssab`.
- **`ssconverter-web`**: Web-based converter tool and Node.js CLI script that converts `.sspj` to `.ssab` using WebAssembly.

## Reader Personas

The documentation and repository structure are designed for three levels of users. You only need to read as far as your goal requires:

| Persona | Goal | Where to Read |
|---|---|---|
| **General Users** | Just want to get animations running | [Quick Start](./docs/setup/quickstart.md) → [Basic Usage](./docs/usage/basic.md) |
| **Customization Users** | Want to polish expressions and add logic | Above + [Customization](./docs/customize/events.md) |
| **SDK / Player Developers** | Want to extend or contribute to the core | Above + [CONTRIBUTING.md](./CONTRIBUTING.md) |

## Related Repositories

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — The core SDK providing `libssruntime` and `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — Desktop GUI tool for converting `.sspj` to `.ssab`.

## License

This project is licensed under the BSD-3-Clause License. See the [LICENSE.md](./LICENSE.md) file for details.
