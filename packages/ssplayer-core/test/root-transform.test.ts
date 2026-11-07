import { describe, it, expect, vi } from 'vitest';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { GeometryBuilder } from '../src/GeometryBuilder.js';

// flipX / flipY / offsetX / offsetY are folded into what the player DRAWS rather
// than onto the host object's transform, which gives them two consumers that have
// to agree: the renderer, which applies getRootAffine() to the geometry (as the
// root context's parent matrix in PixiJS, or composed into the draw transform in
// WebGL / MZ), and getPartTransform(), which reports where a part ended up so an
// attached object can follow it. If those ever drift apart, every follower
// silently detaches from its part the moment the player is flipped — which is
// what most of this file is here to prevent.
//
// Only the runtime manager is faked: the root affine is pure arithmetic and the
// part matrix is read through the manager, so no WASM is needed. The player is
// still built with `new` rather than Object.create — the defaults it starts at
// are half of what is under test here, and they come from field initialisers.
vi.mock('../src/SSRuntimeManager.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/SSRuntimeManager.js')>()),
    SSRuntimeManager: class { },
}));

type Affine = ArrayLike<number>;

/** [m00, m01, m10, m11, tx, ty] applied to a point — the layout the core uses. */
function apply(m: Affine, x: number, y: number): [number, number] {
    return [m[0] * x + m[1] * y + m[4], m[2] * x + m[3] * y + m[5]];
}

function det(m: Affine): number {
    return m[0] * m[3] - m[1] * m[2];
}

const SAMPLE_POINTS: [number, number][] = [
    [0, 0], [1, 0], [0, 1], [12, -30], [-7.5, 2.25], [640, 480],
];

/** Give the player `parts`, addressable by name and index, each with a world matrix. */
function makePlayer(parts: Record<string, { index: number; world: number[] }>) {
    const byIndex = new Map<number, number[]>();
    for (const p of Object.values(parts)) byIndex.set(p.index, p.world);
    const partCount = Math.max(...byIndex.keys()) + 1;

    const player = new DirectInternalPlayer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any).runtimeManager = {
        context: { find_part_index: (name: string) => parts[name]?.index ?? -1 },
        getPartsCount: () => partCount,
        getWorldMatrix2D: (index: number, out?: Float32Array) => {
            const r = out ?? new Float32Array(6);
            r.set(byIndex.get(index)!);
            return r;
        },
    };
    return player;
}

// A part sitting off the origin on both axes and rotated a little, so a flip
// about either axis actually moves it (a part at the origin would mirror onto
// itself and prove nothing). Every value is exact in Float32, so the matrices
// below can be compared for equality rather than approximately.
const HAND = [0.75, -0.5, 0.5, 0.75, 120, -48];
// A part that is ALREADY mirrored in the animation — negative determinant before
// the player flips anything. Not a contrived case: mirrored parts are common in
// real assets.
const MIRRORED = [-1, 0, 0, 1, 40, 10];

describe('root affine resolution', () => {
    it('is null while flip and offset are at their defaults', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        expect(player.flipX).toBe(false);
        expect(player.flipY).toBe(false);
        expect(player.offsetX).toBe(0);
        expect(player.offsetY).toBe(0);
        // Null rather than an identity matrix on purpose: it is what lets the
        // renderers keep handing the geometry builder a null parent matrix, so
        // an untouched player costs exactly what it did before this existed.
        expect(player.getRootAffine()).toBeNull();
    });

    it('negates only the flipped axis', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });

        player.flipX = true;
        expect(Array.from(player.getRootAffine()!)).toEqual([-1, 0, 0, 1, 0, 0]);

        player.flipX = false;
        player.flipY = true;
        expect(Array.from(player.getRootAffine()!)).toEqual([1, 0, 0, -1, 0, 0]);

        player.flipX = true;
        expect(Array.from(player.getRootAffine()!)).toEqual([-1, 0, 0, -1, 0, 0]);
    });

    it('carries the offset in the translation, unmirrored by a flip', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        player.offsetX = 30;
        player.offsetY = -12;
        expect(Array.from(player.getRootAffine()!)).toEqual([1, 0, 0, 1, 30, -12]);

        // The offset is applied AFTER the flip (p' = S*p + O), so flipping does
        // not send the artwork off in the other direction.
        player.flipX = true;
        player.flipY = true;
        expect(Array.from(player.getRootAffine()!)).toEqual([-1, 0, 0, -1, 30, -12]);
    });

    it('goes back to null when every component is returned to its default', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        player.flipX = true;
        player.offsetY = 5;
        expect(player.getRootAffine()).not.toBeNull();

        player.flipX = false;
        player.offsetY = 0;
        expect(player.getRootAffine()).toBeNull();
    });
});

describe('getPartTransform under a root transform', () => {
    it('reports the part unchanged while there is no root transform', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        expect(Array.from(player.getPartTransform('hand')!)).toEqual(HAND);
    });

    it('agrees with the geometry path — the invariant followers depend on', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        player.flipX = true;
        player.offsetX = 25;
        player.offsetY = -8;

        const reported = player.getPartTransform('hand')!;
        const root = player.getRootAffine()!;

        // The renderer transforms a vertex by the part's world matrix and THEN
        // by the root affine. A follower is placed by `reported` alone. For the
        // follower to land on the part, the two have to agree for every point.
        // Compared approximately: the composed matrix is rounded to Float32 on
        // its way through the array, which the two-step form is not.
        for (const [x, y] of SAMPLE_POINTS) {
            const [wx, wy] = apply(HAND, x, y);
            const viaGeometry = apply(root, wx, wy);
            const viaReported = apply(reported, x, y);
            expect(viaReported[0]).toBeCloseTo(viaGeometry[0], 3);
            expect(viaReported[1]).toBeCloseTo(viaGeometry[1], 3);
        }
    });

    it('composes exactly as the renderers do', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        player.flipY = true;
        player.offsetX = 3;

        // Same call the WebGL renderer makes to fold the root affine into its
        // draw transform, and the same one PixiJS's instance recursion uses.
        const expected = GeometryBuilder.composeAffine(
            player.getRootAffine()!,
            new Float32Array(HAND),
        );
        expect(Array.from(player.getPartTransform('hand')!)).toEqual(Array.from(expected));
    });

    it('resolves a part by index as well as by name', () => {
        const player = makePlayer({ hand: { index: 2, world: HAND } });
        player.flipX = true;
        expect(Array.from(player.getPartTransform(2)!)).toEqual(
            Array.from(player.getPartTransform('hand')!),
        );
    });

    it('writes into `out` and returns it, so following allocates nothing', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        player.flipX = true;

        const out = new Float32Array(6);
        const r = player.getPartTransform('hand', out);
        // Composed in place over `out` — the caller's buffer, not a fresh one.
        expect(r).toBe(out);
        expect(out[0]).toBe(-HAND[0]);
        expect(out[4]).toBe(-HAND[4]);
    });

    it('still reports an unknown part as null', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        player.flipX = true;
        expect(player.getPartTransform('nope')).toBeNull();
        expect(player.getPartTransform(9)).toBeNull();
    });
});

describe('mirroring composes rather than being set', () => {
    // Whether a part is mirrored is
    // the PRODUCT of the mirroring already in the animation and the player's
    // flip, so two mirrorings cancel. Code must not infer the sign from "the
    // player is flipped" — these pin the behaviour that makes that true.
    it('flipping an already-mirrored part cancels back to a proper basis', () => {
        const player = makePlayer({ arm: { index: 0, world: MIRRORED } });
        expect(det(player.getPartTransform('arm')!)).toBeLessThan(0);

        player.flipX = true;
        expect(det(player.getPartTransform('arm')!)).toBeGreaterThan(0);
    });

    it('flipping an unmirrored part mirrors it', () => {
        const player = makePlayer({ hand: { index: 0, world: HAND } });
        expect(det(player.getPartTransform('hand')!)).toBeGreaterThan(0);

        player.flipX = true;
        expect(det(player.getPartTransform('hand')!)).toBeLessThan(0);
    });
});
