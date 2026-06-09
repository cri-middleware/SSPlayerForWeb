import { Assets, Texture } from 'pixi.js';
import { IResourceManager } from '@spritestudio/ssplayer-core';

export class PixiResourceManager implements IResourceManager {
    private textures: Map<number, Texture> = new Map();

    public async loadTexture(url: string, hash: number): Promise<void> {
        if (!this.textures.has(hash)) {
            try {
                const tex = await Assets.load<Texture>(url);
                this.textures.set(hash, tex);
            } catch (e) {
                console.error(`Failed to load texture: ${url}`, e);
            }
        }
    }

    public getTexture(hash: number): Texture | undefined {
        return this.textures.get(hash);
    }

    public destroy(): void {
        this.textures.forEach(tex => {
            tex.destroy(true);
        });
        this.textures.clear();
    }
}
