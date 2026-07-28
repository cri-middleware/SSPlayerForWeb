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

▶️ **[Online demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyrano/)** —
the bundled TyranoScript sample, running in your browser (🚧 live after the first release).

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

## Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact, pre-built
runtime file the plugin actually plays — it's what `[ss_new storage="..."]` loads.
Convert your `.sspj` with either:

- **Web — no install:** the hosted converter at
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>** (🚧 live after the first release) — drop the
  **folder** containing your `.sspj` project in and download the `.ssab` (+ its
  texture) as a zip file.
- **Desktop:** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases).

Put the resulting `.ssab` (+ texture) under `data/others/ssdata/` in your Tyrano
project. Grouping each project in its own subfolder (e.g. `data/others/ssdata/Ringo/`)
keeps textures from colliding, so you reference it from `[ss_new]` as
`storage="others/ssdata/Ringo/Ringo.ssab"`.

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

## Recipes (common patterns)

A single `.ssab` can hold several animations (idle / smile / jump …); switch between them by name with `anime=` (empty picks the first).

**Switch expression / animation** (same `.ssab`, no reload)

```
[ss_play name="akane" anime="smile"]
```

**Play once, then continue after it finishes**

```
[ss_play name="akane" anime="jump" loop="false"]   ; play once
[ss_wait name="akane"]                              ; hold until it ends
[ss_play name="akane" anime="wait" loop="true"]     ; back to the idle loop
```

**…or the same thing without stopping the scenario** (the text keeps going)

```
[ss_play name="akane" anime="jump" next="wait"]     ; jump once → wait, on its own
```

> For worked examples of entrances/movement (`[ss_move]` / `[ss_pos]`), `[anim]` fades,
> multiple layers, and save/load restore, see the commented sample scenario
> [`first.ks`](../../examples/tyrano-example/data/scenario/first.ks).

## Tags

| Tag | Role | Key attributes |
| --- | --- | --- |
| `[ss_init]` | Initialize the runtime once + audio config | `wasm=` (effectively required), `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | Create player → load ssab → insert on the layer → play | `name=`(req) `storage=`(req) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` `visible=` `zindex=` |
| `[ss_play]` | Play / switch animation, optionally queueing a follow-up | `name=`(req) `anime=` `loop=` `start=` `next=` `nextloop=` `atframe=` |
| `[ss_show]` | Put a player on screen (reposition / entrance animation / fade) | `name=`(req) `x=` `y=` `scale=` `zindex=` `anime=` `loop=` `next=` `time=` `wait=` |
| `[ss_hide]` | Take a player off screen, keeping it loaded | `name=`(req) `time=` `wait=` |
| `[ss_fadein]` / `[ss_fadeout]` | Fade every player at once (scene changes) | `time=` `wait=` |
| `[ss_chara]` | Link a player to a speaker: talk animation while they speak | `name=`(req) `jname=` `talk=` `idle=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | Per-player stop / pause / resume | `name=`(req) |
| `[ss_wait]` | Wait until the animation ends (one loop if looping) | `name=`(req) |
| `[ss_pos]` | Instant move/scale/reorder (anchor-accurate, absolute) | `name=`(req) `x=` `y=` `scale=` `zindex=` |
| `[ss_move]` | Tweened move/scale (easeOut, non-blocking by default) | `name=`(req) `x=` `y=` `scale=` `time=` `wait=` |
| `[ss_part_color]` | Tint a part, winning over the animation (Normal parts only) | `name=`(req) `part=`(req) `color=`(req) `blend=` `priority=` |
| `[ss_part_visible]` | Force-hide a part (or revert it); `cascade=` takes its descendants too | `name=`(req) `part=`(req) `hide=` `cascade=` |
| `[ss_part_cell]` | Make a part draw another cell (Normal / mask parts only) | `name=`(req) `part=`(req) `cellmap=`(req) `cell=`(req) `priority=` |
| `[ss_part_clear]` | Clear part overrides (every part when `part=` is omitted) | `name=`(req) `part=` |
| `[ss_free]` | Release one player | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save (**place in `make.ks`**) | — |

Coordinates use Tyrano's normal top-left pixels (`config.scWidth × scHeight`), the
same as any other on-screen element.[^coords] `loop`: `true` → infinite / `false` →
once / a number → that many loops.

[^coords]: Under the hood the canvas is HiDPI-aware; the pixel-scale details live in
the contributor section.

**Attribute notes:**

- `loop`: `true` = infinite (default) / `false` = once / a number = that many loops.
- `layer`: the Tyrano layer number (**higher = in front**; default `0`). `page` is `fore` (foreground, default) / `back`.
- `x` / `y`: Tyrano's top-left pixels (default `0,0`); the animation's **anchor** lands at that point.
- `scale`: scale factor (default `1`).
- `anime`: an animation name inside the `.ssab`; empty auto-picks the **first** animation.
- `[ss_play]`'s `start`: start frame (default `-1` = from the current frame).
- `visible`: `false` loads the player **without showing it** (preload); reveal it later with `[ss_show]`.
- `zindex`: stacking order *within one layer*. Without it, players on the same layer stack in creation order.
- `time`: fade duration in ms (`[ss_show]` / `[ss_hide]` default `0` = instant; `[ss_fadein]` / `[ss_fadeout]` default `1000`).
- `wait`: `true` = hold the scenario until the effect finishes. Default `true` for the fades, `false` for `[ss_move]`.
- `next` / `nextloop` / `atframe`: see [Chaining animations](#chaining-animations-without-stopping-the-scenario).

## Preload, show, hide

`[ss_new]` shows the player as soon as it has loaded. For a big `.ssab` you usually
want the loading to happen *earlier* than the entrance, so it does not stall the
scene — create it hidden, then reveal it when the moment comes:

```
[ss_new name="akane" storage="others/ssdata/Akane.ssab" visible="false"]  ; loads now
...
[ss_show name="akane" x="640" y="480" time="800"]   ; appears here, instantly ready
[ss_hide name="akane" time="500"]                   ; off screen, still loaded
[ss_show name="akane"]                              ; back, no reloading
```

`[ss_hide]` is not `[ss_free]`: the animation stays loaded (so `[ss_show]` is
instant) and, being off screen, it stops consuming GPU time. Use `[ss_free]` when
you are finished with a character for good.

`[ss_fadeout]` / `[ss_fadein]` fade **every** player at once — the usual scene-change
move. A blanket fade-out does not forget which players were individually hidden, so
the following fade-in brings back exactly the ones that were on screen before.

## Chaining animations without stopping the scenario

`[ss_wait]` blocks the scenario until an animation ends. That is right for "wait for
the punch to land, then continue", but wrong for "enter, then settle into an idle
loop" — there the text should keep flowing. `next=` queues the follow-up on the
player itself, so the scenario never stops:

```
[ss_play name="akane" anime="appear" next="wait"]    ; appear once → wait, looping
[ss_play name="akane" anime="attack" next="wait" atframe="20"]  ; switch at frame 20
```

- `next=` with no `loop=` plays the current animation **once** (an infinite loop
  would never reach its end and the follow-up would never fire).
- `nextloop=` sets the follow-up's loop count (default: infinite).
- `atframe=` switches at that frame instead of waiting for the end — useful to
  overlap the tail of one animation with the start of the next.
- The queued follow-up is cancelled by the next `[ss_play]` / `[ss_show anime=]`.

## Speaker-linked talk animations

`[ss_chara]` binds a player to a character name, so it plays a talk animation while
that character's line is being typed out and returns to idle when the line ends —
no per-line tags:

```
[chara_new name="akane" jname="あかね" storage="chara/akane/normal.png"]
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
Nice to meet you.[p]      ; talk plays here, wait resumes at the [p]
```

- `jname=` accepts the `#name` you write in the scenario **or** the Tyrano chara id;
  omit it and the player's own name is used.
- `idle=` is what plays afterwards. Leave it empty to fall back to whatever the
  scenario last set with `[ss_play]`, so an expression change survives the next line.
- Talk/idle switching is deliberately **not** saved: a save taken mid-line restores
  the character in their normal animation, not frozen mid-word.
- `talk=""` unbinds. In skip / `[nowait]` mode the engine prints the whole line at
  once and no talk animation flickers past.
- SpriteStudio is frame-based, so this swaps a whole animation rather than driving a
  mouth parameter the way Live2D's `lip=` does — author a talking animation in
  SpriteStudio and name it here.

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
- Visibility, stacking order, a queued `next=` follow-up and `[ss_chara]` bindings
  all survive a save/load, so `[ss_restore]` puts the scene back as it was.

## Audio

SpriteStudio sound events play through TyranoScript's bundled audio (howler). Sound
files are expected under `data/sound/`; an SS sound name resolves to
`data/<dir>/<name>.<ext>` (tune with `[ss_init sounddir= soundext= sevolume=]`,
disable with `audio="false"`).

## Troubleshooting

Tags never stall the scenario on failure — they **log the reason to the browser
console (dev tools)**, so check the console first.

- **Nothing shows / an error appears**: make sure `[ss_init]` runs before `[ss_new]`
  (you'll see messages like `call [ss_init] before creating players`).
- **The `.ssab` won't load**: `storage=` is relative to `data/`
  (e.g. `others/ssdata/Ringo/Ringo.ssab`); keep the texture PNGs in the same folder as the `.ssab`.
- **WASM won't initialize**: check the `[ss_init wasm="..."]` path (for the bundled
  plugin it's `others/plugin/ssplayer/ssruntime_bg.wasm`). A WebGL-capable browser (whatever runs TyranoScript) is assumed.
- **`[anim]` shows it barely visible**: `opacity` is **0–255** (not 0–1); full opacity is `255`.
- **The animation won't switch**: check that the `anime=` name exists inside the `.ssab` (empty = first animation).
- **Characters vanish after loading a save**: make sure `make.ks` has `[ss_init]` → `[ss_restore]`.

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

BSD-3-Clause © CRI Middleware Co., Ltd. — see [LICENSE.md](./LICENSE.md).
