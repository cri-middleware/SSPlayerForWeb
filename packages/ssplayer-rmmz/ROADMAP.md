# ssplayer-rmmz — Roadmap

This file lists unfinished work that is specific to the RPG Maker MZ plugin; work for the Web Player as a whole is in the [root ROADMAP](../../ROADMAP.md). Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations), and work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Playback & rendering

- [ ] **Keep the animation in place under a sprite's PIXI filter** — Tint Picture is a `ColorFilter` on the picture's own sprite. The filter renders into a texture sized to the sprite's bounds, to which the animation adds nothing, while `SSWebGLRenderer` draws with a fixed projection from the canvas size, so the animation can shift. The filters MZ puts over the whole spriteset are unaffected, as their texture is the whole screen. Give the filter the whole screen as its area, or give the renderer a projection input, which is a change in `ssplayer-webgl`. Tint then reaches the animation through the filter: MZ's tone adds to the colour and desaturates it, which the multiplying world tint passed for opacity cannot carry.
- [ ] **Signal command ID as a game variable** — `signalSwitch` turns one switch ON for any signal and never OFF. Filter by command ID and store it in a variable, as `[ss_wait_signal command= var=]` does in `ssplayer-tyranoscript`; parameters stay out, as there.
- [ ] **One texture upload per image URL** — Each picture builds its own `RMMZResourceManager`, so two pictures of one `.ssab` upload the atlas twice. Share one `SSWebGLTextureCache` per GL context, keyed by URL and not refcounted, as in `ssplayer-webgl`. The manager loads through MZ's `ImageManager`, so it has to route through the cache.

## Backlog

- [ ] **Battlers** — Play an animation in place of an enemy's image, in front and side view, and of a side-view actor's sheet, named in the database note field. Their selection flash, whiten and collapse are a `ColorFilter` on the battler's sprite, so **Keep the animation in place under a sprite's PIXI filter** comes first, and a troop that repeats an enemy wants **One texture upload per image URL**. Touch targeting reads the sprite's width and height, which the authored canvas (`getCanvasRect()`) can supply. It needs foot-origin handling, and how MZ's picture origin and anchor map onto the animation's own origin should be checked in MZ and documented first. An actor's motions map to animation names and switch with a crossfade. Battle-system plugins that replace these sprites are out of scope.
- [ ] **Map events** — Attach to `Sprite_Character`, with the same foot-origin handling as **Battlers**.
- [ ] **Plugin parameters for the default SE volume, pitch and pan** — Fixed at 90 / 100 / 0 today.

## Deliberate non-goals

- **A jsdom MZ stub for the bridge, boot gate, wait mode and lip-sync** — They monkey-patch MZ globals, and regressions are guarded by running the real engine instead.
