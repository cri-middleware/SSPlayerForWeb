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
| §4 | Cold-start steps (mock → core+geometry → shader → plugin iface) | ⚠️ Code done; §4.1 in-MZ mock (Z-order / filter sanity) not verified |
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

### R2 — In-MZ visual verification (§4.1) — **not yet confirmed**
No confirmed real-runtime render check exists. Validate inside an actual MZ
project:
- Z-order correctness vs characters and other pictures.
- Screen flash / tint / `Sprite` filters wrap SS without corruption (state
  restore is correct).
- Blend modes (Add / Multiply / Screen) and PartsColor (混色) match SpriteStudio.
- Mask parts and the 13 SS special shaders render as in `ssplayer-pixi`.
Build the §4.1 "red square" ObjectRenderer mock first to isolate Z-order/filter
from geometry, then the full animation.

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

### R8 — Tests & CI
Unit tests cover only `splitBitmapUrl` and `rmmzGlobals`. No coverage for the MVC
bridge, boot gate, wait-mode, or lip-sync (all monkey-patch MZ globals — testable
with a jsdom MZ stub). Package is `private` (no npm publish); distribution is the
`pack` zip via GitHub Releases — publish CI intentionally deferred, consistent
with the repo-wide release strategy.
