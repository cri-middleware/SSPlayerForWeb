import { describe, it, expect, vi, beforeEach } from 'vitest';

// Players binding the same `.ssab` from the same URL share one runtime resource
// rather than a copy each: the runtime keeps everything it derives from a pack
// on the resource, so a copy per player multiplied that by the player count.
//
// What the sharing must never do is hand a player bytes other than its own. A
// file changed under the same URL, or bytes bound without a URL, get a pack of
// their own; and a shared pack outlives every player but the last one holding
// it.
//
// Runs against a fake runtime, as the neighbouring suites do. The fake keeps
// each pack's bytes in a stand-in for WASM memory, where the runtime keeps them,
// because that is what the sharing compares new bytes against.

const memory = { buffer: new ArrayBuffer(1 << 16) } as WebAssembly.Memory;
let nextPtr = 8;
const runtime = { constructed: 0, freed: 0 };

vi.mock('../wasm/ssruntime.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../wasm/ssruntime.js')>()),
    SSRuntimeResource: class {
        ptr: number;
        len: number;
        constructor(data: Uint8Array) {
            runtime.constructed++;
            this.ptr = nextPtr;
            this.len = data.length;
            new Uint8Array(memory.buffer, this.ptr, this.len).set(data);
            nextPtr += data.length;
        }
        free() {
            runtime.freed++;
        }
    },
    // Bound to a pack only to ask where its bytes are (SharedPacks).
    SSRuntimeContext: class {
        bound: { ptr: number; len: number } | null = null;
        bind_resource(resource: { ptr: number; len: number }) {
            this.bound = resource;
            return true;
        }
        get_ssab_buf() { return this.bound!.ptr; }
        get_ssab_len() { return this.bound!.len; }
        free() {}
    },
}));

vi.mock('../src/SSRuntimeManager.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getWasmMemory: () => memory,
}));

const { InternalPlayerBase } = await import('../src/InternalPlayerBase.js');
const { SSRuntimeManager } = await import('../src/SSRuntimeManager.js');
const { resolveInstancePacks } = await import('../src/PackResolver.js');

/** A pack: the "SSAB" file identifier, then `fill`. */
function pack(fill: number): Uint8Array {
    const bytes = new Uint8Array(64).fill(fill);
    bytes.set(new TextEncoder().encode('SSAB'), 4);
    return bytes;
}

function makePlayer() {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const player = Object.create(InternalPlayerBase.prototype) as any;
    let bound: { ptr: number; len: number } | null = null;
    player.runtimeManager = {
        context: {
            get_ssab_buf: () => bound?.ptr ?? 0,
            get_ssab_len: () => bound?.len ?? 0,
            stop: vi.fn(),
        },
        bindResource: (resource: { raw: { ptr: number; len: number } }) => { bound = resource.raw; },
        destroy: vi.fn(),
    };
    player._ssabResource = null;
    player._instancePackResources = new Map();
    player._instanceChildren = new Map();
    player._effectChildren = new Map();
    player._isChildPlayer = false;
    player._audioManager = null;
    player._destroyed = false;
    return player;
    /* eslint-enable @typescript-eslint/no-explicit-any */
}

beforeEach(() => {
    runtime.constructed = 0;
    runtime.freed = 0;
    // Both read the .ssab's FlatBuffers; the fake bytes are not one.
    vi.spyOn(SSRuntimeManager, 'extractTexturePaths').mockReturnValue([]);
    vi.spyOn(SSRuntimeManager, 'extractAnimationNames').mockReturnValue(['walk']);
});

describe('binding a pack from a URL', () => {
    it('shares the runtime resource with a player holding the same bytes', () => {
        const a = makePlayer();
        const b = makePlayer();
        a.bindResource(pack(1), 'packs/same.ssab');
        b.bindResource(pack(1), 'packs/same.ssab');

        expect(runtime.constructed).toBe(1);
        expect(b._ssabResource).toBe(a._ssabResource);
        expect(b.animationNames).toEqual(['walk']);
    });

    it('builds a pack of its own when the file under the URL has changed', () => {
        const a = makePlayer();
        const b = makePlayer();
        a.bindResource(pack(1), 'packs/changed.ssab');
        b.bindResource(pack(2), 'packs/changed.ssab');

        expect(runtime.constructed).toBe(2);
        expect(b._ssabResource).not.toBe(a._ssabResource);
    });

    it('does not share bytes bound without a URL', () => {
        const a = makePlayer();
        const b = makePlayer();
        a.bindResource(pack(1));
        b.bindResource(pack(1));

        expect(runtime.constructed).toBe(2);
    });

    it('frees a shared pack with the last player holding it, and not before', () => {
        const a = makePlayer();
        const b = makePlayer();
        a.bindResource(pack(3), 'packs/freed.ssab');
        b.bindResource(pack(3), 'packs/freed.ssab');

        a.destroy();
        expect(runtime.freed).toBe(0);
        expect(b._ssabResource.raw).not.toBeNull();

        b.destroy();
        expect(runtime.freed).toBe(1);

        // Nothing holds it any more, so the next bind builds it afresh.
        makePlayer().bindResource(pack(3), 'packs/freed.ssab');
        expect(runtime.constructed).toBe(2);
    });

    it('keeps the pack a player rebinds from the URL it already holds', () => {
        const a = makePlayer();
        a.bindResource(pack(4), 'packs/rebound.ssab');
        const first = a._ssabResource;
        a.bindResource(pack(4), 'packs/rebound.ssab');

        expect(a._ssabResource).toBe(first);
        expect(runtime.constructed).toBe(1);
        expect(runtime.freed).toBe(0);
    });
});

describe('resolving the packs instance parts play', () => {
    // Two players' root packs, each with an instance part playing `sub.ssab`.
    function resolveFor(provider: ((name: string, hash: number) => Uint8Array | null) | null) {
        const into = new Map();
        return resolveInstancePacks({ rootSsab: pack(9), assetBaseUrl: 'packs', provider, resourceManager: null, into })
            .then(() => into);
    }

    beforeEach(() => {
        vi.spyOn(SSRuntimeManager, 'extractPackInfo').mockReturnValue({ hash: 1, name: 'root' });
        // A fresh list per call: the resolver consumes it as its queue.
        vi.spyOn(SSRuntimeManager, 'extractInstancePackRefs').mockImplementation(() => [{ hash: 2, name: 'sub' }]);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(pack(5))));
    });

    it('shares a pack fetched from the same URL with the same bytes', async () => {
        const first = await resolveFor(null);
        const second = await resolveFor(null);

        expect(runtime.constructed).toBe(1);
        expect(second.get(2)).toBe(first.get(2));
    });

    it('does not share the bytes a provider supplies', async () => {
        await resolveFor(() => pack(5));
        await resolveFor(() => pack(5));

        expect(runtime.constructed).toBe(2);
    });
});
