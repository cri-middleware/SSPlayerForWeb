; ssplayer-tyranoscript plugin loader (§4.1)
;
; Loaded by [plugin name="ssplayer"] from first.ks. `main.js` is the built
; IIFE bundle (packages/ssplayer-tyranoscript/dist/browser/main.js), which on load
; self-registers the [ss_*] custom tags onto TYRANO.kag.ftag.master_tag. It is
; NOT an ES module, so load it WITHOUT type="module".
;
; Run `pnpm --filter tyranoscript-example run sync:plugin` to copy the freshly built
; main.js + ssruntime_bg.wasm into this folder (both are git-ignored build
; artefacts — see the example README).
[loadjs storage="plugin/ssplayer/main.js"]
[return]
