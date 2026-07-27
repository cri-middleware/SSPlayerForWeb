# PixiJS

`@spritestudio/ssplayer-pixi` is the renderer for apps already built on **PixiJS v8**.
It uses **Direct Drawing (batch rendering)** to draw large numbers of characters
together.

## Install

```bash
pnpm add @spritestudio/ssplayer-pixi@beta pixi.js
```

`pixi.js@^8.19` is a peer dependency.

## Highlights

- `SSPlayer` extends PixiJS's `Container`, so the usual Pixi APIs — `position`,
  `scale`, `eventMode`, and so on — work as they normally do.
- It registers itself with `Ticker.shared`, so **you don't need to call `update()`
  every frame**.
- Dispose of it with `player.destroy()`, which also frees the WASM-side resources.

For minimal code see [Quick Start](/setup/quickstart); for playback control see
[Basic playback](/usage/basic). To make a display object of your own (a weapon, effect or
hitbox) follow a part every frame, see [Part tracking](/customize/part-following).

## Blend modes and background

SpriteStudio's "read the background" blend modes (Screen / Exclusion / Invert) are
implemented as fixed-function GPU blends that read the actual framebuffer. That means
the `Application`'s `backgroundColor` becomes the background they composite against. See
[Shaders & blend modes](/customize/shaders) for details.
