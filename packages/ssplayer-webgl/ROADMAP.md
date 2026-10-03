# ssplayer-webgl — Roadmap

This file lists unfinished work that is specific to this package; work for the Web Player as a whole is in the [root ROADMAP](../../ROADMAP.md). Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations), and work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Distribution & verification

- [ ] **Single-HTML playable-ad sample** — A fully inlined minimal page (WASM, `.ssab` and textures as base64) that needs no fetch. `SSSurface.initialize()` takes the WASM bytes and `loadBuffer()` takes the `.ssab` bytes already; no sample in `examples/` inlines its assets.
