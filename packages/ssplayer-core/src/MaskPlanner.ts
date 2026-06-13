import { DrawBatchKind } from './ss/runtime/draw-batch-kind.js';

// Max simultaneous mask writers per context: one bit each, packed into the
// R/G/B channels of an RGBA8 coverage texture (8 bits x 3 = 24). Matches the
// runtime contract in 09_mask.ja.md §3-2.
export const MAX_MASK_WRITERS = 24;

// Geometry kind a mask writer is rendered with.
export const MASK_GEOM_NORMAL = 0;
export const MASK_GEOM_SHAPE = 1;
export const MASK_GEOM_MESH = 2;

/** Reusable per-batch view filled by a {@link MaskPlanSource}. */
export interface MaskBatch {
    kind: number;        // DrawBatchKind
    startRank: number;
    count: number;
    flags: number;
    textureHash: number;
}

/**
 * Minimal, engine-agnostic data the {@link MaskPlanner} reads. Deliberately
 * decoupled from the FrameData FlatBuffer layout so the planner is unit-testable
 * with a plain mock and reusable by any renderer. All accessors return
 * primitives (no per-call allocation). `FrameDataMaskSource` adapts the runtime.
 */
export interface MaskPlanSource {
    drawBatchCount(): number;
    /** Fill `out` with batch `i`'s fields (reuses the caller's scratch object). */
    readBatch(i: number, out: MaskBatch): void;
    /** Part index at the given draw-order rank. */
    drawOrderAt(rank: number): number;
    /** FrameData per-frame mask value (0..255); `<= 0` means the writer is inert (§2-2). */
    partMask(partIdx: number): number;
    /** Packed static mask-flags byte: 0x01 visibleInside, 0x02 maskWrite, 0x04 maskInfluence, 0x08 drawAsMask. 0 when unavailable. */
    maskFlag(partIdx: number): number;
    shapeVertexCount(partIdx: number): number;
    meshVertexCount(partIdx: number): number;
    meshIndexCount(partIdx: number): number;
}

/**
 * Engine-agnostic SpriteStudio mask planner (09_mask.ja.md §3-2-1). Given one
 * context's frame (via a {@link MaskPlanSource}), produces the writer set a
 * renderer needs to rasterise the coverage bitmap and replay it: per-writer
 * draw rank, packed bit, OP (increment/invert), clipping flag, cutout texture
 * hash + threshold, geometry kind, and the replay `meta`. The renderer owns the
 * GPU-specific parts (offscreen target, shaders, vertex buffers); this owns the
 * selection/classification logic, which is identical across engines (cf. Unity
 * `SpriteStudioMaskPlanner`).
 *
 * Output is reusable SoA, valid until the next `plan()` call. `bit === index`,
 * so writer `w`'s coverage bit is `w`.
 */
export class MaskPlanner {
    readonly partIdx = new Int32Array(MAX_MASK_WRITERS);
    readonly rank = new Int32Array(MAX_MASK_WRITERS);
    readonly bit = new Int32Array(MAX_MASK_WRITERS);
    readonly opInvert = new Uint8Array(MAX_MASK_WRITERS);
    readonly isClipping = new Uint8Array(MAX_MASK_WRITERS);
    readonly textureHash = new Uint32Array(MAX_MASK_WRITERS);
    readonly threshold = new Float32Array(MAX_MASK_WRITERS);
    readonly geomKind = new Uint8Array(MAX_MASK_WRITERS);
    readonly numVerts = new Int32Array(MAX_MASK_WRITERS);
    readonly numIndices = new Int32Array(MAX_MASK_WRITERS);
    /** Replay metadata (drawRank, bit, opInvert, isClipping) x MAX, consumed by the masked shader. */
    readonly meta = new Float32Array(MAX_MASK_WRITERS * 4);
    /** Number of finalized writers from the last `plan()`. */
    count = 0;
    /** True when the writer cap was reached (extra masks dropped). */
    exceeded = false;

    // Candidate scratch (pre-finalize): (partIdx, rank, opInvert, isClipping) + texHash.
    private readonly _candSel = new Int32Array(MAX_MASK_WRITERS * 4);
    private readonly _candTex = new Uint32Array(MAX_MASK_WRITERS);
    private readonly _batch: MaskBatch = { kind: 0, startRank: 0, count: 0, flags: 0, textureHash: 0 };

    /**
     * Plan the mask writers for one context's frame. Returns the finalized
     * writer count and fills the SoA fields above.
     */
    plan(src: MaskPlanSource): number {
        const sel = this._candSel;
        const selTex = this._candTex;
        const b = this._batch;

        // Pass 1: select candidate writers in draw order (09_mask.ja.md §1-2):
        //   pure masks  — DrawBatchKind.Mask batches (PartTypeMask / draw_as_mask);
        //                 OP rides in the batch flag (0x01: 0 = increment, 1 = invert).
        //   clipping    — drawn parts with mask_write (no twin batch emitted),
        //                 detected via the static PartData flags; mask_influence
        //                 doubles as the OP, and they scope FORWARD.
        let cand = 0;
        const nb = src.drawBatchCount();
        for (let i = 0; i < nb && cand < MAX_MASK_WRITERS; i++) {
            src.readBatch(i, b);
            const texHash = b.textureHash >>> 0;
            if (b.kind === DrawBatchKind.Mask) {
                const opInvert = (b.flags & 0x01) !== 0 ? 1 : 0;
                for (let c = 0; c < b.count && cand < MAX_MASK_WRITERS; c++) {
                    const partIdx = src.drawOrderAt(b.startRank + c);
                    sel[cand * 4 + 0] = partIdx;
                    sel[cand * 4 + 1] = b.startRank + c;
                    sel[cand * 4 + 2] = opInvert;
                    sel[cand * 4 + 3] = 0;
                    selTex[cand] = texHash;
                    cand++;
                }
            } else if (b.kind === DrawBatchKind.Normal || b.kind === DrawBatchKind.Shape || b.kind === DrawBatchKind.Mesh) {
                for (let c = 0; c < b.count && cand < MAX_MASK_WRITERS; c++) {
                    const partIdx = src.drawOrderAt(b.startRank + c);
                    const mf = src.maskFlag(partIdx);
                    // mask_write drawn part = clipping writer (draw_as_mask parts
                    // are pure masks, emitted via Mask batches above).
                    if ((mf & 0x02) === 0 || (mf & 0x08) !== 0) continue;
                    sel[cand * 4 + 0] = partIdx;
                    sel[cand * 4 + 1] = b.startRank + c;
                    sel[cand * 4 + 2] = (mf & 0x04) !== 0 ? 1 : 0;
                    sel[cand * 4 + 3] = 1;
                    selTex[cand] = texHash;
                    cand++;
                }
            }
        }

        // Pass 2: finalize — drop inert (mask <= 0, §2-2) and degenerate-geometry
        // writers, assign a dense coverage bit, and resolve cutout threshold +
        // geometry kind.
        let count = 0;
        for (let w = 0; w < cand; w++) {
            const partIdx = sel[w * 4 + 0];
            const maskVal = src.partMask(partIdx);
            if (maskVal <= 0) continue;

            const texHash = selTex[w];
            // Cutout threshold (§2-5). texHash 0 (pure masks / shapes) = no cutout.
            const threshold = texHash !== 0 ? (255 - maskVal) / 255 : -1.0;

            // Resolve geometry kind (the Mask batch doesn't carry it): shape
            // vertex count, then mesh slice, else a quad.
            const shapeVerts = src.shapeVertexCount(partIdx);
            const meshVCount = src.meshVertexCount(partIdx);
            let geomKind: number;
            let numVerts: number;
            let numIndices: number;
            if (shapeVerts >= 3) { geomKind = MASK_GEOM_SHAPE; numVerts = shapeVerts; numIndices = (shapeVerts - 2) * 3; }
            else if (meshVCount > 0) { geomKind = MASK_GEOM_MESH; numVerts = meshVCount; numIndices = src.meshIndexCount(partIdx); }
            else { geomKind = MASK_GEOM_NORMAL; numVerts = 5; numIndices = 12; }
            if (numIndices <= 0) continue;

            const rankPos = sel[w * 4 + 1];
            const opInvert = sel[w * 4 + 2];
            const isClipping = sel[w * 4 + 3];
            const bit = count;

            this.partIdx[count] = partIdx;
            this.rank[count] = rankPos;
            this.bit[count] = bit;
            this.opInvert[count] = opInvert;
            this.isClipping[count] = isClipping;
            this.textureHash[count] = texHash;
            this.threshold[count] = threshold;
            this.geomKind[count] = geomKind;
            this.numVerts[count] = numVerts;
            this.numIndices[count] = numIndices;

            this.meta[count * 4 + 0] = rankPos;
            this.meta[count * 4 + 1] = bit;
            this.meta[count * 4 + 2] = opInvert;
            this.meta[count * 4 + 3] = isClipping;
            count++;
        }

        this.count = count;
        this.exceeded = count >= MAX_MASK_WRITERS;
        return count;
    }
}
