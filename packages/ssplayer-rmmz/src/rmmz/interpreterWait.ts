// "Wait for SS animation" — the MZ event equivalent of "Show Animation → Wait
// for Completion". A plugin command puts the interpreter into a custom wait mode
// ('ssplayer'); we alias Game_Interpreter.updateWaitMode to hold the event until
// the tracked picture's animation finishes.
//
// Intended for a finite loop count (1, or any n > 0). An infinite loop never
// fires onAnimationFinished, so waiting on one would block the event forever -- note
// that loopCount 0 is a synonym for infinite, not "play once".

import { getLiveStatus } from './liveRegistry.js';

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
      if (hasData && status !== 'ended') return true;
      this._waitMode = '';
      this._ssWaitPictureId = null;
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
