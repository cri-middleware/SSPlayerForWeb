[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranoscript

Show and play **SpriteStudio** animations in a **TyranoScript** visual novel by
writing `[ss_*]` tags in your scenario — no coding required.

> **Who this is for:** scenario writers using TyranoScript.
> Using **TyranoBuilder**? Install
> [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md)
> instead: it wraps this runtime, adds the animations to the component palette,
> and converts your `.sspj` files for you.
> **Status:** beta.

▶️ **[Online demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
the bundled TyranoScript sample, running in your browser.

## Quick start

**Writing a scenario?** Read on — install, convert, show. Everything after that (every
tag, crossfades and tracks, signals, save/load, sound) is the same path further in, in
the [TyranoScript guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyrano).
**Working on the plugin?** [For contributors](#for-contributors--building-from-source) below, then [CONTRIBUTING.md](../../CONTRIBUTING.md).

You need a TyranoScript project, and a project made in **SpriteStudio 7.5 or later**.

1. **Install**: Download `ssplayer-tyranoscript-plugin-<version>.zip` from
   [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranoscript&expanded=true):
   open the Release named `@spritestudio/ssplayer-tyranoscript <version>` and take the
   file under **Assets**, not the *Source code* archives. Unzip it and copy the
   `ssplayer/` folder inside into your project's `data/others/plugin/`, keeping its name —
   `[plugin name="ssplayer"]` looks for it there.
2. **Convert**: Open [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)
   in your browser, drop the folder holding your `.sspj` onto it, and download the ZIP.
   Extract it into `data/others/ssdata/`; it holds a folder named after your project, with
   the `.ssab` and its textures inside. On the desktop,
   [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) does the same.

   ```
   mygame/
   ├── index.html
   └── data/
       ├── scenario/
       │   ├── first.ks
       │   └── …
       └── others/
           ├── plugin/ssplayer/
           │   ├── init.ks
           │   ├── main.js
           │   ├── ssruntime_bg.wasm
           │   └── readme.txt
           └── ssdata/
               └── Ringo/       ← extracted from the ZIP
                   ├── Ringo.ssab
                   └── Ringo.png
   ```

3. **Show**: Load the plugin once, at the top of your game, then show a character wherever
   you want one:

   ```
   ; first.ks
   [plugin name="ssplayer"]

   ; scene1.ks
   [ss_new name="chr" storage="others/ssdata/Ringo/Ringo.ssab" layer="0" x="640" y="480" loop="true"]
   [ss_play name="chr"]
   ```

   `storage` is a path from `data/`. `x` / `y` are Tyrano's top-left pixels, and the
   animation's anchor lands there. `anime="…"` picks an animation by name; left out, it is
   the first one.

A complete scenario to read next to these steps is the bundled example's
[`first.ks`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/tyranoscript-example/data/scenario/first.ks) (commented in Japanese) — entrances, `[anim]` fades, several layers and
save/load. The online demo above runs it.

No `.sspj` of your own yet? SpriteStudio's [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — the page is in Japanese, the downloads are not. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character to start with.

**Read next:** [TyranoScript guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyrano) ·
[Tags](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyrano#_4-tags) ·
[Troubleshooting](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyrano#troubleshooting) ·
[Limitations](https://cri-middleware.github.io/SSPlayerForWeb/limitations#tyranoscript-tyranobuilder)

---

## For contributors — building from source

*Plugin users can stop here — everything below is for hacking on the plugin.*

This is a thin adapter. Rendering is handled by
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md)'s `SSPlayer`
(WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies). This package holds **no
GPU code** — it is pure **TyranoScript glue**: adding a `<div>` per character to a
layer (drawn on that layer's shared canvas), coordinate mapping, and playback
control. Remaining work lives in
[`ROADMAP.md`](./ROADMAP.md).

### How it works

- **One runtime for every Tyrano host.** TyranoBuilder and TyranoStudio embed
  TyranoScript, so the same `main.js` — an IIFE bundle that self-registers
  `[ss_*]` onto `master_tag` — serves all of them. The builder's *editor* side is
  a separate package,
  [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.md).
- Two build artifacts:
  - `dist/index.js` (ESM) — for bundlers / tests. Side-effect free (exposes
    `registerSSTags()`).
  - `dist/browser/main.js` (IIFE, self-registering, minified) — the **drop-in** you
    place at `data/others/plugin/ssplayer/main.js`. It inlines the WebGL renderer +
    core JS; **only the WASM binary stays external** (ship `ssruntime_bg.wasm`
    alongside it — the plugin's `init.ks` points `[ss_init wasm=...]` at it).

### Internals (coordinates, lifecycle)

- **Coordinates**: Tyrano's top-left logical pixels (`config.scWidth × scHeight`) map
  to `SSPlayer`'s (Y-down) drawing-buffer space; HiDPI folds `devicePixelRatio`
  into the buffer scale, clamped by `maxDPR`.
- **Naming for `[anim]`**: on creation the character's `<div>` is tagged with the player name as a
  CSS class (`$.setName` is `addClass(name)`, the same way TyranoScript identifies a
  named element). It also carries an `ss-player` class, so `$(".ss-player")` selects
  them all. Absolute positioning goes through the renderer's internal `setTransform`,
  which is why `[ss_pos]` / `[ss_move]` exist alongside `[anim]`.
- **Save target**: each player's reconstruction data is mirrored into
  `TYRANO.kag.stat.f.__ssplayers`. On load the plugin rebuilds from it on the
  engine's `load-beforemaking` event — the moment the saved variables are back and
  before the scenario resumes, which is the window `make.ks` occupies. `[ss_restore]`
  does the same thing on demand, and adopts an automatic pass already in flight
  rather than rebuilding twice.
- **Release**: `[ss_free]` / `[ss_free_all]` call `destroy()`; do not rely on
  `FinalizationRegistry`.
- **Audio**: SS `onAudio` events are routed to howler (`window.Howl`) via
  `TyranoAudioManager`. We use howler directly rather than `[playse]` because a KAG
  tag would advance the scenario (`nextOrder`). Each player gets its own manager,
  because a player's teardown stops everything on its manager. `TyranoAudioManager`
  can also be used directly from JS.

### Distribution (GitHub Releases)

Not published to npm (`private`). TyranoScript authors consume the plugin bundle:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<ver>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm, readme.txt}`, the archive the package's
**GitHub Release** carries; users extract `ssplayer/` into `data/others/plugin/`. The distribution
template lives in [`plugin/`](./plugin/README.md).

### API (ESM)

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyranoscript';

// Call once the TyranoScript runtime is up to register [ss_*].
// Uses the global TYRANO when omitted; a no-op returning false if Tyrano is absent.
registerSSTags();
```

### Development

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run test    # vitest (mock TYRANO harness, no real engine)
pnpm --filter tyranoscript-example run sync:plugin             # copy the built plugin + wasm into the example
```

TyranoScript itself is not bundled: the example commits only the authored scenario, the
plugin loader and the `.ssab` files, and you place a TyranoScript runtime yourself during
development. The docs site's
[Build Guide](https://cri-middleware.github.io/SSPlayerForWeb/development/build) says how to drive
the example in a real engine from a script.

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).
