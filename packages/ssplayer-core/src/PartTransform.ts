/**
 * Part-following transform types and helpers.
 *
 * The runtime already computes every part's world matrix each frame (for
 * drawing); this module is the engine-agnostic surface a renderer facade uses to
 * let an external object follow a part. The transform itself is read via
 * {@link InternalPlayerBase.getPartTransform}; this file only defines its shape
 * and the decomposition a facade needs when it drives a target component-wise.
 */

/**
 * A part's current-frame transform as a 2D affine, copied out of WASM memory
 * (safe to retain past the frame). Layout `[m00, m01, m10, m11, tx, ty]` — the
 * same interchange format as {@link SSRuntimeManager.getWorldMatrix2D} and
 * `GeometryBuilder.composeAffine`:
 *
 * ```
 * x' = m00 * x + m01 * y + tx
 * y' = m10 * x + m11 * y + ty
 * ```
 *
 * The space is animation-local and Y-down (the space parts are drawn in), so a
 * follower placed under the player's own transform lands exactly on the part.
 */
export type SSPartAffine = Float32Array; // length 6

/**
 * How a facade's part attachment follows its part. Engine-agnostic so the pixi
 * and rmmz facades share one option shape (the target object they drive is
 * engine-specific and lives on each facade's own attachment type).
 */
export interface SSPartFollowOptions {
    /** Drive the target's position from the part. Default true. */
    position?: boolean;
    /** Drive the target's rotation from the part. Default true. */
    rotation?: boolean;
    /**
     * Drive the target's scale from the part. **Default false**: a follower is
     * placed *at* the part, not *sized by* it, and a health bar or a name plate
     * stretching with a breathing animation is rarely what was wanted. Turn it
     * on for something that is part of the artwork — a weapon in a hand.
     */
    scale?: boolean;
    /**
     * What to do on frames the part is hidden: `'follow'` keeps tracking it
     * (default), `'hide'` hides the target too. A part absent from the current
     * animation always hides the target regardless of this.
     */
    onHide?: 'follow' | 'hide';
    /**
     * Parent the target under the player so it inherits the player's own
     * transform and lands exactly on the part (default true). When false the
     * target is driven where it already lives — an exact match then only holds
     * while it shares the player's coordinate space.
     */
    addAsChild?: boolean;
}

/** A part affine decomposed into translation, rotation (radians) and scale. */
export interface SSDecomposedTransform {
    x: number;
    y: number;
    /** Rotation in radians, taken from the affine's X basis. */
    rotation: number;
    scaleX: number;
    scaleY: number;
}

/**
 * Decompose a 2D part affine `[m00, m01, m10, m11, tx, ty]` into translation,
 * rotation and scale, assuming a translate*rotate*scale composition. Rotation is
 * taken from the X basis and each scale from its basis length, with `scaleY`
 * signed by the affine's determinant so a mirrored (negatively scaled) part
 * survives the round-trip. A sheared affine cannot be represented this way and
 * is approximated — prefer the raw {@link SSPartAffine} when the shear must be
 * exact. A part's own **Skew** never produces that shear here: it is a
 * non-inheriting local-vertex deform the runtime keeps out of the world matrix,
 * so it does not reach a follower (matching SpriteStudio, where skew does not
 * propagate). A rotated part under a non-uniform parent scale still can.
 */
export function decomposePartAffine(a: ArrayLike<number>): SSDecomposedTransform {
    const m00 = a[0], m01 = a[1], m10 = a[2], m11 = a[3];
    const scaleX = Math.hypot(m00, m10);
    let scaleY = Math.hypot(m01, m11);
    // A negative determinant means the basis is mirrored; fold that sign into
    // scaleY (matching the convention getWorldMatrix2D → set*Scale expects).
    if (m00 * m11 - m01 * m10 < 0) scaleY = -scaleY;
    return {
        x: a[4],
        y: a[5],
        rotation: Math.atan2(m10, m00),
        scaleX,
        scaleY,
    };
}

// --- Follower ------------------------------------------------------------
//
// Which parts are being followed, by what, and whether we were the one that
// hid a target — none of that is engine-specific. What IS
// engine-specific is a single step: writing a transform onto a display object.
// So the bookkeeping lives here and the host supplies the write.

/**
 * The player state a follower reads each frame. Structural on purpose, so both
 * {@link InternalPlayerBase} and every renderer facade already satisfy it.
 */
export interface SSPartFollowSource {
    findPartIndex(partName: string): number;
    isPartHidden(part: number | string): boolean | null;
    getPartTransform(part: number | string, out?: Float32Array): Float32Array | null;
}

/** Which axes a component-wise write should touch. */
export interface SSPartFollowAxes {
    position: boolean;
    rotation: boolean;
    scale: boolean;
}

/** How a host parents, shows and transforms the objects it makes follow parts. */
export interface SSPartFollowHost<T> {
    /** Parent `target` under the player. Only called when `addAsChild` is on. */
    addChild(target: T): void;
    /** Undo {@link addChild}. Must itself check the target is still ours. */
    removeChild(target: T): void;
    setVisible(target: T, visible: boolean): void;
    /** Write the exact affine `[m00, m01, m10, m11, tx, ty]` (mirroring intact; a part's own skew is not carried — the runtime keeps it out of the world matrix). */
    applyAffine(target: T, affine: SSPartAffine): void;
    /**
     * Write only the enabled axes, leaving the target's own values for the rest.
     * `transform` and `axes` are scratch objects reused across attachments and
     * frames — read them, do not retain them.
     */
    applyDecomposed(target: T, transform: SSDecomposedTransform, axes: SSPartFollowAxes): void;
}

/** Handle returned by {@link SSPartFollower.attach}; `detach()` stops the following. */
export interface SSPartAttachment<T> {
    readonly target: T;
    detach(): void;
}

interface Attachment<T> {
    part: number | string;
    target: T;
    position: boolean;
    rotation: boolean;
    scale: boolean;
    onHide: 'follow' | 'hide';
    addedAsChild: boolean;
    /** A hide WE imposed, so `detach` only restores visibility it took away. */
    autoHidden: boolean;
}

/**
 * Drives external objects to follow animation parts — a weapon in a hand, an
 * effect on a muzzle, a hitbox on a null part.
 *
 * The host owns when to call {@link update}: it must run after the frame's world
 * matrices are final, which is the only moment `getPartTransform` describes the
 * frame about to be drawn.
 */
export class SSPartFollower<T> {
    private readonly attachments: Attachment<T>[] = [];
    /** Reused so a per-frame update over many attachments allocates nothing. */
    private readonly scratch = new Float32Array(6);
    // Handed to applyDecomposed instead of the attachment itself, which would put
    // this class's internal record in the host's hands.
    private readonly axes: SSPartFollowAxes = { position: true, rotation: true, scale: true };

    constructor(
        private readonly source: SSPartFollowSource,
        private readonly host: SSPartFollowHost<T>,
    ) {}

    /** How many targets are currently following a part. */
    public get size(): number {
        return this.attachments.length;
    }

    /**
     * Make `target` follow `part` (a name or an index). Attaching a target that
     * is already attached replaces the earlier attachment rather than stacking a
     * second one. With position, rotation and scale all enabled the full affine
     * is written, so a mirrored part is reproduced exactly. A part's own skew is
     * a non-inheriting local-vertex deform kept out of the world matrix, so it
     * never reaches the follower (matching SpriteStudio, where skew does not
     * propagate to children).
     */
    public attach(part: number | string, target: T, options: SSPartFollowOptions = {}): SSPartAttachment<T> {
        this.detach(target);

        const addedAsChild = options.addAsChild ?? true;
        this.attachments.push({
            part,
            target,
            position: options.position ?? true,
            rotation: options.rotation ?? true,
            scale: options.scale ?? false,
            onHide: options.onHide ?? 'follow',
            addedAsChild,
            autoHidden: false,
        });
        if (addedAsChild) this.host.addChild(target);

        return { target, detach: () => this.detach(target) };
    }

    /** Stop following for `target`, reversing the parenting and visibility we imposed. */
    public detach(target: T): void {
        const i = this.attachments.findIndex(a => a.target === target);
        if (i < 0) return;
        const [state] = this.attachments.splice(i, 1);
        if (state.addedAsChild) this.host.removeChild(target);
        // Only undo a hide we imposed; a target the host hid stays hidden.
        if (state.autoHidden) this.host.setVisible(target, true);
    }

    /** Detach every target — for teardown, so nothing is left hidden or reparented. */
    public detachAll(): void {
        for (const a of [...this.attachments]) this.detach(a.target);
    }

    /** Drive every attachment to its part's transform on the current frame. */
    public update(): void {
        for (const a of this.attachments) {
            const index = typeof a.part === 'string' ? this.source.findPartIndex(a.part) : a.part;

            // Absent from this animation, or hidden and the caller asked to
            // follow that: hide once and stop driving it.
            const hide = index < 0 || (a.onHide === 'hide' && this.source.isPartHidden(index) === true);
            if (hide) {
                if (!a.autoHidden) {
                    this.host.setVisible(a.target, false);
                    a.autoHidden = true;
                }
                continue;
            }
            if (a.autoHidden) {
                this.host.setVisible(a.target, true);
                a.autoHidden = false;
            }

            const affine = this.source.getPartTransform(index, this.scratch);
            if (!affine) continue;

            if (a.position && a.rotation && a.scale) {
                this.host.applyAffine(a.target, affine);
            } else {
                this.axes.position = a.position;
                this.axes.rotation = a.rotation;
                this.axes.scale = a.scale;
                this.host.applyDecomposed(a.target, decomposePartAffine(affine), this.axes);
            }
        }
    }
}
