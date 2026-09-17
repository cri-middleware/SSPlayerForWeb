import { Assets, ImageSource, Texture } from 'pixi.js';
import { IResourceManager } from '@spritestudio/ssplayer-core';

export class PixiResourceManager implements IResourceManager {
    private textures: Map<number, Texture> = new Map();
    // Textures decoded from embedded SSAB bytes (converter `--embedded` mode)
    // and caller-supplied sources. Kept out of the Pixi Assets cache — we own
    // their lifetime and free them in reset()/destroy(). getTexture() checks
    // here first, then this player's URL-loaded textures.
    private embeddedTextures: Map<number, Texture> = new Map();
    // Runtime texture replacements (setOverrideTexture). Shadows the originally
    // loaded texture — checked first by getTexture — so clearing restores the
    // original with no reload. Caller-owned: never destroyed here (like the
    // URL-loaded textures), only forgotten on reset()/destroy().
    private overrideTextures: Map<number, Texture> = new Map();

    /**
     * Load `url` and bind it under `hash`. Cached in Pixi's global `Assets`
     * under the URL, deliberately not under the hash: the hash is a cell-map
     * name hash, unique only within one `.ssab`, so aliasing on it hands one
     * project another project's atlas.
     */
    public async loadTexture(url: string, hash: number): Promise<void> {
        if (this.textures.has(hash) || this.embeddedTextures.has(hash)) return;
        try {
            this.textures.set(hash, await Assets.load<Texture>(url));
        } catch (e) {
            console.error(`Failed to load texture: ${url}`, e);
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

    public bindTextureSource(source: ImageBitmap | HTMLImageElement | HTMLCanvasElement, hash: number): void {
        this.embeddedTextures.get(hash)?.destroy(true);
        this.embeddedTextures.set(hash, new Texture({ source: new ImageSource({ resource: source }) }));
    }

    public getTexture(hash: number): Texture | undefined {
        return this.overrideTextures.get(hash) ?? this.embeddedTextures.get(hash) ?? this.textures.get(hash);
    }

    /**
     * Runtime texture replacement: bind `texture` for `hash`, shadowing the
     * originally loaded texture. Caller-owned — not destroyed here. The pixi
     * shader/mesh caches are keyed by the `Texture` object, so the new texture
     * gets its own shader on the next draw and the swap is picked up
     * automatically; the stale entry is dropped at the next pack load.
     */
    public setOverrideTexture(hash: number, texture: Texture): void {
        this.overrideTextures.set(hash, texture);
    }

    /** Drop the override for `hash`, restoring the originally loaded texture. */
    public clearOverrideTexture(hash: number): void {
        this.overrideTextures.delete(hash);
    }

    /** The current override for `hash` (never the original), or undefined. */
    public getOverrideTexture(hash: number): Texture | undefined {
        return this.overrideTextures.get(hash);
    }

    public reset(): void {
        this.embeddedTextures.forEach(tex => tex.destroy(true));
        this.embeddedTextures.clear();
        this.textures.clear();
        // Overrides are caller-owned; forget them without destroying.
        this.overrideTextures.clear();
    }

    public destroy(): void {
        // Free only the textures this instance owns: the embedded (`--embedded`
        // mode) and caller-supplied textures kept out of the Pixi Assets cache.
        // URL-loaded textures live in Pixi's global, deliberately-shared Assets
        // cache and may be in use by other SSPlayers that loaded the same URL, so
        // we do NOT Assets.unload() them here — that would yank a texture still in
        // use elsewhere. The host owns the global Assets-cache lifecycle.
        this.reset();
    }
}
