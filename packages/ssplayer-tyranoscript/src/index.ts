// @spritestudio/ssplayer-tyranoscript
//
// A thin TyranoScript / TyranoBuilder adapter over `@spritestudio/ssplayer-webgl`
// (`SSPlayer`). All GPU/WebGL work lives in the webgl package; this layer
// is pure glue: it registers `[ss_*]` KAG custom tags that mount an SS character
// onto a Tyrano layer and drive playback (see README.md / ROADMAP.md).
//
// This entry point is side-effect-free: it exposes `registerSSTags()` and types
// but does NOT auto-register, so importing it outside TyranoScript is safe. The
// drop-in `main.js` build (src/plugin.ts) self-registers on load.

export { registerSSTags, getRegistry, __resetStateForTest } from './registerTags.js';
export {
  clearChain,
  PlayerRegistry,
  type SSCharaBinding,
  type SSNextAnime,
  type SSPlayerEntry,
} from './PlayerRegistry.js';
export {
  persistGlobalState,
  persistPlayers,
  readGlobalState,
  readSavedPlayers,
  SAVE_KEY,
  SAVE_STATE_KEY,
  type SavedPlayer,
  type SSGlobalState,
} from './SaveLoadBridge.js';
export { TyranoAudioManager, type TyranoAudioOptions } from './TyranoAudioManager.js';
export {
  boxOrigin,
  cancelElementFade,
  createCharacterElement,
  getLayerElement,
  setElementVisible,
  toTransform,
  type LayerPage,
} from './LayerCanvas.js';
export {
  attachTalkHooks,
  currentSpeaker,
  speakerMatches,
  type TalkHooks,
} from './CharaTalkBridge.js';
export type {
  TyranoGlobal,
  TyranoKag,
  TyranoFtag,
  TyranoMasterTag,
  TyranoChara,
  TyranoConfig,
  TyranoStat,
  TyranoVariable,
  TyranoLayer,
  JQueryLike,
  JQueryResult,
} from './tyranoTypes.js';
