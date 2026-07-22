# TyranoScript / TyranoBuilder

::: warning Experimental / alpha
`@spritestudio/ssplayer-tyrano` is an **experimental alpha** (`7.0.0-alpha.1`). The
package is **private and not published on npm**. Rendering is built on
[`ssplayer-webgl`](/usage/webgl)'s `SSCanvasPlayer`, so tag names and behavior may
still change between versions.

**There are no releases yet.** Once the first release ships, a plugin ZIP will be
distributed on **GitHub Releases** — but for now the only way to obtain it is to
[build from source](#building-from-source).
:::

Show and play **SpriteStudio 7** (`.ssab`) animations inside a **TyranoScript /
TyranoBuilder** visual novel by writing `[ss_*]` tags in your scenario — no coding
required. Each animation is a real `<canvas>` mounted on a Tyrano layer, so it sits
in the normal layer stack alongside characters, backgrounds, and messages.

## How it works

The plugin registers a family of `[ss_*]` KAG custom tags onto Tyrano's `master_tag`.
A single self-registering `main.js` (an IIFE bundle) works across TyranoScript,
TyranoBuilder, and TyranoStudio.

- Each `[ss_new]` creates a named player: it loads the `.ssab`, mounts a `<canvas>`
  on the target layer, and drives it with [`ssplayer-webgl`](/usage/webgl)'s
  `SSCanvasPlayer` (WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies).
- The canvas is tagged with **your player name** as its identifier, so Tyrano's own
  `[anim]` / `[kanim]` tags drive it directly — just like any character.
- Only the **WASM binary** (`ssruntime_bg.wasm`) stays external; the renderer and
  core JS are inlined into `main.js`.

## 1. Install

There is **no released build yet**, so for now you [build from source](#building-from-source).
Once the first release ships, download the plugin ZIP from **GitHub Releases** and:

1. Unzip it — it contains an `ssplayer/` folder holding `init.ks` (the loader),
   `main.js` (the plugin), and `ssruntime_bg.wasm` (the runtime).
2. Copy that `ssplayer/` folder into your Tyrano project at `data/others/plugin/`.
3. Load it from your scenario with `[plugin name="ssplayer"]`.

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # the plugin bundle (renderer + core inlined)
  ssruntime_bg.wasm    # the animation runtime binary
data/others/ssdata/<project>.ssab
```

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. See [Preparing assets](/usage/assets) for how to convert. Put the
output under `data/others/ssdata/` and point `[ss_new storage=...]` at it.

## 3. Quick start

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

A runnable minimal project lives at `examples/tyrano-example`.

## 4. Tags

| Tag | Role | Key attributes |
| --- | --- | --- |
| `[ss_init]` | Initialize the runtime once + audio config | `wasm=` (effectively required), `base=`, `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | Create player → load ssab → insert on the layer → play | `name=`(req) `storage=`(req) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | Play / switch animation | `name=`(req) `anime=` `loop=` `start=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | Per-player stop / pause / resume | `name=`(req) |
| `[ss_wait]` | Wait until the animation ends (one loop if looping) | `name=`(req) |
| `[ss_pos]` | Instant move / scale (anchor-accurate, absolute) | `name=`(req) `x=` `y=` `scale=` |
| `[ss_move]` | Tweened move / scale (easeOut, non-blocking) | `name=`(req) `x=` `y=` `scale=` `time=` |
| `[ss_part_color]` | Tint a part, winning over the animation (Normal parts only) | `name=`(req) `part=`(req) `color=`(req) `blend=` `priority=` |
| `[ss_part_visible]` | Force-hide a part (or revert it) | `name=`(req) `part=`(req) `hide=` `cascade=` |
| `[ss_part_cell]` | Make a part draw another cell (Normal / mask parts only) | `name=`(req) `part=`(req) `cellmap=`(req) `cell=`(req) `priority=` |
| `[ss_part_clear]` | Clear part overrides (every part when `part=` is omitted) | `name=`(req) `part=` |
| `[ss_free]` | Release one player | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save (**place in `make.ks`**) | — |

Coordinates use Tyrano's normal top-left pixels (`config.scWidth × scHeight`), the same
as any other on-screen element. `loop`: `true` → infinite / `false` → once / a number →
that many loops.

### Part overrides

The `[ss_part_*]` tags replace how one part looks, **winning over the animation's
keyframes** (the SS6 PartsColorChange / CellChangeParts / HideSet equivalents).

```
[ss_part_color name="chr" part="apple" color="#0033FFBF" blend="mul"]
[ss_part_visible name="chr" part="heta" cascade="true"]
[ss_part_cell    name="chr" part="apple" cellmap="Ringo" cell="effect3"]
[ss_part_clear   name="chr"]
```

- `color=` is `#RRGGBB` / `#RRGGBBAA` (alpha defaults to opaque); the `#RGB` shorthand works too.
- `blend=` is `mix` (default) / `mul` / `add` / `sub`, or the numbers `0`–`3`.
- `priority=` is `keyframe` (yield to the next keyframe) / `anime` (default — hold until the
  animation changes) / `permanent` (survives animation changes), or the numbers `0`–`2`.
- `cellmap=` carries no `.ssce` extension.
- **Changing the animation clears everything but `permanent`.** The saved copy is pruned at the
  same time, so nothing the runtime discarded comes back on load. Visibility has no priority
  mode and is always cleared by an animation change.

## 5. Movement & effects with `[anim]` / `[kanim]`

Each SS player is a real element on the layer, tagged with your player name, so Tyrano's
own `[anim]` / `[kanim]` tags drive it directly — just like any character:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; fade out (disappear)
[anim name="ringo" time="800" opacity="255"]      ; fade in (appear)
[anim name="ringo" time="600" left="120" top="0"] ; slide
[kanim name="ringo" time="500" ...]               ; keyframes too
```

::: warning `[anim]` opacity is 0–255
TyranoScript's `[anim]` **`opacity` is 0–255** (not 0–1): `opacity="1"` is nearly
invisible (≈ 0.4%). **Full opacity is `255`.**
:::

**When to use which:**

- **Fades (opacity) / simple slides / shakes** → `[anim]` / `[kanim]` is ideal.
- For **absolute, anchor-accurate** position or scale, use **`[ss_pos]`** (instant) or
  **`[ss_move]`** (tween) instead. With `[anim]`, `left`/`top` move *relative* to the
  starting position and `scale`/`rotate` pivot on the screen center rather than the
  animation's anchor.

## 6. Save / load & lifecycle

- **Playback keeps running during ordinary text waits** (`[l]` / `[p]`) — that's the
  expected behavior. To freeze animations for a menu or save screen, use
  `[ss_pause_all]` / `[ss_resume_all]`. Off-screen / hidden-tab playback auto-pauses.
- **Save / load**: players are restored on load. Put `[ss_init]` → `[ss_restore]` in
  your `make.ks` so they rebuild after a load (they restart from the animation's
  beginning, not the exact saved frame).
- **Scene changes**: call `[ss_free]` / `[ss_free_all]` on scene transitions or layer
  clears to remove players you no longer need.

## 7. Audio

SpriteStudio sound events play through TyranoScript's bundled audio (howler). Sound files
are expected under `data/sound/`; an SS sound name resolves to `data/<dir>/<name>.<ext>`
(tune with `[ss_init sounddir= soundext= sevolume=]`, disable with `audio="false"`).

## Known limitations

TyranoBuilder `.tbp` support, `[cm]` / `[clearfix]` auto-hooks, frame-precise restore, and
Tyrano volume-slider integration are still on the roadmap. Track progress in
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md).

## Building from source

```sh
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<v>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` — attach it to a GitHub
Release; users extract `ssplayer/` into `data/others/plugin/`.

To try it in the bundled example:

```sh
pnpm --filter tyrano-example run sync:plugin   # copy the built plugin + wasm into the example
```

::: tip TyranoScript itself is not bundled
The example commits only the *authored* scenario, plugin loader, and `.ssab` files — you
place a TyranoScript runtime yourself during development.
:::
