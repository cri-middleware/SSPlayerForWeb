import type { SSPlayer } from '../SSPlayer.js';

export type SSPlayheadState = 'playing' | 'paused' | 'ended';

export interface SSPlayhead {
  animation: string;
  frame: number;
  state: SSPlayheadState;
}

/** `heldEnded`: the run was restored as ended, which `stop()` leaves without `isFinished`. */
export function readPlayhead(player: SSPlayer, heldEnded = false): SSPlayhead {
  let state: SSPlayheadState;
  if (player.isFinished || (heldEnded && !player.isPlaying)) state = 'ended';
  else if (player.isPlaying && !player.isPausing) state = 'playing';
  else state = 'paused';
  return { animation: player.currentAnimation, frame: player.frameNo, state };
}

/** Starting playback rewinds, so the seek has to follow `play()`, `pause()` or `stop()`. */
export function applyPlayhead(player: SSPlayer, playhead: SSPlayhead): boolean {
  if (player.currentAnimation !== playhead.animation) return false;
  if (playhead.state === 'ended') player.stop();
  else if (playhead.state === 'paused') player.pause();
  player.frameNo = playhead.frame;
  return true;
}
