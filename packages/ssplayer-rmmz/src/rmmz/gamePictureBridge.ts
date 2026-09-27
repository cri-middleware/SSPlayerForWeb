// Game_Picture <-> Sprite_Picture bridge (spec §7.1 / §7.2).
//
// Model (Game_Picture): we stash the "which SS animation to play" data on the
// picture object itself. Game objects are serialized by MZ's save system, so the
// animation is restored automatically on load (exact frame is not persisted —
// it resumes from the start, matching the official Spine plugin's behaviour).
//
// View (Sprite_Picture): rather than monkey-patching the bitmap pipeline, we
// alias updateBitmap to (a) keep an SS-bearing picture visible even with no
// bitmap, and (b) attach / detach a Sprite_SpriteStudio as a CHILD. Being a
// child means MZ's move / scale transforms flow into the SS animation for free.

import type { ISpriteSpriteStudio } from './Sprite_SpriteStudio.js';
import { setLivePlayer, clearLivePlayer, markLivePlayerEnded } from './liveRegistry.js';
import { isWasmOk } from './boot.js';
import { SSLoadError } from './loadError.js';
import { applyPartOverrides, type SSPartOverride } from '@spritestudio/ssplayer-webgl';

let _warnedNoWasm = false;

export interface SSPictureData {
  ssabUrl: string;
  animation: string;
  loop: number;
  /** Optional: turn this game switch ON whenever the animation fires a signal. */
  signalSwitch?: number;
  /** Optional playback speed multiplier (1 = normal). Persisted for save/load. */
  speed?: number;
  /**
   * Optional per-part overrides (colour / cell / visibility). Persisted for
   * save/load and re-applied when a player mounts — the runtime's own table
   * lives on the WASM context, which does not survive a rebuild. The list's
   * policy (merge / prune / apply) lives in core's PartOverride, shared with
   * the TyranoScript adapter.
   */
  overrides?: SSPartOverride[];
}

interface GamePictureLike {
  setSSData(data: SSPictureData | null): void;
  ssData(): SSPictureData | null;
}

/**
 * Install the model accessors on Game_Picture and the attach/detach aliases on
 * Sprite_Picture. `SpriteSpriteStudio` is the class built by
 * defineSpriteSpriteStudio(). Idempotent.
 */
export function installGamePictureBridge(SpriteSpriteStudio: new () => ISpriteSpriteStudio): void {
  const g = globalThis as any;
  const Game_Picture = g.Game_Picture;
  const Sprite_Picture = g.Sprite_Picture;
  if (!Game_Picture || !Sprite_Picture) {
    console.warn('[ssplayer-rmmz] Game_Picture / Sprite_Picture not found; MVC bridge not installed.');
    return;
  }
  if (Sprite_Picture.prototype.__ssBridgeInstalled) return;
  Sprite_Picture.prototype.__ssBridgeInstalled = true;

  // --- Model ---
  Game_Picture.prototype.setSSData = function (this: any, data: SSPictureData | null): void {
    this._ssData = data;
  };
  Game_Picture.prototype.ssData = function (this: any): SSPictureData | null {
    return this._ssData || null;
  };

  // --- View ---
  const _updateBitmap = Sprite_Picture.prototype.updateBitmap;
  Sprite_Picture.prototype.updateBitmap = function (this: any): void {
    _updateBitmap.call(this);
    const picture = this.picture() as GamePictureLike | null;
    const ss = picture && picture.ssData ? picture.ssData() : null;
    if (ss) {
      this.visible = true; // keep the (possibly bitmap-less) anchor visible
      this._ssSync(ss);
    } else if (this._ssChild) {
      this._ssRemove();
    }
  };

  Sprite_Picture.prototype._ssSync = function (this: any, ss: SSPictureData): void {
    // If the WASM runtime failed to initialize (e.g. no SIMD), do NOT construct
    // an SSPlayer — that would throw "WASM not initialized". Skip quietly (the
    // boot gate already logged the reason once).
    if (!isWasmOk()) {
      if (!_warnedNoWasm) {
        _warnedNoWasm = true;
        console.warn('[ssplayer-rmmz] SS animation skipped: WASM runtime is not available.');
      }
      return;
    }
    // A failed load is thrown here, inside the frame update, because that is
    // where MZ catches its own: SceneManager stops the game and shows "Failed
    // to load" with a Retry button, as it does for a missing picture or SE.
    // Logging alone leaves the picture blank and holds any "wait for completion"
    // forever, with nothing on screen to say why.
    if (this._ssLoadError) throw this._ssLoadError;
    const key = `${ss.ssabUrl}|${ss.animation}`;
    // Same asset AND same animation: nothing to (re)build, but the model may
    // still have changed in ways that need no re-setup — see _ssApplyLive.
    // Returning outright here used to drop a loop-only or signalSwitch-only
    // change on the floor, since neither is part of the key.
    if (this._ssChild && this._ssKey === key) {
      this._ssApplyLive(ss);
      return;
    }

    // Same .ssab, only the animation changed → switch in place (no reload). This
    // keeps playback subframe-smooth and avoids re-parsing the project. A full
    // rebuild happens only when the .ssab itself changes.
    if (this._ssChild && this._ssAsset === ss.ssabUrl) {
      this._ssKey = key;
      // Reset the "ended" flag so waitForSS tracks the new animation.
      if (typeof this._pictureId === 'number') setLivePlayer(this._pictureId, this._ssChild.player);
      // No override re-application here: the context survives an in-place
      // switch, so the runtime already kept the Permanent ones and dropped the
      // rest itself (the persisted copy is pruned to match by the command that
      // changed the animation).
      try {
        this._ssChild.switchAnimation(ss.animation, ss.loop);
      } catch (e: unknown) {
        console.error('[ssplayer-rmmz] failed to switch SS animation:', e);
      }
      // switchAnimation applies the loop itself; record it so _ssApplyLive
      // does not set the same value a second time.
      this._ssLoop = ss.loop;
      this._ssApplyLive(ss);
      return;
    }

    if (this._ssChild) this._ssRemove();

    const child = new SpriteSpriteStudio();
    this._ssChild = child;
    this._ssKey = key;
    this._ssAsset = ss.ssabUrl;
    // A fresh player owns none of the live state yet. loadAnimation applies the
    // loop below, so record it up front and let _ssApplyLive handle the rest.
    this._ssLoop = ss.loop;
    this._ssSpeed = undefined;
    this._ssSignalSwitch = 0;
    this._ssSignalUnsub = null;
    this.addChild(child as unknown as any);
    if (typeof this._pictureId === 'number') {
      const pid = this._pictureId;
      setLivePlayer(pid, child.player);
      // Drive waitForSS: mark ended when a non-looping animation finishes.
      child.player.onAnimationFinished(() => markLivePlayerEnded(pid));
    }

    child
      .loadAnimation({ ssabUrl: ss.ssabUrl, animation: ss.animation, loop: ss.loop })
      // This is a fresh WASM context, so its override table starts empty. Restore
      // the picture's persisted overrides once the animation is set up (before
      // that, part names cannot resolve).
      .then(() => applyPartOverrides(child.player, ss.overrides))
      .catch((e: unknown) => {
        console.error('[ssplayer-rmmz] failed to load SS animation:', e);
        // Erased or given another .ssab while loading: nobody is waiting on it.
        if (this._ssChild !== child) return;
        const url = e instanceof SSLoadError ? e.url : ss.ssabUrl;
        // Retry drops the failed child; the next updateBitmap rebuilds it from
        // the model, overrides included, as a first mount would.
        this._ssLoadError = ['LoadError', url, () => this._ssRemove()];
      });
    this._ssApplyLive(ss);
  };

  /**
   * Apply the parts of the model that need NO animation re-setup: loop count,
   * speed, and the signal switch. Each is compared against the last value we
   * applied, because `updateBitmap` re-reads the picture every frame.
   *
   * Keeping these out of `_ssKey` is what lets a `changeSSAnimation` that only
   * alters `loop` — or a second `setSSAsPicture` that only changes
   * `signalSwitch` — take effect. Both used to be silently ignored: the key was
   * unchanged, so `_ssSync` returned before reaching them, and `signalSwitch`
   * was additionally bound once at mount and never revisited.
   */
  Sprite_Picture.prototype._ssApplyLive = function (this: any, ss: SSPictureData): void {
    const child = this._ssChild;
    if (!child) return;
    const player = child.player;

    if (this._ssLoop !== ss.loop) {
      this._ssLoop = ss.loop;
      player.loopCount = ss.loop;
    }
    if (typeof ss.speed === 'number' && this._ssSpeed !== ss.speed) {
      this._ssSpeed = ss.speed;
      player.speedScale = ss.speed;
    }

    const switchId = ss.signalSwitch || 0;
    if (this._ssSignalSwitch !== switchId) {
      this._ssSignalSwitch = switchId;
      if (this._ssSignalUnsub) {
        this._ssSignalUnsub();
        this._ssSignalUnsub = null;
      }
      if (switchId) {
        this._ssSignalUnsub = player.onSignal(() => {
          (globalThis as any).$gameSwitches?.setValue(switchId, true);
        });
      }
    }
  };

  Sprite_Picture.prototype._ssRemove = function (this: any): void {
    if (!this._ssChild) return;
    if (typeof this._pictureId === 'number') clearLivePlayer(this._pictureId);
    if (this._ssSignalUnsub) {
      this._ssSignalUnsub();
      this._ssSignalUnsub = null;
    }
    this.removeChild(this._ssChild);
    this._ssChild.destroy();
    this._ssChild = null;
    this._ssKey = null;
    this._ssAsset = null;
    this._ssLoadError = null;
    // Drop the live-state cache too: the next mount is a different player, and
    // a stale value here would make _ssApplyLive skip the call that sets it.
    this._ssLoop = undefined;
    this._ssSpeed = undefined;
    this._ssSignalSwitch = 0;
  };
}
