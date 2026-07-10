// Live-player registry: maps a picture id to its currently-mounted SSPlayer so
// plugin commands (playSS / pauseSS / stopSS) can control playback directly, and
// so the event interpreter can WAIT for an animation to finish (waitForSS).
//
// This is a RUNTIME accelerator only — the authoritative, save-persisted state
// lives on Game_Picture (see gamePictureBridge). The registry is rebuilt by the
// view whenever a Sprite_Picture (re)mounts an SS child, so it survives scene
// transitions and save/load without itself being serialized.

import type { SSPlayer } from '../SSPlayer.js';

export type SSPlayStatus = 'playing' | 'ended';

interface Entry {
  player: SSPlayer;
  ended: boolean;
}

const entries = new Map<number, Entry>();

export function setLivePlayer(pictureId: number, player: SSPlayer): void {
  entries.set(pictureId, { player, ended: false });
}
export function clearLivePlayer(pictureId: number): void {
  entries.delete(pictureId);
}
export function getLivePlayer(pictureId: number): SSPlayer | undefined {
  return entries.get(pictureId)?.player;
}
/** Mark the picture's animation as finished (drives waitForSS). */
export function markLivePlayerEnded(pictureId: number): void {
  const e = entries.get(pictureId);
  if (e) e.ended = true;
}
/**
 * Playback status for waitForSS: 'playing' while mounted and not finished,
 * 'ended' once its (non-looping) animation reached the end, or undefined when no
 * player is mounted for this id.
 */
export function getLiveStatus(pictureId: number): SSPlayStatus | undefined {
  const e = entries.get(pictureId);
  if (!e) return undefined;
  return e.ended ? 'ended' : 'playing';
}
