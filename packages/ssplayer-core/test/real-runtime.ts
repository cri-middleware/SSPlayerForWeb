import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertProject, init as initConverter } from '@spritestudio/ssconverter-core';
import type { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import type { IResourceManager } from '../src/IResourceManager.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';

// What the suites that boot the real runtime share. They play the SDK's own
// test projects, converted as they run, and skip themselves without the
// runtime WASM, the converter WASM or the SDK submodule.

const repoRoot = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../..');
export const RUNTIME_WASM = nodePath.join(repoRoot, 'packages/ssplayer-core/wasm/ssruntime_bg.wasm');
export const CONVERTER_WASM = nodePath.join(repoRoot, 'packages/ssconverter-core/wasm/ssconverter_bg.wasm');

/** The directory of one of the SDK's test projects, `SpriteStudio-SDK/tests/<name>`. */
export function sdkProject(name: string): string {
    return nodePath.join(repoRoot, 'SpriteStudio-SDK/tests', name);
}

const converted = new Map<string, Promise<Map<string, Uint8Array>>>();

/**
 * The packs a project directory converts to, by file name. Converted once per
 * project for the whole suite, since conversion is the slow part, so read the
 * packs and never change them.
 */
export function convert(project: string): Promise<Map<string, Uint8Array>> {
    let packs = converted.get(project);
    if (!packs) converted.set(project, packs = convertNow(project));
    return packs;
}

async function convertNow(project: string): Promise<Map<string, Uint8Array>> {
    await initConverter(readFileSync(CONVERTER_WASM));
    const files = new Map<string, Uint8Array>();
    // Recursive: overall keeps its fonts in a folder of their own.
    const walk = (dir: string, prefix: string) => {
        for (const name of readdirSync(dir)) {
            const full = nodePath.join(dir, name);
            if (statSync(full).isDirectory()) walk(full, `${prefix}/${name}`);
            else files.set(`${prefix}/${name}`, new Uint8Array(readFileSync(full)));
        }
    };
    walk(project, nodePath.basename(project));
    const result = convertProject(files);
    try {
        return new Map(result.output as Map<string, Uint8Array>);
    } finally {
        result.free();
    }
}

/** A resource manager that loads nothing: the runtime evaluates a frame without textures. */
export const textures: IResourceManager = {
    loadTexture: async () => {},
    getTexture: () => null,
    destroy: () => {},
};

/** The particles a renderer would draw this tick: the quads of every effect plan in the frame. */
export function effectQuads(player: DirectInternalPlayer): number {
    const frameData = player.runtimeManager.getFrameData(player.getDrawFrame());
    if (!frameData) return 0;
    const order = frameData.drawOrderArray()!;
    let quads = 0;
    for (let b = 0; b < frameData.drawBatchesLength(); b++) {
        const batch = frameData.drawBatches(b)!;
        if (batch.kind() !== DrawBatchKind.Effect) continue;
        for (let c = 0; c < batch.count(); c++) {
            const plan = player.getEffectDrawPlan(order[batch.startRank() + c]);
            for (let k = 0; plan && k < plan.commandsLength(); k++) quads += plan.commands(k)!.quadCount();
        }
    }
    return quads;
}
