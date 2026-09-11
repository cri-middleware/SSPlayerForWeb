# @spritestudio/ssplayer-webgl Roadmap

A **zero-dependency, ad-grade WebGL1/2 renderer** for the SpriteStudio player,
built directly on `ssplayer-core` (no PixiJS). Its design is driven by playable
/ banner ad constraints — **bundle size and runtime performance are first-class**
— so optional features are split into tree-shakeable modules and the base bundle
stays minimal.

For the overall project roadmap see [`../../ROADMAP.md`](../../ROADMAP.md); for
the underlying Rust/WASM engine see
[`../../SpriteStudio-SDK/ROADMAP.md`](../../SpriteStudio-SDK/ROADMAP.md). As with
the other Players, several remaining items are gated on `SpriteStudio-SDK` FFI
work (see *Blocked on SpriteStudio-SDK* below).

## Implemented

*   [x] WebGL1 baseline with WebGL2 auto-upgrade (VAO / `uint32` index / NPOT).
*   [x] PartsColor rendering — Normal / Shape / Mesh parts.
*   [x] Part property overrides — `setPart{Color,Cell,Visibility}Override` (name- or index-keyed) and their `clear…` counterparts.
*   [x] All SS blend modes as fixed-function GL state.
*   [x] Stencil mask and Effect (particle) rendering.
*   [x] SpriteStudio integration shaders (`ss-*`, the `SHDR` attribute).
*   [x] Inline-asset path (`ArrayBuffer` / `Uint8Array` / data-URI; no fetch required).
*   [x] Animation events (`onUserData` / `onSignal` / `onAudio` / `onAnimationFinished` / `onAnimationLooped`).
*   [x] Tree-shakeable optional modules and a `./lite` entry (`sideEffects: false`).
*   [x] Optional `<ss-player>` custom element.
*   [x] GL context-loss recovery (`webglcontextlost` / `restored`; rebuild GL objects and re-upload textures).
*   [x] Visibility gating (`pauseWhenHidden`: `IntersectionObserver` + `visibilitychange`).
*   [x] Fragment `highp` precision detection with `mediump` fallback.
*   [x] Ad-friendly context attributes and zero-GC hot path (VBO/scratch pooling, `maxDPR` clamp).

## Shared with the other renderer packages

*   [ ] **Event extraction exists three times.** `pollEvents` plus
    `dispatchUserData` / `dispatchSignals` / `dispatchAudios` — the FlatBuffer
    walk over the current animation's events table — is written out here, in
    `ssplayer-pixi` and in `ssplayer-rmmz`, differing only in whether
    `partName` is typed `string` or `string | null`. Keeping events out of core
    was a deliberate call made when there were two copies of it; with three, and
    with the part-following bookkeeping since moved into core
    (`SSPartFollower`), it is worth revisiting. The seam is the same one that
    worked there: core owns the walk, each renderer keeps the dispatch timing,
    which is the part that genuinely differs (a ticker here, `renderFrame` in
    pixi, the host sprite's `update()` in rmmz). **Revisit the decision before
    writing any code** — it is recorded, not accidental.

## Verification & Release Process

*   [ ] **Emulated blend-mode verification** — confirm the
    `Mulalpha` / `Mul2` / `Div2` / `Screen2` / `Overlay2` GL mappings against
    `SS6PlayerForUnity` (they currently mirror the pixi mapping, pending checks).
*   [ ] **CI size-budget tracking** — wire `scripts/measure-size.mjs` into CI and
    gate the JS(gz) / WASM(gz) budgets.
*   [ ] **Single-HTML playable-ad sample** — a fully-inlined minimal sample
    (wasm + ssab + textures as base64). The Vite `examples/webgl-example` and the
    `<ss-player>` element demo already ship.

## Blocked on SpriteStudio-SDK

These require underlying `SpriteStudio-SDK` runtime / FFI work before the
renderer can wire them up.

*   [ ] **label-seek** — awaiting the corresponding SDK API.
*   [ ] **Animation blending / crossfade** — the WASM C-API exists; the JS wiring
    is pending.

(Runtime texture swap is a player-side feature, not SDK-blocked; the resource
manager's `bindTextureSource()` already provides the partial primitive — see
[`../../ROADMAP.md`](../../ROADMAP.md).)

## Items not on the roadmap by design

*   **Audio playback engine** — the runtime plays no sound; `IAudioManager` is an
    injection point only (bundle-size reasons). `SSWebAudioManager` ships as an
    optional adapter.
*   **DOM / scene-graph integration and UI** — a host responsibility; this package
    renders to a single canvas only.
*   **Tyrano integration** — a thin adapter kept in a separate `ssplayer-tyranoscript`
    package (see [`../ssplayer-tyranoscript/README.md`](../ssplayer-tyranoscript/README.md) and
    its [`ROADMAP.md`](../ssplayer-tyranoscript/ROADMAP.md)).
