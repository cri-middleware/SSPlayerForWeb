# SpriteStudio Player for Web Roadmap

This document outlines the planned features and architectural updates for SpriteStudio Player for Web (the TypeScript/JavaScript wrappers and rendering integrations). 

For the roadmap of the underlying Rust WebAssembly engine, please refer to the submodule's roadmap: [`SpriteStudio-SDK/ROADMAP.md`](./SpriteStudio-SDK/ROADMAP.md).

## Planned Features & SDK Integrations

This feature needs an update to the underlying `SpriteStudio-SDK` WebAssembly FFI before it can be implemented in SpriteStudio Player for Web.

*   [ ] **Dynamic Instance Animation Swap**
    Support replacing the animation mounted on an Instance part dynamically at runtime.
    *   *Dependency*: Requires the **Instance Lifecycle API (Dynamic instance swap)** (Phase 3) implementation in the `SpriteStudio-SDK`.
    *   *Target Methods*:
        *   `changeInstanceAnime`

*(Note: Once the `SpriteStudio-SDK` ships that API, the TypeScript binding goes into `ssplayer-core` and the drawing into each renderer — `ssplayer-pixi`, `ssplayer-webgl` and `ssplayer-rmmz`.)*

## Player-side features

This needs no new SDK API — the runtime already provides everything required. It is a player
responsibility the
[Player Porting Guide](https://github.com/cri-middleware/SpriteStudio-SDK/tree/HEAD/libs/ssruntime/docs)
describes and an official player implements, but this one does not yet.

*   [ ] **Animation blending / crossfade** — *after the first release*
    Layer and cross-fade animations on one player through the runtime's track stack. The runtime
    side is complete and the WASM build already exports the track calls; what is missing is the
    JS surface in `ssplayer-core` and the renderers on top of it.
    *   *Reference*: SpriteStudio Player for wgpu, the one official player that surfaces it
        (`set_track_animation` / `crossfade` / `fade_track` / …). The names follow the stems in
        the SDK's [Player API Conventions](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/20_design/30_api_conventions.md)
        §3-2 — `setTrackAnimation`, `crossfade`, `addTrackSource`, `fadeTrack`, … — and the
        design is its [Animation mixing](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/50_features/10_animation_mixing.md)
        page.
    *   *Deferred*: a selling point, not a release blocker.

## DOM / UI integration

The DOM *is* the UI toolkit here, and `<ss-player>` is already the integration point — a Custom Element with a `ResizeObserver`, a shared-overlay mode and a standalone mode, and it fits the animation into its box. What is missing is everything past drawing and placement: an element that receives pointers and announces itself the way a control on the page does. The vocabulary is shared with the sibling Players — `fit` / `align` for placement, a part rect read-out for hit areas, and a UI-state map.

*   [ ] **Per-part hit testing and pointer events**
    An animation cannot be clicked on its artwork. Overlay mode makes it explicit — the shared canvas is
    `pointer-events: none` (`SSOverlay.ts:98`) — and standalone mode is no better, answering as a rectangle.
    *   *Target*: a **part rect read-out** built from the `PartState` fields the runtime already delivers
        every frame (`size_x` / `size_y`, `anchor`, `pivot`) plus `getPartTransform`, then `hitTestPart(x, y)`
        in element coordinates, with the `fit` transform applied. The element answers from it rather than the
        canvas, which is what lets overlay mode stay `pointer-events: none` and still be clickable.
    *   The same read-out is what positions a DOM overlay on a part — the case `getPartTransform` documents
        today and leaves entirely to the caller.

*   [ ] **UI state binding and ARIA**
    A player used as a button is a picture to the page: it takes no role, no label, and no state.
    *   *Target*: map `normal` / `hover` / `pressed` / `disabled` / `focused` to an animation or a label,
        driven by the element's own pointer / focus events, so the animation follows `:hover` and
        `:focus-visible` without page script; and pass through `role` / `aria-label`, with a decorative
        player marked `aria-hidden`.

*   [ ] **`Text` parts**
    The Brain emits a geometry-less `Text` batch per text part and leaves glyphs to the Player, so a UI
    label authored in SpriteStudio draws nothing here. Draw it, and allow substituting the string at
    runtime — a UI label that cannot be localized is not a UI label.

*   [ ] **Stretch a `Nines` part to the element's box** — *needs SDK*
    The runtime evaluates a Nines part's size from its keyframes and hands over finished vertices
    (`get_nines_*`), and the Override Layer covers colour / cell / visibility only, so nothing can resize one
    from the host: an authored window frame cannot follow the box CSS gives it, and scaling the player
    distorts the border art instead of stretching the middle.
    *   *Dependency*: the SDK roadmap's **Per-part size override** (Phase 3) — the Override Layer extended
        with `size_x` / `size_y`.

## Potential Renderer Integrations

Candidate renderer packages that could be added alongside the existing `ssplayer-pixi` / `ssplayer-webgl` backends. Each would be a new package that consumes the engine-agnostic `@spritestudio/ssplayer-core` and adapts the `DrawBatch` output to the target renderer's scene graph — no changes to the core or the `<ss-player>` Custom Element are required.

These are **demand-driven**: none of them is scheduled on its own, and each is picked up when a concrete project calls for it. Every 2D ecosystem listed below already has an established skeletal-animation solution, so a package published ahead of demand is unlikely to be found on its own merits. The leverage is in keeping the `DrawBatch` adapter path documented and stable — so that a new backend can be written in days once it is genuinely needed — rather than in shipping backends speculatively.

*   [ ] **Three.js** (`ssplayer-three`)
    Render `DrawBatch` output as textured meshes within a Three.js scene. Unlocks 3D / WebXR contexts (billboards, in-scene UI) and reaches the largest WebGL/WebGPU library audience.
*   [ ] **Phaser** (`ssplayer-phaser`)
    Adapt `DrawBatch` output to Phaser GameObjects for the HTML5 2D game-framework audience. *Low likelihood*: Spine is a first-class citizen in Phaser 4 — the Phaser team added the Mesh2D / Stencil rendering APIs in 4.2 specifically so that Esoteric Software could rebuild `spine-phaser-v4` on top of them — so a third-party SpriteStudio integration faces a strong incumbent; primarily of value as a shipping target for existing SpriteStudio users rather than for new-market acquisition. Those same 4.2 APIs do lower the implementation cost, and `spine-phaser-v4` is a public reference implementation of the integration path.
*   [ ] **Cocos Creator** (`ssplayer-cocos`)
    Adapt `DrawBatch` output to a Cocos Creator component for the Asian mobile / mini-game market (WeChat, Douyin). *Low likelihood*: Cocos Creator already ships built-in Spine and DragonBones skeletal-animation components, so a third-party SpriteStudio integration faces strong incumbents; primarily of value as a shipping target for existing SpriteStudio users rather than for new-market acquisition.
