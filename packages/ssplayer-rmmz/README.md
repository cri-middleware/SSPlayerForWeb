[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

Play **SpriteStudio** (`.ssab`) animations in **RPG Maker MZ** — shown in correct
Z-order with your characters and pictures.

> **Who this is for:** RPG Maker MZ game creators adding SpriteStudio animations via plugin commands — no coding required. Building the plugin itself? → [For contributors](#for-contributors--building-from-source).
> **Status:** alpha (`7.0.0-alpha.1`), private — **not on npm**.
> Distributed as a plugin ZIP attached to **GitHub Releases** once the first release
> ships. No release exists yet, so today you build it from source (see
> [For contributors](#for-contributors--building-from-source)).

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** —
run the bundled sample MZ project in your browser (🚧 live once the first release is
published).

Part of the [SSPlayerForWeb](../../README.md) monorepo. This page has two parts:
**[Using the plugin](#using-the-plugin)** (for RPG Maker MZ game creators) and
**[For contributors](#for-contributors--building-from-source)** (for people hacking on
the plugin or the SDK).

**Which one is for me?** Making a game → read **Using the plugin**. Changing the
plugin's own code → read **For contributors**.

---

# Using the plugin

*For RPG Maker MZ game creators — install the plugin, convert your animation, and
drive it from event commands.*

## 1. Install

1. Get `ssplayer-rpgmakermz.js` **and** `ssruntime_bg.wasm`. **No release is published
   yet** — for now you must build them yourself (see
   [For contributors](#for-contributors--building-from-source)). Once the first release
   ships, you'll download the plugin ZIP from **GitHub Releases** instead.
2. Copy **both** into your project's `js/plugins/` (flat — the WASM must sit next to
   the `.js`).
3. Enable **ssplayer-rpgmakermz** in the Plugin Manager. No parameters — the WASM is
   auto-loaded from the same folder as the plugin `.js`.

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact, pre-built
runtime file the plugin actually plays. Convert your `.sspj` with either:

- **Web — no install:** the hosted converter at
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>** (🚧 live after the first release) — drop the
  **folder** containing your `.sspj` project in and download the `.ssab` (+ its texture) as a zip file.
- **Desktop:** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases).

Put the resulting `.ssab` **and its textures** under a `spritestudio/<project>/` folder at
your project root — beside `img/`, **not inside it**. Deployment prunes unused files from
`img/` (see [Deployment](#4-deployment)), so staying out of it is what keeps SS assets
alive:

```
MyGame/
├── img/                     ← pruned by "Exclude unused files"
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   └── ssruntime_bg.wasm
└── spritestudio/            ← safe
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png        ← textures sit beside their .ssab
```

The path is then the predictable `spritestudio/<project>/<project>.ssab`
(e.g. `spritestudio/Ringo/Ringo.ssab`), which you can paste straight into the
`ssab` field of the `Show SS` command. Textures resolve relative to the `.ssab`, so keep
them in the same folder.

## 3. Plugin commands

Use event → **Plugin Command** → `ssplayer-rpgmakermz`. An SS animation rides on an MZ
**picture**, so *Move Picture* / scale / Z-order / save-load all apply for free.

### Show / attach

| Command | Internal name | Description |
|---|---|---|
| Show SS | `showSS` | Create a picture **and** attach an animation in one step. Args: `pictureId`, `ssab` (e.g. `spritestudio/Ringo/Ringo.ssab`), `animation` (empty = first), `x`, `y`, `scale`, `loop`, `signalSwitch`, `wait`. |
| Set SS As Picture | `setSSAsPicture` | Attach SS to a picture you have **already** shown with the native *Show Picture* command. Then position/erase it with the standard *Move / Erase Picture* commands. (Don't drive one picture id with both a raw *Show Picture* and SS.) |

### Animation control

| Command | Internal name | Description |
|---|---|---|
| Change SS Animation | `changeSSAnimation` | Switch to another animation **within the same `.ssab`** (no reload). |
| Play SS Once | `playSSOnce` | Play an animation, then **auto-return to the current loop** (idle → expression → idle). `loop` = play count. |
| Play SS Sequence | `playSSSequence` | A comma-separated list where each entry plays once except the **last, which loops** (e.g. `attack1,attack2,wait1`). |
| Set SS Speed | `setSSSpeed` | Playback-speed multiplier (subframe-interpolated, smooth even when slow). |

### Part overrides (colour / cell / visibility)

Replace how one part looks at run time, **winning over the animation's keyframes**. The settings are
stored on the picture, so they **survive save/load** (playback resumes from the start of the animation,
as it does for every other picture state).

| Command | Internal name | Description |
|---|---|---|
| Set SS Part Color | `setSSPartColor` | Tint one part. The colour is hex (`#RRGGBB` / `#RRGGBBAA`) because MZ has no colour parameter type; the four blend operations are the authored Parts Color ones. **Normal parts only.** |
| Set SS Part Visibility | `setSSPartVisibility` | Force-hide one part (or revert it). Turn on `cascade` to hide its descendants too — an authored hide never cascades, so this is the way to hide a whole body part. |
| Set SS Part Cell | `setSSPartCell` | Make a part draw a different cell (swapping equipment, for instance). The cell-map name carries no `.ssce` extension. **Normal and mask parts only.** |
| Clear SS Part Overrides | `clearSSPartOverrides` | Remove the overrides. Leave `part` blank to clear every part on that picture. |

> **Priority** (colour / cell only): *yield to the next keyframe* / *hold until the animation changes*
> (default) / *permanent*. Changing the animation clears everything but the **permanent** ones — the
> saved copy is pruned at the same time, to match what the runtime itself discards. Visibility has no
> priority mode and is always cleared by an animation change.

### Playback / lifecycle

| Command | Internal name | Description |
|---|---|---|
| Play / Pause / Stop / Remove SS | — | By `pictureId`. |
| Wait for SS | — | Holds the event until every configured loop has played (use a finite `loop`; `0` is a synonym for infinite, so it waits forever). |

### Lip-sync (talking portrait — advanced)

| Command | Internal name | Description |
|---|---|---|
| Set SS Talk | `setSSTalk` | Bind a picture to a **speaker name** (the message name box): plays `talk` while that speaker's message is on screen, `idle` otherwise — so only the character currently speaking lip-syncs. |
| Clear SS Talk | `clearSSTalk` | Unbind it (do this when the conversation ends). |

> Leaving `animation` empty auto-picks the first; a wrong name warns in the console
> and lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).

## 4. Deployment

**Keep SS assets out of `img/` and "Exclude unused files" can stay on.** Per the
official MZ help, that option only ever prunes `img/`, `audio/` and `effects/`. This
plugin loads `.ssab` files and textures dynamically, so MZ can't tell they're in use and
deletes anything under `img/` — but a project-root `spritestudio/` folder is outside its
reach, exactly like `js/plugins/`. Nothing to register, no extra setup.

> **Migrating:** if your assets are still under `img/spritestudio/`, move the whole folder
> up one level to `spritestudio/` and drop the leading `img/` from the `SSAB File`
> argument of each `Show SS` / `Set SS As Picture` command.

**Trade-off — encryption.** *Encrypt Image Files* is likewise limited to `img/` and
`audio/`, so SS textures outside `img/` ship unencrypted. If you want them encrypted, move
the **whole `spritestudio/` folder back under `img/`** — don't separate the `.ssab` from
its textures. The `.ssab` isn't an image so it stays plain, while the textures beside it
get encrypted and are decrypted automatically via `ImageManager`. In exchange you must
**turn "Exclude unused files" off**, or **copy `img/spritestudio/` into the deployed
output** afterward.

## Known limitations

- The picture's **tint doesn't affect** the SS animation. *Opacity*, *move* and *scale*
  **do** apply.
- **Some screen effects behave differently** from a normal picture (a few PIXI filters
  can shift the animation out of place; looped sound effects play only once). MZ's own
  flash/tint overlays are unaffected.

The technical reasons and planned fixes are in
[For contributors → How it works](#how-it-works).

---

# For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

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

**Known limitations (technical).** The plain-language summary is in
[Known limitations](#known-limitations) above; the internals:

- MZ **tint** is not forwarded to the SS draw. *Opacity* is — `SSPlayerRenderer` passes
  Pixi's `worldAlpha` to `SSWebGLRenderer` as a world tint — and so are *move* and *scale*.
- A **PIXI filter placed directly on the SS sprite** can misplace it — the projection
  is **fixed full-screen**. MZ screen effects (flash, tint) are separate overlays and
  are unaffected.
- Looped SE (`loopNum`) play once; **stencil masks** need a stencil buffer on MZ's
  canvas (present by default).

Wiring MZ's tint into the world tint `SSWebGLRenderer` already takes for opacity, and
injecting a projection matrix for the projection limitation, are planned follow-ups.

## Build & try it

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz pack       # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

Run it in the bundled MZ example:

```sh
pnpm --filter rmmz-example run sync:plugin   # copy the built plugin + no-SIMD wasm into js/plugins/
pnpm deploy-examples                         # convert the SS-SDK test projects into spritestudio/
nw examples/rmmz-example/SampleProject       # Test Play (or open the project in the MZ editor)
```

`sync:plugin` refreshes the built plugin (mirrors `tyranoscript-example`); `deploy-examples`
is the single point that converts and distributes the SS test assets. No NW.js? Use
the browser harness at `examples/rmmz-harness` (real `SSPlayer` / `SSPlayerRenderer`
against PixiJS v5).

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
