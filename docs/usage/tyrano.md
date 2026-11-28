---
description: "The ssplayer-tyranoscript plugin for TyranoScript: install, convert, a first scene, movement and effects, save and load, and audio."
---

# TyranoScript

Show and play **SpriteStudio** (`.ssab`) animations inside a **TyranoScript** visual novel by
writing `[ss_*]` tags in your scenario — no coding required. The animations sit on Tyrano's
layers alongside characters, backgrounds and messages, and Tyrano's own `[anim]` / `[kanim]`
move them too. Projects made in TyranoStudio use it the same way.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** — a
visual-novel scene driven entirely by `[ss_*]` tags.

::: tip Building in TyranoBuilder?
See [TyranoBuilder](./tyranobuilder.md) instead. It is the same runtime, reached from the
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
plugin actually plays. Convert it with one of the tools in [Preparing assets](./assets.md) —
[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) runs in the browser
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
[Chaining animations](./tyrano-tags.md#chaining-animations). A runnable minimal project lives at
`examples/tyranoscript-example`; its commented
[`first.ks`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/tyranoscript-example/data/scenario/first.ks)
works through entrances, `[anim]` fades, several layers and save/load.

## 4. Tags

Every `[ss_*]` tag, with what it takes and what it does, is on [TyranoScript tags](./tyrano-tags.md):
preloading, chaining, crossfades and tracks, speed and sections, signals, talk animations and part
overrides.

## 5. Movement & effects with `[anim]` / `[kanim]`

Each SS player is a real element on the layer, tagged with your player name, so Tyrano's
own `[anim]` / `[kanim]` tags drive it directly — just like any character. The element is a
positioning box: the drawing happens on the layer's shared canvas, which follows the element
every frame (see [Resources & lifecycle](../customize/resources.md)):

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
[Limitations & Scope](../limitations.md#tyranoscript-tyranobuilder).

