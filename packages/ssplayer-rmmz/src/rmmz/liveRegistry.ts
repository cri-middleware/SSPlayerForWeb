// Live-player registry: maps a picture id to its currently-mounted SSPlayer so
// plugin commands (playSS / pauseSS / stopSS) can control playback directly, and
// so the event interpreter can WAIT for an animation to finish (waitForSS).
//
// This is a RUNTIME accelerator only — the authoritative, save-persisted state
// lives on Game_Picture (see gamePictureBridge). The registry is rebuilt by the
// view whenever a Sprite_Picture (re)mounts an SS child, so it survives scene
// transitions and save/load without itself being serialized.

import type { SSPlayer, Unsubscribe } from '../SSPlayer.js';

export type SSPlayStatus = 'playing' | 'ended';

interface Entry {
  player: SSPlayer;
  ended: boolean;
  /**
   * Listener arming a follow-up animation: playSSOnce's return-to-base, or
   * playSSSequence's next entry. Held on the registry rather than captured in a
   * closure so a LATER command can cancel a chain that has not fired yet —
   * without this, `changeSSAnimation` during a one-shot is silently undone the
   * moment the one-shot ends. Mirrors `SSPlayerEntry.chain` in the TyranoScript
   * adapter, which solves the same problem for `[ss_play next=]`.
   */
  chain?: Unsubscribe;
  /** The chain is a sequence's next entry: this finish is not the end waitForSS waits for. */
  chainHoldsEnd?: boolean;
  adopt?: () => void;
  /** A command that needs the pack, held until it has loaded. */
  deferred?: () => void;
}

const entries = new Map<number, Entry>();

export function setLivePlayer(pictureId: number, player: SSPlayer, adopt?: () => void): void {
  // A (re)mount supersedes whatever the previous player had armed.
  clearLiveChain(pictureId);
  entries.set(pictureId, { player, ended: false, adopt });
}
/** The picture's model now names what its player plays: have the view sync to it without switching. */
export function adoptLivePlayer(pictureId: number): void {
  entries.get(pictureId)?.adopt?.();
}
export function clearLivePlayer(pictureId: number): void {
  clearLiveChain(pictureId);
  entries.delete(pictureId);
}

/**
 * Arm `unsub` as this picture's pending follow-up, replacing (and cancelling)
 * any earlier one. Safe to call from inside the firing listener: cancelling an
 * already-fired listener is a no-op.
 */
export function armLiveChain(pictureId: number, unsub: Unsubscribe, holdsEnd = false): void {
  const e = entries.get(pictureId);
  if (!e) {
    unsub(); // no live player to own it — don't leak the subscription
    return;
  }
  clearLiveChain(pictureId);
  e.chain = unsub;
  e.chainHoldsEnd = holdsEnd;
}

/** Cancel this picture's pending follow-up and any command held for its load. */
export function clearLiveChain(pictureId: number): void {
  const e = entries.get(pictureId);
  if (!e) return;
  e.deferred = undefined;
  e.chainHoldsEnd = false;
  if (!e.chain) return;
  const off = e.chain;
  e.chain = undefined;
  off();
}
export function getLivePlayer(pictureId: number): SSPlayer | undefined {
  return entries.get(pictureId)?.player;
}
/** Mark the picture's animation as finished (drives waitForSS). */
export function markLivePlayerEnded(pictureId: number): void {
  const e = entries.get(pictureId);
  if (e && !e.chainHoldsEnd) e.ended = true;
}
/** A command started playback again, so waitForSS has a new end to wait for. */
export function clearLivePlayerEnded(pictureId: number): void {
  const e = entries.get(pictureId);
  if (e) e.ended = false;
}
/** Hold `run` until the picture's pack has loaded, replacing a command already held. */
export function deferLiveCommand(pictureId: number, run: () => void): void {
  const e = entries.get(pictureId);
  if (e) e.deferred = run;
}
/** The picture's pack has loaded: run the command held for it, if any. */
export function runDeferredLiveCommand(pictureId: number): void {
  const e = entries.get(pictureId);
  const run = e?.deferred;
  if (!e || !run) return;
  e.deferred = undefined;
  run();
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
