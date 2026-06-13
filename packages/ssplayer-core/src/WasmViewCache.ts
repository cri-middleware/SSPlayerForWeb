type AnyTypedArray =
    | Int8Array | Uint8Array | Uint8ClampedArray
    | Int16Array | Uint16Array
    | Int32Array | Uint32Array
    | Float32Array | Float64Array;

interface TypedArrayCtor<T extends AnyTypedArray> {
    new (buffer: ArrayBufferLike, byteOffset: number, length: number): T;
}

/**
 * Caches one zero-copy TypedArray view per logical WASM buffer so the render hot
 * path allocates nothing in steady state, while staying correct across WASM
 * memory growth.
 *
 * Each entry is keyed by a stable string and validated against the view's OWN
 * `buffer` / `byteOffset` / `length` on every access:
 *
 *  - `WebAssembly.Memory.prototype.grow()` preserves contents but detaches the
 *    old `ArrayBuffer` and installs a new one. A detached view reports
 *    `byteOffset`/`length` of 0, but the `buffer === current` check fails first
 *    (and short-circuits), so we rebuild over the new buffer — reading the
 *    preserved data correctly.
 *  - A runtime-side realloc that moves the region (same buffer, new offset) or
 *    resizes it (new length) is caught by the offset/length checks.
 *
 * Because the memory buffer identity is process-global, a grow triggered by ANY
 * runtime context invalidates every cached view here on its next access — which
 * is what makes holding views across an instance-child recursion safe.
 *
 * The view points at live WASM memory; the runtime overwrites that region each
 * frame and the reused view reads through to the current data. Only the JS view
 * object is cached — never a snapshot of the data.
 */
export class WasmViewCache {
    private readonly getMemory: () => WebAssembly.Memory;
    private readonly slots: Map<string, AnyTypedArray> = new Map();

    constructor(getMemory: () => WebAssembly.Memory) {
        this.getMemory = getMemory;
    }

    view<T extends AnyTypedArray>(key: string, ptr: number, len: number, ctor: TypedArrayCtor<T>): T {
        const buffer = this.getMemory().buffer;
        const cached = this.slots.get(key) as T | undefined;
        if (cached !== undefined && cached.buffer === buffer && cached.byteOffset === ptr && cached.length === len) {
            return cached;
        }
        const fresh = new ctor(buffer, ptr, len);
        this.slots.set(key, fresh);
        return fresh;
    }

    /** Drop all cached views (e.g. on teardown or when switching animations). */
    clear(): void {
        this.slots.clear();
    }
}
