# SpriteStudio Player for Web — Roadmap

This file lists unfinished work only. Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations); work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Playback & rendering

- [ ] **Label playback** — Set the playback section by a start and an end label, each with an offset (`setAnimationSectionByLabel`, the stem the SDK's API conventions register); `setAnimationSection` takes frame numbers only. Labels ride in the `.ssab` (`AnimationData.labels`, readable through `ssplayer-core`), so no SDK change is needed: resolve the name to a frame in `ssplayer-core` and every renderer inherits it.
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

## Distribution & verification

- [ ] **A Google Ads HTML5 bundle through review** — `examples/html5-ad` builds a ZIP that passes Google's HTML5 Validator, but none has been submitted, so ad review, and whether the serving frame's Content-Security-Policy lets WebAssembly compile, are unconfirmed. Blocked on: a Google Ads account allowed to upload HTML5.

## Needs SDK

- [ ] **Dynamic Instance Animation Swap** — Replace the animation mounted on an Instance part at runtime (`changeInstanceAnime`). Once the SDK ships it, the binding goes into `ssplayer-core` and the drawing into each renderer (`ssplayer-pixi`, `ssplayer-webgl` and `ssplayer-rmmz`). Waits for: Instance Lifecycle API — Dynamic instance swap (Phase 3).
- [ ] **Stretch a `Nines` part to the element's box** — Once drawn, a Nines part still cannot follow the box CSS gives it: the runtime evaluates its size from its keyframes, and the Override Layer covers colour / cell / visibility only, so the host cannot resize it. Waits for: Per-part size override.

## Backlog

- [ ] **Share event extraction in core** — The FlatBuffer walk over the current animation's events table (`pollEvents` with `dispatchUserData` / `dispatchSignals` / `dispatchAudios`) is written out in `ssplayer-webgl`, `ssplayer-pixi` and `ssplayer-rmmz`, differing only in how `partName` is typed, and core could own it as `SSPartFollower` does for part following. Keeping events out of core was a deliberate call when there were two copies, so revisit that before writing code.

Candidate renderer packages that consume the engine-agnostic `@spritestudio/ssplayer-core` and adapt its `DrawBatch` output to a target scene graph, with no change to the core or the `<ss-player>` element. They are demand-driven: none is scheduled, and each is picked up when a concrete project calls for it. Every ecosystem below already has an established skeletal-animation solution, so the leverage is in keeping the `DrawBatch` adapter path documented and stable, not in shipping backends ahead of demand.

- [ ] **Three.js (`ssplayer-three`)** — Render `DrawBatch` output as textured meshes within a Three.js scene. Unlocks 3D / WebXR contexts (billboards, in-scene UI) and reaches the largest WebGL/WebGPU library audience.
- [ ] **Phaser (`ssplayer-phaser`)** — Adapt `DrawBatch` output to Phaser GameObjects for the HTML5 2D game-framework audience. Low likelihood, since Phaser already has a first-class skeletal-animation integration and this would mainly serve existing SpriteStudio users, though the Mesh2D / Stencil rendering APIs Phaser 4.2 added lower the cost.
- [ ] **Cocos Creator (`ssplayer-cocos`)** — Adapt `DrawBatch` output to a Cocos Creator component for the Asian mobile / mini-game market (WeChat, Douyin). Low likelihood: Cocos Creator already ships built-in skeletal-animation components, so this would mainly serve existing SpriteStudio users.
