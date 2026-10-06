# Changelog

All notable changes to `@spritestudio/ssplayer-pixi` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **First release.** The PixiJS v8 renderer (`pixi.js` is a peer dependency). It re-exports
  `@spritestudio/ssplayer-core`, so it is the only package to install.
- The per-part overrides and the flip and offset of `@spritestudio/ssplayer-core`. Flip and offset
  change what the player draws without touching its display object, so its children —
  part-following targets included — stay where they are.
