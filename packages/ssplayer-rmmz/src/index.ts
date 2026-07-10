// @spritestudio/ssplayer-rmmz
//
// RPG Maker MZ (PixiJS v5) renderer + plugin glue for the SpriteStudio-SDK
// player. This ESM entry is side-effect-free: importing it does NOT register any
// plugin or touch MZ globals, so it's safe in bundlers / tests. The drop-in
// runtime plugin (src/plugin.ts) self-registers on load and is built as a
// separate IIFE bundle.

// Convenience facade: re-export the engine-agnostic core + webgl surface so
// consumers get a single entry point (initializeWasm, DirectInternalPlayer,
// SSWebGLRenderer, ssFormat, enums, ...).
export * from '@spritestudio/ssplayer-webgl';

// Layer 3 (renderer).
export {
  SSPlayer,
  type SSUserDataEvent,
  type SSSignalEvent,
  type SSAudioEvent,
  type Unsubscribe,
} from './SSPlayer.js';
export {
  SSPlayerRenderer,
  registerSSPlayerRenderer,
  SSPLAYER_PLUGIN_NAME,
} from './SSPlayerRenderer.js';

// Layer 4 (RMMZ glue) — safe to import; they only touch MZ globals when called.
export { RMMZResourceManager, splitBitmapUrl } from './rmmz/RMMZResourceManager.js';
export { RMMZAudioManager, type RMMZAudioOptions } from './rmmz/RMMZAudioManager.js';
export { defineSpriteSpriteStudio, type SSViewSpec, type ISpriteSpriteStudio } from './rmmz/Sprite_SpriteStudio.js';
export { installGamePictureBridge, type SSPictureData } from './rmmz/gamePictureBridge.js';
export { installWasmBootGate, isWasmReady, isWasmOk } from './rmmz/boot.js';
export {
  getLivePlayer,
  setLivePlayer,
  clearLivePlayer,
  getLiveStatus,
  markLivePlayerEnded,
  type SSPlayStatus,
} from './rmmz/liveRegistry.js';
export { installInterpreterWait, beginSSWait } from './rmmz/interpreterWait.js';
export { isMZ, getMZGl, getMZRenderer } from './rmmzGlobals.js';
