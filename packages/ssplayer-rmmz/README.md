# @spritestudio/ssplayer-rmmz

RPG Maker MZ (PixiJS v5) renderer for the **SpriteStudio 7** player.

Part of the [SSPlayerForWeb](../../README.md) monorepo.

> ⚠️ **Work in progress / placeholder.** This package currently only exports a
> version constant (`RMMZ_RENDERER_VERSION`). The renderer for the RPG Maker MZ
> fixed PixiJS v5 environment is not yet implemented.
>
> Targeting a modern PixiJS app? Use
> [`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) (PixiJS v8) instead.

## Planned approach

Unlike `ssplayer-pixi` (direct / batched drawing), this package will use
**SceneGraph drawing** — mapping SpriteStudio parts onto PixiJS v5 `Sprite`
trees so it integrates with RPG Maker MZ's existing rendering hierarchy. This
builds on the `SceneGraphInternalPlayer` facade in
[`@spritestudio/ssplayer-core`](../ssplayer-core).

See the repo [ROADMAP.md](../../ROADMAP.md) for status.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
