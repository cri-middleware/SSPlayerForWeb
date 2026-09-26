# Runtime texture replacement (costume changes)

Swap the texture a cell map binds **from your code**, without touching the `.ssab` — colour variations, costume changes, dynamic facial expressions. It keys by **cell-map name**, so one call reaches every part that draws from that cell map.

This is a Player-side responsibility, and is **not** the [Part control](/customize/part-overrides) (Override Layer) API: that replaces the cell one *part* draws; this replaces the whole *texture* a cell map is bound to.

The same method names are available on `SSPlayer` (both the PixiJS and WebGL backends) and on RPG Maker MZ — each takes its own engine's texture object.

## Basic usage

```ts
// PixiJS — pass a PIXI.Texture
import { Assets, Texture } from 'pixi.js';

const costume = await Assets.load<Texture>('/assets/sailor_uniform.png');
player.setCellmapTexture('Clothes', costume);

// Restore the original — no reload, the original was never thrown away
player.setCellmapTexture('Clothes', null);
```

```ts
// WebGL — pass an image source (ImageBitmap / HTMLImageElement / <canvas> / <video>)
const img = new Image();
img.src = '/assets/sailor_uniform.png';
await img.decode();
player.setCellmapTexture('Clothes', img);
```

```js
// RPG Maker MZ — pass a Bitmap (loaded however you like)
const bmp = ImageManager.loadBitmap('spritestudio/', 'sailor_uniform');
player.setCellmapTexture('Clothes', bmp); // deferred until the bitmap is ready
```

Prepare one atlas per part per pattern, and one texture swap dresses the whole character — which is what makes an efficient avatar system.

## Discovering the targets

The names you can replace are listed by the player itself:

```ts
player.getReplaceableTextureNames(); // → ["Clothes", "common", "common.png", ...]
```

The list is the cell-map names (`Clothes`, `common` — no `.ssce` extension) **plus** the texture *file* names an authored TextureChange (`TCHG`) can select (`common.png`). Both are valid targets, because the texture a batch binds is keyed from both namespaces — a cell-map name normally, and the file name on the frames a texture change applies (see the note below).

## `setCellmapTexture` vs `setPartCellOverride`

They read alike but do different things — do not reach for one when you mean the other:

| | `setCellmapTexture(name, texture)` | `setPartCellOverride(part, cellmap, cell)` |
|---|---|---|
| Unit | A whole **cell map** (texture) | **One part** |
| Effect | Every part drawing from that cell map | Only that part |
| Replaces | The **texture object** bound to the name | The **cell** (rect + texture) the part draws |
| Belongs to | This page (a Player-side texture swap) | [Part control](/customize/part-overrides) (the Override Layer) |

Reach for `setCellmapTexture` to re-skin (a costume, a palette swap); reach for `setPartCellOverride` to make one part show a different picture from the same atlas.

## API reference

| Method | Description |
|---|---|
| `setCellmapTexture(cellmapName, texture)` | Bind `texture` for a cell-map / external-texture name; `null` restores the original |
| `getCellmapTexture(cellmapName)` | The current override (never the original), or `undefined` when nothing is overridden |
| `getReplaceableTextureNames()` | List the names a replacement can target (cell-map names + TextureChange targets) |

The `texture` argument is engine-native: a `Texture` on PixiJS, an image source (or a low-level `SSTextureEntry`) on WebGL, a `Bitmap` on RPG Maker MZ.

## Notes

- **Same size, same layout.** The UVs and cell rects stay in the *original* cell map's pixel space and are normalized by the size of the texture actually bound, so a replacement of a different resolution samples a shifted region. Swap in an atlas of the same size and the same layout.
- **A frame under a TextureChange binds a different name.** On the frames an authored `TCHG` applies, the part binds through the texture *file*-name hash, not the cell-map name — so replacing the cell-map name has no effect there. To re-skin those frames too, replace that file name (the `xxx.png` entries `getReplaceableTextureNames()` lists).
- **Restoring does not reload.** An override *shadows* the loaded texture rather than replacing it, so `null` just drops the shadow and the original reappears — no fetch, and it works for embedded (`--embedded`) textures too.
- **Ownership.** A `Texture` (PixiJS) or an `SSTextureEntry` (WebGL) you pass is yours — the player never frees it. A raw image source (WebGL) or `Bitmap` (MZ) is uploaded into a GPU texture the *player* owns and frees on restore, replacement, or teardown.
- **Instance children share this player's textures**, so replacing a name a child's sub-animation also uses re-skins the child too — unlike the Override Layer, whose overrides stop at an instance boundary.
- **Binding a different `.ssab` clears every override** (its cell-map hashes belong to the old pack).
- **WebGL context loss drops overrides.** The originals are re-uploaded automatically (see [Resources & lifecycle](/customize/resources)), but a runtime override is not — re-apply it if the context is lost.

## When the change reaches the screen

Like a part override, a texture swap changes the output **without changing the frame number**, so an implementation that only redraws when the frame advances could miss it. How each ForWeb player handles it:

| Player | Behaviour |
|---|---|
| `SSPlayer` (PixiJS) | Its ticker early-returns while stopped, so a swap automatically re-renders the current frame, the same as an override |
| `SSPlayer` (WebGL) | The built-in RAF loop calls `draw()` unconditionally every frame, so it just shows. Only if you drive frames yourself do you need to call `draw()` |
| RPG Maker MZ | MZ redraws every game frame, so it just shows |

## Using it from a Web Component

The `<ss-player>` element carries only the playback verbs, so reach the swap through `el.player` (the `SSPlayer` underneath). See [WebGL & Web Components](/usage/webgl). There is no plugin-command or TyranoScript surface for texture replacement yet — it is a code-only feature for now.
