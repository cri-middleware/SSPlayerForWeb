# SSPlayerForWeb Roadmap

This document outlines the planned features and architectural updates for the `SSPlayerForWeb` project (the TypeScript/JavaScript wrappers and rendering integrations). 

For the roadmap of the underlying Rust WebAssembly engine, please refer to the submodule's roadmap: [`SpriteStudio-SDK/ROADMAP.md`](./SpriteStudio-SDK/ROADMAP.md).

## Planned Features & SDK Integrations

The following features were present in previous JavaScript-only versions (e.g., `SS6Player`) but require updates to the underlying `SpriteStudio-SDK` WebAssembly FFI before they can be fully implemented in `SSPlayerForWeb`.

*   [ ] **Part Property Override API Integration**
    Implement dynamic runtime modifications for specific parts to support legacy use cases.
    *   *Dependency*: Requires the **Override Layer API** (Phase 2) to be implemented and exposed in the `SpriteStudio-SDK`.
    *   *Target Methods*:
        *   `setPartVisible` / `setPartVisibleByIndex` (Visibility overrides)
        *   `setPartCell` / `setPartCellByIndex` (Cell-reference overrides)
        *   `setPartTint` / `setPartTintByIndex` (Color/Tint overrides)

*   [ ] **Dynamic Instance Animation Swap**
    Support replacing the animation mounted on an Instance part dynamically at runtime.
    *   *Dependency*: Requires the **Instance Lifecycle API (Dynamic instance swap)** (Phase 3) implementation in the `SpriteStudio-SDK`.
    *   *Target Methods*:
        *   `changeInstanceAnime`

*(Note: As the `SpriteStudio-SDK` progresses through its roadmap phases, the corresponding TypeScript bindings and renderer logic will be added to `ssplayer-core` and `ssplayer-pixi` respectively.)*
