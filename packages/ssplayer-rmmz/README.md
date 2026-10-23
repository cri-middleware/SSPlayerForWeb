[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

Play **SpriteStudio** (`.ssab`) animations in **RPG Maker MZ** — shown in correct
Z-order with your characters and pictures.

> **Who this is for:** RPG Maker MZ game creators adding SpriteStudio animations via plugin commands — no coding required.
> **Status:** beta.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** —
run the bundled sample MZ project in your browser.

## Quick start

**Making a game?** Read on — install, convert, show, with no code to write. Everything
after that (tracks, part overrides, deployment, sound) is the same path further in, in
the [RPG Maker MZ guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/rmmz).
**Working on the plugin?** [For contributors](#for-contributors--building-from-source) below, then [CONTRIBUTING.md](../../CONTRIBUTING.md).

You need RPG Maker MZ, and a project made in **SpriteStudio 7.5 or later**.

1. **Install**: Download `ssplayer-rmmz-plugin-<version>.zip` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-rmmz&expanded=true):
   open the Release named `@spritestudio/ssplayer-rmmz <version>` and take the file under
   **Assets**, not the *Source code* archives. Extract its three files —
   `ssplayer-rpgmakermz.js`, `ssruntime_bg.wasm` and `ssconverter_bg.wasm` — flat into your
   game's `js/plugins/`, and turn **ssplayer-rpgmakermz** ON in **Tools → Plugin Manager**.
2. **Convert**: Make a `SpriteStudio_Source/` folder at your game's root, copy your
   SpriteStudio project into it — the whole folder, not the `.sspj` alone — and start a
   test play. Before the title appears, the project is converted into
   `spritestudio/<project>/`, one `.ssab` per animation file (`.ssae`):

   ```
   MyGame/
   ├── js/plugins/
   │   ├── ssplayer-rpgmakermz.js
   │   ├── ssruntime_bg.wasm
   │   └── ssconverter_bg.wasm   ← converts on test play
   ├── SpriteStudio_Source/
   │   └── Ringo/             ← your project folder, copied whole
   │       ├── Ringo.sspj
   │       ├── Ringo.png
   │       └── …
   └── spritestudio/          ← written by test play
       └── Ringo/
           ├── Ringo.ssab
           └── Ringo.png
   ```

3. **Show**: In an event, add **Plugin Command** → `ssplayer-rpgmakermz` → **Show SS**,
   set **SSAB File** to `spritestudio/Ringo/Ringo.ssab`, and start a test play. Leave
   **Animation Name** empty to play the first animation; if a name is wrong, the console
   (F8) lists the real ones.

After saving in SpriteStudio, press **F5** in the test play to convert the change. Before
you deploy, read [Deployment](https://cri-middleware.github.io/SSPlayerForWeb/usage/rmmz#_4-deployment):
it says what to enter in *Exclude files/folders* so your sources stay out of the game.

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with.

**Read next:** [RPG Maker MZ guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/rmmz) ·
[Plugin commands](https://cri-middleware.github.io/SSPlayerForWeb/usage/rmmz#_3-plugin-commands) ·
[Limitations](https://cri-middleware.github.io/SSPlayerForWeb/limitations#rpg-maker-mz-beta)

---

## For contributors — building from source

*Plugin users can stop here — everything below is for hacking on the plugin.*

### How it works

What a game creator sees of this is in the guide's
[How it works](https://cri-middleware.github.io/SSPlayerForWeb/usage/rmmz#how-it-works);
the internals:

- **Layer 3 (renderer).** `SSPlayer` is a `PIXI.Container`; `SSPlayerRenderer` is a
  registered `PIXI.ObjectRenderer` (`'ssplayer'`) that reuses
  [`@spritestudio/ssplayer-webgl`](../ssplayer-webgl)'s `SSWebGLRenderer` against MZ's
  shared `gl`. Raw-GL draws are bracketed with the exact WebGL-state save/restore MZ's
  Effekseer sprite uses. It keeps no timer: playback advances only from the picture
  sprite's `update()`.
- **Layer 4 (plugin).** A drop-in IIFE that gates boot on WASM init
  (`Scene_Boot.isReady`) — the no-SIMD (scalar) build, since MZ's bundled NW.js is a
  Chromium without WebAssembly SIMD — attaches animations to pictures via a Game_Picture ↔
  Sprite_Picture bridge (so MZ move/scale apply and state survives save/load), and
  routes textures through `ImageManager`, sounds through `AudioManager`.

**Known limitations (technical).** The plain-language summary is in the guide's
[Known limitations](https://cri-middleware.github.io/SSPlayerForWeb/usage/rmmz#known-limitations);
the internals:

- MZ **tint** is not forwarded to the SS draw. *Opacity* is — `SSPlayerRenderer` passes
  Pixi's `worldAlpha` to `SSWebGLRenderer` as a world tint — and so are *move* and *scale*.
- A **PIXI filter placed directly on the SS sprite** can misplace it — the projection
  is **fixed full-screen**. MZ screen effects (flash, tint) are separate overlays and
  are unaffected.
- **Stencil masks** need a stencil buffer on MZ's canvas (present by default).

Wiring MZ's tint into the world tint `SSWebGLRenderer` already takes for opacity, and
injecting a projection matrix for the projection limitation, are planned follow-ups — see
[ROADMAP.md](./ROADMAP.md).

### Build & try it

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz run pack   # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

Run it in the bundled MZ example:

```sh
pnpm --filter rmmz-example run sync:plugin   # copy the built plugin + no-SIMD wasm into js/plugins/
pnpm deploy-examples                         # convert the SS-SDK test projects into spritestudio/
nw examples/rmmz-example/SampleProject test  # Test Play (or open the project in the MZ editor)
```

`test` is what makes it a test play: MZ reads it from the first argument, and a launch without
it runs as the deployed game. `sync:plugin` refreshes the built plugin (mirrors `tyranoscript-example`); `deploy-examples`
is the single point that converts and distributes the SS test assets. No NW.js? Use
the browser harness at `examples/rmmz-harness` (real `SSPlayer` / `SSPlayerRenderer`
against PixiJS v5).

To try conversion on test play there, copy
`packages/ssconverter-core/wasm/ssconverter_bg.wasm` into `SampleProject/js/plugins/` and
put a SpriteStudio project under `SampleProject/SpriteStudio_Source/`; both are
git-ignored. `sync:plugin` leaves the converter out because the sample is also published
as the web demo, where nothing converts. The conversion is
[`ssconverter-importer`](../ssconverter-importer)'s, the importer TyranoBuilder runs on project
open.

The docs site's [Build Guide](https://cri-middleware.github.io/SSPlayerForWeb/development/build)
says how to build the plugin for a game of your own and how to check it in the real MZ without
its editor; [How the Player Is Put Together](https://cri-middleware.github.io/SSPlayerForWeb/development/architecture)
says why it is built the way it is.

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).
