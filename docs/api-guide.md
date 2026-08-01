# API reference

The [generated reference](/api/) lists every exported symbol. This page is the map that goes with
it: which class to start from, what sits underneath it, and which types you actually touch.

## Start from one class

You only ever construct **one** player class — the one belonging to the renderer package you
installed. Everything else hangs off it.

| Your setup | Class | Package |
|---|---|---|
| Frameworkless / drop-in | [`SSPlayer`](/api/@spritestudio/ssplayer-webgl/classes/SSPlayer.md) | `ssplayer-webgl` |
| Plain HTML, no JS wiring | `<ss-player>` (see [WebGL & Web Components](/usage/webgl)) | `ssplayer-webgl` |
| PixiJS v8 app | [`SSPlayer`](/api/@spritestudio/ssplayer-pixi/classes/SSPlayer.md) | `ssplayer-pixi` |
| Your own renderer | [`DirectInternalPlayer`](/api/@spritestudio/ssplayer-core/classes/DirectInternalPlayer.md) + [`GeometryBuilder`](/api/@spritestudio/ssplayer-core/classes/GeometryBuilder.md) | `ssplayer-core` |

Both player classes must be initialized once before any instance is constructed, because the WASM
runtime is a module-level singleton:

```ts
await SSSurface.initialize();  // or SSPlayer.initialize()
```

::: tip The same symbol appears three times
Each renderer package **re-exports `ssplayer-core`**, so `SSRuntimeManager`, `IResourceManager`,
`BlendType` and friends show up under all three package pages in the generated reference. They are
the same declarations. Import from the package you installed — never add `ssplayer-core` alongside
a renderer just to reach a core type.
:::

## What sits underneath

Useful when a stack trace or an autocomplete list drops you somewhere unfamiliar:

```
SSPlayer / SSPlayer          ← the facade you call (playback, events, overrides)
  └─ DirectInternalPlayer          ← extends InternalPlayerBase; owns loading + the draw plan
       └─ SSRuntimeManager         ← the WASM boundary; frame data as zero-copy typed-array views
            └─ SSRuntimeContext    ← wasm-bindgen handle (generated; you should not need it)
```

Each layer is public, but the further down you go the more the contract is "whatever the runtime
currently emits". Stay on the facade unless you are writing a renderer.

## Types you will actually touch

**Events** — see [Events & user data](/customize/events).
[`SSUserDataEvent`](/api/@spritestudio/ssplayer-webgl/interfaces/SSUserDataEvent.md),
[`SSSignalEvent`](/api/@spritestudio/ssplayer-webgl/interfaces/SSSignalEvent.md),
[`SSAudioEvent`](/api/@spritestudio/ssplayer-webgl/interfaces/SSAudioEvent.md), and
[`Unsubscribe`](/api/@spritestudio/ssplayer-webgl/type-aliases/Unsubscribe.md) — the handle every
`onX` method returns.

**Part overrides** — see [Part control](/customize/part-overrides).
[`SSBlendOp`](/api/@spritestudio/ssplayer-core/enumerations/SSBlendOp.md),
[`SSOverridePriority`](/api/@spritestudio/ssplayer-core/enumerations/SSOverridePriority.md),
[`SSPartOverrideTarget`](/api/@spritestudio/ssplayer-core/interfaces/SSPartOverrideTarget.md).

**Part tracking** — see [Part tracking](/customize/part-following).
[`SSPartFollowOptions`](/api/@spritestudio/ssplayer-core/interfaces/SSPartFollowOptions.md),
[`SSDecomposedTransform`](/api/@spritestudio/ssplayer-core/interfaces/SSDecomposedTransform.md), and
on PixiJS also [`SSPartAttachment`](/api/@spritestudio/ssplayer-pixi/type-aliases/SSPartAttachment.md).

**Playback enums.**
[`WebPlaybackDirection`](/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackDirection.md) and
[`WebPlaybackStyle`](/api/@spritestudio/ssplayer-core/enumerations/WebPlaybackStyle.md) are the two
arguments to `setPlaybackDirection`.

**Construction options** (WebGL only) —
[`SSSurfaceOptions`](/api/@spritestudio/ssplayer-webgl/interfaces/SSSurfaceOptions.md)
covers `backgroundColor`, `maxDPR`, `antialias`, `pauseWhenHidden` and the rest. See
[Performance tuning](/customize/performance).

## Interfaces you implement

These are the extension points — the player calls *you*.

| Interface | Implement it when |
|---|---|
| [`IAudioManager`](/api/@spritestudio/ssplayer-core/interfaces/IAudioManager.md) | You want the animation's sounds played by your own audio engine. Both renderers ship an `SSWebAudioManager` you can use instead. |
| [`IResourceManager`](/api/@spritestudio/ssplayer-core/interfaces/IResourceManager.md) | You are writing a renderer, or you need textures to come from somewhere other than sibling files. See [Resources & lifecycle](/customize/resources). |
| [`InstancePackProvider`](/api/@spritestudio/ssplayer-core/type-aliases/InstancePackProvider.md) | Instance parts reference packs that are not URL-addressable (in-memory bundles, drag-and-drop). |

## Conversion API

`@spritestudio/ssconverter-core` is a separate, player-independent surface —
[`convertProject`](/api/@spritestudio/ssconverter-core/functions/convertProject.md),
[`locateProject`](/api/@spritestudio/ssconverter-core/functions/locateProject.md) and
[`ConvertOptions`](/api/@spritestudio/ssconverter-core/interfaces/ConvertOptions.md). See
[Preparing assets](/usage/assets).

---

Everything else, in full: **[generated API reference](/api/)**.
