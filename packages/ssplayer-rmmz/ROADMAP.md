# ssplayer-rmmz — Roadmap

This file lists unfinished work that is specific to the RPG Maker MZ plugin; work for the Web Player as a whole is in the [root ROADMAP](../../ROADMAP.md). Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations), and work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Playback & rendering

- [ ] **Forward MZ's picture tint** — Tint Picture does not reach the animation, while opacity does, through the world tint `SSPlayerRenderer` already passes to `SSWebGLRenderer`. Pass the tint the same way.
- [ ] **Keep the animation in place under PIXI filters** — `SSWebGLRenderer` builds a fixed projection from the canvas size, so a filter on the sprite can shift the animation. It needs a projection input on the renderer, which is a change in `ssplayer-webgl`.
- [ ] **Signal command ID as a game variable** — `signalSwitch` turns one switch ON for any signal and never OFF. Filter by command ID and store it in a variable, as `[ss_wait_signal command= var=]` does in `ssplayer-tyranoscript`; parameters stay out, as there.
- [ ] **One texture upload per image URL** — Each picture builds its own `RMMZResourceManager`, so two pictures of one `.ssab` upload the atlas twice. Share one `SSWebGLTextureCache` per GL context, keyed by URL and not refcounted, as in `ssplayer-webgl`. The manager loads through MZ's `ImageManager`, so it has to route through the cache.

## Distribution & verification

- [ ] **Check blend modes, PartsColor, mask parts and the SS shaders in a real MZ** — The renderer is `ssplayer-webgl`'s, and the MZ-side GL state around it has not been checked for these. A manual check; the blend-mode mappings themselves are in the [root ROADMAP](../../ROADMAP.md).

## Backlog

- [ ] **Map events and battlers** — The animation attaches to `Sprite_Picture` only. Attaching to `Sprite_Character` or a battler needs foot-origin handling, and how MZ's picture origin and anchor map onto the animation's own origin should be checked in MZ and documented first.
- [ ] **Plugin parameters for the default SE volume, pitch and pan** — Fixed at 90 / 100 / 0 today.

## Deliberate non-goals

- **A jsdom MZ stub for the bridge, boot gate, wait mode and lip-sync** — They monkey-patch MZ globals, and regressions are guarded by running the real engine instead.
