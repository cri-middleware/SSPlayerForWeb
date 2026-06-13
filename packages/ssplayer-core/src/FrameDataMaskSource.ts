import { FrameData } from './ss/runtime/frame-data.js';
import { PartState } from './ss/runtime/part-state.js';
import { DrawBatch } from './ss/runtime/draw-batch.js';
import { SSRuntimeManager } from './SSRuntimeManager.js';
import { MaskBatch, MaskPlanSource } from './MaskPlanner.js';

/**
 * Adapts a runtime `FrameData` + `SSRuntimeManager` to the engine-agnostic
 * {@link MaskPlanSource} the {@link MaskPlanner} reads. Reused per context per
 * frame via `bind()`; holds scratch wrappers so reads allocate nothing.
 *
 * `bind()` must run before any WASM allocation in the frame (the cached arrays
 * and FrameData view are zero-copy over WASM memory); the mask pre-pass already
 * runs before instance recursion, so this holds.
 */
export class FrameDataMaskSource implements MaskPlanSource {
    private frameData: FrameData | null = null;
    private drawOrder: Uint16Array | null = null;
    private maskFlags: Uint8Array | null = null;
    private shapeVertexCounts: Int32Array | null = null;
    private meshVertexOffsets: Uint32Array | null = null;
    private meshIndexOffsets: Int32Array | null = null;
    private readonly _ps = new PartState();
    private readonly _db = new DrawBatch();

    bind(frameData: FrameData, drawOrder: Uint16Array, manager: SSRuntimeManager): void {
        this.frameData = frameData;
        this.drawOrder = drawOrder;
        this.maskFlags = manager.getPartMaskFlags();
        this.shapeVertexCounts = manager.getShapeVertexCounts();
        this.meshVertexOffsets = manager.getMeshVertexOffsets();
        this.meshIndexOffsets = manager.getMeshIndexOffsets();
    }

    drawBatchCount(): number {
        return this.frameData!.drawBatchesLength();
    }

    readBatch(i: number, out: MaskBatch): void {
        const b = this.frameData!.drawBatches(i, this._db);
        if (!b) {
            out.kind = -1; out.startRank = 0; out.count = 0; out.flags = 0; out.textureHash = 0;
            return;
        }
        out.kind = b.kind();
        out.startRank = b.startRank();
        out.count = b.count();
        out.flags = b.flags();
        out.textureHash = b.textureHash();
    }

    drawOrderAt(rank: number): number {
        return this.drawOrder![rank];
    }

    partMask(partIdx: number): number {
        const ps = this.frameData!.parts(partIdx, this._ps);
        return ps ? ps.mask() : 0;
    }

    maskFlag(partIdx: number): number {
        return this.maskFlags ? this.maskFlags[partIdx] : 0;
    }

    shapeVertexCount(partIdx: number): number {
        return this.shapeVertexCounts![partIdx];
    }

    meshVertexCount(partIdx: number): number {
        const o = this.meshVertexOffsets!;
        return o[partIdx + 1] - o[partIdx];
    }

    meshIndexCount(partIdx: number): number {
        const o = this.meshIndexOffsets!;
        return o[partIdx + 1] - o[partIdx];
    }
}
