import init, { SSRuntimeContext, SSRuntimeResource, InitOutput, WebCoordinateSystem, SSRuntimeEffectSlot, SSRuntimeInstanceSlot, WebEffectEventInfo, WebPlaybackDirection, WebPlaybackStyle, ss_runtime_hash_string } from '../wasm/ssruntime.js';
export { WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle };
import { CellMap } from './ss/format/cell-map.js';
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

export async function initializeWasm(
    wasmUrl?: string | URL | BufferSource | WebAssembly.Module,
    opts?: { requireSimd?: boolean },
): Promise<InitOutput> {
    // The default runtime build is compiled with `+simd128`, so it fails to
    // instantiate on engines without WebAssembly SIMD. Fail fast here with a clear,
    // engine-agnostic message instead of a cryptic `WebAssembly.instantiate` error.
    // Consumers that bundle the scalar (no-SIMD) build — e.g. ssplayer-rmmz for
    // RPG Maker MZ / NW.js — pass `requireSimd: false` to skip this precondition.
    if ((opts?.requireSimd ?? true) && !detectWasmSimd()) {
        throw new Error(
            '[ssplayer-core] The SpriteStudio WebAssembly runtime requires WebAssembly SIMD (simd128), ' +
            'enabled by default in Chrome/Edge 91+, Firefox 89+, and Safari 16.4+. ' +
            'Catch this error to fall back (e.g. show a static image).'
        );
    }
    // With no explicit source, the wasm-bindgen glue self-locates via
    // `new URL('ssruntime_bg.wasm', import.meta.url)`. That only works where
    // `import.meta.url` survives bundling — an ESM build. In an IIFE/classic
    // <script> build there is no import.meta, so bundlers rewrite it to a stub
    // whose `.url` is undefined and the glue throws a bare
    // "Failed to construct 'URL': Invalid URL" that says nothing about wasm.
    // Detect the situation up front and say what the caller actually has to do.
    // ASCII only: this string ends up inside the IIFE bundles, which load through
    // a classic <script>. A host that serves .js without `charset=utf-8` makes the
    // browser decode the file as latin-1, and any non-ASCII byte here would show
    // up mangled in the one message a stuck consumer has to go on.
    if (wasmUrl === undefined && typeof (import.meta as { url?: unknown } | undefined)?.url !== 'string') {
        throw new Error(
            '[ssplayer-core] No WebAssembly URL given and the runtime cannot locate itself in this build ' +
            '(a classic <script> / IIFE bundle has no import.meta.url). Pass the URL of ' +
            "`ssruntime_bg.wasm` explicitly, e.g. initialize('https://cdn.jsdelivr.net/npm/" +
            "@spritestudio/ssplayer-core@<version>/wasm/ssruntime_bg.wasm'), pinning the SAME version " +
            'as the player bundle, since the two share a wasm ABI.'
        );
    }
    if (!initPromise) {
        initPromise = init({ module_or_path: wasmUrl }).then(output => {
            wasmMemory = output.memory;
            return output;
        }).catch(e => {
            // Only a SUCCESSFUL init is cached. Caching the rejection too would
            // poison the module for the lifetime of the page: a transient fetch
            // failure would make every later call (a host retry, or a second
            // player created after the network recovered) return that same
            // rejected promise and never start.
            initPromise = null;
            throw e;
        });
    }
    return initPromise;
}

export function getWasmMemory(): WebAssembly.Memory {
    if (!wasmMemory) throw new Error("WASM is not initialized");
    return wasmMemory;
}

/**
 * FNV-1a hash of `name`, computed by the runtime itself so it always matches the
 * hashes baked into the SSAB (cell-map / cell / animation names). Needed by the
 * name-keyed runtime calls that take a hash rather than a string — the cell
 * override in particular.
 *
 * The empty string maps to 0 without entering WASM, which is also the "follow
 * the animation" sentinel for the cell override.
 */
export function hashString(name: string): number {
    return name ? ss_runtime_hash_string(name) >>> 0 : 0;
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
    // Players holding this resource. Only a pack shared by URL (SharedPacks) has
    // more than one; each holder releases it with one destroy(), and the runtime
    // resource is freed with the last.
    private _holders = 1;
    /** Called once the runtime resource has been freed. */
    public onFreed: (() => void) | null = null;

    constructor(data: Uint8Array) {
        // The runtime parses a pack without verifying it, so gate here, the one
        // place bytes enter it, on the "SSAB" file identifier: a truncated
        // download or the wrong file becomes this error instead of the runtime
        // walking offsets it read from the wrong bytes. It is not a structural
        // check — a crafted pack still passes (see SECURITY.md).
        if (!SsAnimeBinary.bufferHasIdentifier(new flatbuffers.ByteBuffer(data))) {
            throw new Error(
                `[SSPlayer] Not a .ssab buffer: expected the "SSAB" file identifier at bytes 4..8 ` +
                `(got ${data.length} bytes). The .ssab may be truncated, the wrong file, or a different format.`,
            );
        }
        this.raw = new SSRuntimeResource(data);
        // 3rd arg is the unregister token; without it destroy()'s unregister(this)
        // is a no-op and the GC finalizer would double-free the raw handle.
        finalizationRegistry.register(this, this.raw, this);
    }

    /** One more player holds this resource, and will destroy() it once. */
    public retain(): this {
        this._holders++;
        return this;
    }

    public destroy() {
        if (!this.raw || --this._holders > 0) return;
        finalizationRegistry.unregister(this);
        this.raw.free();
        // @ts-ignore
        this.raw = null;
        this.onFreed?.();
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
     * Per-part "is a skinned mesh" flag, one byte per part index (parallel to
     * the SSAB parts table): 1 when the part carries a `mesh_binding` with at
     * least one influence bone, 0 otherwise. A static property of the asset,
     * cached once per animation from the same SSAB walk as `partMaskFlags`.
     * `null` until an animation is set up. See `getPartSkinnedFlag`, which
     * backs {@link InternalPlayerBase.isPartSkinnedMesh} — a skinned mesh's
     * node transform is not where its art is drawn, so it is a poor
     * part-following target.
     */
    private partSkinnedFlags: Uint8Array | null = null;

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
    private readonly _scratchFrameData = new FrameData();
    private readonly _lastFrameData = new FrameData();
    private _lastFrameBytes: Uint8Array | null = null;
    private _lastFrameBuffer: flatbuffers.ByteBuffer | null = null;

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

    public setupAnimation(animationName: string) {
        this.context.setup_animation(animationName);
        // Part counts and buffer layouts change per animation; drop stale views.
        this.viewCache.clear();

        // Cleanup old effect slots (map value is { slot, visible }).

        this.currentAnimationFps = this.context.get_frame_rate();

        // Reset every per-animation cache; repopulated below. All of them must be
        // dropped here, not just before a successful walk: on the early return
        // below (no resource) or on a throw (caught at the bottom), leftovers from
        // the PREVIOUS animation would be read against the new animation's part
        // indices — wrong mask polarity, and effect slots bound to the wrong parts.
        this.currentAnimationIndex = -1;
        this.partNames = null;
        this.partMaskFlags = null;
        this.partSkinnedFlags = null;
        this.effectPartRefs = [];

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
            const skinnedFlags = new Uint8Array(partsLen);
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
                // Skinned = bound to bones. A rigid (deform-only) mesh has a
                // mesh_binding but no influence bones, and follows correctly, so
                // the bone count — not the presence of the binding — is what marks it.
                if ((part.meshBinding()?.influenceBoneLength() ?? 0) > 0) skinnedFlags[i] = 1;
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
            this.partSkinnedFlags = skinnedFlags;
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
     * (independent effects cannot be seeked).
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
     * Cell-map names in the bound SSAB (table order, no `.ssce` extension) —
     * the cell-override target namespace. Empty before a resource is bound.
     */
    public getCellmapNames(): string[] {
        if (!this.resource) return [];
        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return [];
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        return SSRuntimeManager.extractCellMapNames(buf);
    }

    /**
     * Cell names inside `cellmapName` in the bound SSAB (empty if that map isn't
     * in this SSAB). Pair with {@link getCellmapNames} to discover the valid
     * targets of a cell override.
     */
    public getCellNames(cellmapName: string): string[] {
        if (!this.resource) return [];
        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return [];
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        return SSRuntimeManager.extractCellNames(buf, cellmapName);
    }

    /**
     * Names that {@link InternalPlayerBase.setCellmapTexture} can replace at
     * runtime, in table order: every cell-map name (no `.ssce` extension, e.g.
     * `common`) followed by every external-texture file name (e.g. `common.png`).
     * Both are valid replacement targets because `DrawBatch.texture_hash` is
     * keyed from both namespaces — a cell-map's own name normally, and the
     * texture file name on frames a TextureChange (`TCHG`) applies. Empty before
     * a resource is bound.
     *
     * Unlike {@link getCellmapNames} (cell-override targets — cell-map names
     * only), this is the texture-replacement discovery list; the two differ
     * whenever the SSAB carries any `TCHG` targets.
     */
    public getReplaceableTextureNames(): string[] {
        if (!this.resource) return [];
        const ptr = this.context.get_ssab_buf();
        const len = this.context.get_ssab_len();
        if (ptr === 0 || len === 0) return [];
        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        return SSRuntimeManager.extractReplaceableTextureNames(buf);
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
     * Part names in part-index order, empty before an animation is set up.
     *
     * A part authored without a name reads as the empty string rather than
     * being skipped, so the list stays index-aligned with the parts table and
     * with the `partIndex` every event carries.
     */
    public getPartNames(): string[] {
        const names = this.partNames;
        return names ? names.map((n) => n ?? '') : [];
    }

    /**
     * Returns the total number of parts in the current animation.
     */
    public getPartsCount(): number {
        return this.partNames ? this.partNames.length : 0;
    }

    /**
     * Whether the part at `index` is a skinned (bone-bound) mesh, from the
     * per-animation cache. Out-of-range or before setup reads as false. See
     * {@link InternalPlayerBase.isPartSkinnedMesh} for the contract.
     */
    public getPartSkinnedFlag(index: number): boolean {
        return !!this.partSkinnedFlags && index >= 0 && index < this.partSkinnedFlags.length
            ? this.partSkinnedFlags[index] === 1
            : false;
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
     *
     * Two tables feed this, because `DrawBatch.texture_hash` is drawn from two
     * namespaces: a cell-map's own name hash for an ordinary part, and a texture
     * FILE-name hash for a part whose drawing applies a texture change (`TCHG`).
     * The latter live in `external_textures`, so a player that reads only
     * `cellmaps` leaves those batches without a texture and drops the part. Both
     * go into one hash-keyed list, exactly as the runtime looks them up.
     */
    public static extractTexturePaths(ssabBuffer: Uint8Array): { hash: number, path: string }[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // These static extractors run on raw, possibly untrusted `.ssab` bytes
        // (e.g. drag-and-drop). FlatBuffers generates no verifier, so gate on the
        // "SSAB" file identifier and bail out on any non-SSAB / truncated buffer
        // instead of walking file-controlled offsets and vector lengths.
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const results: { hash: number, path: string }[] = [];
        const seen = new Set<number>();

        for (let i = 0; i < ssab.cellmapsLength(); i++) {
            const cellmap = ssab.cellmaps(i);
            if (cellmap) {
                const path = cellmap.imagePath();
                const hash = cellmap.nameHash() >>> 0;
                if (path && !seen.has(hash)) {
                    seen.add(hash);
                    results.push({ hash, path });
                }
            }
        }

        // Texture-change targets. `name` is a file path resolved the same way as a
        // cell-map's `image_path` (relative to the .ssab), but the key is the file
        // -name hash — a different namespace, so an atlas that is also a cell-map
        // image legitimately appears twice under two hashes.
        for (let i = 0; i < ssab.externalTexturesLength(); i++) {
            const texture = ssab.externalTextures(i);
            if (!texture) continue;
            const path = texture.name();
            const hash = texture.nameHash() >>> 0;
            if (path && !seen.has(hash)) {
                seen.add(hash);
                results.push({ hash, path });
            }
        }

        return results;
    }

    /**
     * Parse the SSAB buffer and collect the textures whose raw image bytes are
     * embedded directly in the file (the converter's `--embedded` mode) instead
     * of shipping as sibling files.
     *
     * Embedded assets are keyed by the FILE-name hash (`fnv1a(image_path)` ==
     * `CellMap.imagePathHash()` for a cell-map, `fnv1a(name)` == `nameHash()` for
     * an external texture); this joins them back to both tables and returns them
     * under the render-time keys, matching {@link extractTexturePaths}. Returns an
     * empty array for external-file (non-embedded) SSABs.
     *
     * The returned `bytes` are views over `ssabBuffer` — the caller must consume
     * them (e.g. decode into a texture) before that buffer is detached/freed.
     */
    public static extractEmbeddedTextures(ssabBuffer: Uint8Array): { hash: number, bytes: Uint8Array }[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const embLen = ssab.embeddedAssetsLength();
        if (embLen === 0) return [];

        // fnv1a(image_path) -> raw (encoded) image bytes
        const byPathHash = new Map<number, Uint8Array>();
        for (let i = 0; i < embLen; i++) {
            const asset = ssab.embeddedAssets(i);
            if (!asset) continue;
            const data = asset.dataArray();
            if (data) byPathHash.set(asset.nameHash() >>> 0, data);
        }

        const results: { hash: number, bytes: Uint8Array }[] = [];
        const seen = new Set<number>();
        for (let i = 0; i < ssab.cellmapsLength(); i++) {
            const cellmap = ssab.cellmaps(i);
            if (!cellmap) continue;
            const hash = cellmap.nameHash() >>> 0;
            const bytes = byPathHash.get(cellmap.imagePathHash() >>> 0);
            if (bytes && !seen.has(hash)) {
                seen.add(hash);
                results.push({ hash, bytes });
            }
        }

        // Texture-change (`TCHG`) targets are embedded too. Their render-time key
        // IS the file-name hash, so the embedded asset joins on it directly.
        for (let i = 0; i < ssab.externalTexturesLength(); i++) {
            const texture = ssab.externalTextures(i);
            if (!texture) continue;
            const hash = texture.nameHash() >>> 0;
            const bytes = byPathHash.get(hash);
            if (bytes && !seen.has(hash)) {
                seen.add(hash);
                results.push({ hash, bytes });
            }
        }

        return results;
    }

    /**
     * Read a pack's own name and name-hash from its SSAB buffer.
     */
    public static extractPackInfo(ssabBuffer: Uint8Array): { hash: number, name: string | null } {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return { hash: 0, name: null };
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
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
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
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const out: string[] = [];
        for (let i = 0; i < ssab.animationsLength(); i++) {
            const name = ssab.animations(i)?.name();
            if (name) out.push(name);
        }
        return out;
    }

    /**
     * Parse the SSAB buffer and list its parts in table order, each with its
     * type. The names are what the part overrides take; the type is what decides
     * which override applies (colour: normal parts; cell: normal and mask parts),
     * so a host UI can offer only the parts a given override can change.
     */
    public static extractParts(ssabBuffer: Uint8Array): { name: string, type: PartType }[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const out: { name: string, type: PartType }[] = [];
        for (let i = 0; i < ssab.partsLength(); i++) {
            const part = ssab.parts(i);
            const name = part?.name();
            if (part && name) out.push({ name, type: part.partTypeType() });
        }
        return out;
    }

    /**
     * Parse the SSAB buffer and list its cell-map names in table order (without
     * the `.ssce` extension, as the runtime stores them). These are the names a
     * cell override takes — see {@link extractCellNames} for the cells inside one.
     */
    public static extractCellMapNames(ssabBuffer: Uint8Array): string[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const out: string[] = [];
        for (let i = 0; i < ssab.cellmapsLength(); i++) {
            const name = ssab.cellmaps(i)?.name();
            if (name) out.push(name);
        }
        return out;
    }

    /**
     * Parse the SSAB buffer and list every name a runtime texture replacement can
     * target: cell-map names (table order, no `.ssce` extension) followed by
     * external-texture file names (the `TCHG` targets, e.g. `common.png`). This is
     * the union of the two hash namespaces {@link extractTexturePaths} loads, by
     * name; deduplicated by string so a name appearing in both tables lists once.
     */
    public static extractReplaceableTextureNames(ssabBuffer: Uint8Array): string[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const out: string[] = [];
        const seen = new Set<string>();
        for (let i = 0; i < ssab.cellmapsLength(); i++) {
            const name = ssab.cellmaps(i)?.name();
            if (name && !seen.has(name)) {
                seen.add(name);
                out.push(name);
            }
        }
        for (let i = 0; i < ssab.externalTexturesLength(); i++) {
            const name = ssab.externalTextures(i)?.name();
            if (name && !seen.has(name)) {
                seen.add(name);
                out.push(name);
            }
        }
        return out;
    }

    /**
     * Parse the SSAB buffer and list the cell names in the named cell map (empty
     * if that map isn't in this SSAB). Together with {@link extractCellMapNames}
     * this is enough to discover every valid target of a cell override.
     */
    public static extractCellNames(ssabBuffer: Uint8Array, cellmapName: string): string[] {
        if (!cellmapName) return [];
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
        const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
        const scratch = new CellMap();
        for (let i = 0; i < ssab.cellmapsLength(); i++) {
            const cellmap = ssab.cellmaps(i, scratch);
            if (!cellmap || cellmap.name() !== cellmapName) continue;
            const out: string[] = [];
            for (let j = 0; j < cellmap.cellsLength(); j++) {
                const name = cellmap.cells(j)?.name();
                if (name) out.push(name);
            }
            return out;
        }
        return [];
    }

    /**
     * Parse the SSAB buffer and list all referenced sound assets (name and path).
     * Useful for preloading audio files via the Web Audio API.
     */
    public static extractSounds(ssabBuffer: Uint8Array): SoundAsset[] {
        const bb = new flatbuffers.ByteBuffer(ssabBuffer);
        // Untrusted input: reject non-SSAB / truncated buffers up front (see extractTexturePaths).
        if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
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

    /**
     * Evaluates `frame`: builds its frame data and leaves the per-part buffers
     * (world matrices and the rest) on it. Returns the frame data's byte length,
     * or 0 before an animation is set up or when the runtime rejects the frame.
     * Allocates nothing — {@link getFrameData} is this plus a view over the bytes,
     * and the effect draw plans of the parts the frame draws.
     */
    public prepareFrame(frame: number): number {
        if (this.currentAnimationIndex < 0) return 0;
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
            // One evaluation per frame. The old buf/len pair each ran a full
            // get_frame_data, so this path cost the Brain twice every frame;
            // prepare_frame_data builds it and returns the length, and the
            // pointer is then a pure read of what was just built.
            return this.context.prepare_frame_data(clamped);
        } catch (e) {
            console.error(`WASM get_frame_data error at frame ${frame}:`, e);
            return 0;
        }
    }

    /**
     * Called with every frame {@link getFrameData} hands out, before it is handed
     * out: the player builds the draw plans of the effect parts that frame draws.
     * Returns whether it built any, which can grow WASM memory.
     */
    public onFrameData: ((frameData: FrameData) => boolean) | null = null;

    /**
     * The runtime's frame data for `frame`, as a zero-copy FlatBuffer view over
     * WASM memory. The returned object is a per-manager scratch re-pointed on every
     * call: don't retain it, and don't hold two at once.
     */
    public getFrameData(frame: number): FrameData | null {
        const len = this.prepareFrame(frame);
        if (len === 0) return null;
        const ptr = this.context.get_frame_data_buf();
        if (ptr === 0) return null;

        const memory = getWasmMemory();
        const buf = new Uint8Array(memory.buffer, ptr, len);
        const frameData = FrameData.getRootAsFrameData(new flatbuffers.ByteBuffer(buf), this._scratchFrameData);
        // A plan onFrameData builds can grow WASM memory, which detaches `buf`. The
        // frame data stays where it is, so the view is minted again over the new
        // buffer and the caller never holds a detached one.
        if (!this.onFrameData?.(frameData) || memory.buffer === buf.buffer) return frameData;
        return FrameData.getRootAsFrameData(
            new flatbuffers.ByteBuffer(new Uint8Array(memory.buffer, ptr, len)), this._scratchFrameData);
    }

    /**
     * The frame data the last evaluation built ({@link prepareFrame}, which every
     * draw and {@link InternalPlayerBase.evaluateDrawFrame} go through), read
     * without evaluating anything. Null before the first evaluation. A view over
     * WASM memory with a scratch of its own: don't retain it.
     */
    public getLastFrameData(): FrameData | null {
        const ptr = this.context.get_frame_data_buf();
        const len = this.context.get_frame_data_len();
        if (ptr === 0 || len === 0) return null;
        const bytes = this.viewCache.view('lastFrameData', ptr, len, Uint8Array);
        if (bytes !== this._lastFrameBytes) {
            this._lastFrameBytes = bytes;
            this._lastFrameBuffer = new flatbuffers.ByteBuffer(bytes);
        }
        return FrameData.getRootAsFrameData(this._lastFrameBuffer!, this._lastFrameData);
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

export { SSRuntimeContext, SSRuntimeResource, SSRuntimeInstanceSlot, SSRuntimeEffectSlot, WebEffectEventInfo, EffectDrawPlan };
