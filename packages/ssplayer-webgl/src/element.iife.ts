// Self-registering entry for classic <script> / CDN use. Dropping this bundle on a
// page defines <ss-player> immediately — no JS to call. Bundler/ESM users should
// instead `import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element'`
// and call it themselves, keeping the element tree-shakeable (see element.ts).
//
// WASM URL (classic <script> has no import.meta.url to self-locate the runtime):
//   • simplest — put it once on THIS script tag as `data-wasm`, wired below to a
//     page-wide default, so every <ss-player> can omit its own `wasm` attribute:
//       <script src="ss-player.element.min.js" data-wasm="…/ssruntime_bg.wasm"></script>
//   • or set it in JS: SSWebGLPlayerElement.setSSPlayerWasmUrl('…/ssruntime_bg.wasm')
//   • or per element: <ss-player wasm="…/ssruntime_bg.wasm" …> (wins over the default)
import { defineSSPlayerElement, setSSPlayerWasmUrl } from './element.js';

const script = document.currentScript as HTMLScriptElement | null;
const dataWasm = script?.dataset?.wasm;
if (dataWasm) setSSPlayerWasmUrl(dataWasm);

defineSSPlayerElement();

export { defineSSPlayerElement, setSSPlayerWasmUrl, SSPlayerElement } from './element.js';
