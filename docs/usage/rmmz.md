# RPG Maker MZ

::: warning Experimental / alpha
`@spritestudio/ssplayer-rmmz` is an **experimental alpha** (`7.0.0-alpha.1`). The
package is **private and not published on npm**. Its rendering is built on
[`ssplayer-webgl`](/usage/webgl)'s `SSWebGLRenderer`.

**There are no releases yet.** Once the first release ships, a plugin ZIP will be
distributed on **GitHub Releases** — but for now the only way to obtain it is to
[build from source](#building-from-source). You cannot install it from npm.

:::

This plugin plays **SpriteStudio 7** (`.ssab`) animations in **RPG Maker MZ**. Because
the animation is drawn straight into MZ's PixiJS v5 renderer, it sits in the correct
Z-order with your characters and pictures.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — run
the bundled sample MZ project in your browser (goes live once the first release is
published 🚧).

## How it works

Animations are drawn **directly into MZ's own PixiJS v5 renderer** (the same approach as
MZ's Tilemap and the bundled Effekseer). There is no overlay canvas, so they render in
correct Z-order with characters and pictures.

- `SSPlayer` extends `PIXI.Container`, and `SSPlayerRenderer` — a registered
  `PIXI.ObjectRenderer` (`'ssplayer'`) — reuses [`ssplayer-webgl`](/usage/webgl)'s
  `SSWebGLRenderer` against MZ's shared `gl`. Reusing that renderer means masks,
  effects, the 13 SS integration shaders, and instance parts all work out of the box.
- It bundles the **no-SIMD (scalar)** WASM, so it runs on MZ's bundled NW.js (a Chromium
  without WebAssembly SIMD) with no launch flags. If initialization fails, SS animations
  are disabled but the game still boots.

## 1. Install

1. Get `ssplayer-rpgmakermz.js` **and** `ssruntime_bg.wasm`. **No release is published
   yet**, so for now you build them yourself (see [Building from source](#building-from-source)).
   Once the first release ships, you'll download the plugin ZIP from **GitHub Releases**
   instead.
2. Copy **both** into your project's `js/plugins/`, flat (the WASM must sit next to the
   `.js`).
3. Enable **ssplayer-rpgmakermz** in the Plugin Manager. There are no parameters — the
   WASM is auto-loaded from the same folder as the plugin `.js`.

## 2. Convert your animation (.sspj → .ssab)

`.sspj` is your editable SpriteStudio project; `.ssab` is the compact runtime file the
plugin actually plays. See [Preparing assets](/usage/assets) for how to convert. Put the
output under `img/spritestudio/<project>/` so it matches the `Show SS` path
`img/spritestudio/<project>/<project>.ssab`.

## 3. Plugin commands

Run these from an event's **Plugin Command** → `ssplayer-rpgmakermz`. An SS animation
rides on an MZ **picture**, so *Move Picture* / scale / Z-order / save-load all apply for
free.

**Show / attach**

- **Show SS** (`showSS`) — create a picture and attach an animation in one step.
- **Set SS As Picture** (`setSSAsPicture`) — attach SS to a picture you have **already**
  shown with the native *Show Picture* command. From there, position and erase it with
  the standard *Move / Erase Picture* commands.

**Animation control**

- **Change SS Animation** (`changeSSAnimation`) — switch to another animation **within
  the same `.ssab`** (no reload).
- **Play SS Once** (`playSSOnce`) — play an animation a set number of times, then
  **auto-return to the current loop** (idle → expression → idle).
- **Play SS Sequence** (`playSSSequence`) — a comma-separated list where each entry plays
  once except the **last, which loops**.
- **Set SS Speed** (`setSSSpeed`) — a playback-speed multiplier (subframe-interpolated,
  smooth even when slow).

**Playback / lifecycle**

- **Play / Pause / Stop / Remove SS**, and **Wait for SS** — by `pictureId`. *Wait for
  SS* holds the event until a **non-looping** animation finishes (give it a finite
  `loop`, or it waits forever).

**Lip-sync (talking portrait — advanced)**

- **Set SS Talk** (`setSSTalk`) — bind a picture to a **speaker name** (the message name
  box): it plays `talk` while that speaker's message is on screen and `idle` otherwise.
- **Clear SS Talk** (`clearSSTalk`) — unbind it (do this when the conversation ends).

Leaving `animation` empty auto-picks the first; a wrong name warns in the console and
lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).

## 4. Deployment ⚠️

**"Exclude unused files" deletes your animations.** The `.ssab` files and textures under
`img/spritestudio/` are loaded dynamically, so MZ's deployment option treats them as
unused and removes them. Either **turn that option off**, or **copy `img/spritestudio/`
into the deployed output** afterward (the same caveat the old SS6Player plugin had).

## Known limitations

- The picture's **opacity / tint don't affect** the SS animation — it always draws fully
  opaque. *Move* and *scale* **do** apply.
- **Some screen effects behave differently** from a normal picture (a few PIXI filters
  can shift the animation out of place; looped sound effects play only once). MZ's own
  flash / tint overlays are unaffected.

The opacity/tint and projection limitations would both be fixed by a small enhancement to
`SSWebGLRenderer` (an injected projection matrix plus an alpha/tint uniform) — a planned
follow-up.

## Building from source

```sh
pnpm --filter @spritestudio/ssplayer-rmmz build      # dist/browser/ssplayer-rpgmakermz.js
pnpm --filter @spritestudio/ssplayer-rmmz pack       # dist/pack/ssplayer-rmmz-plugin-<v>.zip
```

To try it in the bundled MZ example:

```sh
pnpm --filter rmmz-example run sync:plugin   # copy the built plugin + no-SIMD wasm into js/plugins/
pnpm deploy-examples                         # convert the SS-SDK test projects into img/spritestudio/
nw examples/rmmz-example/SampleProject       # Test Play (or open the project in the MZ editor)
```

No NW.js? Use the browser harness at `examples/rmmz-harness` (real `SSPlayer` /
`SSPlayerRenderer` against PixiJS v5). Track progress in
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md).
