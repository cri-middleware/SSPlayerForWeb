[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-core

Engine-agnostic WebAssembly core for the **SpriteStudio** player.

> **Who this is for:** developers building their own renderer / advanced integrators — the engine-agnostic WASM playback core to bind a new engine onto.
> **Install:** `npm install @spritestudio/ssplayer-core`
> **Not what you need?** → [ssplayer-pixi](../ssplayer-pixi) / [ssplayer-webgl](../ssplayer-webgl) — drop-in renderers if you just want to render animations.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](https://cri-middleware.github.io/SSPlayerForWeb/); the same pages for this version are in this package's `docs/` (start at `docs/README.md`), readable offline, and in `skills/ssplayer-core/` as an Agent Skill, which pnpm 12.11 or later links into your coding agent's skills directory after `pnpm approve @spritestudio/ssplayer-core`.

> **Just want to render animations?** Pick a renderer from the [package table](../../README.md#-which-package-should-i-use) — you don't use `core` directly.

▶️ See this core driving a renderer:
**[WebGL example](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** ·
**[PixiJS example](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
both are thin drawing layers over the same WASM playback core.

This package is for the two audiences who do:

- **Renderer authors** — porting the Player to a new engine by building a renderer binding on top of `core`. Jump straight to [Building a renderer on top](#building-a-renderer-on-top).
- **`core` maintainers** — see [For contributors — building from source](#for-contributors--building-from-source) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

## ✨ Why build your renderer on this core?

Build a renderer binding on `core` and you inherit what every SpriteStudio Player for Web renderer shares:

- **The motion is computed for you.** Bone matrices, mesh deformation and hierarchical colour / opacity are computed here and emitted as one draw plan. The PixiJS, standalone WebGL and RPG Maker MZ renderers all consume the same plan, so pose, deformation and draw order match across them. Your renderer draws; blend modes and part colours arrive as intent for it to reproduce with its engine.
- **Zero-parse loading, zero-copy frames, SIMD.** `.ssab` is a FlatBuffers binary read in place. Each frame's transforms and geometry are `Float32Array` views onto WASM memory — no per-frame copies — computed by the Rust core with SIMD (f32x4).
- **Referenced or embedded textures, both handled.** `core` loads a `.ssab` that references its texture files and one converted with `--embedded` that carries them inside — one request instead of one per texture, or none when you pass the bytes as an `ArrayBuffer`. Implement the optional `loadTextureFromBytes` to decode embedded textures; leave it out and loading falls back to URLs.
- **Runs in any browser with WebAssembly SIMD** (Chrome / Edge 91+, Firefox 89+, Safari 16.4+). The core is the SDK's `#![no_std]` Rust compiled to WebAssembly, with no OS or DOM assumptions.

## What this package is

`ssplayer-core` wraps the Rust/WASM `ssruntime` and exposes engine-agnostic
playback logic — WASM initialization, time updates, and geometry / state
extraction. Its main entry has **no dependency on any rendering engine or the DOM**
(the optional `./audio` entry uses Web Audio), so it is the layer a renderer package sits on top of.

## Key exports

| Export | Role |
|---|---|
| `initializeWasm(wasmUrl?)` | Load & instantiate the `ssruntime` WASM module (call once). |
| `getWasmMemory()` | The WASM `WebAssembly.Memory`, for zero-copy `TypedArray` views. |
| `SSRuntimeManager` | Wraps a loaded `.ssab`; part / animation introspection. |
| `DirectInternalPlayer` | High-performance direct-draw player facade. |
| `GeometryBuilder` | Builds vertex / index buffers from runtime draw batches. |
| `IResourceManager` / `IAudioManager` | Interfaces a renderer implements (textures, audio). |
| `SSWebAudioManager` | Ready-made `IAudioManager` (Web Audio); import from the `./audio` subpath. |
| `ssFormat` / `ssRuntime` | SSAB / SSQB FlatBuffers introspection accessors. |
| `WebPlaybackDirection` / `WebPlaybackStyle` | Playback enums. |

## Building a renderer on top

1. Implement `IResourceManager` to resolve textures for your engine. Add the
   optional `loadTextureFromBytes` to also render `--embedded` ssab (textures
   inlined in the binary); without it, embedded assets fall back to URL loading.
2. Drive `DirectInternalPlayer.update(deltaMs)` once per frame.
3. Feed the emitted draw batches through `GeometryBuilder` into your GPU path.

[`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) is the reference implementation.

## Memory model

- **Zero-copy:** transform matrices and geometry are read through `Float32Array`
  views mapped directly onto `getWasmMemory().buffer` — no per-frame copies.
- **Memory safety:** WASM memory is not GC'd by JS, so call `destroy()` on a player
  you are done with. `FinalizationRegistry` frees what a collected wrapper still
  holds, as a safety net.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

Who this is for: `core` maintainers; renderer authors using the npm package can skip this.

WASM binaries are **not tracked in git**. From the repo root, obtain the WASM,
then build the packages:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```
