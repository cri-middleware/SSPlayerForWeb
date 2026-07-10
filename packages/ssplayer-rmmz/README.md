[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

RPG Maker MZ (PixiJS v5) player + plugin for **SpriteStudio 7** animations.

Part of the [SSPlayerForWeb](../../README.md) monorepo.

It draws `.ssab` animations **directly into MZ's own PixiJS v5 renderer** (the same
approach MZ's Tilemap and the bundled Effekseer use), so animations sit in correct
Z-order with characters and pictures — no overlay canvas.

> ## 🚧 Work in progress
>
> The renderer is functional — it plays SpriteStudio animations correctly, verified
> in a modern browser via `examples/rmmz-harness` (real `SSPlayer` / `SSPlayerRenderer`
> against real PixiJS v5).
>
> **However, it does not yet run in RPG Maker MZ's editor "Test Play".** The
> SpriteStudio WASM runtime requires **WebAssembly SIMD**, but RPG Maker MZ — even
> the latest version (1.10) — bundles an old NW.js (0.51 / **Chromium 89**) where
> SIMD is off by default, and Test Play ignores the `package.json` launch flags that
> would enable it. So on a stock MZ install the animation is disabled (the game still
> runs; the console explains why).
>
> **Planned fix:** a non-SIMD (scalar-fallback) build of the core WASM so it runs on
> MZ's bundled Chromium without any flag. Until then, use a Chromium 91+ runtime
> (update / replace NW.js, or run a deployed build with a newer `nw`) to see it in MZ.
>
> APIs, plugin commands and asset layout may still change.

## How it works

- **Layer 3 (renderer).** `SSPlayer` is a `PIXI.Container`; `SSPlayerRenderer` is a
  registered `PIXI.ObjectRenderer` (`'ssplayer'`) that reuses
  [`@spritestudio/ssplayer-webgl`](../ssplayer-webgl)'s `SSWebGLRenderer` against
  MZ's shared `gl`. Reusing that renderer means **masks, effects, the 13 SS
  integration shaders and instance parts all work** out of the box. Raw-GL draws
  are bracketed with the exact WebGL-state save/restore MZ's Effekseer sprite uses.
- **Layer 4 (plugin).** A drop-in `.js` (IIFE) that gates boot on WASM init
  (`Scene_Boot.isReady`), attaches animations to pictures via a Game_Picture ↔
  Sprite_Picture bridge (so MZ move/scale apply, and state survives save/load), and
  routes textures through `ImageManager` and sounds through `AudioManager`.
- **No private timer.** Playback advances only from the host sprite's `update()`, so
  SS animations pause exactly with the game (menus, message waits).

## Install (as an MZ plugin)

1. Build & pack, or grab the release zip:
   ```sh
   pnpm --filter @spritestudio/ssplayer-rmmz build
   pnpm --filter @spritestudio/ssplayer-rmmz pack   # dist/pack/ssplayer-rmmz-plugin-<v>.zip
   ```
2. Copy these into your project's `js/plugins/` (flat — the WASM must sit next to
   the `.js`):
   - `ssplayer-rpgmakermz.js` + `ssruntime_bg.wasm`
   - *(optional, dev only)* `ssplayer-rpgmakermz-devconvert.js` + `ssconverter_bg.wasm`
3. Enable **ssplayer-rpgmakermz** in the plugin manager. No parameters — the WASM is
   auto-loaded from the same folder as the plugin `.js`.

## Usage

Place your converted `.ssab` under `img/spritestudio/<project>/`, then use plugin
commands (event → Plugin Command → `ssplayer-rpgmakermz`):

- **Show SS** — `pictureId`, `ssab` (e.g. `img/spritestudio/Ringo/Ringo.ssab`),
  `animation` (leave empty for the first animation), `x`, `y`, `scale`, `loop`,
  `signalSwitch`.
- **Play / Pause / Stop / Remove SS** — by `pictureId`.

Leaving `animation` empty auto-picks the first; a wrong name warns in the console and
lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).

## Developer converter (drop a .sspj → get a .ssab)

Enable **ssplayer-rpgmakermz-devconvert** during development. On **NW.js test-play**
it scans `<game>/ss_source/` for `.sspj` projects and converts changed ones (mtime
cached) into `img/spritestudio/<project>/` via
[`@spritestudio/ssconverter-core`](../ssconverter-core). It is a **no-op in deployed
games** (no filesystem) — ship the pre-converted `.ssab` and don't include this
plugin in a release.

## Try it in the bundled MZ example

After building, deploy the plugin + a SpriteStudio source project into
`examples/rmmz-example/SampleProject/` in one step:

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build
pnpm --filter @spritestudio/ssplayer-rmmz deploy:example          # plugin + Ringo source
# node scripts/deploy-example.mjs Ringo Mesh   # specific projects
# node scripts/deploy-example.mjs --all        # every tests/* project
# node scripts/deploy-example.mjs --no-dev     # skip the dev converter
```

It copies the runtime plugin + WASM (and the dev converter) into `js/plugins/`,
registers them in `js/plugins.js` (idempotent, preserving other plugins), and
copies each project's source into `ss_source/<name>/`. Then run
`nw examples/rmmz-example/SampleProject` and add a **Show SS** plugin command to an
event. (No NW.js? Use the `examples/rmmz-harness` browser harness instead.)

## Deployment ⚠️

- **"Exclude unused files" deletes your animations.** `.ssab`/textures under
  `img/spritestudio/` are loaded dynamically, so MZ's deployment option treats them
  as unused and removes them. Either **turn that option off**, or **copy
  `img/spritestudio/` into the deployed output** afterward. (Same caveat the old
  SS6Player plugin had.)
- **Don't ship the developer converter.** Before releasing, delete
  `ssplayer-rpgmakermz-devconvert.js` **and** `ssconverter_bg.wasm` (~1.4 MB) from
  `js/plugins/`, and disable the plugin — they're only used during NW.js test-play.

## v1 limitations

Because this reuses `SSWebGLRenderer` as-is:

- **MZ opacity/tint on the picture are not applied** to the SS animation (the
  renderer draws at full opacity). Move/scale *do* apply.
- **Fixed full-screen projection**: putting a **PIXI filter directly on the SS
  sprite** can misplace it. MZ screen effects (flash, tint) are separate overlays and
  are unaffected.
- Looped SE (`loopNum`) play once; stencil masks need a stencil buffer on MZ's canvas
  (present by default).

Both projection and opacity would be fixed cleanly by a small enhancement to
`SSWebGLRenderer` (accept an injected projection + alpha/tint uniform) — a planned
follow-up.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
