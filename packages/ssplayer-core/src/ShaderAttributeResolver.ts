import type { FrameData } from './ss/runtime/frame-data.js';
import { PartAttributeShader } from './ss/runtime/part-attribute-shader.js';

/**
 * Reads a part's `SHDR` (integration shader) attribute into the values every
 * renderer hands its shader: which built-in `ss-*` program to use, its eight
 * parameters, and the cell's UV rect.
 *
 * What the shader is and what it is given does not depend on how it is bound —
 * ssplayer-pixi writes into a `UniformGroup` and ssplayer-webgl calls
 * `gl.uniform*`, and the GLSL/WGSL bodies stay with each of them, but the
 * numbers reaching them are the same numbers. The cell rect in particular is a
 * derivation rather than a value in the frame: it is the min/max of the quad's
 * four corner UVs, and getting it wrong shows up as a shader sampling outside
 * its own cell.
 *
 * Allocation-free: {@link params} and {@link cellRect} are reused across calls,
 * valid until the next {@link resolve}.
 */
export class ShaderAttributeResolver {
    /** `id_hash` of the `ss-*` program the part asks for. */
    idHash = 0;
    /** `param0`..`param7`, in order. */
    readonly params = new Float32Array(8);
    /** The cell's UV rect as (left, top, right, bottom). */
    readonly cellRect = new Float32Array(4);

    private readonly _attr = new PartAttributeShader();

    /**
     * Read the `SHDR` attribute at `shaderIdx` of `frameData`, taking the cell
     * rect from `uvs` — the quad's corner UVs at indices 0..3 (vertex 4, where
     * one exists, is the centre and takes no part). Returns false when the
     * attribute is not there, in which case nothing is written.
     */
    public resolve(frameData: FrameData, shaderIdx: number, uvs: Float32Array): boolean {
        const attr = frameData.shaders(shaderIdx, this._attr);
        if (!attr) return false;

        this.idHash = attr.idHash();

        const p = this.params;
        p[0] = attr.param0(); p[1] = attr.param1(); p[2] = attr.param2(); p[3] = attr.param3();
        p[4] = attr.param4(); p[5] = attr.param5(); p[6] = attr.param6(); p[7] = attr.param7();

        let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
        for (let q = 0; q < 4; q++) {
            const uu = uvs[q * 2];
            const vv = uvs[q * 2 + 1];
            if (uu < minU) minU = uu;
            if (uu > maxU) maxU = uu;
            if (vv < minV) minV = vv;
            if (vv > maxV) maxV = vv;
        }
        const r = this.cellRect;
        r[0] = minU; r[1] = minV; r[2] = maxU; r[3] = maxV;
        return true;
    }
}
