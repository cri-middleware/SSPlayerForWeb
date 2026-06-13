import { SSRuntimeManager, SSABResource, WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle, SSRuntimeInstanceSlot, getWasmMemory, finalizationRegistry } from './SSRuntimeManager.js';
import { IResourceManager } from './IResourceManager.js';
import { GeometryBuilder } from './GeometryBuilder.js';

/**
 * Host-supplied resolver for instance-referenced animation packs. Given the
 * referenced pack's name and name-hash, returns the pack's raw SSAB bytes, or
 * null/undefined to fall back to fetching `<base>/<name>.ssab`. Use this when
 * packs are not URL-addressable (e.g. drag-and-drop / in-memory bundles); the
 * host is then also responsible for loading those packs' textures (by cell-map
 * hash) into the shared ResourceManager before `setAnimation`.
 */
export type InstancePackProvider = (name: string, hash: number) => Uint8Array | null | undefined | Promise<Uint8Array | null | undefined>;

export class InstanceSlotHandle {
    public raw: SSRuntimeInstanceSlot;

    constructor() {
        this.raw = SSRuntimeInstanceSlot.create();
        finalizationRegistry.register(this, this.raw, this);
    }

    public destroy() {
        if (this.raw) {
            finalizationRegistry.unregister(this);
            this.raw.free();
            // @ts-ignore
            this.raw = null;
        }
    }
}

export interface InstanceChildState {
    slot: InstanceSlotHandle;
    player: DirectInternalPlayer;
    prevChildFrame: number;
    visible: boolean;
    parentMatrix: Float32Array;
}

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
    private _instancePackResources: Map<number, SSABResource> = new Map();
    private _instancePackProvider: InstancePackProvider | null = null;
    private _animationName: string = '';
    public geometryBuilder: GeometryBuilder;
    public subFrameEnabled: boolean = false;
    private _instanceChildren: Map<number, InstanceChildState> = new Map();

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

    /**
     * Supply a resolver for instance-referenced packs that aren't fetchable by
     * `<base>/<name>.ssab` (e.g. drag-and-drop). Called by `loadInstancePacks`
     * before falling back to fetch. When a pack is served this way the host
     * must also register that pack's textures (by cell-map hash) into the
     * ResourceManager beforehand, since the core won't fetch them.
     */
    public setInstancePackProvider(provider: InstancePackProvider | null) {
        this._instancePackProvider = provider;
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
        this._texturePaths = SSRuntimeManager.extractTexturePaths(buffer);
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
        await this.loadInstancePacks(textureBaseUrl);
        this.runtimeManager.setupAnimation(animationName);
        this._animationName = animationName;
        this.setupInstanceChildren();
    }

    private setupInstanceChildren() {
        this._instanceChildren.forEach(child => {
            try { child.player.destroy(); } catch { /* ignore */ }
            try { (child.slot as any)?.free?.(); } catch { /* ignore */ }
        });
        this._instanceChildren.clear();

        const refs = this.runtimeManager.getInstanceParts();
        for (const ref of refs) {
            const resource = this._instancePackResources.get(ref.packHash);
            if (!resource) {
                console.warn(`Instance part ${ref.partIndex} references pack "${ref.packName}" (hash ${ref.packHash}) which is not loaded; skipping.`);
                continue;
            }

            try {
                const childPlayer = new DirectInternalPlayer(this._resourceManager || undefined);
                // Child needs to share the loaded packs registry so nested instances work
                childPlayer._instancePackResources = this._instancePackResources;
                childPlayer.bindSharedResource(resource);
                childPlayer.setCoordinateSystem(this.runtimeManager.context.get_coordinate_system());
                childPlayer.runtimeManager.context.set_render_mode(this.runtimeManager.context.get_render_mode());
                
                // Because we use shared resources, we must directly call runtimeManager.setupAnimation and setupInstanceChildren
                childPlayer.runtimeManager.setupAnimation(ref.animeName);
                childPlayer._animationName = ref.animeName;
                childPlayer.setupInstanceChildren(); // Recurse

                const slot = new InstanceSlotHandle();
                this._instanceChildren.set(ref.partIndex, {
                    slot,
                    player: childPlayer,
                    prevChildFrame: childPlayer.runtimeManager.context.get_frame_no(),
                    visible: false,
                    parentMatrix: new Float32Array(6),
                });
            } catch (e) {
                console.error(`Failed to create instance child for part ${ref.partIndex} ("${ref.animeName}")`, e);
            }
        }
    }

    /**
     * Binds an already loaded SSABResource to the player (used by instance children).
     * @param resource The shared SSABResource.
     */
    public bindSharedResource(resource: SSABResource) {
        if (this._ssabResource && this._ssabResource !== resource) {
            this._ssabResource.destroy();
        }
        this._ssabResource = resource;
        this.runtimeManager.bindResource(resource);
        this._texturePaths = []; // Handled by parent
    }

    private getSsabBuffer(): Uint8Array | null {
        if (!this._ssabResource) return null;
        const ptr = this.runtimeManager.context.get_ssab_buf();
        const len = this.runtimeManager.context.get_ssab_len();
        if (ptr === 0 || len === 0) return null;
        return new Uint8Array(getWasmMemory().buffer, ptr, len);
    }

    /**
     * Resolve and load every animation pack referenced by `PartType::Instance`
     * parts, transitively. Referenced packs are fetched as sibling `.ssab`
     * files (`<textureBaseUrl>/<packName>.ssab`) and their textures are loaded
     * into the shared (hash-keyed) ResourceManager cache so instanced
     * sub-animations resolve their cells. The parent pack is registered under
     * its own hash so same-pack references reuse the already-bound resource.
     * Resulting resources are stored in `_instancePackResources` and handed to
     * the runtime manager, which creates the child contexts on `setupAnimation`.
     */
    private async loadInstancePacks(textureBaseUrl?: string): Promise<void> {
        const buf = this.getSsabBuffer();
        if (!buf) return;

        const parentInfo = SSRuntimeManager.extractPackInfo(buf);
        const queue = SSRuntimeManager.extractInstancePackRefs(buf);
        const seen = new Set<number>([parentInfo.hash]);

        const base = textureBaseUrl || this._textureBaseUrl;
        const prefix = base && !base.endsWith('/') ? base + '/' : base;

        while (queue.length > 0) {
            const ref = queue.shift()!;
            if (this._instancePackResources.has(ref.hash) || seen.has(ref.hash)) continue;
            seen.add(ref.hash);

            try {
                // Prefer a host-supplied provider (e.g. drag-and-drop bytes);
                // fall back to fetching a sibling `<base>/<name>.ssab`.
                let subBuf: Uint8Array | null = null;
                let fromProvider = false;
                if (this._instancePackProvider) {
                    const provided = await this._instancePackProvider(ref.name, ref.hash);
                    if (provided) {
                        subBuf = provided;
                        fromProvider = true;
                    }
                }
                if (!subBuf) {
                    const url = prefix + ref.name + '.ssab';
                    const response = await fetch(url);
                    if (!response.ok) {
                        console.warn(`Failed to load instance pack "${ref.name}" from ${url}: ${response.statusText}`);
                        continue;
                    }
                    subBuf = new Uint8Array(await response.arrayBuffer());
                }

                const resource = new SSABResource(subBuf);
                this._instancePackResources.set(ref.hash, resource);

                // Fetch the referenced pack's textures into the shared cache.
                // Provider packs aren't URL-addressable, so their textures are
                // the host's responsibility (registered before setAnimation).
                if (!fromProvider && this._resourceManager) {
                    const texPaths = SSRuntimeManager.extractTexturePaths(subBuf);
                    await Promise.all(texPaths.map(info => this._resourceManager!.loadTexture(prefix + info.path, info.hash)));
                }

                // Enqueue packs referenced by this pack (nested instances).
                if (this._resourceManager) {
                    for (const nested of SSRuntimeManager.extractInstancePackRefs(subBuf)) {
                        if (!this._instancePackResources.has(nested.hash)) {
                            queue.push(nested);
                        }
                    }
                }
            } catch (e) {
                console.error(`Error loading instance pack "${ref.name}"`, e);
            }
        }
    }

    /**
     * Gets the current animation name.
     */
    public get animationName(): string {
        return this._animationName;
    }

    /**
     * Starts the animation playback.
     * @param startFrame The frame to start playing from. -1 means play from the current frame.
     */
    public play(startFrame: number = -1) {
        if (startFrame >= 0) {
            this.runtimeManager.context.play_with_start_frame(startFrame);
        } else {
            this.runtimeManager.context.play();
        }
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
        // Delegate to the manager so animation playback AND effect-slot
        // simulation advance together (slots are stepped inside update()).
        this.runtimeManager.update(deltaMs);
        this.stepInstanceSlots(deltaMs / 1000.0, this.runtimeManager.context.is_looped());
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
        // Re-evaluates effect slots for the seeked frame (matches Godot's
        // seek-and-redraw); a plain set_frame_no would freeze particles.
        this.runtimeManager.seekTo(frame);
        this.stepInstanceSlots(0, false);
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

    private stepInstanceSlots(deltaSeconds: number, parentLooped: boolean) {
        if (this._instanceChildren.size === 0) return;

        const parentFrame = this.runtimeManager.context.get_frame_no();
        for (const [partIndex, childState] of this._instanceChildren.entries()) {
            const ev = this.runtimeManager.context.get_active_event_instance(partIndex);
            const visible = childState.slot.raw.step(ev, childState.player.runtimeManager.context, childState.prevChildFrame, parentFrame, deltaSeconds, parentLooped);
            if ((ev as any).free) (ev as any).free();

            childState.visible = visible;
            if (childState.slot.raw.transitioned()) {
                childState.player.runtimeManager.context.play();
            }
            childState.prevChildFrame = childState.player.runtimeManager.context.get_frame_no();

            // Advance the child's own effects
            childState.player.runtimeManager.stepDependents(deltaSeconds, childState.slot.raw.child_looped());
            // Advance the child's own instance children recursively
            childState.player.stepInstanceSlots(deltaSeconds, childState.slot.raw.child_looped());
        }
    }

    public getInstanceChild(partIndex: number): InstanceChildState | undefined {
        return this._instanceChildren.get(partIndex);
    }

    /**
     * Frees the allocated memory.
     */
    public destroy() {
        this._instanceChildren.forEach(child => {
            try { child.player.destroy(); } catch { /* ignore */ }
            try { child.slot.destroy(); } catch { /* ignore */ }
        });
        this._instanceChildren.clear();

        // Free child instance contexts first (they reference the pack resources).
        this.runtimeManager.destroy();

        // Release external instance pack resources (the parent is freed below).
        for (const res of this._instancePackResources.values()) {
            if (res !== this._ssabResource) {
                try { res.destroy(); } catch { /* ignore */ }
            }
        }
        this._instancePackResources.clear();
        this._instancePackProvider = null;

        if (this._ssabResource) {
            this._ssabResource.destroy();
            this._ssabResource = null;
        }
    }
}
