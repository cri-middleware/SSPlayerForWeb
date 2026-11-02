---
description: Overriding a part's colour, cell or visibility from code, which wins over keyframes and blending, and when the change reaches the screen.
---

# Part control (visibility / cell / color)

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

Per-part runtime overrides let a script say "make this part this colour / this cell / hidden **now**". An override wins over both the keyframes and the animation blending, so it never fights the animation.

The same method names are available on `SSPlayer` (both the PixiJS and WebGL backends).

▶️ **<a href="../examples/override/" target="_blank" rel="noreferrer">Live demo</a>** — cycles through the colour, visibility and cell overrides (source in `examples/override-example`)

## Basic usage

```ts
import { SSBlendOp, SSOverridePriority } from '@spritestudio/ssplayer-pixi';

// Tint a part red (multiply). Applies to Normal (image) parts.
player.setPartColorOverride('body', 0xff0000ff, SSBlendOp.Mul);

// Draw a different cell (the cell-map name carries no ".ssce" extension).
player.setPartCellOverride('body', 'Ringo', 'effect3');

// Force-hide a part, cascading to its descendants.
player.setPartVisibilityOverride('body', true, true);

// Clear
player.clearPartColorOverride('body');
player.clearAllPartOverrides();
```

## API reference

| Method | Description |
|---|---|
| `findPartIndex(partName)` | Part index, or `-1` if it isn't in the current animation |
| `setPartColorOverride(part, rgba, blendOp?, priority?)` | Colour override (one value applied to all four corners) |
| `setPartColorOverrideCorners(part, corners, blendOp?, priority?)` | Four corners individually, for a gradient |
| `setPartCellOverride(part, cellmapName, cellName, priority?)` | Draw a different cell |
| `setPartVisibilityOverride(part, hide, cascade?)` | Force-hide (`hide = false` reverts to the animation) |
| `clearPartColorOverride` / `clearPartCellOverride` / `clearPartVisibilityOverride` | Clear one override on one part |
| `clearAllPartOverrides()` | Clear every override on that player |
| `getCellmapNames()` / `getCellNames(cellmapName)` | List the cell-map / cell names a cell override can target |

Every `part` argument takes either a **part name** or a **part index** (`number | string`). Each method returns `false` when the part is unknown or the runtime rejected the call.

`priority` defaults to `HoldUntilNextAnimation`, and `cascade` defaults to `false`.

> **On part indices**: an index is stable within one asset (the same `.ssab`), so if you override often, resolve the name once with `findPartIndex()` and reuse the index.

The names a cell override can target are listed by the player itself:

```ts
player.getCellmapNames();          // → ["Ringo", ...]
player.getCellNames('Ringo');      // → ["effect3", ...]
```

## Specifying a colour

Colours are passed as a number packed **`0xRRGGBBAA`** — the exact form the runtime takes.

```ts
player.setPartColorOverride('body', 0x0033ffbf, SSBlendOp.Mix);  // translucent blue

// Four corners are given in the order left-top, right-top, left-bottom, right-bottom.
player.setPartColorOverrideCorners('body', [
  0xff0000ff, // left-top
  0x00ff00ff, // right-top
  0x0000ffff, // left-bottom
  0xffffffff, // right-bottom
], SSBlendOp.Mix);
```

> **Do not apply alpha twice**: the alpha you pass is pre-multiplied with the part's composed alpha by the runtime, exactly as an authored Parts Color is. Do not multiply in `player.alpha` (or similar) yourself.

> Getting the **corner order** wrong silently flips the gradient rather than failing.

## Blend operations (`SSBlendOp`)

`blendOp` offers the same four operations as an authored Parts Color keyframe.

| Value | Operation |
|---|---|
| `SSBlendOp.Mix` (`0`) | Mix |
| `SSBlendOp.Mul` (`1`) | Multiply |
| `SSBlendOp.Add` (`2`) | Add |
| `SSBlendOp.Sub` (`3`) | Subtract |

A value outside that range fails the call and returns `false`.

## Priority modes (`SSOverridePriority`)

Colour and cell overrides conflict with the animation, so they take a `priority` (visibility does not — it is a plain force-hide flag, always cleared when a new animation is set up).

| Value | Mode | Behaviour |
|---|---|---|
| `0` | `OverwriteOnNextKeyframe` | The override applies until the animation data updates that attribute |
| `1` | `HoldUntilNextAnimation` (default) | Wins for the current animation; cleared when a new animation is set up |
| `2` | `Permanent` | Applies for as long as the same animation data (`.ssab`) is bound, surviving animation changes |

## Notes

- **Colour** applies to Normal parts; **cell** applies to Normal and mask parts. Other part types silently ignore the override (the call still returns `true`).
- Colours are interpreted in the same 8-bit sRGB space as an authored Parts Color. Pass the authored colour as-is; do not gamma/linear-convert it yourself.
- A cell override is resolved when it is set, so an unknown cell-map or cell name fails immediately (returns `false`). No per-frame lookup happens.
- If the replacement cell lives on a different texture, that part is split into a different `DrawBatch`. It still draws correctly, but watch out if you have written your own optimisation that assumes a fixed batch count.
- The runtime owns the overrides and their lifecycle: **do not re-apply them every frame**. Whether one outlives an animation change is the priority mode's job — `Permanent` survives it and the other two are cleared by it — so pick the mode that matches your intent instead of re-setting after a switch. A `crossfade` or `setTrackAnimation` on track 0 clears nothing; only a `setAnimation` to a different animation does.
- Binding a different `.ssab` clears every override, since part identity is lost.
- Overrides do not reach **inside** an instance part: its child animation runs as its own player.

## When the change reaches the screen

An override changes the output **without changing the frame number**, so an implementation that only redraws when the frame advances could miss it. Every ForWeb player handles this for you:

| Player | Behaviour |
|---|---|
| `SSPlayer` (PixiJS) | Its ticker early-returns while stopped, so a successful override automatically re-renders the current frame |
| `SSPlayer` (WebGL) | The built-in RAF loop calls `draw()` unconditionally every frame, so it just shows. Only if you drive frames yourself (`autoStart: false`) do you need to call `surface.draw()` |
| RPG Maker MZ | MZ redraws every game frame, so it just shows |

## Using it from each host

Hosts whose authors don't write code get an authoring surface in their own idiom.

- **`<ss-player>` Web Component** — the element deliberately carries only the playback verbs, so overrides are reached through `el.player` (the `SSPlayer` underneath). See [WebGL & Web Components](/usage/webgl).
- **RPG Maker MZ** — drive it from an event's **plugin commands** (Set SS Part Color / Visibility / Cell, Clear SS Part Overrides). The settings are stored on the picture, so they **survive save/load**. See [RPG Maker MZ](/usage/rmmz).
- **TyranoScript** — write `[ss_part_color]` / `[ss_part_visible]` / `[ss_part_cell]` / `[ss_part_clear]` in a scenario. The settings are part of the save and are restored on load. See [TyranoScript](/usage/tyrano).
- **TyranoBuilder** — the palette's **SpriteStudio: part colour / hide part / part image** and **SpriteStudio: reset parts** components write the same four tags. See [TyranoBuilder](/usage/tyranobuilder).

## What this feature is not for

These are easy to confuse with overrides, but belong elsewhere.

| What you want | Where it belongs |
|---|---|
| Replacing a whole texture / cell map | [Runtime texture replacement](/customize/texture-replacement) — swaps the texture a whole cell map binds. Overrides work on **one part** at a time |
| Flipping | The player's `flipX` / `flipY` — see [Basic playback](/usage/basic#flip-and-offset) |
| Whole-object colour / opacity / draw order | Properties on the player (`SSPlayer` / its container) — not a per-part concern |
| Swapping an instance part's animation | Planned, pending the SDK's Instance Lifecycle API — see the [ROADMAP](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) |
