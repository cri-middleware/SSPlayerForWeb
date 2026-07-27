# Migrating from SS6Player for Web

[← Back to docs home](/)

This guide covers moving from the legacy **[SS6Player for Web](https://github.com/SpriteStudio/SS6PlayerForWeb)** (`ss6player-pixi`) to this player (`@spritestudio/ssplayer-pixi`). Timeline evaluation has moved from **JavaScript to a Rust/WebAssembly core**, and the asset pipeline and API have been redesigned. This is not a drop-in swap — you will need to **re-convert your assets and rewrite your scripts**.

Note that **both players target PixiJS v8**, so your Pixi-side rendering and scene-graph code stays largely the same.

## 1. Asset format & pipeline

- **SS6Player**: converted `.sspj` into the FlatBuffers-based **`.ssfb`** format, loaded alongside textures (PNG, etc.).
- **This version**: uses the optimized binary **`.ssab`** format. `.ssfb` is not supported, so **re-convert from `.sspj` to `.ssab`**.
  - See [Preparing assets (.sspj → .ssab)](/usage/assets) for the conversion steps.
  - An `--embedded` mode that bundles textures into a single file is also available.

## 2. Class layout & initialization

- **SS6Player**: used two classes — an asset container **`SS6Project`** (loads `.ssfb` + textures) and a display object **`SS6Player`** (extends `Container`). You constructed it with an **anime-pack name + anime name**: `new SS6Player(project, animePackName, animeName)`.
- **This version**: collapses to a **single `SSPlayer` class** (extends `Container`). Construct it with **no arguments**, load the `.ssab` via `load()`, and select an animation **by name** with `setAnimation()`. No anime-pack name is required (instance parts are resolved automatically).
  - You must **`await SSPlayer.initialize()` once at startup** to boot the WASM runtime.

```ts
import { SSPlayer } from '@spritestudio/ssplayer-pixi';

// SS6Player:
//   const project = new SS6Project('character.ssfb', () => {
//     const player = new SS6Player(project, 'character', 'walk');
//     app.stage.addChild(player);
//     player.Play();
//   });

// This version:
await SSPlayer.initialize();            // once at startup
const player = new SSPlayer();          // no arguments
await player.load('character.ssab');    // load the .ssab
await player.setAnimation('walk', -1);  // select by name (-1 = infinite loop)
app.stage.addChild(player);
player.play();
```

> Texture sharing: the "share one asset across many players" role of the legacy `SS6Project` is now handled by the **ResourceManager plus PixiJS's global `Assets` cache** — textures at the same URL are loaded once and shared automatically.

## 3. Playback control API

Method names moved from **PascalCase to camelCase**, and some (like `SetAnimationSpeed`) became **properties (getter/setter)**.

| SS6Player | This version | Notes |
|---|---|---|
| `Setup(pack, anime)` / constructor args | `setAnimation(name, loop?)` | No pack name; anime name only |
| `Play(frameNo?)` | `play(startFrame = -1)` | `-1` = from current frame |
| `Pause()` / `Resume()` / `Stop()` | `pause()` / `resume()` / `stop()` | |
| `SetFrame(frame)` | `frame` (get/set) | Seek; subframe-capable |
| `NextFrame()` / `PrevFrame()` | `frame = frame ± 1` | Dedicated methods removed |
| `loop` (get/set, `-1` = infinite) | `loopCount` (get/set, `-1` = infinite) | Also settable via `setAnimation(name, loop)` |
| `SetAnimationSpeed(rate)` (negative = reverse) | `speedScale` (get/set, negative = reverse) | Speed multiplier |
| `SetAnimationFramerate(fps)` (deprecated) | `fps` (get/set) | Absolute fps |
| `SetAnimationSection(s, e, loops)` | `setAnimationSection(s, e)` | Loop split out to `loopCount` |
| (no direct ping-pong control) | `setPlaybackDirection(dir, style)` | Forward/Backward × Normal/PingPong |
| `SetAlpha(alpha)` | `player.alpha` (Pixi standard) | Use the standard `Container` property |
| `GetPartIndexFromName(name)` | `getPartIndexFromName(name)` | |
| `isPlaying` / `isPausing` | `isPlaying` / `isPausing` | Same names |
| `frameNo` / `totalFrame` / `fps` | `frame` / `totalFrames` / `fps` | |

```ts
// SS6Player: reverse at 2× over frames 10–30
//   player.SetAnimationSpeed(-2.0);
//   player.SetAnimationSection(10, 30, 0);

// This version:
player.speedScale = -2.0;            // negative = reverse
player.setAnimationSection(10, 30);  // section
player.loopCount = -1;               // loop count is separate
```

## 4. Events & callbacks

- **SS6Player**: registered a **single callback** via `SetUserDataCalback(fn)` / `SetPlayEndCallback(fn)` (note the legacy `Calback` spelling).
- **This version**: `on*` methods register **multiple listeners** and return an **`Unsubscribe` (`() => void`)** you call to detach. More event types are available.

| SS6Player | This version | Payload |
|---|---|---|
| `SetUserDataCalback(fn)` | `onUserData(listener)` | `SSUserDataEvent` (int/string/rect/point + partIndex/partName) |
| `SetPlayEndCallback(fn)` | `onAnimationEnd(listener)` | none (fires once every configured loop has played; never under an infinite loop count) |
| (new) | `onAnimationLoop(listener)` | none (on each loop boundary) |
| (new) | `onSignal(listener)` | `SSSignalEvent` (commandId + params) |
| (new) | `onAudio(listener)` | `SSAudioEvent` (sound cue) |

```ts
// SS6Player:
//   player.SetUserDataCalback((data) => { ... });
//   player.SetPlayEndCallback((p) => { ... });

// This version: returns an unsubscribe
const off = player.onUserData((e) => {
  if (e.partName === 'attack') { /* ... */ }
});
player.onAnimationEnd(() => { /* on end */ });
// ...
off(); // detach
```

## 5. ⚠️ Currently limited features

The following existed in SS6Player but are **not yet available**, pending API work in the **`SpriteStudio-SDK`** (Rust core). Track progress in [ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md).

| SS6Player | Status | Dependency |
|---|---|---|
| `SetPartVisible` / `SetPartVisibleByIndex` | **Not yet (planned)** | Override Layer API (SDK Phase 2) |
| `SetPartCell` / `SetPartCellByIndex` | **Not yet (planned)** | Override Layer API (SDK Phase 2) |
| `SetPartTint` / `SetPartTintByIndex` | **Not yet (planned)** | Override Layer API (SDK Phase 2) |
| `ChangeInstanceAnime` (dynamic instance swap) | **Not yet (planned)** | Instance Lifecycle API (SDK Phase 3) |

The two part-query APIs available today are below. See [Part control (visibility / cell / color)](/customize/part-overrides) for details.

```ts
player.getPartsCount();               // number of parts
player.getPartIndexFromName('body');  // part name → index
```

## 6. Other differences

- **Effect parts**: unsupported in SS6Player, **supported here** (particles simulated in WASM and drawn inline).
- **Mask / clipping**: SS6Player only meshed mask parts (no real masking); this version does **full masking** via a coverage pre-pass (toggle with `player.maskEnabled`).
- **Sound**: unsupported in SS6Player; this version integrates Web Audio (`SSWebAudioManager`) and auto-binds for `.ssab` files that contain sounds.
- **WebGPU**: in addition to WebGL, a WebGPU backend is supported (every custom shader ships both GLSL and WGSL).
- **Attaching objects to parts**: in SS6Player each part was a Pixi child, so you could read its transform via `getChildByLabel(partName)`. This version uses **batched drawing**, so that route is gone — use **part tracking** instead (`attachToPart()` drives any display object to follow a part; `getPartTransform()` reads the transform alone). See [Part tracking (following a specified part)](/customize/part-following).
- **Environment**: PixiJS v8. See [PixiJS](/usage/pixi) for details.
