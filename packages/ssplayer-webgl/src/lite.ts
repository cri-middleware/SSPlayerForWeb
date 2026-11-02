// Minimal entry point: the same renderer, surface and player, without SSOverlay,
// the shared texture cache and the Web Audio adapter in the export list.
export * from '@spritestudio/ssplayer-core';
export { SSSurface, type SSSurfaceOptions } from './SSSurface.js';
export { SSPlayer, type SSPlayerOptions, type SSPlayerBox } from './SSPlayer.js';
export { SSWebGLRenderer } from './SSWebGLRenderer.js';
export { SSWebGLResourceManager } from './SSWebGLResourceManager.js';
