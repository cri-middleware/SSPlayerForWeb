---
description: "Building SpriteStudio Player for Web from a checkout, using a changed build in a game or an app of your own, and checking it in RPG Maker MZ and the Tyrano hosts."
---

# Build Guide

For whoever works on SpriteStudio Player for Web, or changes it for a project of their own. It
assumes a checkout and asks more of you than the rest of the site. How the packages fit together,
and why the plugins are built the way they are, is on
[How the Player Is Put Together](./architecture.md).

What every SpriteStudio Player shares — how playback, motion blending, sound keys and part
tracking behave — is written once, in the SDK's
[porting guide](https://github.com/cri-middleware/SpriteStudio-SDK/tree/develop/libs/ssruntime/docs).

## Building from a checkout {#building-from-a-checkout}

[CONTRIBUTING](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/CONTRIBUTING.md) has the
setup, the build, the tests and the docs site; `pnpm run example` takes a fresh checkout to a
running renderer example, and `pnpm --filter @spritestudio/ssconverter-web dev` serves the browser
converter. Each plugin's README ends with a section for contributors that builds, packs and runs
that plugin.

## Using a changed Player {#using-a-changed-player}

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

## Checking against the real host {#checking-against-the-real-host}

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
- **The plugins' own labels**: MZ's are the `@text` lines of the plugin's help annotation, in
  English and under `/*:ja`; TyranoBuilder's are the Japanese language file the `.tbp` carries.

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

Without MZ, `examples/rmmz-harness` (`pnpm --filter rmmz-harness dev`) runs the plugin's player
and renderer on real PixiJS v5, with only MZ's `ImageManager` and `Bitmap` stubbed. The
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
