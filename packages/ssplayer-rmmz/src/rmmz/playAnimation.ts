// Put an animation on a picture's track 0 and play it, cutting or crossfading.
// Shared by every path that switches animation, so a `transition` time means
// the same thing in changeSSAnimation, playSSOnce, playSSSequence and the talk
// swap.

import type { SSPlayer } from '../SSPlayer.js';

/**
 * Switch `player` to `animation` with loop count `loop`, and leave it playing.
 * At `transitionMs <= 0` this cuts, as `setAnimation` does; above 0 it
 * crossfades from what is on screen over that many milliseconds.
 *
 * Returns whether it set another animation up, which makes the runtime drop
 * every part override but the Permanent ones and fold its stack back to track
 * 0. A crossfade does neither, and nor does cutting to the animation already
 * set up, so a caller keeping a saved copy of either prunes it only on true.
 */
export function playAnimation(player: SSPlayer, animation: string, loop: number, transitionMs = 0): boolean {
  // An unknown name cuts, so setAnimation's warning and fallback to the first
  // animation apply here too; a crossfade would only throw.
  if (!(transitionMs > 0) || !player.getAnimationNames().includes(animation)) {
    const before = player.currentAnimation;
    player.setAnimation(animation);
    player.loopCount = loop;
    player.play();
    return player.currentAnimation !== before;
  }
  player.crossfade(0, animation, transitionMs);
  player.loopCount = loop;
  // The incoming animation plays from the moment it is laid, but only while
  // the character's clock runs. play() would also restart the effects and
  // instances, so it starts a stopped clock and nothing else; a held one is
  // released, since a switch always leaves the picture playing.
  if (player.internalPlayer.runtimeManager.context.is_clock_playing()) {
    player.resume();
  } else {
    player.play();
  }
  return false;
}
