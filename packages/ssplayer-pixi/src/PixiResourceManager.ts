import { Assets, ImageSource, Texture } from 'pixi.js';
import { IResourceManager } from '@spritestudio/ssplayer-core';

export class PixiResourceManager implements IResourceManager {
    private loadedAliases: Set<string> = new Set();
    // Textures decoded from embedded SSAB bytes (converter `--embedded` mode).
    // Kept out of the Pixi Assets cache — we own their lifetime and free them in
    // destroy(). getTexture() checks here first, then the Assets cache.
    private embeddedTextures: Map<number, Texture> = new Map();

    public async loadTexture(url: string, hash: number): Promise<void> {
        const alias = hash.toString();
        
        // Register the URL with the hash alias if not already registered
        if (!Assets.resolver.hasKey(alias)) {
            Assets.add({ alias: alias, src: url });
        }

        // If it's not loaded/cached yet, load it
        if (!Assets.cache.has(alias)) {
            try {
                await Assets.load<Texture>(alias);
                this.loadedAliases.add(alias);
            } catch (e) {
                console.error(`Failed to load texture: ${url}`, e);
            }
        }
    }

    /**
     * Decode raw (encoded) image bytes — e.g. a PNG embedded in the SSAB via the
     * converter's `--embedded` mode — into a texture under `hash`. Uses the same
     * `createImageBitmap` + `premultiply-alpha-on-upload` (ImageSource default)
     * as Pixi's own URL texture loader, so embedded and external textures render
     * identically.
     */
    public async loadTextureFromBytes(bytes: Uint8Array, hash: number): Promise<void> {
        if (this.embeddedTextures.has(hash)) return;
        const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
        this.embeddedTextures.set(hash, new Texture({ source: new ImageSource({ resource: bitmap }) }));
    }

    public getTexture(hash: number): Texture | undefined {
        return this.embeddedTextures.get(hash) ?? Assets.get<Texture>(hash.toString());
    }

    public destroy(): void {
        this.loadedAliases.forEach(alias => {
            Assets.unload(alias);
        });
        this.loadedAliases.clear();
        this.embeddedTextures.forEach(tex => tex.destroy(true));
        this.embeddedTextures.clear();
    }
}
