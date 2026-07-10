// @spritestudio/ssplayer-tyrano
//
// A thin TyranoScript / TyranoBuilder adapter over `@spritestudio/ssplayer-webgl`
// (`SSCanvasPlayer`). All GPU/WebGL work lives in the webgl package; this layer
// is pure glue: it registers `[ss_*]` KAG custom tags that mount an SS canvas
// onto a Tyrano layer and drive playback (see README.md / ROADMAP.md).
//
// This entry point is side-effect-free: it exposes `registerSSTags()` and types
// but does NOT auto-register, so importing it outside TyranoScript is safe. The
// drop-in `main.js` build (src/plugin.ts) self-registers on load.

export { registerSSTags, getRegistry, __resetStateForTest } from './registerTags.js';
export { PlayerRegistry, type SSPlayerEntry } from './PlayerRegistry.js';
export {
  persistPlayers,
  readSavedPlayers,
  SAVE_KEY,
  type SavedPlayer,
} from './SaveLoadBridge.js';
export { TyranoAudioManager, type TyranoAudioOptions } from './TyranoAudioManager.js';
export {
  createLayerCanvas,
  getLayerElement,
  toTransform,
  type LayerPage,
  type LayerCanvasResult,
} from './LayerCanvas.js';
export type {
  TyranoGlobal,
  TyranoKag,
  TyranoFtag,
  TyranoMasterTag,
  TyranoConfig,
  TyranoStat,
  TyranoVariable,
  TyranoLayer,
  JQueryLike,
  JQueryResult,
} from './tyranoTypes.js';
