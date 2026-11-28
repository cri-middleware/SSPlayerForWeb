---
description: What players share and what each owns, what destroy() frees, and how to tear down many players and handle WebGL context loss.
---

# Resources and lifecycle

What several players share, what each one owns, and what `destroy()` actually frees. Read this
before putting many players on one page, or when teardown leaks or blanks something out.

## What is shared, what is per-player

| Thing | Scope | Notes |
|---|---|---|
| WASM module & memory | **One per page** | `initialize()` is a module-level singleton, so calling it more than once is harmless. |
| Textures (PixiJS) | **Shared across every `SSPlayer`** | Registered in Pixi's global `Assets` cache, keyed by URL — not by cell-map hash, which is only unique within one `.ssab` — so two players using the same atlas reuse one GPU texture. |
| Textures (WebGL) | **Shared across the surface** | A `WebGLTexture` belongs to the context that created it, so the surface owns them. Keyed by URL — not by cell-map hash, which is only unique within one `.ssab` — so two players using the same atlas reuse one upload. |
| Embedded textures (`--embedded`) | **Per player** | Decoded from the `.ssab`'s own bytes, deliberately kept out of any shared cache, and freed in `destroy()`. |
| Parsed `.ssab` (WASM) | **Shared by URL** | Players that `load()` the same URL and get identical bytes share one parsed pack; each keeps only its own playback state. A pack bound with `loadBuffer()` has no URL and is not shared, nor is a file that changed under the same URL. |
| Instance packs | **Shared by URL** | A pack an Instance part references is fetched as a sibling `.ssab` and shared the same way; within one player's tree it is also deduped by pack hash. Bytes from an `InstancePackProvider` are not shared. |

The practical consequence: **N players of the same character loaded from one URL cost one parsed
`.ssab` plus N small playback states** — and one set of textures, on either backend. Packs bound with
`loadBuffer()` are the exception: each costs a full copy.

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
[`IResourceManager`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/IResourceManager) and drive
the core directly, or bind the pack with `loadBuffer(ssab, textures)`, whose second argument maps each
cell-map hash to a URL, encoded image bytes or an image source (on WebGL it is registered with
`bindTextureSource()` for you). Binding a pack — `load()` or `loadBuffer()` — resets the player's
texture manager first, so a texture registered with `bindTextureSource()` before `load()` is dropped.

To swap a texture *after* load — a costume change or dynamic expression — use the name-keyed
[runtime texture replacement](./texture-replacement.md) API instead; it resolves the
cell-map name for you and can restore the original.

The same applies to Instance parts whose packs are not URL-addressable: hand the bytes over with
`player.internalPlayer.setInstancePackProvider(provider)` — a function of type
[`InstancePackProvider`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/type-aliases/InstancePackProvider) —
before the pack's resources are prepared (`load()` / `loadBuffer()`).
When you do, the core stops fetching for you — registering that pack's textures becomes your job
too.
