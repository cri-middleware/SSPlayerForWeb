# @spritestudio/ssplayer-tyranoscript Roadmap

A thin TyranoScript / TyranoBuilder adapter. Rendering is delegated entirely to
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md) (`SSCanvasPlayer`);
this package is pure glue — it registers `[ss_*]` KAG custom tags that mount an SS
canvas onto a Tyrano layer and drive playback. For the project-wide roadmap see
[`../../ROADMAP.md`](../../ROADMAP.md).

## Design decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Renderer | Use `ssplayer-webgl`'s `SSCanvasPlayer` | All GPU/WebGL difficulty is isolated in the webgl package; tyrano stays glue. |
| Dependency | **`ssplayer-webgl` only** (not core) | webgl re-exports core; core is pulled in transitively. Core/`flatbuffers` are still inlined into the IIFE build. |
| PixiJS | Not used | TyranoScript does not bundle Pixi; we insert our own `<canvas>`. |
| WebGL version | Ride webgl's WebGL1 baseline + WebGL2 auto-upgrade | Broad device reach (old/mobile webviews, builder native export). |
| TyranoScript vs TyranoBuilder | **Same runtime** (the builder embeds TyranoScript) | A single self-registering `main.js` works in both; builder support = adding GUI metadata (`.tbp`), not a second package. |
| Distribution | `private` (no npm). Ship the plugin bundle / `.tbp` via **GitHub Releases** | TyranoScript / builder authors drop files in; they do not `npm install`. |
| Audio | Route SS `onAudio` through TyranoScript's bundled **howler** (`window.Howl`) | A `[playse]` KAG tag would advance the scenario (`nextOrder`); howler cannot. |

## Implemented (PT0–PT3, verified in real TyranoScript)

### PT0 — scaffold
- [x] `package.json` / `tsdown.config.ts` / ESM (`dist/index.js`) + self-registering IIFE (`dist/browser/main.js`)
- [x] `ssplayer-webgl`-only dependency; `private: true`

### PT1 — minimal display
- [x] `[ss_init]` / `[ss_new]` / `[ss_play]`
- [x] `LayerCanvas` (layer lookup via `kag.layer.getLayer(layer, page)`, same as the official Spine plugin)
- [x] `PlayerRegistry` (name → `SSCanvasPlayer`)
- [x] Coordinate mapping: Tyrano top-left logical px → `setTransform` (Y-down buffer px; HiDPI via `bufferScale`)

### PT2 — lifecycle
- [x] `[ss_stop]` / `[ss_pause]` / `[ss_resume]`, `[ss_free]` / `[ss_free_all]`, `[ss_pause_all]` / `[ss_resume_all]`
- [x] Save/load: `SaveLoadBridge` mirrors each player into `stat.f.__ssplayers`; `[ss_restore]` (placed in `make.ks`) rebuilds them on load
- [x] Pause gating: `pauseWhenHidden` (default on) auto-pauses off-screen / backgrounded; playback continues during ordinary text waits

### PT3 — finishing
- [x] `[ss_wait]` (defer until animation end / one loop)
- [x] `[ss_pos]` (instant) / `[ss_move]` (RAF easeOut tween, non-blocking) — internal transform, anchor-accurate absolute placement
- [x] Audio `TyranoAudioManager` (`IAudioManager` via `window.Howl`)
- [x] Movement/effects also work through Tyrano's own `[anim]` / `[kanim]` (the canvas is tagged with the player-name class)
- [x] Distribution: `plugin/` template + `pnpm run pack` → `ssplayer-tyranoscript-plugin-<ver>.zip`
- [x] `examples/tyranoscript-example` (real TyranoScript; engine fetched via `fetch:engine`, git-ignored)

### PT3.5 — parity with the official Spine / Live2D plugins

Gaps found by comparing tag-for-tag against the official [Spine](https://tyrano.jp/sample/spine)
and [Live2D](https://tyrano.jp/sample/live2d_5) plugins. Everything here is save/restore-aware.

- [x] **Load / display split** — `[ss_new visible="false"]` + `[ss_show]` / `[ss_hide]`
      (`[spine_new]`+`[spine_show]`+`[spine_hide]`, `[live2d_show]`/`[live2d_hide]`).
      Preloads a heavy `.ssab` off screen; hiding keeps it loaded and lets the
      renderer's own off-screen gating stop the GPU work, unlike `[ss_free]`.
- [x] **Blanket fades** — `[ss_fadein]` / `[ss_fadeout]` with `time=` / `wait=`
      (`[spine_fadein]` / `[live2d_fadeout]`). A `layerHidden` flag kept apart from each
      player's own `visible`, so a fade-in restores exactly what was on screen.
- [x] **Non-blocking animation chaining** — `[ss_play next= nextloop= atframe=]`
      (`[spine_anim next_motion / in_frame_next_motion]`). "Entrance → idle" without
      `[ss_wait]` stopping the scenario. `next=` with no `loop=` plays once.
- [x] **Stacking order** — `zindex=` on `[ss_new]` / `[ss_pos]` / `[ss_show]`
      (`[spine_init zindex=]`). One canvas per player means creation order was
      previously the only ordering within a layer.
- [x] **Speaker linkage** — `[ss_chara name= jname= talk= idle=]` (Live2D's `jname` +
      `lip="text"`). Wraps the engine's own `[text]` lip-sync bracket
      (`startLipSyncWithText` / `stopLipSyncWithText`, `addChars` / `finishAddingChars`
      on older builds); see `src/CharaTalkBridge.ts`. SS is frame-based, so this swaps a
      whole talk animation rather than driving a mouth parameter, and the swap is
      deliberately excluded from the save.
- [x] `wait=` on `[ss_move]` (opt-in; the default stays non-blocking).

Deliberately **not** ported: `[spine_mix_anim]` / `[spine_config mixval]` (cross-animation
blending — no SS7 runtime equivalent, see the FFI-gated item under "Open questions");
`skin=` and `[live2d_expression]` (already covered, and then some, by `[ss_part_*]`);
`lip_time` / `lip_sound_level` / `breath` (Live2D parameter-rig specifics);
`bgimage` (Tyrano's own background layer already does this).

---

## Remaining work

### PT4 / PT4.5 — TyranoBuilder support — **done, in a separate package**

Shipped as [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md).
TyranoBuilder turned out to be a different tool rather than a mode of TyranoScript —
it has its own plugin format, its own editor API and its own install flow — so it got
its own package. The two halves ship in one plugin folder: this package's `main.js`
registers the `[ss_*]` tags at run time, and that package contributes the editor side.

What the earlier plan got wrong, now that the shipped builder (Ver 3.00, Electron 24)
has been read:

- **Macro-vs-master_tag: Plan A was right.** No macro is needed. A component is
  serialised by `$.tag(key, pm)` → `[<key> attr="value" …]`, so the map key *is* the
  tag name and the param keys *are* its attributes; `main.js`'s `master_tag` is the
  implementation, exactly as hoped.
- **`plugin.ks` wiring is unnecessary.** The builder generates
  `data/scenario/system/plugin_third.ks` from each plugin's `getPluginTag()`, and its
  generated `first.ks` calls it. Nothing to place by hand.
- **Form B was not a mountain.** The builder's `preload.js` publishes `fs-extra` on
  `window.studio_api`, and plugins are loaded with a dynamic `import()` — so a plugin
  is an ES module with filesystem access, which is all an importer needs. It converts
  in-editor and keeps watching while the project is open, which Ren'Py cannot do.
- **A generic file-select param was not needed.** `Select` fed by a scan of the
  project's `.ssab` files is better than a path field, and the animation list is read
  out of the pack itself.

Verified on the real editor: `.tbp` install, conversion, the palette, and save/load.

Remaining there: GUI components cover 13 of the 23 tags (`[ss_part_*]`, `[ss_chara]`,
the blanket fades and the bulk pause/resume are still hand-written), the player name
is a free-text field, and conversion is synchronous. See that package's README.

### PT5 — examples / docs
- [x] `examples/tyranoscript-example` — hand-written TyranoScript
- [ ] A builder sample project
- [ ] Docs upkeep; consider submitting to the official plugin library (plugin.tyrano.jp)

---

## Open questions / known limitations

- [ ] Optimize `ssconverter.wasm` (`wasm-opt -Oz`); keep `ssab_schema_version` in sync
      with the runtime.

- [x] Release players whose canvas the engine removed. Not by hooking `[cm]` /
      `[clearfix]` as planned — those touch only the message, free and fix layers,
      never the character layers a player sits on. `[freeimage]` is the one that
      empties a character layer, and a project can do it by hand, so a
      MutationObserver on the layer catches a removal whatever caused it.
- [x] **Frame-precise** save restore. The engine fires `snapsave-start` before it
      clones `stat`, which is the only moment the current frame can reach the
      save file; `[ss_restore]` seeks after `play()`, which rewinds.
- [ ] Respect Tyrano's SE volume slider (currently a fixed howler volume)
- [ ] Interaction of Tyrano CSS transitions (fades, etc.) with the overlaid `<canvas>`
- [ ] `devicePixelRatio` / Retina scaling vs `SSCanvasPlayer.resize`'s DPR clamp
- [x] Richer asset/wasm path resolution — `storage=` now goes through the engine's
      own `$.parseStorage(path, 'data')`, so `..`, `.` and doubled slashes resolve
      the way they do for every other tag. Root-absolute and protocol-relative
      URLs still bypass it, and an engine without `parseStorage` keeps the old
      `data/`-prefix.
- [ ] Out of scope (shared with webgl, gated on SpriteStudio-SDK FFI): Text(5) / Nine-slice(6) /
      label-seek / runtime texture-swap / part-property override / animation blending

## Implementation gotchas (do-not-rediscover)

- **`[anim]` opacity is 0–255**, not 0–1 (`$.convertOpacity = val/255`). Full opacity is
  `opacity="255"`; `"0"` hides; `"1"` ≈ 0.4% (nearly invisible). `[anim]` is non-blocking
  (anim stack) — use `[wait]` to sequence.
- **Never put `[ss_xxx]`-style bracket tags inside displayed message text** — TyranoScript
  executes any `[...]` in text as a tag. Write `ss_play` without brackets.
- **Resolve layers via `kag.layer.getLayer(layer, page)`.** `.0_fore` starts with a digit, which
  native `querySelector` rejects (jQuery/Sizzle tolerates it).
- **The desktop (nw.js) export runs with `configSave=file`** (needs `require('fs')`) and crashes
  at boot in a plain browser. A browser needs **`configSave=webstorage`**; also set a unique
  `projectID` to avoid per-origin localStorage collisions.
- **Play audio through howler directly, not `[playse]`** (a KAG tag would advance the scenario).

## References

| Purpose | Path / URL |
| --- | --- |
| Renderer (source of truth) | [`../ssplayer-webgl/`](../ssplayer-webgl/README.md), `packages/ssplayer-webgl/src/SSCanvasPlayer.ts` |
| Audio / resource interfaces | `packages/ssplayer-core/src/IAudioManager.ts`, `IResourceManager.ts` |
| `.sspj → .ssab` converter | `packages/ssconverter-web/` (browser UI `src/main.ts`, Node CLI `scripts/cli.js`, `wasm/ssconverter.js`) |
| Auto-importer reference | SSPlayerForRenPy `game/spritestudio/auto_importer.rpy` |
| TyranoScript (Ver6, free/commercial) | <https://github.com/ShikemokuMK/tyranoscript> |
| Plugin authoring (scripting) | <https://tyrano.jp/usage/advance/plugin> — custom tags: <https://kido0617.github.io/tyrano/2018-08-02-make-plugin/> |
| Layers / tag reference | <https://tyrano.jp/usage/tech/layer> / <https://tyrano.jp/tag/> |
| **Builder** — `.tbp` / `builder.js` / `cmp` / `param` | <https://tyrano.jp/usage/advance/tbp> |
| **Builder** — official techniques / tutorials | <https://b.tyrano.jp/tech/page/plugin> / <https://b.tyrano.jp/tutorial/> |
| **Builder** — using TyranoScript plugins (`plugin.ks`) | <https://note.com/skt_order/n/n0af8dc13bc2a> |
| **Builder** — English plugin tutorial | <https://tyranobuilder.com/tutorials/more/create-your-own-plugins> |
| Plugin library | <https://plugin.tyrano.jp/> |
