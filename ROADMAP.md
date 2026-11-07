# SpriteStudio Player for Web — Roadmap

This file lists unfinished work only. Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations); work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Before 7.0.0

- [ ] **Take the SDK's base-folder and error fixes** — The SDK is resolving a project's base folders in the in-memory converter and throwing JavaScript `Error`s from WebAssembly. Bump the submodule, then drop the `Error` wrapping in `SSABResource` and `convertProject`.
- [ ] **Release the GL context with a `standalone` surface** — `SSSurface.destroy()` keeps the context, because `<ss-player>` reuses its canvas on reconnect, so a page that mounts and unmounts standalone elements runs into the browser's context limit and loses the oldest one. Lose the context on destroy and give a reconnect a fresh canvas.
- [ ] **Drop `engines` from the published packages** — `"node": ">=24"` is the requirement for working on this repository, but it ships in the five npm packages, so an app built on an older Node gets an `EBADENGINE` warning and yarn classic refuses the install.
- [ ] **Say when `setCellmapTexture` matches nothing** — An unknown name is a silent no-op, so a typo reads as a texture that did not change. Warn when the pack has no such cell map.
- [ ] **Tighten the Node CLI's arguments** — In `packages/ssconverter-web/scripts/cli.js`, `--help` reads as a file name, an unknown option such as `--embeded` is ignored with a successful exit, `-o` and `--suffix` silently go without a value, and of several paths the last wins. Refuse all of them, and add `--help`.
- [ ] **Keep the Node CLI's output off its input** — With no `-o` it copies each texture onto itself (`EACCES` when read-only), `-e` overwrites the normal conversion under the same name, and an output folder inside the project is read back as input next time. Skip the copy onto itself, and give `-e` the `_emb` the converter page and the native CLI use.
- [ ] **Treat a conversion with no output as a failure** — A `.sspj` with no animation packs reports success in the converter page (with an empty ZIP) and in the Node CLI (exit 0). `examples/sspj-preview` already treats it as an error.
- [ ] **Keep TyranoScript characters through `[backlay]` + `[trans layer=]`** — The engine replaces the layer element, which releases the players on it. Carry them over to the new layer.

## Playback & rendering

- [ ] **Confirm the five approximated blend modes** — `Mulalpha` and `Mul2` draw as Mul, `Screen2` as Screen, and `Div2` and `Overlay2` as Mix, in `ssplayer-webgl` and `ssplayer-pixi` alike (one table, `ssBlendMode` in `ssplayer-core`) and as in SpriteStudio Player for wgpu. The approximation is listed in [Shaders and blend modes](https://cri-middleware.github.io/SSPlayerForWeb/customize/shaders); none of the five has been checked against a reference render.
- [ ] **`Text` parts** — The Brain emits a geometry-less `Text` batch per text part and leaves glyphs to the Player, so a UI label authored in SpriteStudio draws nothing here. Draw it, and allow substituting the string at runtime — a UI label that cannot be localized is not a UI label.
- [ ] **Draw `Nines` parts** — The runtime builds the 9-slice grid into its `get_nines_*` buffers, but no renderer reads them, so a Nines part draws as nothing (see [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations)).

## Distribution & verification

- [ ] **A Google Ads HTML5 bundle through review** — `examples/html5-ad` builds a ZIP that passes Google's HTML5 Validator, but none has been submitted, so ad review, and whether the serving frame's Content-Security-Policy lets WebAssembly compile, are unconfirmed. Blocked on: a Google Ads account allowed to upload HTML5.

## Needs SDK

- [ ] **Dynamic Instance Animation Swap** — Replace the animation mounted on an Instance part at runtime (`changeInstanceAnime`). Once the SDK ships it, the binding goes into `ssplayer-core` and the drawing into each renderer (`ssplayer-pixi`, `ssplayer-webgl` and `ssplayer-rmmz`). Waits for: Instance Lifecycle API — Dynamic instance swap (Phase 3).
- [ ] **Stretch a `Nines` part to the element's box** — Once drawn, a Nines part still cannot follow the box CSS gives it: the runtime evaluates its size from its keyframes, and the Override Layer covers colour / cell / visibility only, so the host cannot resize it. Waits for: Per-part size override.

## Backlog

- [ ] **Share event extraction in core** — The FlatBuffer walk over the current animation's events table (`pollEvents` with `dispatchUserData` / `dispatchSignals` / `dispatchAudios`) is written out in `ssplayer-webgl`, `ssplayer-pixi` and `ssplayer-rmmz`, differing only in how `partName` is typed, and core could own it as `SSPartFollower` does for part following. Keeping events out of core was a deliberate call when there were two copies, so revisit that before writing code.

Candidate renderer packages that consume the engine-agnostic `@spritestudio/ssplayer-core` and adapt its `DrawBatch` output to a target scene graph, with no change to the core or the `<ss-player>` element. They are demand-driven: none is scheduled, and each is picked up when a concrete project calls for it. Every ecosystem below already has an established skeletal-animation solution, so the leverage is in keeping the `DrawBatch` adapter path documented and stable, not in shipping backends ahead of demand.

- [ ] **Three.js (`ssplayer-three`)** — Render `DrawBatch` output as textured meshes within a Three.js scene. Unlocks 3D / WebXR contexts (billboards, in-scene UI) and reaches the largest WebGL/WebGPU library audience.
- [ ] **Phaser (`ssplayer-phaser`)** — Adapt `DrawBatch` output to Phaser GameObjects for the HTML5 2D game-framework audience. Low likelihood, since Phaser already has a first-class skeletal-animation integration and this would mainly serve existing SpriteStudio users, though the Mesh2D / Stencil rendering APIs Phaser 4.2 added lower the cost.
- [ ] **Cocos Creator (`ssplayer-cocos`)** — Adapt `DrawBatch` output to a Cocos Creator component for the Asian mobile / mini-game market (WeChat, Douyin). Low likelihood: Cocos Creator already ships built-in skeletal-animation components, so this would mainly serve existing SpriteStudio users.

## Deliberate non-goals

- **UI integration in `<ss-player>`** — The DOM is the UI toolkit here. A page makes a button by putting the element inside a `<button>`, which brings the role, focus, keyboard and disabled state, and names it with `aria-label` while the player takes `aria-hidden`; `role` and `aria-label` written on the element itself work as they are. The element exposes its `player`, so a few lines of page script play a state's label section with `setAnimationSectionByLabel`. What that leaves out is a click limited to the artwork, which needs `hitTestPart` in element coordinates with the `fit` transform undone. An element of its own for it would have to stay off the pages that only play animations — a subpath on npm, and a third CDN bundle beside `ssplayer-webgl.browser.min.js` and `ss-player.element.min.js` — which is more to build and ship than the case is worth. In a PixiJS app, `@spritestudio/ssplayer-pixi-ui` covers hit testing, UI states and reduced motion as the SDK porting guide's [UI integration page](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/libs/ssruntime/docs/50_features/80_ui_integration.md) defines them. Revisit on a concrete case that a `<button>` and page script cannot serve.
