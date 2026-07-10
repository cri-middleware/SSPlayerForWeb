; ssplayer-tyrano plugin loader (§4.1)
;
; This is the canonical distribution template for the hand-written-scenario
; plugin. Ship this folder as `data/others/plugin/ssplayer/` in a TyranoScript
; project, alongside the built `main.js` and `ssruntime_bg.wasm` (added by
; `pnpm --filter @spritestudio/ssplayer-tyrano run pack`).
;
; `main.js` is the IIFE bundle that self-registers the [ss_*] custom tags on
; load. It is NOT an ES module — load it without type="module".
[loadjs storage="plugin/ssplayer/main.js"]
[return]
