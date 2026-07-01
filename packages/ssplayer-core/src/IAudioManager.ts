export interface SoundAsset {
    name: string;
    path: string;
}

export interface IAudioManager {
    /**
     * Preloads the given list of sound assets (name and file path).
     */
    preload(sounds: SoundAsset[]): Promise<void>;

    /**
     * Releases specific sounds from memory.
     */
    release?(soundNames: string[]): void;

    /**
     * Releases all sounds managed by this audio manager.
     */
    releaseAll?(): void;

    /**
     * Stops all currently playing sounds without releasing them from memory.
     */
    stopAll?(): void;

    /**
     * Pauses all currently playing sounds.
     */
    pause?(): void;

    /**
     * Resumes all paused sounds.
     */
    resume?(): void;
}
