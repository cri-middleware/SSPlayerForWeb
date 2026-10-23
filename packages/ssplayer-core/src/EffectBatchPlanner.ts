import type { FrameData } from './ss/runtime/frame-data.js';
import type { EffectDrawPlan } from './SSRuntimeManager.js';
import type { InternalPlayerBase } from './InternalPlayerBase.js';
import { FrameDataRaw } from './FrameDataRaw.js';
import { EffectDrawCommand } from './ss/runtime/effect-draw-command.js';

/** One particle emitter group of one effect part, ready to be built and drawn. */
export interface EffectDrawItem {
    /** The effect part this command belongs to. */
    partIdx: number;
    /** The part's draw plan. A zero-copy view over WASM memory. */
    plan: EffectDrawPlan;
    /** Cell-map hash the particles sample — half of the batching key. */
    cellmap: number;
    /** Raw `EmitterState.blend_type` (0 = Mix, 1 = Add) — the other half. */
    blend: number;
    /** Quads in this command; 4 vertices and 6 indices each. */
    quadCount: number;
    /** Where this command's particles start in the plan's shared flat buffers. */
    particleOffset: number;
    /** The effect part's own opacity, folded into the vertex alpha. */
    partAlpha: number;
}

/**
 * Gathers a `DrawBatchKind.Effect` batch's particle commands in draw order and
 * says where the mergeable runs are (dynamic batching).
 *
 * Particle geometry is simulated in the WASM runtime and returned as an
 * `EffectDrawPlan` per effect part, one command per (cell-map, blend) emitter
 * group. Which commands there are, which of them draw, and which neighbours may
 * be merged into one draw call is the same question whichever renderer asks it —
 * only where the vertices are written and how the draw is issued differ. The
 * per-vertex math is already shared, in `GeometryBuilder.buildEffectCommand`.
 *
 * **Only consecutive commands merge**, so draw order — and with it blend
 * compositing — comes out exactly as the runtime laid it down. The Brain gives
 * every effect part a batch of its own, so a renderer gathers the effect batches
 * that follow one another into one list ({@link collect} with `append`), and
 * commands merge across parts too.
 *
 * Allocation-free in steady state: {@link items} is a pooled array reused across
 * frames, valid until the next {@link collect} that does not append.
 */
export class EffectBatchPlanner<T extends InternalPlayerBase<T>> {
    /** The gathered commands. Only the first {@link count} entries are live. */
    readonly items: EffectDrawItem[] = [];
    /** How many entries {@link collect} filled. */
    count = 0;

    private readonly _raw = new FrameDataRaw();
    private readonly _cmd = new EffectDrawCommand();

    /**
     * Gather every drawable particle command of the batch at `startRank`, in
     * draw order. Skips a fully transparent effect part and one whose slot is
     * not playing (`getEffectDrawPlan` returns null), and drops empty commands.
     * With `append`, the commands go after the ones already gathered instead of
     * replacing them. Returns {@link EffectBatchPlanner.count | count}.
     */
    public collect(player: T, frameData: FrameData, drawOrder: Uint16Array, startRank: number, count: number, append = false): number {
        if (!append) this.count = 0;
        for (let c = 0; c < count; c++) {
            const partIdx = drawOrder[startRank + c];
            const alpha = this._raw.partAlphaOf(frameData, partIdx);
            if (alpha <= 0) continue;

            const plan = player.getEffectDrawPlan(partIdx);
            if (!plan) continue;

            const cmdCount = plan.commandsLength();
            for (let cmdIdx = 0; cmdIdx < cmdCount; cmdIdx++) {
                const cmd = plan.commands(cmdIdx, this._cmd);
                if (!cmd) continue;
                const quadCount = cmd.quadCount();
                if (quadCount === 0) continue;

                let d = this.items[this.count];
                if (!d) {
                    d = { partIdx: 0, plan, cellmap: 0, blend: 0, quadCount: 0, particleOffset: 0, partAlpha: 1 };
                    this.items[this.count] = d;
                }
                d.partIdx = partIdx;
                d.plan = plan;
                d.cellmap = cmd.cellmapHash();
                d.blend = cmd.blend();
                d.quadCount = quadCount;
                d.particleOffset = cmd.particleOffset();
                d.partAlpha = alpha;
                this.count++;
            }
        }
        return this.count;
    }

    /**
     * End (exclusive) of the run of commands starting at `g` that share its
     * cell-map and blend — the span one draw call can cover.
     */
    public runEnd(g: number): number {
        const items = this.items;
        const cellmap = items[g].cellmap;
        const blend = items[g].blend;
        let h = g + 1;
        while (h < this.count && items[h].cellmap === cellmap && items[h].blend === blend) h++;
        return h;
    }

    /** Total quads over `[g, h)`, which sizes the run's vertex and index buffers. */
    public quadsIn(g: number, h: number): number {
        let total = 0;
        for (let k = g; k < h; k++) total += this.items[k].quadCount;
        return total;
    }
}
