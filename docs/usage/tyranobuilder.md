---
description: "The ssplayer-tyranobuilder plugin for TyranoBuilder: the auto importer, the components, and troubleshooting."
---

# TyranoBuilder

Place **SpriteStudio** animations from TyranoBuilder's component palette, with no scenario
code to write. Drop a SpriteStudio project into a folder in your game and the editor converts
it for you — when the project opens, and again whenever you ask.
Verified on **TyranoBuilder Ver 3.00**. You need a project made in **SpriteStudio 7.6 or later**.

Writing scenarios by hand instead? See [TyranoScript](/usage/tyrano), which gives you the same
animations as `[ss_*]` tags.

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../examples/tyranoscript/" target="_blank" rel="noreferrer">Live demo</a>** — the
TyranoScript sample scene. There is no separate Builder demo because it is the same runtime:
what the components place is what you see here.

## 1. Install

1. Download `ssplayer.tbp` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranobuilder&expanded=true): open the Release named
   `@spritestudio/ssplayer-tyranobuilder <version>` and take the file under **Assets**, not
   the *Source code* archives. It is the only download you need: it already holds the
   TyranoScript plugin (`init.ks`, `main.js`, `ssruntime_bg.wasm`).
2. In TyranoBuilder, open **Project → Plugins**, press **Add New** and pick that file.

**Keep the file named `ssplayer.tbp`.** TyranoBuilder finds the plugin by its file name, so
under another name, such as `ssplayer-1.2.0.tbp`, nothing installs. The Release's name tells
you the version.

Nothing else to set up — no plugin tag to write, no runtime to initialise.

## The auto importer

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the game
actually plays. This plugin converts the SpriteStudio projects you put in your game's folder
into `.ssab`, inside the editor. Each project becomes one *animation pack* — its `.ssab` files and
their textures — and the component dropdowns list packs.

Imported packs and packs you copy in by hand land in the same place, and the component
dropdowns list both (see [Bringing in a pack you converted yourself](#bringing-in-a-pack-you-converted-yourself)).

### Basic use

1. Put your SpriteStudio project — the `.sspj` **and the rest of its folder**, since an
   animation is several files — into **`SpriteStudio_Source/`** in your project folder. The
   plugin creates that folder on first run, so it is already there waiting, and **Open the source
   folder** (**Project → Plugins** → **SpriteStudio**) opens it.
2. Open the project in TyranoBuilder.
3. A message tells you what was converted. The animation is now in the **SpriteStudio: show**
   component's dropdowns. A conversion that fails says why in a dialog.

Each `.sspj` becomes a folder named after it, under `data/others/ssdata/`:

```
SpriteStudio_Source/Ringo/Ringo.sspj   →   data/others/ssdata/Ringo/Ringo.ssab
                                                                 (+ its textures)
```

Subfolders are searched too, so you can group sources however you like; only the file name of
the `.sspj` itself decides the output name.

::: tip No `.sspj` of your own yet?
The [official SpriteStudio sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is only available in Japanese, but the downloads
themselves are language-neutral. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)
is a good character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one
if you want effects. The downloaded project goes in `SpriteStudio_Source/` exactly as above.
:::

### Picking up a change

A pass runs **when the project is opened**, and after that only when you ask for one —
nothing converts in the background while the editor is open. After saving in SpriteStudio,
there are two ways back:

| | Where | What it does |
| --- | --- | --- |
| **Reconvert now** | on the **SpriteStudio: show** component that plays the animation | Rebuilds that one pack, whatever its record says |
| **Import now** | **Project → Plugins** → **SpriteStudio** | Converts everything added or edited since the project was opened |

**Reconvert now** is the everyday one. **Import now** is for a project you put in
`SpriteStudio_Source/` *while* the project is open: no component can point at it yet, so this
is where it gets converted.

The same window has **Open the source folder** and **Open the import log**, and shows the
converter build it is running (`converter <version> (ssab v1, ssqb v1)`) — the line to quote
when you report a problem.

### What counts as a change

When the project opens, each project's folder is compared — the **newest modification time
anywhere in it** (`.sspj`, `.ssae`, `.ssce`, textures, all of it) — against what the last
**successful** conversion covered, and only newer sources are converted again. Updating the
plugin rebuilds packs whose sources have not changed, and a missing output folder
(`data/others/ssdata/Ringo/`, say) is rebuilt too.

A reconversion deletes the files the previous one wrote and this one no longer does, so an
animation you remove in SpriteStudio stops appearing in the dropdowns and in your exported
game. Anything you put in the folder yourself stays.

The record is `.ss_import_state.json` at the project root. To force everything to be rebuilt,
delete it (or the output folder) and reopen the project.

### Where the importer puts things

| Path | What it is | In an exported game? |
| --- | --- | --- |
| `SpriteStudio_Source/` | Your `.sspj` projects — the input | No |
| `data/others/ssdata/<name>/` | The converted `.ssab` + textures | **Yes** — this is what the game plays |
| `.ss_import_state.json` | What the last successful conversion covered, and which `.sspj` each folder came from | No |
| `ss_import_log.txt` | Every conversion, and why anything failed | No |
| `.ss_tools/ssconverter_bg.wasm` | The converter itself, moved out of the plugin folder | No |

An exported game carries everything under `data/`, so the author-time files sit outside it.

### When a conversion fails

A project that fails to convert, or that loses its folder to another project of the same name, is
named in a dialog with the reason. Fix it in SpriteStudio, save, and use **Reconvert now** (or
**Import now**). The projects that did convert are listed in a short notice instead.

The editor has no console, so every line the importer writes lands in **`ss_import_log.txt`**
at your project root, appended across sessions (it is started over once it passes 256 KB):

```
2026-07-29T04:15:02.118Z  --- session start ---
2026-07-29T04:15:02.140Z  sources: /Users/you/TyranoBuilder/mygame/SpriteStudio_Source
2026-07-29T04:15:02.141Z  output:   /Users/you/TyranoBuilder/mygame/data/others/ssdata
2026-07-29T04:15:02.150Z  converter: worker — converter <version> (ssab v1, ssqb v1)
2026-07-29T04:15:02.219Z  converted Ringo: 14 in -> 2 out (+1 textures) in 78ms -> …/ssdata/Ringo
2026-07-29T04:15:02.220Z  first pass: 1 converted, 0 up to date, 0 failed, 0 dropped
```

When the `converter:` line says `inline`, the editor stops responding while a conversion runs;
the reason is on the same line.

It also records the host environment it found at startup, which is the first thing to look at
if the plugin does not seem to be doing anything.

### Bringing in a pack you converted yourself

The **Animation pack** dropdown lists **every `.ssab` anywhere under `data/`**, with the
imported ones first and the rest alphabetically.

A pack you converted with [`ssconverter-web`, SSConverter GUI or `ssconverter-cli`](/usage/assets)
and copied in by hand shows up like any other — put it wherever suits your project (next to a
scene's images, for instance). The **Animation** dropdown is read out of the `.ssab` itself, so
it is accurate for those packs too.

Only what lives under `SpriteStudio_Source/` is kept in sync automatically. **Reconvert now**
still works on a pack you copied *out of* `data/others/ssdata/`, and rebuilds it where it now
lies rather than back where it was generated; a pack converted somewhere else entirely has no
project here to rebuild it from, and the plugin says so.

### Current limits

- **The folders are fixed.** `SpriteStudio_Source/` and `data/others/ssdata/` are not
  configurable.
- **Textures are copied, not embedded.** Each pack ships its images as sibling files next to
  the `.ssab`. Keep them together if you move a pack by hand.
- **Only `.sspj` files are picked up.** Anything else in `SpriteStudio_Source/` is ignored
  (it is still read as part of a project's folder when deciding whether that project changed).

## The components

Under **Plugins** in the palette:

| | |
| --- | --- |
| **SpriteStudio: show** | Load an animation and put it on a layer |
| **SpriteStudio: fade in / fade out** | Show or hide one |
| **SpriteStudio: change animation** | Switch to another animation in the same pack |
| **SpriteStudio: stop / pause / resume** | Playback control |
| **SpriteStudio: stop sound** | Cut the sounds an animation started |
| **SpriteStudio: wait** | Hold the story until the animation finishes |
| **SpriteStudio: wait for signal** | Hold the story until the animation fires a signal, such as the moment an attack lands |
| **SpriteStudio: speed / jump to frame** | Change the playback speed, or move to a frame |
| **SpriteStudio: play a section / direction** | Loop a range of frames; play forwards, backwards or back and forth |
| **SpriteStudio: talk animation** | Play a talk animation while a character's lines are shown |
| **SpriteStudio: part colour / hide part / part image** | Change one part: tint it, hide it, or swap the cell it draws |
| **SpriteStudio: reset parts** | Undo those part changes |
| **SpriteStudio: place / move** | Place it, or slide it over time |
| **SpriteStudio: remove / remove all** | Unload one, or all of them |
| **SpriteStudio: fade out all / fade in all** | All of them at once, for a scene change |
| **SpriteStudio: pause all / resume all** | All of them at once, for a menu screen |
| **SpriteStudio: sound settings** | Only if you want something other than the defaults |

The names follow TyranoBuilder's own language, which it takes from
`<TyranoBuilder>/lang/lang.txt`, so a Japanese editor shows 「SpriteStudio 表示」and so on.

A few things the fields do that are worth knowing:

- **Player name** is how the other components find the animation. You choose one on *show*;
  everywhere else it is a dropdown of the names already placed in the scene.
- **Animation pack** lists every `.ssab` in the project, converted or hand-copied.
- **Animation** lists what is actually inside the selected pack, read from the `.ssab`.
- **Then play** hands over to another animation when this one ends — an entrance into an idle
  loop, say. It needs *loop forever* off, because an animation that loops forever never ends.
- **Part**, **Cell map** and **Cell** list what is in that player's pack, and **Part** offers only
  the parts the change applies to: a colour takes normal parts, an image normal and mask parts.

Each component writes the matching `[ss_*]` tag verbatim, so the
[tag reference](/usage/tyrano#_4-tags) describes exactly what they do. There is no component for
tracks (`[ss_track]`, `[ss_track_fade]`, `[ss_track_clear]`); those are for TyranoScript scenarios.

## Troubleshooting

A conversion that fails says why in a dialog, and `ss_import_log.txt` at your project root has
the rest — see [When a conversion fails](#when-a-conversion-fails).

While you preview, a component that cannot do its job — a name no *show* created, an animation
the pack no longer has — says why in a dialog naming the scene file and line. An exported game
never shows it: the export turns the engine's debug switch off.

- **The animation is not in the dropdown** — check the `.sspj` is inside `SpriteStudio_Source/`
  together with the rest of its folder, and look for a `FAILED` line in the log.
- **The palette has no SpriteStudio components** — the plugin did not load. Re-add the `.tbp`,
  and check you are not over the Standard edition's two-plugin limit.
- **It converted, but nothing shows in the game** — make sure *show* comes before the
  components that refer to it, and that the layer is one your game uses.
- **One of two projects is never converted** — two `.sspj` of the same file name convert into
  the same `data/others/ssdata/<name>/`, so only the first one found is converted and the
  plugin names both. Rename one of them.
- **A change in SpriteStudio was not picked up** — nothing runs on its own after the project is
  opened. Use **Reconvert now** on the component, or **Import now** in the Plugins window for a
  project that has no component yet; if neither takes, delete `.ss_import_state.json` and reopen
  the project.

