# Changelog

All notable changes to `@spritestudio/ssplayer-webgl` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **First release.** The framework-free WebGL 1/2 renderer, including the `<ss-player>` Web
  Component. It re-exports `@spritestudio/ssplayer-core`, so it is the only package to install.
- **One WebGL context for any number of animations.** An `SSSurface` owns the context and carries
  as many `SSPlayer`s as you like, so the browser's limit of roughly 8–16 live contexts applies to
  surfaces rather than to animations. `<ss-player>` elements share a page-level overlay by default
  (`standalone` opts an element out), and textures are uploaded once per surface and shared
  between its players.
- The per-part overrides and the flip and offset of `@spritestudio/ssplayer-core`.
