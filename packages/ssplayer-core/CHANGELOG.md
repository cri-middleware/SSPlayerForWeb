# Changelog

All notable changes to `@spritestudio/ssplayer-core` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [7.0.0-beta.1] - 2026-11-18

### Added
- **First release.** The engine-agnostic core of the SpriteStudio player: the SpriteStudio-SDK
  runtime (`libssruntime`) compiled to WebAssembly, plus `DrawBatch` consumption, for building
  your own renderer. The renderer packages re-export it.
- **Per-part runtime overrides**: `setPartColorOverride` / `setPartColorOverrideCorners`,
  `setPartCellOverride`, `setPartVisibilityOverride`, their `clear…` counterparts, and
  `clearAllPartOverrides` — each taking a part **name or index**.
- **Flip and offset**: `flipX` / `flipY` / `offsetX` / `offsetY` mirror or shift what the player
  draws. Part transforms are reported in the mirrored pose, so followers stay pinned across a
  flip.
