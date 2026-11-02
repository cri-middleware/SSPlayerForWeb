; ssplayer-tyranoscript plugin loader
;
; This is the canonical distribution template for the plugin. Ship this folder
; as `data/others/plugin/ssplayer/` in a TyranoScript project, alongside the
; built `main.js` and `ssruntime_bg.wasm` (added by
; `pnpm --filter @spritestudio/ssplayer-tyranoscript run pack`).
;
; A scenario reaches all of this with one line — `[plugin name="ssplayer"]` —
; which TyranoScript expands into a [call] of this file, the same way its other
; character plugins are loaded.
;
; `main.js` is the IIFE bundle that self-registers the [ss_*] custom tags on
; load. It is NOT an ES module — load it without type="module". [loadjs] waits
; for the script to finish executing before advancing, so [ss_init] below is
; guaranteed to find the tags registered.
[loadjs storage="plugin/ssplayer/main.js"]

; Start the animation runtime here rather than making every scenario do it. The
; path is fixed relative to this folder, so there is nothing for an author to
; get right. [ss_init] applies its audio settings before it checks whether the
; runtime is already up, so a scenario that wants different sound routing just
; calls it again — e.g. [ss_init audio="false"] — without re-loading the wasm.
[ss_init wasm="others/plugin/ssplayer/ssruntime_bg.wasm"]
[return]
