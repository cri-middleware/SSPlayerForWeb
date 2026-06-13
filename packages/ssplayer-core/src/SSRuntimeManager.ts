import init, { SSRuntimeContext, SSRuntimeResource, InitOutput, WebCoordinateSystem, SSRuntimeEffectSlot, SSRuntimeInstanceSlot, WebEffectEventInfo, WebPlaybackDirection, WebPlaybackStyle } from '../wasm/ssruntime.js';
export { WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle };
import * as flatbuffers from 'flatbuffers';
import { FrameData } from './ss/runtime/frame-data.js';
import { SsAnimeBinary } from './ss/format/ss-anime-binary.js';
import { EffectDrawPlan } from './ss/runtime/effect-draw-plan.js';
import { PartType } from './ss/format/part-type.js';
import { PartTypeEffect } from './ss/format/part-type-effect.js';
import { PartTypeInstance } from './ss/format/part-type-instance.js';
import { DrawBatchKind } from './ss/runtime/draw-batch-kind.js';
import { GeometryBuilder } from './GeometryBuilder.js';

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
        // 3rd arg is the unregister token; without it destroy()'s unregister(this)
        // is a no-op and the GC finalizer would double-free the raw handle.
        finalizationRegistry.register(this, this.raw, this);
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

    /**
     * Per-part static mask flags, packed one byte per part index (parallel to
     * the SSAB parts table). Bits: 0x01 visibleInsideMask, 0x02 maskWrite,
     * 0x04 maskInfluence, 0x08 drawAsMask. Cached once per animation from the
     * SSAB `PartData` so the renderer can resolve mask polarity per part
     * without re-parsing the FlatBuffer each frame. `null` until an animation
     * is set up. See `getPartMaskFlags`.
     */
    private partMaskFlags: Uint8Array | null = null;

    constructor() {
        if (!wasmMemory) throw new Error("WASM module not initialized. Call initializeWasm() first.");
        this.context = new SSRuntimeContext();
        // 3rd arg is the unregister token (see SSABResource) — required so
        // destroy()'s unregister(this) actually cancels the GC finalizer.
        finalizationRegistry.register(this, this.context, this);
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

        // Cleanup old effect slots (map value is { slot, visible }).
        this.effectSlots.forEach(item => {
            try { (item.slot as any)?.free?.(); } catch { /* ignore */ }
        });
        this.effectSlots.clear();

        this.currentAnimationFps = this.context.get_fps();

        if (!this.resource) return;

        try {
            const ptr = this.context.get_ssab_buf();
            const len = this.context.get_ssab_len();
            if (ptr === 0 || len === 0) return;

            const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
            const bb = new flatbuffers.ByteBuffer(buf);
            const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);

            // Collect each effect part's ref-effect hash from the parts table,
            // and cache the static mask flags for every part in the same walk
            // (both are allocation-free reads over the borrowed SSAB view).
            const partsLen = ssab.partsLength();
            const maskFlags = new Uint8Array(partsLen);
            const refHashByPart = new Map<number, number>();
            let fallbackHash = 0;
            for (let i = 0; i < partsLen; i++) {
                const part = ssab.parts(i);
                if (!part) continue;
                let mf = 0;
                if (part.visibleInsideMask()) mf |= 0x01;
                if (part.maskWrite()) mf |= 0x02;
                if (part.maskInfluence()) mf |= 0x04;
                if (part.drawAsMask()) mf |= 0x08;
                maskFlags[i] = mf;
                if (part.partTypeType() === PartType.PartTypeEffect) {
                    const effectPart = part.partType(new PartTypeEffect());
                    if (effectPart) {
                        const h = effectPart.refEffectNameHash() >>> 0;
                        refHashByPart.set(i, h);
                        fallbackHash = h;
                    }
                }
            }
            this.partMaskFlags = maskFlags;
            // Single-effect assets: fall back to the lone effect definition's hash.
            if (fallbackHash === 0 && ssab.effectsLength() > 0) {
                fallbackHash = (ssab.effects(0)?.nameHash() ?? 0) >>> 0;
            }

            // Authoritative enumeration: the runtime emits a DrawBatchKind.Effect
            // batch for every effect part. Union it with the parts-table scan so
            // we never miss a part the table walk under-reported.
            const effectParts = new Set<number>(refHashByPart.keys());
            const fd = this.getFrameData(this.context.get_start_frame());
            const drawOrder = fd?.drawOrderArray();
            if (fd && drawOrder) {
                for (let b = 0; b < fd.drawBatchesLength(); b++) {
                    const batch = fd.drawBatches(b);
                    if (batch && batch.kind() === DrawBatchKind.Effect) {
                        const start = batch.startRank();
                        for (let c = 0; c < batch.count(); c++) effectParts.add(drawOrder[start + c]);
                    }
                }
            }

            for (const idx of effectParts) {
                const hash = refHashByPart.get(idx) ?? fallbackHash;
                if (!hash) continue;
                // simple seed logic similar to SpriteStudio standard
                const seed = (idx >>> 0) ^ (hash >>> 0);
                try {
                    const slot = SSRuntimeEffectSlot.create(this.resource.raw, hash, seed);
                    this.effectSlots.set(idx, { slot, visible: false });
                } catch (e) {
                    console.error(`Failed to create EffectSlot for part ${idx}`, e);
                }
            }
        } catch (e) {
            console.warn("Failed to parse SSAB for Effect parts setup.", e);
        }
    }

    public getInstanceParts(): { partIndex: number, packHash: number, animeName: string, packName: string | null }[] {
        if (!this.resource) return [];

        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return [];
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(new flatbuffers.ByteBuffer(buf));

        const refs: { partIndex: number, packHash: number, animeName: string, packName: string | null }[] = [];
        for (let i = 0; i < ssab.partsLength(); i++) {
            const part = ssab.parts(i);
            if (!part || part.partTypeType() !== PartType.PartTypeInstance) continue;
            const inst = part.partType(new PartTypeInstance()) as PartTypeInstance | null;
            if (!inst) continue;
            const animeName = inst.refAnimeName();
            if (!animeName) continue;
            refs.push({ partIndex: i, packHash: inst.refAnimePackHash() >>> 0, animeName, packName: inst.refAnimePack() });
        }
        return refs;
    }


    public update(deltaMs: number) {
        // The runtime's playback controller measures time in milliseconds
        // (update_interval = 1000 / fps), so the raw delta is passed straight
        // through. Effect/instance slots, however, simulate in seconds
        // (delta_frames = delta_seconds * fps), so they get the converted value.
        this.context.update(deltaMs);
        this.stepDependents(deltaMs / 1000.0, this.context.is_looped());
    }

    /**
     * Advance everything that derives from this context's current frame:
     * effect particle slots. Shared by playback `update()` and `seekTo()`.
     */
    public stepDependents(deltaSeconds: number, parentLooped: boolean) {
        this.stepEffectSlots(deltaSeconds, parentLooped);
    }

    /**
     * Jump the playhead and re-evaluate effects for that frame, mirroring the
     * Godot player's `_seek_and_redraw(frame, delta=0, parent_looped=false)`.
     * Effect slots are otherwise only advanced during playback `update()`, so
     * without this a seek would leave particles frozen at their last frame.
     * delta_seconds = 0 means dependent effects snap deterministically to the
     * seeked frame, while the independent real-time clock does not advance
     * (independent effects cannot be seeked — see docs/00_limitations).
     */
    public seekTo(frame: number) {
        this.context.set_frame_no(frame);
        this.stepDependents(0, false);
    }

    private stepEffectSlots(deltaSeconds: number, parentLooped: boolean) {
        if (this.effectSlots.size === 0) return;

        const frame = this.context.get_frame_no();
        for (const [partIndex, item] of this.effectSlots.entries()) {
            const ev = this.context.get_active_effect_event(partIndex);
            if (ev) {
                // y_flip = true for PixiJS (y-down), vert_stride = 2 (x,y)
                item.visible = item.slot.step(ev, frame, deltaSeconds, this.currentAnimationFps, parentLooped, true, 2);
                if ((ev as any).free) (ev as any).free();
            } else {
                item.visible = false;
            }
        }
    }



    /**
     * Static per-part mask flags for the current animation (one byte per part
     * index, parallel to the SSAB parts table), or `null` before setup. Bits:
     * 0x01 visibleInsideMask, 0x02 maskWrite, 0x04 maskInfluence,
     * 0x08 drawAsMask. The renderer reads `visibleInsideMask` to decide a
     * masked part's clip polarity (show inside vs. outside the mask region);
     * the runtime already encodes per-part mask participation in the draw
     * batches (`DrawBatchKind.Mask` for contributors, `flags & 0x01` for
     * masked content), so this is only needed for the polarity bit.
     */
    public getPartMaskFlags(): Uint8Array | null {
        return this.partMaskFlags;
    }

    /**
     * Extract the 2D affine of a part's world matrix as [m00, m01, m10, m11,
     * tx, ty] (copied out of WASM memory, so safe to retain). Used to place an
     * instance-part child under its parent. Pass `out` to avoid allocation.
     */
    public getWorldMatrix2D(partIndex: number, out?: Float32Array): Float32Array {
        const m = this.getWorldMatrices();
        const o = partIndex * 16;
        const r = out ?? new Float32Array(6);
        r[0] = m[o + 0]; r[1] = m[o + 4]; r[2] = m[o + 1]; r[3] = m[o + 5]; r[4] = m[o + 12]; r[5] = m[o + 13];
        return r;
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

    /**
     * Read a pack's own name and name-hash from its SSAB buffer.
     */
    public static extractPackInfo(ssabBuffer: ArrayBuffer): { hash: number, name: string | null } {
        const bb = new flatbuffers.ByteBuffer(new Uint8Array(ssabBuffer));
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        return { hash: ssab.nameHash() >>> 0, name: ssab.name() };
    }

    /**
     * Parse the SSAB buffer and collect the unique animation packs referenced
     * by `PartType::Instance` parts (the referenced animation may live in an
     * external pack that the host must load before setup).
     */
    public static extractInstancePackRefs(ssabBuffer: ArrayBuffer): { hash: number, name: string }[] {
        const bb = new flatbuffers.ByteBuffer(new Uint8Array(ssabBuffer));
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const seen = new Set<number>();
        const out: { hash: number, name: string }[] = [];
        for (let i = 0; i < ssab.partsLength(); i++) {
            const part = ssab.parts(i);
            if (!part || part.partTypeType() !== PartType.PartTypeInstance) continue;
            const inst = part.partType(new PartTypeInstance()) as PartTypeInstance | null;
            if (!inst) continue;
            const hash = inst.refAnimePackHash() >>> 0;
            const name = inst.refAnimePack();
            if (name && !seen.has(hash)) {
                seen.add(hash);
                out.push({ hash, name });
            }
        }
        return out;
    }

    public setCoordinateSystem(system: WebCoordinateSystem) {
        this.context.set_coordinate_system(system);
    }

    public getFrameData(frame: number): FrameData | null {
        try {
            // Subframe playback advances the playhead continuously, so at the
            // end/loop boundary get_frame_no() briefly returns a value in
            // (end_frame, end_frame + 1). The runtime only accepts
            // [start_frame, end_frame] and otherwise errors with InvalidParameter,
            // which would blank the whole frame. Clamp the boundary overshoot to
            // the last real frame; in-range subframe values pass through unchanged.
            const start = this.context.get_start_frame();
            const end = this.context.get_end_frame();
            const clamped = frame < start ? start : (frame > end ? end : frame);
            const ptr = this.context.get_frame_data_buf(clamped);
            const len = this.context.get_frame_data_len(clamped);
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
            this.effectSlots.forEach(item => {
                try { (item.slot as any)?.free?.(); } catch { /* ignore */ }
            });
            this.effectSlots.clear();

            finalizationRegistry.unregister(this);
            this.context.free();
            // @ts-ignore
            this.context = null;
        }
    }
}

export { SSRuntimeContext, SSRuntimeResource, SSRuntimeInstanceSlot };
