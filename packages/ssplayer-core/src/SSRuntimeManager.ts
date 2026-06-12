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

/**
 * A live instance-part child. Each `PartType::Instance` part in an animation
 * references another animation; we play that reference in its own
 * `SSRuntimeManager` (so the child's own effects and nested instances recurse
 * naturally) driven by an `SSRuntimeInstanceSlot`. The slot resolves the child
 * frame from the parent's per-frame `EventInstance` data and timing.
 */
export interface InstanceChild {
    slot: SSRuntimeInstanceSlot;
    manager: SSRuntimeManager;
    geometryBuilder: GeometryBuilder;
    /** Child frame_no before the most recent step — feeds independent loop-edge detection. */
    prevChildFrame: number;
    visible: boolean;
    /**
     * Persistent scratch holding this child's accumulated parent transform
     * (2D affine, [m00,m01,m10,m11,tx,ty]) for the current frame. Owned per
     * child so the renderer can compose into it without per-frame allocation;
     * stable for the duration of the child's (possibly nested) render.
     */
    parentMatrix: Float32Array;
}

export class SSRuntimeManager {
    public context: SSRuntimeContext;
    private effectSlots: Map<number, {slot: SSRuntimeEffectSlot, visible: boolean}> = new Map();
    private instanceSlots: Map<number, InstanceChild> = new Map();
    /**
     * pack-name-hash -> resource for every animation pack reachable from this
     * animation through instance references (including this manager's own pack).
     * Shared by reference with every child so nested instances resolve against
     * the same loaded set. Populated by the host (DirectInternalPlayer) which
     * owns fetching; this manager only reads it to bind child contexts.
     */
    private instancePackResources: Map<number, SSABResource> = new Map();
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

        // Cleanup old instance children (free child runtimes recursively + slots).
        this.instanceSlots.forEach(child => {
            try { child.manager.destroy(); } catch { /* ignore */ }
            try { (child.slot as any)?.free?.(); } catch { /* ignore */ }
        });
        this.instanceSlots.clear();

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

            this.setupInstanceChildren();
        } catch (e) {
            console.warn("Failed to parse SSAB for Effect/Instance parts setup.", e);
        }
    }

    /**
     * Walk the parts table and create a child runtime for every
     * `PartType::Instance` part. The referenced animation is looked up in
     * `instancePackResources` by its pack-name-hash; the child binds that
     * resource, inherits this manager's coordinate system / render mode, and is
     * set up recursively (so the child's own effects and nested instances are
     * created too). Resolution of the per-frame playback parameters is left to
     * the runtime via `get_active_event_instance` at step time.
     */
    private setupInstanceChildren() {
        if (!this.resource) return;

        // Re-derive a fresh SSAB view: earlier effect-slot creation may have
        // grown (and detached) the WASM-memory buffer the parser reads from.
        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return;
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(new flatbuffers.ByteBuffer(buf));

        // Snapshot every instance part's reference into plain JS values FIRST.
        // `ssab` is a view over WASM memory; creating a child context below
        // allocates WASM memory, which may grow (and detach) the backing buffer
        // — so reading `ssab` after the first child would yield garbage. (Reads
        // here are allocation-free, so the snapshot completes against a valid
        // view.) The effect-slot setup above uses the same collect-then-create
        // pattern.
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

        for (const ref of refs) {
            const resource = this.instancePackResources.get(ref.packHash);
            if (!resource) {
                console.warn(`Instance part ${ref.partIndex} references pack "${ref.packName}" (hash ${ref.packHash}) which is not loaded; skipping.`);
                continue;
            }

            try {
                const childManager = new SSRuntimeManager();
                // Share the loaded-pack registry so nested instances resolve.
                childManager.instancePackResources = this.instancePackResources;
                childManager.bindResource(resource);
                childManager.context.set_coordinate_system(this.context.get_coordinate_system());
                childManager.context.set_render_mode(this.context.get_render_mode());
                childManager.setupAnimation(ref.animeName);

                const slot = SSRuntimeInstanceSlot.create();
                const geometryBuilder = new GeometryBuilder(childManager);
                this.instanceSlots.set(ref.partIndex, {
                    slot,
                    manager: childManager,
                    geometryBuilder,
                    prevChildFrame: childManager.context.get_frame_no(),
                    visible: false,
                    parentMatrix: new Float32Array(6),
                });
            } catch (e) {
                console.error(`Failed to create instance child for part ${ref.partIndex} ("${ref.animeName}")`, e);
            }
        }
    }

    /**
     * Register the pack-hash -> resource map used to resolve instance-part
     * references. Must be called before `setupAnimation` so child runtimes can
     * be bound. The map is shared by reference with all descendant children.
     */
    public setInstancePackResources(resources: Map<number, SSABResource>) {
        this.instancePackResources = resources;
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
     * effect particle slots and instance-part children (each recursing into
     * its own dependents). Shared by playback `update()` and `seekTo()`.
     */
    public stepDependents(deltaSeconds: number, parentLooped: boolean) {
        this.stepEffectSlots(deltaSeconds, parentLooped);
        this.stepInstanceSlots(deltaSeconds, parentLooped);
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
     * Drive each instance-part child for one tick. For every instance part we
     * fetch its resolved per-frame `EventInstance` (the runtime returns SS6
     * synthetic defaults when none is authored) and hand it, with the child
     * context and timing, to the slot — which configures the child's playback
     * on transition edges and advances its frame (synced seek or independent
     * delta-time). On a transition we mirror the reference player's host-side
     * `play()` so the child snaps to its section start and begins advancing.
     * Each child then recurses into its own dependents using the child frame
     * and the slot's reported loop state.
     */
    private stepInstanceSlots(deltaSeconds: number, parentLooped: boolean) {
        if (this.instanceSlots.size === 0) return;

        const parentFrame = this.context.get_frame_no();
        for (const [partIndex, child] of this.instanceSlots.entries()) {
            const ev = this.context.get_active_event_instance(partIndex);
            const visible = child.slot.step(ev, child.manager.context, child.prevChildFrame, parentFrame, deltaSeconds, parentLooped);
            if ((ev as any).free) (ev as any).free();

            child.visible = visible;
            if (child.slot.transitioned()) {
                child.manager.context.play();
            }
            child.prevChildFrame = child.manager.context.get_frame_no();

            // Advance the child's own effects / nested instances relative to the
            // child's frame and loop state.
            child.manager.stepDependents(deltaSeconds, child.slot.child_looped());
        }
    }

    /**
     * The live child runtime for an instance part (or undefined for a
     * non-instance / unresolved part). Renderers read `visible`, the child
     * `manager` (its frame data, world matrices, buffers) and the child's
     * dedicated `geometryBuilder`.
     */
    public getInstanceChild(partIndex: number): InstanceChild | undefined {
        return this.instanceSlots.get(partIndex);
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

            // Free instance children recursively (child contexts + their slots).
            // The bound pack resources are owned by the host, not freed here.
            this.instanceSlots.forEach(child => {
                try { child.manager.destroy(); } catch { /* ignore */ }
                try { (child.slot as any)?.free?.(); } catch { /* ignore */ }
            });
            this.instanceSlots.clear();

            finalizationRegistry.unregister(this);
            this.context.free();
            // @ts-ignore
            this.context = null;
        }
    }
}

export { SSRuntimeContext, SSRuntimeResource };
