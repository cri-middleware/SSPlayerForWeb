---
description: "The ssplayer-rmmz plugin for RPG Maker MZ: install, convert, plugin commands, deployment, sound and known limitations."
---

# RPG Maker MZ

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

This plugin plays **SpriteStudio** (`.ssab`) animations in **RPG Maker MZ**, driven by
plugin commands with no code to write. An animation rides on a picture and sits in the
correct Z-order with your characters and pictures. You need a project made in
**SpriteStudio 7.6 or later**.

▶️ **<a href="../examples/rmmz/" target="_blank" rel="noreferrer">Live demo</a>** — run
the bundled sample MZ project in your browser.

## 1. Install

1. Download `ssplayer-rmmz-plugin-<version>.zip` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-rmmz&expanded=true): open the Release named
   `@spritestudio/ssplayer-rmmz <version>` and take the file under **Assets**, not the
   *Source code* archives. It holds `ssplayer-rpgmakermz.js`, `ssruntime_bg.wasm` and
   `ssconverter_bg.wasm`.
2. Unzip it and copy the three files themselves — not a folder around them — into your project's
   `js/plugins/` (the WASM files must sit next to the `.js`).
3. Turn **ssplayer-rpgmakermz** ON in **Tools → Plugin Manager**. There are no parameters — the
   WASM files are auto-loaded from the same folder as the plugin `.js`.

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. Test play does the converting, with the `ssconverter_bg.wasm` in
`js/plugins/`:

1. Create a `SpriteStudio_Source/` folder at your project root (beside `js/` and `img/`) and put your
   SpriteStudio project in it — the `.sspj` **and its folder**, since an animation is several files.
   Subfolders are fine.
2. Start a test play. Before the title, every project that changed since it was last
   converted is converted into `spritestudio/<project>/`.
3. After saving in SpriteStudio, press **F5** in the test play. It restarts the game, and
   the change is converted on the way back up.

```
MyGame/
├── img/
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   ├── ssruntime_bg.wasm
│   └── ssconverter_bg.wasm     ← converts on test play
├── SpriteStudio_Source/        ← you put projects here
│   └── Ringo/
│       ├── Ringo.sspj
│       ├── Ringo.png
│       └── …
└── spritestudio/               ← test play writes here
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png
```

::: tip No `.sspj` of your own yet?
The [official SpriteStudio sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is only available in Japanese, but the downloads
themselves are language-neutral. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)
is a good character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one
if you want effects. The downloaded project goes in `SpriteStudio_Source/` exactly as above.
:::

The folder is named after the `.sspj`. Each `.ssab` inside is named after an animation file
(`.ssae`), not after the project: the converter writes one per `.ssae` (`Ringo.ssae` →
`Ringo.ssab`). Show SS's `SSAB File` is therefore
`spritestudio/<project>/<animation file>.ssab`. Keep each `.ssab` and its textures in the
same folder — the plugin resolves textures relative to the `.ssab`.

`spritestudio/` sits beside `img/`, not inside it: deployment's "Exclude unused files"
deletes unused files from `img/`, so keeping SS assets out of it is what makes them survive
(see [4. Deployment](#_4-deployment)).

If a project fails to convert, the boot stops on MZ's error screen, naming the project and
the reason. Fix it in SpriteStudio, save, and press **Retry**. Two projects with the same
file name stop it too — `chara/hero.sspj` and `enemy/hero.sspj` would both write
`spritestudio/hero/` — so rename one. The console (F8) has the details.

Only a test play converts; a deployed game never does. It converts only what changed:
the record of past conversions is `SpriteStudio_Source/.ss_import_state.json`. A
conversion also removes the files the previous one wrote and this one no longer does, and
leaves anything else in the folder alone. Sounds are not converted — see
[5. Sound](#_5-sound). Before you deploy, leave the sources out
([4. Deployment](#_4-deployment)).

### Converting it yourself

If you convert with one of the tools in [Preparing assets](/usage/assets), such as
ssconverter-web, put the project-named folder it gives you in `spritestudio/`
(`spritestudio/Ringo/Ringo.ssab`). You then need neither `ssconverter_bg.wasm` nor
`SpriteStudio_Source/`.

## 3. Plugin commands

Run these from an event's **Plugin Command** → `ssplayer-rpgmakermz`. An SS animation
rides on an MZ **picture**, so *Move Picture* / scale / Z-order / save-load all apply for
free.

The bold names below are the labels shown in the MZ editor; the value in parentheses is
the internal command ID.

**Show / attach**

- **Show SS** (`showSS`) — create a picture and attach an animation in one step. Its
  arguments are `Picture Id`, `SSAB File` (e.g. `spritestudio/Ringo/Ringo.ssab`),
  `Animation Name`, `X`, `Y`, `Scale (%)`, `Loop Count`, `Signal -> Switch` and
  `Wait for Completion`. `Loop Count` is `-1` (or `0`) to loop forever, `1` to play once, or the number
  of plays (default `-1`). `Signal -> Switch` is a game switch that turns ON when the animation fires a
  signal — a marker placed on a frame in SpriteStudio — and does not turn OFF by itself; `0` means none.
  Use a `Loop Count` of `1` or more with `Wait for Completion`: an endless animation never finishes.
- **Set SS As Picture** (`setSSAsPicture`) — attach SS to a picture you have **already**
  shown with the native *Show Picture* command. From there, position and erase it with
  the standard *Move / Erase Picture* commands. Don't drive one picture id with both a
  raw *Show Picture* and SS.

**Animation control**

- **Change SS Animation** (`changeSSAnimation`) — switch to another animation **within
  the same `.ssab`** (no reload).
- **Play SS Once (return to loop)** (`playSSOnce`) — play an animation a set number of times, then
  **auto-return to the current loop** (idle → expression → idle).
- **Play SS Sequence** (`playSSSequence`) — a comma-separated list where each entry plays
  once except the **last, which loops** (e.g. `attack1,attack2,wait1`). Once the last
  starts, it is the picture's animation.
- **Set SS Speed** (`setSSSpeed`) — a playback-speed multiplier (subframe-interpolated,
  smooth even when slow).

*Change SS Animation*, *Play SS Once*, *Play SS Sequence* and *Set SS Talk* take a
`Transition (ms)`: above 0 the switch crossfades from what is on screen over that time,
and 0 (the default) cuts.

**Tracks (layering animations)**

Lay more animations over the picture's own one (track 0), on tracks numbered 1 and up — a
gesture over a walk, an expression over a pose. Tracks are saved with the picture. A change of the picture's animation **without** a
crossfade empties them, as it does in the player itself; a crossfade keeps them.

- **Set SS Track** (`setSSTrack`) — lay an animation on a track, with its `Alpha` (how
  strongly it applies), `Blend` (*Mix*, or *Additive* to add its offset from the setup
  pose), `Loop Count` and `Transition (ms)`.
- **Fade SS Track** (`fadeSSTrack`) — fade a track's alpha to `Target Alpha` over
  `Duration (ms)`; `Wait for Completion` holds the event until it completes.
- **Clear SS Track** (`clearSSTrack`) — empty a track. Fade it to 0 first to take it off
  gradually.

**Part overrides (colour / cell / visibility)**

Replace how one part looks at run time, **winning over the animation's keyframes**. The
settings are stored on the picture, so they **survive save/load**.

- **Set SS Part Color** (`setSSPartColor`) — tint one part. The colour is hex
  (`#RRGGBB` / `#RRGGBBAA`) because MZ has no colour parameter type; the four blend
  operations are the authored Parts Color ones. **Normal parts only.**
- **Set SS Part Visibility** (`setSSPartVisibility`) — force-hide one part. Turn on
  `Cascade to descendants` to hide its descendants too: an authored hide never cascades, so this is the
  way to hide a whole body part.
- **Set SS Part Cell** (`setSSPartCell`) — make a part draw a different cell (swapping
  equipment, for instance). The cell-map name carries no `.ssce` extension. **Normal and
  mask parts only.**
- **Clear SS Part Overrides** (`clearSSPartOverrides`) — leave `Part Name` blank to clear every
  part on that picture.

**Priority** (colour / cell only) is one of *Yield to the next keyframe* / *Hold until the
animation changes* (default) / *Permanent (survives animation changes)*. Changing the animation clears everything but
the **permanent** ones — the saved copy is pruned at the same time, so nothing the runtime
discarded comes back on load. Visibility has no priority mode and is always cleared by an
animation change. A crossfade (`Transition (ms)` above 0) is the exception: it keeps every
override.

**Part tracking (script only)**

Making a display object of your own follow a part has **no plugin command**. Get the
`SSPlayer` from a script and call `attachToPart()` — see
[Part tracking](/customize/part-following).

**Playback / lifecycle**

- **Play / Pause / Stop / Remove SS** (`playSS` / `pauseSS` / `stopSS` / `removeSS`), and
  **Wait for SS** (`waitForSS`) — by `Picture Id`. *Wait for SS* holds the event until
  the picture has played every loop of its `Loop Count` (keep that finite: `0` is a synonym
  for infinite, so it waits forever).

**Lip-sync (talking portrait — advanced)**

- **Set SS Talk (lip-sync)** (`setSSTalk`) — bind a picture to a `Speaker Name` (the
  message name box): it plays the `Talk Animation` while that speaker's message is on screen
  and the `Idle Animation` otherwise.
- **Clear SS Talk** (`clearSSTalk`) — unbind it (do this when the conversation ends).

Leave `Animation Name` empty in *Show SS* and *Set SS As Picture* to play the first animation in the
`.ssab`; in *Change SS Animation* it keeps the current one, and *Play SS Once*, *Play SS Sequence* and
*Set SS Track* need a name. A name that is not in the `.ssab` warns in the console and lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).

## 4. Deployment

**Keep SS assets out of `img/` and "Exclude unused files" can stay on.** Per the official
MZ help, that option only ever prunes these three folders:

```
img/   audio/   effects/
```

This plugin loads `.ssab` files and their textures dynamically, so MZ can't tell they are
in use and deletes anything it finds under `img/`. A project-root `spritestudio/` folder
is outside its reach — exactly like `js/plugins/`, which is why the plugin `.js` and
`ssruntime_bg.wasm` already survive. Nothing to register, no extra setup.

Sound files are the exception: MZ plays sound effects only from `audio/se/`, inside the
option's reach — see [5. Sound](#_5-sound).

**Leave the sources out.** Deployment copies the whole project folder, so
`SpriteStudio_Source/` — your editable SpriteStudio projects — would ship with the game.
Enter `SpriteStudio_Source,ssconverter_bg.wasm` in the deployment's
**[Exclude files/folders]** option; the game needs neither to play.

**Trade-off — encryption.** MZ's *Encrypt Image Files* option is likewise limited to
`img/`, so SS textures outside `img/` ship unencrypted. If you want them
encrypted, move the **whole `spritestudio/` folder back under `img/`**
(`img/spritestudio/`) — don't separate the `.ssab` from its textures. The `.ssab` isn't an
image so it stays plain, while the textures beside it get encrypted and the plugin decrypts
them automatically via `ImageManager`. In exchange you must **turn "Exclude unused files"
off**, or **copy `img/spritestudio/` into the deployed output** afterward.

If the `.ssab` or a texture does go missing, the game stops on MZ's own "Failed to load"
screen with the file's path, just as it does for a missing picture. Put the file back and
press Retry to carry on from there.

## 5. Sound

Sound keys play as sound effects through MZ's `AudioManager`, at the game's SE volume. A
key's sound name — its name in SpriteStudio's sound list — is the file
`audio/se/<name>.ogg`, so convert the source files to Ogg Vorbis as for any MZ SE.
*Encrypt Audio Files* covers them like the rest.

A key plays its sound as many times as it sets, one after another; SpriteStudio audio has
no endless loop. Erasing the picture stops the sounds it started and no others, and the
event command *Stop SE* stops them along with every other SE.

**Deployment.** MZ can't see into an `.ssab`, so *Exclude unused files* deletes the sound
files only an animation plays. Register each one in the *Audio File Material List* of the
official MaterialBase.js plugin, or deploy with the option off. MaterialBase.js ships with
MZ in `dlc/BasicResources/plugins/official/`, beside the PluginCommonBase.js it needs.

## How it works

- Animations are drawn straight into MZ's own screen, the way MZ draws its tilemap and its
  built-in animation effects. Nothing is layered on top, so they render in correct Z-order with
  characters and pictures.
- Masks, effects, SpriteStudio's integration shaders (all 13) and instance parts draw as
  they do in the browser WebGL player.
- Playback advances with the picture, so SS animations pause exactly with the game (menus,
  message waits). After a menu, a battle or a load, the picture's animation carries on from
  the frame it was on, paused or finished ones included. Tracks start over, and a *Play SS
  Once* or a *Play SS Sequence* that has not reached its last entry gives way to the
  picture's animation from its start.
- It runs on MZ's bundled NW.js as it is, with no launch options to add. If initialization
  fails, SS animations are disabled but the game still boots, and the console (F8) says why.

## Known limitations

- The picture's **tint and blend mode don't affect** the SS animation. *Opacity*, *move* and *scale*
  **do** apply.
- **Some screen effects behave differently** from a normal picture (a few PIXI filters
  can shift the animation out of place). MZ's own flash / tint overlays are unaffected.


The technical reasons, and the fixes planned for them, are in the plugin's
[README](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/README.md#how-it-works)
and [ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/ROADMAP.md).
