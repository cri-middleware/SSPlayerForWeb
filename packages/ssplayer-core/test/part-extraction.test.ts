import { describe, it, expect } from 'vitest';
import * as flatbuffers from 'flatbuffers';
import { SSRuntimeManager } from '../src/SSRuntimeManager.js';
import { SsAnimeBinary } from '../src/ss/format/ss-anime-binary.js';
import { PartData } from '../src/ss/format/part-data.js';
import { PartType } from '../src/ss/format/part-type.js';

// A host UI offers part names for the part overrides, and needs the type to
// offer only the parts an override applies to. Built as a synthetic SSAB, like
// the texture extractors' test: this is a pure FlatBuffers reader.

function buildSsab(parts: { name: string; type: PartType }[]): Uint8Array {
    const b = new flatbuffers.Builder(256);
    const partOffsets = parts.map((part) => {
        const name = b.createString(part.name);
        PartData.startPartData(b);
        PartData.addName(b, name);
        PartData.addPartTypeType(b, part.type);
        return PartData.endPartData(b);
    });
    const partsVec = SsAnimeBinary.createPartsVector(b, partOffsets);
    const animationsVec = SsAnimeBinary.createAnimationsVector(b, []);
    const packName = b.createString('pack');
    SsAnimeBinary.startSsAnimeBinary(b);
    SsAnimeBinary.addName(b, packName);
    SsAnimeBinary.addParts(b, partsVec);
    SsAnimeBinary.addAnimations(b, animationsVec);
    SsAnimeBinary.finishSsAnimeBinaryBuffer(b, SsAnimeBinary.endSsAnimeBinary(b));
    return b.asUint8Array();
}

describe('SSRuntimeManager.extractParts', () => {
    it('lists every part in table order, with its type', () => {
        const ssab = buildSsab([
            { name: 'root', type: PartType.PartTypeNull },
            { name: 'body', type: PartType.PartTypeNormal },
            { name: 'mask', type: PartType.PartTypeMask },
        ]);
        expect(SSRuntimeManager.extractParts(ssab)).toEqual([
            { name: 'root', type: PartType.PartTypeNull },
            { name: 'body', type: PartType.PartTypeNormal },
            { name: 'mask', type: PartType.PartTypeMask },
        ]);
    });

    it('reads anything that is not an SSAB as no parts', () => {
        expect(SSRuntimeManager.extractParts(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([]);
    });
});
