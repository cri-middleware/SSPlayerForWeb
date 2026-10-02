# Changelog

All notable changes to this repository are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the packages
adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Per-package versioning.** This is a monorepo whose packages are versioned and published
> independently. Package-level history lives in each package's own `CHANGELOG.md`; this file
> records repository-wide milestones.

## [Unreleased]

### Added
- **Initial public release (work in progress).** A collection of Web players that run
  SpriteStudio animations (`.ssab`) in the browser, sharing one WebAssembly core built on the
  SpriteStudio-SDK Rust runtime (`libssruntime`).
- **Playback packages**:
    - `@spritestudio/ssplayer-core` — the engine-agnostic core (WASM runtime + `DrawBatch`
      consumption), for building your own renderer.
    - `@spritestudio/ssplayer-webgl` — the framework-free renderer, including the `<ss-player>`
      Web Component.
    - `@spritestudio/ssplayer-pixi` — the PixiJS v8 renderer (`pixi.js` is a peer dependency).
      Each renderer re-exports the core, so only one package needs installing.
- **Conversion packages**:
    - `@spritestudio/ssconverter-core` — `libssconverter` compiled to WebAssembly, for embedding
      conversion in your own app or service.
    - `ssconverter-web` — the browser tool and Node CLI that turn `.sspj` into `.ssab`. Conversion
      runs entirely client-side; nothing is uploaded.
- **Framework integrations** (shipped as IIFE plugin bundles rather than npm installs):
  `@spritestudio/ssplayer-rmmz` for RPG Maker MZ (PixiJS v5, beta),
  `@spritestudio/ssplayer-tyranoscript` for TyranoScript (beta), and
  `@spritestudio/ssplayer-tyranobuilder` for TyranoBuilder (beta).
- **Per-part runtime overrides**: `setPartColorOverride` / `setPartColorOverrideCorners`,
  `setPartCellOverride`, `setPartVisibilityOverride`, their `clear…` counterparts, and
  `clearAllPartOverrides` — each taking a part **name or index**. Available on every player, plus
  RPG Maker MZ plugin commands and TyranoScript `[ss_part_*]` tags.
- **Flip and offset**: `flipX` / `flipY` / `offsetX` / `offsetY` on every player. They mirror or
  shift what the player *draws* without touching the host display object, so its children —
  part-following targets included — stay where they are. Part transforms are reported in the
  mirrored pose, so followers stay pinned across a flip.
- **One WebGL context for any number of animations.** An `SSSurface` owns the context and carries
  as many `SSPlayer`s as you like, so the browser's limit of roughly 8–16 live contexts applies to
  surfaces rather than to animations. `<ss-player>` elements share a page-level overlay by default
  (`standalone` opts an element out), the TyranoScript plugin uses one surface per layer rather
  than per character, and textures are uploaded once per surface and shared between its players.
- **Events, shaders, and performance tuning** documented under *Customize* in the docs site.

### Known Limitations
- The framework integrations are not published to npm. RPG Maker MZ, TyranoScript and
  TyranoBuilder are all **beta**.
- Playback requires a browser with **WebAssembly SIMD**; `ssplayer-webgl` needs WebGL 1 or 2, and
  `ssplayer-pixi` needs WebGL 2 (using WebGPU where the browser provides it).
- Constraints inherited from the shared runtime — `independent=true` parts under reverse playback
  and seeking, seeking not firing skipped events, no reverse audio, single-`.ssab` blending — are
  documented in
  [Shared Limitations](https://cri-middleware.github.io/SpriteStudio-Docs/sdk/limitations/).
- Dynamic instance-animation swap (`changeInstanceAnime`) is not available yet; it waits on the
  SDK's Instance Lifecycle API (see [ROADMAP.md](./ROADMAP.md)).

[Unreleased]: https://github.com/cri-middleware/SSPlayerForWeb/commits/main
