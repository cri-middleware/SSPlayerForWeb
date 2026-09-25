import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as flatbuffers from 'flatbuffers';

// The runtime parses a pack without verifying it, so a buffer that is not a
// `.ssab` at all has to be stopped before it reaches the runtime, not after.
// The extractors in SSRuntimeManager check the identifier too, but they run on
// bytes the runtime already holds; this pins the gate to the constructor that
// hands bytes over.

const constructed = vi.fn();
vi.mock('../wasm/ssruntime.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../wasm/ssruntime.js')>()),
    SSRuntimeResource: class {
        constructor(data: Uint8Array) {
            constructed(data);
        }
        free() {}
    },
}));

const { SSABResource } = await import('../src/SSRuntimeManager.js');

function withIdentifier(identifier: string): Uint8Array {
    const b = new flatbuffers.Builder(16);
    b.startObject(0);
    b.finish(b.endObject(), identifier);
    return b.asUint8Array();
}

describe('SSABResource', () => {
    beforeEach(() => constructed.mockClear());

    it('refuses bytes without the "SSAB" identifier before the runtime sees them', () => {
        for (const bytes of [new Uint8Array(0), new Uint8Array(7), withIdentifier('SSQB'), new TextEncoder().encode('<html>404</html>')]) {
            expect(() => new SSABResource(bytes)).toThrow(/Not a \.ssab buffer.*"SSAB"/);
        }
        expect(constructed).not.toHaveBeenCalled();
    });

    it('hands a buffer carrying the identifier to the runtime', () => {
        const bytes = withIdentifier('SSAB');
        const resource = new SSABResource(bytes);
        expect(constructed).toHaveBeenCalledWith(bytes);
        resource.destroy();
    });
});
