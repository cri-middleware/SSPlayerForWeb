---
description: The renderer for apps already built on PixiJS v8, which draws many characters together with batched Direct Drawing.
---

# PixiJS

`@spritestudio/ssplayer-pixi` is the renderer for apps already built on **PixiJS v8**.
It uses **Direct Drawing (batch rendering)** to draw large numbers of characters
together.

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../examples/pixi/" target="_blank" rel="noreferrer">Live demo</a>** — a PixiJS
v8 app playing several animations; drop a `.ssab` onto it to play your own.

🎨 **<a href="../examples/override/" target="_blank" rel="noreferrer">Part override demo</a>** —
the same renderer swapping a part's colour, cell and visibility at runtime (see
[Part control](/customize/part-overrides)).

## Install

```bash
pnpm add @spritestudio/ssplayer-pixi pixi.js
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
hitbox) follow a part every frame, see [Part tracking](/customize/part-following). To recolour,
hide or re-cell a single part at run time, see
[Part control](/customize/part-overrides) — `SSPlayer` carries the same override methods as the
WebGL player, and re-renders the current frame when one is set while playback is stopped.

## Blend modes and background

SpriteStudio's "read the background" blend modes (Screen / Exclusion / Invert) are
implemented as fixed-function GPU blends that read the actual framebuffer. That means
the `Application`'s `backgroundColor` becomes the background they composite against. See
[Shaders & blend modes](/customize/shaders) for details.
