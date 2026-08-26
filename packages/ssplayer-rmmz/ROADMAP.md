# @spritestudio/ssplayer-rmmz Roadmap

RPG Maker MZ (PixiJS v5) player for the SpriteStudio-SDK. Cold-start spec:
[`../../SSPLAYER_RMMZ_SPEC.md`](../../SSPLAYER_RMMZ_SPEC.md). Project-wide roadmap:
[`../../ROADMAP.md`](../../ROADMAP.md).

This file records **how much of the cold-start spec is implemented** and **what
remains**. It is derived from a section-by-section audit of `src/` against the
spec (2026-07-11).

## Architecture note (spec deviation, intentional)

The spec (§0/§2.1/§3) described drawing SS geometry **inside the Pixi pipeline**
via `PIXI.Geometry` + `PIXI.Shader.from(...)`, with rmmz owning the vertex
layout, fan indices (`[0,1,4, 1,3,4, 3,2,4, 2,0,4]`), blend-mode mapping and the
PartsColor shader.

The actual implementation instead **delegates all drawing to
`ssplayer-webgl`'s `SSWebGLRenderer`** (raw GL against MZ's shared context),
mirroring how `ssplayer-tyranoscript` rides the webgl package. `SSPlayerRenderer` is a
thin `PIXI.ObjectRenderer` that flushes Pixi's batch, calls
`SSWebGLRenderer.render(...)`, then restores Pixi's cached GL state
Effekseer-style. Consequence: the spec's §3.1–§3.3 (vertex attributes, fan index
generation, `PIXI.BLEND_MODES` mapping, PartsColor GLSL) are satisfied **by the
webgl package**, not re-implemented here. This is a deliberate design choice
(keeps all GPU difficulty in one place); the spec text is superseded on this
point, not "unimplemented."

## Spec coverage

| Spec § | Item | Status |
| --- | --- | --- |
| §1 | Package `@spritestudio/ssplayer-rmmz`, `tsdown` build | ✅ Done (dep is `ssplayer-webgl`, which re-exports core; pixi.js peer) |
| §2.1 | `SSPlayerRenderer` ObjectRenderer, WebGL-state protection | ✅ Done (full `texture/geometry/state/shader/framebuffer.reset()`) |
| §2.2 | `SSPlayer` extends `PIXI.Container`, `_render` → `setObjectRenderer` | ✅ Done |
| §3.1–3.3 | Vertex layout / fan indices / blend map / PartsColor shader | ✅ Done **in `ssplayer-webgl`** (delegated; see note above) |
| §4 | Cold-start steps (mock → core+geometry → shader → plugin iface) | ⚠️ Code done; §4.1 Z-order verified in real MZ (see R2), filter/blend sanity still open |
| §5 | v8↔v5 API translation, WebGL-state protection | ✅ Done |
| §7.1 | Model/View split (`Game_Picture.setSSData/ssData`) | ✅ Done |
| §7.2 | Attach as CHILD of `Sprite_Picture` (no monkey-patch of updateBitmap internals) | ✅ Done (aliases `updateBitmap`, adds `Sprite_SpriteStudio` child) |
| §7.3 | No private Ticker; driven from host `Sprite.update()` | ✅ Done (`MS_PER_FRAME` step) |
| §7.4 | DI: `RMMZResourceManager` (image via `ImageManager`) | ✅ Done |
| §7.4 | DI: `RMMZAudioManager` (SE via `AudioManager`) | ✅ Done — bound on SS child mount in `Sprite_SpriteStudio` (`loopNum` still ignored; default SE volume/pitch/pan) |
| §8.1 | IIFE single-file plugin build | ✅ Done (`dist/browser/ssplayer-rpgmakermz.js`) |
| §8.2 | WASM approach A (external `.wasm` beside plugin) | ✅ Done (`getSelfScriptDir()`) |
| §8.2 | WASM approach B (inline base64) | ❌ Not done (optional) — see R5 |
| §8.3 | `Scene_Boot.isReady` gate on WASM init | ✅ Done |
| §9.1 | Bilingual annotation (`/*:` + `/*:ja`) | ✅ Done |
| §9.2 | Annotation survives bundling (prepend script) | ✅ Done (`scripts/prepend-annotation.mjs`) |
| §10.1 | Explicit `destroy()` → free WASM on scene change | ✅ Done |
| §10.2 | Coordinate/anchor absorption (picture anchor, char foot-origin) | ⚠️ Partial — `worldTransform × resolution` + flipY only; no explicit anchor/foot-origin handling, unverified — see R4 |
| §10.3 | Signal → MZ event bridge (switch on signal) | ✅ Done (single `signalSwitch` per picture; richer param mapping not exposed) |

### Beyond spec (implemented extras)

Plugin commands not in the spec but shipped: `changeSSAnimation`, `setSSSpeed`,
`playSSOnce` (one-shot → auto-return to base loop), `playSSSequence`,
`waitForSS` (+ `Game_Interpreter.updateWaitMode` integration), and `setSSTalk` /
`clearSSTalk` lip-sync (drives talk/idle off `Window_Message`). Live-player
registry (`liveRegistry.ts`) backs the imperative commands.

## Remaining work

### R1 — Wire `RMMZAudioManager` into the plugin path (§7.4) — ✅ **FIXED**
`Sprite_SpriteStudio` now constructs an `RMMZAudioManager` and calls
`bindToPlayer(this.player)` at mount (before any `loadAnimation`), and
unsubscribes on `destroy()`. SS `onAudio` events reach MZ's `AudioManager`.
Follow-ups still open:
- Expose a plugin param for default SE volume/pitch/pan (currently 90/100/0).
- `loopNum` (looping SE) is still ignored (see `RMMZAudioManager` header) — route
  looped sounds to a channel we own, or document the limitation.

### R2 — In-MZ visual verification (§4.1) — **partly confirmed**

Confirmed in a real RPG Maker MZ runtime (Steam build's bundled NW.js 0.51 /
Chromium 88, driven headlessly from a throwaway copy of `SampleProject`):

- The plugin registers, the WASM boot gate releases, the `.ssab` loads and the
  animation advances and loops in step with MZ's frame loop. No console errors.
- **Z-order vs map characters is correct.** Verified by pixel, not by eye: a
  solid picture and the SS animation were placed on the same anchor and the
  framebuffer was sampled from a `postrender` hook — over the player sprite the
  SS reads back as the animation's own colour, exactly as the native picture
  reads back as its own. (Eyeballing a screenshot is misleading here: characters
  standing just outside the silhouette look like they are in front.)
- **Environment facts worth not rediscovering:** MZ's NW.js serves the game from
  `chrome-extension://`, *not* `file://`, so `fetch` works and `Utils.isLocal()`
  is false. `WebAssembly` SIMD is unavailable on Chromium 88, which is exactly
  why this package ships the scalar runtime and passes `requireSimd: false` —
  now confirmed against the real engine rather than assumed.

Still unverified:
- Screen flash / tint / `Sprite` filters wrap SS without corruption (state
  restore is correct).
- Blend modes (Add / Multiply / Screen) and PartsColor (混色) match SpriteStudio.
- Mask parts and the 13 SS special shaders render as in `ssplayer-pixi`.

### R9 — Playback-command fixes (found by the R2 in-MZ run) — ✅ **FIXED**

Three defects, each reproduced in real MZ before the fix and re-run after:

- **A pending `playSSOnce` revert outlived the command that superseded it.**
  `onAnimationFinished` is a player-level event, so the queued return-to-base fired at
  the end of *whatever* was playing by then: `playSSOnce` followed by
  `changeSSAnimation` to a finite animation snapped back to the old base as soon
  as the new animation ended. The follow-up listener now lives on the live
  registry (`armLiveChain` / `clearLiveChain`) so any later playback command can
  cancel it — the discipline `ssplayer-tyranoscript` already applies to
  `[ss_play next=]`. Same fix covers `playSSSequence`.
- **A loop-only change was ignored.** `_ssKey` is `asset|animation`, so
  `changeSSAnimation` that altered nothing but `loop` produced the same key and
  `_ssSync` returned before applying it. Properties that need no animation
  re-setup (loop, speed, `signalSwitch`) moved into `_ssApplyLive`, called on
  every path. `signalSwitch` was additionally bound once at mount and never
  revisited; it is now rebound when it changes and unsubscribed on removal.
- **The lip-sync swap dropped part overrides.** Setting up an animation makes the
  runtime discard every non-Permanent override, and `messageTalk` re-asserts the
  animation on every message — so a tinted portrait lost its tint on its first
  line. The swap is a transient decoration the author never asked for, so it now
  re-applies the picture's persisted overrides, matching what the TyranoScript
  adapter does in `[ss_chara]`.

### R3 — Character (map/battler) attach path (§7.1 mentions `Game_Character`)
Only the `Game_Picture` ↔ `Sprite_Picture` bridge is implemented. Attaching SS to
`Sprite_Character` (map events/party) or battlers is not done. Requires the
foot-origin absorption from R4.

### R4 — Coordinate / anchor absorption (§10.2)
Current transform is `worldTransform × renderer.resolution` + flipY only. There is
no explicit reconciliation of MZ's picture anchor (top-left vs center) or the
character foot-origin against SpriteStudio's own origin. Verify picture-anchor
alignment and add origin handling before the R3 character path.

### R5 — WASM approach B: inline base64 (§8.2, optional)
Only approach A (external `ssruntime_bg.wasm` beside the plugin) is implemented.
A single-file "just drop the `.js`" variant (base64-embedded WASM) is offered by
the spec as an alternative for maximum install simplicity. Not started.

### R6 — Annotation help references a non-existent WASM param — ✅ **FIXED**
The setup step in `plugin-annotation.js` (EN + JA) no longer tells users to set a
"WASM Path" / 「WASMパス」 parameter; it now states the WASM auto-loads from beside
the plugin `.js` (via `getSelfScriptDir()` / `document.currentScript`), matching
actual behaviour. (A real `@param wasmPath` honoring an override, with
`getSelfScriptDir()` as fallback, remains a possible future enhancement.)

### R7 — Richer signal → event bridge (§10.3)
`signalSwitch` only turns a single switch ON for any signal. Consider mapping
signal `commandId` / params to specific switches or variables (e.g. set a variable
from a signal param), matching the "アニメ演出に合わせてイベント進行" goal.

### R8 — Tests & CI — **deferred by decision**
Unit tests cover only `splitBitmapUrl` and `rmmzGlobals`. No coverage for the MVC
bridge, boot gate, wait-mode, or lip-sync (all monkey-patch MZ globals — testable
with a jsdom MZ stub). **A jsdom MZ stub was proposed and declined (2026-07-31):**
regressions here are guarded by running the real engine instead (see R2), which
is what caught every defect in R9 and R11. Package is `private` (no npm publish);
distribution is the `pack` zip via GitHub Releases — publish CI intentionally
deferred, consistent with the repo-wide release strategy.

### R10 — One texture upload per picture, not per pack
Each picture builds its own `RMMZResourceManager`, so two pictures showing the
same `.ssab` upload the same atlas twice, and re-showing a picture uploads it
again. MZ's `ImageManager` caches the `Bitmap`, so this is GL-side duplication
on top of a cache that already did its job.

Wants a manager shared per `(gl, ssabUrl)` with **reference counting** — and the
refcount is the whole difficulty, not an optimisation on top: `ssplayer-pixi`
shipped shared textures whose `destroy()` unloaded them globally and pulled them
out from under every other player still drawing. Do not land the sharing without
the counting.

### R11 — Adapter state that the core already held — ✅ **FIXED**
A review of what this package was keeping its own copy of (PRs #42 / #43):

- The whole `.ssab` was retained **per picture** so `getAnimationNames()` could
  re-parse it on demand. The core caches the names when the pack is bound;
  the bytes are transient now.
- `attachToPart` was written out here and in `ssplayer-pixi` with the same
  attachment record, hide-tracking and detach ordering. `SSPartFollower` in core
  owns that; this package keeps only the five lines that write onto a Pixi v5
  object.
- The part-override list is still (correctly) owned by `Game_Picture` — it is
  written before a player is mounted and outlives every rebuild — but the
  three-step dance around it is `SSPartOverrideStore` now, which is what the R9
  lip-sync defect came out of.
