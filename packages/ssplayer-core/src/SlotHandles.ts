import { SSRuntimeInstanceSlot, SSRuntimeEffectSlot, finalizationRegistry } from './SSRuntimeManager.js';

/**
 * Owning JS handle for a WASM `SSRuntimeInstanceSlot`. `destroy()` frees the
 * WASM handle and cancels the GC finalizer; the FinalizationRegistry is a
 * safety net for handles that are dropped without an explicit `destroy()`.
 */
export class InstanceSlotHandle {
    public raw: SSRuntimeInstanceSlot;

    constructor() {
        this.raw = SSRuntimeInstanceSlot.create();
        finalizationRegistry.register(this, this.raw, this);
    }

    public destroy() {
        if (this.raw) {
            finalizationRegistry.unregister(this);
            this.raw.free();
            // @ts-ignore
            this.raw = null;
        }
    }
}

/**
 * Owning JS handle for a WASM `SSRuntimeEffectSlot` (one effect part's particle
 * simulation). Same lifecycle contract as {@link InstanceSlotHandle}.
 */
export class EffectSlotHandle {
    public raw: SSRuntimeEffectSlot;

    constructor(resourceRaw: any, hash: number, seed: number) {
        this.raw = SSRuntimeEffectSlot.create(resourceRaw, hash, seed);
        finalizationRegistry.register(this, this.raw, this);
    }

    public destroy() {
        if (this.raw) {
            finalizationRegistry.unregister(this);
            this.raw.free();
            // @ts-ignore
            this.raw = null;
        }
    }
}
