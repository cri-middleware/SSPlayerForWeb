[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

Play **SpriteStudio 7** (`.ssab`) animations in **RPG Maker MZ** — shown in correct
Z-order with your characters and pictures.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** —
run the bundled sample MZ project in your browser (🚧 live once the first release is
published).

Part of the [SSPlayerForWeb](../../README.md) monorepo. This page has two parts:
**[Using the plugin](#using-the-plugin)** (for RPG Maker MZ game creators) and
**[Contributing](#contributing)** (for people hacking on the plugin or the SDK).

---

# Using the plugin

*For RPG Maker MZ game creators — install the plugin, convert your animation, and
drive it from event commands.*

## 1. Install

1. Get `ssplayer-rpgmakermz.js` **and** `ssruntime_bg.wasm` — from a release zip, or
   build them yourself (see [Contributing](#contributing)).
2. Copy **both** into your project's `js/plugins/` (flat — the WASM must sit next to
   the `.js`).
3. Enable **ssplayer-rpgmakermz** in the Plugin Manager. No parameters — the WASM is
   auto-loaded from the same folder as the plugin `.js`.

## 2. Convert your animation (.sspj → .ssab)

The plugin plays **pre-built** `.ssab`. Convert your SpriteStudio project with either:

- **Web — no install:** the hosted converter at
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>** — drop your
  `.sspj` project in and download the `.ssab` (+ its texture).
- **Desktop:** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases).

Then put the output under `img/spritestudio/<project>/`, so it matches the `Show SS`
path `img/spritestudio/<project>/<project>.ssab`.

## 3. Plugin commands

Use event → **Plugin Command** → `ssplayer-rpgmakermz`. An SS animation rides on an MZ
**picture**, so *Move Picture* / scale / Z-order / save-load all apply for free.

**Show / attach**

- **Show SS** (`showSS`) — create a picture **and** attach an animation in one step:
  `pictureId`, `ssab` (e.g. `img/spritestudio/Ringo/Ringo.ssab`), `animation`
  (empty = first), `x`, `y`, `scale`, `loop`, `signalSwitch`, `wait`.
- **Set SS As Picture** (`setSSAsPicture`) — attach SS to a picture you have
  **already** shown with the native *Show Picture* command. Then position/erase it
  with the standard *Move / Erase Picture* commands. (Don't drive one picture id with
  both a raw *Show Picture* and SS.)

**Animation control**

- **Change SS Animation** (`changeSSAnimation`) — switch to another animation
  **within the same `.ssab`** (no reload).
- **Play SS Once** (`playSSOnce`) — play an animation, then **auto-return to the
  current loop** (idle → expression → idle). `loop` = play count.
- **Play SS Sequence** (`playSSSequence`) — a comma-separated list where each entry
  plays once except the **last, which loops** (e.g. `attack1,attack2,wait1`).
- **Set SS Speed** (`setSSSpeed`) — playback-speed multiplier (subframe-interpolated,
  smooth even when slow).

**Playback / lifecycle**

- **Play / Pause / Stop / Remove SS**, and **Wait for SS** — by `pictureId`.
  *Wait for SS* holds the event until a **non-looping** animation finishes (use a
  finite `loop`, or it waits forever).

**Lip-sync (talking portrait — advanced)**

- **Set SS Talk** (`setSSTalk`) — bind a picture to a **speaker name** (the message
  name box): plays `talk` while that speaker's message is on screen, `idle`
  otherwise — so only the character currently speaking lip-syncs.
- **Clear SS Talk** (`clearSSTalk`) — unbind it (do this when the conversation ends).

> Leaving `animation` empty auto-picks the first; a wrong name warns in the console
> and lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).

## 4. Deployment ⚠️

**"Exclude unused files" deletes your animations.** `.ssab`/textures under
`img/spritestudio/` are loaded dynamically, so MZ's deployment option treats them as
unused and removes them. Either **turn that option off**, or **copy
`img/spritestudio/` into the deployed output** afterward. (Same caveat the old
SS6Player plugin had.)

## Current limitations

- **MZ opacity / tint on the picture are not applied** to the SS animation (it draws
  at full opacity). *Move* and *scale* **do** apply.
- Putting a **PIXI filter directly on the SS sprite** can misplace it (fixed
  full-screen projection). MZ screen effects (flash, tint) are separate overlays and
  are unaffected.
- Looped SE (`loopNum`) play once; stencil masks need a stencil buffer on MZ's canvas
  (present by default).

---

# Contributing

*For people hacking on the plugin or the SDK — architecture, building from source,
and the bundled test harnesses.*

## How it works

Animations are drawn **directly into MZ's own PixiJS v5 renderer** (the same approach
MZ's Tilemap and the bundled Effekseer use) — no overlay canvas — which is why they
sit in correct Z-order with characters and pictures.

- **Runtime.** Bundles the **no-SIMD (scalar)** SpriteStudio WASM, so it runs on MZ's
  bundled NW.js (Chromium without WebAssembly SIMD) with no launch flags. If it can't
  initialize, SS animations are disabled but the game still boots (the console says
  why).
- **Layer 3 (renderer).** `SSPlayer` is a `PIXI.Container`; `SSPlayerRenderer` is a
  registered `PIXI.ObjectRenderer` (`'ssplayer'`) that reuses
  [`@spritestudio/ssplayer-webgl`](../ssplayer-webgl)'s `SSWebGLRenderer` against MZ's
  shared `gl`. Reusing that renderer means **masks, effects, the 13 SS integration
  shaders and instance parts all work** out of the box. Raw-GL draws are bracketed
  with the exact WebGL-state save/restore MZ's Effekseer sprite uses.
- **Layer 4 (plugin).** A drop-in IIFE that gates boot on WASM init
  (`Scene_Boot.isReady`), attaches animations to pictures via a Game_Picture ↔
  Sprite_Picture bridge (so MZ move/scale apply and state survives save/load), and
  routes textures through `ImageManager`, sounds through `AudioManager`.
- **No private timer.** Playback advances only from the host sprite's `update()`, so
  SS animations pause exactly with the game (menus, message waits).

The opacity/tint and projection limitations above would both be fixed by a small
enhancement to `SSWebGLRenderer` (accept an injected projection matrix + alpha/tint
uniform) — a planned follow-up.

## Build & try it

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz pack       # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

Run it in the bundled MZ example:

```sh
pnpm --filter rmmz-example run sync:plugin   # copy the built plugin + no-SIMD wasm into js/plugins/
pnpm deploy-examples                         # convert the SS-SDK test projects into img/spritestudio/
nw examples/rmmz-example/SampleProject       # Test Play (or open the project in the MZ editor)
```

`sync:plugin` refreshes the built plugin (mirrors `tyrano-example`); `deploy-examples`
is the single point that converts and distributes the SS test assets. No NW.js? Use
the browser harness at `examples/rmmz-harness` (real `SSPlayer` / `SSPlayerRenderer`
against PixiJS v5).

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
