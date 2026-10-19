import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll } from 'vitest';
import { getWasmMemory, initializeWasm, type SSRuntimeManager } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import type { FrameData } from '../src/ss/runtime/frame-data.js';
import type { GeometryBuilder } from '../src/GeometryBuilder.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// An instance child's evaluation can grow WASM memory after the builder took
// its views for the frame and before the parent's parts are built, which
// detaches those views. Plays the SDK's Ringo, converted here.

const RINGO = sdkProject('Ringo');

interface Built { positions: number[]; uvs: number[]; indices: number[]; normals: number; meshes: number }

function buildFrame(gb: GeometryBuilder, rm: SSRuntimeManager, fd: FrameData): Built {
    const positions = new Float32Array(1 << 16), uvs = new Float32Array(1 << 16);
    const colors = new Float32Array(1 << 17), vargs = new Float32Array(1 << 17);
    const indices = new Uint32Array(1 << 16);
    const order = fd.drawOrderArray()!;
    const vOff = rm.getMeshVertexOffsets(), iOff = rm.getMeshIndexOffsets();
    let v = 0, i = 0, normals = 0, meshes = 0;
    for (let b = 0; b < fd.drawBatchesLength(); b++) {
        const batch = fd.drawBatches(b)!;
        for (let c = 0; c < batch.count(); c++) {
            const part = order[batch.startRank() + c];
            if (batch.kind() === DrawBatchKind.Normal) {
                gb.buildNormal(part, fd, 1 / 256, 1 / 256, positions, uvs, colors, vargs, v);
                v += 5;
                normals++;
            } else if (batch.kind() === DrawBatchKind.Mesh) {
                const vc = vOff[part + 1] - vOff[part], ic = iOff[part + 1] - iOff[part];
                gb.buildMesh(part, fd, vc, ic, 1 / 256, 1 / 256, positions, uvs, colors, vargs, indices, v, i);
                v += vc;
                i += ic;
                meshes++;
            }
        }
    }
    return {
        positions: Array.from(positions.subarray(0, v * 2)),
        uvs: Array.from(uvs.subarray(0, v * 2)),
        indices: Array.from(indices.subarray(0, i)),
        normals,
        meshes,
    };
}

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(RINGO))(
    'geometry after WASM memory grows',
    () => {
        let ringo: Uint8Array;

        beforeAll(async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            ringo = (await convert(RINGO)).get('Ringo.ssab')!;
        }, 120_000);

        it('builds the frame it built before memory grew', async () => {
            const player = new DirectInternalPlayer(textures);
            player.bindResource(ringo);
            await player.prepareResources();
            player.setAnimation('walk');
            player.play();
            for (let t = 0; t < 5; t++) player.update(1000 / 60);
            const rm = player.runtimeManager;
            const gb = player.geometryBuilder;

            gb.updateWorldPositions();
            const before = buildFrame(gb, rm, rm.getFrameData(player.getDrawFrame())!);
            expect(before.normals).toBeGreaterThan(0);
            expect(before.meshes).toBeGreaterThan(0);
            expect(before.positions.some((p) => p !== 0)).toBe(true);

            getWasmMemory().grow(1);
            const after = buildFrame(gb, rm, rm.getFrameData(player.getDrawFrame())!);
            expect(after).toEqual(before);
            player.destroy();
        });
    },
);
