[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranobuilder

Use **SpriteStudio** animations in **TyranoBuilder** — placed from the
component palette, with no scenario code to write.

> **Who this is for:** TyranoBuilder authors.
> Writing scenarios by hand instead? Use
> [`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/README.md),
> which adds the same `[ss_*]` tags to TyranoScript.

▶️ **[Online demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
the editor plugin itself can't run in a browser, but this is the same runtime it
embeds, driven by a TyranoScript sample.

## Quick start

**Building a game?** Read on — install, add, place, with no scenario code to write.
Everything after that (picking up an edit, every component, troubleshooting) is the same
path further in, in the [TyranoBuilder guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyranobuilder).
**Working on the plugin?** [For contributors](#for-contributors--building-from-source) below, then [CONTRIBUTING.md](../../CONTRIBUTING.md).

You need TyranoBuilder, and a project made in **SpriteStudio 7.6 or later**.

1. **Install**: Download `ssplayer.tbp` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranobuilder&expanded=true):
   open the Release named `@spritestudio/ssplayer-tyranobuilder <version>` and take the
   file under **Assets**, not the *Source code* archives. In TyranoBuilder, open
   **Project → Plugins**, press **Add New** and pick that file. Keep the name `ssplayer.tbp` —
   TyranoBuilder takes the plugin's name from it. It is the only download you need: it
   already holds the TyranoScript plugin (`init.ks`, `main.js`, `ssruntime_bg.wasm`).
2. **Add an animation**: Copy your SpriteStudio project — the whole folder, not the `.sspj`
   alone — into `SpriteStudio_Source/` in your game's folder (the plugin creates it the
   first time the project opens), then open or reopen the project. It is converted as the
   project opens, and a message says so.

   ```
   mygame/
   ├── SpriteStudio_Source/
   │   └── Ringo/            ← your project folder, copied whole
   │       ├── Ringo.sspj
   │       ├── Ringo.png
   │       └── …
   └── data/others/ssdata/
       └── Ringo/            ← converted when the project opens
           ├── Ringo.ssab
           └── Ringo.png
   ```

3. **Place it**: From **Plugins** in the component palette, place **SpriteStudio: show** and
   pick your animation from its dropdowns.

After editing in SpriteStudio, press **Reconvert now** on that component — nothing
converts in the background while the editor is open. TyranoBuilder's Standard edition
(without PRO) loads at most two plugins, and this counts as one.

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with. To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).

**Read next:** [TyranoBuilder guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyranobuilder) ·
[The components](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyranobuilder#the-components) ·
[Troubleshooting](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyranobuilder#troubleshooting) ·
[Limitations](https://cri-middleware.github.io/SSPlayerForWeb/limitations#tyranoscript-tyranobuilder)

---

## For contributors — building from source

*Plugin users can stop here — everything below is for hacking on the plugin.*

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

[`examples/tyranobuilderexample`](../../examples/tyranobuilderexample) is a
project to open straight away: one scene that uses the components on Ringo. Create a new
project in the builder for its template, then run
`pnpm --filter tyranobuilderexample run setup <that project>`; its README has the details.

How the editor hosts the plugin, including the parts the vendor does not document, is in the
source comments, chiefly `src/plugin.builder.ts`, `src/builderTypes.d.ts` and `src/buttonParam.ts`.
The conversion itself — the state file, the freshness rule, the Worker, the log — is
[`ssconverter-importer`](../ssconverter-importer)'s, shared with the MZ plugin. The docs site's
[Build Guide](https://cri-middleware.github.io/SSPlayerForWeb/development/build) says how to drive
the real editor from a script, and
[How the Player Is Put Together](https://cri-middleware.github.io/SSPlayerForWeb/development/architecture)
gives the reasons that span the packages. What is left to build is in [ROADMAP.md](./ROADMAP.md).

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).
