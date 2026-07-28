# @spritestudio/ssplayer-tyranobuilder

A **TyranoBuilder** plugin that converts SpriteStudio projects from inside the
editor: drop a `.sspj` folder into `SpriteStudio_Source/`, and the `.ssab` is
built into `data/others/ssdata/` without a terminal, a CLI or a separate app.

This is the author-time half of the TyranoScript integration. The runtime half —
the `[ss_*]` KAG tags that actually draw the animation — lives in
[`@spritestudio/ssplayer-tyrano`](../ssplayer-tyrano/README.md). **TyranoBuilder
and TyranoScript are different tools**; they share the runtime, not the editor,
which is why this is a separate package.

It also contributes the `[ss_*]` components to the editor's palette, so an
animation can be placed and driven without writing any KAG by hand.

One plugin folder holds both halves. This package is the editor half; the
runtime half is `ssplayer-tyrano`'s `main.js`, which registers the tags the
components write. `init.ks` ties them together: its presence makes
`getPluginTag()` emit `[plugin name="ssplayer"]` into
`data/scenario/system/plugin_third.ks`, which TyranoScript expands to
`[call storage="../others/plugin/ssplayer/init.ks"]` →
`[loadjs storage="plugin/ssplayer/main.js"]`. Without it a GUI-built scenario
parses fine and then dies at run time on an unknown `[ss_init]` — the editor
never sees a problem, because the tags only exist inside the running game.

Status: **proof of concept**, verified in the real editor.

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
| Skip logic | `.ss_import_ok` per output folder, vs newest source mtime | same rule, state in `.ss_import_state.json` at the project root |

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

## Installing

```sh
pnpm --filter @spritestudio/ssplayer-tyrano run build        # the runtime half
pnpm --filter @spritestudio/ssplayer-tyranobuilder run build
pnpm --filter @spritestudio/ssplayer-tyranobuilder run pack  # → dist/pack/ssplayer.tbp
```

Then in TyranoBuilder: plugin settings → add → pick `ssplayer.tbp`.

A `.tbp` is a plain zip. The dialog extracts it into
`<project>/data/others/plugin/` and then reads `<id>/<id>.builder.js`, where the
id is **the `.tbp` filename without its extension**. So the archive holds one
top-level `ssplayer/` folder and **the file must keep that name** — rename it to
`ssplayer-1.2.0.tbp` and the install looks for
`ssplayer-1.2.0/ssplayer-1.2.0.builder.js` and finds nothing. Versions belong in
the release, not the filename. `pack-tbp.mjs` verifies the layout from the
finished archive rather than trusting the staging step.

### While developing

Going through the dialog on every build gets old, so `install-poc.mjs` copies
the same files straight into a project:

```sh
node packages/ssplayer-tyranobuilder/scripts/install-poc.mjs --sample
```

It finds the project under `~/TyranoBuilder/myproject` (or takes
`--project <path>`), and with `--sample` seeds `SpriteStudio_Source/Ringo/` from
the SDK submodule.

Either way, open (or reopen) the project afterwards. A dialog reports the result;
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

## What ships

Since an export copies `data/` wholesale, anything the plugin leaves there is
paid for by every player of every game built with it. Author-time files are kept
out of `data/` for that reason:

| At the project root — never exported | Under `data/` — always exported |
| --- | --- |
| `SpriteStudio_Source/` — the `.sspj` projects | `main.js`, `ssruntime_bg.wasm`, `init.ks` — the runtime, 568 kB |
| `.ss_tools/ssconverter_bg.wasm` — 1.4 MB, editor-only | `ssplayer.builder.js` — 194 kB |
| `.ss_import_state.json` — what was converted, and from what | `ja.json` — 6 kB |
| `ss_import_log.txt` | `others/ssdata/` — the packs the game plays |

The converter wasm arrives inside the plugin folder (a `.tbp` can only deliver
there) and is moved out on first load. The last two rows cannot move: the editor
looks for `<plugin>/<id>.builder.js` and `<plugin>/<lang>.json` at fixed paths
under `data/`, so the file has to exist there. Its *size* is what is negotiable,
which is why the bundle is minified.

## Constraints found in the host

- **The plugin id is the `.tbp` filename**, not anything inside the archive —
  so the artefact cannot carry a version in its name (see Installing).
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
- **No module resolution.** The builder hands the file straight to `import()`,
  so one surviving bare specifier rejects the import and the plugin never loads
  — with no error in the UI and nothing in the log, just missing components.
  Every dependency is inlined, and `install-poc.mjs` refuses to deploy a bundle
  that still has one.
- **No DevTools in the main window** (`removeMenu()`), hence the log file.
- **No hook for "preview was pressed"** — `map_preview_tag` is declared in
  `plugin.js` but never used. Polling covers it.
- **An export is three unfiltered copies** — `index.html`, `data/`, `tyrano/`.
  Everything under `data/` ships inside the game and nothing else does, with no
  exclusion mechanism (Ren'Py needs an explicit `build.classify` for the same
  effect). See "What ships".

## The components

`defineComponents()` contributes thirteen entries under **プラグイン** in the
palette: initialise, show, fade in/out, change animation, stop/pause/resume,
wait, place, move, remove, remove all.

The host serialises a component as `$.tag(key, pm)` → `[<key> attr="value" …]`,
so **the map key is the KAG tag name and the param keys are its attributes** —
these mirror the master tags in `ssplayer-tyrano`'s `registerTags.ts` exactly.
Nothing else ties the two packages together, so `src/components.test.ts` parses
that file and asserts every tag and attribute a component emits is one the
runtime actually reads, and that no `vital` attribute is missing.

### Pickers, not text fields

`ss_new` chooses its pack from a dropdown, and then its animation from a second
dropdown listing what is actually inside that pack — read out of the `.ssab`
with `SSRuntimeManager.extractAnimationNames`, which is a pure FlatBuffers walk
and needs no runtime wasm. Changing the pack refills the animation list in place
(the host hands `onChange` only the new value, so the control is found by class,
the way the builder's own `storage`/`target` pair does it).

`[ss_play]` names a player rather than a pack, so which pack it will be driving
is only knowable at run time; its animation list is the union across the project.

Two rules keep the pickers from becoming a cage:

- **The pack scan covers all of `data/`,** not just the importer's output. A
  `.ssab` is an ordinary asset and an author may keep one anywhere — converted
  by hand, copied from another project, filed next to its scene's images.
  Imported packs simply sort first.
- **A value the scan cannot see is still offered and stays selected.** A pack on
  a CDN, or an animation name absent from the current pack, is added to the list
  (flagged, for the animation) instead of being dropped. Without that, opening
  such a component would show an empty dropdown and the next edit would quietly
  discard a deliberate value.

A path the editor cannot enumerate at all — one built from a variable at run
time — still has to be written with the builder's own TyranoScript-code
component. That is the one case the GUI cannot express.

The lists are callbacks rather than captured arrays because the builder asks for
the component definitions during boot, before the first import pass has
finished; `select_list` runs later, when the inspector renders. Animation lists
are cached per pack and invalidated by its mtime.

Labels come from `lang/ja.json`. The builder merges a plugin's `<lang>.json`
into its string table before importing it, and `$.s()` returns the key when a
translation is missing — so the English source strings are the fallback.

## Next steps

- Offer the player name as a `Select` of the names already used by `[ss_new]`
  components in the scenario, instead of a free-text field.
- A sample builder project, and a submission to plugin.tyrano.jp.
- `.tbp` packaging — the builder installs a plugin by unzipping it with
  `adm-zip` into `data/others/plugin/<id>/`, so packaging is a zip with the
  extension renamed.
- Move conversion into a Worker.

## Licence

BSD-3-Clause. See [LICENSE.md](./LICENSE.md).
