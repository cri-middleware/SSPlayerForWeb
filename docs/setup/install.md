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

::: tip RPG Maker MZ
The RPG Maker MZ renderer (`@spritestudio/ssplayer-rmmz`) is **experimental (alpha) and
private** — it is not published to npm. It is built on `ssplayer-webgl`. See
[Using RPG Maker MZ](/usage/rmmz) for details.
:::

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

## Prerequisites

- The browser must support **WebGL 1 / 2**. `ssplayer-pixi` relies on the
  **WebGL2 / WebGPU** support that PixiJS v8 requires.
- Playback needs a **`.ssab` (runtime binary)**. See [Preparing assets](/usage/assets)
  for how to convert a SpriteStudio `.sspj`.

Next, head to the [Quick start](/setup/quickstart).
