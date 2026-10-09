[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranoscript

Show and play **SpriteStudio** animations in a **TyranoScript** visual novel by
writing `[ss_*]` tags in your scenario — no coding required.

> **Who this is for:** scenario writers using TyranoScript — a drop-in plugin
> that adds `[ss_*]` tags for SpriteStudio animations.
> Using **TyranoBuilder**? Install
> [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md)
> instead: it wraps this runtime, adds the animations to the component palette,
> and converts your `.sspj` files for you.
> **Status:** beta.
> **Not what you need?** → [ssplayer-webgl](../ssplayer-webgl/README.md) — the standalone renderer this plugin is built on.

> ⚠️ **Beta.** The scenario-authoring tags are complete, but names and behavior may
> still change before `7.0.0`. Open work lives in the repo
> ([`ROADMAP.md`](./ROADMAP.md)).

▶️ **[Online demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
the bundled TyranoScript sample, running in your browser.

## Install

1. Download `ssplayer-tyranoscript-plugin-<version>.zip` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranoscript&expanded=true): open the Release named
   `@spritestudio/ssplayer-tyranoscript <version>` and take the file under **Assets**, not
   the *Source code* archives. Unzip it; it contains an `ssplayer/` folder.
2. Copy that `ssplayer/` folder into your Tyrano project at `data/others/plugin/`.
3. Load it from your scenario with `[plugin name="ssplayer"]` (see the example below).

**Both the location and the folder name are fixed.** `[plugin name="x"]` is
TyranoScript shorthand for `[call storage="../others/plugin/x/init.ks"]`, so the
plugin has to sit at exactly `data/others/plugin/ssplayer/`; renaming the folder
or moving it elsewhere means `[plugin name="ssplayer"]` finds nothing. The paths
inside `init.ks` are written against that location too.

The folder holds three files: `init.ks` (the loader), `main.js` (the plugin
itself), and `ssruntime_bg.wasm` (the animation runtime). Your `.ssab` animation
files go under `data/others/ssdata/`.

> **This ZIP is for TyranoScript.** Building in TyranoBuilder instead? Install
> `ssplayer.tbp` from
> [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md) and
> nothing else — it already contains these three files, plus the editor half.
> **Install one or the other, never both:** they unpack to the same
> `data/others/plugin/ssplayer/`, so stacking them leaves the editor and runtime
> halves on different versions.

## Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact, pre-built
runtime file the plugin actually plays — it's what `[ss_new storage="..."]` loads.
Convert your `.sspj` with either:

- **Web — no install:** the hosted converter at
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>** — drop the
  **folder** containing your `.sspj` project in and download the `.ssab` (+ its
  texture) as a zip file.
- **Desktop:** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases).

Put the resulting `.ssab` (+ texture) under `data/others/ssdata/` in your Tyrano
project. Grouping each project in its own subfolder (e.g. `data/others/ssdata/Ringo/`)
keeps textures from colliding, so you reference it from `[ss_new]` as
`storage="others/ssdata/Ringo/Ringo.ssab"`.

## Quick start

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

A runnable minimal project is [`examples/tyranoscript-example`](../../examples/tyranoscript-example/README.md).

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
> [`first.ks`](../../examples/tyranoscript-example/data/scenario/first.ks).

## Tags

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
| `[ss_pos]` | Instant move/scale/reorder (anchor-accurate, absolute) | `name=`(req) `x=` `y=` `scale=` `zindex=` |
| `[ss_move]` | Tweened move/scale (easeOut, non-blocking by default) | `name=`(req) `x=` `y=` `scale=` `time=` `wait=` |
| `[ss_part_color]` | Tint a part, winning over the animation (Normal parts only) | `name=`(req) `part=`(req) `color=`(req) `blend=` `priority=` |
| `[ss_part_visible]` | Force-hide a part (or revert it); `cascade=` takes its descendants too | `name=`(req) `part=`(req) `hide=` `cascade=` |
| `[ss_part_cell]` | Make a part draw another cell (Normal / mask parts only) | `name=`(req) `part=`(req) `cellmap=`(req) `cell=`(req) `priority=` |
| `[ss_part_clear]` | Clear part overrides (every part when `part=` is omitted) | `name=`(req) `part=` |
| `[ss_free]` | Release one player | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save. **Not needed** — the plugin does this itself on load; use it only to make the load *wait* for the players, or on an engine with no event system | — |

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
- `command` / `var`: see [Waiting for a signal](#waiting-for-a-signal).
- `[ss_speed]` / `[ss_seek]` / `[ss_section]` / `[ss_direction]`: see [Speed, seeking and sections](#speed-seeking-and-sections).

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
  overlap the tail of one animation with the start of the next. An animation that
  ends before reaching the frame switches at its end.
- The queued follow-up is cancelled by the next `[ss_play]` / `[ss_show anime=]`.

## Speed, seeking and sections

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

## Waiting for a signal

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

> [!WARNING]
> **`scale` and `rotate` do not reach the animation.** They transform the character's
> *element*, and every SS character on a layer is drawn on that layer's shared canvas
> rather than inside its own element — so a CSS transform moves and resizes where the
> character sits without scaling or rotating what is drawn there. Use `[ss_pos]` /
> `[ss_move]`, which scale the animation about its own anchor. `[anim]`'s `scale` /
> `rotate` pivoted on the screen centre, so they were never accurate for this anyway.

**When to use which:**

- **Fades (opacity) / slides / shakes / keyframes** → `[anim]` / `[kanim]`.
- **Position or scale that has to be exact** → `[ss_pos]` (instant) or `[ss_move]`
  (tween). With `[anim]`, `left`/`top` move *relative* to the starting position.

## Save / load & lifecycle

- **Playback keeps running during ordinary text waits** (`[l]` / `[p]`) — that's the
  expected behavior. To freeze animations for a menu or save screen, use
  `[ss_pause_all]` / `[ss_resume_all]`. Off-screen / hidden-tab playback auto-pauses.
- **Save / load**: players are restored on load automatically — there is nothing
  to add to `make.ks` — and resume on the frame the save was taken on.
- **Scene changes**: clearing a layer (e.g. `[freeimage]`) releases the players on
  it automatically, whatever cleared it. `[ss_free]` / `[ss_free_all]` are for
  letting a player go without touching the layer.
- **Skip**: while the game is skipping with `skipEffectIgnore = true` in
  `data/system/Config.tjs` (the default), SS effects are cut the way `[chara_show]`'s
  are. `time=` on `[ss_show]` / `[ss_hide]` / `[ss_fadein]` / `[ss_fadeout]` /
  `[ss_move]` becomes the engine's skip duration, and `[ss_wait]` does not wait. The
  animations themselves keep playing. `[ss_wait_signal]` still waits, since what follows
  may branch on the signal.
- Visibility, stacking order, a queued `next=` follow-up, `[ss_chara]` bindings, and
  the speed, direction and section all survive a save/load, so `[ss_restore]` puts the
  scene back as it was.

## Audio

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

Tags never stall the scenario on failure. With the engine's debug switch on —
`;debugMenu.visible = true` in `data/system/Config.tjs` — the reason appears in
the **engine's own error dialog**, with the scenario file and line, just as a
misspelt tag's does. Turn the switch off for release, as that file says. The
full stack always goes to the browser console (dev tools).

- **Nothing shows / an error appears**: make sure `[plugin name="ssplayer"]` runs
  before `[ss_new]` — it is what starts the runtime (you'll see messages like
  `call [ss_init] before creating players` when it hasn't).
- **The `.ssab` won't load**: `storage=` is relative to `data/`
  (e.g. `others/ssdata/Ringo/Ringo.ssab`); keep the texture PNGs in the same folder as the `.ssab`.
- **WASM won't initialize**: check that `ssruntime_bg.wasm` sits next to `main.js`
  in `data/others/plugin/ssplayer/` — `init.ks` loads it from there. A WebGL-capable
  browser (whatever runs TyranoScript) is assumed.
- **`[anim]` shows it barely visible**: `opacity` is **0–255** (not 0–1); full opacity is `255`.
- **An animation name is rejected**: check it against the animation names in SpriteStudio. Names are case-sensitive; an empty `anime=` picks the first.
- **Characters vanish after loading a save**: restore is automatic, so this should not happen. If it does, the engine is too old to have an event bus — put `[ss_restore]` in `make.ks`.

Known limitations are listed under TyranoScript / TyranoBuilder in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations#tyranoscript-tyranobuilder), and planned work is in [`ROADMAP.md`](./ROADMAP.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

This is a thin adapter. Rendering is handled by
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md)'s `SSPlayer`
(WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies). This package holds **no
GPU code** — it is pure **TyranoScript glue**: adding a `<div>` per character to a
layer (drawn on that layer's shared canvas), coordinate mapping, and playback
control. Remaining work lives in
[`ROADMAP.md`](./ROADMAP.md).

### How it works

- **One runtime for every Tyrano host.** TyranoBuilder and TyranoStudio embed
  TyranoScript, so the same `main.js` — an IIFE bundle that self-registers
  `[ss_*]` onto `master_tag` — serves all of them. The builder's *editor* side is
  a separate package,
  [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md).
- Two build artifacts:
  - `dist/index.js` (ESM) — for bundlers / tests. Side-effect free (exposes
    `registerSSTags()`).
  - `dist/browser/main.js` (IIFE, self-registering, minified) — the **drop-in** you
    place at `data/others/plugin/ssplayer/main.js`. It inlines the WebGL renderer +
    core JS; **only the WASM binary stays external** (ship `ssruntime_bg.wasm`
    alongside it — the plugin's `init.ks` points `[ss_init wasm=...]` at it).

### Internals (coordinates, lifecycle)

- **Coordinates**: Tyrano's top-left logical pixels (`config.scWidth × scHeight`) map
  to `SSPlayer`'s (Y-down) drawing-buffer space; HiDPI folds `devicePixelRatio`
  into the buffer scale, clamped by `maxDPR`.
- **Naming for `[anim]`**: on creation the character's `<div>` is tagged with the player name as a
  CSS class (`$.setName` is `addClass(name)`, the same way TyranoScript identifies a
  named element). It also carries an `ss-player` class, so `$(".ss-player")` selects
  them all. Absolute positioning goes through the renderer's internal `setTransform`
  (the `[spine_mod]` equivalent), which is why `[ss_pos]` / `[ss_move]` exist
  alongside `[anim]`.
- **Save target**: each player's reconstruction data is mirrored into
  `TYRANO.kag.stat.f.__ssplayers`. On load the plugin rebuilds from it on the
  engine's `load-beforemaking` event — the moment the saved variables are back and
  before the scenario resumes, which is the window `make.ks` occupies. `[ss_restore]`
  does the same thing on demand, and adopts an automatic pass already in flight
  rather than rebuilding twice.
- **Release**: `[ss_free]` / `[ss_free_all]` call `destroy()`; do not rely on
  `FinalizationRegistry`.
- **Audio**: SS `onAudio` events are routed to howler (`window.Howl`) via
  `TyranoAudioManager`. We use howler directly rather than `[playse]` because a KAG
  tag would advance the scenario (`nextOrder`). Each player gets its own manager,
  because a player's teardown stops everything on its manager. `TyranoAudioManager`
  can also be used directly from JS.

### Distribution (GitHub Releases)

Not published to npm (`private`). TyranoScript authors consume the plugin bundle:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<ver>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}`, the archive the package's
**GitHub Release** carries; users extract `ssplayer/` into `data/others/plugin/`. The distribution
template lives in [`plugin/`](./plugin/README.md).

Plugin layout on disk:

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # this package's dist/browser/main.js
  ssruntime_bg.wasm    # the @spritestudio/ssplayer-core runtime binary
data/others/ssdata/<ssae name>.ssab   # one per .ssae in your project, named after it
```

### API (ESM)

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyranoscript';

// Call once the TyranoScript runtime is up to register [ss_*].
// Uses the global TYRANO when omitted; a no-op returning false if Tyrano is absent.
registerSSTags();
```

### Development

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run test    # vitest (mock TYRANO harness, no real engine)
```

## License

BSD-3-Clause © CRI Middleware Co., Ltd. — see [LICENSE.md](./LICENSE.md).
