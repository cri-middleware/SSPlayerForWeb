import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaskTreePlanner, type MaskTreeVisitor } from '../src/MaskTree.js';
import { FrameDataRaw } from '../src/FrameDataRaw.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';
import { MASK_FLAG_MASK_INFLUENCE, MASK_FLAG_MASK_WRITE } from '../src/MaskComposition.js';

// MaskTreePlanner reaches the runtime only through the frame's draw order and
// batches, the part states, the manager's static tables and the instance
// children, so it runs against fakes without booting WASM. The instance part's
// alpha is the one read that goes straight to the FlatBuffer bytes, so that
// is spied instead.

const MI = MASK_FLAG_MASK_INFLUENCE;
const CLIP = MASK_FLAG_MASK_WRITE;

interface BatchDesc { kind: number; parts: number[]; flags?: number; }
interface CtxDesc {
    batches: BatchDesc[];
    /** Static mask flags per part index. */
    flags?: Record<number, number>;
    /** Per-frame mask value (default 255). */
    mask?: Record<number, number>;
    /** Instance children by part index. */
    children?: Record<number, { ctx: FakePlayer; visible?: boolean }>;
}
interface FakePlayer { runtimeManager: unknown; getInstanceChild(p: number): unknown; getDrawFrame(): number; }

/** A player whose draw order is its batches' parts, concatenated. */
function makePlayer(d: CtxDesc): FakePlayer {
    const order: number[] = [];
    const batches = d.batches.map(b => {
        const startRank = order.length;
        order.push(...b.parts);
        return { kind: () => b.kind, startRank: () => startRank, count: () => b.parts.length, flags: () => b.flags ?? 0, textureHash: () => 0 };
    });
    const n = Math.max(0, ...order) + 1;
    const maskFlags = new Uint8Array(n);
    for (const [p, f] of Object.entries(d.flags ?? {})) maskFlags[Number(p)] = f;
    const frameData = {
        drawOrderArray: () => Uint16Array.from(order),
        drawBatchesLength: () => batches.length,
        drawBatches: (i: number) => batches[i],
        parts: (p: number) => ({ mask: () => d.mask?.[p] ?? 255, hide: () => false }),
    };
    const children = new Map<number, unknown>();
    for (const [p, c] of Object.entries(d.children ?? {})) {
        children.set(Number(p), { visible: c.visible ?? true, player: c.ctx, parentMatrix: new Float32Array(6) });
    }
    return {
        runtimeManager: {
            getFrameData: () => frameData,
            getPartMaskFlags: () => maskFlags,
            getShapeVertexCounts: () => new Int32Array(n),
            getMeshVertexOffsets: () => new Uint32Array(n + 1),
            getMeshIndexOffsets: () => new Int32Array(n + 1),
            getWorldMatrix2D: (_p: number, out: Float32Array) => { out.set([1, 0, 0, 1, 0, 0]); return out; },
        },
        getInstanceChild: (p: number) => children.get(p),
        getDrawFrame: () => 0,
    };
}

/** Plan the tree under `root`, recording which player each writer came from. */
function plan(root: FakePlayer, capacity?: number) {
    const tree = new MaskTreePlanner<any>(capacity);
    const owners: FakePlayer[] = [];
    const visitor: MaskTreeVisitor<any> = {
        beginContext: () => {},
        writer: (player, _fd, planner, w, index) => { owners[index] = player; void planner.partIdx[w]; },
    };
    const fd = (root.runtimeManager as { getFrameData(): unknown }).getFrameData();
    tree.plan(root as any, fd as any, null, visitor);
    const writers = Array.from({ length: tree.count }, (_, i) => ({
        owner: owners[i], open: tree.open[i], close: tree.close[i],
        opInvert: tree.opInvert[i], isClipping: tree.isClipping[i],
    }));
    return { tree, writers, seq: (p: FakePlayer) => Array.from(tree.seqOf(p as any) ?? []).slice(0, (p.runtimeManager as any).getFrameData().drawOrderArray().length) };
}

beforeEach(() => { vi.spyOn(FrameDataRaw.prototype, 'partAlphaOf').mockReturnValue(1); });
afterEach(() => { vi.restoreAllMocks(); });

describe('MaskTreePlanner', () => {
    it('gives a pure mask the start of its animation to itself, and clipping itself to the end', () => {
        // ranks: 0 part, 1 part, 2 mask, 3 part, 4 clipping writer, 5 part
        const root = makePlayer({
            batches: [
                { kind: DrawBatchKind.Normal, parts: [1, 2] },
                { kind: DrawBatchKind.Mask, parts: [3], flags: 0x01 },
                { kind: DrawBatchKind.Normal, parts: [4, 5, 6] },
            ],
            flags: { 5: CLIP | MI },
        });
        const { writers, seq } = plan(root);
        expect(seq(root)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(writers).toEqual([
            { owner: root, open: -1, close: 2, opInvert: 1, isClipping: 0 },
            { owner: root, open: 4, close: -1, opInvert: 1, isClipping: 1 },
        ]);
    });

    it('numbers a sub-animation right after its instance part', () => {
        // root: A, I(→ child), B      child: M(mask), C(clipping), D
        const child = makePlayer({
            batches: [
                { kind: DrawBatchKind.Mask, parts: [1], flags: 0x01 },
                { kind: DrawBatchKind.Normal, parts: [2, 3] },
            ],
            flags: { 2: CLIP | MI },
        });
        const root = makePlayer({
            batches: [
                { kind: DrawBatchKind.Normal, parts: [1] },
                { kind: DrawBatchKind.Instance, parts: [2] },
                { kind: DrawBatchKind.Normal, parts: [3] },
            ],
            flags: { 2: MI },
            children: { 2: { ctx: child } },
        });
        const { writers, seq } = plan(root);
        expect(seq(root)).toEqual([0, 1, 5]);
        expect(seq(child)).toEqual([2, 3, 4]);
        // The pure mask closes inside the instance (from the instance part to
        // itself); the clipping writer runs on past it, into the caller.
        expect(writers).toEqual([
            { owner: child, open: 1, close: 2, opInvert: 1, isClipping: 0 },
            { owner: child, open: 3, close: -1, opInvert: 1, isClipping: 1 },
        ]);
    });

    it('takes a writer\'s op from its own instance part only, one level', () => {
        // root → I1 (mask_influence 0) → mid → I2 (mask_influence 1) → leaf.
        // mid's writer is under an opted-out instance part: increment. leaf's
        // writer is under an opted-in one: invert, though an ancestor opted out.
        const leaf = makePlayer({ batches: [{ kind: DrawBatchKind.Normal, parts: [1] }], flags: { 1: CLIP | MI } });
        const mid = makePlayer({
            batches: [
                { kind: DrawBatchKind.Normal, parts: [1] },
                { kind: DrawBatchKind.Instance, parts: [2] },
            ],
            flags: { 1: CLIP | MI, 2: MI },
            children: { 2: { ctx: leaf } },
        });
        const root = makePlayer({
            batches: [{ kind: DrawBatchKind.Instance, parts: [1] }],
            flags: { 1: 0 },
            children: { 1: { ctx: mid } },
        });
        const { writers, seq } = plan(root);
        expect(seq(root)).toEqual([0]);
        expect(seq(mid)).toEqual([1, 2]);
        expect(seq(leaf)).toEqual([3]);
        expect(writers.map(w => [w.owner, w.opInvert, w.open])).toEqual([[mid, 0, 1], [leaf, 1, 3]]);
    });

    it('skips a child whose slot is not playing', () => {
        const child = makePlayer({ batches: [{ kind: DrawBatchKind.Mask, parts: [1] }] });
        const root = makePlayer({
            batches: [
                { kind: DrawBatchKind.Instance, parts: [1] },
                { kind: DrawBatchKind.Normal, parts: [2] },
            ],
            children: { 1: { ctx: child, visible: false } },
        });
        const { tree, seq } = plan(root);
        expect(tree.count).toBe(0);
        expect(seq(root)).toEqual([0, 1]);
        expect(tree.seqOf(child as any)).toBeUndefined();
    });

    it('stops at its capacity and says so', () => {
        const root = makePlayer({ batches: [{ kind: DrawBatchKind.Mask, parts: [1, 2, 3] }] });
        const { tree, writers } = plan(root, 2);
        expect(tree.count).toBe(2);
        expect(tree.exceeded).toBe(true);
        expect(writers.map(w => w.close)).toEqual([0, 1]);
    });

    it('lays the replay meta out as (open, close, bit, opInvert)', () => {
        const root = makePlayer({
            batches: [
                { kind: DrawBatchKind.Normal, parts: [1] },
                { kind: DrawBatchKind.Mask, parts: [2] },
            ],
            flags: { 1: CLIP },
        });
        const { tree } = plan(root);
        expect(Array.from(tree.meta.subarray(0, 8))).toEqual([0, -1, 0, 0, -1, 1, 1, 0]);
    });
});
