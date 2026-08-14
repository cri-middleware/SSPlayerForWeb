import type { SSRuntimeManager } from './SSRuntimeManager.js';
import { FrameData } from './ss/runtime/frame-data.js';
import { BlendType } from './ss/format/blend-type.js';
import { EffectDrawPlan } from './ss/runtime/effect-draw-plan.js';
import { FrameDataRaw } from './FrameDataRaw.js';

/**
 * Encapsulates purely mathematical geometry operations:
 * - World Matrix multiplication
 * - PartsColor / vertex color synthesis
 * - Shape bilinear interpolation
 * - UV generation
 */
export class GeometryBuilder {
    private runtimeManager: SSRuntimeManager;
    private worldPositions: Float32Array = new Float32Array(0);

    /**
     * Optional parent 2D-affine applied to every emitted world position, packed
     * as [m00, m01, m10, m11, tx, ty]. Used when this builder renders an
     * instance-part child animation: the child computes its geometry in its own
     * local space, and this matrix (the parent instance part's world transform,
     * accumulated through any nesting) places it under the parent. `null` = the
     * builder renders a root animation and emits world positions unchanged.
     */
    public parentMatrix: Float32Array | null = null;

    // Zero-copy raw reader for the FlatBuffers struct vectors (parts /
    // parts_color) — bypasses the per-element accessors that dominate frame-data
    // cost in JS hosts (07_render_loop.ja.md §2). Bound per build call; the bind
    // is cached by FlatBuffer identity so per-part rebinds are ~free.
    private readonly _raw = new FrameDataRaw();
    // Reused per-build scratch so the render hot path allocates nothing: the
    // typed arrays hold the resolved 4 corner colors + center (×rgba) and their
    // rates. A single part is built at a time, so sharing is safe.
    private readonly _cornerColors = new Float32Array(20); // [LT,RT,LB,RB,center] × [r,g,b,a]
    private readonly _cornerRates = new Float32Array(5);

    // Cached views over EffectDrawPlan's FlatBuffer vectors so multiple commands
    // slicing the same plan don't reallocate TypedArrays on each buildEffectCommand call.
    // Safe because getEffectDrawPlan() mints a fresh ByteBuffer per call; if that is
    // ever pooled, this must compare the vector lengths too.
    private _planBb: unknown = null;
    private _planBbPos = -1;
    private _planBuffer: ArrayBufferLike | null = null;
    private _planVerts: Float32Array | null = null;
    private _planUvs: Float32Array | null = null;
    private _planColors: Float32Array | null = null;
    private _planIndices: Int32Array | null = null;

    constructor(runtimeManager: SSRuntimeManager) {
        this.runtimeManager = runtimeManager;
    }

    /**
     * Compose two 2D affines (each [m00, m01, m10, m11, tx, ty]) so the result
     * applied to a point equals `parent(child(point))`. When `parent` is null
     * (the identity case) the result is just `child`: copied into `out` when
     * provided (so callers can keep a stable per-child buffer), else returned
     * directly with no allocation.
     */
    public static composeAffine(parent: Float32Array | null, child: Float32Array, out?: Float32Array): Float32Array {
        if (!parent) {
            if (!out) return child;
            out.set(child);
            return out;
        }
        const r = out ?? new Float32Array(6);
        const p00 = parent[0], p01 = parent[1], p10 = parent[2], p11 = parent[3], ptx = parent[4], pty = parent[5];
        const c00 = child[0], c01 = child[1], c10 = child[2], c11 = child[3], ctx = child[4], cty = child[5];
        r[0] = p00 * c00 + p01 * c10;
        r[1] = p00 * c01 + p01 * c11;
        r[2] = p10 * c00 + p11 * c10;
        r[3] = p10 * c01 + p11 * c11;
        r[4] = p00 * ctx + p01 * cty + ptx;
        r[5] = p10 * ctx + p11 * cty + pty;
        return r;
    }

    /**
     * Re-calculates worldPositions by applying world_matrices to local_vertices.
     * Must be called once per frame before building geometry.
     */
    public updateWorldPositions(): void {
        const matrices = this.runtimeManager.getWorldMatrices();
        const positionData = this.runtimeManager.getLocalVertices();
        if (positionData.length === 0) return;
        if (this.worldPositions.length !== positionData.length) {
            this.worldPositions = new Float32Array(positionData.length);
        }

        for (let i = 0; i < matrices.length / 16; i++) {
            const mOff = i * 16;
            const vOff = i * 10;
            const m00 = matrices[mOff + 0];
            const m10 = matrices[mOff + 1];
            const m01 = matrices[mOff + 4];
            const m11 = matrices[mOff + 5];
            const tx  = matrices[mOff + 12];
            const ty  = matrices[mOff + 13];
            
            for (let v = 0; v < 5; v++) {
                const vx = positionData[vOff + v * 2];
                const vy = positionData[vOff + v * 2 + 1];
                this.worldPositions[vOff + v * 2] = m00 * vx + m01 * vy + tx;
                this.worldPositions[vOff + v * 2 + 1] = m10 * vx + m11 * vy + ty;
            }
        }
    }

    /**
     * Builds geometry for a Normal part.
     *
     * `vertexOffset` packs several parts into one shared buffer, as in
     * {@link buildEffectCommand}.
     */
    public buildNormal(
        partIdx: number,
        frameData: FrameData,
        invTexW: number,
        invTexH: number,
        outPositions: Float32Array,
        outUvs: Float32Array,
        outColors: Float32Array,
        outCustom0: Float32Array,
        vertexOffset: number = 0
    ): void {
        const srcBase = partIdx * 10;
        const raw = this._raw.bind(frameData);
        if (raw.partsLen === 0) return;

        const uvData = this.runtimeManager.getLocalUVs();
        if (uvData.length === 0) return;

        const pcIdx = raw.partColorIdx(partIdx);

        const colors = this._cornerColors;
        const rates = this._cornerRates;
        let pc_blendType = BlendType.Mix;
        const hasPc = pcIdx >= 0;

        if (hasPc) {
            pc_blendType = raw.pcBlendType(pcIdx);
            // PartColor blend is only valid for Mix/Mul/Add/Sub (0..3). Any other
            // BlendType value (Mulalpha, Screen, …) must clamp to Mix, else no
            // flag below matches and the shader outputs black (10_parts_color §1-1).
            if (pc_blendType > BlendType.Sub) pc_blendType = BlendType.Mix;
            // Resolve each corner in place, then derive the center as the average.
            raw.readCornerInto(pcIdx, 0, colors, rates);
            raw.readCornerInto(pcIdx, 1, colors, rates);
            raw.readCornerInto(pcIdx, 2, colors, rates);
            raw.readCornerInto(pcIdx, 3, colors, rates);
            colors[16] = (colors[0] + colors[4] + colors[8]  + colors[12]) * 0.25;
            colors[17] = (colors[1] + colors[5] + colors[9]  + colors[13]) * 0.25;
            colors[18] = (colors[2] + colors[6] + colors[10] + colors[14]) * 0.25;
            colors[19] = (colors[3] + colors[7] + colors[11] + colors[15]) * 0.25;
            rates[4] = (rates[0] + rates[1] + rates[2] + rates[3]) * 0.25;
        }

        const mixF = pc_blendType === BlendType.Mix ? 1 : 0;
        const mulF = pc_blendType === BlendType.Mul ? 1 : 0;
        const addF = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);

        // Per-vertex alpha carries this part's own (fully hierarchical) opacity:
        // for part-colored parts the runtime already pre-multiplied state.alpha()
        // into parts_color.rgba.a; for the default path we put state.alpha() here
        // so the shader's output alpha (texColor.a * vColor.a) is the single alpha
        // source and the renderer's mesh.alpha need only carry the parent chain
        // (avoids double-applying state.alpha(); 10_parts_color §1-3 "do not
        // re-multiply state->alpha()").
        const stateAlpha = raw.partAlpha(partIdx);

        const pm = this.parentMatrix;
        for (let j = 0; j < 5; j++) {
            const ov = vertexOffset + j;
            const wx = this.worldPositions[srcBase + j * 2];
            const wy = this.worldPositions[srcBase + j * 2 + 1];
            if (pm) {
                outPositions[ov * 2] = pm[0] * wx + pm[1] * wy + pm[4];
                outPositions[ov * 2 + 1] = pm[2] * wx + pm[3] * wy + pm[5];
            } else {
                outPositions[ov * 2] = wx;
                outPositions[ov * 2 + 1] = wy;
            }
            outUvs[ov * 2] = uvData[srcBase + j * 2] * invTexW;
            outUvs[ov * 2 + 1] = uvData[srcBase + j * 2 + 1] * invTexH;

            if (hasPc) {
                const cb = j * 4;
                outColors[ov * 4 + 0] = colors[cb + 0];
                outColors[ov * 4 + 1] = colors[cb + 1];
                outColors[ov * 4 + 2] = colors[cb + 2];
                outColors[ov * 4 + 3] = colors[cb + 3];
                outCustom0[ov * 4 + 0] = rates[j];
                outCustom0[ov * 4 + 1] = mixF;
                outCustom0[ov * 4 + 2] = mulF;
                outCustom0[ov * 4 + 3] = addF;
            } else {
                outColors[ov * 4 + 0] = 1.0; outColors[ov * 4 + 1] = 1.0; outColors[ov * 4 + 2] = 1.0; outColors[ov * 4 + 3] = stateAlpha;
                outCustom0[ov * 4 + 0] = 1.0; outCustom0[ov * 4 + 1] = 0; outCustom0[ov * 4 + 2] = 1.0; outCustom0[ov * 4 + 3] = 0;
            }
        }
    }

    /**
     * Builds geometry for a Shape part. `vertexOffset` / `indexOffset` pack
     * several parts into one shared buffer; indices are rebased by `vertexOffset`.
     */
    public buildShape(
        partIdx: number,
        frameData: FrameData,
        numVerts: number,
        invTexW: number,
        invTexH: number,
        outPositions: Float32Array,
        outUvs: Float32Array,
        outColors: Float32Array,
        outCustom0: Float32Array,
        outIndices: Uint32Array | Uint16Array,
        vertexOffset: number = 0,
        indexOffset: number = 0
    ): void {
        const shapeVertices = this.runtimeManager.getShapeVertices();
        const shapeVertexBoxCoords = this.runtimeManager.getShapeVertexBoxCoords();
        const matrices = this.runtimeManager.getWorldMatrices();

        const uvData = this.runtimeManager.getLocalUVs();
        if (uvData.length === 0) return;

        const SHAPE_VERTICES_STRIDE = 24;
        const srcBase = partIdx * SHAPE_VERTICES_STRIDE;
        const raw = this._raw.bind(frameData);
        const hasParts = raw.partsLen > 0;

        const pcIdx = hasParts ? raw.partColorIdx(partIdx) : -1;
        const hasPc = pcIdx >= 0;
        // This part's own (hierarchical) opacity — see buildNormal. For the
        // no-PartColor path it becomes the corner alpha so output alpha is
        // texColor.a * vColor.a with the parent chain applied once via mesh.alpha.
        const stateAlpha = hasParts ? raw.partAlpha(partIdx) : 1;
        // Per-part, not per-vertex: hoisted out of the loop below like every other
        // part-level read here (a 64-vertex star re-read this 64 times per frame).
        const hasCell = hasParts && raw.partCell(partIdx) >= 0;

        // Corner colors/rates live in shared scratch ([LT,RT,LB,RB] × rgba);
        // the per-vertex loop below interpolates them as scalars.
        const cc = this._cornerColors;
        const cr = this._cornerRates;
        if (hasPc) {
            // Shape bypasses the PartColor blend formula: blend is forced to Mix
            // and rate to 1.0, so the shape renders as the (bilinearly
            // interpolated) parts colour itself, ignoring parts_color.blend_type
            // (10_parts_color.ja.md §1-2 table / §1-2-3).
            raw.readCornerInto(pcIdx, 0, cc, cr);
            raw.readCornerInto(pcIdx, 1, cc, cr);
            raw.readCornerInto(pcIdx, 2, cc, cr);
            raw.readCornerInto(pcIdx, 3, cc, cr);
            // Override the per-corner rates so the bilinear interpolation below
            // yields 1.0 at every vertex (rate is forced to 1.0 for shapes).
            cr[0] = 1; cr[1] = 1; cr[2] = 1; cr[3] = 1;
        } else {
            cc[0] = 1; cc[1] = 1; cc[2] = 1; cc[3] = stateAlpha;
            cc[4] = 1; cc[5] = 1; cc[6] = 1; cc[7] = stateAlpha;
            cc[8] = 1; cc[9] = 1; cc[10] = 1; cc[11] = stateAlpha;
            cc[12] = 1; cc[13] = 1; cc[14] = 1; cc[15] = stateAlpha;
            cr[0] = 0; cr[1] = 0; cr[2] = 0; cr[3] = 0;
        }
        // Shape always uses the Mix path (forced above); flags are constant.
        const shapeMixF = 1, shapeMulF = 0, shapeAddF = 0;

        const mOff = partIdx * 16;
        const m00 = matrices[mOff + 0];
        const m10 = matrices[mOff + 1];
        const m01 = matrices[mOff + 4];
        const m11 = matrices[mOff + 5];
        const tx  = matrices[mOff + 12];
        const ty  = matrices[mOff + 13];
        const pm = this.parentMatrix;

        for (let v = 0; v < numVerts; v++) {
            const ov = vertexOffset + v;
            const vx = shapeVertices[srcBase + v * 2 + 0];
            const vy = shapeVertices[srcBase + v * 2 + 1];
            const fx = shapeVertexBoxCoords[srcBase + v * 2 + 0];
            const fy = shapeVertexBoxCoords[srcBase + v * 2 + 1];

            // Bilinear interpolation for colors (scalar, from corner scratch).
            const topR = cc[0] + (cc[4] - cc[0]) * fx;
            const topG = cc[1] + (cc[5] - cc[1]) * fx;
            const topB = cc[2] + (cc[6] - cc[2]) * fx;
            const topA = cc[3] + (cc[7] - cc[3]) * fx;
            const botR = cc[8]  + (cc[12] - cc[8])  * fx;
            const botG = cc[9]  + (cc[13] - cc[9])  * fx;
            const botB = cc[10] + (cc[14] - cc[10]) * fx;
            const botA = cc[11] + (cc[15] - cc[11]) * fx;

            const cr_ = topR + (botR - topR) * fy;
            const cg = topG + (botG - topG) * fy;
            const cb = topB + (botB - topB) * fy;
            const ca = topA + (botA - topA) * fy;

            const topRate = cr[0] + (cr[1] - cr[0]) * fx;
            const bottomRate = cr[2] + (cr[3] - cr[2]) * fx;
            const mixRate = topRate + (bottomRate - topRate) * fy;

            const wx = m00 * vx + m01 * vy + tx;
            const wy = m10 * vx + m11 * vy + ty;
            if (pm) {
                outPositions[ov * 2 + 0] = pm[0] * wx + pm[1] * wy + pm[4];
                outPositions[ov * 2 + 1] = pm[2] * wx + pm[3] * wy + pm[5];
            } else {
                outPositions[ov * 2 + 0] = wx;
                outPositions[ov * 2 + 1] = wy;
            }

            if (hasCell) {
                const uvBase = partIdx * 10;
                const tlU = uvData[uvBase + 2]; const tlV = uvData[uvBase + 3];
                const trU = uvData[uvBase + 4]; const trV = uvData[uvBase + 5];
                const blU = uvData[uvBase + 6]; const blV = uvData[uvBase + 7];
                const brU = uvData[uvBase + 8]; const brV = uvData[uvBase + 9];
                
                const topU = tlU + (trU - tlU) * fx;
                const topV = tlV + (trV - tlV) * fx;
                const bottomU = blU + (brU - blU) * fx;
                const bottomV = blV + (brV - blV) * fx;
                
                outUvs[ov * 2 + 0] = (topU + (bottomU - topU) * fy) * invTexW;
                outUvs[ov * 2 + 1] = (topV + (bottomV - topV) * fy) * invTexH;
            } else {
                outUvs[ov * 2 + 0] = 0.5;
                outUvs[ov * 2 + 1] = 0.5;
            }

            outColors[ov * 4 + 0] = cr_;
            outColors[ov * 4 + 1] = cg;
            outColors[ov * 4 + 2] = cb;
            outColors[ov * 4 + 3] = ca;

            outCustom0[ov * 4 + 0] = mixRate;
            outCustom0[ov * 4 + 1] = shapeMixF;
            outCustom0[ov * 4 + 2] = shapeMulF;
            outCustom0[ov * 4 + 3] = shapeAddF;
        }

        // Triangle Fan
        let indexCursor = indexOffset;
        for (let j = 1; j < numVerts - 1; j++) {
            outIndices[indexCursor++] = vertexOffset;
            outIndices[indexCursor++] = vertexOffset + j;
            outIndices[indexCursor++] = vertexOffset + j + 1;
        }
    }

    /**
     * Builds geometry for a Skinned Mesh part. `vertexOffset` / `indexOffset` pack
     * several parts into one shared buffer; indices are rebased by `vertexOffset`.
     */
    public buildMesh(
        partIdx: number,
        frameData: FrameData,
        pCount: number,
        iCount: number,
        invTexW: number,
        invTexH: number,
        outPositions: Float32Array,
        outUvs: Float32Array,
        outColors: Float32Array,
        outCustom0: Float32Array,
        outIndices: Uint32Array | Uint16Array,
        vertexOffset: number = 0,
        indexOffset: number = 0
    ): void {
        const meshVx = this.runtimeManager.getMeshVerticesX();
        const meshVy = this.runtimeManager.getMeshVerticesY();
        const meshUv = this.runtimeManager.getMeshUVs();
        const meshIdx = this.runtimeManager.getMeshIndices();
        const meshVOff = this.runtimeManager.getMeshVertexOffsets();
        const meshIOff = this.runtimeManager.getMeshIndexOffsets();

        const v0 = meshVOff[partIdx];
        const i0 = meshIOff[partIdx];

        const raw = this._raw.bind(frameData);
        const hasParts = raw.partsLen > 0;
        const pcIdx = hasParts ? raw.partColorIdx(partIdx) : -1;

        let pc_rate = 1;
        let pcR = 1, pcG = 1, pcB = 1, pcA = 1;
        let pc_blendType = BlendType.Mix;
        const hasPc = pcIdx >= 0;
        // This part's own (hierarchical) opacity — see buildNormal.
        const stateAlpha = hasParts ? raw.partAlpha(partIdx) : 1;

        if (hasPc) {
            pc_blendType = raw.pcBlendType(pcIdx);
            // Clamp invalid PartColor blend modes (>=4) to Mix (10_parts_color §1-1).
            if (pc_blendType > BlendType.Sub) pc_blendType = BlendType.Mix;
            // Mesh uses only the LT corner (index 0) as a flat tint.
            pc_rate = raw.pcCornerRate(pcIdx, 0);
            pcR = raw.pcCornerR(pcIdx, 0) / 255.0;
            pcG = raw.pcCornerG(pcIdx, 0) / 255.0;
            pcB = raw.pcCornerB(pcIdx, 0) / 255.0;
            pcA = raw.pcCornerA(pcIdx, 0) / 255.0;
        }
        const meshMixF = pc_blendType === BlendType.Mix ? 1 : 0;
        const meshMulF = pc_blendType === BlendType.Mul ? 1 : 0;
        const meshAddF = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);

        const pm = this.parentMatrix;
        for (let v = 0; v < pCount; v++) {
            const ov = vertexOffset + v;
            const wx = meshVx[v0 + v];
            const wy = meshVy[v0 + v];
            if (pm) {
                outPositions[ov * 2] = pm[0] * wx + pm[1] * wy + pm[4];
                outPositions[ov * 2 + 1] = pm[2] * wx + pm[3] * wy + pm[5];
            } else {
                outPositions[ov * 2] = wx;
                outPositions[ov * 2 + 1] = wy;
            }
            outUvs[ov * 2] = meshUv[(v0 + v) * 2] * invTexW;
            outUvs[ov * 2 + 1] = meshUv[(v0 + v) * 2 + 1] * invTexH;

            if (hasPc) {
                outColors[ov * 4 + 0] = pcR;
                outColors[ov * 4 + 1] = pcG;
                outColors[ov * 4 + 2] = pcB;
                outColors[ov * 4 + 3] = pcA;
                outCustom0[ov * 4 + 0] = pc_rate;
                outCustom0[ov * 4 + 1] = meshMixF;
                outCustom0[ov * 4 + 2] = meshMulF;
                outCustom0[ov * 4 + 3] = meshAddF;
            } else {
                outColors[ov * 4 + 0] = 1.0; outColors[ov * 4 + 1] = 1.0; outColors[ov * 4 + 2] = 1.0; outColors[ov * 4 + 3] = stateAlpha;
                outCustom0[ov * 4 + 0] = 1.0; outCustom0[ov * 4 + 1] = 0; outCustom0[ov * 4 + 2] = 1.0; outCustom0[ov * 4 + 3] = 0;
            }
        }
        for (let j = 0; j < iCount; j++) {
            outIndices[indexOffset + j] = meshIdx[i0 + j] + vertexOffset;
        }
    }

    /**
     * Builds geometry for a single Effect draw command (one emitter group of
     * particle quads) out of an EffectDrawPlan.
     *
     * The plan's flat verts/uvs/colors/indices arrays are sliced by the
     * command's particleOffset/quadCount. Particle vertices are produced by the
     * WASM runtime in the effect's local space (y-flip already applied), so the
     * effect part's world matrix is baked in here, matching buildNormal/
     * buildShape/buildMesh. UVs and colors are emitted normalized (0..1) by the
     * runtime and copied through unchanged. Indices are command-local 0-based.
     *
     * `vertexOffset` / `indexOffset` let several commands be packed into a single
     * shared buffer (effect dynamic batching, 08_advanced_rendering §2): each
     * command writes its vertices starting at `vertexOffset`, and its indices —
     * rebased by `vertexOffset` — starting at `indexOffset`. `partAlpha` folds the
     * effect part's own opacity into the per-vertex alpha so one merged Mesh can
     * carry commands from parts with differing alpha under a single mesh alpha.
     */
    public buildEffectCommand(
        partIdx: number,
        plan: EffectDrawPlan,
        particleOffset: number,
        quadCount: number,
        outPositions: Float32Array,
        outUvs: Float32Array,
        outColors: Float32Array,
        outIndices: Uint32Array | Uint16Array,
        vertexOffset: number = 0,
        indexOffset: number = 0,
        partAlpha: number = 1
    ): void {
        const bb = plan.bb;
        const bbPos = plan.bb_pos;
        const bytes = bb ? bb.bytes() : null;
        const buffer = bytes ? bytes.buffer : null;

        if (!this._planVerts || this._planBb !== bb || this._planBbPos !== bbPos || this._planBuffer !== buffer) {
            this._planBb = bb;
            this._planBbPos = bbPos;
            this._planBuffer = buffer;
            this._planVerts = plan.vertsArray();
            this._planUvs = plan.uvsArray();
            this._planColors = plan.colorsArray();
            this._planIndices = plan.indicesArray();
        }

        const planVerts = this._planVerts;
        const planUvs = this._planUvs;
        const planColors = this._planColors;
        const planIndices = this._planIndices;
        if (!planVerts || !planUvs || !planColors || !planIndices) return;

        const matrices = this.runtimeManager.getWorldMatrices();
        const mOff = partIdx * 16;
        const m00 = matrices[mOff + 0];
        const m10 = matrices[mOff + 1];
        const m01 = matrices[mOff + 4];
        const m11 = matrices[mOff + 5];
        const tx  = matrices[mOff + 12];
        const ty  = matrices[mOff + 13];

        const stride = plan.vertStride() === 3 ? 3 : 2;
        const vBase = particleOffset * 4; // first vertex (quad-offset * 4 verts)
        const iBase = particleOffset * 6; // first index (quad-offset * 6 indices)
        const pCount = quadCount * 4;
        const iCount = quadCount * 6;
        const pm = this.parentMatrix;

        for (let v = 0; v < pCount; v++) {
            const gv = vBase + v;
            const ov = vertexOffset + v;
            const vx = planVerts[gv * stride + 0];
            const vy = planVerts[gv * stride + 1];
            const wx = m00 * vx + m01 * vy + tx;
            const wy = m10 * vx + m11 * vy + ty;
            if (pm) {
                outPositions[ov * 2 + 0] = pm[0] * wx + pm[1] * wy + pm[4];
                outPositions[ov * 2 + 1] = pm[2] * wx + pm[3] * wy + pm[5];
            } else {
                outPositions[ov * 2 + 0] = wx;
                outPositions[ov * 2 + 1] = wy;
            }

            outUvs[ov * 2 + 0] = planUvs[gv * 2 + 0];
            outUvs[ov * 2 + 1] = planUvs[gv * 2 + 1];

            outColors[ov * 4 + 0] = planColors[gv * 4 + 0];
            outColors[ov * 4 + 1] = planColors[gv * 4 + 1];
            outColors[ov * 4 + 2] = planColors[gv * 4 + 2];
            // Fold the effect part's own opacity into the vertex alpha. The effect
            // shader premultiplies (rgb * a), so scaling only the alpha channel
            // scales the whole premultiplied contribution — letting a merged mesh
            // use a single (parent) alpha instead of a per-part mesh alpha.
            outColors[ov * 4 + 3] = planColors[gv * 4 + 3] * partAlpha;
        }

        for (let k = 0; k < iCount; k++) {
            outIndices[indexOffset + k] = planIndices[iBase + k] + vertexOffset;
        }
    }
}
