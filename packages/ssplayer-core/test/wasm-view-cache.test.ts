import { describe, it, expect } from 'vitest';
import { WasmViewCache } from '../src/WasmViewCache.js';

// A stand-in for WebAssembly.Memory whose `buffer` can be swapped to simulate
// `memory.grow()` (which detaches the old ArrayBuffer and installs a new one).
function makeMemory(initial: ArrayBuffer) {
    let buf = initial;
    const mem = { get buffer() { return buf; } } as unknown as WebAssembly.Memory;
    return { mem, grow: (next: ArrayBuffer) => { buf = next; } };
}

describe('WasmViewCache', () => {
    it('reuses the same view object when ptr/len/buffer are unchanged', () => {
        const { mem } = makeMemory(new ArrayBuffer(64));
        const cache = new WasmViewCache(() => mem);
        const a = cache.view('m', 0, 4, Float32Array);
        const b = cache.view('m', 0, 4, Float32Array);
        expect(b).toBe(a); // no reallocation in steady state
    });

    it('reads live values through the reused view', () => {
        const buffer = new ArrayBuffer(64);
        const { mem } = makeMemory(buffer);
        const cache = new WasmViewCache(() => mem);
        const writer = new Float32Array(buffer);
        writer[0] = 1.5; writer[1] = -2.25;
        expect(Array.from(cache.view('m', 0, 2, Float32Array))).toEqual([1.5, -2.25]);
        // The runtime overwriting memory is reflected through the same view.
        writer[0] = 9;
        expect(cache.view('m', 0, 2, Float32Array)[0]).toBe(9);
    });

    it('rebuilds over the new buffer after a simulated grow', () => {
        const first = new ArrayBuffer(64);
        const { mem, grow } = makeMemory(first);
        const cache = new WasmViewCache(() => mem);
        new Float32Array(first)[0] = 1;
        const a = cache.view('m', 0, 1, Float32Array);
        expect(a[0]).toBe(1);

        // grow() preserves contents into a new, larger buffer.
        const second = new ArrayBuffer(128);
        new Float32Array(second)[0] = 1;
        grow(second);

        const b = cache.view('m', 0, 1, Float32Array);
        expect(b).not.toBe(a);         // fresh view object
        expect(b.buffer).toBe(second); // over the new buffer
        expect(b[0]).toBe(1);          // preserved data
    });

    it('rebuilds when the offset changes (runtime realloc within the same buffer)', () => {
        const { mem } = makeMemory(new ArrayBuffer(64));
        const cache = new WasmViewCache(() => mem);
        const a = cache.view('m', 0, 2, Float32Array);
        const b = cache.view('m', 8, 2, Float32Array);
        expect(b).not.toBe(a);
        expect(b.byteOffset).toBe(8);
    });

    it('rebuilds when the length changes', () => {
        const { mem } = makeMemory(new ArrayBuffer(64));
        const cache = new WasmViewCache(() => mem);
        const a = cache.view('m', 0, 2, Float32Array);
        const b = cache.view('m', 0, 4, Float32Array);
        expect(b).not.toBe(a);
        expect(b.length).toBe(4);
    });

    it('keeps independent slots per key', () => {
        const { mem } = makeMemory(new ArrayBuffer(64));
        const cache = new WasmViewCache(() => mem);
        const a = cache.view('a', 0, 2, Float32Array);
        const b = cache.view('b', 8, 2, Float32Array);
        expect(cache.view('a', 0, 2, Float32Array)).toBe(a);
        expect(cache.view('b', 8, 2, Float32Array)).toBe(b);
        expect(a).not.toBe(b);
    });

    it('produces the requested typed-array type and reads correctly', () => {
        const buffer = new ArrayBuffer(64);
        const { mem } = makeMemory(buffer);
        const cache = new WasmViewCache(() => mem);
        new Int32Array(buffer)[0] = -7;
        new Uint16Array(buffer, 8)[0] = 65535;
        const i = cache.view('i', 0, 1, Int32Array);
        const u = cache.view('u', 8, 1, Uint16Array);
        expect(i).toBeInstanceOf(Int32Array);
        expect(i[0]).toBe(-7);
        expect(u).toBeInstanceOf(Uint16Array);
        expect(u[0]).toBe(65535);
    });

    it('clear() forces a rebuild on next access', () => {
        const { mem } = makeMemory(new ArrayBuffer(64));
        const cache = new WasmViewCache(() => mem);
        const a = cache.view('m', 0, 2, Float32Array);
        cache.clear();
        const b = cache.view('m', 0, 2, Float32Array);
        expect(b).not.toBe(a);
    });
});
