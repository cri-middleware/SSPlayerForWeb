import type { FrameData } from './ss/runtime/frame-data.js';
import type { InstanceChildState, InternalPlayerBase } from './InternalPlayerBase.js';
import { FrameDataRaw } from './FrameDataRaw.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { composeMaskInfluence, composeVisibleInside } from './MaskComposition.js';

/**
 * One instance part, resolved for the frame currently being drawn: whether it
 * contributes at all, where its sub-animation lands, and the mask context it
 * hands down. Reusable scratch — see {@link InstanceResolver.resolve}.
 */
export interface ResolvedInstance<T> {
    /** Part index of the instance part itself. */
    partIdx: number;
    /** Its rank in the OWNER's draw order — where §2-1 scope is judged (§2-7). */
    rank: number;
    /** The child player and its slot state. */
    child: InstanceChildState<T>;
    /** The instance part's own alpha this frame (always > 0; 0 resolves to null). */
    alpha: number;
    /** Opacity for the sub-animation: the instance ancestry's, folded with `alpha`. */
    childAlpha: number;
    /** owner parentMatrix ∘ instance world ∘ child local. Aliases `child.parentMatrix`. */
    composed: Float32Array;
    /** Composed `mask_influence` handed to the sub-animation (§2-6). */
    influence: boolean;
    /** Composed `visible_inside_mask` polarity handed down (§2-6). */
    visibleInside: boolean;
    /** The child's playhead, honouring `subFrameEnabled` (see `getFrameNo`). */
    frameNo: number;
}

/**
 * Resolves one instance part of a `DrawBatchKind.Instance` batch into everything
 * a renderer needs before it recurses into the sub-animation.
 *
 * This lives here rather than in each renderer for the reason `MaskComposition`
 * does: WHETHER an instance part contributes, WHERE its sub-animation lands,
 * WHICH frame it is at and WHAT mask context it inherits do not depend on how
 * the sub-animation is then drawn. Only the drawing differs — ssplayer-pixi
 * clips against a coverage bitmap and ssplayer-webgl against the GPU stencil —
 * and that stays in the renderers.
 *
 * Allocation-free in steady state: the returned record is reused across calls,
 * so a caller that recurses (and thereby lets the sub-animation resolve its own
 * instance parts through the same resolver) must read what it needs into locals
 * BEFORE recursing. `child` and `composed` are per-child storage and survive;
 * the primitives do not.
 */
export class InstanceResolver<T extends InternalPlayerBase<T>> {
    // Bound per call via the `*Of(fd, i)` helpers, so it follows the owner frame
    // across instance recursion and post-recursion re-fetches. Kept apart from
    // the renderers' own readers, which the recursion rebinds to child frames.
    private readonly _raw = new FrameDataRaw();
    // Transient: the instance part's own world matrix, consumed by composeAffine
    // in the same call and never held.
    private readonly _instMat = new Float32Array(6);
    private _out: ResolvedInstance<T> | null = null;

    /**
     * Resolve the instance part at `rank` of `player`'s draw order, or return
     * null when it contributes nothing this frame — the rank is not an instance
     * part, its slot is not playing (`child.visible`), or the part is fully
     * transparent.
     *
     * `parentMatrix` places the owner context (null at the root) and
     * `parentAlpha` is the opacity accumulated down the instance ancestry;
     * `ctxInfluence` / `ctxVisibleInside` are the owner's already-composed mask
     * context (`ROOT_MASK_INFLUENCE` / `ROOT_VISIBLE_INSIDE` at the root).
     */
    public resolve(
        player: T,
        frameData: FrameData,
        drawOrder: Uint16Array,
        rank: number,
        parentMatrix: Float32Array | null,
        parentAlpha: number,
        ctxInfluence: boolean,
        ctxVisibleInside: boolean,
    ): ResolvedInstance<T> | null {
        const partIdx = drawOrder[rank];

        // Cheapest test first: a Map miss settles every non-instance rank, which
        // is what a caller scanning the whole draw order pays on nearly every one.
        const child = player.getInstanceChild(partIdx);
        if (!child || !child.visible) return null;

        const alpha = this._raw.partAlphaOf(frameData, partIdx);
        if (alpha <= 0) return null;

        const manager = player.runtimeManager;
        manager.getWorldMatrix2D(partIdx, this._instMat);
        // Composed into the child's own scratch, so the result outlives the
        // recursion that reads it.
        const composed = GeometryBuilder.composeAffine(parentMatrix, this._instMat, child.parentMatrix);

        const maskFlags = manager.getPartMaskFlags();
        const partFlags = maskFlags ? maskFlags[partIdx] : 0;

        let out = this._out;
        if (!out) {
            out = this._out = {
                partIdx, rank, child, alpha, childAlpha: 0, composed,
                influence: false, visibleInside: false, frameNo: 0,
            };
        }
        out.partIdx = partIdx;
        out.rank = rank;
        out.child = child;
        out.alpha = alpha;
        out.childAlpha = parentAlpha * alpha;
        out.composed = composed;
        // Caller side of the §2-6 composition, resolved BEFORE the child builds
        // anything so it settles its own parts' roles itself and its output is
        // never patched after the fact. `mask_write` deliberately takes no part:
        // writing your own mask is a local fact, not something descendants inherit.
        out.influence = composeMaskInfluence(ctxInfluence, partFlags);
        out.visibleInside = composeVisibleInside(ctxVisibleInside, partFlags);
        // The child's DRAW frame, not its playhead: this is what the renderer is
        // handed for the sub-animation, so `subFrameEnabled = false` reaches it
        // as it does the root.
        out.frameNo = child.player.getDrawFrame();
        return out;
    }
}
