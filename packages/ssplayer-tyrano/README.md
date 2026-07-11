[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyrano

Show and play **SpriteStudio 7** animations inside a **TyranoScript / TyranoBuilder**
visual novel by writing `[ss_*]` tags in your scenario — no coding required.

> **Who this is for:** visual-novel scenario writers using TyranoScript / TyranoBuilder — a drop-in plugin that adds `[ss_*]` scenario tags for SpriteStudio animations.
> **Status:** experimental / alpha, private — not on npm.
> **Not what you need?** → [ssplayer-webgl](../ssplayer-webgl/README.md) — the standalone renderer this plugin is built on.

> ⚠️ **Alpha / experimental / private.** This plugin is early and not published to
> npm. Tag names and behavior may still change between versions. The design roadmap
> lives in the repo ([`ROADMAP.md`](./ROADMAP.md)).

## Install

There is **no released build yet.** For now the only way to get the plugin is to
build it from source — see [For contributors — building from source](#for-contributors--building-from-source).

Once the first release ships, a ZIP will be attached to the project's GitHub
Releases. To install it you will:

1. Download and unzip the release, which contains an `ssplayer/` folder.
2. Copy that `ssplayer/` folder into your Tyrano project at `data/others/plugin/`.
3. Load it from your scenario with `[plugin name="ssplayer"]` (see the example below).

The folder holds three files: `init.ks` (the loader), `main.js` (the plugin
itself), and `ssruntime_bg.wasm` (the animation runtime). Your `.ssab` animation
files go under `data/others/ssdata/`.

## Quick start

A minimal scenario that shows one looping character:

```
; first.ks
[plugin name="ssplayer"]
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[ss_init]` loads the animation runtime once — put it near the start of your game.
- `[ss_new]` creates a named player, loads its `.ssab`, drops it on a layer, and plays.
- `[ss_play]` plays or switches an animation on an existing player.

A runnable minimal project is [`examples/tyrano-example`](../../examples/tyrano-example/README.md).

## Tags

| Tag | Role | Key attributes |
| --- | --- | --- |
| `[ss_init]` | Initialize the runtime once + audio config | `wasm=` (effectively required), `base=`, `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | Create player → load ssab → insert on the layer → play | `name=`(req) `storage=`(req) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | Play / switch animation | `name=`(req) `anime=` `loop=` `start=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | Per-player stop / pause / resume | `name=`(req) |
| `[ss_wait]` | Wait until the animation ends (one loop if looping) | `name=`(req) |
| `[ss_pos]` | Instant move/scale (anchor-accurate, absolute) | `name=`(req) `x=` `y=` `scale=` |
| `[ss_move]` | Tweened move/scale (easeOut, non-blocking) | `name=`(req) `x=` `y=` `scale=` `time=` |
| `[ss_free]` | Release one player | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save (**place in `make.ks`**) | — |

Coordinates use Tyrano's normal top-left pixels (`config.scWidth × scHeight`), the
same as any other on-screen element.[^coords] `loop`: `true` → infinite / `false` →
once / a number → that many loops.

[^coords]: Under the hood the canvas is HiDPI-aware; the pixel-scale details live in
the contributor section.

## Movement & effects with `[anim]` / `[kanim]`

Each SS player is a real element on the layer and is tagged with **your player name
as its identifier**, so Tyrano's own `[anim]` / `[kanim]` tags drive it directly —
just like any character:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; fade out (disappear)
[anim name="ringo" time="800" opacity="255"]      ; fade in (appear)
[anim name="ringo" time="600" left="120" top="0"] ; slide
[kanim name="ringo" time="500" ...]               ; keyframes too
```

> ⚠️ TyranoScript's `[anim]` **`opacity` is 0–255** (not 0–1): `opacity="1"` is
> nearly invisible (≈ 0.4%). **Full opacity is `255`.**

**When to use which:**

- **Fades (opacity) / simple slides / shakes** → `[anim]` / `[kanim]` is ideal.
- For **absolute, anchor-accurate** position or scale, use **`[ss_pos]`** (instant)
  or **`[ss_move]`** (tween) instead. With `[anim]`, `left`/`top` move *relative* to
  the starting position and `scale`/`rotate` pivot on the screen center rather than
  the animation's anchor.

## Save / load & lifecycle

- **Playback keeps running during ordinary text waits** (`[l]` / `[p]`) — that's the
  expected behavior. To freeze animations for a menu or save screen, use
  `[ss_pause_all]` / `[ss_resume_all]`. Off-screen / hidden-tab playback auto-pauses.
- **Save / load**: players are restored on load. Put `[ss_init]` → `[ss_restore]` in
  your `make.ks` so they rebuild after a load (they restart from the animation's
  beginning, not the exact saved frame).
- **Scene changes**: call `[ss_free]` / `[ss_free_all]` on scene transitions or layer
  clears to remove players you no longer need.

## Audio

SpriteStudio sound events play through TyranoScript's bundled audio (howler). Sound
files are expected under `data/sound/`; an SS sound name resolves to
`data/<dir>/<name>.<ext>` (tune with `[ss_init sounddir= soundext= sevolume=]`,
disable with `audio="false"`).

TyranoBuilder `.tbp` support, `[cm]` / `[clearfix]` auto-hooks, frame-precise
restore, and Tyrano volume-slider integration are tracked in [`ROADMAP.md`](./ROADMAP.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

This is a thin adapter for TyranoScript / TyranoBuilder. Rendering is handled by
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md)'s `SSCanvasPlayer`
(WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies). This package holds **no
GPU code** — it is pure **TyranoScript glue**: inserting a `<canvas>` into a layer
`div`, coordinate mapping, and playback control. Implemented range is verified in
real TyranoScript; remaining work (builder support, converter import, …) lives in
[`ROADMAP.md`](./ROADMAP.md).

### How it works

- **The runtime is shared across TyranoScript / TyranoBuilder / TyranoStudio.** A
  single `main.js` (an IIFE bundle that self-registers `[ss_*]` onto `master_tag`)
  works everywhere.
- Two build artifacts:
  - `dist/index.js` (ESM) — for bundlers / tests. Side-effect free (exposes
    `registerSSTags()`).
  - `dist/browser/main.js` (IIFE, self-registering, minified) — the **drop-in** you
    place at `data/others/plugin/ssplayer/main.js`. It inlines the WebGL renderer +
    core JS; **only the WASM binary stays external** (ship `ssruntime_bg.wasm` and
    point `[ss_init wasm=...]` at it).

### Internals (coordinates, lifecycle)

- **Coordinates**: Tyrano's top-left logical pixels (`config.scWidth × scHeight`) map
  to `SSCanvasPlayer`'s (Y-down) drawing-buffer space; HiDPI folds `devicePixelRatio`
  into the buffer scale, clamped by `maxDPR`.
- **Naming for `[anim]`**: on creation the canvas is tagged with the player name as a
  CSS class (`$.setName` is `addClass(name)`, the same way TyranoScript identifies a
  named element). It also carries an `ss-player` class, so `$(".ss-player")` selects
  them all. Absolute positioning goes through the renderer's internal `setTransform`
  (the `[spine_mod]` equivalent), which is why `[ss_pos]` / `[ss_move]` exist
  alongside `[anim]`.
- **Save target**: each player's reconstruction data is mirrored into
  `TYRANO.kag.stat.f.__ssplayers`. On load TyranoScript `call`s `make.ks`, so
  `[ss_init]` → `[ss_restore]` there rebuilds players.
- **Release**: `[ss_free]` / `[ss_free_all]` call `destroy()`; do not rely on
  `FinalizationRegistry`.
- **Audio**: SS `onAudio` events are routed to howler (`window.Howl`) via
  `TyranoAudioManager`. We use howler directly rather than `[playse]` because a KAG
  tag would advance the scenario (`nextOrder`). `TyranoAudioManager` can also be used
  directly from JS.

### Distribution (GitHub Releases)

Not published to npm (`private`). TyranoScript authors consume the plugin bundle:

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<ver>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}`. Attach it to a **GitHub
Release**; users extract `ssplayer/` into `data/others/plugin/`. The distribution
template lives in [`plugin/`](./plugin/README.md).

Plugin layout on disk:

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # this package's dist/browser/main.js
  ssruntime_bg.wasm    # the @spritestudio/ssplayer-core runtime binary
data/others/ssdata/<project>.ssab
```

### API (ESM)

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyrano';

// Call once the TyranoScript runtime is up to register [ss_*].
// Uses the global TYRANO when omitted; a no-op returning false if Tyrano is absent.
registerSSTags();
```

### Development

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run test    # vitest (mock TYRANO harness, no real engine)
```

## License

BSD-3-Clause © CRI Middleware Co., Ltd.
</content>
</invoke>
