import init, { SSRuntimeContext, SSRuntimeResource, InitOutput, WebCoordinateSystem, SSRuntimeEffectSlot, SSRuntimeInstanceSlot, WebEffectEventInfo, WebPlaybackDirection, WebPlaybackStyle } from '../wasm/ssruntime.js';
export { WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle };
import * as flatbuffers from 'flatbuffers';
import type { SoundAsset } from './IAudioManager.js';
import { FrameData } from './ss/runtime/frame-data.js';
import { SsAnimeBinary } from './ss/format/ss-anime-binary.js';
import { AnimationData } from './ss/format/animation-data.js';
import { EffectDrawPlan } from './ss/runtime/effect-draw-plan.js';
import { PartType } from './ss/format/part-type.js';
import { PartTypeEffect } from './ss/format/part-type-effect.js';
import { PartTypeInstance } from './ss/format/part-type-instance.js';
import { DrawBatchKind } from './ss/runtime/draw-batch-kind.js';
import { WasmViewCache } from './WasmViewCache.js';

let wasmMemory: WebAssembly.Memory | null = null;
let initPromise: Promise<InitOutput> | null = null;

export async function initializeWasm(wasmUrl?: string | URL | BufferSource | WebAssembly.Module): Promise<InitOutput> {
    // The bundled runtime is compiled with `+simd128`, so it fails to instantiate on
    // engines without WebAssembly SIMD. Fail fast here with a clear, engine-agnostic
    // message instead of a cryptic `WebAssembly.instantiate` error (shared by every
    // renderer). If a non-SIMD (scalar) build is ever shipped, gate this accordingly.
    if (!detectWasmSimd()) {
        throw new Error(
            '[ssplayer-core] The SpriteStudio WebAssembly runtime requires WebAssembly SIMD (simd128), ' +
            'enabled by default in Chrome/Edge 91+, Firefox 89+, and Safari 16.4+. ' +
            'Catch this error to fall back (e.g. show a static image).'
        );
    }
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

let _simdSupported: boolean | undefined;

/**
 * Detect WebAssembly SIMD (simd128) support in the current engine. Zero-dependency
 * and synchronous: `WebAssembly.validate` accepts the module below only when the
 * engine supports the v128 opcodes it contains. The result is cached.
 *
 * The bundled `ssruntime` is compiled with `+simd128`, so it fails to instantiate
 * on engines where this returns false. Callers should check this first to fail fast
 * with a clear message instead of a cryptic `WebAssembly.instantiate` error. SIMD is
 * enabled by default in Chrome/Edge 91+, Firefox 89+, and Safari 16.4+.
 */
export function detectWasmSimd(): boolean {
    if (_simdSupported === undefined) {
        try {
            // Minimal module with a function returning a v128 (i8x16.splat) — the
            // well-known wasm-feature-detect SIMD probe, inlined to stay dependency-free.
            _simdSupported = WebAssembly.validate(new Uint8Array([
                0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
                10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
            ]));
        } catch {
            _simdSupported = false;
        }
    }
    return _simdSupported;
}

export const finalizationRegistry = new FinalizationRegistry((heldValue: { free: () => void }) => {
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
    private effectPartRefs: { partIndex: number, hash: number, seed: number }[] = [];
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

    /**
     * Index of the currently set-up animation within the SSAB `animations`
     * table, or -1 before setup / if the name didn't resolve. Event polling
     * uses it to read that animation's per-frame events table. Stored as an
     * index (not a FlatBuffer view) so it survives WASM memory growth — the
     * view is re-derived on demand in `getCurrentAnimationData`.
     */
    private currentAnimationIndex: number = -1;

    /**
     * Part names indexed by part index (parallel to the SSAB parts table),
     * cached once per animation so the event dispatch path can attach a part
     * name without decoding a fresh FlatBuffer string per event. `null` before
     * setup. See `getPartName`.
     */
    private partNames: (string | null)[] | null = null;

    // Reuses one TypedArray view per WASM buffer so per-frame reads allocate
    // nothing, and auto-invalidates on memory growth (detach-safe by
    // construction). See WasmViewCache.
    private readonly viewCache = new WasmViewCache(getWasmMemory);

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
        // Part counts and buffer layouts change per animation; drop stale views.
        this.viewCache.clear();

        // Cleanup old effect slots (map value is { slot, visible }).

        this.currentAnimationFps = this.context.get_fps();

        // Reset per-animation event-resolution caches; repopulated below.
        this.currentAnimationIndex = -1;
        this.partNames = null;

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
            const partNames: (string | null)[] = new Array(partsLen).fill(null);
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
                partNames[i] = part.name();
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
            this.partNames = partNames;

            // Cache the index of the animation just set up so event polling can
            // resolve its per-frame events table (matched by name, mirroring the
            // runtime's own name-based setup).
            for (let i = 0; i < ssab.animationsLength(); i++) {
                if (ssab.animations(i)?.name() === animationName) {
                    this.currentAnimationIndex = i;
                    break;
                }
            }

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

            this.effectPartRefs = [];
            for (const idx of effectParts) {
                const hash = refHashByPart.get(idx) ?? fallbackHash;
                if (!hash) continue;
                const seed = (idx >>> 0) ^ (hash >>> 0);
                this.effectPartRefs.push({ partIndex: idx, hash, seed });
            }
        } catch (e) {
            console.warn("Failed to parse SSAB for Effect parts setup.", e);
        }
    }

    public getEffectParts(): { partIndex: number, hash: number, seed: number }[] {
        return this.effectPartRefs;
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


    public update(deltaMs: number): number {
        return this.context.update(deltaMs);
    }

    /**
     * Advance everything that derives from this context's current frame:
     * effect particle slots. Shared by playback `update()` and `seekTo()`.
     */
    /**
     * Jump the playhead and re-evaluate effects for that frame, mirroring the
     * Godot player's `_seek_and_redraw(frame, delta=0, parent_looped=false)`.
     * Effect slots are otherwise only advanced during playback `update()`, so
     * without this a seek would leave particles frozen at their last frame.
     * delta_seconds = 0 means dependent effects snap deterministically to the
     * seeked frame, while the independent real-time clock does not advance
     * (independent effects cannot be seeked — see docs/00_limitations).
     */

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
     * SSAB `AnimationData` for the currently set-up animation, re-derived from
     * the (borrowed) SSAB buffer on each call so the view stays valid across
     * WASM memory growth. `null` before setup or if the name didn't resolve.
     * Event polling reads its per-frame events table via `events(eventIndex)`.
     * Pass `out` to reuse a scratch object and avoid allocation.
     */
    public getCurrentAnimationData(out?: AnimationData): AnimationData | null {
        if (this.currentAnimationIndex < 0 || !this.resource) return null;
        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return null;
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(new flatbuffers.ByteBuffer(buf));
        return ssab.animations(this.currentAnimationIndex, out);
    }

    /**
     * Get all referenced sound assets (name and path) for the currently loaded SSAB.
     */
    public getSounds(): SoundAsset[] {
        if (!this.resource) return [];
        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return [];
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        return SSRuntimeManager.extractSounds(buf);
    }

    /**
     * Cached name of the part at `partIndex` (SSAB parts-table order), or
     * `null` if out of range / before an animation is set up.
     */
    public getPartName(partIndex: number): string | null {
        const names = this.partNames;
        return names && partIndex >= 0 && partIndex < names.length ? names[partIndex] : null;
    }

    /**
     * Retrieves the index of a part based on its name.
     */
    public getPartIndexFromName(partName: string): number {
        const names = this.partNames;
        if (!names) return -1;
        return names.indexOf(partName);
    }

    /**
     * Returns the total number of parts in the current animation.
     */
    public getPartsCount(): number {
        return this.partNames ? this.partNames.length : 0;
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

    public getWorldMatrices(): Float32Array {
        return this.viewCache.view('worldMatrices', this.context.get_world_matrices_buf(), this.context.get_world_matrices_len(), Float32Array);
    }

    public getLocalVertices(): Float32Array {
        return this.viewCache.view('localVertices', this.context.get_local_vertices_buf(), this.context.get_local_vertices_len(), Float32Array);
    }

    public getLocalUVs(): Float32Array {
        return this.viewCache.view('localUVs', this.context.get_local_uvs_buf(), this.context.get_local_uvs_len(), Float32Array);
    }

    public getMeshVerticesX(): Float32Array {
        return this.viewCache.view('meshVerticesX', this.context.get_mesh_vertices_x_buf(), this.context.get_mesh_vertices_x_len(), Float32Array);
    }

    public getMeshVerticesY(): Float32Array {
        return this.viewCache.view('meshVerticesY', this.context.get_mesh_vertices_y_buf(), this.context.get_mesh_vertices_y_len(), Float32Array);
    }

    public getMeshUVs(): Float32Array {
        return this.viewCache.view('meshUVs', this.context.get_mesh_uvs_buf(), this.context.get_mesh_uvs_len(), Float32Array);
    }

    public getMeshIndices(): Int32Array {
        return this.viewCache.view('meshIndices', this.context.get_mesh_indices_buf(), this.context.get_mesh_indices_len(), Int32Array);
    }

    public getMeshVertexOffsets(): Uint32Array {
        return this.viewCache.view('meshVertexOffsets', this.context.get_mesh_vertex_offsets_buf(), this.context.get_mesh_vertex_offsets_len(), Uint32Array);
    }

    public getMeshIndexOffsets(): Int32Array {
        return this.viewCache.view('meshIndexOffsets', this.context.get_mesh_index_offsets_buf(), this.context.get_mesh_index_offsets_len(), Int32Array);
    }

    public getShapeVertexCounts(): Int32Array {
        return this.viewCache.view('shapeVertexCounts', this.context.get_shape_vertex_counts_buf(), this.context.get_shape_vertex_counts_len(), Int32Array);
    }

    public getShapeVertexBoxCoords(): Float32Array {
        return this.viewCache.view('shapeVertexBoxCoords', this.context.get_shape_vertex_box_coords_buf(), this.context.get_shape_vertex_box_coords_len(), Float32Array);
    }

    public getShapeVertices(): Float32Array {
        return this.viewCache.view('shapeVertices', this.context.get_shape_vertices_buf(), this.context.get_shape_vertices_len(), Float32Array);
    }

    /**
     * Parse the SSAB buffer and extract the image paths and their name hashes.
     */
    public static extractTexturePaths(ssabBuffer: Uint8Array): { hash: number, path: string }[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
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
    public static extractPackInfo(ssabBuffer: Uint8Array): { hash: number, name: string | null } {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        return { hash: ssab.nameHash() >>> 0, name: ssab.name() };
    }

    /**
     * Parse the SSAB buffer and collect the unique animation packs referenced
     * by `PartType::Instance` parts (the referenced animation may live in an
     * external pack that the host must load before setup).
     */
    public static extractInstancePackRefs(ssabBuffer: Uint8Array): { hash: number, name: string }[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
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

    /**
     * Parse the SSAB buffer and list its animation names in table order.
     * Engine-agnostic introspection for host UIs (e.g. an animation picker),
     * so consumers don't have to re-implement the FlatBuffer walk.
     */
    public static extractAnimationNames(ssabBuffer: Uint8Array): string[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const out: string[] = [];
        for (let i = 0; i < ssab.animationsLength(); i++) {
            const name = ssab.animations(i)?.name();
            if (name) out.push(name);
        }
        return out;
    }

    /**
     * Parse the SSAB buffer and list all referenced sound assets (name and path).
     * Useful for preloading audio files via the Web Audio API.
     */
    public static extractSounds(ssabBuffer: Uint8Array): SoundAsset[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const seen = new Set<string>();
        const out: SoundAsset[] = [];
        for (let i = 0; i < ssab.soundListsLength(); i++) {
            const soundList = ssab.soundLists(i);
            if (!soundList) continue;
            for (let j = 0; j < soundList.tableDataLength(); j++) {
                const soundFile = soundList.tableData(j);
                const name = soundFile?.name();
                const path = soundFile?.filePath();
                if (name && path && !seen.has(name)) {
                    seen.add(name);
                    out.push({ name, path });
                }
            }
        }
        return out;
    }

    // NOTE: Sequence (.ssqb / SsSequenceBinary) introspection is intentionally
    // not provided here yet (deferred). When added, mirror the SSAB extractors
    // above against the already-exported `ssFormat.SsSequenceBinary` (e.g. a
    // static `extractSequenceNames(ssqbBuffer)`); the schema class is in place,
    // so it is purely additive.

    public setCoordinateSystem(system: WebCoordinateSystem) {
        this.context.set_coordinate_system(system);
    }

    public getFrameData(frame: number): FrameData | null {
        if (this.currentAnimationIndex < 0) return null;
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

    public destroy() {
        if (this.context) {
            this.viewCache.clear();
            finalizationRegistry.unregister(this);
            this.context.free();
            // @ts-ignore
            this.context = null;
        }
    }
}

export { SSRuntimeContext, SSRuntimeResource, SSRuntimeInstanceSlot, SSRuntimeEffectSlot, EffectDrawPlan };
