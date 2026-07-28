[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranobuilder

Use **SpriteStudio 7** animations in **TyranoBuilder** — placed from the
component palette, with no scenario code to write.

Drop a SpriteStudio project into a folder and the editor converts it for you,
every time you save it. The animation then appears in the palette's dropdowns
alongside your other assets.

> **Who this is for:** TyranoBuilder authors.
> Writing scenarios by hand instead? Use
> [`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.md),
> which adds the same `[ss_*]` tags to TyranoScript.
> **Status:** beta.

## Install

Download `ssplayer.tbp` from the
[Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases) page, then
in TyranoBuilder: **plugin settings → add → pick that file**.

**Do not rename the file.** TyranoBuilder takes the plugin's name from it, so
`ssplayer.tbp` has to stay `ssplayer.tbp`.

Nothing else to set up — no plugin tag to write, no runtime to initialise.

> TyranoBuilder's free version loads at most two plugins, and this counts as one.

## Add an animation

1. Put your SpriteStudio project — the `.sspj` **and its folder**, since an
   animation is several files — into `SpriteStudio_Source/` in your project
   folder. Subfolders are fine; the whole tree is searched.
2. Open the project in TyranoBuilder (or just leave it open). Conversion runs by
   itself, and a message tells you when it has.
3. Place a **SpriteStudio 表示** component and pick your animation from the
   dropdowns.

Keep the editor open while you work: re-save the `.sspj` in SpriteStudio and it
is reconverted within a few seconds. Nothing to press.

## The components

Under **プラグイン** in the palette:

| | |
| --- | --- |
| **SpriteStudio 表示** | Load an animation and put it on a layer |
| **SpriteStudio フェードイン / フェードアウト** | Show or hide one |
| **SpriteStudio アニメ変更** | Switch to another animation |
| **SpriteStudio 停止 / 一時停止 / 再開** | Playback control |
| **SpriteStudio 待機** | Hold the story until the animation finishes |
| **SpriteStudio 位置変更 / 移動** | Place it, or slide it over time |
| **SpriteStudio 削除 / 全削除** | Unload one, or all of them |
| **SpriteStudio 全体フェードアウト / フェードイン** | All of them at once, for a scene change |
| **SpriteStudio 全体一時停止 / 全体再開** | All of them at once, for a menu screen |
| **SpriteStudio 音声設定** | Only if you want something other than the defaults |

A few things the fields do that are worth knowing:

- **管理名** is how the other components find the animation. Choose one on
  「表示」; everywhere else it is a dropdown of the names already in the scene.
- **アニメデータ** lists every `.ssab` in your project — the converted ones first,
  but a pack you put somewhere else yourself is offered too.
- **アニメーション** lists what is actually inside the selected pack.
- **次に再生** hands over to another animation when this one ends, which needs
  「ループ再生する」 off — an animation that loops forever never ends.

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
- **It converted, but nothing shows in the game** — make sure 表示 comes before
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
