---
description: "The ssplayer-tyranoscript plugin for TyranoScript: the scenario tags, movement and effects, save and load, and audio."
---

# TyranoScript

::: warning Beta
`@spritestudio/ssplayer-tyranoscript` is in **beta** (`7.0.0-beta.1`). The scenario-authoring
tags are complete, but names and behavior may still change before `7.0.0`. Rendering is
built on [`ssplayer-webgl`](/usage/webgl)'s `SSPlayer`.
:::

Show and play **SpriteStudio** (`.ssab`) animations inside a **TyranoScript** visual novel by
writing `[ss_*]` tags in your scenario — no coding required. Each animation is a
`<div>` on a Tyrano layer (drawn on that layer's shared canvas), so it sits in the normal
layer stack alongside characters, backgrounds, and messages.

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../examples/tyranoscript/" target="_blank" rel="noreferrer">Live demo</a>** — a
visual-novel scene driven entirely by `[ss_*]` tags.

::: tip Building in TyranoBuilder?
See [TyranoBuilder](/usage/tyranobuilder) instead. It is the same runtime, reached from the
component palette rather than by writing tags, and it converts your `.sspj` for you. The tag
reference on this page still applies — the components write these tags.
:::

## How it works

The plugin registers a family of `[ss_*]` KAG custom tags onto Tyrano's `master_tag`.
A single self-registering `main.js` (an IIFE bundle) works across TyranoScript,
TyranoBuilder, and TyranoStudio.

- Each `[ss_new]` creates a named player: it loads the `.ssab`, adds a `<div>` to the
  target layer, and drives the animation with [`ssplayer-webgl`](/usage/webgl)'s
  `SSPlayer` (WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies), drawn on the
  layer's shared canvas.
- The `<div>` is tagged with **your player name** as its identifier, so Tyrano's own
  `[anim]` / `[kanim]` tags drive it directly — just like any character.
- Only the **WASM binary** (`ssruntime_bg.wasm`) stays external; the renderer and
  core JS are inlined into `main.js`.

## Requirements

| | |
| --- | --- |
| TyranoScript | Verified on **V520** (the `master` build the example fetches). Only automatic save restore needs **V515 or later** |
| Rendering | **WebGL1** required (auto-upgrades to WebGL2 when available) |

Restoring players from a save uses TyranoScript's `load-beforemaking` and `snapsave-start`
events, which were **added in V515**. On **V514 and earlier** there is no event system, so the
automatic restore does not run and you must write `[ss_restore]` into `data/scenario/make.ks`
(see "6. Save / load & lifecycle"). No other tag is affected.

## 1. Install

::: tip Which download do I need?
The plugin ZIP described here is **for TyranoScript**. If you author in **TyranoBuilder**,
install `ssplayer.tbp` instead — it already contains this ZIP's three files plus the editor
half (components and auto-conversion), so it is the only download you need.
**Install one or the other, never both:** they unpack to the same
`data/others/plugin/ssplayer/`, so stacking them leaves the editor and runtime halves on
different versions.
:::

1. Download `ssplayer-tyranoscript-plugin-<version>.zip` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranoscript&expanded=true): open the Release named
   `@spritestudio/ssplayer-tyranoscript <version>` and take the file under **Assets**, not
   the *Source code* archives. Unzip it — it contains an `ssplayer/` folder holding
   `init.ks` (the loader), `main.js` (the plugin), and `ssruntime_bg.wasm` (the runtime).
2. Copy that `ssplayer/` folder into your Tyrano project at `data/others/plugin/`.
3. Load it from your scenario with `[plugin name="ssplayer"]`.

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # the plugin bundle (renderer + core inlined)
  ssruntime_bg.wasm    # the animation runtime binary
data/others/ssdata/<ssae name>.ssab   # one per .ssae in your project, named after it
```

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. See [Preparing assets](/usage/assets) for how to convert. Put the
output under `data/others/ssdata/` and point `[ss_new storage=...]` at it.

## 3. Quick start

A minimal scenario that shows one looping character:

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
| `[ss_stop_audio]` | Stop the sounds a player started, now | `name=`(req) |
| `[ss_speed]` | Playback speed (`1` = as authored) | `name=`(req) `speed=`(req) |
| `[ss_seek]` | Move the playhead to a frame | `name=`(req) `frame=`(req) |
| `[ss_section]` | Play only a range of frames (omit both ends to clear) | `name=`(req) `start=` `end=` |
| `[ss_direction]` | Forward / backward, once through / ping-pong | `name=`(req) `direction=` `style=` |
| `[ss_wait]` | Wait until the animation ends (one loop if looping) | `name=`(req) |
| `[ss_wait_signal]` | Wait until the animation fires a signal (the one `command=` names, if given) | `name=`(req) `command=` `var=` |
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

A tag that fails never stops the scenario. With the engine's debug switch on
(`;debugMenu.visible = true` in `data/system/Config.tjs`), the reason appears in the
engine's own error dialog with the scenario file and line — for example
`[ss_play] next="Wiat" is not in others/ssdata/Chara.ssab.`
Turn the switch off for release; the reason then goes only to the browser console.

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

### Speed, seeking and sections

```
[ss_speed name="akane" speed="0.5"]             ; half speed
[ss_seek name="akane" frame="12"]               ; jump to frame 12
[ss_section name="akane" start="10" end="30"]   ; loop frames 10–30 only
[ss_direction name="akane" direction="backward" style="pingpong"]
```

Frame numbers count from 0, as SpriteStudio shows them. `[ss_seek]` keeps a playing
animation playing and a paused one paused. `[ss_section]` moves the playhead to the
start of the section; leave out `start=` or `end=` for that edge of the animation, and
both to go back to the whole of it. `direction=` is `forward` or `backward`, and
`style=` is `normal` (once through) or `pingpong`.

Speed and direction stay when the animation changes. A section does not, because a
frame number means nothing in another animation: `[ss_play anime=]` and a `next=`
follow-up both drop it. All three are saved.

### Waiting for a signal

A signal is a marker an animator places on a frame in SpriteStudio, with a command ID
and optional parameters. `[ss_wait_signal]` holds the scenario until the animation
fires one, so "the moment the attack lands" can be written in the scenario:

```
[ss_play name="akane" anime="attack" loop="false"]
[ss_wait_signal name="akane" command="hit"]   ; hold until the attack lands
[quake count="3" time="300" hmax="20"]
```

`command=` is the command ID set in SpriteStudio; leave it out to take any signal.
`var="f.sig"` stores the command ID of the signal that ended the wait, so an `[if]` can
branch on which one it was. A queued `next=` follow-up counts as part of the wait. If
the animation finishes, or plays a whole loop, without the signal, the wait ends and
the reason is reported like any other tag failure — usually a misspelt command ID.
Signal parameters are not passed on.

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

- `color=` is `#RRGGBB` / `#RRGGBBAA` (alpha defaults to opaque); the `#RGB` shorthand works too, and so does TyranoScript's own `0xRRGGBB`.
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
  to add to `make.ks` — and resume on the frame the save was taken on, with their speed,
  direction and section.
- **Scene changes**: clearing a layer (e.g. `[freeimage]`) releases the players on
  it automatically, whatever cleared it. `[ss_free]` / `[ss_free_all]` are for
  letting a player go without touching the layer.
- **Skip**: while the game is skipping with `skipEffectIgnore = true` in
  `data/system/Config.tjs` (the default), SS effects are cut the way `[chara_show]`'s
  are. `time=` on `[ss_show]` / `[ss_hide]` / `[ss_fadein]` / `[ss_fadeout]` /
  `[ss_move]` becomes the engine's skip duration, and `[ss_wait]` does not wait. The
  animations themselves keep playing. `[ss_wait_signal]` still waits, since what follows
  may branch on the signal.

## 7. Audio

SpriteStudio sound events play through TyranoScript's bundled audio (howler), at the game's SE
volume: the config screen's slider (`[seopt]`) applies, to a sound already playing as well. Sound
files are expected under `data/sound/`; an SS sound name resolves to `data/<dir>/<name>.<ext>`,
the way other storage paths do (tune with `[ss_init sounddir= soundext= sevolume=]`, disable with
`audio="false"`).

A sound plays as many times as its key says, and then stops: SpriteStudio audio has no endless
loop. Stopping, pausing or switching the animation leaves a sound that is already playing alone.
`[ss_stop_audio]` stops the sounds a player started, and `[ss_free]` stops them as it releases
the player; neither touches any other sound. `[stopse]` does not reach these sounds.

## Known limitations

TyranoBuilder is covered by its own plugin, `@spritestudio/ssplayer-tyranobuilder`, which ships
as a `.tbp`, adds SpriteStudio components to the palette, and converts your `.sspj` from inside
the editor — see [TyranoBuilder](/usage/tyranobuilder). What neither integration covers yet is
listed in [Limitations & Scope](/limitations#tyranoscript-tyranobuilder).

## Building from source

```sh
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<v>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` — the archive the GitHub
Release carries; extract `ssplayer/` into `data/others/plugin/`.

To try it in the bundled example:

```sh
pnpm --filter tyranoscript-example run sync:plugin   # copy the built plugin + wasm into the example
```

::: tip TyranoScript itself is not bundled
The example commits only the *authored* scenario, plugin loader, and `.ssab` files — you
place a TyranoScript runtime yourself during development.
:::
