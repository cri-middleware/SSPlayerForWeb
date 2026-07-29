export * from '@spritestudio/ssplayer-core';
export { SSSurface, type SSSurfaceOptions } from './SSSurface.js';
export {
  SSPlayer,
  type SSPlayerOptions,
  type SSPlayerBox,
  type SSUserDataEvent,
  type SSSignalEvent,
  type SSAudioEvent,
  type Unsubscribe,
} from './SSPlayer.js';
export { SSWebGLRenderer } from './SSWebGLRenderer.js';
export { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
// Optional Web Audio adapter (tree-shakeable; not pulled in unless imported).
export { SSWebAudioManager } from './SSWebAudioManager.js';
