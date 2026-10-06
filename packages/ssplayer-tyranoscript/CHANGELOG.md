# Changelog

All notable changes to `@spritestudio/ssplayer-tyranoscript` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **First release (beta).** Shows and plays SpriteStudio animations in a TyranoScript scenario
  through `[ss_*]` tags.
- **Per-part overrides** through the `[ss_part_*]` tags.
- **One WebGL surface per layer** rather than per character, so a scene's characters share a
  context and stay under the browser's limit on live WebGL contexts.
