---
description: "The ssplayer-tyranoscript plugin for TyranoScript: the scenario tags, movement and effects, save and load, and audio."
---

# TyranoScript

Show and play **SpriteStudio** (`.ssab`) animations inside a **TyranoScript** visual novel by
writing `[ss_*]` tags in your scenario — no coding required. The animations sit on Tyrano's
layers alongside characters, backgrounds and messages, and Tyrano's own `[anim]` / `[kanim]`
move them too. Projects made in TyranoStudio use it the same way.

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../examples/tyranoscript/" target="_blank" rel="noreferrer">Live demo</a>** — a
visual-novel scene driven entirely by `[ss_*]` tags.

::: tip Building in TyranoBuilder?
See [TyranoBuilder](/usage/tyranobuilder) instead. It is the same runtime, reached from the
component palette rather than by writing tags, and it converts your `.sspj` for you. The tag
reference on this page still applies — the components write these tags.
:::

## Requirements

| | |
| --- | --- |
| TyranoScript | Verified on **V6**: **Ver603b**, the same build as the `master` the example fetches, and **Ver602c**, the build TyranoStudio 6.03 creates new projects with. Only automatic save restore needs **V515 or later** |
| Rendering | **WebGL1** required (auto-upgrades to WebGL2 when available) |
| SpriteStudio | Projects made in **SpriteStudio 7.6 or later** |

Restoring players from a save uses TyranoScript's `load-beforemaking` and `snapsave-start`
events, which were **added in V515**. On **V514 and earlier** there is no event system, so the
automatic restore does not run and you must write `[ss_restore]` into `data/scenario/make.ks`
(see "6. Save / load & lifecycle"). No other tag is affected.

## 1. Install

1. Download `ssplayer-tyranoscript-plugin-<version>.zip` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranoscript&expanded=true): open the Release named
   `@spritestudio/ssplayer-tyranoscript <version>` and take the file under **Assets**, not
   the *Source code* archives. Unzip it — it contains an `ssplayer/` folder holding
   `init.ks` (the loader), `main.js` (the plugin), `ssruntime_bg.wasm` (the runtime), and
   `readme.txt` (the version and a quick start, in Japanese).
2. Copy that `ssplayer/` folder into your Tyrano project at `data/others/plugin/`.
3. Load it from your scenario with `[plugin name="ssplayer"]`.

```
data/others/plugin/ssplayer/
├── init.ks
├── main.js
├── ssruntime_bg.wasm
└── readme.txt
```

**The location and the folder name are fixed.** `[plugin name="x"]` is TyranoScript
shorthand for `[call storage="../others/plugin/x/init.ks"]`, so the plugin has to sit at
exactly `data/others/plugin/ssplayer/`; renamed or moved, `[plugin name="ssplayer"]` finds
nothing. The paths inside `init.ks` are written against that location too.

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. Convert it with one of the tools in [Preparing assets](/usage/assets) —
<a href="../ssconverter/" target="_blank" rel="noreferrer">ssconverter-web</a> runs in the browser
with nothing to install — and put what it gives you under `data/others/ssdata/`, one folder per
project. The ZIP from ssconverter-web already holds that folder, named after the project, so
extracting it there is all it takes.

```
data/others/ssdata/
└── Ringo/
    ├── Ringo.ssab
    └── Ringo.png
```

Each `.ssab` is named after its animation file (`.ssae`). `[ss_new]`'s `storage=` is a path from
`data/` — here, `storage="others/ssdata/Ringo/Ringo.ssab"`.

::: tip No `.sspj` of your own yet?
The [official SpriteStudio sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is only available in Japanese, but the downloads
themselves are language-neutral. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)
is a good character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one
if you want effects. The downloaded project converts exactly as above.
:::

## 3. Quick start

A minimal scenario that shows one looping character. Load the plugin once, at the top of your game:

```
; first.ks
[plugin name="ssplayer"]
```

Then show a character wherever you want one:

```
; scene1.ks
[ss_new name="chr" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[plugin]` loads the plugin and starts the animation runtime. It is the only
  line that belongs in `first.ks`, and the only setup there is: no `[ss_init]`,
  and nothing to add to `make.ks`.
- `[ss_new]` creates a named player, loads its `.ssab`, drops it on a layer, and plays.
- `[ss_play]` plays or switches an animation on an existing player.

One `.ssab` can hold several animations (idle, smile, jump …); `anime=` picks one by name,
and an empty one picks the first:

```
[ss_play name="chr" anime="smile"]                ; switch animation (same .ssab, no reload)
[ss_play name="chr" anime="jump" loop="false"]    ; play once…
[ss_wait name="chr"]                              ; …hold the scenario until it ends
[ss_play name="chr" anime="wait" loop="true"]     ; …then back to the idle loop
```

The same without stopping the scenario is a `next=` — see
[Chaining animations](#chaining-animations). A runnable minimal project lives at
`examples/tyranoscript-example`; its commented
[`first.ks`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/tyranoscript-example/data/scenario/first.ks)
works through entrances, `[anim]` fades, several layers and save/load.

## 4. Tags

| Tag | Role | Key attributes |
| --- | --- | --- |
| `[ss_init]` | **Sound settings.** The runtime is already started by `[plugin name="ssplayer"]`, so this is only for changing audio routing | `audio=`, `sounddir=`, `soundext=`, `sevolume=` (`wasm=` is set by the plugin) |
| `[ss_new]` | Create player → load ssab → insert on the layer → play | `name=`(req) `storage=`(req) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` `visible=` `zindex=` |
| `[ss_play]` | Play / switch animation, optionally queueing a follow-up | `name=`(req) `anime=` `transition=` `loop=` `start=` `next=` `nextloop=` `atframe=` |
| `[ss_show]` | Put a player on screen (reposition / entrance animation / fade) | `name=`(req) `x=` `y=` `scale=` `zindex=` `anime=` `transition=` `loop=` `next=` `time=` `wait=` |
| `[ss_hide]` | Take a player off screen, keeping it loaded | `name=`(req) `time=` `wait=` |
| `[ss_fadein]` / `[ss_fadeout]` | Fade every player at once (scene changes) | `time=` `wait=` |
| `[ss_chara]` | Link a player to a speaker: talk animation while they speak | `name=`(req) `jname=` `talk=` `idle=` `transition=` |
| `[ss_track]` | Lay an animation on a track above the character's own (track 0) | `name=`(req) `track=`(req) `anime=`(req) `alpha=` `blend=` `loop=` `transition=` |
| `[ss_track_fade]` | Fade how strongly a track applies | `name=`(req) `track=`(req) `alpha=` `time=` `wait=` |
| `[ss_track_clear]` | Empty a track | `name=`(req) `track=`(req) |
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
| `[ss_part_visible]` | Force-hide a part (or revert it); `cascade=` takes its descendants too | `name=`(req) `part=`(req) `hide=` `cascade=` |
| `[ss_part_cell]` | Make a part draw another cell (Normal / mask parts only) | `name=`(req) `part=`(req) `cellmap=`(req) `cell=`(req) `priority=` |
| `[ss_part_clear]` | Clear part overrides (every part when `part=` is omitted) | `name=`(req) `part=` |
| `[ss_free]` | Release one player | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save. **Not needed** — the plugin does this itself on load; use it only to make the load *wait* for the players, or on an engine with no event system | — |

What the shared attributes take:

- `x` / `y`: Tyrano's normal top-left pixels (`config.scWidth × scHeight`, default `0,0`),
  the same as any other on-screen element. The animation's **anchor** lands at that point.
- `loop`: `true` = infinite (default) / `false` = once / a number = that many loops.
- `layer`: the Tyrano layer number (**higher = in front**; default `0`). `page` is `fore`
  (default) / `back`.
- `scale`: a scale factor (default `1`).
- `anime`: an animation name inside the `.ssab`; empty picks the **first** animation.
- `[ss_play]`'s `start`: the frame to start from (default `-1` = from the beginning of the animation, or of its `[ss_section]`).
- `visible`: `false` loads the player without showing it — see
  [Preload, show, hide](#preload-show-hide).
- `zindex`: stacking order *within one layer*. Without it, players on the same layer stack
  in creation order.
- `time`: a duration in ms — a fade, or for `[ss_move]` the travel time. `[ss_show]` / `[ss_hide]`
  default to `0` (instant), `[ss_fadein]` / `[ss_fadeout]` to `1000`, `[ss_track_fade]` and `[ss_move]` to `500`.
- `wait`: `true` holds the scenario until the effect finishes — the default for the fades,
  not for `[ss_move]`.

The rest are described with their tags below.

A tag that fails never stops the scenario. With the engine's debug switch on
(`;debugMenu.visible = true` in `data/system/Config.tjs`), the reason appears in the
engine's own error dialog with the scenario file and line — for example
`[ss_play] next="Wiat" is not in others/ssdata/Ringo/Ringo.ssab.`
Turn the switch off for release; the reason then goes only to the browser console.

### Preload, show, hide

`[ss_new visible="false"]` loads a player **without displaying it**, so a heavy `.ssab`
can be prepared ahead of the scene that needs it and revealed instantly:

```
[ss_new name="akane" storage="others/ssdata/Akane/Akane.ssab" visible="false"]
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
reach its end). `nextloop=` sets the follow-up's loop count. An animation that ends
before reaching its `atframe=` switches at its end. The next `[ss_play]` or
`[ss_show anime=]` cancels a queued follow-up.

### Crossfades and tracks

`transition=` (ms) on `[ss_play]` / `[ss_show]` crossfades from what is on screen to the
new `anime=` instead of cutting; `0` or omitted cuts, as before. On `[ss_show]`, `time=`
is still the fade onto the screen. On `[ss_chara]`, `transition=` crossfades between the
talk and idle animations. A `next=` follow-up still cuts.

```
[ss_play name="akane" anime="smile" transition="300"]   ; blend into smile over 0.3 s
```

A crossfade keeps the part overrides and the tracks. A cut to another animation clears
the part overrides that are not `permanent`, and empties the tracks; cutting to the
animation already playing changes nothing.

Tracks lay more animations **above** the character's own one (track 0, the one
`[ss_play]` sets) — a gesture over a walk, an expression over a pose:

```
[ss_track name="akane" track="1" anime="wave" blend="add" loop="false"]  ; wave over the walk
[ss_track_fade name="akane" track="1" alpha="0" time="500"]               ; fade it out
[ss_track_clear name="akane" track="1"]                                   ; then empty the track
```

- `track=` is `1` or above; track 0 is refused.
- `alpha=` is how strongly the track applies (default `1`). `blend=` is `mix` (default —
  blend toward this animation) or `add` (add its offset from the setup pose).
- `loop=` works as everywhere else; a finished track holds its last frame until it is
  faded or cleared. `transition=` crossfades from what the track was playing.
- `[ss_track_fade]` fades to `alpha=` (default `0`) over `time=` ms (default `500`, `0` = at
  once). `wait="true"` (the default) holds the scenario until the fade ends, but not on a
  paused or stopped player. It fails on a track `[ss_track]` has not laid anything on.
- `[ss_track_clear]` empties a track at once; fade it to `0` first to take it off gradually.
- Tracks are saved. A save taken during a `[ss_track_fade]` restores the track where the
  fade ends.

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
both to go back to the whole of it. An `end=` before `start=` is refused: the section stays as it
was, and the browser console says why. `direction=` is `forward` or `backward`, and
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
out, and returns to idle when it ends — the `jname` idea of TyranoScript's character plugins, expressed as
whole SpriteStudio animations rather than a mouth parameter:

```
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
Nice to meet you.[p]
```

`jname=` matches the `#name` in your scenario or the Tyrano chara id; left out, it is the
player's own name. An empty `idle=` returns to whatever `[ss_play]` last set, so an
expression change survives the next line. The talk/idle swap is not saved, so a save
taken mid-line restores the character in their normal animation. `talk=""` unbinds. In
skip / `[nowait]` mode the engine prints the whole line at once, and no talk animation
flickers past.

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
  mode and is always cleared by an animation change. A `transition=` crossfade clears none of them.

## 5. Movement & effects with `[anim]` / `[kanim]`

Each SS player is a real element on the layer, tagged with your player name, so Tyrano's
own `[anim]` / `[kanim]` tags drive it directly — just like any character. The element is a
positioning box: the drawing happens on the layer's shared canvas, which follows the element
every frame (see [Resources & lifecycle](/customize/resources)):

```
[ss_new name="ringo" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480"]
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
and about its own anchor.
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
  to add to `make.ks` — and resume on the frame the save was taken on, with their
  visibility, stacking order, queued `next=` follow-up, `[ss_chara]` binding, speed,
  direction, section and tracks.
- **Scene changes**: clearing a layer (e.g. `[freeimage]`) or replacing it (`[trans layer=]`)
  releases the players on it automatically, whatever did it. `[ss_free]` / `[ss_free_all]` are for
  letting a player go without touching the layer.
- **Skip**: while the game is skipping with `skipEffectIgnore = true` in
  `data/system/Config.tjs` (the default), SS effects are cut the way `[chara_show]`'s
  are. `time=` on `[ss_show]` / `[ss_hide]` / `[ss_fadein]` / `[ss_fadeout]` /
  `[ss_move]` / `[ss_track_fade]` and `transition=` on `[ss_play]` / `[ss_show]` /
  `[ss_track]` / `[ss_chara]` become the engine's skip duration, and `[ss_wait]` does not wait. The
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

## Troubleshooting

- **Nothing shows, or an error appears**: make sure `[plugin name="ssplayer"]` runs before
  `[ss_new]` — it is what starts the runtime (messages like
  `call [ss_init] before creating players` mean it has not).
- **The `.ssab` won't load**: `storage=` is relative to `data/`
  (e.g. `others/ssdata/Ringo/Ringo.ssab`); keep the texture PNGs in the same folder as the
  `.ssab`.
- **WASM won't initialize**: check that `ssruntime_bg.wasm` sits next to `main.js` in
  `data/others/plugin/ssplayer/` — `init.ks` loads it from there.
- **`[anim]` leaves it barely visible**: `opacity` is **0–255**, not 0–1.
- **An animation name is rejected**: names are case-sensitive; check them against
  SpriteStudio's animation list. An empty `anime=` picks the first.
- **Characters vanish after loading a save**: on TyranoScript V514 or earlier there is no
  event system for the automatic restore — put `[ss_restore]` in `make.ks`.

## Known limitations

What this plugin does not cover is listed in
[Limitations & Scope](/limitations#tyranoscript-tyranobuilder).

