import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import { initializeWasm, getWasmMemory, SSABResource, SSRuntimeEffectSlot } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { DrawBatchKind } from '../src/ss/runtime/draw-batch-kind.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// An effect step runs in update(), before the frame it is drawn in is
// evaluated, so it cannot know whether the frame draws its part. It takes the
// last frame's word for it, and the frame handed out builds the particles of a
// part it draws after all. What is drawn has to be exactly what a step that
// always draws gives, frame by frame — through a stretch with every part
// hidden, a pause and a seek — and a hidden part has to build no particles.
//
// Unlike the neighbouring suites this one boots the real runtime: the
// equality it checks is the runtime's, not this layer's. It plays the SDK's
// own Effect fixture, converted here, and is skipped without the converter
// WASM, the runtime WASM or the SDK submodule.

const OVERALL = sdkProject('overall');

/** FNV-1a of a byte range, so frames compare as short strings. */
function digest(bytes: Uint8Array): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    return h.toString(16);
}

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(OVERALL))(
    'an effect part the frame does not draw',
    () => {
        it.each([false, true])('draws what a step that always draws gives (hidden for a stretch: %s)', async (hide) => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const pack = (await convert(OVERALL)).get('Effect.ssab')!;

            const player = new DirectInternalPlayer(textures);
            player.bindResource(pack);
            await player.prepareResources();
            player.setAnimation('anime_1');
            player.play();
            const ctx = player.runtimeManager.context;
            const fps = player.getFrameRate();

            // The reference: a slot per effect part, stepped on the player's own
            // events the way the player used to step, drawing every step.
            const resource = new SSABResource(pack);
            const reference = new Map<number, { slot: SSRuntimeEffectSlot; visible: boolean }>();
            for (const part of player.runtimeManager.getEffectParts()) {
                reference.set(part.partIndex, { slot: SSRuntimeEffectSlot.create(resource.raw, part.hash, part.seed), visible: false });
            }
            const references = new Set([...reference.values()].map(r => r.slot));
            expect(reference.size).toBeGreaterThan(0);
            const stepReference = (deltaSeconds: number, parentLooped: boolean) => {
                const frame = ctx.get_frame_no();
                for (const [partIndex, r] of reference) {
                    const ev = ctx.get_active_effect_event(partIndex);
                    r.visible = r.slot.step(ev, frame, deltaSeconds, fps, parentLooped, true, 2, true);
                    ev.free();
                }
            };

            const step = vi.spyOn(SSRuntimeEffectSlot.prototype, 'step');
            const deltaMs = 1000 / fps; // one frame a tick
            let quads = 0;
            for (let tick = 0; tick < 150; tick++) {
                if (hide && tick === 10) player.setPartVisibilityOverride(0, true, true);
                if (hide && tick === 50) player.clearPartVisibilityOverride(0);
                if (tick === 70) player.pause(); // independent effects keep their own clock
                if (tick === 85) player.resume();
                if (tick === 100) {
                    player.setFrameNo(5);
                    stepReference(0, false);
                }
                step.mockClear();
                const pausing = player.isPausing;
                player.update(deltaMs);
                stepReference(deltaMs / 1000, pausing ? false : ctx.just_looped());

                // Every slot steps every tick, drawn or not.
                const own = step.mock.contexts.filter(s => !references.has(s as SSRuntimeEffectSlot));
                expect(own.length).toBe(reference.size);
                // Hidden from the tick after it was hidden, no step of the player's builds a plan.
                if (hide && tick > 10 && tick < 50) {
                    const built = step.mock.calls.filter((args, i) => args[7] && !references.has(step.mock.contexts[i] as SSRuntimeEffectSlot));
                    expect(built).toEqual([]);
                }

                // What a renderer reads: the drawn frame, then the plan of every
                // effect part in its draw order. Handing the frame out builds
                // every plan it draws, so reading them steps nothing: a step in
                // the middle of a draw could grow WASM memory under its views.
                const frameData = player.runtimeManager.getFrameData(player.getDrawFrame())!;
                const order = frameData.drawOrderArray()!;
                step.mockClear();
                const drawn: string[] = [];
                const expected: string[] = [];
                for (let b = 0; b < frameData.drawBatchesLength(); b++) {
                    const batch = frameData.drawBatches(b)!;
                    if (batch.kind() !== DrawBatchKind.Effect) continue;
                    for (let c = 0; c < batch.count(); c++) {
                        const partIndex = order[batch.startRank() + c];
                        const plan = player.getEffectDrawPlan(partIndex);
                        drawn.push(plan ? digest(plan.bb!.bytes()) : '-');
                        for (let k = 0; plan && k < plan.commandsLength(); k++) quads += plan.commands(k)!.quadCount();
                        const r = reference.get(partIndex)!;
                        expected.push(r.visible
                            ? digest(new Uint8Array(getWasmMemory().buffer, r.slot.get_draw_plan_buf(), r.slot.get_draw_plan_len()))
                            : '-');
                    }
                }
                expect(step.mock.contexts.filter(s => !references.has(s as SSRuntimeEffectSlot))).toEqual([]);
                if (hide && tick >= 10 && tick < 50) expect(drawn).toEqual([]);
                expect(drawn, `tick ${tick}`).toEqual(expected);
            }
            step.mockRestore();
            // Two runs drawing no particle would pass the comparison above.
            expect(quads).toBeGreaterThan(0);

            for (const r of reference.values()) r.slot.free();
            resource.destroy();
            player.destroy();
        }, 60_000);

        it('hands out a frame readable over the memory a build grew', async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            const player = new DirectInternalPlayer(textures);
            player.bindResource((await convert(OVERALL)).get('Effect.ssab')!);
            player.setAnimation('anime_1');
            const manager = player.runtimeManager;
            const expected = Array.from(manager.getFrameData(0)!.drawOrderArray()!);

            // A build that grows WASM memory detaches every view over the old buffer.
            manager.onFrameData = () => {
                getWasmMemory().grow(1);
                return true;
            };
            const frameData = manager.getFrameData(0)!;
            expect(frameData.bb!.bytes().buffer).toBe(getWasmMemory().buffer);
            expect(Array.from(frameData.drawOrderArray()!)).toEqual(expected);
            player.destroy();
        });
    },
);
