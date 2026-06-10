import { SSRuntimeManager } from './SSRuntimeManager.js';
import { FrameData } from './ss/runtime/frame-data.js';
import { BlendType } from './ss/format/blend-type.js';

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

    constructor(runtimeManager: SSRuntimeManager) {
        this.runtimeManager = runtimeManager;
    }

    /**
     * Re-calculates worldPositions by applying world_matrices to local_vertices.
     * Must be called once per frame before building geometry.
     */
    public updateWorldPositions(): void {
        const matrices = this.runtimeManager.getWorldMatrices();
        const posPtr = this.runtimeManager.context.get_local_vertices_buf();
        const posLen = this.runtimeManager.context.get_local_vertices_len();
        if (!posPtr || posLen === 0) return;

        const positionData = this.runtimeManager.getFloat32Array(posPtr, posLen);
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
     */
    public buildNormal(
        partIdx: number,
        frameData: FrameData,
        invTexW: number,
        invTexH: number,
        outPositions: Float32Array,
        outUvs: Float32Array,
        outColors: Float32Array,
        outCustom0: Float32Array
    ): void {
        const srcBase = partIdx * 10;
        const partState = frameData.parts(partIdx);
        if (!partState) return;

        const uvPtr = this.runtimeManager.context.get_local_uvs_buf();
        const uvLen = this.runtimeManager.context.get_local_uvs_len();
        if (!uvPtr || uvLen === 0) return;
        const uvData = this.runtimeManager.getFloat32Array(uvPtr, uvLen);

        const pc = (partState.partColor() >= 0) ? frameData.partsColor(partState.partColor()) : null;
        
        let pc_rates = [1, 1, 1, 1, 1];
        let pc_colors = [[1,1,1,1], [1,1,1,1], [1,1,1,1], [1,1,1,1], [1,1,1,1]];
        let pc_blendType = BlendType.Mix;
        let hasPc = false;

        if (pc) {
            hasPc = true;
            pc_blendType = pc.blendType();
            const lt = pc.lt(); const lt_rgba = lt?.rgba();
            const rt = pc.rt(); const rt_rgba = rt?.rgba();
            const lb = pc.lb(); const lb_rgba = lb?.rgba();
            const rb = pc.rb(); const rb_rgba = rb?.rgba();
            
            pc_rates[0] = lt?.rate() || 0;
            pc_rates[1] = rt?.rate() || 0;
            pc_rates[2] = lb?.rate() || 0;
            pc_rates[3] = rb?.rate() || 0;
            pc_rates[4] = (pc_rates[0] + pc_rates[1] + pc_rates[2] + pc_rates[3]) / 4.0;
            
            const toColor = (rgba: any) => rgba ? [rgba.r()/255.0, rgba.g()/255.0, rgba.b()/255.0, rgba.a()/255.0] : [1,1,1,1];
            pc_colors[0] = toColor(lt_rgba);
            pc_colors[1] = toColor(rt_rgba);
            pc_colors[2] = toColor(lb_rgba);
            pc_colors[3] = toColor(rb_rgba);
            pc_colors[4] = [
                (pc_colors[0][0] + pc_colors[1][0] + pc_colors[2][0] + pc_colors[3][0]) / 4.0,
                (pc_colors[0][1] + pc_colors[1][1] + pc_colors[2][1] + pc_colors[3][1]) / 4.0,
                (pc_colors[0][2] + pc_colors[1][2] + pc_colors[2][2] + pc_colors[3][2]) / 4.0,
                (pc_colors[0][3] + pc_colors[1][3] + pc_colors[2][3] + pc_colors[3][3]) / 4.0,
            ];
        }

        for (let j = 0; j < 5; j++) {
            outPositions[j * 2] = this.worldPositions[srcBase + j * 2];
            outPositions[j * 2 + 1] = this.worldPositions[srcBase + j * 2 + 1];
            outUvs[j * 2] = uvData[srcBase + j * 2] * invTexW;
            outUvs[j * 2 + 1] = uvData[srcBase + j * 2 + 1] * invTexH;
            
            if (hasPc) {
                outColors[j * 4 + 0] = pc_colors[j][0];
                outColors[j * 4 + 1] = pc_colors[j][1];
                outColors[j * 4 + 2] = pc_colors[j][2];
                outColors[j * 4 + 3] = pc_colors[j][3];
                outCustom0[j * 4 + 0] = pc_rates[j];
                outCustom0[j * 4 + 1] = pc_blendType === BlendType.Mix ? 1 : 0;
                outCustom0[j * 4 + 2] = pc_blendType === BlendType.Mul ? 1 : 0;
                outCustom0[j * 4 + 3] = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);
            } else {
                outColors[j * 4 + 0] = 1.0; outColors[j * 4 + 1] = 1.0; outColors[j * 4 + 2] = 1.0; outColors[j * 4 + 3] = 1.0;
                outCustom0[j * 4 + 0] = 1.0; outCustom0[j * 4 + 1] = 0; outCustom0[j * 4 + 2] = 1.0; outCustom0[j * 4 + 3] = 0;
            }
        }
    }

    /**
     * Builds geometry for a Shape part.
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
        outIndices: Uint32Array | Uint16Array
    ): void {
        const shapeVertices = this.runtimeManager.getShapeVertices();
        const shapeVertexBoxCoords = this.runtimeManager.getShapeVertexBoxCoords();
        const matrices = this.runtimeManager.getWorldMatrices();

        const uvPtr = this.runtimeManager.context.get_local_uvs_buf();
        const uvLen = this.runtimeManager.context.get_local_uvs_len();
        if (!uvPtr || uvLen === 0) return;
        const uvData = this.runtimeManager.getFloat32Array(uvPtr, uvLen);

        const SHAPE_VERTICES_STRIDE = 24; 
        const srcBase = partIdx * SHAPE_VERTICES_STRIDE;
        const partState = frameData.parts(partIdx);
        
        const pc = (partState && partState.partColor() >= 0) ? frameData.partsColor(partState.partColor()) : null;
        
        let ltColor = [1,1,1,1], rtColor = [1,1,1,1], lbColor = [1,1,1,1], rbColor = [1,1,1,1];
        let ltRate = 0, rtRate = 0, lbRate = 0, rbRate = 0;
        let pc_blendType = BlendType.Mix;
        
        if (pc) {
            pc_blendType = pc.blendType();
            const toColor = (attr: any) => {
                if (!attr || !attr.rgba()) return { c: [1,1,1,1], r: 0 };
                const rgba = attr.rgba();
                return {
                    c: [rgba.r()/255.0, rgba.g()/255.0, rgba.b()/255.0, rgba.a()/255.0],
                    r: attr.rate()
                };
            };
            const clt = toColor(pc.lt()); ltColor = clt.c; ltRate = clt.r;
            const crt = toColor(pc.rt()); rtColor = crt.c; rtRate = crt.r;
            const clb = toColor(pc.lb()); lbColor = clb.c; lbRate = clb.r;
            const crb = toColor(pc.rb()); rbColor = crb.c; rbRate = crb.r;
        }

        const mOff = partIdx * 16;
        const m00 = matrices[mOff + 0];
        const m10 = matrices[mOff + 1];
        const m01 = matrices[mOff + 4];
        const m11 = matrices[mOff + 5];
        const tx  = matrices[mOff + 12];
        const ty  = matrices[mOff + 13];

        for (let v = 0; v < numVerts; v++) {
            const vx = shapeVertices[srcBase + v * 2 + 0];
            const vy = shapeVertices[srcBase + v * 2 + 1];
            const fx = shapeVertexBoxCoords[srcBase + v * 2 + 0];
            const fy = shapeVertexBoxCoords[srcBase + v * 2 + 1];
            
            // Bilinear interpolation for colors
            const topColor = [
                ltColor[0] + (rtColor[0] - ltColor[0]) * fx,
                ltColor[1] + (rtColor[1] - ltColor[1]) * fx,
                ltColor[2] + (rtColor[2] - ltColor[2]) * fx,
                ltColor[3] + (rtColor[3] - ltColor[3]) * fx,
            ];
            const bottomColor = [
                lbColor[0] + (rbColor[0] - lbColor[0]) * fx,
                lbColor[1] + (rbColor[1] - lbColor[1]) * fx,
                lbColor[2] + (rbColor[2] - lbColor[2]) * fx,
                lbColor[3] + (rbColor[3] - lbColor[3]) * fx,
            ];
            
            const cr = topColor[0] + (bottomColor[0] - topColor[0]) * fy;
            const cg = topColor[1] + (bottomColor[1] - topColor[1]) * fy;
            const cb = topColor[2] + (bottomColor[2] - topColor[2]) * fy;
            const ca = topColor[3] + (bottomColor[3] - topColor[3]) * fy;

            const topRate = ltRate + (rtRate - ltRate) * fx;
            const bottomRate = lbRate + (rbRate - lbRate) * fx;
            const mixRate = topRate + (bottomRate - topRate) * fy;

            outPositions[v * 2 + 0] = m00 * vx + m01 * vy + tx;
            outPositions[v * 2 + 1] = m10 * vx + m11 * vy + ty;
            
            if (partState && partState.cell() >= 0) {
                const uvBase = partIdx * 10;
                const tlU = uvData[uvBase + 2]; const tlV = uvData[uvBase + 3];
                const trU = uvData[uvBase + 4]; const trV = uvData[uvBase + 5];
                const blU = uvData[uvBase + 6]; const blV = uvData[uvBase + 7];
                const brU = uvData[uvBase + 8]; const brV = uvData[uvBase + 9];
                
                const topU = tlU + (trU - tlU) * fx;
                const topV = tlV + (trV - tlV) * fx;
                const bottomU = blU + (brU - blU) * fx;
                const bottomV = blV + (brV - blV) * fx;
                
                outUvs[v * 2 + 0] = (topU + (bottomU - topU) * fy) * invTexW;
                outUvs[v * 2 + 1] = (topV + (bottomV - topV) * fy) * invTexH;
            } else {
                outUvs[v * 2 + 0] = 0.5;
                outUvs[v * 2 + 1] = 0.5;
            }
            
            outColors[v * 4 + 0] = cr;
            outColors[v * 4 + 1] = cg;
            outColors[v * 4 + 2] = cb;
            outColors[v * 4 + 3] = ca;
            
            outCustom0[v * 4 + 0] = mixRate;
            outCustom0[v * 4 + 1] = pc_blendType === BlendType.Mix ? 1 : 0;
            outCustom0[v * 4 + 2] = pc_blendType === BlendType.Mul ? 1 : 0;
            outCustom0[v * 4 + 3] = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);
        }

        // Triangle Fan
        let indexCursor = 0;
        for (let j = 1; j < numVerts - 1; j++) {
            outIndices[indexCursor++] = 0;
            outIndices[indexCursor++] = j;
            outIndices[indexCursor++] = j + 1;
        }
    }

    /**
     * Builds geometry for a Skinned Mesh part.
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
        outIndices: Uint32Array | Uint16Array
    ): void {
        const meshVx = this.runtimeManager.getMeshVerticesX();
        const meshVy = this.runtimeManager.getMeshVerticesY();
        const meshUv = this.runtimeManager.getMeshUVs();
        const meshIdx = this.runtimeManager.getMeshIndices();
        const meshVOff = this.runtimeManager.getMeshVertexOffsets();
        const meshIOff = this.runtimeManager.getMeshIndexOffsets();

        const v0 = meshVOff[partIdx];
        const i0 = meshIOff[partIdx];

        const partState = frameData.parts(partIdx);
        const pc = (partState && partState.partColor() >= 0) ? frameData.partsColor(partState.partColor()) : null;
        
        let pc_rate = 1;
        let pc_color = [1,1,1,1];
        let pc_blendType = BlendType.Mix;
        let hasPc = false;

        if (pc) {
            hasPc = true;
            pc_blendType = pc.blendType();
            const lt = pc.lt(); const lt_rgba = lt?.rgba();
            pc_rate = lt?.rate() || 0;
            if (lt_rgba) {
                pc_color = [lt_rgba.r()/255.0, lt_rgba.g()/255.0, lt_rgba.b()/255.0, lt_rgba.a()/255.0];
            }
        }

        for (let v = 0; v < pCount; v++) {
            outPositions[v * 2] = meshVx[v0 + v];
            outPositions[v * 2 + 1] = meshVy[v0 + v];
            outUvs[v * 2] = meshUv[(v0 + v) * 2] * invTexW;
            outUvs[v * 2 + 1] = meshUv[(v0 + v) * 2 + 1] * invTexH;
            
            if (hasPc) {
                outColors[v * 4 + 0] = pc_color[0];
                outColors[v * 4 + 1] = pc_color[1];
                outColors[v * 4 + 2] = pc_color[2];
                outColors[v * 4 + 3] = pc_color[3];
                outCustom0[v * 4 + 0] = pc_rate;
                outCustom0[v * 4 + 1] = pc_blendType === BlendType.Mix ? 1 : 0;
                outCustom0[v * 4 + 2] = pc_blendType === BlendType.Mul ? 1 : 0;
                outCustom0[v * 4 + 3] = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);
            } else {
                outColors[v * 4 + 0] = 1.0; outColors[v * 4 + 1] = 1.0; outColors[v * 4 + 2] = 1.0; outColors[v * 4 + 3] = 1.0;
                outCustom0[v * 4 + 0] = 1.0; outCustom0[v * 4 + 1] = 0; outCustom0[v * 4 + 2] = 1.0; outCustom0[v * 4 + 3] = 0;
            }
        }
        for (let j = 0; j < iCount; j++) {
            outIndices[j] = meshIdx[i0 + j];
        }
    }
}
