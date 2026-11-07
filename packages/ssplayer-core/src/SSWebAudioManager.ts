import type { IAudioManager, SoundAsset } from './IAudioManager.js';

/**
 * The audio key a player reports as the playhead crosses it.
 *
 * Structurally the `SSAudioEvent` every renderer package declares — they are the
 * same fields, because what a sound key carries does not depend on how the
 * animation is drawn.
 */
export interface SSAudioKey {
    partIndex: number;
    partName: string | null;
    /**
     * The frame the key is authored on — not necessarily the frame it was
     * noticed on, since one tick can step across several.
     */
    frameNo: number;
    soundListNameHash: number;
    soundNameHash: number;
    soundName: string | null;
    loopNum: number;
}

/**
 * The part of a player {@link SSWebAudioManager.bindToPlayer} needs: somewhere to
 * register itself, the key stream, and which way the playhead is walking.
 *
 * A structural type rather than an import, so this adapter stays clear of every
 * renderer package — each one's `SSPlayer` satisfies it as it stands.
 */
export interface AudioBindablePlayer {
    audioManager: IAudioManager | null;
    onAudio(listener: (e: SSAudioKey) => void): () => void;
    readonly isPlayingForward: boolean;
    /** @internal Whether a key on `frameNo` is where a seek landed; such a key is not sounded. */
    isSeekLanding?(frameNo: number): boolean;
}

/**
 * Optional Web Audio API adapter implementing {@link IAudioManager}.
 *
 * The player core never plays audio itself; it only surfaces sound references
 * (via `onAudio`) and preloads them when an audio manager is attached. Nothing
 * here touches a rendering engine — Web Audio is the browser's, not PixiJS's or
 * WebGL's — so one copy serves every renderer, and the behaviour cannot drift
 * between them.
 *
 * It lives behind its own entry point (`@spritestudio/ssplayer-core/audio`)
 * rather than the package index, so a build that never mentions sound does not
 * carry it: `ssplayer-webgl` reaches it through a dynamic `import()` and keeps
 * its `./lite` build audio-free.
 *
 * Usage:
 * ```ts
 * import { SSWebAudioManager } from '@spritestudio/ssplayer-core/audio';
 * new SSWebAudioManager().bindToPlayer(player); // preload + play wired in one call
 * await player.load('chara.ssab');
 * player.setAnimation('idle'); // sounds preload here (audioManager is set)
 * player.play();
 * ```
 */
export class SSWebAudioManager implements IAudioManager {
    private ctx: AudioContext;
    private buffers: Map<string, AudioBuffer> = new Map();
    private activeSources: Set<AudioBufferSourceNode> = new Set();
    private soundPaths: Map<string, string> = new Map();
    // Encoded sounds an embedded `.ssab` carried, until they are decoded.
    private soundBytes: Map<string, Uint8Array> = new Map();

    constructor() {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioContextClass();
        this.setupAutoplayResume();
    }

    private setupAutoplayResume() {
        if (this.ctx.state === 'running') return;
        const resumeAudio = () => {
            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            if (this.ctx.state === 'running') {
                ['pointerdown', 'touchstart', 'keydown'].forEach(ev => {
                    document.removeEventListener(ev, resumeAudio, { capture: true });
                });
            }
        };
        ['pointerdown', 'touchstart', 'keydown'].forEach(ev => {
            document.addEventListener(ev, resumeAudio, { once: true, capture: true });
        });
    }

    /**
     * Initializes the Web Audio API context. Must be called after a user interaction (e.g., click)
     * to comply with the browser's Autoplay Policy.
     */
    public async initialize(): Promise<void> {
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    /**
     * Preloads an array of sound assets and decodes them into memory.
     */
    public async preload(sounds: SoundAsset[]): Promise<void> {
        // Build the lookup map
        for (const asset of sounds) {
            this.soundPaths.set(asset.name, asset.path);
            if (asset.bytes && !this.buffers.has(asset.name)) this.soundBytes.set(asset.name, asset.bytes);
        }
        const promises = sounds.map(asset => this.loadSound(asset.name));
        await Promise.all(promises);
    }

    /**
     * Internal method to fetch (unless the pack embeds it) and decode a single sound file.
     */
    private async loadSound(soundName: string): Promise<void> {
        if (this.buffers.has(soundName)) return;

        try {
            const bytes = this.soundBytes.get(soundName);
            let arrayBuffer: ArrayBuffer;
            if (bytes) {
                // A copy of exactly these bytes: decodeAudioData detaches what it is given.
                arrayBuffer = bytes.slice().buffer as ArrayBuffer;
            } else {
                const url = this.soundPaths.get(soundName) || soundName;
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                arrayBuffer = await response.arrayBuffer();
            }
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.buffers.set(soundName, audioBuffer);
        } catch (e) {
            console.error(`[SSWebAudioManager] Failed to load sound: ${soundName}`, e);
        } finally {
            // After the decode: a key the playhead crosses during it asks for the sound again.
            this.soundBytes.delete(soundName);
        }
    }

    /**
     * Attaches this manager to a player: registers it as the player's
     * `audioManager` (so `setAnimation` preloads the animation's sounds) and
     * subscribes to `onAudio` so referenced sounds play automatically.
     * Returns an unsubscribe function for the `onAudio` binding.
     *
     * Sounds only while the playhead walks **forwards**: SpriteStudio has no
     * reverse audio, and playing the keys
     * a backward or ping-pong-return leg crosses would be a different sound
     * from the one that was authored. The player still reports every key it
     * crosses — the gate belongs here, on the playing, not on the reporting.
     * Nor does a key on the frame a seek landed on: the playhead did not cross it.
     */
    public bindToPlayer(player: AudioBindablePlayer): () => void {
        player.audioManager = this;
        return player.onAudio((e: SSAudioKey) => {
            if (e.soundName && player.isPlayingForward && !player.isSeekLanding?.(e.frameNo)) {
                this.play(e.soundName, e.loopNum, e.partIndex);
            }
        });
    }

    /**
     * Plays a preloaded sound instantly. If it's not preloaded, it will fetch and play it (with latency).
     */
    public play(soundName: string, loopNum: number = 1, partIndex: number = -1): AudioBufferSourceNode | null {
        // If context was suspended by autoplay policy, try to resume
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(console.warn);
        }

        const buffer = this.buffers.get(soundName);
        if (!buffer) {
            console.warn(`[SSWebAudioManager] Sound not preloaded, fetching on-the-fly: ${soundName}`);
            // Lazy load and play (will have latency)
            this.loadSound(soundName).then(() => {
                if (this.buffers.has(soundName)) {
                    this.play(soundName, loopNum, partIndex);
                }
            });
            return null;
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);

        // loopNum specifies the exact number of times to play the sound (must be >= 1).
        // There is no concept of an infinite loop for audio in SpriteStudio.
        const playCount = Math.max(1, loopNum);
        if (playCount > 1) {
            source.loop = true;
        }

        // Keep track of active sources for potential stopping
        this.activeSources.add(source);
        source.onended = () => {
            this.activeSources.delete(source);
            source.disconnect();
        };

        source.start(0);

        // If playCount > 1, schedule the exact stop time.
        if (playCount > 1) {
            const totalDuration = buffer.duration * playCount;
            source.stop(this.ctx.currentTime + totalDuration);
        }
        return source;
    }

    /**
     * Stop all currently playing sounds.
     */
    public stopAll(): void {
        for (const source of this.activeSources) {
            try {
                source.stop();
            } catch (e) {
                // Ignore if already stopped
            }
        }
        this.activeSources.clear();
    }

    /**
     * Releases specific sounds from memory to free up resources.
     */
    public release(soundNames: string[]) {
        for (const name of soundNames) {
            this.buffers.delete(name);
        }
    }

    /**
     * Releases all cached sounds and stops any currently playing audio.
     */
    public releaseAll() {
        this.stopAll();
        this.buffers.clear();
    }
}
