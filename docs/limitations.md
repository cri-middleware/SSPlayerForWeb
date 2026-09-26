# Limitations & Scope

Constraints to be aware of when shipping with the current SpriteStudio Player for Web. For what
*is* supported, see [Basic playback](/usage/basic) and the usage guides.

::: info This is a living document
Items are added as they are confirmed; wording and coverage may change as the packages evolve.
:::

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

**Sequence (`.ssqb`)** is a related but different case: conversion produces `.ssqb` and the
players carry it alongside the `.ssab`, but sequence *playback* is not implemented in the shared
runtime, so it is unavailable to every official player — see
[Shared Limitations](https://cri-middleware.github.io/SpriteStudio-Docs/sdk/limitations/).

## Browser requirements

::: warning WebAssembly SIMD is required
The runtime is built with WebAssembly SIMD instructions and **will not run on browsers without
SIMD support**. This applies to every package here, including the framework integrations. Treat
SIMD support as a browser requirement for your distribution.
:::

The browser converter `ssconverter-web` additionally needs the **File System Access API**
(`showDirectoryPicker` / directory drag-and-drop) for folder selection, so it requires a
**Chromium-based browser** (Chrome / Edge, etc.) and does not work in Firefox or Safari. See
[Preparing assets](/usage/assets).

## How each package is distributed

The renderers are npm packages; the framework integrations are IIFE plugin bundles loaded by the
host framework's plugin system, so they are **not installable from npm**.

| Package | How you get it | Status |
|---|---|---|
| `@spritestudio/ssplayer-core` | npm | beta |
| `@spritestudio/ssplayer-webgl` | npm | beta |
| `@spritestudio/ssplayer-pixi` | npm | beta |
| `@spritestudio/ssconverter-core` | npm | beta |
| `@spritestudio/ssplayer-rmmz` | plugin ZIP, or [build from source](/usage/rmmz#building-from-source) | **alpha** |
| `@spritestudio/ssplayer-tyranoscript` | plugin ZIP, or [build from source](/usage/tyrano#building-from-source) | beta |
| `@spritestudio/ssplayer-tyranobuilder` | `ssplayer.tbp`, added in TyranoBuilder's plugin settings, or [build from source](/usage/tyranobuilder#building-from-source) | beta |
| `@spritestudio/ssconverter-web` | hosted on GitHub Pages at `/ssconverter/`, plus a Node CLI in the repo | beta |

## RPG Maker MZ (alpha)

`@spritestudio/ssplayer-rmmz` is an **alpha**: the tag set and behavior may still change. See
[Using RPG Maker MZ](/usage/rmmz).

::: warning
- **A picture's tint does not affect the animation.** *Opacity*, *move* and *scale* do apply.
- **Some screen effects behave differently** from a normal picture: a few PIXI filters can shift
  the animation out of place. MZ's own flash / tint overlays are unaffected.
- **Deployment's "Exclude unused files" deletes anything you put under `img/`.** The `.ssab` files
  and textures are loaded dynamically, so MZ treats them as unused — but the option only prunes
  `img/`, `audio/` and `effects/`, so keeping SS assets in a project-root `spritestudio/` folder
  sidesteps it entirely. The cost is that MZ's image encryption, also limited to `img/`, no longer
  covers them.
- **The same option deletes the sound files only an animation plays.** MZ plays them from
  `audio/se/`, which it prunes; register them with the official MaterialBase.js plugin
  ([Sound](/usage/rmmz#_5-sound)).
:::

`SSWebGLRenderer` now takes a world tint, which is what made opacity inheritance work. Wiring
MZ's *tint* through it, and injecting a projection matrix for the remaining projection
limitation, are planned follow-ups.

## TyranoScript / TyranoBuilder

Both integrations are **beta**: the authoring surface is complete, but names and behavior may
still change before `7.0.0`. See [Using TyranoScript](/usage/tyrano) and
[Using TyranoBuilder](/usage/tyranobuilder).

::: warning TyranoBuilder
- **The free version loads at most two plugins**, and this counts as one.
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
  `Signal` / `Audio` events fire.
- **No reverse audio.** Sounds are skipped whenever the effective direction is backward (a
  reverse direction, or a ping-pong return leg). A negative speed is not one of those cases: speed is a multiplier, and a negative one stops the playhead rather than turning it around, as does `0`.
- **Animation blending is same-`.ssab` only**, and every blended animation must assign the same
  cell to the same part.
- **The runtime does not play audio.** `onAudio` hands you the sound reference and the timing;
  playing it is your app's job — except in the framework integrations, which wire it up for you.
:::
