export * from '@spritestudio/ssplayer-core';
export {
  SSCanvasPlayer,
  type SSCanvasPlayerOptions,
  type SSUserDataEvent,
  type SSSignalEvent,
  type SSAudioEvent,
  type Unsubscribe,
} from './SSCanvasPlayer.js';
export { SSWebGLRenderer } from './SSWebGLRenderer.js';
export { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
// Optional Web Audio adapter (tree-shakeable; not pulled in unless imported).
export { SSWebAudioManager } from './SSWebAudioManager.js';
