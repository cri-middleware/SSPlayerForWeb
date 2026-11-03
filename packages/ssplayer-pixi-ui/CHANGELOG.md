# Changelog

All notable changes to `@spritestudio/ssplayer-pixi-ui` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and the package adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **First release.** `SSButton`, a [`@pixi/ui`](https://github.com/pixijs/ui) `ButtonContainer`
  whose look is one SpriteStudio animation: hover, press, keyboard focus and `enabled = false` each
  play the section that starts at a label of the same name. `@pixi/ui` and `pixi.js` are peer
  dependencies; it re-exports `@spritestudio/ssplayer-pixi`, so it is the only package to install.
- A pointer can be made to count only on some of the animation's parts.
