import { describe, it, expect } from 'vitest';
import * as flatbuffers from 'flatbuffers';
import { SSRuntimeManager } from '../src/SSRuntimeManager.js';
import { SsAnimeBinary } from '../src/ss/format/ss-anime-binary.js';
import { CellMap } from '../src/ss/format/cell-map.js';
import { ExternalTexture } from '../src/ss/format/external-texture.js';
import { EmbeddedAsset } from '../src/ss/format/embedded-asset.js';
import { Vec2 } from '../src/ss/format/vec2.js';
import { createEmptyKeyframes } from './empty-keyframes.js';

// A player must load BOTH tables: `DrawBatch.texture_hash` is a cell-map name
// hash for an ordinary part, but a texture FILE-name hash for a part carrying a
// texture change (TCHG) — those live in `external_textures`. Miss them and the
// batch finds no texture and the part silently disappears.
//
// Built here as a synthetic SSAB rather than a converted fixture: these are pure
// FlatBuffers readers, and a hand-built buffer pins the exact keying the runtime
// looks textures up by.

interface CellMapSpec { nameHash: number; imagePath: string; imagePathHash: number }
interface ExternalSpec { nameHash: number; name: string }
interface EmbeddedSpec { nameHash: number; data: number[] }

function buildSsab(
    cellmaps: CellMapSpec[],
    externals: ExternalSpec[] = [],
    embedded: EmbeddedSpec[] = [],
): Uint8Array {
    const b = new flatbuffers.Builder(1024);

    const cellmapOffsets = cellmaps.map((cm) => {
        const name = b.createString(`cellmap${cm.nameHash}`);
        const imagePath = b.createString(cm.imagePath);
        const sizeOriginal = Vec2.createVec2(b, 64, 64); // required by the schema
        CellMap.startCellMap(b);
        CellMap.addSizeOriginal(b, sizeOriginal);
        CellMap.addNameHash(b, cm.nameHash);
        CellMap.addName(b, name);
        CellMap.addImagePath(b, imagePath);
        CellMap.addImagePathHash(b, cm.imagePathHash);
        return CellMap.endCellMap(b);
    });
    const cellmapsVec = SsAnimeBinary.createCellmapsVector(b, cellmapOffsets);

    const externalOffsets = externals.map((et) => {
        const name = b.createString(et.name);
        return ExternalTexture.createExternalTexture(b, et.nameHash, name);
    });
    const externalsVec = SsAnimeBinary.createExternalTexturesVector(b, externalOffsets);

    const embeddedOffsets = embedded.map((asset) => {
        const name = b.createString(`asset${asset.nameHash}`);
        const data = EmbeddedAsset.createDataVector(b, new Uint8Array(asset.data));
        return EmbeddedAsset.createEmbeddedAsset(b, asset.nameHash, name, data);
    });
    const embeddedVec = SsAnimeBinary.createEmbeddedAssetsVector(b, embeddedOffsets);

    // Required by the schema, and irrelevant here: these extractors only read the
    // texture tables.
    const partsVec = SsAnimeBinary.createPartsVector(b, []);
    const animationsVec = SsAnimeBinary.createAnimationsVector(b, []);
    const keyframes = createEmptyKeyframes(b);

    const packName = b.createString('pack');
    SsAnimeBinary.startSsAnimeBinary(b);
    SsAnimeBinary.addName(b, packName);
    SsAnimeBinary.addParts(b, partsVec);
    SsAnimeBinary.addAnimations(b, animationsVec);
    SsAnimeBinary.addKeyframes(b, keyframes);
    SsAnimeBinary.addCellmaps(b, cellmapsVec);
    SsAnimeBinary.addExternalTextures(b, externalsVec);
    SsAnimeBinary.addEmbeddedAssets(b, embeddedVec);
    SsAnimeBinary.finishSsAnimeBinaryBuffer(b, SsAnimeBinary.endSsAnimeBinary(b));

    return b.asUint8Array();
}

describe('extractTexturePaths', () => {
    it('returns cell-map images keyed by the cell-map name hash', () => {
        const buf = buildSsab([{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }]);

        expect(SSRuntimeManager.extractTexturePaths(buf)).toEqual([
            { hash: 0x1111, path: 'chara.png' },
        ]);
    });

    it('also returns texture-change targets, keyed by the file-name hash', () => {
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [{ nameHash: 0xbbbb, name: 'chara_damaged.png' }],
        );

        expect(SSRuntimeManager.extractTexturePaths(buf)).toEqual([
            { hash: 0x1111, path: 'chara.png' },
            { hash: 0xbbbb, path: 'chara_damaged.png' },
        ]);
    });

    it('keeps a file that is both a cell-map image and a TCHG target under both hashes', () => {
        // The two hashes are different namespaces (cell-map NAME vs texture FILE
        // name), so one URL legitimately loads under two keys.
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [{ nameHash: 0xaaaa, name: 'chara.png' }],
        );

        expect(SSRuntimeManager.extractTexturePaths(buf)).toEqual([
            { hash: 0x1111, path: 'chara.png' },
            { hash: 0xaaaa, path: 'chara.png' },
        ]);
    });

    it('is empty for a buffer that is not an SSAB', () => {
        expect(SSRuntimeManager.extractTexturePaths(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
    });
});

describe('extractReplaceableTextureNames', () => {
    // buildSsab names each cell map `cellmap<nameHash>` (see above); external
    // textures keep the name they are given.
    it('lists cell-map names (the texture-replacement targets)', () => {
        const buf = buildSsab([
            { nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa },
            { nameHash: 0x2222, imagePath: 'effect.png', imagePathHash: 0xbbbb },
        ]);

        expect(SSRuntimeManager.extractReplaceableTextureNames(buf)).toEqual([
            'cellmap4369', // 0x1111
            'cellmap8738', // 0x2222
        ]);
    });

    it('appends texture-change target file names after the cell-map names', () => {
        // A TCHG target (e.g. `chara_damaged.png`) is a legitimate replacement
        // target too — it binds on the frames the texture change applies.
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [{ nameHash: 0xbbbb, name: 'chara_damaged.png' }],
        );

        expect(SSRuntimeManager.extractReplaceableTextureNames(buf)).toEqual([
            'cellmap4369',
            'chara_damaged.png',
        ]);
    });

    it('deduplicates a name that appears in both tables', () => {
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [{ nameHash: 0xbbbb, name: 'cellmap4369' }],
        );

        expect(SSRuntimeManager.extractReplaceableTextureNames(buf)).toEqual(['cellmap4369']);
    });

    it('is empty for a buffer that is not an SSAB', () => {
        expect(SSRuntimeManager.extractReplaceableTextureNames(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
    });
});

describe('extractEmbeddedTextures', () => {
    it('joins embedded bytes to cell-maps by image-path hash', () => {
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [],
            [{ nameHash: 0xaaaa, data: [0x89, 0x50, 0x4e, 0x47] }],
        );

        const out = SSRuntimeManager.extractEmbeddedTextures(buf);
        expect(out.map((e) => e.hash)).toEqual([0x1111]);
        expect(Array.from(out[0].bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    });

    it('joins embedded bytes to texture-change targets on their own hash', () => {
        // An external texture's render-time key IS its file-name hash, which is
        // what the embedded asset is stored under — no indirection.
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [{ nameHash: 0xbbbb, name: 'chara_damaged.png' }],
            [
                { nameHash: 0xaaaa, data: [1, 1] },
                { nameHash: 0xbbbb, data: [2, 2] },
            ],
        );

        const out = SSRuntimeManager.extractEmbeddedTextures(buf);
        expect(out.map((e) => e.hash)).toEqual([0x1111, 0xbbbb]);
        expect(Array.from(out[1].bytes)).toEqual([2, 2]);
    });

    it('skips an external texture with no embedded bytes', () => {
        const buf = buildSsab(
            [{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }],
            [{ nameHash: 0xbbbb, name: 'chara_damaged.png' }],
            [{ nameHash: 0xaaaa, data: [1, 1] }],
        );

        expect(SSRuntimeManager.extractEmbeddedTextures(buf).map((e) => e.hash)).toEqual([0x1111]);
    });

    it('is empty when nothing is embedded', () => {
        const buf = buildSsab([{ nameHash: 0x1111, imagePath: 'chara.png', imagePathHash: 0xaaaa }]);
        expect(SSRuntimeManager.extractEmbeddedTextures(buf)).toEqual([]);
    });
});
