---
description: What the Web players do not do yet, the browser requirements, how each package is distributed, and the constraints on playback features.
---

# Limitations & Scope

Constraints to be aware of when shipping with the current SpriteStudio Player for Web. For what
*is* supported, see [Basic playback](./usage/basic.md) and the usage guides.

This repository is a monorepo, so a constraint applies at one of three levels. Each section below
says which.

## Not yet implemented — every renderer

These apply to `ssplayer-webgl`, `ssplayer-pixi`, and therefore to every framework integration
built on them.

::: warning
- **Text parts** — not drawn. The runtime reserves the part's slot in the draw plan but supplies
  no glyphs (glyph layout and rasterization are the player's job), and no renderer here has a
  text pass yet.
- **9-slice parts** — not drawn. The runtime builds the whole grid into its dedicated `Nines`
  buffers, but no renderer reads them yet, so the part renders as nothing rather than as a
  stretched cell.
:::

Both part types still occupy their place in the draw order, so an animation that uses them plays
with those parts missing rather than failing. If you ship one, replace it with an ordinary part at
authoring time.

## Masks

Masking differs between the two renderers in the points below. The framework integrations all
draw through `ssplayer-webgl`, so what is said of it applies to them.

::: warning
- **`ssplayer-webgl` masks through the stencil buffer** (the `stencil` option, on by default).
  On a context without one no mask can be written: parts drawn outside a mask draw unclipped, and
  parts set to draw only inside a mask are not drawn at all.
- **The number of mask writers is limited.** Every mask part and clipping part counts — those of
  the animation and of every instance it calls, each time the instance is placed — except one
  switched off that frame (mask 0, or hidden). One animation
  holds at most 24 of its own; the whole instance tree holds at most 96 on `ssplayer-pixi` and 256
  on `ssplayer-webgl`. Writers past the limit are ignored (`ssplayer-pixi` logs a warning once).
  On `ssplayer-pixi`, a tree with more than 24 shares one coverage texture split into tiles, so
  its masks lose resolution once the texture reaches its size cap.
:::

## Browser requirements

::: warning WebAssembly SIMD is required
The runtime is built with WebAssembly SIMD instructions and **will not run on browsers without
SIMD support**. This applies to every package here except the RPG Maker MZ plugin, which bundles a
no-SIMD build for MZ's NW.js. Treat SIMD support as a browser requirement for your distribution.
:::

In the browser converter `ssconverter-web`, dropping a folder needs the **File System Access
API**, so it works only in a **Chromium-based browser** (Chrome / Edge, etc.); in other browsers,
pick the folder with `Browse...`. See [Preparing assets](./usage/assets.md).

## How each package is distributed

The renderers are npm packages; the framework integrations are IIFE plugin bundles loaded by the
host framework's plugin system, so they are **not installable from npm**.

| Package | How you get it |
|---|---|
| `@spritestudio/ssplayer-core` | npm |
| `@spritestudio/ssplayer-webgl` | npm |
| `@spritestudio/ssplayer-pixi` | npm |
| `@spritestudio/ssplayer-pixi-ui` | npm |
| `@spritestudio/ssconverter-core` | npm |
| `@spritestudio/ssplayer-rmmz` | plugin ZIP, or [build from source](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/README.md#for-contributors--building-from-source) |
| `@spritestudio/ssplayer-tyranoscript` | plugin ZIP, or [build from source](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranoscript/README.md#for-contributors--building-from-source) |
| `@spritestudio/ssplayer-tyranobuilder` | `ssplayer.tbp`, added in TyranoBuilder's plugin settings, or [build from source](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranobuilder/README.md#for-contributors--building-from-source) |
| `@spritestudio/ssconverter-web` | hosted on GitHub Pages at `/ssconverter/`, plus a Node CLI in the repo |

## RPG Maker MZ {#rpg-maker-mz-beta}

See [Using RPG Maker MZ](./usage/rmmz.md).

::: warning
- **A picture's tint and blend mode do not affect the animation.** *Opacity*, *move* and *scale* do apply.
- **Some screen effects behave differently** from a normal picture: a few PIXI filters can shift
  the animation out of place. MZ's own flash / tint overlays are unaffected.
- **Deployment's "Exclude unused files" deletes anything you put under `img/`.** The `.ssab` files
  and textures are loaded dynamically, so MZ treats them as unused — but the option only prunes
  `img/`, `audio/` and `effects/`, so keeping SS assets in a project-root `spritestudio/` folder
  sidesteps it entirely. The cost is that MZ's image encryption, also limited to `img/`, no longer
  covers them.
- **The same option deletes the sound files only an animation plays.** MZ plays them from
  `audio/se/`, which it prunes; register them with the official MaterialBase.js plugin
  ([Sound](./usage/rmmz.md#_5-sound)).
:::

## TyranoScript / TyranoBuilder

See [Using TyranoScript](./usage/tyrano.md) and
[Using TyranoBuilder](./usage/tyranobuilder.md).

::: warning TyranoBuilder
- **The Standard edition (without PRO) loads at most two plugins**, and this counts as one.
- **Do not rename `ssplayer.tbp`.** TyranoBuilder takes the plugin's name from the file name.
:::

## Playback feature constraints

These come from the shared `libssruntime` and therefore apply to every package here. They apply to
every official player too, so the full explanations — and the rest of the shared constraints
(embedded mode, unvalidated `.ssab` input, and so on) — live in the portal:
**[Shared Limitations](https://cri-middleware.github.io/SpriteStudio-Docs/sdk/limitations/)**.

::: warning
- **`independent = true` parts (Instance / Effect) do not reverse or seek correctly.** Only
  forward playback (including forward frame-skips) is correct.
- **Seeking does not fire the events it skips over.** Only the destination frame's `UserData` /
  `Signal` / `Audio` events fire, and its audio keys are not sounded.
- **No reverse audio.** Sounds are skipped whenever the effective direction is backward (a
  reverse direction, or a ping-pong return leg). A negative speed is not one of those cases: speed is a multiplier, and a negative one stops the playhead rather than turning it around, as does `0`.
- **The runtime does not play audio.** `onAudio` hands you the sound reference and the timing.
  The players play it for you through Web Audio unless you set your own `audioManager`
  ([Sound playback](./customize/events.md#sound-playback)).
:::
