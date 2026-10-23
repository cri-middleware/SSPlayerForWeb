---
description: "For whoever works on SpriteStudio Player for Web or changes it: how the packages are put together, using a changed build, checking against RPG Maker MZ and the Tyrano hosts, and why the plugins are built the way they are."
---

# Developer guide

This page is for whoever works on SpriteStudio Player for Web, or changes it for a project of
their own. It asks more of you than the rest of the site: it names files, and it assumes a
checkout that builds. [CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/CONTRIBUTING.md)
has the setup, the build, the tests and the docs site; each package's README ends with a
section for contributors that holds that package's internals. This page is the map across them.

What every SpriteStudio Player shares — how playback, motion blending, sound keys and part
tracking behave — is written once, in the SDK's
[porting guide](https://github.com/cri-middleware/SpriteStudio-SDK/tree/develop/libs/ssruntime/docs).

## 1. How it is put together {#how-it-is-put-together}

The workspace has a playback side, which runs in a page or a game, and a conversion side, which
turns `.sspj` into `.ssab`. The README's
[diagram](https://github.com/cri-middleware/SSPlayerForWeb#monorepo-structure) shows which
package builds on which.

| Package | What it is | Where to start reading |
|---|---|---|
| `ssplayer-core` | The runtime WASM and what turns its frames into draw data. No DOM, no engine. | `SSRuntimeManager.ts` (WASM init and the runtime's accessors), `InternalPlayerBase.ts` (one playing animation), `GeometryBuilder.ts`, `MaskPlanner.ts`, `EffectBatchPlanner.ts` (draw data). `src/ss/` is generated. |
| `ssplayer-webgl` | A renderer of its own on raw WebGL, and `<ss-player>` | `SSWebGLRenderer.ts` (the draw), `SSPlayer.ts` (a player and its events), `SSSurface.ts` (a canvas and its ticker), `SSOverlay.ts` (one canvas for many players placed by DOM elements), `element.ts` |
| `ssplayer-pixi` | A PixiJS v8 display object | `SSPlayer.ts`, `SSShaderLib.ts`, `SSBlendModes.ts` |
| `ssplayer-rmmz` | The RPG Maker MZ plugin | [below](#rpg-maker-mz) |
| `ssplayer-tyranoscript` | The `[ss_*]` tags, which are also the runtime half for TyranoBuilder and TyranoStudio | [below](#tyranoscript) |
| `ssplayer-tyranobuilder` | TyranoBuilder's editor half: the components and the auto importer | [below](#tyranobuilder) |
| `ssconverter-core` | The converter WASM: project bytes in, `.ssab` bytes out | `src/index.ts` |
| `ssconverter-importer` | The auto importer the editor plugins share: TyranoBuilder runs it when a project opens, MZ when a test play starts | `autoImporter.ts` (the pass and its state file), `converter.ts` (the Worker), `hostFs.ts` (the host's filesystem), `importLog.ts`. Its [README](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssconverter-importer) says what a host supplies. |
| `ssconverter-web` | The converter page and its Node CLI | `src/main.ts`, `scripts/cli.js` |

### RPG Maker MZ {#rpg-maker-mz}

`ssplayer-rmmz` builds one IIFE, `dist/browser/ssplayer-rpgmakermz.js`, with the plugin help
MZ shows prepended from `src/plugin-annotation.js`. Its
[README](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssplayer-rmmz#how-it-works)
has the renderer and the boot gate in detail.

| File | What it does |
|---|---|
| `src/plugin.ts` | The entry: registers the renderer, starts the WASM, installs the picture bridge, registers the plugin commands |
| `src/SSPlayer.ts` | A `PIXI.Container` holding one player. It has no timer of its own. |
| `src/SSPlayerRenderer.ts` | The `PIXI.ObjectRenderer` that draws through `SSWebGLRenderer` on MZ's own `gl` |
| `src/rmmz/boot.ts` | Holds MZ's boot until the WASM is ready |
| `src/rmmz/gamePictureBridge.ts`, `Sprite_SpriteStudio.ts` | An animation belongs to a `Game_Picture`, so it is saved with the game, and is drawn by a child of its `Sprite_Picture` |
| `src/rmmz/RMMZResourceManager.ts`, `RMMZAudioManager.ts` | Textures through `ImageManager`, sounds through `AudioManager` |
| `src/rmmz/autoImport.ts` | Conversion on test play, over `ssconverter-importer` |
| `src/rmmz/liveRegistry.ts`, `interpreterWait.ts`, `messageTalk.ts`, `playAnimation.ts` | The players on screen by picture, waiting for an animation, talking while a message is open, switching animation |
| `src/plugin-annotation.js` | The plugin help and parameters, in English and in Japanese (`/*:ja`) |

### TyranoScript {#tyranoscript}

`ssplayer-tyranoscript` builds `dist/browser/main.js`, an IIFE that registers the tags when it
loads; the plugin's `init.ks` loads it. Its
[README](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssplayer-tyranoscript#internals-coordinates-lifecycle)
has the coordinates, the save data and the audio routing.

| File | What it does |
|---|---|
| `src/plugin.ts` | The entry |
| `src/registerTags.ts` | Every `[ss_*]` tag |
| `src/LayerCanvas.ts` | A `<div>` per character on a Tyrano layer, and one canvas per layer (`SSOverlay`) |
| `src/PlayerRegistry.ts` | The named players and what is queued on them |
| `src/SaveLoadBridge.ts` | What a save holds, and the rebuild on load |
| `src/CharaTalkBridge.ts` | `[ss_chara]`: talking while the text is drawn |
| `src/TyranoAudioManager.ts` | Sound keys played through howler |
| `src/storagePath.ts` | `storage=` resolved the way the engine resolves its own |
| `plugin/` | `init.ks` and `readme.txt`, the template the plugin ZIP is made from |

### TyranoBuilder {#tyranobuilder}

One plugin folder holds two halves: `ssplayer.builder.js`, built from this package for the
editor, and the TyranoScript `main.js` for the game. `scripts/pluginFiles.mjs` lists what goes
in, and `scripts/pack-tbp.mjs` archives it as `ssplayer.tbp`.

| File | What it does |
|---|---|
| `src/plugin.builder.ts` | The entry the builder constructs when a project opens: runs the importer, registers the components, reports the result |
| `src/builderImporter.ts` | The shared importer as the builder uses it, plus **Reconvert now** for one pack |
| `src/components.ts` | The palette components, one per `[ss_*]` tag |
| `src/managerPanel.ts` | The panel in the plugin manager (Import now) |
| `src/buttonParam.ts` | A real button in the component inspector |
| `src/packContents.ts` | What the inspector's pickers list, read from the `.ssab` |
| `src/studioFs.ts`, `src/builderTypes.d.ts` | The builder's host surface (`window.studio_api`, `TB`), as read off Ver 3.00 |
| `lang/ja.json` | The Japanese strings the editor shows |

## 2. Using a changed Player {#using-a-changed-player}

The rest of the site installs what a release publishes. To try a change in an app or a game of
your own, build the same artifacts from your checkout:

```sh
scripts/build-release.sh        # Windows: scripts\build-release.ps1
```

It writes `release-dist/npm/*.tgz` (the npm packages) and `release-dist/plugins/` (the MZ ZIP,
the TyranoScript ZIP and `ssplayer.tbp`), carrying the versions your tree has. It takes the SDK
WASM released for `scripts/SDK_VERSION.txt`; when your change is in the `SpriteStudio-SDK`
submodule, add `sdk=build`, which compiles it (Rust and wasm-pack). `--help` lists the stages
`skip=` can leave out.

- **npm packages.** Install every tarball your app needs in one command, the packages it
  imports together with the ones they depend on:

  ```sh
  npm install <checkout>/release-dist/npm/spritestudio-ssplayer-core-<version>.tgz <checkout>/release-dist/npm/spritestudio-ssplayer-webgl-<version>.tgz
  ```

  A tarball names its dependencies by version, so `ssplayer-webgl` installed alone takes the
  released `ssplayer-core` from npm instead of yours.
- **RPG Maker MZ.** Extract the MZ ZIP into the game's `js/plugins/`, as an author does.
- **TyranoScript.** Extract `ssplayer/` from the TyranoScript ZIP into the game's
  `data/others/plugin/`.
- **TyranoBuilder.** Install `ssplayer.tbp` through the builder, or skip the dialog:
  `node packages/ssplayer-tyranobuilder/scripts/install.mjs <project>` copies the same files
  into a project. The package
  [README](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssplayer-tyranobuilder#for-contributors--building-from-source)
  has its options.

While you iterate, one package's `build` is enough, followed by the bundled example's
`sync:plugin`; each plugin README's section for contributors has the commands.

## 3. Checking against the real host {#checking-against-the-real-host}

The packages' tests run against stand-ins for MZ and TyranoScript. What only the real host
shows — its timing, its save system, its editor — is checked by running the host. Everything
below runs without touching the host's GUI. Paths are the macOS ones.

### Where the hosts' labels come from {#where-the-hosts-labels-come-from}

The guides name menus, dialogs and options as the host shows them. Read them from the host:

- **RPG Maker MZ.** The English labels are ASCII inside the editor binary
  (`RPGMZ.app/Contents/MacOS/RPGMZ`), so `grep -a` finds them. The Japanese labels are in the same
  binary's Qt translations as **UTF-16BE**: a UTF-8 search finds nothing. Search for the
  UTF-16BE bytes instead; the context name next to a string (`Layout_DeploymentOptions` for the
  deployment dialog) says which screen it belongs to. The bundled help,
  `Contents/Resources/help-ja/`, confirms them.
- **TyranoBuilder** (under `TyranoBuilder.app/Contents/Resources/app/`): `js/main/MenuBar.js`
  for the menus, `template/window/*.tmpl.html` for each window's text, and `lang/en.json` for the
  English UI, keyed by the Japanese originals.
- **The plugins' own labels**: MZ's are the `@text` lines in `src/plugin-annotation.js`;
  TyranoBuilder's are `lang/ja.json`.

### RPG Maker MZ {#checking-rpg-maker-mz}

The NW.js that ships inside RPG Maker MZ runs a project folder directly —
`RPGMZ.app/Contents/Resources/nwjs-mac/nwjs.app/Contents/MacOS/nwjs <project> test` — the same
runtime the editor's test play uses, without WebAssembly SIMD. **Pass `test`:** MZ reads test
play from its first argument (`Utils.isOptionValid`), so a launch without it is the deployed
game, and the conversion on test play does not run.

To check something without a person at the keyboard, copy a project such as
`examples/rmmz-example/SampleProject` outside the repository, add a plugin of your own to its
`js/plugins/` and `js/plugins.js`, and have that plugin drive the game, write its result with
`require('fs')` and call `nw.App.quit()`. Things that cost time to find out:

- MZ stops updating scenes while its window lacks focus (`SceneManager.isGameActive()`). An
  animation that freezes in a background window is MZ, not the plugin.
- Count frames with `Graphics.frameCount`, not `requestAnimationFrame`: animation frames keep
  coming while the game is paused, so a check counted in them drifts and turns flaky.
- `DataManager.setupNewGame(); SceneManager.goto(Scene_Map)` skips the title screen.
- MZ 1.x has no `SceneManager.renderScene`. Hook `Graphics._app.renderer.on('postrender', …)`
  and read pixels there with `gl.readPixels` (rows count from the bottom).
- Record every frame and count the distinct values. Ringo's `attack1` is 20 frames long, so a
  check that looks every 60 frames always sees the same one.
- A fetch of a missing file rejects (`TypeError: Failed to fetch`) instead of answering 404.
- A load failure is MZ's `["LoadError", url, retry]`, thrown during an update, which stops the
  scene loop and with it `Graphics.frameCount`. Time a check across the error screen with
  `setTimeout`; Retry is `#retryButton`.
- MZ plays a sound effect only from `audio/se/<name>.ogg`. Wrapping
  `WebAudio.prototype.play` and `stop` records what played (`buffer.name`).

Without MZ, `examples/rmmz-harness` (`pnpm --filter rmmz-harness dev`) runs the real `SSPlayer`
and `SSPlayerRenderer` on PixiJS v5, with only MZ's `ImageManager` and `Bitmap` stubbed. The
published sample (`examples/rmmz/` on this site) stays on its black splash screen in a headless
browser until a click gives it focus.

### TyranoScript {#checking-tyranoscript}

`examples/tyranoscript-example` is a TyranoScript project with the engine left out; its
README fetches it and serves the project. To drive it from a script, start Chrome headless —
`--headless=new --remote-debugging-port=<port> --use-angle=swiftshader --enable-unsafe-swiftshader --user-data-dir=<scratch>`
— and talk to the page over the DevTools protocol; a headless page counts as visible, so
`requestAnimationFrame` runs.

- The tags are ready when `TYRANO.kag.ftag.master_tag.ss_play` exists.
- Rather than clicking through `first.ks`, write a throwaway `data/scenario/zz_*.ks` and jump to
  it with `TYRANO.kag.ftag.startTag('jump', { storage, target })`. Delete it afterwards.
- `kag.error` is an `alert`: catch `Page.javascriptDialogOpening` and close it with
  `Page.handleJavaScriptDialog`. Skip mode is `TYRANO.kag.setSkip(true)`.
- A failed `[ss_new]` does not stop the scenario; the next tag reports
  `player "…" not found`. The real error is the `[ss] ss_new failed:` line above it.
- The example's `.ssab` come from `pnpm deploy-examples` and its plugin from `sync:plugin`.
  After an SDK bump, refresh both: a runtime older than its `.ssab` fails to load it, and
  `ssruntime_bg.wasm` can change without changing size, so compare hashes with
  `packages/ssplayer-core/dist/`.

A test project for events: convert the SDK's `tests/overall/overall.sspj` with
`node packages/ssconverter-web/scripts/cli.js -o <dir> <overall.sspj>`. `Signal.ssab` fires
signals on frame 10 of `anime_1`, and `Sound.ssab` plays sound keys; both work in MZ too.

### TyranoBuilder {#checking-tyranobuilder}

The editor window has no DevTools, so `<project>/ss_import_log.txt` is where the importer
reports. For an error in the game itself, use **Project → Debug** (プロジェクト → デバッグ実行):
only that preview opens DevTools. The ordinary preview loads the project over `file://`, and
`fetch` works there, so a pack that plays in TyranoScript and not in the builder is not a
`file://` problem; get the console first.

**Driving the real editor.** `TyranoBuilder.app/Contents/MacOS/TyranoBuilder --remote-debugging-port=<port>`
starts the editor with a DevTools endpoint (`http://127.0.0.1:<port>/json`).

- Add a component with `app.component.insertComponent(tag, index, <the previous component's c.j_component>)`
  and set its values with `app.component.changeParam(c, key, value)`. A fifth argument `{ pm }`
  wipes every default.
- `app.component.createTyranoScriptCode(c)` returns the tag a component writes.
- The preview (▶ on the scenario tab) is a separate target in `/json`. It writes `scene1.ks`,
  `first.ks` and `_preview.ks`, so back up `data/scenario` first.
- `kag.error` in the preview is a native dialog the protocol cannot close. Close that window
  with `/json/close/<id>`, then restart the editor: previews do not open again in that session.
- Quit with `kill -9`. A plain kill stops at the unsaved-changes dialog and keeps the port.

**Running the plugin in the builder's Electron, headless.** `TyranoBuilder.app` is an Electron
runtime, so a copy of it whose `Contents/Resources/app/` holds a small test app of your own runs
the plugin under the builder's Electron and `webPreferences`, with no window:

1. Copy the app (`cp -Rc` clones it on APFS).
2. Replace the copy's `Contents/Resources/app/` with your `package.json`, `main.js`,
   `preload.js` and page. Have the preload publish `studio_api` as the builder's does, with
   `fs-extra` required from the builder's own `node_modules`.
3. Sign the copy ad hoc: `codesign --force --deep --sign - <copy>.app`. Unsigned, macOS kills it
   at launch without a word.
4. Run `Contents/MacOS/TyranoBuilder`. The page loads the plugin the way the builder does —
   `await import('file://…/ssplayer.builder.js')`, then `new module.plugin_setting(TB)` with a
   `TB` of `{ $, getProjectPath }` — writes its result, and quits.

Point it at a copy of a project's `data/`, never at a real project: the plugin really converts,
and appends to the log. Measure stalls of the editor thread from the gaps between `setInterval`
ticks, since `requestAnimationFrame` is throttled in a hidden window. Deleting `Worker` before
the import compares the in-thread fallback under the same conditions. Launched from Node, give
the process `stdio: 'ignore'`.

### TyranoStudio {#checking-tyranostudio}

TyranoStudio runs games with the TyranoScript it bundles, so the TyranoScript plugin is what
runs there. Its license forbids modifying the app, so check it with launch flags only:
`Contents/MacOS/TyranoStudio --remote-debugging-port=<port>`. The preview is a separate
Electron window that opens the project's `index.html` over `file://`, with
`TYRANO.kag.is_studio === true`; replace `window.alert` from an init script before reloading
it, because `kag.error` is a native dialog there too.

TyranoBuilder and TyranoStudio share one Electron user-data folder
(`~/Library/Application Support/studio`), and with it `localStorage`: saves made in one app's
preview show up in the other's. Remove them with `localStorage.removeItem` from a running app.

### In a browser {#checking-in-a-browser}

`SSSurface` pauses while `document.hidden` (`pauseWhenHidden`, on by default), so a page in a
background tab shows `0.0 / 0` and does not move, in the WebGL and the PixiJS examples alike.
`<ss-player>` draws one frame before its ticker runs, so it shows a picture even there. Check in
a visible tab, or in headless Chrome as above.

## 4. Why it is built the way it is {#why-it-is-built-the-way-it-is}

Each reason here spans files; the code it points at carries the detail.

**Each host's plugin draws on the host's own GL context.** `ssplayer-rmmz` registers a
`PIXI.ObjectRenderer` on MZ's renderer and brackets the raw draw with the state save and restore
MZ's own Effekseer sprite uses (`SSPlayerRenderer.ts`), so animations sort with MZ's sprites and
no canvas sits on top. `ssplayer-tyranoscript` keeps one canvas per Tyrano layer and positions
each character from a `<div>` (`LayerCanvas.ts`, `ssplayer-webgl`'s `SSOverlay.ts`): a browser
allows only about 8 to 16 WebGL contexts, and the `<div>` is what `[anim]` and `[kanim]` find
by name.

**MZ gets the runtime without SIMD.** MZ's NW.js is a Chromium without WebAssembly SIMD, and the
default runtime needs it (`initializeWasm` in `ssplayer-core`'s `SSRuntimeManager.ts` stops
there unless told `requireSimd: false`). So the MZ ZIP and the MZ example take `ssruntime_bg.wasm` from
`packages/ssplayer-core/wasm-nosimd/` (`ssplayer-rmmz/scripts/pack-plugin.mjs`,
`examples/rmmz-example/scripts/sync-plugin.mjs`), and the Tyrano plugins take the SIMD one from
`packages/ssplayer-core/dist/`.

**Conversion happens at the host's start, and nothing watches.** All three hosts that convert
`.sspj` share one moment: the start. Ren'Py converts when the game launches in developer mode;
TyranoBuilder when a project opens (`plugin.builder.ts`); MZ when a test play starts
(`rmmz/autoImport.ts`), and F5 restarts one, so saving in SpriteStudio and pressing F5 is MZ's
whole loop. After that, Ren'Py picks up a save once its autoreload is on (Shift+R), because a
reload runs its import again. TyranoBuilder has no reload of its own for a plugin to ride, so a
watch would be the plugin's own, on the editor's thread: a polling pass costs one `stat` per
source file, each a synchronous hop across Electron's `contextBridge` on the thread that draws
the editor — while the author is in SpriteStudio anyway. So the builder converts on request: **Import now**
(**Project → Plugins** → **SpriteStudio**) runs the same pass as a project open
(`managerPanel.ts`), and **Reconvert now** on a **SpriteStudio: show** component rebuilds its
one pack (`builderImporter.ts`). The state file and the freshness rule are
`ssconverter-importer`'s (`autoImporter.ts`, and its README).

**The builder reports success as a toast and problems as a dialog** (`notifyRun` and the
first-run check in `plugin.builder.ts`). A reconversion usually finishes while the author is in
SpriteStudio, and a modal would take focus from the app they are using. A failed conversion is a
dialog because the reason is in it and the editor has no console to fall back on; a name clash
is one because something has to be renamed; a project that has never imported anything and has
no `.sspj` gets one that says where projects go.

**The converter runs in a Worker; the files it reads and writes do not.** The converter call is
synchronous and long enough to freeze the editor (`ssconverter-importer`'s `converter.ts` has
the figure), so it runs in a Worker started from a Blob URL, and in the calling thread when the
host cannot start one. A plugin reaches the filesystem only through `window.studio_api`, which
only the editor's thread holds (`hostFs.ts`), so the reads and writes around each project stay
there. Moving them is on the package's
[ROADMAP](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranobuilder/ROADMAP.md).

**The importers' folders are fixed.** MZ reads `SpriteStudio_Source/` and writes `spritestudio/`
(`rmmz/autoImport.ts`); TyranoBuilder reads `SpriteStudio_Source/` and writes
`data/others/ssdata/` (`builderImporter.ts`). The shared importer takes both names as options
(`sourceDirName`, `outDirName` in `autoImporter.ts`); Ren'Py's importer exposes them to the game
(`ss_source_dir`, `ss_output_dir`), and these plugins do not.

**What the builder needs at edit time stays out of the exported game.** An export is three
unfiltered copies — `index.html`, `data/` and `tyrano/` — and a `.tbp` can deliver files only
into the plugin folder, under `data/`. So the plugin moves the converter WASM to `.ss_tools/` in
the project when it first sees it there (`relocateConverterWasm` in `plugin.builder.ts`), and
the import state and log sit at the project root.

**One plugin folder, two halves.** The `.tbp` carries the editor half and the TyranoScript
runtime (`init.ks`, `main.js`, `ssruntime_bg.wasm`) in one `ssplayer/` folder
(`scripts/pluginFiles.mjs`). Without the runtime, a scenario built from the components parses in
the editor and fails in the game on an unknown `[ss_init]`; as one plugin it also takes one place
in the builder's plugin limit. That is why an author installs the `.tbp` *or* the TyranoScript
ZIP, never both: they unpack to the same `data/others/plugin/ssplayer/`, and stacking them leaves
the two halves on different versions.

**Where each host's importer reports.** TyranoBuilder's main window has no DevTools, so the
importer writes `<project>/ss_import_log.txt`, flushing as it goes and appending across
sessions (`importLog.ts`). MZ's test play has a console (F8), and its error screen already names
the project and the reason, so MZ writes no log file (`rmmz/autoImport.ts`).
