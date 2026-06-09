import { SSRuntimeManager, SSABResource, WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle } from './SSRuntimeManager.js';
import { IResourceManager } from './IResourceManager.js';
import { GeometryBuilder } from './GeometryBuilder.js';

/**
 * Generic DirectInternalPlayer
 * Encapsulates the engine-independent playback logic (play, pause, stop, update, etc.)
 * and manages the SSRuntimeManager.
 * Rendering engine wrappers (e.g., PixiJS, RMMZ) can hold or inherit this class
 * to obtain vertex data and matrices required for rendering.
 */
export class DirectInternalPlayer {
    public runtimeManager: SSRuntimeManager;
    private _speedRate: number = 1.0;
    private _resourceManager: IResourceManager | null = null;
    private _ssabUrl: string = '';
    private _textureBaseUrl: string = '';
    private _texturePaths: { hash: number, path: string }[] = [];
    private _ssabResource: SSABResource | null = null;
    public geometryBuilder: GeometryBuilder;
    public subFrameEnabled: boolean = false;

    constructor(resourceManager?: IResourceManager) {
        this.runtimeManager = new SSRuntimeManager();
        this.geometryBuilder = new GeometryBuilder(this.runtimeManager);
        if (resourceManager) {
            this._resourceManager = resourceManager;
        }
    }

    public setResourceManager(resourceManager: IResourceManager) {
        this._resourceManager = resourceManager;
    }

    public get resourceManager(): IResourceManager | null {
        return this._resourceManager;
    }

    /**
     * Fetches and binds an SSAB file to the player.
     * @param ssabUrl The URL of the SSAB file.
     * @param textureBaseUrl Optional base URL for textures. If omitted, uses the ssabUrl directory.
     */
    public async load(ssabUrl: string, textureBaseUrl?: string) {
        await this.runtimeManager.init();

        const response = await fetch(ssabUrl);
        if (!response.ok) {
            throw new Error(`Failed to load SSAB: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        this._ssabUrl = ssabUrl;
        this._textureBaseUrl = textureBaseUrl || ssabUrl.substring(0, ssabUrl.lastIndexOf('/'));
        
        this.bindResource(new Uint8Array(buffer));
    }

    /**
     * Binds the SSAB buffer to the player and extracts required texture paths.
     * @param buffer The raw byte array of the SSAB file.
     */
    public bindResource(buffer: Uint8Array) {
        if (this._ssabResource) {
            this._ssabResource.destroy();
        }
        this._ssabResource = new SSABResource(buffer);
        this.runtimeManager.bindResource(this._ssabResource);
        this._texturePaths = SSRuntimeManager.extractTexturePaths(buffer.buffer as ArrayBuffer);
    }

    /**
     * Loads all textures required by the bound SSAB resource via the ResourceManager.
     * @param textureBaseUrl The base URL to prepend to the texture paths. If not provided, uses the URL inferred from load().
     */
    public async loadTextures(textureBaseUrl?: string): Promise<void> {
        if (!this._resourceManager) {
            throw new Error("ResourceManager is not set on DirectInternalPlayer.");
        }
        
        const base = textureBaseUrl || this._textureBaseUrl;
        const prefix = base && !base.endsWith('/') ? base + '/' : base;

        const promises = this._texturePaths.map(async (info) => {
            const texUrl = prefix + info.path;
            await this._resourceManager!.loadTexture(texUrl, info.hash);
        });

        await Promise.all(promises);
    }

    /**
     * Helper to load textures and set the animation in one call.
     * @param animationName The name of the animation to set.
     * @param textureBaseUrl The base URL for texture loading. If not provided, uses the URL inferred from load().
     */
    public async setAnimation(animationName: string, textureBaseUrl?: string) {
        await this.loadTextures(textureBaseUrl);
        this.runtimeManager.setupAnimation(animationName);
    }

    /**
     * Starts the animation playback.
     * @param loop The number of times to loop the animation. 0 = infinite, -1 = infinite (SSPlayer default)
     */
    public play(loop: number = -1) {
        this.runtimeManager.context.play();
        this.setLoop(loop);
    }

    /**
     * Pauses the playback.
     */
    public pause() {
        this.runtimeManager.context.pause();
    }

    /**
     * Resumes the playback from a paused state.
     */
    public resume() {
        this.runtimeManager.context.play();
    }

    /**
     * Stops the playback.
     */
    public stop() {
        this.runtimeManager.context.stop();
    }

    /**
     * Updates the animation frame by the given delta time.
     * @param deltaMs The elapsed time since the last frame in milliseconds.
     */
    public update(deltaMs: number) {
        if (!this.isPlaying || this.isPausing) return;
        this.runtimeManager.context.update(deltaMs);
    }

    /**
     * Sets the coordinate system for the runtime.
     */
    public setCoordinateSystem(system: WebCoordinateSystem) {
        this.runtimeManager.setCoordinateSystem(system);
    }

    // --- Playback Control Methods ---

    /**
     * Gets whether the animation is currently playing.
     */
    public get isPlaying(): boolean {
        return this.runtimeManager.context.is_playing();
    }

    /**
     * Gets whether the animation is currently pausing.
     */
    public get isPausing(): boolean {
        return this.runtimeManager.context.is_pausing();
    }

    public setSpeed(speed: number) {
        this._speedRate = speed;
        this.runtimeManager.context.set_animation_speed(speed);
    }

    public getSpeed(): number {
        return this._speedRate;
    }

    public setFrame(frame: number) {
        this.runtimeManager.context.set_frame_no(frame);
    }

    public getFrame(): number {
        return this.runtimeManager.context.get_frame_no();
    }

    public getFrameNo(): number {
        const frameNo = this.runtimeManager.context.get_frame_no();
        return this.subFrameEnabled ? frameNo : Math.floor(frameNo);
    }

    public getTotalFrames(): number {
        return this.runtimeManager.context.get_end_frame() - this.runtimeManager.context.get_start_frame() + 1;
    }

    public setFrameRate(fps: number) {
        this.runtimeManager.context.set_frame_rate(fps);
    }

    public getFrameRate(): number {
        return this.runtimeManager.context.get_fps();
    }

    public setAnimationSection(startFrame: number, endFrame: number) {
        this.runtimeManager.context.set_animation_section(startFrame, endFrame);
    }

    public getAnimationSectionStart(): number {
        return this.runtimeManager.context.get_start_frame();
    }

    public getAnimationSectionEnd(): number {
        return this.runtimeManager.context.get_end_frame();
    }

    public setPlaybackDirection(direction: WebPlaybackDirection, style: WebPlaybackStyle) {
        this.runtimeManager.context.set_playback_direction(direction, style);
    }

    public getPlaybackDirection(): WebPlaybackDirection {
        return this.runtimeManager.context.get_playback_direction();
    }

    public getPlaybackStyle(): WebPlaybackStyle {
        return this.runtimeManager.context.get_playback_style();
    }

    public setLoop(count: number) {
        this.runtimeManager.context.set_loop(count);
    }

    public getLoop(): number {
        return this.runtimeManager.context.get_loops();
    }

    public setSkipFrames(skip: boolean) {
        this.runtimeManager.context.set_skip_frames(skip);
    }

    public isSkipFrames(): boolean {
        return this.runtimeManager.context.get_skip_frames();
    }

    /**
     * Frees the allocated memory.
     */
    public destroy() {
        if (this._ssabResource) {
            this._ssabResource.destroy();
            this._ssabResource = null;
        }
        this.runtimeManager.destroy();
    }
}
