[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-core

Engine-agnostic WebAssembly core for the **SpriteStudio 7** player.

> **Who this is for:** developers building their own renderer / advanced integrators — the engine-agnostic WASM playback core to bind a new engine onto.
> **Install:** `npm install @spritestudio/ssplayer-core@beta`
> **Not what you need?** → [ssplayer-pixi](../ssplayer-pixi) / [ssplayer-webgl](../ssplayer-webgl) — drop-in renderers if you just want to render animations.

> **Beta line.** While 7.0.0 is in prerelease the packages publish under the `beta` dist-tag only, so the `@beta` above is required; it becomes optional once 7.0.0 ships to `latest`.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For guides and the full documentation, see the [docs](../../docs/).

> **Just want to render animations?** Pick a renderer from the [package table](../../README.md#-which-package-should-i-use) — you don't use `core` directly.

▶️ See this core driving a renderer:
**[WebGL example](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** ·
**[PixiJS example](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
both are thin drawing layers over the same WASM playback core (🚧 live once the first
release is published).

This package is for the two audiences who do:

- **Renderer authors** — porting the Player to a new engine by building a renderer binding on top of `core`. Jump straight to [Building a renderer on top](#building-a-renderer-on-top).
- **`core` maintainers** — see [For contributors — building from source](#for-contributors--building-from-source) and [CONTRIBUTING.md](../../CONTRIBUTING.md).

## ✨ Why build your renderer on this core?

Build a renderer binding on `core` and you inherit the strengths shared by *every*
SSPlayerForWeb renderer — they come from this core and the `#![no_std]` Rust SDK
it wraps:

- **One core, consistent visuals on every engine.** All the heavy state
  computation — bone matrices, mesh deformation, hierarchical color/opacity —
  happens once here and is emitted as a single cross-engine draw plan. The
  PixiJS v8, standalone WebGL, and RPG Maker MZ renderers all consume the *same*
  plan, so an animation looks identical wherever you render it, with no
  engine-specific visual drift.
- **Compact assets, zero-copy, SIMD.** Animations ship as the columnar `.ssab`
  FlatBuffers binary — zero parsing at load. During playback, transforms and
  geometry are read through `Float32Array` views mapped directly onto WASM
  memory (no per-frame copies), and the Rust core uses SIMD (f32x4) for maximum
  throughput at minimal CPU / memory cost.
- **Reference *and* embedded assets, handled for you.** `core` loads both `.ssab`
  variants — one that **references** external texture files, and one converted
  with `--embedded` that **inlines** its textures. Embedding collapses loading
  from one `.ssab` **plus one HTTP request per texture** down to a **single
  self-contained request**: fewer round-trips, simpler caching and deployment, and
  the asset can even be shipped inline as an `ArrayBuffer` with no sibling files.
  Your renderer just implements the optional `loadTextureFromBytes` to decode
  embedded textures from the binary; omit it and everything falls back to URL
  loading — both paths inherited for free.
- **Runs anywhere a browser does.** The core is the SDK's `#![no_std]` Rust
  compiled to WebAssembly — no OS or DOM assumptions — so playback stays stable
  and allocation-free from memory-constrained mobile browsers to desktop.

## What this package is

`ssplayer-core` wraps the Rust/WASM `ssruntime` and exposes engine-agnostic
playback logic — WASM initialization, time updates, and geometry / state
extraction. It has **no dependency on any rendering engine or the DOM**, so it is
the layer a renderer package sits on top of.

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

1. Implement `IResourceManager` to resolve textures for your engine. Add the
   optional `loadTextureFromBytes` to also render `--embedded` ssab (textures
   inlined in the binary); without it, embedded assets fall back to URL loading.
2. Drive `DirectInternalPlayer.update(deltaMs)` once per frame.
3. Feed the emitted draw batches through `GeometryBuilder` into your GPU path.

[`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) is the reference implementation.

> A `SceneGraphInternalPlayer` facade — for engines that prefer to render into an
> existing scene-graph / `Sprite` tree instead of issuing draw batches directly —
> is planned. For now, build on `DirectInternalPlayer`.

## Memory model

- **Zero-copy:** transform matrices and geometry are read through `Float32Array`
  views mapped directly onto `getWasmMemory().buffer` — no per-frame copies.
- **Memory safety:** WASM memory is not GC'd by JS; the wrappers use
  `FinalizationRegistry` to call the WASM `free()` when the JS object is collected.

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
