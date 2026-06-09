import init, { SSRuntimeContext, SSRuntimeResource, InitOutput, WebCoordinateSystem, SSRuntimeEffectSlot, WebEffectEventInfo, WebPlaybackDirection, WebPlaybackStyle } from '../wasm/ssruntime.js';
export { WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle };
import * as flatbuffers from 'flatbuffers';
import { FrameData } from './fbs/ss/runtime/frame-data.js';
import { SsAnimeBinary } from './fbs/ss/format/ss-anime-binary.js';
import { EffectDrawPlan } from './fbs/ss/runtime/effect-draw-plan.js';
import { PartType } from './fbs/ss/format/part-type.js';
import { PartTypeEffect } from './fbs/ss/format/part-type-effect.js';

let wasmMemory: WebAssembly.Memory | null = null;
let initPromise: Promise<InitOutput> | null = null;

export async function initializeWasm(wasmUrl?: string | URL): Promise<InitOutput> {
    if (!initPromise) {
        initPromise = init({ module_or_path: wasmUrl }).then(output => {
            wasmMemory = output.memory;
            return output;
        });
    }
    return initPromise;
}

export function getWasmMemory(): WebAssembly.Memory {
    if (!wasmMemory) throw new Error("WASM is not initialized");
    return wasmMemory;
}

const finalizationRegistry = new FinalizationRegistry((heldValue: { free: () => void }) => {
    try {
        heldValue.free();
    } catch (e) {
        console.warn("Error freeing WASM resource in FinalizationRegistry", e);
    }
});

export class SSABResource {
    public raw: SSRuntimeResource;

    constructor(data: Uint8Array) {
        this.raw = new SSRuntimeResource(data);
        finalizationRegistry.register(this, this.raw);
    }

    public destroy() {
        if (this.raw) {
            finalizationRegistry.unregister(this);
            this.raw.free();
            // @ts-ignore
            this.raw = null;
        }
    }
}

export class SSRuntimeManager {
    public context: SSRuntimeContext;
    private effectSlots: Map<number, {slot: SSRuntimeEffectSlot, visible: boolean}> = new Map();
    private resource: SSABResource | null = null;
    private currentAnimationFps: number = 30;

    constructor() {
        if (!wasmMemory) throw new Error("WASM module not initialized. Call initializeWasm() first.");
        this.context = new SSRuntimeContext();
        finalizationRegistry.register(this, this.context);
    }

    public bindResource(resource: SSABResource) {
        this.resource = resource;
        this.context.bind_resource(resource.raw);
    }

    public loadSsab(data: Uint8Array): boolean {
        return this.context.load_ssab_borrow(data);
    }

    public setupAnimation(animationName: string) {
        this.context.setup_animation(animationName);
        
        // Cleanup old effect slots
        this.effectSlots.forEach(slot => {
            if ((slot as any).free) (slot as any).free();
        });
        this.effectSlots.clear();

        if (!this.resource) return;

        try {
            const ptr = this.context.get_ssab_buf();
            const len = this.context.get_ssab_len();
            if (ptr === 0 || len === 0) return;

            const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
            const bb = new flatbuffers.ByteBuffer(buf);
            const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);

            let effectCount = 0;
            for (let i = 0; i < ssab.partsLength(); i++) {
                const part = ssab.parts(i);
                if (!part) continue;
                if (part.partTypeType() === PartType.PartTypeEffect) {
                    const effectPart = part.partType(new PartTypeEffect());
                    if (effectPart) {
                        const refHash = effectPart.refEffectNameHash();
                        // simple seed logic similar to SpriteStudio standard
                        const seed = (i >>> 0) ^ (refHash >>> 0); 
                        try {
                            const slot = SSRuntimeEffectSlot.create(this.resource.raw, refHash, seed);
                            this.effectSlots.set(i, { slot, visible: false });
                            effectCount++;
                        } catch (e) {
                            console.error(`Failed to create EffectSlot for part ${i}`, e);
                        }
                    }
                }
            }
            console.log(`[SSRuntimeManager] setupAnimation: created ${effectCount} EffectSlots`);
        } catch (e) {
            console.warn("Failed to parse SSAB for Effect parts setup.", e);
        }

        this.currentAnimationFps = this.context.get_fps();
    }


    public update(delta: number) {
        // Assume delta is in seconds if it's very small (< 1.0)
        // If delta is around 16.66 (milliseconds), convert to seconds.
        const deltaSeconds = delta > 1.0 ? delta / 1000.0 : delta;

        this.context.update(deltaSeconds);

        if (this.effectSlots.size > 0) {
            const frame = this.context.get_frame_no();
            const isLooped = this.context.is_looped();

            for (const [partIndex, item] of this.effectSlots.entries()) {
                const ev = this.context.get_active_effect_event(partIndex);
                if (ev) {
                    // y_flip = true for PixiJS (y-down), vert_stride = 2 (x,y)
                    item.visible = item.slot.step(ev, frame, deltaSeconds, this.currentAnimationFps, isLooped, true, 2);
                    if ((ev as any).free) (ev as any).free();
                } else {
                    item.visible = false;
                }
            }
        }
    }

    public getEffectDrawPlan(partIndex: number): EffectDrawPlan | null {
        const item = this.effectSlots.get(partIndex);
        if (!item || !item.visible) return null;

        const ptr = item.slot.get_draw_plan_buf();
        const len = item.slot.get_draw_plan_len();
        if (ptr === 0 || len === 0) return null;

        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const bb = new flatbuffers.ByteBuffer(buf);
        return EffectDrawPlan.getRootAsEffectDrawPlan(bb);
    }

    public getWorldMatrices(): Float32Array {
        const ptr = this.context.get_world_matrices_buf();
        const len = this.context.get_world_matrices_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getLocalVertices(): Float32Array {
        const ptr = this.context.get_local_vertices_buf();
        const len = this.context.get_local_vertices_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getLocalUVs(): Float32Array {
        const ptr = this.context.get_local_uvs_buf();
        const len = this.context.get_local_uvs_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getMeshVerticesX(): Float32Array {
        const ptr = this.context.get_mesh_vertices_x_buf();
        const len = this.context.get_mesh_vertices_x_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getMeshVerticesY(): Float32Array {
        const ptr = this.context.get_mesh_vertices_y_buf();
        const len = this.context.get_mesh_vertices_y_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getMeshUVs(): Float32Array {
        const ptr = this.context.get_mesh_uvs_buf();
        const len = this.context.get_mesh_uvs_len();
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getMeshIndices(): Int32Array {
        const ptr = this.context.get_mesh_indices_buf();
        const len = this.context.get_mesh_indices_len();
        return new Int32Array(getWasmMemory().buffer, ptr, len);
    }

    public getMeshVertexOffsets(): Uint32Array {
        const ptr = this.context.get_mesh_vertex_offsets_buf();
        const len = this.context.get_mesh_vertex_offsets_len();
        return new Uint32Array(getWasmMemory().buffer, ptr, len);
    }

    public getMeshIndexOffsets(): Int32Array {
        const ptr = this.context.get_mesh_index_offsets_buf();
        const len = this.context.get_mesh_index_offsets_len();
        return this.getInt32Array(ptr, len);
    }

    public getShapeVertexCounts(): Int32Array {
        const ptr = this.context.get_shape_vertex_counts_buf();
        const len = this.context.get_shape_vertex_counts_len();
        return this.getInt32Array(ptr, len);
    }

    public getShapeVertexBoxCoords(): Float32Array {
        const ptr = this.context.get_shape_vertex_box_coords_buf();
        const len = this.context.get_shape_vertex_box_coords_len();
        return this.getFloat32Array(ptr, len);
    }

    public getShapeVertices(): Float32Array {
        const ptr = this.context.get_shape_vertices_buf();
        const len = this.context.get_shape_vertices_len();
        return this.getFloat32Array(ptr, len);
    }

    /**
     * Parse the SSAB buffer and extract the image paths and their name hashes.
     */
    public static extractTexturePaths(ssabBuffer: ArrayBuffer): { hash: number, path: string }[] {
        const bb = new flatbuffers.ByteBuffer(new Uint8Array(ssabBuffer));
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const results: { hash: number, path: string }[] = [];
        
        for (let i = 0; i < ssab.cellmapsLength(); i++) {
            const cellmap = ssab.cellmaps(i);
            if (cellmap) {
                const path = cellmap.imagePath();
                const hash = cellmap.nameHash();
                if (path) {
                    results.push({ hash, path });
                }
            }
        }
        
        return results;
    }

    public setCoordinateSystem(system: WebCoordinateSystem) {
        this.context.set_coordinate_system(system);
    }

    public getFrameData(frame: number): FrameData | null {
        try {
            const ptr = this.context.get_frame_data_buf(frame);
            const len = this.context.get_frame_data_len(frame);
            if (ptr === 0 || len === 0) return null;
            
            const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
            const bb = new flatbuffers.ByteBuffer(buf);
            return FrameData.getRootAsFrameData(bb);
        } catch (e) {
            console.error(`WASM get_frame_data error at frame ${frame}:`, e);
            return null;
        }
    }

    public getFloat32Array(ptr: number, len: number): Float32Array {
        return new Float32Array(getWasmMemory().buffer, ptr, len);
    }

    public getInt32Array(ptr: number, len: number): Int32Array {
        return new Int32Array(getWasmMemory().buffer, ptr, len);
    }

    public getUint16Array(ptr: number, len: number): Uint16Array {
        return new Uint16Array(getWasmMemory().buffer, ptr, len);
    }

    public destroy() {
        if (this.context) {
            this.effectSlots.forEach(slot => {
                if ((slot as any).free) (slot as any).free();
            });
            this.effectSlots.clear();

            finalizationRegistry.unregister(this);
            this.context.free();
            // @ts-ignore
            this.context = null;
        }
    }
}

export { SSRuntimeContext, SSRuntimeResource };
