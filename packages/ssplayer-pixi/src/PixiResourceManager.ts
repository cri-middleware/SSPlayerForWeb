import { Assets, Texture } from 'pixi.js';
import { IResourceManager } from '@spritestudio/ssplayer-core';

export class PixiResourceManager implements IResourceManager {
    private loadedAliases: Set<string> = new Set();

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

    public getTexture(hash: number): Texture | undefined {
        return Assets.get<Texture>(hash.toString());
    }

    public destroy(): void {
        this.loadedAliases.forEach(alias => {
            Assets.unload(alias);
        });
        this.loadedAliases.clear();
    }
}
