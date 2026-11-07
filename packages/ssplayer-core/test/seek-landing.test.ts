import { existsSync, readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { initializeWasm } from '../src/SSRuntimeManager.js';
import { DirectInternalPlayer } from '../src/DirectInternalPlayer.js';
import { SSWebAudioManager, type AudioBindablePlayer, type SSAudioKey } from '../src/SSWebAudioManager.js';
import { CONVERTER_WASM, RUNTIME_WASM, convert, sdkProject, textures } from './real-runtime.js';

// A seek lands on a frame without crossing its keys, yet the next update reports
// them, playing or not. The player flags that frame for the one update that
// reports it (isSeekLanding), and the audio gate leaves its keys unsounded;
// play() starts from its own frame, which is not flagged. The SDK's
// overall/Sound keys audio on frames 0, 10 and 20.

const OVERALL = sdkProject('overall');
const TICK = 1000 / 60;

describe.skipIf(!existsSync(RUNTIME_WASM) || !existsSync(CONVERTER_WASM) || !existsSync(OVERALL))(
    'seek landing',
    () => {
        let sound: Uint8Array;

        beforeAll(async () => {
            await initializeWasm(readFileSync(RUNTIME_WASM));
            sound = (await convert(OVERALL)).get('Sound.ssab')!;
        }, 120_000);

        async function soundPlayer(): Promise<DirectInternalPlayer> {
            const player = new DirectInternalPlayer(textures);
            player.bindResource(sound);
            await player.prepareResources();
            player.setAnimation(player.animationNames[0]);
            return player;
        }

        // The frames whose audio keys the update that just ran reported.
        function audioFrames(player: DirectInternalPlayer): number[] {
            const manager = player.runtimeManager;
            const frames: number[] = [];
            for (const event of manager.capturePassedEvents()) {
                const events = manager.getEventsOf(event);
                if (events && events.audiosLength() > 0) frames.push(events.frameIndex());
            }
            return frames;
        }

        it('flags a seek made while playing, for the update that reports it', async () => {
            const player = await soundPlayer();
            player.play();
            player.update(TICK);
            player.setFrameNo(10);
            player.update(0);
            expect(audioFrames(player)).toContain(10);
            expect(player.isSeekLanding(10)).toBe(true);
            player.update(TICK);
            expect(player.isSeekLanding(10)).toBe(false);
            player.destroy();
        });

        it('flags a seek made while paused on the update after resume()', async () => {
            const player = await soundPlayer();
            player.play();
            player.update(TICK);
            player.pause();
            player.setFrameNo(10);
            player.update(TICK);
            expect(player.isSeekLanding(10)).toBe(false);
            player.resume();
            player.update(0);
            expect(audioFrames(player)).toContain(10);
            expect(player.isSeekLanding(10)).toBe(true);
            player.destroy();
        });

        it('treats moving track 0 as a seek', async () => {
            const player = await soundPlayer();
            player.play();
            player.update(TICK);
            player.setTrackFrame(0, 10);
            player.update(0);
            expect(player.isSeekLanding(10)).toBe(true);
            player.destroy();
        });

        it('does not flag play()\'s start frame, even right after a seek', async () => {
            const player = await soundPlayer();
            player.setFrameNo(0);
            player.play();
            player.update(0);
            expect(audioFrames(player)).toContain(0);
            expect(player.isSeekLanding(0)).toBe(false);
            player.destroy();
        });

        it('does not flag a key crossed after the landing frame', async () => {
            const player = await soundPlayer();
            player.play();
            player.update(TICK);
            player.setFrameNo(9);
            player.update(200);
            expect(audioFrames(player)).toContain(10);
            expect(player.isSeekLanding(9)).toBe(true);
            expect(player.isSeekLanding(10)).toBe(false);
            player.destroy();
        });
    },
);

describe('SSWebAudioManager gate', () => {
    function bind(isSeekLanding?: (frameNo: number) => boolean) {
        const manager = Object.create(SSWebAudioManager.prototype) as SSWebAudioManager;
        const play = vi.fn();
        (manager as unknown as { play: typeof play }).play = play;
        let listener: (e: SSAudioKey) => void = () => {};
        const player: AudioBindablePlayer = {
            audioManager: null,
            onAudio: (l) => { listener = l; return () => {}; },
            isPlayingForward: true,
            isSeekLanding,
        };
        manager.bindToPlayer(player);
        const key = (frameNo: number): SSAudioKey => ({
            partIndex: 0, partName: null, frameNo, soundListNameHash: 0, soundNameHash: 0, soundName: 'se', loopNum: 1,
        });
        return { play, fire: (frameNo: number) => listener(key(frameNo)) };
    }

    it('does not sound a key on the frame a seek landed on', () => {
        const { play, fire } = bind((frameNo) => frameNo === 10);
        fire(10);
        expect(play).not.toHaveBeenCalled();
        fire(11);
        expect(play).toHaveBeenCalledTimes(1);
    });

    it('sounds every key for a player that does not report seek landings', () => {
        const { play, fire } = bind();
        fire(10);
        expect(play).toHaveBeenCalledTimes(1);
    });
});
