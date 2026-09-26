# @spritestudio/ssplayer-tyranoscript Roadmap

A thin TyranoScript adapter. Rendering is delegated entirely to
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md) (`SSPlayer`);
this package is pure glue — it registers `[ss_*]` KAG custom tags that mount an SS
canvas onto a Tyrano layer and drive playback. For the project-wide roadmap see
[`../../ROADMAP.md`](../../ROADMAP.md).

## Design decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Renderer | Use `ssplayer-webgl`'s `SSPlayer` | All GPU/WebGL difficulty is isolated in the webgl package; tyrano stays glue. |
| Dependency | **`ssplayer-webgl` only** (not core) | webgl re-exports core; core is pulled in transitively. Core/`flatbuffers` are still inlined into the IIFE build. |
| PixiJS | Not used | TyranoScript does not bundle Pixi; we insert our own `<canvas>`. |
| WebGL version | Ride webgl's WebGL1 baseline + WebGL2 auto-upgrade | Broad device reach (old/mobile webviews, builder native export). |
| TyranoBuilder | **Shares this runtime**, editor side in [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/ROADMAP.md) | The builder embeds TyranoScript, so one `main.js` serves both; but its editor is a separate application with its own plugin format, which is a package's worth of work. |
| Distribution | `private` (no npm). Ship the plugin bundle via **GitHub Releases** | Scenario authors drop files in; they do not `npm install`. |
| Audio | Route SS `onAudio` through TyranoScript's bundled **howler** (`window.Howl`) | A `[playse]` KAG tag would advance the scenario (`nextOrder`); howler cannot. |

## Implemented (PT0–PT3, verified in real TyranoScript)

### PT0 — scaffold
- [x] `package.json` / `tsdown.config.ts` / ESM (`dist/index.js`) + self-registering IIFE (`dist/browser/main.js`)
- [x] `ssplayer-webgl`-only dependency; `private: true`

### PT1 — minimal display
- [x] `[ss_init]` / `[ss_new]` / `[ss_play]`
- [x] `LayerCanvas` (layer lookup via `kag.layer.getLayer(layer, page)`, same as the official Spine plugin)
- [x] `PlayerRegistry` (name → `SSPlayer`)
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
blending — no SpriteStudio runtime equivalent, see the FFI-gated item under "Open questions");
`skin=` and `[live2d_expression]` (already covered, and then some, by `[ss_part_*]`);
`lip_time` / `lip_sound_level` / `breath` (Live2D parameter-rig specifics);
`bgimage` (Tyrano's own background layer already does this).

### PT6.5 — state that belongs to the player, not to the adapter

A review of what this adapter was holding that the core already knew
(PRs #42 / #43). Each of these was a copy that could drift, and one of them did.

- [x] **The pack is read once.** `[ss_new]` without `anime=` used to download the
      whole `.ssab` a second time just to read its animation names; the player
      caches them when it binds the pack (`getAnimationNames()`).
- [x] **Loop goes through the player.** Four call sites reached past it into
      `internalPlayer.setLoop`; `SSPlayer.loopCount` exists now. Note it is
      write-to-request, not read-compare — the runtime resets its remaining-loop
      counter on every write and normalises `0` to `-1`.
- [x] **The buffer-scale ratio is derived, not cached.** It was captured at
      `[ss_new]`, so the first window resize left every character on the layer
      misplaced and `[ss_pos]` / `[ss_move]` re-used the same stale ratio.
      `SSOverlay.onResized` now re-places the layer's players.
- [x] **The override dance is one call.** `SSPartOverrideStore` keeps the saved
      list and the live runtime in step; the list itself stays here, because it
      is written before a player exists and has to outlive every rebuild.

### PT6 — one line to set up, and nothing to clean up

Everything a scenario needed to remember to do, the plugin now does.

- [x] **`[plugin name="ssplayer"]` is the whole setup.** The plugin's own
      `init.ks` runs `[ss_init]` after `[loadjs]` — which waits for the script to
      execute, so the tags are registered by then — and the wasm path is fixed
      relative to the plugin folder. `[ss_init]` survives as the audio-settings
      tag: it applies those before checking whether the runtime is already up.
- [x] **Restore needs no `make.ks` entry.** The engine fires `load-beforemaking`
      with the saved variables already applied, just before it `call`s `make.ks`,
      so the plugin restores itself. Registered without `temp` — which the engine
      documents as "delete when a save is loaded" — and guarded on `kag.on`, since
      older builds have no event bus and there `[ss_restore]` is still the way.
      `[ss_restore]` adopts an automatic pass already in flight rather than
      rebuilding twice.
- [x] **Frame-precise restore.** `snapsave-start` fires before the engine clones
      `stat`, which is the only moment the current frame can reach the save file.
      Restore seeks after `play()`, which rewinds. Saves written before this
      restore from the start, as they always did.
- [x] **Players are released when their layer is cleared.** Not by hooking `[cm]`
      / `[clearfix]` as once planned — those touch only the message, free and fix
      layers, never the character layers a player sits on. `[freeimage]` empties
      one, and a project can do it by hand, so a MutationObserver on the layer
      catches the removal whatever caused it.
- [x] **`storage=` resolves like every other tag**, through the engine's own
      `$.parseStorage(path, 'data')`. Root-absolute and protocol-relative URLs
      bypass it; an engine without it keeps the old `data/` prefix.

---

## Remaining work

### PT4 / PT4.5 — TyranoBuilder support — **done, in a separate package**

Shipped as [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md).
TyranoBuilder turned out to be a different tool rather than a mode of TyranoScript —
its own plugin format, editor API and install flow — so it got its own package. The
two halves ship in one plugin folder: this package's `main.js` registers the `[ss_*]`
tags at run time, and that package contributes the editor side.

Everything about the builder — what the earlier plan here got wrong, how its plugin
and component APIs behave, and what is left to build — now lives in
[that package's ROADMAP](../ssplayer-tyranobuilder/ROADMAP.md).

### PT5 — examples / docs
- [x] `examples/tyranoscript-example` — hand-written TyranoScript
- [ ] Docs upkeep; consider submitting to the official plugin library (plugin.tyrano.jp)

### PT7 — tag surface still missing next to the other adapters

Found by comparing this adapter against `ssplayer-rmmz` tag-for-tag rather than
against the Spine / Live2D plugins. The runtime already has all of it; the gap
is entirely in what the tags expose.

- [ ] **Signal parameters and user data do not reach the scenario.**
      `[ss_wait_signal var=]` stores the command ID and nothing else. RPG Maker
      MZ's `signalSwitch` passes less still, so this waits for a request.

---

## Open questions / known limitations

- [ ] Interaction of Tyrano CSS transitions (fades, etc.) with the overlaid `<canvas>`
- [ ] `devicePixelRatio` / Retina scaling vs `SSPlayer.resize`'s DPR clamp
- [ ] Optimize `ssconverter.wasm` (`wasm-opt -Oz`) — shared with
      [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/ROADMAP.md), which ships it
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
| Renderer (source of truth) | [`../ssplayer-webgl/`](../ssplayer-webgl/README.md), `packages/ssplayer-webgl/src/SSPlayer.ts` |
| Audio / resource interfaces | `packages/ssplayer-core/src/IAudioManager.ts`, `IResourceManager.ts` |
| `.sspj → .ssab` converter | `packages/ssconverter-web/` (browser UI `src/main.ts`, Node CLI `scripts/cli.js`, `wasm/ssconverter.js`) |
| Auto-importer reference | SSPlayerForRenPy `game/spritestudio/auto_importer.rpy` |
| TyranoScript (Ver6, free/commercial) | <https://github.com/ShikemokuMK/tyranoscript> |
| Plugin authoring (scripting) | <https://tyrano.jp/usage/advance/plugin> — custom tags: <https://kido0617.github.io/tyrano/2018-08-02-make-plugin/> |
| Layers / tag reference | <https://tyrano.jp/usage/tech/layer> / <https://tyrano.jp/tag/> |
| Plugin library | <https://plugin.tyrano.jp/> |
| TyranoBuilder side | [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/ROADMAP.md) |
