---
description: "The ssplayer-rmmz plugin for RPG Maker MZ: install, convert, deployment, sound and known limitations."
---

# RPG Maker MZ

This plugin plays **SpriteStudio** (`.ssab`) animations in **RPG Maker MZ**, driven by
plugin commands with no code to write. An animation rides on a picture and sits in the
correct Z-order with your characters and pictures. You need a project made in
**SpriteStudio 7.6 or later**.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — run
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

## 2. Convert your animation (.sspj → .ssab) {#_2-convert-your-animation}

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. Test play does the converting, with the `ssconverter_bg.wasm` in
`js/plugins/`.

### Basic use

1. Create a `SpriteStudio_Source/` folder at your project root (beside `js/` and `img/`) and put your
   SpriteStudio project in it — the `.sspj` **and its folder**, since an animation is several files.
   Subfolders are fine.
2. Start a test play. Before the title, every project that changed since it was last
   converted is converted into `spritestudio/<project>/`.

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

The folder is named after the `.sspj`, and each `.ssab` inside after an animation file (`.ssae`),
not after the project (`Ringo.ssae` → `Ringo.ssab`). Show SS's `SSAB File` is therefore
`spritestudio/<project>/<animation file>.ssab`.

### Picking up a change

After saving in SpriteStudio, press **F5** in the test play. It restarts the game, and the change
is converted on the way back up. Only a test play converts; a deployed game never does.

### What counts as a change

At the start of a test play, each project's folder is compared — the **newest modification time
anywhere in it** (`.sspj`, `.ssae`, `.ssce`, textures, all of it) — against what the last
**successful** conversion covered, and only newer sources are converted again. Updating the
plugin rebuilds packs whose sources have not changed, and a missing output folder
(`spritestudio/Ringo/`, say) is rebuilt too.

A reconversion deletes the files the previous one wrote and this one no longer does, so an
animation you remove in SpriteStudio stops being in `spritestudio/` and in your deployed game.
Anything you put in the folder yourself stays. Sounds are not converted — see
[5. Sound](#_5-sound).

The record is `SpriteStudio_Source/.ss_import_state.json`. To force everything to be rebuilt,
delete it (or the output folder) and start a test play.

### Where things go

| Path | What it is | In a deployed game? |
| --- | --- | --- |
| `SpriteStudio_Source/` | Your `.sspj` projects — the input | No — leave it out ([4. Deployment](#_4-deployment)) |
| `spritestudio/<project>/` | The converted `.ssab` + textures | **Yes** — this is what the game plays |
| `SpriteStudio_Source/.ss_import_state.json` | What the last successful conversion covered | No — it sits inside the source folder |
| `js/plugins/ssconverter_bg.wasm` | The converter; with it there, a test play converts | No — leave it out ([4. Deployment](#_4-deployment)) |

`spritestudio/` sits beside `img/`, not inside it: deployment's "Exclude unused files"
deletes unused files from `img/`, so keeping SS assets out of it is what makes them survive
(see [4. Deployment](#_4-deployment)).

### When a conversion fails

If a project fails to convert, the boot stops on MZ's error screen, naming the project and
the reason. Fix it in SpriteStudio, save, and press **Retry**. Two projects with the same
file name stop it too — `chara/hero.sspj` and `enemy/hero.sspj` would both write
`spritestudio/hero/` — so rename one. The console (F8) has the details; nothing is written to a
log file.

### Converting it yourself

If you convert with one of the tools in [Preparing assets](./assets.md), such as
ssconverter-web, put the project-named folder it gives you in `spritestudio/`
(`spritestudio/Ringo/Ringo.ssab`). You then need neither `ssconverter_bg.wasm` nor
`SpriteStudio_Source/`.

## 3. Plugin commands

The plugin commands — the name each shows in the MZ editor, its arguments and what it does — are on
[RPG Maker MZ plugin commands](./rmmz-commands.md).

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
