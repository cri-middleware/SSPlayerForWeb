import * as flatbuffers from 'flatbuffers';
// Introspection helpers come from ssplayer-pixi, which re-exports the
// engine-agnostic core — so the demo depends only on the renderer package.
import { SSRuntimeManager, ssFormat } from '@spritestudio/ssplayer-pixi';

// SSAB / SSQB introspection for the demo UI. The FlatBuffers schema classes are
// owned by ssplayer-core (generated from the same .fbs the WASM is built
// against) and re-exported as `ssFormat`, so the app keeps no copy of them —
// only the `flatbuffers` runtime, for ByteBuffer + file-identifier checks. The
// SSAB walks delegate to core's static extractors (single source of truth, and
// guaranteed version-locked to the WASM binary).

/** True when the buffer carries the SSAB FlatBuffers file identifier. */
export function isSsab(buffer: ArrayBuffer): boolean {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    return ssFormat.SsAnimeBinary.bufferHasIdentifier(bb as any);
}

export function extractTexturePaths(buffer: ArrayBuffer): { hash: number, path: string }[] {
    if (!isSsab(buffer)) return [];
    return SSRuntimeManager.extractTexturePaths(new Uint8Array(buffer));
}

export function extractAnimationNames(buffer: ArrayBuffer): string[] {
    if (!isSsab(buffer)) return [];
    return SSRuntimeManager.extractAnimationNames(new Uint8Array(buffer));
}

export function extractPackInfo(buffer: ArrayBuffer): { hash: number, name: string | null } {
    if (!isSsab(buffer)) return { hash: 0, name: null };
    return SSRuntimeManager.extractPackInfo(new Uint8Array(buffer));
}

export function extractInstancePackRefs(buffer: ArrayBuffer): { hash: number, name: string }[] {
    if (!isSsab(buffer)) return [];
    return SSRuntimeManager.extractInstancePackRefs(new Uint8Array(buffer));
}

// Sequence (.ssqb) listing. Core exposes no SSQB extractor, so this reads the
// sequence names app-side with the exported `SsSequenceBinary` class.
export function extractSequenceNames(buffer: ArrayBuffer): string[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!ssFormat.SsSequenceBinary.bufferHasIdentifier(bb as any)) return [];
    const ssqb = ssFormat.SsSequenceBinary.getRootAsSsSequenceBinary(bb as any);
    const out: string[] = [];
    for (let i = 0; i < ssqb.sequenceListLength(); i++) {
        const name = ssqb.sequenceList(i)?.name();
        if (name) out.push(name);
    }
    return out;
}
