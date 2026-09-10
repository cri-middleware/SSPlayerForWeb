// Separate entry point (`@spritestudio/ssplayer-core/audio`) for the Web Audio
// adapter, so importing the package index never drags it in: a build with no
// sound pays nothing for it, and `ssplayer-webgl` can reach it through a
// dynamic `import()` and keep its `./lite` build audio-free.
export { SSWebAudioManager, type SSAudioKey, type AudioBindablePlayer } from './SSWebAudioManager.js';
