// Convenience facade: re-export the engine-agnostic core so Pixi consumers
// have a single entry point and never have to depend on @spritestudio/
// ssplayer-core directly (SSAB/SSQB introspection via `ssFormat` /
// `SSRuntimeManager`, `initializeWasm`, coordinate/playback enums, etc.).
// The renderer-specific API (SSPlayer, PixiResourceManager) is exported below.
export * from '@spritestudio/ssplayer-core';

export { SSPlayer, type SSUserDataEvent, type SSSignalEvent, type SSAudioEvent, type Unsubscribe, type SSPartAttachment } from './SSPlayer.js';
export * from './PixiResourceManager.js';
