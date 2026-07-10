# @spritestudio/ssplayer-tyrano Roadmap

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
- [x] Distribution: `plugin/` template + `pnpm run pack` → `ssplayer-tyrano-plugin-<ver>.zip`
- [x] `examples/tyrano-example` (real TyranoScript; engine fetched via `fetch:engine`, git-ignored)

---

## Remaining work

### PT4 — TyranoBuilder support (`.tbp` / `builder.js`)

The builder runtime **is** TyranoScript, so the existing `main.js` already resolves
`[ss_*]` at run time. Builder support is additive metadata in the **same package**.

- [ ] `builder/ssplayer.builder.js` — GUI definition (`cmp` / `param`, one entry per `ss_*` tag)
- [ ] `plugin.ks` wiring — the builder regenerates `first.ks` on preview, so the
      `[loadjs]` must live in `data/scenario/system/plugin.ks` (before `[return]`);
      some plugins also need an entry in `make.ks`
- [ ] **Macro-vs-master_tag reconciliation** — does the builder require a real macro
      to exist for each `cmp` tag name?
      - Plan A (preferred): `main.js`'s `master_tag` is the implementation; `builder.js`
        `cmp` is pure "collect attributes → emit `[ss_new ...]`" metadata. **Verify first.**
      - Plan B (fallback): a thin same-name `[macro]` in `init.ks` bridges to the JS impl
        (`__ss_*_impl`), satisfying the builder's "macro = component" convention.
- [ ] `.tbp` packaging (`pack:tbp`) — zip `plugin/` assets + `builder.js`, rename to `.tbp`
- [ ] SSAB file-select param — `ImageSelect` is image-only; if no generic file param exists,
      fall back to a `Text` path field
- [ ] Timeline preview representation (`component_type: "Image"` + a static thumbnail;
      real playback only at game run time)
- [ ] Confirm the builder's **bundled TyranoScript version** (the `.tbp` / `builder.js` API
      depends on it)
- [ ] **Needs collaboration**: verification requires the actual (paid) TyranoBuilder GUI.
      We can implement up to `.tbp` generation; placing/playing/exporting from the GUI must
      be checked on the maintainer's machine.

### PT4.5 — `.sspj → .ssab` conversion / auto-importer (author-time)

Reference: SSPlayerForRenPy `game/spritestudio/auto_importer.rpy` — in developer mode it
scans `SpriteStudio_Source/*.sspj` at launch, reconverts changed projects (mtime diff), and
writes `.ssab` into `game/ss_assets/`. Ren'Py can do this trivially because `init python:`
runs arbitrary code with fs access every launch. TyranoBuilder has no equivalent author-time
hook we can rely on — that is the crux.

- [ ] **Form A (external tool — recommended / works today).** Convert `.sspj → .ssab` with
      `ssconverter-core` (the existing Node CLI `packages/ssconverter-web/scripts/cli.js`,
      already used by `deploy-examples`) into `data/others/ssdata/`.
      - [ ] `pnpm ss:watch` — mtime-diff watcher (same logic as the Ren'Py importer)
      - [ ] Lowest friction, **no Node/terminal**: the existing `ssconverter-web` browser UI
        (File System Access) — pick a folder → convert → write into the project
      - [ ] Optional: a double-click executable (SEA / pkg)
- [ ] **Form B (in-builder one-click — the real "embedded" goal, PoC-gated).** Can a
      `.tbp` / `builder.js` plugin `require('fs')` (write to the project), instantiate WASM,
      and add a custom UI action? The `.tbp` API is designed for component/param declaration,
      not arbitrary import pipelines — **this is the mountain**.
      - [ ] PoC ①: audit the builder.js API and existing importer-style `.tbp`s for fs + WASM + custom UI
      - [ ] PoC ②: a minimal `.tbp` whose button runs `fs` + `ssconverter.wasm` on a fixed `.sspj`
      - [ ] If blocked, make Form A the official flow and defer B
- [ ] Optimize `ssconverter.wasm` (unoptimized ~6.3 MB → `wasm-opt -Oz`); keep `ssab_schema_version` in sync with the runtime
- [ ] A `.sspj` is a folder (sspj + ssae + ssce + images) — need a directory-select / drag-folder path to pass all files

### PT5 — examples / docs
- [ ] A builder sample project
- [ ] Docs upkeep; consider submitting to the official plugin library (plugin.tyrano.jp)

---

## Open questions / known limitations

- [ ] Auto-hook `[cm]` / `[clearfix]` (layer clear) to `destroy()` — currently manual
      (`[ss_free]` / `[ss_free_all]`; `[ss_restore]` also sweeps stale canvases)
- [ ] **Frame-precise** save restore (currently restores from the animation start, like Spine)
- [ ] Respect Tyrano's SE volume slider (currently a fixed howler volume)
- [ ] Interaction of Tyrano CSS transitions (fades, etc.) with the overlaid `<canvas>`
- [ ] `devicePixelRatio` / Retina scaling vs `SSCanvasPlayer.resize`'s DPR clamp
- [ ] Richer asset/wasm path resolution (Tyrano's own storage search) — currently a simple `data/`-prefix
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
