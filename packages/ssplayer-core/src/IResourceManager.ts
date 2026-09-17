export interface IResourceManager {
    /**
     * Loads a texture from the given URL and associates it with the given hash.
     * @param url The URL of the texture to load.
     * @param hash The cell-map name hash — a slot in one `.ssab`, not an image.
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
     * Optional: replace the texture bound to `hash` with a caller-supplied engine
     * texture (runtime texture replacement — costume/expression swaps). The
     * override *shadows* the originally loaded texture rather than freeing it, so
     * {@link clearOverrideTexture} can restore the original with no reload. The
     * override object is caller-owned; managers that build their own from a raw
     * source track that separately and free only what they built.
     *
     * A manager without this method cannot be a texture-replacement target, and
     * the core throws a clear error rather than silently no-op.
     * @param hash The render-time texture key (cell-map or external-texture name hash).
     * @param texture The engine-specific texture object (e.g. PIXI.Texture).
     */
    setOverrideTexture?(hash: number, texture: unknown): void;

    /**
     * Optional: drop any override for `hash`, restoring the originally loaded
     * texture. A no-op when nothing is overridden. Pairs with
     * {@link setOverrideTexture}.
     */
    clearOverrideTexture?(hash: number): void;

    /**
     * Optional: the current override for `hash` (the caller-supplied value, not
     * the original texture), or `undefined` when nothing is overridden.
     */
    getOverrideTexture?(hash: number): unknown;

    /**
     * Optional: forget every texture bound for the previously bound pack, so the
     * next one loads its own from scratch. Called by the core from
     * `bindResource`; a manager that caches by hash must implement it. Must also
     * drop any runtime texture overrides — they belong to the previous pack's
     * hashes.
     */
    reset?(): void;

    /**
     * Frees all managed resources.
     */
    destroy(): void;
}
