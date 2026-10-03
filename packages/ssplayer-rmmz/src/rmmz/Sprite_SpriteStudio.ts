// Sprite_SpriteStudio — the RPG Maker MZ "view" that hosts one SSPlayer.
//
// It is created as a CHILD of an existing MZ sprite (e.g. Sprite_Picture), so
// MZ's move / scale / (rotation) transforms flow into the SS animation for free.
// It carries NO private timer: MZ's Sprite.update() recurses into
// its children, so our `update()` is called once per MZ frame and simply steps
// the player — keeping SS time perfectly synced with the game.
//
// Defined via a factory because it extends the MZ global `Sprite`, which only
// exists inside the running game; the ESM barrel must stay import-safe outside
// MZ, so plugin.ts calls this with the real `Sprite` at load time.

import { SSPlayer, type Unsubscribe } from '../SSPlayer.js';
import { RMMZAudioManager } from './RMMZAudioManager.js';
import type { GL } from '../rmmzGlobals.js';

// One logical MZ frame ≈ 1/60 s. SSPlayer.update converts ms → SS frames via the
// animation's own fps, so passing a fixed 60fps tick keeps SS in lock-step with
// MZ's fixed-timestep scene loop.
const MS_PER_FRAME = 1000 / 60;

export interface SSViewSpec {
  ssabUrl: string;
  animation: string;
  loop?: number;
}

export interface ISpriteSpriteStudio {
  readonly player: SSPlayer;
  loadAnimation(spec: SSViewSpec): Promise<void>;
  switchAnimation(animation: string, loop?: number): void;
  update(): void;
  destroy(options?: unknown): void;
}

/**
 * Build the Sprite_SpriteStudio class against the host `SpriteBase` (MZ's
 * global `Sprite`). Returns the class constructor.
 */
export function defineSpriteSpriteStudio(SpriteBase: any): new (gl?: GL) => ISpriteSpriteStudio {
  return class Sprite_SpriteStudio extends SpriteBase implements ISpriteSpriteStudio {
    public readonly player: SSPlayer;
    private _spec: SSViewSpec | null = null;
    private _loadToken = 0;
    private _audioUnsub: Unsubscribe;

    constructor(gl?: GL) {
      super();
      this.player = new SSPlayer(gl);
      this.addChild(this.player as unknown as any);
      // Route SS sound parts through MZ's AudioManager. Bound here —
      // BEFORE any loadAnimation/setAnimation — so preload runs through us too.
      this._audioUnsub = new RMMZAudioManager().bindToPlayer(this.player);
    }

    /** (Re)load and start an animation. Safe to call again to switch anims. */
    public async loadAnimation(spec: SSViewSpec): Promise<void> {
      this._spec = spec;
      const token = ++this._loadToken;
      await this.player.load(spec.ssabUrl);
      if (token !== this._loadToken) return; // superseded by a newer load
      this.player.setAnimation(spec.animation);
      this.player.loopCount = spec.loop ?? -1;
      this.player.play();
    }

    /**
     * Switch to another animation WITHOUT reloading the .ssab (the project is
     * already loaded). Synchronous — the pack's assets came in with
     * loadAnimation, so this is only a runtime reset and playback stays
     * subframe-smooth. Use loadAnimation when the .ssab itself changes.
     */
    public switchAnimation(animation: string, loop = -1): void {
      if (this._spec) this._spec = { ...this._spec, animation, loop };
      // Nothing awaits below, so no load can slip in between: bump the token so a
      // load still in flight does not overwrite this switch when it lands.
      this._loadToken += 1;
      this.player.setAnimation(animation);
      this.player.loopCount = loop;
      this.player.play();
    }

    public get spec(): SSViewSpec | null {
      return this._spec;
    }

    // Called by MZ's Sprite.update() child-recursion once per frame. We do NOT
    // call super.update() (that would recurse into the SSPlayer child and invoke
    // its arg-less update()); instead we step the player with an explicit delta.
    public update(): void {
      this.player.update(MS_PER_FRAME);
    }

    // Explicitly free WASM memory now rather than waiting for GC.
    public destroy(options?: unknown): void {
      this._audioUnsub();
      this.player.destroy();
      super.destroy(options as any);
    }
  };
}
