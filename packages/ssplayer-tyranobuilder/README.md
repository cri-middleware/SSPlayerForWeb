[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranobuilder

Use **SpriteStudio 7** animations in **TyranoBuilder** — placed from the
component palette, with no scenario code to write.

Drop a SpriteStudio project into a folder and the editor converts it for you
whenever the project is opened. The animation then appears in the palette's
dropdowns alongside your other assets.

> **Who this is for:** TyranoBuilder authors.
> Writing scenarios by hand instead? Use
> [`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.md),
> which adds the same `[ss_*]` tags to TyranoScript.
> **Status:** beta.

▶️ **[Online demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
the editor plugin itself can't run in a browser, but this is the same runtime it
embeds, driven by a TyranoScript sample (🚧 live after the first release).

## Install

Download `ssplayer.tbp` from the
[Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) page, then
in TyranoBuilder: **plugin settings → add → pick that file**.

**Do not rename the file.** TyranoBuilder takes the plugin's name from it, so
`ssplayer.tbp` has to stay `ssplayer.tbp`.

Nothing else to set up — no plugin tag to write, no runtime to initialise.

**This file is all you need.** The `.tbp` already contains the runtime half — the
`[ss_*]` tags from
[`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.md) — so do
**not** also install that package's plugin ZIP. That ZIP is for TyranoScript; it
unpacks to the same `data/others/plugin/ssplayer/` this file installs to, and
stacking the two leaves the editor and runtime halves on different versions.

> TyranoBuilder's free version loads at most two plugins, and this counts as one.

## Add an animation

1. Put your SpriteStudio project — the `.sspj` **and its folder**, since an
   animation is several files — into `SpriteStudio_Source/` in your project
   folder. Subfolders are fine; the whole tree is searched.
2. Open the project in TyranoBuilder. Conversion runs by itself, and a message
   tells you when it has.
3. Place a **SpriteStudio: show** component and pick your animation from the
   dropdowns.

## After editing in SpriteStudio

Conversion happens **once, when the project is opened** — nothing runs in the
background while you work. So after saving in SpriteStudio, tick **Reconvert
now** on the **SpriteStudio: show** component that plays the animation you
edited. It rebuilds that one pack and reports what it did; the tick box clears
itself, because it is a button rather than a setting.

**Added a *new* `.sspj` while the builder was open?** Reconvert lives on a
component, and a component can only point at a pack that already exists — so
there is nowhere to press for a project that has never been converted. Open the
plugin manager instead (the editor's **Plugin** menu), select **SpriteStudio**,
and press **Import now**. It converts anything added or edited since the project
was opened, exactly as opening the project does.

## The components

Under **Plugin** in the palette:

| | |
| --- | --- |
| **SpriteStudio: show** | Load an animation and put it on a layer |
| **SpriteStudio: fade in / fade out** | Show or hide one |
| **SpriteStudio: change animation** | Switch to another animation |
| **SpriteStudio: stop / pause / resume** | Playback control |
| **SpriteStudio: wait** | Hold the story until the animation finishes |
| **SpriteStudio: place / move** | Place it, or slide it over time |
| **SpriteStudio: remove / remove all** | Unload one, or all of them |
| **SpriteStudio: fade out all / fade in all** | All of them at once, for a scene change |
| **SpriteStudio: pause all / resume all** | All of them at once, for a menu screen |
| **SpriteStudio: sound settings** | Only if you want something other than the defaults |

The names follow TyranoBuilder's own language, which it takes from
`<TyranoBuilder>/lang/lang.txt` — a Japanese editor shows 「SpriteStudio 表示」
and so on.

A few things the fields do that are worth knowing:

- **Player name** is how the other components find the animation. Choose one on
  *show*; everywhere else it is a dropdown of the names already in the scene.
- **Animation pack** lists every `.ssab` in your project — the converted ones
  first, but a pack you put somewhere else yourself is offered too.
- **Animation** lists what is actually inside the selected pack.
- **Then play** hands over to another animation when this one ends, which needs
  *loop forever* off — an animation that loops forever never ends.

Some SpriteStudio features have no component yet: per-part colour and visibility,
and linking an animation to a speaker. Those are written with TyranoBuilder's own
TyranoScript-code component, using the
[`[ss_*]` tags](../ssplayer-tyranoscript/README.md).

## Where things go

| | |
| --- | --- |
| `SpriteStudio_Source/` | your `.sspj` projects — **not** included in an exported game |
| `data/others/ssdata/` | the converted animations your game plays |
| `ss_import_log.txt` | what was converted, and any errors |

You can keep a converted `.ssab` anywhere under `data/` if you prefer; the
dropdown finds it either way.

## If something goes wrong

Open `ss_import_log.txt` in your project folder. Every conversion is recorded
there, with the reason when one fails.

- **The animation does not appear in the dropdown** — check the `.sspj` is inside
  `SpriteStudio_Source/`, together with the rest of its folder.
- **The palette has no SpriteStudio components** — the plugin did not load.
  Re-add the `.tbp`, and check you are not over the free version's two-plugin
  limit.
- **It converted, but nothing shows in the game** — make sure *show* comes before
  the components that refer to it, and that the layer is one your game uses.

## For contributors

```sh
pnpm --filter @spritestudio/ssplayer-tyranoscript  run build   # the runtime half
pnpm --filter @spritestudio/ssplayer-tyranobuilder run build
pnpm --filter @spritestudio/ssplayer-tyranobuilder run pack    # → dist/pack/ssplayer.tbp
pnpm --filter @spritestudio/ssplayer-tyranobuilder run test
```

Going through the install dialog on every build gets old, so install straight
into a project instead:

```sh
node packages/ssplayer-tyranobuilder/scripts/install.mjs mygame --sample
```

Name a project under `~/TyranoBuilder/myproject`, or give a path to one anywhere.
With no name it takes the only project there, or lists them. `--sample` seeds
`SpriteStudio_Source/Ringo/` from the SDK submodule so the first run has
something to convert.

Then open (or reopen) the project. There is no DevTools in TyranoBuilder's main
window, so `<project>/ss_import_log.txt` is where to look — it records the host
environment and every conversion, and appends across sessions.

[ROADMAP.md](./ROADMAP.md) covers what is left to build and how the editor works
inside, including the parts the vendor does not document.

## Licence

BSD-3-Clause. See [LICENSE.md](./LICENSE.md).
