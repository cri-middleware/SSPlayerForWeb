[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyrano

A thin adapter for **TyranoScript / TyranoBuilder**. It displays and plays
SpriteStudio 7 animations inside a VN scenario through `[ss_*]` KAG custom tags.

Rendering is handled by [`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.md)'s
`SSCanvasPlayer` (WebGL1 baseline + WebGL2 auto-upgrade, zero dependencies). This
package holds **no GPU code** — it is pure **TyranoScript glue**: inserting a
`<canvas>` into a layer `div`, coordinate mapping, and playback control.

> Design decisions and remaining work (PT4 builder support, PT4.5 converter
> import, …) live in [`ROADMAP.md`](./ROADMAP.md). Implemented range: **PT0–PT3**
> (verified in real TyranoScript).

## How it works

- **The runtime is shared across TyranoScript / TyranoBuilder / TyranoStudio.** A
  single `main.js` (an IIFE bundle that self-registers `[ss_*]` onto `master_tag`)
  works everywhere.
- Two build artifacts:
  - `dist/index.js` (ESM) — for bundlers / tests. Side-effect free (exposes
    `registerSSTags()`).
  - `dist/browser/main.js` (IIFE, self-registering, minified) — the **drop-in** you
    place at `data/others/plugin/ssplayer/main.js` in a TyranoScript project. It
    inlines the WebGL renderer + core JS; **only the WASM binary stays external**
    (ship `ssruntime_bg.wasm` and point `[ss_init wasm=...]` at it).

## Tags (PT1 + PT2 + PT3)

| Tag | Role | Key attributes |
| --- | --- | --- |
| `[ss_init]` | Initialize WASM once + audio config | `wasm=` (effectively required), `base=`, `audio=`, `sounddir=`, `soundext=`, `sevolume=` |
| `[ss_new]` | Create player → load ssab → insert canvas on the layer → play | `name=`(req) `storage=`(req) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` |
| `[ss_play]` | Play / switch animation | `name=`(req) `anime=` `loop=` `start=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | Per-player stop / pause / resume | `name=`(req) |
| `[ss_wait]` | Wait until the animation ends (one loop if looping) | `name=`(req) |
| `[ss_pos]` | Instant move/scale (internal transform, anchor-accurate, absolute) | `name=`(req) `x=` `y=` `scale=` |
| `[ss_move]` | Tweened move/scale (internal transform, easeOut, non-blocking) | `name=`(req) `x=` `y=` `scale=` `time=` |
| `[ss_free]` | Release (remove canvas + `destroy()` + drop from registry) | `name=`(req) |
| `[ss_free_all]` | Release every player (scene transition / layer clear) | — |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume all (e.g. around a menu) | — |
| `[ss_restore]` | Rebuild every player from a save (**place in `make.ks`**) | — |

Coordinates map Tyrano's **top-left logical pixels** (`config.scWidth × scHeight`)
to `SSCanvasPlayer`'s (Y-down) drawing-buffer space (HiDPI folds `devicePixelRatio`
into the buffer scale, clamped by `maxDPR`). `loop`: `true` → infinite / `false` →
once / a number → that many loops.

### Lifecycle (PT2)

- **Render loop**: `SSCanvasPlayer`'s built-in RAF. `pauseWhenHidden` (on by
  default) auto-pauses when the tab is hidden / the canvas is off-screen. Playback
  **continues during ordinary text waits** (`[l]`/`[p]`) — the expected behavior; to
  freeze a menu / save screen use `[ss_pause_all]` / `[ss_resume_all]`.
- **Save / load**: each player's reconstruction data is mirrored into
  `TYRANO.kag.stat.f.__ssplayers` (the save target). On load TyranoScript `call`s
  `make.ks`, so put `[ss_init]` → `[ss_restore]` there to rebuild players (from the
  animation start, not a precise frame).
- **Release**: call `[ss_free]` / `[ss_free_all]` on scene transitions / layer clears
  to `destroy()` (do not rely on `FinalizationRegistry`).

### Movement / effects via TyranoScript's own tags (`[anim]` / `[kanim]`)

The SS player's canvas is a **real DOM element in the layer**, and it is tagged with
the **player name as a CSS class** on creation (TyranoScript identifies a named
element exactly this way — `$.setName` is `addClass(name)`). So Tyrano's built-in
`[anim]` / `[kanim]` drive it directly:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; fade out (disappear)
[anim name="ringo" time="800" opacity="255"]      ; fade in (appear)
[anim name="ringo" time="600" left="120" top="0"] ; slide (CSS translate)
[kanim name="ringo" time="500" ...]               ; keyframes too
```

> ⚠️ TyranoScript's `[anim]` **`opacity` is 0–255** (not 0–1): `$.convertOpacity`
> divides by 255, so `opacity="1"` ≈ 0.4% (nearly invisible). **Full opacity is
> `255`.**

The canvas also carries an `ss-player` class, so `$(".ss-player")` selects them all.

**When to use which** (the same reason the official Spine plugin ships its own
`[spine_mod]`):

- **Fades (opacity) / simple slides / shakes** → `[anim]` / `[kanim]` is ideal; it
  just moves the canvas via CSS, no extra code.
- But the canvas is **full-screen** and its position comes from the renderer's
  **internal `setTransform`** (`[ss_new x/y]`), so `[anim left/top]` is a **relative
  offset** from the initial position and `scale`/`rotate` pivot on the **screen
  center** (not the SS anchor). For **absolute, anchor-accurate** position/scale use
  **`[ss_pos]` (instant) / `[ss_move]` (tween)** (the `[spine_mod]` equivalent).

### Audio (PT3)

SS audio events (`onAudio`) are routed to TyranoScript's bundled **howler**
(`window.Howl`) via `TyranoAudioManager`. We use howler directly rather than
`[playse]` because a KAG tag would advance the scenario (`nextOrder`). Sound files
are expected under `data/sound/`; an SS sound name resolves to
`data/<dir>/<name>.<ext>` (tune with `[ss_init sounddir= soundext= sevolume=]`,
disable with `audio="false"`). `TyranoAudioManager` can also be used directly from JS.

TyranoBuilder `.tbp` support, `[cm]`/`[clearfix]` auto-hooks, frame-precise restore,
and Tyrano volume-slider integration are tracked in [`ROADMAP.md`](./ROADMAP.md).

## Distribution (GitHub Releases)

Not published to npm (`private`). TyranoScript authors consume the plugin bundle:

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<ver>.zip
```

`pack` zips `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}`. Attach it to a **GitHub
Release**; users extract `ssplayer/` into `data/others/plugin/`. The distribution
template lives in [`plugin/`](./plugin/README.md). The builder `.tbp` is PT4.

## Usage (plugin layout)

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # this package's dist/browser/main.js
  ssruntime_bg.wasm    # the @spritestudio/ssplayer-core runtime binary
data/others/ssdata/<project>.ssab
```

```
; first.ks
[plugin name="ssplayer"]
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

A runnable minimal project is [`examples/tyrano-example`](../../examples/tyrano-example/README.md)
(the TyranoScript engine itself is placed at dev-time).

## API (ESM)

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyrano';

// Call once the TyranoScript runtime is up to register [ss_*].
// Uses the global TYRANO when omitted; a no-op returning false if Tyrano is absent.
registerSSTags();
```

## Development

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run test    # vitest (mock TYRANO harness, no real engine)
```

## License

BSD-3-Clause © CRI Middleware Co., Ltd.
