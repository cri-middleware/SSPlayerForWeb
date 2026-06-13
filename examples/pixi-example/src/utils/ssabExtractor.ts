import * as flatbuffers from 'flatbuffers';
import { SsAnimeBinary } from '../format/ss-anime-binary.js';
import { SsSequenceBinary } from '../format/ss-sequence-binary.js';
import { PartType } from '../format/part-type.js';
import { PartTypeInstance } from '../format/part-type-instance.js';

export function extractTexturePaths(buffer: ArrayBuffer): { hash: number, path: string }[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
    
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    const results: { hash: number, path: string }[] = [];
    for (let i = 0; i < ssab.cellmapsLength(); i++) {
        const cellmap = ssab.cellmaps(i);
        if (cellmap) {
            const path = cellmap.imagePath();
            const hash = cellmap.nameHash();
            if (path) results.push({ hash, path });
        }
    }
    return results;
}

export function extractAnimationNames(buffer: ArrayBuffer): string[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return [];
    
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    const results: string[] = [];
    for (let i = 0; i < ssab.animationsLength(); i++) {
        const anim = ssab.animations(i);
        if (anim) {
            const name = anim.name();
            if (name) results.push(name);
        }
    }
    return results;
}

export function extractPackInfo(buffer: ArrayBuffer): { hash: number, name: string | null } {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsAnimeBinary.bufferHasIdentifier(bb)) return { hash: 0, name: null };
    const ssab = SsAnimeBinary.getRootAsSsAnimeBinary(bb);
    return { hash: ssab.nameHash() >>> 0, name: ssab.name() };
}

// Animation packs referenced by this pack's instance parts (the referenced
// animation may live in a separate .ssab pack that must be supplied too).
export function extractInstancePackRefs(buffer: ArrayBuffer): { hash: number, name: string }[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
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
        if (name && !seen.has(hash)) { seen.add(hash); out.push({ hash, name }); }
    }
    return out;
}

export function extractSequenceNames(buffer: ArrayBuffer): string[] {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    if (!SsSequenceBinary.bufferHasIdentifier(bb)) return [];
    
    const ssqb = SsSequenceBinary.getRootAsSsSequenceBinary(bb);
    const results: string[] = [];
    for (let i = 0; i < ssqb.sequenceListLength(); i++) {
        const seq = ssqb.sequenceList(i);
        if (seq) {
            const name = seq.name();
            if (name) results.push(name);
        }
    }
    return results;
}
