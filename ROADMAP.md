# SSPlayerForWeb Roadmap

This document outlines the planned features and architectural updates for the `SSPlayerForWeb` project (the TypeScript/JavaScript wrappers and rendering integrations). 

For the roadmap of the underlying Rust WebAssembly engine, please refer to the submodule's roadmap: [`SpriteStudio-SDK/ROADMAP.md`](./SpriteStudio-SDK/ROADMAP.md).

## Planned Features & SDK Integrations

The following features were present in previous JavaScript-only versions (e.g., `SS6Player`) but require updates to the underlying `SpriteStudio-SDK` WebAssembly FFI before they can be fully implemented in `SSPlayerForWeb`.

*   [x] **Part Property Override API Integration** — *done*
    Dynamic runtime modification of specific parts, covering the legacy `SS6Player`
    use cases (PartsColorChange / CellChangeParts / HideSet).
    *   *Shipped as*: `setPartColorOverride` / `setPartColorOverrideCorners`,
        `setPartCellOverride`, `setPartVisibilityOverride`, their `clear…`
        counterparts and `clearAllPartOverrides` — each taking a part **name or
        index**, so no separate `…ByIndex` methods were needed.
    *   Available on every player, plus RPG Maker MZ plugin commands and
        TyranoScript `[ss_part_*]` tags. See
        [Part control](https://cri-middleware.github.io/SSPlayerForWeb/customize/part-overrides).

*   [ ] **Dynamic Instance Animation Swap**
    Support replacing the animation mounted on an Instance part dynamically at runtime.
    *   *Dependency*: Requires the **Instance Lifecycle API (Dynamic instance swap)** (Phase 3) implementation in the `SpriteStudio-SDK`.
    *   *Target Methods*:
        *   `changeInstanceAnime`

*(Note: As the `SpriteStudio-SDK` progresses through its roadmap phases, the corresponding TypeScript bindings and renderer logic will be added to `ssplayer-core` and `ssplayer-pixi` respectively.)*

## Potential Renderer Integrations

Candidate renderer packages that could be added alongside the existing `ssplayer-pixi` / `ssplayer-webgl` backends. Each would be a new package that consumes the engine-agnostic `@spritestudio/ssplayer-core` and adapts the `DrawBatch` output to the target renderer's scene graph — no changes to the core or the `<ss-player>` Custom Element are required.

These are **demand-driven**: none of them is scheduled on its own, and each is picked up when a concrete project calls for it. Every 2D ecosystem listed below already has an established skeletal-animation solution, so a package published ahead of demand is unlikely to be found on its own merits. The leverage is in keeping the `DrawBatch` adapter path documented and stable — so that a new backend can be written in days once it is genuinely needed — rather than in shipping backends speculatively.

*   [ ] **Three.js** (`ssplayer-three`)
    Render `DrawBatch` output as textured meshes within a Three.js scene. Unlocks 3D / WebXR contexts (billboards, in-scene UI) and reaches the largest WebGL/WebGPU library audience.
*   [ ] **Phaser** (`ssplayer-phaser`)
    Adapt `DrawBatch` output to Phaser GameObjects for the HTML5 2D game-framework audience. *Low likelihood*: Spine is a first-class citizen in Phaser 4 — the Phaser team added the Mesh2D / Stencil rendering APIs in 4.2 specifically so that Esoteric Software could rebuild `spine-phaser-v4` on top of them — so a third-party SpriteStudio integration faces a strong incumbent; primarily of value as a shipping target for existing SpriteStudio users rather than for new-market acquisition. Those same 4.2 APIs do lower the implementation cost, and `spine-phaser-v4` is a public reference implementation of the integration path.
*   [ ] **Cocos Creator** (`ssplayer-cocos`)
    Adapt `DrawBatch` output to a Cocos Creator component for the Asian mobile / mini-game market (WeChat, Douyin). *Low likelihood*: Cocos Creator already ships built-in Spine and DragonBones skeletal-animation components, so a third-party SpriteStudio integration faces strong incumbents; primarily of value as a shipping target for existing SpriteStudio users rather than for new-market acquisition.
