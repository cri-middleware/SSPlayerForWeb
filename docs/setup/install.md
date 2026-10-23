---
description: Choosing a renderer package, installing it, and the prerequisites.
---

# Installation

## Choosing a package

Pick the one package that matches your environment.

| Environment | Package |
|---|---|
| Frameworkless / drop-in (includes the `<ss-player>` Web Component) | [`@spritestudio/ssplayer-webgl`](/usage/webgl) |
| Apps already built on **PixiJS v8** | [`@spritestudio/ssplayer-pixi`](/usage/pixi) |
| Building your own renderer on a custom engine | `@spritestudio/ssplayer-core` |
| A game made in **RPG Maker MZ** | [`@spritestudio/ssplayer-rmmz`](/usage/rmmz) (a plugin) |
| A **TyranoScript** visual novel | [`@spritestudio/ssplayer-tyranoscript`](/usage/tyrano) (a plugin) |
| A game made in **TyranoBuilder** | [`@spritestudio/ssplayer-tyranobuilder`](/usage/tyranobuilder) (a `.tbp` plugin) |

Each renderer package re-exports `@spritestudio/ssplayer-core`, so you don't need to
install the core separately.

RPG Maker MZ, TyranoScript and TyranoBuilder take a plugin rather than an npm package, and
need no code: each one's page has its whole setup, and what each does not cover is in
[Limitations & Scope](/limitations). The rest of this page installs the other packages.

## Install

::: code-group

```bash [pnpm]
# Standalone renderer with no dependencies
pnpm add @spritestudio/ssplayer-webgl

# For apps built on PixiJS v8 (pixi.js is a peer dependency)
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

```bash [npm]
# Standalone renderer with no dependencies
npm install @spritestudio/ssplayer-webgl

# For apps built on PixiJS v8 (pixi.js is a peer dependency)
npm install @spritestudio/ssplayer-pixi pixi.js
```

:::

`ssplayer-webgl` requires no extra dependencies. When using `ssplayer-pixi`,
`pixi.js@^8.19` is a **peer dependency**, so add it to your app.

No bundler? Both load straight from a CDN — see
[WebGL](/usage/webgl#without-a-bundler-cdn) or [PixiJS](/usage/pixi#without-a-bundler-cdn).

## Prerequisites

- The browser must support **WebGL** (version 1 or 2 for `ssplayer-webgl`,
  version 2 for `ssplayer-pixi`). On top of that, `ssplayer-pixi` uses **WebGPU**
  when the browser provides it and falls back to WebGL2 otherwise, matching the
  backend preference of PixiJS v8.
- Playback needs a **`.ssab` (runtime binary)**. See [Preparing assets](/usage/assets)
  for how to convert a SpriteStudio `.sspj`.

Next, head to the [Quick start](/setup/quickstart).
