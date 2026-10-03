# SpriteStudio Player for Web — Roadmap

This file lists unfinished work only. Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations); work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Playback & rendering

- [ ] **Animation blending / crossfade** — Layer and cross-fade animations on one player through the runtime's track stack. The WASM build already exports the track calls; what is missing is the JS surface in `ssplayer-core` and the renderers on top of it, named after the stems in [Player API Conventions](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/20_design/30_api_conventions.md) §3-2 (`setTrackAnimation`, `crossfade`, `addTrackSource`, `fadeTrack`, …) and designed as in [Animation mixing](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/50_features/10_animation_mixing.md). It is a selling point rather than a release blocker, so it follows the first release; SpriteStudio Player for wgpu, the one official player that surfaces it, is the reference.
- [ ] **Label playback** — Play a named label range, with start and end offsets. `setAnimationSection` takes frame numbers only, so a label the animation already carries cannot be named from the host. Labels ride in the `.ssab` (`AnimationData.labels`, readable through `ssplayer-core`), so no SDK change is needed: resolve the name to a frame in `ssplayer-core` and every renderer inherits it.
- [ ] **Confirm the five approximated blend modes** — `Mulalpha` and `Mul2` draw as Mul, `Screen2` as Screen, and `Div2` and `Overlay2` as Mix, in `ssplayer-webgl` and `ssplayer-pixi` alike (one table, `ssBlendMode` in `ssplayer-core`) and as in SpriteStudio Player for wgpu. The approximation is listed in [Shaders and blend modes](https://cri-middleware.github.io/SSPlayerForWeb/customize/shaders); none of the five has been checked against a reference render.

## UI integration

The DOM *is* the UI toolkit here, and `<ss-player>` is already the integration point — a Custom Element with a `ResizeObserver`, a shared-overlay mode and a standalone mode, and it fits the animation into its box. The vocabulary is shared with the sibling Players: `fit` / `align` for placement, a part rect read-out for hit areas, and a UI-state map.

- [ ] **Per-part hit testing and pointer events** — An animation cannot be clicked on its artwork: the shared overlay canvas is `pointer-events: none` (`SSOverlay`), and a standalone element answers as a rectangle.
  - [ ] A part rect read-out built from the `PartState` fields the runtime already delivers every frame (`size_x` / `size_y`, `anchor`, `pivot`) plus `getPartTransform`. It also positions a DOM overlay on a part, which `getPartTransform` leaves entirely to the caller.
  - [ ] `hitTestPart(x, y)` in element coordinates, with the `fit` transform applied. The element answers from it rather than the canvas, which keeps overlay mode `pointer-events: none` and still clickable.
- [ ] **UI state binding and ARIA** — A player used as a button is a picture to the page: it takes no role, no label and no state.
  - [ ] Map `normal` / `hover` / `pressed` / `disabled` / `focused` to an animation or a label, driven by the element's own pointer / focus events, so the animation follows `:hover` and `:focus-visible` without page script.
  - [ ] Pass through `role` / `aria-label`, and mark a decorative player `aria-hidden`.
- [ ] **`Text` parts** — The Brain emits a geometry-less `Text` batch per text part and leaves glyphs to the Player, so a UI label authored in SpriteStudio draws nothing here. Draw it, and allow substituting the string at runtime — a UI label that cannot be localized is not a UI label.
- [ ] **Draw `Nines` parts** — The runtime builds the 9-slice grid into its `get_nines_*` buffers, but no renderer reads them, so a Nines part draws as nothing (see [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations)).

## Needs SDK

- [ ] **Dynamic Instance Animation Swap** — Replace the animation mounted on an Instance part at runtime (`changeInstanceAnime`). Once the SDK ships it, the binding goes into `ssplayer-core` and the drawing into each renderer (`ssplayer-pixi`, `ssplayer-webgl` and `ssplayer-rmmz`). Waits for: Instance Lifecycle API — Dynamic instance swap (Phase 3).
- [ ] **Stretch a `Nines` part to the element's box** — Once drawn, a Nines part still cannot follow the box CSS gives it: the runtime evaluates its size from its keyframes, and the Override Layer covers colour / cell / visibility only, so the host cannot resize it. Waits for: Per-part size override (Phase 3).

## Backlog

- [ ] **Share event extraction in core** — The FlatBuffer walk over the current animation's events table (`pollEvents` with `dispatchUserData` / `dispatchSignals` / `dispatchAudios`) is written out in `ssplayer-webgl`, `ssplayer-pixi` and `ssplayer-rmmz`, differing only in whether `partName` is typed `string` or `string | null`. Core could own the walk and each renderer keep its call site, as `SSPartFollower` does for part following. Keeping events out of core was a deliberate call made when there were two copies, so revisit it before writing code.

Candidate renderer packages that consume the engine-agnostic `@spritestudio/ssplayer-core` and adapt its `DrawBatch` output to a target scene graph, with no change to the core or the `<ss-player>` element. They are demand-driven: none is scheduled, and each is picked up when a concrete project calls for it. Every ecosystem below already has an established skeletal-animation solution, so the leverage is in keeping the `DrawBatch` adapter path documented and stable, not in shipping backends ahead of demand.

- [ ] **Three.js** (`ssplayer-three`) — Render `DrawBatch` output as textured meshes within a Three.js scene. Unlocks 3D / WebXR contexts (billboards, in-scene UI) and reaches the largest WebGL/WebGPU library audience.
- [ ] **Phaser** (`ssplayer-phaser`) — Adapt `DrawBatch` output to Phaser GameObjects for the HTML5 2D game-framework audience. Low likelihood: Spine is a first-class citizen in Phaser 4 — the Phaser team added the Mesh2D / Stencil rendering APIs in 4.2 specifically so that Esoteric Software could rebuild `spine-phaser-v4` on top of them — so a third-party SpriteStudio integration faces a strong incumbent, and it is mainly a shipping target for existing SpriteStudio users. Those same 4.2 APIs do lower the implementation cost, and `spine-phaser-v4` is a public reference implementation of the integration path.
- [ ] **Cocos Creator** (`ssplayer-cocos`) — Adapt `DrawBatch` output to a Cocos Creator component for the Asian mobile / mini-game market (WeChat, Douyin). Low likelihood: Cocos Creator already ships built-in Spine and DragonBones skeletal-animation components, so a third-party SpriteStudio integration faces strong incumbents, and it is mainly a shipping target for existing SpriteStudio users.
