# TyranoScript

::: warning Beta
`@spritestudio/ssplayer-tyranoscript` is in **beta** (`7.0.0-beta.1`). The scenario-authoring
tags are complete, but names and behavior may still change before `7.0.0`. Rendering is
built on [`ssplayer-webgl`](/usage/webgl)'s `SSPlayer`.

**There are no releases yet.** Once the first release ships, a plugin ZIP will be
distributed on **GitHub Releases** — but for now the only way to obtain it is to
[build from source](#building-from-source).
:::

Show and play **SpriteStudio 7** (`.ssab`) animations inside a **TyranoScript** visual novel by
writing `[ss_*]` tags in your scenario — no coding required. Each animation is a real
`<canvas>` mounted on a Tyrano layer, so it sits in the normal layer stack alongside
characters, backgrounds, and messages.

::: tip Building in TyranoBuilder?
See [TyranoBuilder](/usage/tyranobuilder) instead. It is the same runtime, reached from the
component palette rather than by writing tags, and it converts your `.sspj` for you. The tag
reference on this page still applies — the components write these tags.
:::

## How it works

The plugin registers a family of `[ss_*]` KAG custom tags onto Tyrano's `master_tag`.
A single self-registering `main.js` (an IIFE bundle) works across TyranoScript,
TyranoBuilder, and TyranoStudio.

- Each `[ss_new]` creates a named player: it loads the `.ssab`, mounts a `<canvas>`
  on the target layer, and drives it with [`ssplayer-webgl`](/usage/webgl)'s
  `SSPlayer` (WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies).
- The canvas is tagged with **your player name** as its identifier, so Tyrano's own
  `[anim]` / `[kanim]` tags drive it directly — just like any character.
- Only the **WASM binary** (`ssruntime_bg.wasm`) stays external; the renderer and
  core JS are inlined into `main.js`.

## 1. Install

::: tip Which download do I need?
The plugin ZIP described here is **for TyranoScript**. If you author in **TyranoBuilder**,
install `ssplayer.tbp` instead — it already contains this ZIP's three files plus the editor
half (components and auto-conversion), so it is the only download you need.
**Install one or the other, never both:** they unpack to the same
`data/others/plugin/ssplayer/`, so stacking them leaves the editor and runtime halves on
different versions.
:::

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

Load the plugin once, at the top of your game:

```
; first.ks
[plugin name="ssplayer"]
```

Then show a character wherever you want one:

```
; scene1.ks
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[plugin]` loads the plugin and starts the animation runtime. It is the only
  line that belongs in `first.ks`, and the only setup there is: no `[ss_init]`,
  and nothing to add to `make.ks`.
- `[ss_new]` creates a named player, loads its `.ssab`, drops it on a layer, and plays.
- `[ss_play]` plays or switches an animation on an existing player.

A runnable minimal project lives at `examples/tyranoscript-example`.

## 4. Tags

| Tag | Role | Key attributes |
| --- | --- | --- |
| `[ss_init]` | **Sound settings.** The runtime is already started by `[plugin name="ssplayer"]`, so this is only for changing audio routing | `audio=`, `sounddir=`, `soundext=`, `sevolume=` (`wasm=` is set by the plugin) |
| `[ss_new]` | Create player → load ssab → insert on the layer → play | `name=`(req) `storage=`(req) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` `visible=` `zindex=` |
| `[ss_play]` | Play / switch animation, optionally queueing a follow-up | `name=`(req) `anime=` `loop=` `start=` `next=` `nextloop=` `atframe=` |
| `[ss_show]` | Put a player on screen (reposition / entrance animation / fade) | `name=`(req) `x=` `y=` `scale=` `zindex=` `anime=` `loop=` `next=` `time=` `wait=` |
| `[ss_hide]` | Take a player off screen, keeping it loaded | `name=`(req) `time=` `wait=` |
| `[ss_fadein]` / `[ss_fadeout]` | Fade every player at once (scene changes) | `time=` `wait=` |
| `[ss_chara]` | Link a player to a speaker: talk animation while they speak | `name=`(req) `jname=` `talk=` `idle=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | Per-player stop / pause / resume | `name=`(req) |
| `[ss_wait]` | Wait until the animation ends (one loop if looping) | `name=`(req) |
| `[ss_pos]` | Instant move / scale / reorder (anchor-accurate, absolute) | `name=`(req) `x=` `y=` `scale=` `zindex=` |
| `[ss_move]` | Tweened move / scale (easeOut, non-blocking by default) | `name=`(req) `x=` `y=` `scale=` `time=` `wait=` |
| `[ss_part_color]` | Tint a part, winning over the animation (Normal parts only) | `name=`(req) `part=`(req) `color=`(req) `blend=` `priority=` |
| `[ss_part_visible]` | Force-hide a part (or revert it) | `name=`(req) `part=`(req) `hide=` `cascade=` |
| `[ss_part_cell]` | Make a part draw another cell (Normal / mask parts only) | `name=`(req) `part=`(req) `cellmap=`(req) `cell=`(req) `priority=` |
| `[ss_part_clear]` | Clear part overrides (every part when `part=` is omitted) | `name=`(req) `part=` |
| `[ss_free]` | Release one player | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save. **Not needed** — the plugin does this itself on load; use it only to make the load *wait* for the players, or on an engine with no event system | — |

Coordinates use Tyrano's normal top-left pixels (`config.scWidth × scHeight`), the same
as any other on-screen element. `loop`: `true` → infinite / `false` → once / a number →
that many loops.

### Preload, show, hide

`[ss_new visible="false"]` loads a player **without displaying it**, so a heavy `.ssab`
can be prepared ahead of the scene that needs it and revealed instantly:

```
[ss_new name="akane" storage="others/ssdata/Akane.ssab" visible="false"]
[ss_show name="akane" x="640" y="480" time="800"]   ; appears, already loaded
[ss_hide name="akane" time="500"]                   ; off screen, still loaded
```

`[ss_hide]` keeps the animation loaded (so `[ss_show]` is instant) and stops its GPU
work while off screen; `[ss_free]` is what actually releases it. `[ss_fadeout]` /
`[ss_fadein]` fade every player at once for scene changes, and a fade-in brings back
exactly the players that were on screen before the fade-out.

### Chaining animations

`next=` queues a follow-up animation on the player, so "enter, then idle" needs no
`[ss_wait]` and never stops the scenario:

```
[ss_play name="akane" anime="appear" next="wait"]                ; once → idle loop
[ss_play name="akane" anime="attack" next="wait" atframe="20"]   ; switch at frame 20
```

`next=` with no `loop=` plays the current animation once (an infinite loop would never
reach its end). `nextloop=` sets the follow-up's loop count; the next `[ss_play]`
cancels a queued follow-up.

### Speaker-linked talk animations

`[ss_chara]` plays a talk animation while the bound character's line is being typed
out, and returns to idle when it ends — the Live2D plugin's `jname` idea, expressed as
whole SpriteStudio animations rather than a mouth parameter:

```
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
Nice to meet you.[p]
```

`jname=` matches the `#name` in your scenario or the Tyrano chara id. An empty `idle=`
returns to whatever `[ss_play]` last set. The talk/idle swap is not saved, so a save
taken mid-line restores the character in their normal animation. `talk=""` unbinds.

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
own `[anim]` / `[kanim]` tags drive it directly — just like any character. The element is a
positioning box: the drawing happens on the layer's shared canvas, which follows the element
every frame (see [Resources & lifecycle](/customize/resources)):

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

::: warning `scale` and `rotate` do not reach the animation
`[anim]` / `[kanim]` `scale` and `rotate` transform the character's **element**, and every
SS character on a layer is drawn on that layer's shared canvas rather than inside its own
element. A CSS transform therefore moves and resizes where the character sits without
scaling or rotating what is drawn there.

Use **`[ss_pos]`** (instant) or **`[ss_move]`** (tween), which scale the animation itself
and about its own anchor. `[anim]`'s `scale` / `rotate` pivoted on the screen centre rather
than the anchor, so they were never accurate for this anyway.
:::

**When to use which:**

- **Fades (opacity) / slides / shakes / keyframes** → `[anim]` / `[kanim]`.
- **Position or scale that has to be exact** → `[ss_pos]` (instant) or `[ss_move]` (tween).
  With `[anim]`, `left`/`top` move *relative* to the starting position.

## 6. Save / load & lifecycle

- **Playback keeps running during ordinary text waits** (`[l]` / `[p]`) — that's the
  expected behavior. To freeze animations for a menu or save screen, use
  `[ss_pause_all]` / `[ss_resume_all]`. Off-screen / hidden-tab playback auto-pauses.
- **Save / load**: players are restored on load automatically — there is nothing
  to add to `make.ks` — and resume on the frame the save was taken on.
- **Scene changes**: clearing a layer (e.g. `[freeimage]`) releases the players on
  it automatically, whatever cleared it. `[ss_free]` / `[ss_free_all]` are for
  letting a player go without touching the layer.

## 7. Audio

SpriteStudio sound events play through TyranoScript's bundled audio (howler). Sound files
are expected under `data/sound/`; an SS sound name resolves to `data/<dir>/<name>.<ext>`
(tune with `[ss_init sounddir= soundext= sevolume=]`, disable with `audio="false"`).

## Known limitations

`[cm]` / `[clearfix]` auto-hooks, frame-precise restore, and Tyrano volume-slider integration are
still on the roadmap. Track progress in
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md).

TyranoBuilder is covered by its own plugin, `@spritestudio/ssplayer-tyranobuilder`, which ships
as a `.tbp`, adds SpriteStudio components to the palette, and converts your `.sspj` from inside
the editor — see [TyranoBuilder](/usage/tyranobuilder). What neither integration covers yet is
listed in [Limitations & Scope](/limitations#tyranoscript-tyranobuilder).

## Building from source

```sh
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<v>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` — attach it to a GitHub
Release; users extract `ssplayer/` into `data/others/plugin/`.

To try it in the bundled example:

```sh
pnpm --filter tyranoscript-example run sync:plugin   # copy the built plugin + wasm into the example
```

::: tip TyranoScript itself is not bundled
The example commits only the *authored* scenario, plugin loader, and `.ssab` files — you
place a TyranoScript runtime yourself during development.
:::
