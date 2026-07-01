import type { SSPlayer, SSAudioEvent } from './SSPlayer.js';
import type { IAudioManager, SoundAsset } from '@spritestudio/ssplayer-core';

export class SSWebAudioManager implements IAudioManager {
    private ctx: AudioContext;
    private buffers: Map<string, AudioBuffer> = new Map();
    private activeSources: Set<AudioBufferSourceNode> = new Set();
    private soundPaths: Map<string, string> = new Map();

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
        }
        const promises = sounds.map(asset => this.loadSound(asset.name));
        await Promise.all(promises);
    }

    /**
     * Internal method to fetch and decode a single sound file.
     */
    private async loadSound(soundName: string): Promise<void> {
        if (this.buffers.has(soundName)) return;

        try {
            const url = this.soundPaths.get(soundName) || soundName;
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.buffers.set(soundName, audioBuffer);
        } catch (e) {
            console.error(`[SSWebAudioManager] Failed to load sound: ${soundName}`, e);
        }
    }

    /**
     * Automatically binds to the SSPlayer's audio events and plays sounds accordingly.
     * Returns an unsubscribe function if you need to unbind later.
     */
    public bindToPlayer(player: SSPlayer): () => void {
        return player.onAudio((e: SSAudioEvent) => {
            if (e.soundName) {
                // A SpriteStudio Audio part acts like a single track.
                // Playing a new sound on the same part interrupts the previous one.
                this.play(e.soundName, e.loopNum, e.partIndex);
            }
        });
    }

    /**
     * Plays a preloaded sound instantly. If it's not preloaded, it will fetch and play it (with latency).
     */
    public play(soundName: string, loopNum: number = 0, partIndex: number = -1): AudioBufferSourceNode | null {
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

        // A part can only emit one sound at a time.
        // If a sound is already playing on this part, stop it before starting the new one.
        if (partIndex !== -1) {
            for (const active of this.activeSources) {
                if ((active as any)._ssPartIndex === partIndex) {
                    try { active.stop(); } catch (e) {}
                }
            }
        }

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        (source as any)._ssPartIndex = partIndex;
        source.connect(this.ctx.destination);

        // loopNum === 1 means play once.
        // loopNum > 1 means play exactly `loopNum` times.
        // loopNum === 0 or -1 usually means infinite loop in SS formats, we treat <= 0 as infinite.
        if (loopNum !== 1) {
            source.loop = true;
        }

        let remainingPlayTime = -1;

        if (loopNum === 1) {
            // Play exactly once
        } else if (loopNum > 1) {
            // Play exactly `loopNum` times
            const totalDuration = buffer.duration * loopNum;
            remainingPlayTime = totalDuration;
        }

        // Keep track of active sources for potential stopping
        this.activeSources.add(source);
        source.onended = () => {
            this.activeSources.delete(source);
            source.disconnect();
        };

        source.start(0);

        // If loopNum > 0 and we calculated a remaining play time, schedule the exact stop.
        if (remainingPlayTime > 0) {
            source.stop(this.ctx.currentTime + remainingPlayTime);
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
