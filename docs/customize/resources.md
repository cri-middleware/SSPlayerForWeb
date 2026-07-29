# Resources and lifecycle

What several players share, what each one owns, and what `destroy()` actually frees. Read this
before putting many players on one page, or when teardown leaks or blanks something out.

## What is shared, what is per-player

| Thing | Scope | Notes |
|---|---|---|
| WASM module & memory | **One per page** | `initialize()` is a module-level singleton, so calling it more than once is harmless. |
| Textures (PixiJS) | **Shared across every `SSPlayer`** | Registered in Pixi's global `Assets` cache under the cell-map hash, so two players using the same atlas reuse one GPU texture. |
| Textures (WebGL) | **Per player** | A `WebGLTexture` belongs to the context that created it, and each `SSSurface` owns a canvas and context — so the same atlas is uploaded once per player. |
| Embedded textures (`--embedded`) | **Per player** | Decoded from the `.ssab`'s own bytes, deliberately kept out of any shared cache, and freed in `destroy()`. |
| Parsed `.ssab` (WASM) | **Per player** | Each `load()` builds its own `SSABResource`. The HTTP fetch may be served from the browser cache, but the parsed WASM-side copy is not shared between players. |
| Instance packs | **Per player tree** | Packs referenced by Instance parts are deduped by pack hash and shared with that player's instance children. |

The practical consequence: **N players of the same character cost N parsed `.ssab` copies**, and on
WebGL, N texture uploads as well.

## Many instances of the same animation

**Put them all on one surface.** An `SSSurface` carries any number of `SSPlayer`s on a single
WebGL context, so a crowd of characters costs one context, not one each:

```ts
const surface = new SSSurface(canvas, { autoStart: true });
const a = surface.createPlayer();
const b = surface.createPlayer();
```

This matters because browsers cap how many WebGL contexts can be live at once — on the order of
8–16 depending on the browser. Past the cap the browser drops the oldest context, which shows up
as a canvas that goes blank. **The cap applies per surface, not per player**, so it is only a
concern if you create many surfaces.

The integrations already work this way, so you rarely have to think about it:

| | contexts |
|---|---|
| `<ss-player>` elements | **one per page.** They share an overlay canvas by default, however many you place. `standalone` opts an element out into its own context — use it only when that element needs CSS effects on the animation, its own opaque backdrop, or a place in the normal stacking order. |
| `ssplayer-tyranoscript` | **one per layer in use** (typically one or two), not one per character. |
| `ssplayer-rmmz` | **none of its own** — it draws on RPG Maker MZ's context. |
| `ssplayer-pixi` | **none of its own** — it draws on your PixiJS application's. |

`ssplayer-pixi` remains the better fit when the animations share a scene with other PixiJS
content, since it batches draws with the rest of that scene and shares textures through the
`Assets` cache.

## Tearing down

Always call `destroy()`. It is idempotent, so a defensive second call from a framework teardown
path is safe.

```ts
player.destroy();
```

It frees the player's WASM allocation (the runtime context, the `.ssab` resource, and any
instance / effect child slots), the renderer's GPU objects, and the textures that player owns.

::: warning PixiJS: shared textures are deliberately not unloaded
`destroy()` does **not** `Assets.unload()` the URL-loaded textures — another `SSPlayer` may still be
drawing with them, and yanking them would blank it out. Only the embedded (`--embedded`) textures,
which that player owns outright, are freed.

The global `Assets` cache is yours to manage: unload the atlases yourself when a scene is finished
with them, the same way you would for any other Pixi asset.
:::

There is a `FinalizationRegistry` behind the WASM handles as a last-resort safety net, but GC
timing is unspecified and the finalizer may never run. Treat it as a leak guard, not as a
teardown strategy — call `destroy()`.

## WebGL context loss

`SSSurface` handles this for you: it listens for `webglcontextlost` / `webglcontextrestored`,
halts drawing while the context is gone, and on restore rebuilds its GL objects and re-uploads
every texture before resuming — so no frame is drawn with missing textures. This matters most on
mobile webviews, which drop the context aggressively; without it the canvas would stay blank
permanently.

Textures are rebuilt from retained creation info: a URL is re-fetched, embedded bytes are
re-decoded. The one case that needs your cooperation is a texture you supplied yourself via
`bindTextureSource()` — it is re-uploaded from the original `TexImageSource`, so if you let that
source go (a closed `ImageBitmap`, for instance) that entry is skipped with a warning and renders
blank.

## Supplying textures yourself

Textures normally resolve as siblings of the `.ssab`. To serve them from somewhere else — an
in-memory bundle, an atlas your engine already has on the GPU — implement
[`IResourceManager`](/api/@spritestudio/ssplayer-core/interfaces/IResourceManager.md) and drive
the core directly, or on WebGL register the texture under its cell-map hash with
`bindTextureSource()` before `setAnimation()`.

The same applies to Instance parts whose packs are not URL-addressable: hand the bytes over with
[`InstancePackProvider`](/api/@spritestudio/ssplayer-core/type-aliases/InstancePackProvider.md).
When you do, the core stops fetching for you — registering that pack's textures becomes your job
too.
