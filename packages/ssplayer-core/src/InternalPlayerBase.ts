import * as flatbuffers from 'flatbuffers';
import { SSRuntimeManager, SSABResource, WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle, EffectDrawPlan, getWasmMemory, hashString } from './SSRuntimeManager.js';
import { SSBlendOp, SSOverridePriority } from './PartOverride.js';
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
    private _audioManager: IAudioManager | null = null;
    private _speedRate: number = 1.0;
    private _prevFinished: boolean = false;
    private _resourceManager: IResourceManager | null = null;
    private _ssabUrl: string = '';
    private _assetBaseUrl: string = '';
    private _texturePaths: { hash: number, path: string }[] = [];
    private _animationNames: string[] = [];
    private _ssabResource: SSABResource | null = null;
    public _isChildPlayer: boolean = false;
    public _instancePackResources: Map<number, SSABResource> = new Map();
    public _instancePackProvider: InstancePackProvider | null = null;
    private _animationName: string = '';
    private _subFrameEnabled: boolean = true;
    // Asset loading is per-PACK, not per-animation (see prepareResources): these
    // track the one-shot so an animation switch costs nothing but a runtime reset.
    private _prepared: Promise<void> | null = null;
    private _resourcesReady: boolean = false;
    // The audioManager the pack's sounds were preloaded into, so a manager
    // attached late still gets its preload, and exactly once.
    private _soundsPreloadedFor: IAudioManager | null = null;
    private _soundsPromise: Promise<void> | null = null;
    private _catchUpPending: boolean = false;
    protected _instanceChildren: Map<number, InstanceChildState<T>> = new Map();
    private _effectChildren: Map<number, EffectChildState> = new Map();

    constructor(resourceManager?: IResourceManager) {
        this.runtimeManager = new SSRuntimeManager();

        if (resourceManager) {
            this._resourceManager = resourceManager;
        }
    }

    /**
     * Optional audio manager for the pack's sound parts.
     *
     * Attaching one starts preloading the pack's sounds right away (in the
     * background) when a resource is already bound — sounds belong to the pack,
     * so there is nothing to wait for. Await {@link preloadSounds} if you need
     * them in memory before playback rather than shortly after.
     */
    public get audioManager(): IAudioManager | null {
        return this._audioManager;
    }

    public set audioManager(manager: IAudioManager | null) {
        this._audioManager = manager;
        void this.preloadSounds().catch(e => {
            console.error('[SSPlayer] Failed to preload the pack sounds', e);
        });
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
     * Fetches and binds an SSAB file to the player, then loads everything the
     * pack needs (textures, instance packs) — when this resolves the player is
     * ready to draw and `setAnimation` does no asset I/O at all. Textures and
     * instance packs always resolve relative to the SSAB's own location (the
     * structure that ssconverter emits) — there is no separate asset-base
     * override.
     * @param ssabUrl The URL of the SSAB file.
     */
    public async load(ssabUrl: string) {
        const response = await fetch(ssabUrl);
        if (!response.ok) {
            throw new Error(`Failed to load SSAB: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();

        this.bindResource(new Uint8Array(buffer), ssabUrl);
        await this.prepareResources();
    }

    /**
     * URL the bound pack came from, or `''` for one bound as bytes with no URL.
     * Hosts otherwise have to remember this themselves to answer "is this the
     * same pack?" when deciding between an in-place animation switch and a
     * rebuild.
     */
    public get ssabUrl(): string {
        return this._ssabUrl;
    }

    /**
     * Binds the SSAB buffer to the player and extracts required texture paths.
     * @param buffer The raw byte array of the SSAB file.
     * @param ssabUrl Optional source URL of the SSAB. When given, textures and
     *   instance packs resolve relative to its directory (siblings of the SSAB —
     *   the structure ssconverter emits). Omit for inline / ArrayBuffer loads
     *   whose textures are supplied by hash rather than fetched.
     */
    public bindResource(buffer: Uint8Array, ssabUrl?: string) {
        if (ssabUrl !== undefined) {
            // Recorded on this path too, not just in load(): a host that fetches
            // the bytes itself (ssplayer-rmmz does, for a better error message)
            // would otherwise leave `ssabUrl` empty for a pack that plainly has
            // one, and only the asset base would survive.
            this._ssabUrl = ssabUrl;
            this._assetBaseUrl = ssabUrl.substring(0, ssabUrl.lastIndexOf('/'));
        }
        if (this._ssabResource) {
            this._ssabResource.destroy();
        }
        this._instancePackResources.forEach(res => res.destroy());
        this._instancePackResources.clear();
        this._ssabResource = new SSABResource(buffer);
        this.runtimeManager.bindResource(this._ssabResource);
        // A new pack means new assets: re-arm the one-shot load.
        this._prepared = null;
        this._resourcesReady = false;
        this._soundsPreloadedFor = null;
        this._soundsPromise = null;
        this._texturePaths = SSRuntimeManager.extractTexturePaths(buffer);
        // Cached here rather than left to the caller, because the alternative is
        // holding on to the whole SSAB (megabytes) or re-fetching it just to read
        // a couple of dozen strings — both of which adapters were doing.
        this._animationNames = SSRuntimeManager.extractAnimationNames(buffer);
    }

    /**
     * The bound SSAB's animation names, in table order; empty until a resource is
     * bound. Read-only: it is the cache, not a copy, so hosts handing it to
     * application code should copy it themselves.
     */
    public get animationNames(): readonly string[] {
        return this._animationNames;
    }

    /**
     * Loads all textures required by the bound SSAB resource via the ResourceManager.
     * Textures resolve relative to the SSAB's own location (set on load/bind).
     *
     * Prefer {@link prepareResources}, which pairs this with the instance packs
     * and runs both exactly once per bound resource.
     */
    public async loadTextures(): Promise<void> {
        if (!this._resourceManager) {
            throw new Error("ResourceManager is not set on InternalPlayerBase.");
        }

        const base = this._assetBaseUrl;
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
                // extractEmbeddedTextures returns views over WASM memory; copy them
                // (.slice) before the awaited decode below, since a concurrent WASM
                // grow on any context would detach the backing buffer mid-await.
                if (list.length > 0) embedded = new Map(list.map(e => [e.hash, e.bytes.slice()] as const));
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
     * Load every asset the bound pack needs, whichever animation ends up playing:
     * all cell-map textures and, transitively, every instance-referenced pack.
     * None of it is animation-scoped — the cell maps live on the binary, not on
     * the animation table — so it is loaded once here rather than on each switch.
     *
     * Idempotent: the work runs once per bound resource and later calls return
     * the same promise (a failed attempt is not cached, so a 404'd texture can be
     * retried). `load()` awaits it, so URL-loaded packs are ready before the
     * first `setAnimation`; hosts that bind bytes themselves should await it
     * after `bindResource` to keep the first switch free of asset I/O too.
     */
    public prepareResources(): Promise<void> {
        if (this._prepared) return this._prepared;

        const run = (async () => {
            try {
                await this.loadTextures();
                await this.loadInstancePacks();
                this._resourcesReady = true;
                // Sounds are equally pack-scoped; preload them here too when a
                // manager is already attached, so `load()` covers audio as well.
                await this.preloadSounds();
            } catch (e) {
                // Don't let one failed attempt poison every later setAnimation.
                if (this._prepared === run) this._prepared = null;
                throw e;
            }
        })();
        this._prepared = run;
        return run;
    }

    /**
     * Preload the pack's sounds into the attached audioManager, once. Like the
     * textures these are listed per pack (`soundLists` on the binary), so the set
     * does not change with the animation; the manager is tracked rather than a
     * flag so one attached later still gets its preload. Resolves immediately
     * when there is no manager, no bound pack, or the work is already done.
     */
    public preloadSounds(): Promise<void> {
        const audio = this._audioManager;
        // Children play through the parent's manager and have no asset base of
        // their own; the pack they share was preloaded by the parent.
        if (!audio || this._isChildPlayer) return Promise.resolve();
        // Already done or in flight — hand back the same promise, so a caller that
        // wants the sounds in memory can await work the attach already started.
        if (this._soundsPreloadedFor === audio) return this._soundsPromise ?? Promise.resolve();
        // Nothing to read yet — retried when a pack is bound (prepareResources).
        if (!this._ssabResource) return Promise.resolve();

        this._soundsPreloadedFor = audio;
        const run = (async () => {
            try {
                const sounds = this.runtimeManager.getSounds();
                if (sounds.length === 0) return;

                const base = this._assetBaseUrl;
                const prefix = base && !base.endsWith('/') ? base + '/' : base;
                await audio.preload(sounds.map(s => ({ name: s.name, path: prefix + s.path })));
            } catch (e) {
                // Retryable: forget the attempt rather than pinning this manager
                // to a preload that never completed.
                if (this._soundsPreloadedFor === audio) this._soundsPreloadedFor = null;
                throw e;
            } finally {
                if (this._soundsPromise === run) this._soundsPromise = null;
            }
        })();
        this._soundsPromise = run;
        return run;
    }

    /**
     * Switch to `animationName`. Synchronous, by design: an animation switch is a
     * runtime context reset and nothing more.
     *
     * Everything that could stall — textures, instance packs, sounds — belongs to
     * the *pack*, not to the animation, and is loaded once by `load()` /
     * {@link prepareResources}. Calling this on a pack whose assets are not in
     * yet still switches immediately (the runtime needs no textures to set up an
     * animation; the renderer simply has nothing to draw with until they land)
     * and the load is started in the background.
     * @param animationName The name of the animation to set.
     */
    public setAnimation(animationName: string): void {
        this.runtimeManager.setupAnimation(animationName);
        this._animationName = animationName;

        // The previous animation's sounds are not this animation's business.
        this._audioManager?.stopAll?.();

        this.setupInstanceChildren();
        this.setupEffectChildren();

        if (!this._resourcesReady) this.catchUpResources();
        // A no-op once done; only ever does real work for a manager attached
        // before any pack was bound.
        void this.preloadSounds().catch(e => {
            console.error('[SSPlayer] Failed to preload the pack sounds', e);
        });
    }

    /**
     * Load the pack's assets in the background, for a player switched before
     * `load()` / {@link prepareResources} finished (or was ever called).
     * Instance parts whose pack had not arrived were skipped by
     * `setupInstanceChildren`, so it is re-run once the packs are in.
     */
    private catchUpResources(): void {
        if (this._catchUpPending) return;
        this._catchUpPending = true;
        this.prepareResources()
            .then(() => {
                if (this._animationName) this.setupInstanceChildren();
            })
            .catch(e => {
                console.error(`[SSPlayer] Failed to load the assets for "${this._animationName}"`, e);
            })
            .finally(() => {
                this._catchUpPending = false;
            });
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
        // The parent loaded this pack's textures and resolved its instance packs
        // before creating us, so we are ready by construction: without this a
        // host that drives a child from getInstanceChild() would re-scan the
        // shared pack (embedded textures included) on every switch.
        this._prepared = Promise.resolve();
        this._resourcesReady = true;
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
    private async loadInstancePacks(): Promise<void> {
        const buf = this.getSsabBuffer();
        if (!buf) return;

        await resolveInstancePacks({
            rootSsab: buf,
            assetBaseUrl: this._assetBaseUrl,
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

        // Re-arm the finished edge so a replayed animation reports its next
        // completion (is_finished stays latched until play/setup).
        this._prevFinished = false;

        // Restarting playback should also reset independent slots (effects and
        // instances). Reset them IN PLACE: rebuilding the children here
        // (setupInstanceChildren) would destroy every child player, and a child's
        // destroy() runs stop() against the audioManager it SHARES with this
        // player — silently cutting the parent's own sound on every replay — as
        // well as invalidating any player the host took from getInstanceChild().
        this.resetInstanceSlots();
        this.setupEffectChildren();
    }

    /**
     * Re-arm the instance slots (and, recursively, each child's own slots) for a
     * replay, without touching the child players themselves: a fresh
     * InstanceSlotHandle is the runtime's reset for one instance part's playback
     * state. Rebuilding the child players is `setupInstanceChildren`'s job, and
     * belongs to setAnimation alone — see {@link play}.
     */
    private resetInstanceSlots() {
        this._instanceChildren.forEach(child => {
            try { child.slot.destroy(); } catch { /* ignore */ }
            child.slot = new InstanceSlotHandle();
            child.visible = false;
            child.player._prevFinished = false;
            child.player.resetInstanceSlots();
            child.player.setupEffectChildren();
        });
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
     * Reads the playback events produced by the most recent {@link update}.
     *
     * Must be called on the same tick that advanced, and only on that tick —
     * `looped` is a pulse the runtime clears on entry to every update, so a
     * later read loses it.
     *
     * `finished` is a sticky state rather than a pulse, so it is reported only
     * on its rising edge; {@link play} re-arms it. It is never raised under an
     * infinite loop count, nor by a commanded {@link stop}.
     */
    public pollPlaybackEvents(): { looped: boolean; finished: boolean } {
        const ctx = this.runtimeManager.context;
        const looped = ctx.is_looped();
        const finished = ctx.is_finished();
        const rising = finished && !this._prevFinished;
        this._prevFinished = finished;
        return { looped, finished: rising };
    }

    /**
     * Sets the coordinate system for the runtime.
     *
     * Propagates to the instance children (each sub-animation is its own runtime
     * context): they inherit the system once, when they are created, so without
     * this a later switch would flip the root animation while every instance part
     * kept rendering mirrored. Mirrors {@link subFrameEnabled}.
     */
    public setCoordinateSystem(system: WebCoordinateSystem) {
        this.runtimeManager.setCoordinateSystem(system);
        this._instanceChildren.forEach(child => {
            child.player.setCoordinateSystem(system);
        });
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

    // --- Part overrides (SDK docs: 40_components/65_override_layer) ---
    //
    // Per-part runtime overrides (colour / cell / visibility): an imperative
    // "make this part this colour / cell / hidden now" that wins over both the
    // keyframe and the blend, applied by the runtime on the resolved pose. The
    // runtime owns the override table and its whole lifecycle
    // (HoldUntilNextAnimation is cleared by setAnimation, Permanent is
    // re-validated, and binding another SSAB clears everything), so nothing is
    // cached or re-applied per frame here.
    //
    // Part indices are stable within one SSAB, so resolve a name once with
    // findPartIndex and pass the index if you set overrides often. Every method
    // takes either form. Overrides do not reach inside an instance part: its
    // child animation runs as its own context (get the child player from
    // getInstanceChild and override there).

    /**
     * Resolve a part name to its index in the current animation, or -1 when the
     * name is unknown / no animation is set up yet.
     */
    public findPartIndex(partName: string): number {
        return this.runtimeManager.context.find_part_index(partName);
    }

    /**
     * Force-hide a part (`hide` = true) or revert it to the animation (false).
     * With `cascade` the force-hide propagates to the part's descendants — note
     * that a keyframe `hide` never cascades, so this is the only way to hide a
     * whole sub-tree. Visibility has no priority mode: it always beats the
     * keyframe and is always cleared when a new animation is set up.
     */
    public setPartVisibilityOverride(part: number | string, hide: boolean, cascade: boolean = false): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        // force: 0 = revert, 1 = force-hide (2 = force-visible is reserved by the runtime).
        return this.applyOverride(ctx => ctx.set_part_visibility_override(index, hide ? 1 : 0, cascade));
    }

    /** Clear a part's visibility override (revert it to the animation). */
    public clearPartVisibilityOverride(part: number | string): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        return this.applyOverride(ctx => ctx.clear_part_visibility_override(index));
    }

    /**
     * Override a part's colour with a single value applied to all four corners.
     * `rgba` is packed `0xRRGGBBAA` and is interpreted in the same 8-bit sRGB
     * space as the authored PartColor: the runtime pre-multiplies its alpha with
     * the part's composed alpha itself, so do not pre-multiply or gamma-convert
     * it here.
     *
     * Applies to Normal parts only. Other part types silently ignore it — the
     * call still returns true, so success does not mean the part changed.
     */
    public setPartColorOverride(
        part: number | string,
        blendOp: SSBlendOp,
        rgba: number,
        priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
    ): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        return this.applyOverride(ctx => ctx.set_part_color_override(index, blendOp, rgba >>> 0, priority));
    }

    /**
     * Override a part's colour with four distinct corners, for a gradient. Same
     * contract as {@link setPartColorOverride}; `corners` is in the runtime's
     * order — left-top, right-top, left-bottom, right-bottom — and getting that
     * order wrong silently flips the gradient rather than failing.
     */
    public setPartColorOverrideCorners(
        part: number | string,
        blendOp: SSBlendOp,
        corners: readonly [number, number, number, number],
        priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
    ): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        const packed = Uint32Array.from(corners, c => c >>> 0);
        return this.applyOverride(ctx => ctx.set_part_color_override_corners(index, blendOp, packed, priority));
    }

    /** Clear a part's colour override (revert it to the animation). */
    public clearPartColorOverride(part: number | string): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        return this.applyOverride(ctx => ctx.clear_part_color_override(index));
    }

    /**
     * Make a part draw a different cell, named by its cell map (without the
     * `.ssce` extension) and cell name. The names are resolved once, here, so an
     * unresolvable cell returns false immediately rather than failing per frame;
     * empty names revert the part to the animation. See getCellMapNames /
     * getCellNames for the valid targets.
     *
     * Applies to Normal and mask parts only. Swapping in a cell from another
     * texture changes that part's draw batch, which the runtime plans for.
     */
    public setPartCellOverride(
        part: number | string,
        cellmapName: string,
        cellName: string,
        priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
    ): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        // (0, 0) is the runtime's "follow the animation" sentinel; empty names hash to 0.
        return this.applyOverride(ctx =>
            ctx.set_part_cell_override(index, hashString(cellmapName), hashString(cellName), priority));
    }

    /** Clear a part's cell override (revert it to the animation). */
    public clearPartCellOverride(part: number | string): boolean {
        const index = this.resolvePartIndex(part);
        if (index < 0) return false;
        return this.applyOverride(ctx => ctx.clear_part_cell_override(index));
    }

    /** Clear every per-part override on this player (all parts, all attributes). */
    public clearAllPartOverrides(): boolean {
        return this.applyOverride(ctx => ctx.clear_all_part_overrides());
    }

    /**
     * Cell-map names in the bound SSAB (no `.ssce` extension) — the namespace
     * {@link setPartCellOverride} takes.
     */
    public getCellMapNames(): string[] {
        return this.runtimeManager.getCellMapNames();
    }

    /** Cell names inside `cellmapName`, empty if that map isn't in this SSAB. */
    public getCellNames(cellmapName: string): string[] {
        return this.runtimeManager.getCellNames(cellmapName);
    }

    // --- Part following (transform read-out) -----------------------------
    //
    // Read a part's current-frame transform so an external object can follow it
    // (a weapon, effect or hitbox tracking a null part). Unlike the overrides
    // above these are pure reads: they report whatever frame the last update() /
    // setFrame() finalized, so call them after the player has advanced (a facade
    // drives its attachments from its per-frame seam). Part indices are stable
    // within one SSAB, so resolve a name once and pass the index if you follow a
    // part every frame.

    /**
     * The part's current-frame transform as a 2D affine `[m00, m01, m10, m11,
     * tx, ty]` in animation-local (Y-down) space, copied out of WASM (safe to
     * retain). Returns null when the part name/index is unknown in the current
     * animation. Pass `out` (a `Float32Array(6)`) to avoid allocation. Valid for
     * the frame the last update()/setFrame() produced; the matrix is computed
     * for every part regardless of `hide`, so a hidden part still reports where
     * it would be.
     */
    public getPartTransform(part: number | string, out?: Float32Array): Float32Array | null {
        const index = this.resolveKnownPartIndex(part);
        if (index < 0) return null;
        return this.runtimeManager.getWorldMatrix2D(index, out);
    }

    /**
     * Whether the part is hidden on the current frame — the animation's `hide`
     * keyframe (the same visibility the renderer honours), read at the drawn
     * frame (`floor` of the subframe playhead). Returns null when the part is
     * unknown. This reflects the animation, not a {@link setPartVisibilityOverride}
     * force-hide.
     */
    public isPartHidden(part: number | string): boolean | null {
        const index = this.resolveKnownPartIndex(part);
        if (index < 0) return null;
        const frameData = this.runtimeManager.getFrameData(Math.floor(this.getFrame()));
        // The frame's parts vector is num_parts long, ordered by part index
        // (same indexing as the renderer's per-part reads), so `index` addresses
        // this part directly. A part absent from the frame reads as visible.
        const state = frameData ? frameData.parts(index) : null;
        return state ? state.hide() : false;
    }

    private resolvePartIndex(part: number | string): number {
        if (typeof part === 'string') return this.findPartIndex(part);
        return Number.isInteger(part) && part >= 0 ? part : -1;
    }

    /**
     * {@link resolvePartIndex} for the read-out path, which additionally bounds a
     * numeric index against the parts table: those methods index the runtime's
     * per-part buffers directly, so an out-of-range part would read past the view
     * and yield NaN instead of the documented `null`. The override calls need no
     * such check — the runtime validates the index itself and `applyOverride`
     * reports its rejection as false.
     */
    private resolveKnownPartIndex(part: number | string): number {
        if (typeof part === 'string') return this.findPartIndex(part);
        if (!Number.isInteger(part) || part < 0) return -1;
        return part < this.runtimeManager.getPartsCount() ? part : -1;
    }

    /**
     * Run one override call against the runtime. The WASM boundary reports a
     * rejected override by throwing (bad blend op / priority, unresolvable cell,
     * part index out of range), while the API contract shared with the Godot and
     * Unity players is a boolean — so the throw is translated here.
     */
    private applyOverride(action: (ctx: SSRuntimeManager['context']) => void): boolean {
        try {
            action(this.runtimeManager.context);
            return true;
        } catch {
            return false;
        }
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
            const visible = childState.slot.raw.step(ev, childState.player.runtimeManager.context, parentFrame, deltaSeconds, parentLooped);

            const childDeltaSeconds = ev ? deltaSeconds * Math.abs(ev.speed) : deltaSeconds;

            if ((ev as any).free) (ev as any).free();

            childState.visible = visible;
            if (childState.slot.raw.transitioned()) {
                childState.player.runtimeManager.context.play();
            }

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

    private _destroyed = false;

    public destroy() {
        // Idempotent: a second destroy() would re-enter stop() after
        // runtimeManager.destroy() has nulled the context, throwing a TypeError.
        // Hosts/frameworks commonly call destroy() defensively more than once.
        if (this._destroyed) return;
        this._destroyed = true;

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
