import { describe, it, expect } from 'vitest';
import { MaskPlanner, MAX_MASK_WRITERS, MASK_GEOM_NORMAL, MASK_GEOM_SHAPE, MASK_GEOM_MESH, MaskPlanSource } from '../src/MaskPlanner.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';

interface BatchDesc { kind: number; parts: number[]; flags?: number; textureHash?: number; }
interface PartDesc { mask?: number; flag?: number; shapeVerts?: number; meshVerts?: number; meshIdx?: number; }

// Build a plain MaskPlanSource from a declarative description. draw_order is the
// parts concatenated in batch order; each batch's startRank is its offset there.
function makeSource(batches: BatchDesc[], parts: Record<number, PartDesc> = {}): MaskPlanSource {
    const drawOrder: number[] = [];
    const views = batches.map(bd => {
        const startRank = drawOrder.length;
        drawOrder.push(...bd.parts);
        return { kind: bd.kind, startRank, count: bd.parts.length, flags: bd.flags ?? 0, textureHash: bd.textureHash ?? 0 };
    });
    const get = (p: number): PartDesc => parts[p] ?? {};
    return {
        drawBatchCount: () => views.length,
        readBatch: (i, out) => { const v = views[i]; out.kind = v.kind; out.startRank = v.startRank; out.count = v.count; out.flags = v.flags; out.textureHash = v.textureHash; },
        drawOrderAt: (r) => drawOrder[r],
        partMask: (p) => get(p).mask ?? 255,        // default: visible / active
        maskFlag: (p) => get(p).flag ?? 0,
        shapeVertexCount: (p) => get(p).shapeVerts ?? 0,
        meshVertexCount: (p) => get(p).meshVerts ?? 0,
        meshIndexCount: (p) => get(p).meshIdx ?? 0,
    };
}

describe('MaskPlanner', () => {
    it('plans a pure-mask writer (Mask batch), invert OP from batch flag', () => {
        const p = new MaskPlanner();
        expect(p.plan(makeSource([{ kind: DrawBatchKind.Mask, parts: [10], flags: 0x01 }]))).toBe(1);
        expect(p.partIdx[0]).toBe(10);
        expect(p.rank[0]).toBe(0);
        expect(p.bit[0]).toBe(0);
        expect(p.opInvert[0]).toBe(1);
        expect(p.isClipping[0]).toBe(0);
        expect(p.geomKind[0]).toBe(MASK_GEOM_NORMAL);
        expect(p.numVerts[0]).toBe(5);
        expect(p.numIndices[0]).toBe(12);
        expect(p.threshold[0]).toBe(-1);            // texHash 0 → no cutout
        expect(Array.from(p.meta.subarray(0, 4))).toEqual([0, 0, 1, 0]); // rank,bit,opInvert,isClipping
        expect(p.exceeded).toBe(false);
    });

    it('plans a clipping writer (drawn part with mask_write), OP + threshold from mask_influence/mask', () => {
        const p = new MaskPlanner();
        // mask_write (0x02) + mask_influence (0x04), textured, mask=128.
        const src = makeSource([{ kind: DrawBatchKind.Normal, parts: [3], textureHash: 999 }], { 3: { flag: 0x02 | 0x04, mask: 128 } });
        expect(p.plan(src)).toBe(1);
        expect(p.partIdx[0]).toBe(3);
        expect(p.isClipping[0]).toBe(1);
        expect(p.opInvert[0]).toBe(1);              // mask_influence drives OP for clipping
        expect(p.textureHash[0]).toBe(999);
        expect(p.threshold[0]).toBeCloseTo((255 - 128) / 255, 6);
    });

    it('skips inert writers (mask <= 0) and keeps coverage bits dense', () => {
        const p = new MaskPlanner();
        const src = makeSource([{ kind: DrawBatchKind.Mask, parts: [1, 2] }], { 1: { mask: 0 }, 2: { mask: 255 } });
        expect(p.plan(src)).toBe(1);
        expect(p.partIdx[0]).toBe(2);
        expect(p.rank[0]).toBe(1);                  // second part's draw rank
        expect(p.bit[0]).toBe(0);                   // bit stays dense after the skip
    });

    it('does not treat draw_as_mask parts in a Normal batch as clipping writers', () => {
        const p = new MaskPlanner();
        const src = makeSource([{ kind: DrawBatchKind.Normal, parts: [5] }], { 5: { flag: 0x02 | 0x08 } });
        expect(p.plan(src)).toBe(0); // draw_as_mask (0x08) → pure mask, emitted via a Mask batch
    });

    it('ignores drawn parts without mask_write', () => {
        const p = new MaskPlanner();
        expect(p.plan(makeSource([{ kind: DrawBatchKind.Normal, parts: [5] }], { 5: { flag: 0 } }))).toBe(0);
    });

    it('resolves geometry kind: shape vs mesh vs quad', () => {
        const p = new MaskPlanner();
        // shape (>=3 verts)
        p.plan(makeSource([{ kind: DrawBatchKind.Mask, parts: [1] }], { 1: { shapeVerts: 4 } }));
        expect(p.geomKind[0]).toBe(MASK_GEOM_SHAPE);
        expect(p.numVerts[0]).toBe(4);
        expect(p.numIndices[0]).toBe((4 - 2) * 3);
        // mesh
        p.plan(makeSource([{ kind: DrawBatchKind.Mask, parts: [2] }], { 2: { meshVerts: 6, meshIdx: 12 } }));
        expect(p.geomKind[0]).toBe(MASK_GEOM_MESH);
        expect(p.numVerts[0]).toBe(6);
        expect(p.numIndices[0]).toBe(12);
    });

    it('skips a writer with degenerate geometry (no indices)', () => {
        const p = new MaskPlanner();
        const src = makeSource([{ kind: DrawBatchKind.Mask, parts: [7] }], { 7: { meshVerts: 4, meshIdx: 0 } });
        expect(p.plan(src)).toBe(0);
    });

    it('records the draw rank for scope (position in draw order)', () => {
        const p = new MaskPlanner();
        // two non-writer Normal parts, then a Mask writer at rank 2
        const src = makeSource([{ kind: DrawBatchKind.Normal, parts: [0, 1] }, { kind: DrawBatchKind.Mask, parts: [2] }]);
        expect(p.plan(src)).toBe(1);
        expect(p.rank[0]).toBe(2);
        expect(p.meta[0]).toBe(2); // meta.x = drawRank
    });

    it('caps at MAX_MASK_WRITERS and flags exceeded', () => {
        const p = new MaskPlanner();
        const parts = Array.from({ length: MAX_MASK_WRITERS + 5 }, (_, i) => i);
        expect(p.plan(makeSource([{ kind: DrawBatchKind.Mask, parts }]))).toBe(MAX_MASK_WRITERS);
        expect(p.exceeded).toBe(true);
        expect(p.bit[MAX_MASK_WRITERS - 1]).toBe(MAX_MASK_WRITERS - 1);
    });

    it('flags exceeded on truncation even when the finalized count falls below the cap', () => {
        const p = new MaskPlanner();
        // 30 candidates: selection stops at 24 (6 dropped), then pass 2 filters
        // the 10 inert ones. The surviving count says nothing about truncation.
        const parts = Array.from({ length: MAX_MASK_WRITERS + 6 }, (_, i) => i);
        const inert = Object.fromEntries(parts.slice(0, 10).map(i => [i, { mask: 0 }]));
        expect(p.plan(makeSource([{ kind: DrawBatchKind.Mask, parts }], inert))).toBe(MAX_MASK_WRITERS - 10);
        expect(p.exceeded).toBe(true);
    });

    it('does not flag exceeded when exactly MAX_MASK_WRITERS writers fit', () => {
        const p = new MaskPlanner();
        const parts = Array.from({ length: MAX_MASK_WRITERS }, (_, i) => i);
        expect(p.plan(makeSource([{ kind: DrawBatchKind.Mask, parts }]))).toBe(MAX_MASK_WRITERS);
        expect(p.exceeded).toBe(false); // full, but nothing was dropped
    });

    it('plans multiple writers with distinct bits', () => {
        const p = new MaskPlanner();
        const src = makeSource([{ kind: DrawBatchKind.Mask, parts: [10, 11, 12] }]);
        expect(p.plan(src)).toBe(3);
        expect(Array.from(p.bit.subarray(0, 3))).toEqual([0, 1, 2]);
        expect(Array.from(p.partIdx.subarray(0, 3))).toEqual([10, 11, 12]);
    });
});
