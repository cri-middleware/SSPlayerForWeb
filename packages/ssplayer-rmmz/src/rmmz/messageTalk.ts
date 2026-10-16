// Lip-sync ("talking character"): a picture is bound to a SPEAKER NAME (the
// message name box, $gameMessage.speakerName()). While a message whose speaker
// matches is OPEN — from when it starts until the player advances/closes it —
// that picture plays its "talk" animation; every other bound picture (and
// everyone once the window closes) plays "idle". So in a multi-character scene
// only the character whose message is showing talks. Mirrors the RenPy
// SSCharacter pattern (talk is tied to that Character's say).
//
// NOTE: talk lasts the whole message (through the post-print input wait), not
// only while the text types — that reads as "this character is speaking now".
//
// Bindings live in a runtime registry keyed by pictureId (set/cleared by the
// setSSTalk / clearSSTalk plugin commands). Playback is driven imperatively on
// the live SSPlayer, exactly like playSSOnce — the picture's _ssData base loop
// is left untouched, so a save/load mid-message resumes the base animation.

import { applyPartOverrides, applySavedTracks } from '@spritestudio/ssplayer-webgl';
import { getLivePlayer } from './liveRegistry.js';
import { playAnimation } from './playAnimation.js';

interface TalkBinding {
  /** Speaker name to match against $gameMessage.speakerName(). "" = unnamed messages. */
  name: string;
  talk: string;
  idle: string;
  /** Crossfade between talk and idle over this many ms; 0 cuts. */
  transition: number;
}

const bindings = new Map<number, TalkBinding>();

/**
 * Bind a picture as a talking portrait for speaker `name` (the message name box;
 * "" matches unnamed messages). Plays `talk` while that speaker's message prints,
 * `idle` otherwise, crossfading between them over `transition` ms (0 cuts).
 */
export function setSSTalk(pictureId: number, name: string, talk: string, idle: string, transition = 0): void {
  bindings.set(pictureId, { name, talk, idle, transition });
}

/** Remove a picture's talk binding (leaves whatever animation is playing). */
export function clearSSTalk(pictureId: number): void {
  bindings.delete(pictureId);
}

/**
 * Drive the talk/idle swap. When `printing`, only the picture bound to the
 * CURRENT speaker plays talk; all other bound pictures play idle. When not
 * printing (text finished / window closed), every bound picture plays idle.
 *
 * Called every frame while a message prints (from the updateMessage alias), so
 * it must be idempotent AND self-correcting: it compares against the player's
 * ACTUAL current animation, not a cached value. That way, if the picture's
 * async .ssab load resolves mid-message and re-asserts the base animation (which
 * would otherwise clobber `talk` with a one-frame flash), the very next frame
 * puts `talk` back. Pictures whose .ssab is still loading are skipped and retried.
 */
function apply(printing: boolean): void {
  const g = globalThis as any;
  const speaker: string = g.$gameMessage && g.$gameMessage.speakerName ? g.$gameMessage.speakerName() : '';
  for (const [pid, b] of bindings) {
    const player = getLivePlayer(pid);
    if (!player || player.getAnimationNames().length === 0) continue; // not loaded yet → retry
    const desired = printing && b.name === speaker ? b.talk : b.idle;
    if (player.currentAnimation === desired) continue; // already playing it — don't restart
    // A cut sets the animation up, which makes the runtime drop every override
    // but the Permanent ones. Here the author never asked for an animation
    // change — the swap is a transient decoration over whatever the scenario
    // last set — so the picture's persisted overrides go straight back on, or
    // a tinted portrait would lose its tint on its very first line. (playSSOnce
    // and changeSSAnimation deliberately do NOT do this: there the author
    // asked, and the saved copy is pruned to match what the runtime discarded.)
    // The same goes for the tracks setSSTrack laid, which a cut folds away. A
    // crossfade keeps both, so there is nothing to put back.
    const ss = g.$gameScreen?.picture(pid)?.ssData?.();
    try {
      if (playAnimation(player, desired, -1, b.transition)) {
        applyPartOverrides(player, ss?.overrides);
        applySavedTracks(player, ss?.tracks);
      }
    } catch (e: unknown) {
      console.error('[ssplayer-rmmz] setSSTalk: failed to switch:', e);
    }
  }
}

/**
 * Alias Window_Message so text printing drives the talk/idle swap. Idempotent;
 * a no-op if bound before Window_Message exists (called at plugin boot).
 */
export function installMessageTalk(): void {
  const g = globalThis as any;
  const WM = g.Window_Message;
  if (!WM || WM.prototype.__ssTalkInstalled) return;
  WM.prototype.__ssTalkInstalled = true;

  const _startMessage = WM.prototype.startMessage;
  WM.prototype.startMessage = function (this: any): void {
    _startMessage.call(this);
    apply(true); // begin printing -> talk
  };

  // Re-assert talk every frame while text is printing. This is what makes it
  // robust to the async .ssab load resolving after the message opens (the load's
  // deferred base-animation re-play would otherwise leave the portrait stuck on
  // idle). updateMessage returns true while still printing; keep that contract.
  const _updateMessage = WM.prototype.updateMessage;
  WM.prototype.updateMessage = function (this: any): boolean {
    const printing = _updateMessage.call(this);
    if (printing) apply(true);
    return printing;
  };

  // Idle only when the message actually ADVANCES/CLOSES — not merely when the
  // text finishes typing. This keeps the portrait "speaking" through the
  // post-print input wait, until the player sends the message on.
  const _terminateMessage = WM.prototype.terminateMessage;
  WM.prototype.terminateMessage = function (this: any): void {
    _terminateMessage.call(this);
    apply(false); // message closed -> idle
  };
}
