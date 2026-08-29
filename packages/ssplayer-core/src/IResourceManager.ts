export interface IResourceManager {
    /**
     * Loads a texture from the given URL and associates it with the given hash.
     * @param url The URL of the texture to load.
     * @param hash The hash of the texture (derived from its filename in SSAB).
     */
    loadTexture(url: string, hash: number): Promise<void>;

    /**
     * Optional: bind a texture from raw (encoded) image bytes — e.g. a PNG/JPEG
     * embedded in the SSAB (`--embedded` converter mode) — and associate it with
     * the given hash. ResourceManagers that only support URL loading may omit
     * this; the core then falls back to {@link loadTexture} with a resolved file
     * URL, so embedded textures require this method to render.
     * @param bytes The encoded image bytes (e.g. a PNG/JPEG file's contents).
     * @param hash The hash of the texture (cell-map name hash).
     */
    loadTextureFromBytes?(bytes: Uint8Array, hash: number): Promise<void>;

    /**
     * Gets a loaded texture by its hash.
     * @param hash The hash of the texture.
     * @returns The engine-specific texture object (e.g. PIXI.Texture).
     */
    getTexture(hash: number): any;

    /**
     * Optional: forget every texture bound for the previously bound pack, so the
     * next one loads its own from scratch. Called by the core from
     * `bindResource`; a manager that caches by hash must implement it.
     */
    reset?(): void;

    /**
     * Frees all managed resources.
     */
    destroy(): void;
}
