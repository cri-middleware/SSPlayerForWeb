# @spritestudio/ssplayer-tyranobuilder

A **TyranoBuilder** plugin that converts SpriteStudio projects from inside the
editor: drop a `.sspj` folder into `SpriteStudio_Source/`, and the `.ssab` is
built into `data/others/ssdata/` without a terminal, a CLI or a separate app.

This is the author-time half of the TyranoScript integration. The runtime half —
the `[ss_*]` KAG tags that actually draw the animation — lives in
[`@spritestudio/ssplayer-tyrano`](../ssplayer-tyrano/README.md). **TyranoBuilder
and TyranoScript are different tools**; they share the runtime, not the editor,
which is why this is a separate package.

Status: **proof of concept.** The import pipeline works and is covered by tests;
no GUI components are contributed yet.

## The model it copies

`SSPlayerForRenPy/game/spritestudio/auto_importer.rpy` runs at every launch in
developer mode, walks `SpriteStudio_Source/*.sspj`, reconverts whatever changed
and writes into `game/ss_assets/`. This package reproduces that, with one
improvement: Ren'Py only gets a chance at launch, whereas the builder is a
long-lived process, so this keeps watching while the project is open. Save in
SpriteStudio and the pack is rebuilt a few seconds later — no reopen, no restart.

| | Ren'Py | TyranoBuilder |
| --- | --- | --- |
| Hook | `init python:` at launch | `plugin_setting` constructor on project open |
| Refresh | relaunch the game | none — polls every 3 s while open |
| Sources | `SpriteStudio_Source/*.sspj` | same |
| Output | `game/ss_assets/<project>/` | `data/others/ssdata/<project>/` |
| Skip logic | `.ss_import_ok` marker vs newest source mtime | same marker, same rule |

The marker discipline is deliberate: output mtimes cannot tell you a run
succeeded, because a failed conversion still leaves fresh-looking partial files.
Only a marker written after a successful run lets the next run skip.

## How it can work at all

TyranoBuilder Ver 3.00 is an Electron 24 app. Its renderer runs with
`contextIsolation: true`, so a plugin never gets `require()` — but `preload.js`
publishes `fs-extra`, `node:path` and friends on `window.studio_api` through
`contextBridge`. That is the whole basis for an in-editor importer.

Plugins are loaded by `js/app/core/plugin.js`, which does a dynamic
`import()` of `<project>/data/others/plugin/<id>/<id>.builder.js` and calls
`new module.plugin_setting(TB)`. Because that is a real ES module import,
`@spritestudio/ssconverter-core` can be consumed directly — no IIFE build. And
because `ssconverter-core` takes the wasm bytes from its host instead of
fetching them, the plugin just reads the binary through `studio_api` and hands
it over; `fetch()` on a `file://` URL is never needed.

## Trying it

```sh
pnpm --filter @spritestudio/ssplayer-tyranobuilder run build
node packages/ssplayer-tyranobuilder/scripts/install-poc.mjs --sample
```

The installer finds the project under `~/TyranoBuilder/myproject` (or takes
`--project <path>`), copies `ssplayer.builder.js` + `ssconverter_bg.wasm` into
`data/others/plugin/ssplayer/`, and with `--sample` seeds
`SpriteStudio_Source/Ringo/` from the SDK submodule.

Then open (or reopen) the project in TyranoBuilder. A dialog reports the result;
the details land in `<project>/ss_import_log.txt`, which records the host
environment, the binary-bridge decision and every conversion. Converted packs
appear under `data/others/ssdata/<project>/`, ready for
`[ss_new storage="others/ssdata/Ringo/Ringo.ssab"]`.

To watch it work: leave the builder open, re-save the `.sspj` in SpriteStudio,
and check the log a few seconds later.

## What the PoC is proving

Four things were unknown before this existed:

1. the editor really does load an ES module from the project folder;
2. `window.studio_api` gives that module working filesystem access;
3. **binary payloads survive the contextBridge** — the one genuinely
   undocumented step;
4. the converter wasm instantiates in the renderer and produces a real `.ssab`.

(3) is hedged rather than assumed. `HostFs.probeBinaryBridge()` writes a known
byte pattern, reads it back and compares, then picks `buffer` mode or falls back
to base64 (encodings are plain strings, which always survive a structured
clone). The chosen mode is the first thing in the log. `src/autoImporter.test.ts`
simulates both outcomes against a real SDK project and asserts the `.ssab` bytes
come out identical either way.

**Measured on TyranoBuilder Ver 3.00 (Electron 24.8.8, macOS):** all four hold.
The bridge chose `buffer` — a clean `Uint8Array` round-trip, no base64 needed —
and the sample converted in 78 ms (11 files in, 3 out plus its texture). With the
editor left open, re-saving the `.sspj` rebuilt the pack 4 s later, unattended.
The base64 path stays in as insurance for other builds and platforms.

## Constraints found in the host

- **Non-Steam builds load at most two plugins.** `plugin.js` has
  `if (global_build != "steam" && cnt_plugin >= 3) return false;`, and
  `index.html` sets `global_build = "standard"` — the third plugin aborts
  loading entirely, including every plugin after it. Only folders that contain
  a `<id>.builder.js` are counted, so a runtime-only plugin (`init.ks` +
  `main.js`, no builder script) is free; but the budget is two, and an author
  who installs anything else has none left. One folder per integration.
- **Conversion blocks the editor UI**: the wasm call is synchronous. 78 ms for
  the sample, so it is invisible at this size; a Worker is the fix if larger
  projects make it felt, and the core's byte-in/byte-out API already suits one
  (a Worker has no filesystem access of its own anyway).
- **No DevTools in the main window** (`removeMenu()`), hence the log file.
- **No hook for "preview was pressed"** — `map_preview_tag` is declared in
  `plugin.js` but never used. Polling covers it.
- **Unverified**: whether an export copies anything outside `data/`. The source
  folder sits at the project root on the assumption that it does not, which
  would keep source art out of shipped builds automatically (Ren'Py needs an
  explicit `build.classify` for this). Worth confirming before release.

## Next steps

- `defineComponents()` — `[ss_new]` / `[ss_play]` etc. as GUI components, with
  converted packs listed in a `Select`. Build the list lazily inside
  `select_list`: the builder calls `defineComponents()` synchronously right
  after the constructor, before the first import pass has finished.
- Bundle the runtime (`ssplayer-tyrano`'s `main.js`, `ssruntime_bg.wasm`,
  `init.ks`) into the same plugin folder, so `getPluginTag()` starts emitting
  `[plugin name="ssplayer"]`.
- `.tbp` packaging — the builder installs a plugin by unzipping it with
  `adm-zip` into `data/others/plugin/<id>/`, so packaging is a zip with the
  extension renamed.
- Move conversion into a Worker.

## Licence

BSD-3-Clause. See [LICENSE.md](./LICENSE.md).
