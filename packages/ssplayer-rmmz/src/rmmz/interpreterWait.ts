// "Wait for SS animation" — the MZ event equivalent of "Show Animation → Wait
// for Completion". A plugin command puts the interpreter into a custom wait mode
// ('ssplayer'); we alias Game_Interpreter.updateWaitMode to hold the event until
// the tracked picture's animation finishes.
//
// Intended for a finite loop count (1, or any n > 0). An infinite loop never
// fires onAnimationFinished, so waiting on one would block the event forever -- note
// that loopCount 0 is a synonym for infinite, not "play once".

import { getLivePlayer, getLiveStatus } from './liveRegistry.js';
import { isWasmOk } from './boot.js';

/** Install the Game_Interpreter.updateWaitMode alias. Idempotent. */
export function installInterpreterWait(): void {
  const g = globalThis as any;
  const Game_Interpreter = g.Game_Interpreter;
  if (!Game_Interpreter || Game_Interpreter.prototype.__ssWaitInstalled) return;
  Game_Interpreter.prototype.__ssWaitInstalled = true;

  const _updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
  Game_Interpreter.prototype.updateWaitMode = function (this: any): boolean {
    if (this._waitMode === 'ssplayer') {
      const id = this._ssWaitPictureId;
      const pic = g.$gameScreen ? g.$gameScreen.picture(id) : null;
      const hasData = !!(pic && pic.ssData && pic.ssData());
      const status = getLiveStatus(id);
      // Keep waiting while the animation is still loading (data present, not yet
      // mounted) or playing. Stop when it ended, or the picture/anim was removed.
      // Without the runtime no player ever mounts, so there is nothing to wait
      // for: the game runs on with SS disabled rather than freezing the event.
      if (hasData && isWasmOk() && status !== 'ended') return true;
      this._waitMode = '';
      this._ssWaitPictureId = null;
      return false;
    }
    if (this._waitMode === 'ssplayerTrackFade') {
      // A fade runs on the live player's clock only; once the player is gone,
      // its clock stopped or paused, or the fade done, nothing is left to wait
      // for — a paused picture would otherwise hold the event for good.
      const player = getLivePlayer(this._ssWaitPictureId);
      const ip = player?.internalPlayer;
      if (ip && ip.isTicking && !ip.isHeld && player!.getTrackFadeProgress(this._ssWaitTrack) !== undefined) return true;
      this._waitMode = '';
      this._ssWaitPictureId = null;
      this._ssWaitTrack = null;
      return false;
    }
    return _updateWaitMode.call(this);
  };
}

/** Put `interpreter` into the SS wait mode for `pictureId`. */
export function beginSSWait(interpreter: any, pictureId: number): void {
  interpreter._ssWaitPictureId = pictureId;
  interpreter.setWaitMode('ssplayer');
}

/** Hold `interpreter` until the fade on `track` of `pictureId` completes. */
export function beginSSTrackFadeWait(interpreter: any, pictureId: number, track: number): void {
  interpreter._ssWaitPictureId = pictureId;
  interpreter._ssWaitTrack = track;
  interpreter.setWaitMode('ssplayerTrackFade');
}
