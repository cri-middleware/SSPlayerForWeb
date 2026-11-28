---
description: Which class to start from, what sits underneath it, and which types you actually touch. The map that goes with the generated reference.
---

# API reference

The [generated reference](https://cri-middleware.github.io/SSPlayerForWeb/api/) lists every exported symbol. This page is the map that goes with
it: which class to start from, what sits underneath it, and which types you actually touch.

## Start from one class

You only ever construct **one** player class — the one belonging to the renderer package you
installed. Everything else hangs off it.

| Your setup | Class | Package |
|---|---|---|
| Frameworkless / drop-in | [`SSSurface`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/classes/SSSurface), whose `createPlayer()` returns an [`SSPlayer`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/classes/SSPlayer) | `ssplayer-webgl` |
| Plain HTML, no JS wiring | `<ss-player>` (see [WebGL & Web Components](./usage/webgl.md)) | `ssplayer-webgl` |
| PixiJS v8 app | [`SSPlayer`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-pixi/classes/SSPlayer) | `ssplayer-pixi` |
| A button in a PixiJS v8 app (see [UI buttons](./usage/pixi-ui.md)) | [`SSButton`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-pixi-ui/classes/SSButton) | `ssplayer-pixi-ui` |
| Your own renderer | [`DirectInternalPlayer`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/classes/DirectInternalPlayer) + [`GeometryBuilder`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/classes/GeometryBuilder) | `ssplayer-core` |

The WASM runtime is a module-level singleton, so initialize it once before creating any player:

```ts
await SSSurface.initialize();  // WebGL; on PixiJS: await SSPlayer.initialize();
```

::: tip The same symbol appears four times
Each renderer package **re-exports `ssplayer-core`**, and `ssplayer-pixi-ui` re-exports
`ssplayer-pixi`, so `SSRuntimeManager`, `IResourceManager`, `BlendType` and friends show up under all
four package pages in the generated reference. They are the same declarations. Import from the package you installed — never add `ssplayer-core` alongside
a renderer just to reach a core type.
:::

## What sits underneath

Useful when a stack trace or an autocomplete list drops you somewhere unfamiliar:

```
SSPlayer (webgl) / SSPlayer (pixi) ← the facade you call (playback, events, overrides)
  └─ DirectInternalPlayer          ← extends InternalPlayerBase; owns loading + the draw plan
       └─ SSRuntimeManager         ← the WASM boundary; frame data as zero-copy typed-array views
            └─ SSRuntimeContext    ← wasm-bindgen handle (generated; you should not need it)
```

Each layer is public, but the further down you go the more the contract is "whatever the runtime
currently emits". Stay on the facade unless you are writing a renderer.

## Types you will actually touch

**Events** — see [Events & user data](./customize/events.md).
[`SSUserDataEvent`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSUserDataEvent),
[`SSSignalEvent`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSSignalEvent),
[`SSAudioEvent`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSAudioEvent), and
[`Unsubscribe`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/type-aliases/Unsubscribe) — the handle every
`onX` method returns.

**Part overrides** — see [Part control](./customize/part-overrides.md).
[`SSBlendOp`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSBlendOp),
[`SSOverridePriority`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSOverridePriority),
[`SSPartOverrideTarget`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/SSPartOverrideTarget).

**Texture replacement** — see [Runtime texture replacement](./customize/texture-replacement.md).
`setCellmapTexture` / `getReplaceableTextureNames` live on `SSPlayer`; each takes its engine's own
texture object (no dedicated type to import).

**Part tracking** — see [Part tracking](./customize/part-following.md).
[`SSPartFollowOptions`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/SSPartFollowOptions),
[`SSDecomposedTransform`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/SSDecomposedTransform), and
on PixiJS also [`SSPartAttachment`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-pixi/type-aliases/SSPartAttachment).

**Motion blending** — see [Motion blending](./customize/motion-blending.md).
[`SSTrackBlend`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSTrackBlend) and
[`SSTrackSync`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/SSTrackSync), what
`setTrackBlend` and `setTrackSync` take. Sources are plain `number` handles.

**Playback enums.**
[`WebPlaybackDirection`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackDirection) and
[`WebPlaybackStyle`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackStyle) are the two
arguments to `setPlaybackDirection`.

**Construction options** (WebGL only) —
[`SSSurfaceOptions`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-webgl/interfaces/SSSurfaceOptions)
covers `backgroundColor`, `maxDPR`, `antialias`, `pauseWhenHidden` and the rest. See
[Performance tuning](./customize/performance.md).

## Interfaces you implement

These are the extension points — the player calls *you*.

| Interface | Implement it when |
|---|---|
| [`IAudioManager`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/IAudioManager) | You want the animation's sounds played by your own audio engine. `@spritestudio/ssplayer-core` ships a ready-made `SSWebAudioManager` (its `/audio` subpath) you can use instead. |
| [`IResourceManager`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/interfaces/IResourceManager) | You are writing a renderer, or you need textures to come from somewhere other than sibling files. See [Resources & lifecycle](./customize/resources.md). |
| [`InstancePackProvider`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssplayer-core/type-aliases/InstancePackProvider) | Instance parts reference packs that are not URL-addressable (in-memory bundles, drag-and-drop). |

## Conversion API

`@spritestudio/ssconverter-core` is a separate, player-independent surface —
[`convertProject`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssconverter-core/functions/convertProject),
[`locateProject`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssconverter-core/functions/locateProject) and
[`ConvertOptions`](https://cri-middleware.github.io/SSPlayerForWeb/api/@spritestudio/ssconverter-core/interfaces/ConvertOptions). See
[Preparing assets](./usage/assets.md).

---

Everything else, in full: **[generated API reference](https://cri-middleware.github.io/SSPlayerForWeb/api/)**.
