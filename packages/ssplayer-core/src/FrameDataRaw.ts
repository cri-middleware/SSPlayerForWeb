import type { FrameData } from './ss/runtime/frame-data.js';
import { PartState } from './ss/runtime/part-state.js';
import { PartAttributePartColor } from './ss/runtime/part-attribute-part-color.js';
import { SsAttributePartColorKeyValueColor } from './ss/runtime/ss-attribute-part-color-key-value-color.js';
import { U8Color } from './ss/runtime/u8-color.js';
import { DrawBatch } from './ss/runtime/draw-batch.js';

/**
 * Raw (per-field, byte-offset) reader for the fixed-length FlatBuffers `struct`
 * vectors in `FrameData` — `parts`, `parts_color` and `draw_batches`.
 *
 * Why this exists: those vectors are
 * FlatBuffers *structs* (fixed layout, contiguous, no vtable). Reading them
 * through the generated per-element accessors — e.g. the nested
 * `frameData.partsColor(i).lt().rgba().r()` chain, once per corner per part,
 * every frame — is the dominant frame-data cost in high-level hosts. The cost is the
 * accessors themselves (object `__init`, method calls, and flatbuffers'
 * `readFloat32` which reassembles the value from 4 byte reads), not the copy —
 * so a "zero-copy ByteBuffer" does NOT help; the fix is to bypass the accessors.
 *
 * This reader lays a single {@link DataView} over the same underlying WASM
 * ArrayBuffer the FlatBuffer already points at (still zero-copy), resolves each
 * struct vector's element-0 byte offset ONCE per frame via the generated
 * accessor (so vtable offsets are never hard-coded — only intra-struct field
 * offsets are, and those are cross-checked at startup), then reads every field
 * as a direct `DataView.getXxx(base + i*stride + fieldOffset, littleEndian)`.
 *
 * Lifecycle: {@link bind} is cheap and idempotent — it recomputes the vector
 * bases + DataView only when the backing FlatBuffer (or its ArrayBuffer, e.g.
 * after a WASM `memory.grow()` detach) changes. Call `bind(fd)` before reading;
 * the `*Of(fd, i)` convenience methods bind internally, so they stay correct
 * across instance-child recursion (which rebinds to a different FrameData) and
 * across post-recursion re-fetches. The reader holds no ownership of WASM
 * memory: the bound views are valid only for the synchronous frame in which
 * `fd` was obtained, exactly like the FlatBuffer itself.
 */

// ── PartState struct (stride 144, little-endian) — offsets mirror part-state.ts.
const PART_STRIDE = 144;
const PART_ALPHA_OFF = 48;      // float32
const PART_CELL_OFF = 126;      // int16
const PART_COLOR_OFF = 128;     // int16
const PART_SHADER_OFF = 130;    // int16

// ── PartAttributePartColor struct (stride 36) — offsets mirror
// part-attribute-part-color.ts. Each corner is an SsAttributePartColorKeyValueColor
// { rgba: U8Color{a,r,g,b}, rate: float32 }; U8Color packs a@+0, r@+1, g@+2, b@+3.
const PC_STRIDE = 36;
const PC_BLEND_OFF = 0;             // uint8
const PC_CORNER_OFFSETS = [4, 12, 20, 28]; // LT, RT, LB, RB
const PC_RGBA_A = 0, PC_RGBA_R = 1, PC_RGBA_G = 2, PC_RGBA_B = 3; // within U8Color
const PC_RATE_OFF = 4;             // float32, within the corner

// ── DrawBatch struct (stride 16) — offsets mirror draw-batch.ts.
const DB_STRIDE = 16;
const DB_START_RANK_OFF = 0;   // uint16
const DB_COUNT_OFF = 2;        // uint16
const DB_TEX_HASH_OFF = 4;     // uint32
const DB_VCOUNT_OFF = 8;       // uint16
const DB_ICOUNT_OFF = 10;      // uint16
const DB_BLEND_OFF = 12;       // uint8
const DB_KIND_OFF = 13;        // uint8
const DB_FLAGS_OFF = 14;       // uint8

const LE = true; // FlatBuffers is always little-endian.

export class FrameDataRaw {
    private _dv: DataView | null = null;
    private _bb: unknown = null;   // bound FlatBuffer ByteBuffer identity
    private _bbPos = -1;           // bound FrameData table position
    private _buffer: ArrayBufferLike | null = null; // detach detection

    private _partsBase = 0;
    public partsLen = 0;
    private _pcBase = 0;
    public partsColorLen = 0;
    private _dbBase = 0;
    public drawBatchesLen = 0;

    // Scratch wrappers used only to resolve element-0 offsets and for the
    // one-time self-check. Never on the per-field hot path.
    private readonly _scPart = new PartState();
    private readonly _scPc = new PartAttributePartColor();
    private readonly _scCorner = new SsAttributePartColorKeyValueColor();
    private readonly _scRgba = new U8Color();
    private readonly _scBatch = new DrawBatch();

    /**
     * Point this reader at `fd`. No-op (a few comparisons) when already bound to
     * the same FlatBuffer over the same ArrayBuffer; otherwise recomputes the
     * DataView and the three vector base offsets. Returns `this` for chaining.
     */
    public bind(fd: FrameData): this {
        const bb = fd.bb!;
        const bytes = bb.bytes();
        if (this._bb === bb && this._bbPos === fd.bb_pos && this._buffer === bytes.buffer && this._dv) {
            return this;
        }
        this._bb = bb;
        this._bbPos = fd.bb_pos;
        this._buffer = bytes.buffer;
        this._dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        // Resolve each struct vector's element-0 byte offset via the generated
        // accessor (bb_pos of element 0). This uses flatbuffers' own vtable
        // lookup, so field-reordering in the .fbs never silently shifts our base
        // — only the hard-coded intra-struct field offsets could drift, and the
        // self-check below guards those.
        const p0 = fd.parts(0, this._scPart);
        this._partsBase = p0 ? p0.bb_pos : 0;
        this.partsLen = fd.partsLength();

        const pc0 = fd.partsColor(0, this._scPc);
        this._pcBase = pc0 ? pc0.bb_pos : 0;
        this.partsColorLen = fd.partsColorLength();

        const db0 = fd.drawBatches(0, this._scBatch);
        this._dbBase = db0 ? db0.bb_pos : 0;
        this.drawBatchesLen = fd.drawBatchesLength();

        if (!FrameDataRaw._fullyVerified) this.selfCheck(fd);
        return this;
    }

    // ── parts ──────────────────────────────────────────────────────────────
    public partAlpha(i: number): number { return this._dv!.getFloat32(this._partsBase + i * PART_STRIDE + PART_ALPHA_OFF, LE); }
    public partCell(i: number): number { return this._dv!.getInt16(this._partsBase + i * PART_STRIDE + PART_CELL_OFF, LE); }
    public partColorIdx(i: number): number { return this._dv!.getInt16(this._partsBase + i * PART_STRIDE + PART_COLOR_OFF, LE); }
    public partShader(i: number): number { return this._dv!.getInt16(this._partsBase + i * PART_STRIDE + PART_SHADER_OFF, LE); }

    /** bind + partAlpha in one call — safe to use across recursion / re-fetch. */
    public partAlphaOf(fd: FrameData, i: number): number { return this.bind(fd).partAlpha(i); }
    /** bind + partShader in one call — safe to use across recursion / re-fetch. */
    public partShaderOf(fd: FrameData, i: number): number { return this.bind(fd).partShader(i); }

    // ── parts_color ──────────────────────────────────────────────────────────
    public pcBlendType(pcIdx: number): number { return this._dv!.getUint8(this._pcBase + pcIdx * PC_STRIDE + PC_BLEND_OFF); }

    /**
     * Read one PartsColor corner (cornerIdx 0=LT,1=RT,2=LB,3=RB) into caller
     * scratch: `outColors[cornerIdx*4 + 0..3]` = r,g,b,a normalised to 0..1,
     * `outRates[cornerIdx]` = rate.
     */
    public readCornerInto(pcIdx: number, cornerIdx: number, outColors: Float32Array, outRates: Float32Array): void {
        const dv = this._dv!;
        const base = this._pcBase + pcIdx * PC_STRIDE + PC_CORNER_OFFSETS[cornerIdx];
        const o = cornerIdx * 4;
        outColors[o + 0] = dv.getUint8(base + PC_RGBA_R) / 255.0;
        outColors[o + 1] = dv.getUint8(base + PC_RGBA_G) / 255.0;
        outColors[o + 2] = dv.getUint8(base + PC_RGBA_B) / 255.0;
        outColors[o + 3] = dv.getUint8(base + PC_RGBA_A) / 255.0;
        outRates[cornerIdx] = dv.getFloat32(base + PC_RATE_OFF, LE);
    }

    // Single-corner field getters (used by the mesh path, which needs only LT).
    public pcCornerR(pcIdx: number, cornerIdx: number): number { return this._dv!.getUint8(this._pcBase + pcIdx * PC_STRIDE + PC_CORNER_OFFSETS[cornerIdx] + PC_RGBA_R); }
    public pcCornerG(pcIdx: number, cornerIdx: number): number { return this._dv!.getUint8(this._pcBase + pcIdx * PC_STRIDE + PC_CORNER_OFFSETS[cornerIdx] + PC_RGBA_G); }
    public pcCornerB(pcIdx: number, cornerIdx: number): number { return this._dv!.getUint8(this._pcBase + pcIdx * PC_STRIDE + PC_CORNER_OFFSETS[cornerIdx] + PC_RGBA_B); }
    public pcCornerA(pcIdx: number, cornerIdx: number): number { return this._dv!.getUint8(this._pcBase + pcIdx * PC_STRIDE + PC_CORNER_OFFSETS[cornerIdx] + PC_RGBA_A); }
    public pcCornerRate(pcIdx: number, cornerIdx: number): number { return this._dv!.getFloat32(this._pcBase + pcIdx * PC_STRIDE + PC_CORNER_OFFSETS[cornerIdx] + PC_RATE_OFF, LE); }

    // ── draw_batches (raw reads available; the renderers still thread the
    // generated DrawBatch through their control flow, so these are exercised by
    // the self-check and available for callers that want the accessor-free path).
    public batchStartRank(i: number): number { return this._dv!.getUint16(this._dbBase + i * DB_STRIDE + DB_START_RANK_OFF, LE); }
    public batchCount(i: number): number { return this._dv!.getUint16(this._dbBase + i * DB_STRIDE + DB_COUNT_OFF, LE); }
    public batchTextureHash(i: number): number { return this._dv!.getUint32(this._dbBase + i * DB_STRIDE + DB_TEX_HASH_OFF, LE); }
    public batchVertexCount(i: number): number { return this._dv!.getUint16(this._dbBase + i * DB_STRIDE + DB_VCOUNT_OFF, LE); }
    public batchIndexCount(i: number): number { return this._dv!.getUint16(this._dbBase + i * DB_STRIDE + DB_ICOUNT_OFF, LE); }
    public batchBlendType(i: number): number { return this._dv!.getUint8(this._dbBase + i * DB_STRIDE + DB_BLEND_OFF); }
    public batchKind(i: number): number { return this._dv!.getUint8(this._dbBase + i * DB_STRIDE + DB_KIND_OFF); }
    public batchFlags(i: number): number { return this._dv!.getUint8(this._dbBase + i * DB_STRIDE + DB_FLAGS_OFF); }

    // ── self-check (guards against silent .fbs layout drift) ─────────────────
    // Cross-checks every raw read against the generated FlatBuffers accessor for
    // real data, once per struct-vector, catching silent .fbs layout drift
    // (a same-size field reorder that `sizeOf` alone would miss). Each vector is
    // verified the first frame it actually carries elements; once all three have
    // been verified the check disables itself and adds zero steady-state cost.
    private static _vParts = false;
    private static _vPc = false;
    private static _vDb = false;
    private static _fullyVerified = false;

    private selfCheck(fd: FrameData): void {
        if (!FrameDataRaw._vParts && this.partsLen > 0) {
            for (let i = 0; i < this.partsLen; i++) {
                const p = fd.parts(i, this._scPart)!;
                eq('PartState.alpha', i, this.partAlpha(i), p.alpha());
                eq('PartState.cell', i, this.partCell(i), p.cell());
                eq('PartState.partColor', i, this.partColorIdx(i), p.partColor());
                eq('PartState.shader', i, this.partShader(i), p.shader());
            }
            FrameDataRaw._vParts = true;
        }
        if (!FrameDataRaw._vPc && this.partsColorLen > 0) {
            for (let i = 0; i < this.partsColorLen; i++) {
                const pc = fd.partsColor(i, this._scPc)!;
                eq('PartsColor.blendType', i, this.pcBlendType(i), pc.blendType());
                for (let corner = 0; corner < 4; corner++) {
                    const c = corner === 0 ? pc.lt(this._scCorner)
                        : corner === 1 ? pc.rt(this._scCorner)
                        : corner === 2 ? pc.lb(this._scCorner)
                        : pc.rb(this._scCorner);
                    const rgba = c!.rgba(this._scRgba)!;
                    eq('PartsColor.rgba.r', i, this.pcCornerR(i, corner), rgba.r());
                    eq('PartsColor.rgba.g', i, this.pcCornerG(i, corner), rgba.g());
                    eq('PartsColor.rgba.b', i, this.pcCornerB(i, corner), rgba.b());
                    eq('PartsColor.rgba.a', i, this.pcCornerA(i, corner), rgba.a());
                    eq('PartsColor.rate', i, this.pcCornerRate(i, corner), c!.rate());
                }
            }
            FrameDataRaw._vPc = true;
        }
        if (!FrameDataRaw._vDb && this.drawBatchesLen > 0) {
            for (let i = 0; i < this.drawBatchesLen; i++) {
                const b = fd.drawBatches(i, this._scBatch)!;
                eq('DrawBatch.startRank', i, this.batchStartRank(i), b.startRank());
                eq('DrawBatch.count', i, this.batchCount(i), b.count());
                eq('DrawBatch.textureHash', i, this.batchTextureHash(i), b.textureHash());
                eq('DrawBatch.vertexCount', i, this.batchVertexCount(i), b.vertexCount());
                eq('DrawBatch.indexCount', i, this.batchIndexCount(i), b.indexCount());
                eq('DrawBatch.blendType', i, this.batchBlendType(i), b.blendType());
                eq('DrawBatch.kind', i, this.batchKind(i), b.kind());
                eq('DrawBatch.flags', i, this.batchFlags(i), b.flags());
            }
            FrameDataRaw._vDb = true;
        }
        FrameDataRaw._fullyVerified = FrameDataRaw._vParts && FrameDataRaw._vPc && FrameDataRaw._vDb;
    }
}

function eq(field: string, index: number, raw: number, acc: number): void {
    // Object.is so a legitimately-NaN field matches (float !== float would fail).
    if (!Object.is(raw, acc)) {
        throw new Error(
            `FrameDataRaw self-check failed: ${field}[${index}] raw=${raw} accessor=${acc}. ` +
            `The generated FlatBuffers struct layout drifted from FrameDataRaw's byte offsets ` +
            `(regenerate offsets in FrameDataRaw.ts after any .fbs change).`
        );
    }
}
