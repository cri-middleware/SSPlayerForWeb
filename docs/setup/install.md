# Installation

## Choosing a package

Pick a single renderer package that matches your environment.

| Environment | Package |
|---|---|
| Frameworkless / drop-in (includes the `<ss-player>` Web Component) | [`@spritestudio/ssplayer-webgl`](/usage/webgl) |
| Apps already built on **PixiJS v8** | [`@spritestudio/ssplayer-pixi`](/usage/pixi) |
| Building your own renderer on a custom engine | `@spritestudio/ssplayer-core` |

Each renderer package re-exports `@spritestudio/ssplayer-core`, so you don't need to
install the core separately.

::: tip Framework integrations
Integrations for game/VN frameworks are built on `ssplayer-webgl` and ship as **IIFE
plugin bundles** loaded by the host framework's plugin system — so they are consumed as
plugins, not installed from npm:

- **RPG Maker MZ** (`@spritestudio/ssplayer-rmmz`) — **experimental (alpha)**. See [Using RPG Maker MZ](/usage/rmmz).
- **TyranoScript** (`@spritestudio/ssplayer-tyranoscript`) — beta. See [Using TyranoScript / TyranoBuilder](/usage/tyrano).
- **TyranoBuilder** (`@spritestudio/ssplayer-tyranobuilder`) — beta, distributed as a `.tbp`. See [Using TyranoScript / TyranoBuilder](/usage/tyrano).

What each one does not cover yet is in [Limitations & Scope](/limitations).
:::

## Install

::: code-group

```bash [pnpm]
# Standalone renderer with no dependencies
pnpm add @spritestudio/ssplayer-webgl@beta

# For apps built on PixiJS v8 (pixi.js is a peer dependency)
pnpm add @spritestudio/ssplayer-pixi@beta pixi.js
```

```bash [npm]
# Standalone renderer with no dependencies
npm install @spritestudio/ssplayer-webgl@beta

# For apps built on PixiJS v8 (pixi.js is a peer dependency)
npm install @spritestudio/ssplayer-pixi@beta pixi.js
```

:::

`ssplayer-webgl` requires no extra dependencies. When using `ssplayer-pixi`,
`pixi.js@^8.19` is a **peer dependency**, so add it to your app.

## Prerequisites

- The browser must support **WebGL** (version 1 or 2 for `ssplayer-webgl`,
  version 2 for `ssplayer-pixi`). On top of that, `ssplayer-pixi` uses **WebGPU**
  when the browser provides it and falls back to WebGL2 otherwise, matching the
  backend preference of PixiJS v8.
- Playback needs a **`.ssab` (runtime binary)**. See [Preparing assets](/usage/assets)
  for how to convert a SpriteStudio `.sspj`.

Next, head to the [Quick start](/setup/quickstart).
