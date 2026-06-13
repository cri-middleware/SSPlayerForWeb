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
    return ssFormat.SsAnimeBinary.bufferHasIdentifier(bb);
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

// Sequence (.ssqb) listing. Core doesn't expose an SSQB extractor yet (deferred),
// so this stays app-side — but it uses core's exported `SsSequenceBinary` class
// rather than a local schema copy. Swap to a core helper once core gains SSQB
// support (see the NOTE in SSRuntimeManager).
export function extractSequenceNames(buffer: ArrayBuffer): string[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!ssFormat.SsSequenceBinary.bufferHasIdentifier(bb)) return [];
    const ssqb = ssFormat.SsSequenceBinary.getRootAsSsSequenceBinary(bb);
    const out: string[] = [];
    for (let i = 0; i < ssqb.sequenceListLength(); i++) {
        const name = ssqb.sequenceList(i)?.name();
        if (name) out.push(name);
    }
    return out;
}
