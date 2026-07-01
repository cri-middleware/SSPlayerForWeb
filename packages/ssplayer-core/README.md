# @spritestudio/ssplayer-core

Engine-agnostic WebAssembly core for the **SpriteStudio 7** player.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](../../docs/).

> **Just want to render animations?** Install a renderer package instead:
> - [`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) — PixiJS v8 (recommended)
> - [`@spritestudio/ssplayer-rmmz`](../ssplayer-rmmz) — RPG Maker MZ (WIP)
>
> This package is the shared foundation you build a **new renderer binding** on.

## What this package is

`ssplayer-core` wraps the Rust/WASM `ssruntime` and exposes engine-agnostic
playback logic - WASM initialization, time updates, and **zero-copy** geometry
and state extraction. It has **no dependency on any rendering engine or the
DOM**, so it is the layer a renderer package sits on top of.

## Install

```bash
pnpm add @spritestudio/ssplayer-core
```

## Key exports

| Export | Role |
|---|---|
| `initializeWasm(wasmUrl?)` | Load & instantiate the `ssruntime` WASM module (call once). |
| `getWasmMemory()` | The WASM `WebAssembly.Memory`, for zero-copy `TypedArray` views. |
| `SSRuntimeManager` | Wraps a loaded `.ssab`; part / animation introspection. |
| `DirectInternalPlayer` | High-performance direct-draw player facade. |
| `GeometryBuilder` | Builds vertex / index buffers from runtime draw batches. |
| `IResourceManager` / `IAudioManager` | Interfaces a renderer implements (textures, audio). |
| `ssFormat` / `ssRuntime` | SSAB / SSQB FlatBuffers introspection accessors. |
| `WebPlaybackDirection` / `WebPlaybackStyle` | Playback enums. |

## Building a renderer on top

1. Implement `IResourceManager` to resolve textures for your engine.
2. Drive `DirectInternalPlayer.update(deltaMs)` once per frame.
3. Feed the emitted draw batches through `GeometryBuilder` into your GPU path.

[`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) is the reference implementation.

## Memory model

- **Zero-copy:** transform matrices and geometry are read through `Float32Array`
  views mapped directly onto `getWasmMemory().buffer` — no per-frame copies.
- **Memory safety:** WASM memory is not GC'd by JS; the wrappers use
  `FinalizationRegistry` to call the WASM `free()` when the JS object is collected.

## Working from source

WASM binaries are **not tracked in git**. From the repo root:

```bash
pnpm run build:wasm   # build the ssruntime WASM (needs Rust)
pnpm run build        # build all TS packages
```

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
