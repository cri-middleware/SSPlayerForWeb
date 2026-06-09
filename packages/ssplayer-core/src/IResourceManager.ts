export interface IResourceManager {
    /**
     * Loads a texture from the given URL and associates it with the given hash.
     * @param url The URL of the texture to load.
     * @param hash The hash of the texture (derived from its filename in SSAB).
     */
    loadTexture(url: string, hash: number): Promise<void>;

    /**
     * Gets a loaded texture by its hash.
     * @param hash The hash of the texture.
     * @returns The engine-specific texture object (e.g. PIXI.Texture).
     */
    getTexture(hash: number): any;

    /**
     * Frees all managed resources.
     */
    destroy(): void;
}
