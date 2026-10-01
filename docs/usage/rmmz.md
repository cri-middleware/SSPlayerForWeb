---
description: "The ssplayer-rmmz plugin for RPG Maker MZ: install, convert, plugin commands, deployment, sound and known limitations."
---

# RPG Maker MZ

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

::: warning Alpha
`@spritestudio/ssplayer-rmmz` is an **alpha** (`7.0.0-alpha.1`). The
package is **private and not published on npm**. Its rendering is built on
[`ssplayer-webgl`](/usage/webgl)'s `SSWebGLRenderer`.

**There are no releases yet.** Once the first release ships, a plugin ZIP will be
distributed on **GitHub Releases** — but for now the only way to obtain it is to
[build from source](#building-from-source). You cannot install it from npm.

:::

This plugin plays **SpriteStudio** (`.ssab`) animations in **RPG Maker MZ**. Because
the animation is drawn straight into MZ's PixiJS v5 renderer, it sits in the correct
Z-order with your characters and pictures.

▶️ **<a href="../examples/rmmz/" target="_blank" rel="noreferrer">Live demo</a>** — run
the bundled sample MZ project in your browser (goes live once the first release is
published 🚧).

## How it works

Animations are drawn **directly into MZ's own PixiJS v5 renderer** (the same approach as
MZ's Tilemap and the bundled Effekseer). There is no overlay canvas, so they render in
correct Z-order with characters and pictures.

- `SSPlayer` extends `PIXI.Container`, and `SSPlayerRenderer` — a registered
  `PIXI.ObjectRenderer` (`'ssplayer'`) — reuses [`ssplayer-webgl`](/usage/webgl)'s
  `SSWebGLRenderer` against MZ's shared `gl`. Reusing that renderer means masks,
  effects, the 13 SS integration shaders, and instance parts all work out of the box.
- It bundles the **no-SIMD (scalar)** WASM, so it runs on MZ's bundled NW.js (a Chromium
  without WebAssembly SIMD) with no launch flags. If initialization fails, SS animations
  are disabled but the game still boots.

## 1. Install

1. Get `ssplayer-rpgmakermz.js` **and** `ssruntime_bg.wasm` — plus `ssconverter_bg.wasm`
   if you want test play to convert your `.sspj` for you
   ([below](#convert-on-test-play)). **No release is published yet**, so for now you build
   them yourself (see [Building from source](#building-from-source)). Once the first
   release ships, you'll download the plugin ZIP from **GitHub Releases** instead.
2. Copy them into your project's `js/plugins/`, flat (the WASM files must sit next to the
   `.js`).
3. Enable **ssplayer-rpgmakermz** in the Plugin Manager. There are no parameters — the
   WASM files are auto-loaded from the same folder as the plugin `.js`.

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. See [Preparing assets](/usage/assets) for how to convert.

Put the output under a **`spritestudio/` folder at your project root** — beside `img/`,
not inside it. Deployment deletes unused files from `img/` (see
[Deployment](#_4-deployment) below), so keeping SS assets out of it is what makes them
survive:

```
MyGame/
├── img/                     ← pruned by "Exclude unused files"
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   └── ssruntime_bg.wasm
└── spritestudio/            ← safe
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png        ← textures sit beside their .ssab
```

Each `.ssab` is named after an animation file (`.ssae`) in the project, not after the
project: the converter writes one per `.ssae` (`Ringo.ssae` → `Ringo.ssab`). The `Show SS`
path is therefore `spritestudio/<project>/<animation file>.ssab`. Keep each `.ssab` and its
textures in the same folder — the plugin resolves textures relative to the `.ssab`.

### Convert on test play

With `ssconverter_bg.wasm` in `js/plugins/`, test play does the converting for you:

1. Put your SpriteStudio project under `SpriteStudio_Source/` at your project root — the
   `.sspj` **and its folder**, since an animation is several files. Subfolders are fine.
2. Start a test play. Before the title, every project that changed since it was last
   converted is converted into `spritestudio/<project>/`, a folder named after its
   `.sspj`. The `.ssab` files inside are named after the `.ssae` files, as above.
3. After saving in SpriteStudio, press **F5** in the test play. It restarts the game, and
   the change is converted on the way back up.

```
MyGame/
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   ├── ssruntime_bg.wasm
│   └── ssconverter_bg.wasm     ← converts on test play
├── SpriteStudio_Source/        ← you put projects here
│   └── Ringo/
│       ├── Ringo.sspj
│       └── …                   (.ssae, .ssce, textures)
└── spritestudio/               ← test play writes here
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png
```

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

## 3. Plugin commands

Run these from an event's **Plugin Command** → `ssplayer-rpgmakermz`. An SS animation
rides on an MZ **picture**, so *Move Picture* / scale / Z-order / save-load all apply for
free.

The bold names below are the labels shown in the MZ editor; the value in parentheses is
the internal command ID.

**Show / attach**

- **Show SS** (`showSS`) — create a picture and attach an animation in one step.
- **Set SS As Picture** (`setSSAsPicture`) — attach SS to a picture you have **already**
  shown with the native *Show Picture* command. From there, position and erase it with
  the standard *Move / Erase Picture* commands.

**Animation control**

- **Change SS Animation** (`changeSSAnimation`) — switch to another animation **within
  the same `.ssab`** (no reload).
- **Play SS Once** (`playSSOnce`) — play an animation a set number of times, then
  **auto-return to the current loop** (idle → expression → idle).
- **Play SS Sequence** (`playSSSequence`) — a comma-separated list where each entry plays
  once except the **last, which loops**.
- **Set SS Speed** (`setSSSpeed`) — a playback-speed multiplier (subframe-interpolated,
  smooth even when slow).

**Part overrides (colour / cell / visibility)**

Replace how one part looks at run time, **winning over the animation's keyframes**. The
settings are stored on the picture, so they **survive save/load**.

- **Set SS Part Color** (`setSSPartColor`) — tint one part. The colour is hex
  (`#RRGGBB` / `#RRGGBBAA`) because MZ has no colour parameter type. **Normal parts only.**
- **Set SS Part Visibility** (`setSSPartVisibility`) — force-hide one part. Turn on
  `cascade` to hide its descendants too: an authored hide never cascades, so this is the
  way to hide a whole body part.
- **Set SS Part Cell** (`setSSPartCell`) — make a part draw a different cell (swapping
  equipment, for instance). The cell-map name carries no `.ssce` extension. **Normal and
  mask parts only.**
- **Clear SS Part Overrides** (`clearSSPartOverrides`) — leave `part` blank to clear every
  part on that picture.

**Priority** (colour / cell only) is one of *yield to the next keyframe* / *hold until the
animation changes* (default) / *permanent*. Changing the animation clears everything but
the **permanent** ones — the saved copy is pruned at the same time, so nothing the runtime
discarded comes back on load. Visibility has no priority mode and is always cleared by an
animation change.

**Part tracking (script only)**

Making a display object of your own follow a part has **no plugin command**. Get the
`SSPlayer` from a script and call `attachToPart()` — see
[Part tracking](/customize/part-following).

**Playback / lifecycle**

- **Play / Pause / Stop / Remove SS** (`playSS` / `pauseSS` / `stopSS` / `removeSS`), and
  **Wait for SS** (`waitForSS`) — by `pictureId`. *Wait for SS* holds the event until
  every configured loop has played (give it a finite `loop`; note `0` is a synonym for
  infinite, so it waits forever).

**Lip-sync (talking portrait — advanced)**

- **Set SS Talk** (`setSSTalk`) — bind a picture to a **speaker name** (the message name
  box): it plays `talk` while that speaker's message is on screen and `idle` otherwise.
- **Clear SS Talk** (`clearSSTalk`) — unbind it (do this when the conversation ends).

Leaving `animation` empty auto-picks the first; a wrong name warns in the console and
lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).

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

::: warning Migrating an existing project
If your assets are still under `img/spritestudio/`, move the whole folder up one level to
`spritestudio/` and update the `SSAB File` argument of each `Show SS` / `Set SS As
Picture` command (drop the leading `img/`).
:::

**Trade-off — encryption.** MZ's *Encrypt Image Files* option is likewise limited to
`img/` and `audio/`, so SS textures outside `img/` ship unencrypted. If you want them
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

## Known limitations

- The picture's **tint and blend mode don't affect** the SS animation. *Opacity*, *move* and *scale*
  **do** apply.
- **Some screen effects behave differently** from a normal picture (a few PIXI filters
  can shift the animation out of place). MZ's own flash / tint overlays are unaffected.

`SSWebGLRenderer` now takes a world tint, which is what made opacity inheritance work. Wiring
MZ's *tint* through it, and injecting a projection matrix for the remaining projection
limitation, are planned follow-ups.

## Building from source

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz run pack   # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

To try it in the bundled MZ example:

```sh
pnpm --filter rmmz-example run sync:plugin   # copy the built plugin + no-SIMD wasm into js/plugins/
pnpm deploy-examples                         # convert the SS-SDK test projects into spritestudio/
nw examples/rmmz-example/SampleProject       # Test Play (or open the project in the MZ editor)
```

To try [conversion on test play](#convert-on-test-play) there, copy
`packages/ssconverter-core/wasm/ssconverter_bg.wasm` into `SampleProject/js/plugins/` and
put a SpriteStudio project under `SampleProject/SpriteStudio_Source/`; both are
git-ignored. `sync:plugin` leaves the converter out because the sample is also published
as the web demo, where nothing converts.

No NW.js? Use the browser harness at `examples/rmmz-harness` (real `SSPlayer` /
`SSPlayerRenderer` against PixiJS v5). Track progress in
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md).
