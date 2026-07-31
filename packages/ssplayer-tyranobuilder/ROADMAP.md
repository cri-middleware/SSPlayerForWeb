# @spritestudio/ssplayer-tyranobuilder Roadmap

Planning and host research for the TyranoBuilder plugin. Everything an author
needs is in [README.md](./README.md); this file is for whoever works on it.

The runtime half lives in
[`@spritestudio/ssplayer-tyranoscript`](../ssplayer-tyranoscript/ROADMAP.md) —
they ship in one plugin folder, so a change to the tags usually touches both.

## What is done

- **Auto-import.** `SpriteStudio_Source/**/*.sspj` → `data/others/ssdata/`, once
  per project open. Skips a project whose sources are older than its last
  successful import — newest mtime across the project folder against a value
  recorded in `.ss_import_state.json`, which is
  [SSPlayerForRenPy](../../../SSPlayerForRenPy)'s `ss_renpy/import_marker.py`
  rule. The folder and not the `.sspj`, because SpriteStudio writes only the
  files a save changed: an edited animation moves its `.ssae` and leaves the
  manifest alone.
- **Reconvert.** A momentary tick box on `[ss_new]`'s inspector, rebuilding the
  one pack that component's `storage` names — per-asset, like
  SSPlayerForGodot's inspector button, and forced, because the author pressing
  it has already decided the pack is wrong. This is the only way to refresh a
  pack without reopening the project; an earlier revision watched the window's
  focus events instead, and that was dropped to keep the family of players
  behaving the same way.
- **Converter-version invalidation.** `PackState.converter` had been recorded
  since the first release and never read, so a plugin update shipping a new
  converter never reached packs whose sources had not moved. A project open now
  rebuilds those.
- **Import now.** A button in the plugin manager panel, running the same
  freshness-checked pass a project open runs. This is the way in for a `.sspj`
  added while the builder is open: Reconvert is hosted on a component, and a
  component cannot name a pack that does not exist yet. `window.js` fills
  `.plugin_text` with `.html()` and not `.text()`, which is what makes a control
  there possible at all — settled by undoing the file's string-array
  obfuscation rather than by guessing. The handler is delegated from `document`,
  because the host rewrites that element on every change of the plugin list.
- **Conversion in a Worker.** The wasm call is synchronous and was long enough
  to see: a folder of 20 sample projects froze the editor for 1.2 s, 0.64 s of
  it in one project. Measured again through the same harness, the longest pause
  is now under 50 ms. The Worker is started from a Blob URL — a `file://`
  document cannot load a worker script from another `file://` URL — and its
  bundle is inlined into the plugin as a string, so nothing new lands in
  `data/`. Failing to start one falls back to converting in-thread, which is
  the old behaviour rather than a broken one, and the `converter:` line in the
  log says which happened and why.
- **Components.** Seventeen of the runtime's twenty-three `[ss_*]` tags, with
  packs, animations and player names as dropdowns rather than text fields.
- **`.tbp` packaging**, installed from the editor's own plugin dialog.
- **Export hygiene.** Author-time files live outside `data/`, which is what an
  export copies.

Verified on TyranoBuilder Ver 3.00 (Electron 24.8.8, macOS): install from `.tbp`,
conversion, the palette, preview, and save/load.

## Next

- **Components for the last six tags.** `[ss_chara]` and the four `[ss_part_*]`
  need part and cell names to be worth a picker; `SSRuntimeManager`'s
  `extractCellMapNames` / `extractCellNames` can supply them the same way
  animation names are read today. (`[ss_restore]` deliberately has none — it is
  not a timeline step, and restore is automatic.) Until then those tags are
  written with the builder's own TyranoScript-code component.
- **File I/O still runs on the UI thread.** The conversion moved to a Worker;
  the reads and writes around it cannot, because a plugin reaches the
  filesystem only through `window.studio_api`, which the preload publishes into
  the renderer. That is what the ~50 ms residual pauses are. Overlapping the
  next project's reads with the current one's conversion would hide most of
  what is left, at the cost of a pipeline in `importPass`; not obviously worth
  it while the number is this size.
- **`type: 'PreviewButton'` instead of a momentary `Check`.** The host has a
  real button param — `js/app/component/default.js:1149` uses one — which would
  read better than a tick box that unticks itself. Untried because the built-in
  uses go through `bound_type: 'camera'`, so whether it will call an arbitrary
  `onChange` is unknown and `js/app/param/param.js` is obfuscated. It is a
  one-line swap to find out on a running builder.
- **`listPacks()` walks the whole of `data/` on every dropdown render**, over the
  same bridge, while `listAnimations()` right next to it is already cached by
  mtime and size. Give the pack scan the same treatment.
- **Windows.** Untested, and `pack-tbp.mjs` shells out to `zip`, so a release
  cannot currently be cut from a Windows machine.
- **A sample builder project**, and a submission to plugin.tyrano.jp.
- **More languages.** The component labels are already localised: the source
  strings are English and `lang/ja.json` translates them, picked up because the
  builder loads `<plugin>/<global_lang>.json` before importing a plugin. English
  needs no file at all — `$.s()` returns the key when there is no translation,
  and the key *is* the English string. Another language is one more file in
  `lang/`, which `pack-tbp.mjs` ships automatically.
- Optimize `ssconverter_bg.wasm` (`wasm-opt -Oz`) — 1.4 MB, shipped in the `.tbp`.

## Design decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Separate package | Yes, rather than metadata inside `ssplayer-tyranoscript` | The builder embeds TyranoScript, so one `main.js` serves both — but its *editor* is a separate application with its own plugin format, install flow and API. That is a package's worth of work, and it has no business shipping to hand-written-scenario users. |
| Component ↔ tag | The component key **is** the tag name; no macro | `$.tag(key, pm)` writes the tag verbatim, so `main.js`'s `master_tag` is the implementation. The fallback plan — a bridging `[macro]` per tag — was never needed. |
| Choosing a pack | `Select` fed by a scan of the project's `.ssab` files | The builder has no generic file-select param, and a path text field would be worse than a list: the scan already knows every pack, and the animation list is read out of the pack itself. |
| Author-time files | Outside `data/` | An export copies `data/` wholesale, so anything left there ships inside every built game. |
| Distribution | `.tbp` via GitHub Releases; `private`, never on npm | Authors install through the editor's dialog; they do not `npm install`. |

## How the host works

Read off the shipped builder (Ver 3.00), under
`TyranoBuilder.app/Contents/Resources/app/`. None of it is documented by the
vendor, so it is written down here rather than rediscovered.

### Plugins

`js/app/core/plugin.js` scans `<project>/data/others/plugin/*/`, and for each
folder holding `<id>/<id>.builder.js` does a dynamic `import()` and calls
`new module.plugin_setting(TB)`. So a plugin is a real ES module, and its
constructor is the "project opened" hook.

`TB` is `{ $, getProjectPath(), io, component, _pm_type }`. The plugin manager
panel reads `name`, `plugin_text` and `plugin_img` off the instance —
`plugin_img` is compared against the literal `'no_image'`, so leaving it unset
points an `<img>` at `<plugin>/undefined`. `triggerInstall()` is called once,
after an install.

`getPluginTag()` is written into `data/scenario/system/plugin_third.ks`, which
the generated `first.ks` calls. That is why an author never writes
`[plugin name="ssplayer"]` in the builder.

**`loadPlugins()` runs more than once per session** — project open, `.tbp`
install, and any plugin added or removed — rebuilding every plugin each time. A
constructor that starts a timer must stop the previous instance's.

**Non-Steam builds refuse the third plugin**, counting only folders that contain
a `<id>.builder.js`; the load stops there, taking every later plugin with it.

### Filesystem

The renderer runs with `contextIsolation: true`, so a plugin never gets
`require()`. `preload.js` publishes `fs-extra`, `node:path`, `mkdirp` and
`adm-zip` on `window.studio_api` — the whole basis for an in-editor importer.

Binary payloads crossing that bridge are the one undocumented step, so
`HostFs.probeBinaryBridge()` writes a known byte pattern, reads it back and
compares before anything is converted, falling back to base64 (a plain string
always survives a structured clone). Ver 3.00 on macOS round-trips `Uint8Array`
cleanly; the fallback stays for other builds and platforms.

### Components

A component is serialised as `$.tag(key, pm)` → `[<key> attr="value" …]`, so the
map key **is** the KAG tag name and the param keys **are** its attributes. No
macro is needed for a tag implemented in JS.

Every declared param is emitted, blank ones included, so an empty field becomes
`attr=""`; the runtime treats that as "not given" for every optional attribute.
There is no escaping, so a value containing `"` would break the tag.

`select_list` is handed the param *view*, which reaches the component through
`.get('component')`. `onChange` differs by type: `Select` stores the value and
then calls `onChange(value)`, while **`Check` calls
`onChange(undefined, component, $checkbox)` instead of storing anything** — the
value is read into a variable declared in the branch the host did not take. A
checkbox handler must read the control and store the value itself.

The card template renders `class="tb-i-{{:icon}}"`, so `default_view.icon` takes
a bare name.

### Export

An export is three unfiltered copies — `index.html`, `data/`, `tyrano/` — with no
exclusion mechanism. Everything under `data/` ships inside the built game and
nothing else does, which is why author-time files live at the project root.

`<id>.builder.js` and `<lang>.json` cannot move: the editor looks for them at
fixed paths under `data/`. Their size is the only thing negotiable, hence the
minified bundle.

### `.tbp`

A plain zip. The dialog extracts it into `data/others/plugin/` and then reads
`<id>/<id>.builder.js`, where **the id is the filename without its extension**.
So the archive holds one top-level folder and the file must keep the matching
name — `ssplayer-1.2.0.tbp` would look for
`ssplayer-1.2.0/ssplayer-1.2.0.builder.js` and find nothing. The version belongs
in the release, not the filename, and `pack-tbp.mjs` verifies the layout from the
finished archive rather than trusting the staging step.

The builder also rewrites `module.exports = class plugin_setting` to
`export class plugin_setting` after extracting, for plugins written before ESM.

### No module resolution

The editor hands `<id>.builder.js` straight to `import()`. One surviving bare
specifier rejects the import and the plugin never loads — no error in the UI,
nothing in the log, just missing components. Every dependency is inlined, and
`scripts/install.mjs` and `pack-tbp.mjs` both refuse to ship a bundle that still
has one, by importing the built file the way the host does.

### No DevTools

The main window is created with `removeMenu()`. Hence
`<project>/ss_import_log.txt`, which the plugin appends to across sessions.
