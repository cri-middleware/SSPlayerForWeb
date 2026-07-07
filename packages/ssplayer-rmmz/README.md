[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

RPG Maker MZ (PixiJS v5) renderer for the **SpriteStudio 7** player.

Part of the [SSPlayerForWeb](../../README.md) monorepo.

> ⚠️ **Work in progress / placeholder.** This package currently only exports a
> version constant (`RMMZ_RENDERER_VERSION`). The renderer for the RPG Maker MZ
> fixed PixiJS v5 environment is not yet implemented.
>
> Targeting a modern PixiJS app? Use
> [`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) (PixiJS v8) instead.

## ✨ Why SpriteStudio with RPG Maker MZ?

- **Beyond MZ's built-in animation.** RPG Maker MZ's animation is limited to
  sprite-sheet effects; rich character motion, cutscenes, or full-screen
  presentation otherwise means fighting the editor or pre-rendering video.
  SpriteStudio 7 brings pro bone / mesh / particle 2D animation into MZ, playing
  your existing PNG art.
- **The MZ-native path — and the only one that fits.** MZ is locked to
  **PixiJS v5**, so the modern [`ssplayer-pixi`](../ssplayer-pixi) (v8) renderer
  cannot run there. This package targets that fixed v5 environment specifically.

## Planned approach

Like [`@spritestudio/ssplayer-pixi`](../ssplayer-pixi), this package is expected to
render with **direct drawing** — feeding the core's draw batches straight to
PixiJS — adapted to the fixed version (v5) that RPG Maker MZ ships. See the repo
[ROADMAP.md](../../ROADMAP.md) for status.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
