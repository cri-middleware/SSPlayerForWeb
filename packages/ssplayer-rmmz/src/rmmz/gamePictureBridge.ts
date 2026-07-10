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

let _warnedNoWasm = false;

export interface SSPictureData {
  ssabUrl: string;
  animation: string;
  loop: number;
  /** Optional: turn this game switch ON whenever the animation fires a signal. */
  signalSwitch?: number;
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
    const key = `${ss.ssabUrl}|${ss.animation}`;
    if (this._ssChild && this._ssKey === key) return;
    if (this._ssChild) this._ssRemove();

    const child = new SpriteSpriteStudio();
    this._ssChild = child;
    this._ssKey = key;
    this.addChild(child as unknown as any);
    if (typeof this._pictureId === 'number') {
      const pid = this._pictureId;
      setLivePlayer(pid, child.player);
      // Drive waitForSS: mark ended when a non-looping animation finishes.
      child.player.onAnimationEnd(() => markLivePlayerEnded(pid));
    }

    if (ss.signalSwitch) {
      const switchId = ss.signalSwitch;
      child.player.onSignal(() => {
        (globalThis as any).$gameSwitches?.setValue(switchId, true);
      });
    }
    child.loadAnimation({ ssabUrl: ss.ssabUrl, animation: ss.animation, loop: ss.loop }).catch((e: unknown) => {
      console.error('[ssplayer-rmmz] failed to load SS animation:', e);
    });
  };

  Sprite_Picture.prototype._ssRemove = function (this: any): void {
    if (!this._ssChild) return;
    if (typeof this._pictureId === 'number') clearLivePlayer(this._pictureId);
    this.removeChild(this._ssChild);
    this._ssChild.destroy();
    this._ssChild = null;
    this._ssKey = null;
  };
}
