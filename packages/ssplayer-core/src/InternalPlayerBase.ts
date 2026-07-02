import * as flatbuffers from 'flatbuffers';
import { SSRuntimeManager, SSABResource, WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle, EffectDrawPlan, getWasmMemory } from './SSRuntimeManager.js';
import { IResourceManager } from './IResourceManager.js';
import { IAudioManager } from './IAudioManager.js';
import { InstanceSlotHandle, EffectSlotHandle } from './SlotHandles.js';
import { InstancePackProvider, resolveInstancePacks } from './PackResolver.js';

export interface EffectChildState {
    slot: EffectSlotHandle;
    visible: boolean;
}

export interface InstanceChildState<T> {
    slot: InstanceSlotHandle;
    player: T;
    prevChildFrame: number;
    visible: boolean;
    parentMatrix: Float32Array;
}

/**
 * Generic InternalPlayerBase
 * Encapsulates the engine-independent playback logic (play, pause, stop, update, etc.)
 * and manages the SSRuntimeManager.
 * Rendering engine wrappers (e.g., PixiJS, RMMZ) can hold or inherit this class
 * to obtain vertex data and matrices required for rendering.
 */
export abstract class InternalPlayerBase<T extends InternalPlayerBase<T>> {
    public runtimeManager: SSRuntimeManager;
    public audioManager: IAudioManager | null = null;
    private _speedRate: number = 1.0;
    private _resourceManager: IResourceManager | null = null;
    private _ssabUrl: string = '';
    private _assetBaseUrl: string = '';
    private _texturePaths: { hash: number, path: string }[] = [];
    private _ssabResource: SSABResource | null = null;
    public _isChildPlayer: boolean = false;
    public _instancePackResources: Map<number, SSABResource> = new Map();
    public _instancePackProvider: InstancePackProvider | null = null;
    private _animationName: string = '';
    private _subFrameEnabled: boolean = false;
    protected _instanceChildren: Map<number, InstanceChildState<T>> = new Map();
    private _effectChildren: Map<number, EffectChildState> = new Map();

    constructor(resourceManager?: IResourceManager) {
        this.runtimeManager = new SSRuntimeManager();
        
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
     * @param assetBaseUrl Optional base URL for assets. If omitted, uses the ssabUrl directory.
     */
    public async load(ssabUrl: string, assetBaseUrl?: string) {
        const response = await fetch(ssabUrl);
        if (!response.ok) {
            throw new Error(`Failed to load SSAB: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        this._ssabUrl = ssabUrl;
        this._assetBaseUrl = assetBaseUrl || ssabUrl.substring(0, ssabUrl.lastIndexOf('/'));
        
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
        this._instancePackResources.forEach(res => res.destroy());
        this._instancePackResources.clear();
        this._ssabResource = new SSABResource(buffer);
        this.runtimeManager.bindResource(this._ssabResource);
        this._texturePaths = SSRuntimeManager.extractTexturePaths(buffer);
    }

    /**
     * Loads all textures required by the bound SSAB resource via the ResourceManager.
     * @param assetBaseUrl The base URL to prepend to the texture paths. If not provided, uses the URL inferred from load().
     */
    public async loadTextures(assetBaseUrl?: string): Promise<void> {
        if (!this._resourceManager) {
            throw new Error("ResourceManager is not set on InternalPlayerBase.");
        }
        
        const base = assetBaseUrl || this._assetBaseUrl;
        const prefix = base && !base.endsWith('/') ? base + '/' : base;

        const rm = this._resourceManager;
        const loadBytes = rm.loadTextureFromBytes?.bind(rm);

        // Textures whose bytes are embedded in the SSAB (converter `--embedded`
        // mode) are decoded in-place; the rest are fetched as sibling files.
        // Only consulted when the ResourceManager can accept raw bytes — else
        // everything falls back to URL loading (embedded won't render there).
        let embedded: Map<number, Uint8Array> | null = null;
        if (loadBytes) {
            const buf = this.getSsabBuffer();
            if (buf) {
                const list = SSRuntimeManager.extractEmbeddedTextures(buf);
                if (list.length > 0) embedded = new Map(list.map(e => [e.hash, e.bytes] as const));
            }
        }

        const promises = this._texturePaths.map(async (info) => {
            const bytes = embedded?.get(info.hash);
            if (bytes && loadBytes) {
                await loadBytes(bytes, info.hash);
            } else {
                await rm.loadTexture(prefix + info.path, info.hash);
            }
        });

        await Promise.all(promises);
    }

    /**
     * Helper to load textures and set the animation in one call.
     * @param animationName The name of the animation to set.
     * @param assetBaseUrl The base URL for asset loading. If not provided, uses the URL inferred from load().
     */
    public async setAnimation(animationName: string, assetBaseUrl?: string) {
        await this.loadTextures(assetBaseUrl);
        await this.loadInstancePacks(assetBaseUrl);
        this.runtimeManager.setupAnimation(animationName);
        this._animationName = animationName;
        
        if (this.audioManager) {
            if (this.audioManager.stopAll) {
                this.audioManager.stopAll();
            }
            const sounds = this.runtimeManager.getSounds();
            if (sounds.length > 0) {
                const base = assetBaseUrl || this._assetBaseUrl;
                const prefix = base && !base.endsWith('/') ? base + '/' : base;
                const preppedSounds = sounds.map(s => ({
                    name: s.name,
                    path: prefix + s.path
                }));
                await this.audioManager.preload(preppedSounds);
            }
        }
        
        this.setupInstanceChildren();
        this.setupEffectChildren();
    }

        private setupEffectChildren() {
        this._effectChildren.forEach(child => child.slot.destroy());
        this._effectChildren.clear();
        if (!this._ssabResource) return;

        const parts = this.runtimeManager.getEffectParts();
        for (const part of parts) {
            try {
                const slot = new EffectSlotHandle(this._ssabResource.raw, part.hash, part.seed);
                this._effectChildren.set(part.partIndex, { slot, visible: false });
            } catch (e) {
                console.error(`Failed to create EffectSlot for part ${part.partIndex}`, e);
            }
        }
    }

    private setupInstanceChildren() {
        this._instanceChildren.forEach(child => {
            try { child.player.destroy(); } catch { /* ignore */ }
            // child.slot is an InstanceSlotHandle (destroy() frees the WASM
            // handle and unregisters the finalizer). The previous `.free?.()`
            // was a no-op — the handle has no `free`, only `raw.free` — which
            // leaked the slot until GC on every re-`setAnimation`.
            try { child.slot.destroy(); } catch { /* ignore */ }
        });
        this._instanceChildren.clear();
        this._effectChildren.forEach(child => child.slot.destroy());
        this._effectChildren.clear();

        const refs = this.runtimeManager.getInstanceParts();
        for (const ref of refs) {
            const resource = this._instancePackResources.get(ref.packHash);
            if (!resource) {
                console.warn(`Instance part ${ref.partIndex} references pack "${ref.packName}" (hash ${ref.packHash}) which is not loaded; skipping.`);
                continue;
            }

            try {
                const childPlayer = this.createChildPlayer(this._resourceManager || undefined);
                childPlayer._isChildPlayer = true;
                childPlayer.audioManager = this.audioManager;
                childPlayer.subFrameEnabled = this.subFrameEnabled;
                // Child needs to share the loaded packs registry so nested instances work
                childPlayer._instancePackResources = this._instancePackResources;
                childPlayer.bindSharedResource(resource);
                childPlayer.setCoordinateSystem(this.runtimeManager.context.get_coordinate_system());
                childPlayer.runtimeManager.context.set_render_mode(this.runtimeManager.context.get_render_mode());
                
                // Because we use shared resources, we must directly call runtimeManager.setupAnimation and setupInstanceChildren
                childPlayer.runtimeManager.setupAnimation(ref.animeName);
                childPlayer._animationName = ref.animeName;
                childPlayer.setupInstanceChildren(); // Recurse
                childPlayer.setupEffectChildren();

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
     * parts, transitively, into the shared `_instancePackResources` registry
     * (delegated to the engine-agnostic `resolveInstancePacks`). The runtime
     * manager then creates the child contexts on `setupAnimation`.
     */
    private async loadInstancePacks(assetBaseUrl?: string): Promise<void> {
        const buf = this.getSsabBuffer();
        if (!buf) return;

        await resolveInstancePacks({
            rootSsab: buf,
            assetBaseUrl: assetBaseUrl || this._assetBaseUrl,
            provider: this._instancePackProvider,
            resourceManager: this._resourceManager,
            into: this._instancePackResources,
        });
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
        
        // Restarting playback should also reset independent slots (effects and instances)
        this.setupInstanceChildren();
        this.setupEffectChildren();
    }

    /**
     * Pauses the playback.
     */
    public pause() {
        if (!this.runtimeManager.context.is_pausing()) {
            this.runtimeManager.context.pause();
        }
    }

    /**
     * Resumes the playback from a paused state.
     */
    public resume() {
        if (this.runtimeManager.context.is_pausing()) {
            this.runtimeManager.context.pause(); // pause() in WASM toggles the state
        }
    }

    public stop() {
        this.runtimeManager.context.stop();
        if (this.audioManager && this.audioManager.stopAll) {
            this.audioManager.stopAll();
        }
    }

    /**
     * Updates the animation frame by the given delta time.
     *
     * When paused, the main timeline is NOT advanced, but the effect / instance
     * slots are still stepped with the real delta so that `independent` parts keep
     * running on their own clock (SpriteStudio independent semantics; mirrors
     * SSPlayerForGodot). The runtime's `step()` ignores the delta for
     * non-independent slots — they stay synced to the (frozen) parent frame — so
     * passing the real delta unconditionally is safe. When fully stopped, nothing
     * advances.
     * @param deltaMs The elapsed time since the last frame in milliseconds.
     */
    public update(deltaMs: number) {
        if (!this.isPlaying) return;
        const deltaSeconds = deltaMs / 1000.0;

        if (this.isPausing) {
            // Paused: keep independent slots advancing; do not touch the timeline.
            this.stepEffectSlots(deltaSeconds, false);
            this.stepInstanceSlots(deltaSeconds, false);
            return;
        }

        // Delegate to the manager so animation playback advances
        this.runtimeManager.update(deltaMs);
        this.stepEffectSlots(deltaSeconds, this.runtimeManager.context.is_looped());
        this.stepInstanceSlots(deltaSeconds, this.runtimeManager.context.is_looped());
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

    
    public getEffectDrawPlan(partIndex: number): EffectDrawPlan | null {
        const item = this._effectChildren.get(partIndex);
        if (!item || !item.visible) return null;

        const ptr = item.slot.raw.get_draw_plan_buf();
        const len = item.slot.raw.get_draw_plan_len();
        if (ptr === 0 || len === 0) return null;

        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const bb = new flatbuffers.ByteBuffer(buf);
        return EffectDrawPlan.getRootAsEffectDrawPlan(bb);
    }

    public setFrame(frame: number) {
        if (!this._subFrameEnabled) {
            frame = Math.floor(frame);
        }
        this.runtimeManager.context.set_frame_no(frame);
        this.stepEffectSlots(0, false);
        this.stepInstanceSlots(0, false);
    }

    public getFrame(): number {
        return this.runtimeManager.context.get_frame_no();
    }

    public get subFrameEnabled(): boolean {
        return this._subFrameEnabled;
    }

    public set subFrameEnabled(value: boolean) {
        this._subFrameEnabled = value;
        this._instanceChildren.forEach(child => {
            child.player.subFrameEnabled = value;
        });
    }

    public getFrameNo(): number {
        const frameNo = this.runtimeManager.context.get_frame_no();
        return this._subFrameEnabled ? frameNo : Math.floor(frameNo);
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

        private stepEffectSlots(deltaSeconds: number, parentLooped: boolean) {
        if (this._effectChildren.size === 0) return;

        const frame = this.runtimeManager.context.get_frame_no();
        for (const [partIndex, item] of this._effectChildren.entries()) {
            const ev = this.runtimeManager.context.get_active_effect_event(partIndex);
            if (ev) {
                // y_flip = true for PixiJS (y-down), vert_stride = 2 (x,y)
                item.visible = item.slot.raw.step(ev, frame, deltaSeconds, this.getFrameRate(), parentLooped, true, 2);
                if ((ev as any).free) (ev as any).free();
            } else {
                item.visible = false;
            }
        }
    }

    private stepInstanceSlots(deltaSeconds: number, parentLooped: boolean) {
        if (this._instanceChildren.size === 0) return;

        const parentFrame = this.runtimeManager.context.get_frame_no();
        for (const [partIndex, childState] of this._instanceChildren.entries()) {
            const ev = this.runtimeManager.context.get_active_event_instance(partIndex);
            const visible = childState.slot.raw.step(ev, childState.player.runtimeManager.context, childState.prevChildFrame, parentFrame, deltaSeconds, parentLooped);

            const childDeltaSeconds = ev ? deltaSeconds * Math.abs(ev.speed) : deltaSeconds;

            if ((ev as any).free) (ev as any).free();

            childState.visible = visible;
            if (childState.slot.raw.transitioned()) {
                childState.player.runtimeManager.context.play();
            }
            childState.prevChildFrame = childState.player.runtimeManager.context.get_frame_no();

            // Advance the child's own effects
            childState.player.stepEffectSlots(childDeltaSeconds, childState.slot.raw.child_looped());
            // Advance the child's own instance children recursively
            childState.player.stepInstanceSlots(childDeltaSeconds, childState.slot.raw.child_looped());
        }
    }

    public getInstanceChild(partIndex: number): InstanceChildState<T> | undefined {
        return this._instanceChildren.get(partIndex);
    }

    /**
     * Frees the allocated memory.
     */
    protected abstract createChildPlayer(resourceManager?: IResourceManager): T;

    public destroy() {
        this.stop();
        
        this._instanceChildren.forEach(child => {
            try { child.player.destroy(); } catch { /* ignore */ }
            try { child.slot.destroy(); } catch { /* ignore */ }
        });
        this._instanceChildren.clear();
        this._effectChildren.forEach(child => child.slot.destroy());
        this._effectChildren.clear();

        // Free child instance contexts first (they reference the pack resources).
        this.runtimeManager.destroy();

        // Release external instance pack resources (the parent is freed below).
        // Only the root player owns this map; child players share it and should not clear it.
        if (!this._isChildPlayer) {
            for (const res of this._instancePackResources.values()) {
                if (res !== this._ssabResource) {
                    try { res.destroy(); } catch { /* ignore */ }
                }
            }
            this._instancePackResources.clear();
        }
        this._instancePackProvider = null;

        if (this._ssabResource) {
            if (!this._isChildPlayer) {
                this._ssabResource.destroy();
            }
            this._ssabResource = null;
        }
    }
}
