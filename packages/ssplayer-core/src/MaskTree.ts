import type { FrameData } from './ss/runtime/frame-data.js';
import { DrawBatch } from './ss/runtime/draw-batch.js';
import { DrawBatchKind } from './ss/runtime/draw-batch-kind.js';
import type { InstanceChildState, InternalPlayerBase } from './InternalPlayerBase.js';
import { MaskPlanner, MAX_MASK_WRITERS } from './MaskPlanner.js';
import { FrameDataMaskSource } from './FrameDataMaskSource.js';
import { InstanceResolver } from './InstanceResolver.js';
import { ROOT_MASK_INFLUENCE } from './MaskComposition.js';

/**
 * Receives the writers {@link MaskTreePlanner.plan} finds, while the frame of
 * the context that owns them is still current. The renderer rasterises them
 * here (or copies out what it needs to later); the planner only decides which
 * writers there are and where each one holds.
 */
export interface MaskTreeVisitor<T> {
    /**
     * A context with at least one writer is about to report them. `matrix`
     * places it (the root's own at the root, the composed instance matrix
     * below), exactly as the renderer places that context when drawing it.
     */
    beginContext(player: T, frameData: FrameData, matrix: Float32Array | null): void;
    /**
     * One writer: `planner`'s writer `w`, valid for this call only. `index` is
     * its tree-wide index, which is also its coverage bit.
     */
    writer(player: T, frameData: FrameData, planner: MaskPlanner, w: number, index: number): void;
}

interface ChildSnapshot<T> {
    rank: number;
    child: InstanceChildState<T>;
    composed: Float32Array;
    influence: boolean;
    frameNo: number;
}

/**
 * One mask set for a whole instance tree. SpriteStudio 7.6 masks as if every
 * draw of the tree went through one stencil, in one sequence: a sub-animation is
 * drawn in its instance part's place. So each writer holds over an open interval
 * of that sequence:
 *
 * - a pure mask (`PartTypeMask` / `draw_as_mask`), from the start of its own
 *   animation to itself — it never leaves the instance it sits in;
 * - a clipping writer (`mask_write`), from itself to the end of the tree — one
 *   written inside an instance keeps clipping the caller's later parts, at any
 *   depth.
 *
 * This walks the tree depth-first, numbering every draw-order rank of every
 * visible context (a sub-animation right after its instance part), and collects
 * the writers of all of them. A part at sequence number `s` is covered by the
 * writers whose `open < s` and `s < close` (or `close < 0`). How that is then drawn — a coverage bitmap
 * in ssplayer-pixi, the stencil in ssplayer-webgl — is the renderer's.
 *
 * A writer's op follows its effective `mask_influence`: its own AND its instance
 * part's, one level deep, like any target (see `MaskComposition`).
 *
 * Output is reusable SoA, valid until the next `plan()` call. Allocation-free in
 * steady state; a context's sequence array is allocated the first time it is
 * seen or grows.
 */
export class MaskTreePlanner<T extends InternalPlayerBase<T>> {
    /** Writers the tree can hold; past it they are dropped and `exceeded` is set. */
    readonly capacity: number;
    /** Interval start on the tree sequence (exclusive). */
    readonly open: Float32Array;
    /**
     * Interval end on the tree sequence (exclusive); -1 for a clipping writer,
     * which holds to the end of the tree. A sentinel rather than a large number
     * so the replay's comparisons stay exact at shader precisions.
     */
    readonly close: Float32Array;
    /** Effective op: 1 = invert (mask_influence 1), 0 = increment. */
    readonly opInvert: Uint8Array;
    /** 1 = clipping writer, 0 = pure mask. */
    readonly isClipping: Uint8Array;
    /** Replay metadata (open, close, bit, opInvert) x capacity; `bit === index`. */
    readonly meta: Float32Array;
    /** Writers found by the last `plan()`. */
    count = 0;
    /** True when the tree held more writers than there are bits (extras dropped). */
    exceeded = false;

    private readonly _planner = new MaskPlanner();
    private readonly _source = new FrameDataMaskSource();
    private readonly _resolver = new InstanceResolver<T>();
    private readonly _batch = new DrawBatch();
    private readonly _seq = new WeakMap<T, Float32Array>();
    private readonly _kids: ChildSnapshot<T>[][] = [];
    // Per writer until its context has been numbered: its rank there, and
    // where that context starts on the sequence.
    private readonly _rank: Int32Array;
    private readonly _start: Float32Array;
    private _counter = 0;

    /**
     * `capacity` is the renderer's budget for the whole tree: a coverage
     * bitmap needs a bit per writer, a stencil only a counter deep enough for
     * the writers overlapping at one pixel. Each context still plans at most
     * `MAX_MASK_WRITERS` of its own.
     */
    constructor(capacity: number = MAX_MASK_WRITERS) {
        this.capacity = capacity;
        this.open = new Float32Array(capacity);
        this.close = new Float32Array(capacity);
        this.opInvert = new Uint8Array(capacity);
        this.isClipping = new Uint8Array(capacity);
        this.meta = new Float32Array(capacity * 4);
        this._rank = new Int32Array(capacity);
        this._start = new Float32Array(capacity);
    }

    /**
     * Number the tree under `root` and collect its writers. `frameData` is the
     * root's frame and `matrix` its placement; instance children are reached
     * through the same resolver the renderers draw them with, so exactly the
     * sub-animations that are drawn are numbered.
     *
     * Asks the runtime for each visible child's frame, which can grow WASM
     * memory: a caller holding views into it re-derives them afterwards.
     *
     * A tree with no part that can write a mask is not walked: it returns 0
     * and numbers nothing.
     */
    plan(root: T, frameData: FrameData, matrix: Float32Array | null, visitor: MaskTreeVisitor<T>): number {
        this.count = 0;
        this.exceeded = false;
        this._counter = 0;
        if (!root.hasMaskWriterParts()) return 0;
        this.walk(root, frameData, matrix, ROOT_MASK_INFLUENCE, -1, 0, visitor);
        return this.count;
    }

    /**
     * Sequence number of each draw-order rank of `player`, as numbered by the
     * last `plan()` that found writers. Undefined for a player that was not
     * part of it.
     */
    seqOf(player: T): Float32Array | undefined {
        return this._seq.get(player);
    }

    private walk(
        player: T, frameData: FrameData, matrix: Float32Array | null,
        instInfluence: boolean, startSeq: number, depth: number, visitor: MaskTreeVisitor<T>,
    ): void {
        const drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;
        const n = drawOrder.length;

        // This context's own writers, reported while its frame is current.
        const planner = this._planner;
        this._source.bind(frameData, drawOrder, player.runtimeManager);
        const cnt = planner.plan(this._source);
        if (planner.exceeded) this.exceeded = true;
        const first = this.count;
        if (cnt > 0 && first < this.capacity) visitor.beginContext(player, frameData, matrix);
        for (let w = 0; w < cnt; w++) {
            if (this.count >= this.capacity) { this.exceeded = true; break; }
            const i = this.count++;
            this.opInvert[i] = planner.opInvert[w] !== 0 && instInfluence ? 1 : 0;
            this.isClipping[i] = planner.isClipping[w];
            this._rank[i] = planner.rank[w];
            this._start[i] = startSeq;
            visitor.writer(player, frameData, planner, w, i);
        }
        const last = this.count;

        // The visible instance children, snapshotted before any of them is
        // asked for its frame (which can detach this frame's views).
        let kids = this._kids[depth];
        if (!kids) { kids = []; this._kids[depth] = kids; }
        let nk = 0;
        const nb = frameData.drawBatchesLength();
        for (let i = 0; i < nb; i++) {
            const b = frameData.drawBatches(i, this._batch);
            if (!b || b.kind() !== DrawBatchKind.Instance) continue;
            const startRank = b.startRank();
            const count = b.count();
            for (let c = 0; c < count; c++) {
                const inst = this._resolver.resolve(player, frameData, drawOrder, startRank + c, matrix, 1);
                if (!inst) continue;
                let k = kids[nk];
                if (!k) { k = { rank: 0, child: inst.child, composed: inst.composed, influence: true, frameNo: 0 }; kids[nk] = k; }
                k.rank = startRank + c;
                k.child = inst.child;
                k.composed = inst.composed;
                k.influence = inst.influence;
                k.frameNo = inst.frameNo;
                nk++;
            }
        }

        // Number this context's ranks, each visible sub-animation right after
        // its instance part.
        let seq = this._seq.get(player);
        if (!seq || seq.length < n) {
            seq = new Float32Array(Math.max(n, 16));
            this._seq.set(player, seq);
        }
        let k = 0;
        for (let r = 0; r < n; r++) {
            const s = this._counter++;
            seq[r] = s;
            if (k < nk && kids[k].rank === r) {
                const kid = kids[k++];
                const cfd = kid.child.player.runtimeManager.getFrameData(kid.frameNo);
                if (cfd) this.walk(kid.child.player, cfd, kid.composed, kid.influence, s, depth + 1, visitor);
            }
        }

        // Now that this context is numbered, place its writers.
        for (let i = first; i < last; i++) {
            const s = seq[this._rank[i]];
            const open = this.isClipping[i] ? s : this._start[i];
            const close = this.isClipping[i] ? -1 : s;
            this.open[i] = open;
            this.close[i] = close;
            this.meta[i * 4 + 0] = open;
            this.meta[i * 4 + 1] = close;
            this.meta[i * 4 + 2] = i;
            this.meta[i * 4 + 3] = this.opInvert[i];
        }
    }
}
