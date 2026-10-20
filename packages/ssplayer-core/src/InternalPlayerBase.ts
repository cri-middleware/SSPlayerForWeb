import * as flatbuffers from 'flatbuffers';
import { SSRuntimeManager, SSABResource, WebCoordinateSystem, WebPlaybackDirection, WebPlaybackStyle, EffectDrawPlan, WebEffectEventInfo, getWasmMemory, hashString } from './SSRuntimeManager.js';
import type { FrameData } from './ss/runtime/frame-data.js';
import { PartState } from './ss/runtime/part-state.js';
import { SSBlendOp, SSOverridePriority } from './PartOverride.js';
import { SSTrackBlend, SSTrackSync } from './Tracks.js';
import { IResourceManager } from './IResourceManager.js';
import { IAudioManager } from './IAudioManager.js';
import { InstanceSlotHandle, EffectSlotHandle } from './SlotHandles.js';
import { InstancePackProvider, resolveInstancePacks } from './PackResolver.js';
import { GeometryBuilder } from './GeometryBuilder.js';
import { addSharedPack, retainSharedPack } from './SharedPacks.js';
import { canvasRectFrom, type SSPlacementBox } from './Placement.js';

export interface EffectChildState {
    slot: EffectSlotHandle;
    visible: boolean;
    /** The last step's event while its draw plan is not built, else null. */
    ev: WebEffectEventInfo | null;
    /** The parent frame of the last step. */
    frame: number;
    /** Whether the last frame handed out drew the part (buildEffectPlans). */
    drawn: boolean;
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
    public readonly runtimeManager: SSRuntimeManager;
    private _audioManager: IAudioManager | null = null;
    // The caller's own loop count, not a copy of the runtime's. The runtime
    // resets the count on every transition (it is per-animation there), so
    // without this a `setAnimation` would silently turn a configured
    // `loopCount = 3` back into looping forever.
    private _loopCount: number = -1;
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
    // The _bindGeneration a catch-up is running for, or -1. One running for an
    // earlier bind is the old pack's, and does not stop the new pack's.
    private _catchUpFor: number = -1;
    // Counts binds, and the destroy. A load awaits, and the pack can be rebound
    // or the player destroyed meanwhile; after each await the load checks
    // this, so the work of a pack no longer bound never marks the new one
    // ready or adds packs to its registry.
    private _bindGeneration: number = 0;
    protected _instanceChildren: Map<number, InstanceChildState<T>> = new Map();
    private _effectChildren: Map<number, EffectChildState> = new Map();
    private readonly _partState = new PartState();

    constructor(resourceManager?: IResourceManager) {
        this.runtimeManager = new SSRuntimeManager();
        this.runtimeManager.onFrameData = frameData => this.buildEffectPlans(frameData);

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
            // Name the URL that was asked for. Without it a 404 reads "Failed to
            // load SSAB: Not Found", which does not say *what* was not found —
            // and a wrong path is the common way to get here.
            throw new Error(
                `[SSPlayer] Failed to load ${ssabUrl}: ${response.status} ${response.statusText}`,
            );
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
     *   the structure ssconverter emits), and a player already holding the same
     *   bytes from the same URL shares its pack instead of a copy (SharedPacks).
     *   Omit for inline / ArrayBuffer loads whose textures are supplied by hash
     *   rather than fetched.
     */
    public bindResource(buffer: Uint8Array, ssabUrl?: string) {
        // Looked up before the bound pack is released, so rebinding the file this
        // player already holds keeps that pack rather than building it again.
        const shared = ssabUrl !== undefined ? retainSharedPack(ssabUrl, buffer) : null;
        // Made before anything is released, because making it is what refuses
        // bytes that are not a pack: a refused bind leaves the bound pack, and
        // the instances and effects set up on it, as they were.
        const resource = shared ? shared.resource : new SSABResource(buffer);
        // Recorded on this path too, not just in load(): a host that fetches
        // the bytes itself (ssplayer-rmmz does, for a better error message)
        // would otherwise leave `ssabUrl` empty for a pack that plainly has
        // one, and only the asset base would survive. Bytes bound without a URL
        // clear both, or their textures, instance packs and sounds would be
        // fetched from the previous pack's directory.
        this._ssabUrl = ssabUrl ?? '';
        this._assetBaseUrl = ssabUrl !== undefined ? ssabUrl.substring(0, ssabUrl.lastIndexOf('/')) : '';
        // The children play the old pack. Left in place, getInstanceChild()
        // would hand them out until the next setAnimation, and a play() before
        // it would reset them.
        this.destroyInstanceChildren();
        this.destroyEffectChildren();
        if (this._ssabResource) {
            this._ssabResource.destroy();
        }
        this._instancePackResources.forEach(res => res.destroy());
        // Emptied, so what a load still running for the old pack adds to it is
        // all it holds, and replaced, so that load cannot add to the new pack's.
        this._instancePackResources.clear();
        this._instancePackResources = new Map();
        this._ssabResource = resource;
        this.runtimeManager.bindResource(this._ssabResource);
        this._bindGeneration++;
        // Nothing is set up on the new pack, whatever was set up on the old one.
        // Without this, `setAnimation` would take a name that merely *matches*
        // the previous pack's selection for "already selected" and skip the
        // setup the new pack still needs — leaving it bound but unplayable.
        this._animationName = '';
        this._canvasRect = undefined;
        // A new pack means new assets: re-arm the one-shot load.
        this._resourceManager?.reset?.();
        this._prepared = null;
        this._resourcesReady = false;
        this._soundsPreloadedFor = null;
        this._soundsPromise = null;
        if (shared) {
            this._texturePaths = shared.texturePaths;
            this._animationNames = shared.animationNames;
            return;
        }
        this._texturePaths = SSRuntimeManager.extractTexturePaths(buffer);
        // Cached here rather than left to the caller, because the alternative is
        // holding on to the whole SSAB (megabytes) or re-fetching it just to read
        // a couple of dozen strings — both of which adapters were doing.
        this._animationNames = SSRuntimeManager.extractAnimationNames(buffer);
        if (ssabUrl !== undefined) {
            const ctx = this.runtimeManager.context;
            addSharedPack(ssabUrl, this._ssabResource, this._texturePaths, this._animationNames,
                { ptr: ctx.get_ssab_buf(), len: ctx.get_ssab_len() });
        }
    }

    /**
     * The bound SSAB's animation names, in table order; empty until a resource is
     * bound. Read-only: it is the cache, not a copy, so hosts handing it to
     * application code should copy it themselves.
     */
    public get animationNames(): readonly string[] {
        return this._animationNames;
    }

    // The set-up animation's authored canvas; undefined until asked for, and
    // dropped whenever the animation or the pack changes.
    private _canvasRect: SSPlacementBox | null | undefined;

    /**
     * The authored canvas of the animation that is set up, as a box in
     * player-local units (Y down) — what a fit measures against when it is given
     * no frame of its own. `null` until an animation is set up.
     *
     * It is the playing animation's own canvas, and one pack's animations may
     * differ. A host that wants one scale across a pack reads it once after its
     * first `setAnimation` and passes it as the fit's `frame`. Read-only: it is
     * the cache, not a copy.
     */
    public getCanvasRect(): SSPlacementBox | null {
        if (this._canvasRect === undefined) {
            const data = this.runtimeManager.getCurrentAnimationData();
            const size = data?.canvasSize();
            const pivot = data?.pivot();
            this._canvasRect = size && pivot ? canvasRectFrom(size.v1(), size.v2(), pivot.v1(), pivot.v2()) : null;
        }
        return this._canvasRect;
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

        const generation = this._bindGeneration;
        const packs = this._instancePackResources;
        const run = (async () => {
            await this.loadTextures();
            // Rebound while the textures loaded: the pack bound now has a load of
            // its own, and this one would resolve that pack's instance packs and
            // mark it ready before its textures are in.
            if (generation !== this._bindGeneration) return;
            await this.loadInstancePacks(packs);
            if (generation !== this._bindGeneration) {
                // The bind or the destroy released what the map held then; what
                // is in it now arrived after, for a pack nothing plays any more.
                packs.forEach(res => res.destroy());
                packs.clear();
                return;
            }
            this._resourcesReady = true;
            // Sounds are equally pack-scoped; preload them here too when a
            // manager is already attached, so `load()` covers audio as well.
            await this.preloadSounds();
        })();
        this._prepared = run;
        // Don't let one failed attempt poison every later setAnimation. This
        // handler is attached before the caller's, so the slot is already
        // cleared by the time an awaiting caller sees the rejection; `run`
        // itself still rejects for them (the derived promise is dropped).
        run.catch(() => {
            if (this._prepared === run) this._prepared = null;
        });
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
        const run = this.readSoundsInto(audio);
        this._soundsPromise = run;
        // Settled outside the body, and only once `_soundsPromise` holds it.
        // This used to be a `finally` inside a self-referencing async IIFE, and
        // a pack with no sounds returns from that body before its first
        // `await` — so the cleanup ran synchronously, read the `const` still
        // being initialised, and threw "Cannot access 'run' before
        // initialization" out of every `load()` that had an audio manager
        // attached. Soundless packs are the common case, not the exotic one.
        const forget = (): void => {
            if (this._soundsPromise === run) this._soundsPromise = null;
        };
        void run.then(forget, forget);
        return run;
    }

    private async readSoundsInto(audio: IAudioManager): Promise<void> {
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
        }
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
     *
     * **Selecting the animation already selected does nothing at all.** It is a
     * switch, so with nothing to switch to it costs nothing and disturbs
     * nothing: the playhead stays, the instance tree is not rebuilt, and the
     * override layer survives. This is what every Player in the family does, and
     * it is what lets a state machine call `setAnimation(state.clip)` every frame
     * without thinking about it. An animation a {@link crossfade} on track 0
     * brought in counts as selected from the moment it was called, so naming it
     * mid-fade leaves the fade running, and naming the one it faded out from
     * switches back to it. To *restart* the animation call {@link play},
     * which heads out; to drop the overrides call
     * {@link clearAllPartOverrides}.
     *
     * A playback section is not among the things that survive: a *real* switch
     * resets it, because frame numbers mean nothing against a different
     * animation. Call {@link setAnimationSection} again after each switch.
     * @param animationName The name of the animation to set.
     */
    public setAnimation(animationName: string): void {
        // Cleared by bindResource, so "the same name" can never mean a name that
        // belongs to a pack this player no longer has bound.
        if (animationName === this._animationName) return;
        try {
            this.runtimeManager.setupAnimation(animationName);
        } catch (cause) {
            // The wasm boundary throws the Brain's error enum as a bare string —
            // "AnimationNotFound", naming neither the pack nor what was asked of
            // it. Only this layer knows either, so only this layer can make the
            // failure legible. The
            // reason goes in verbatim because it separates a name the pack does
            // not have from a player that has no pack bound at all.
            throw new Error(
                `[SSPlayer] ${this._ssabUrl || 'the loaded pack'} could not select ` +
                    `animation "${animationName}" (${String(cause)}). ` +
                    `animationNames lists what it does have.`,
                { cause },
            );
        }
        this.trackZeroSwitched(animationName);

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
     * Record that track 0 now plays `animationName`, by whichever call handed it
     * over: {@link setAnimation}, or a {@link setTrackAnimation} or
     * {@link crossfade} on track 0, which hand it over from the call on rather
     * than when a fade completes. Recording it there and then is what keeps
     * `setAnimation` from taking the animation a crossfade left behind for the
     * one still selected — and skipping the switch back to it.
     *
     * A crossfade keeps playing, so this raises no start; `play()` is the only
     * thing that does.
     */
    private trackZeroSwitched(animationName: string): void {
        this._animationName = animationName;
        this._canvasRect = undefined;
        // Nothing the previous animation reported describes this one.
        this._prevFinished = false;
        this._justLooped = false;
        this._justFinished = false;
        // Per-animation in the runtime, so the caller's count has to go back on
        // after every switch. Speed, frame skip, the frame rate and the playback
        // direction belong to the track and survive on their own.
        this.runtimeManager.context.set_loop_count(this._loopCount);
    }

    /**
     * Load the pack's assets in the background, for a player switched before
     * `load()` / {@link prepareResources} finished (or was ever called).
     * Instance parts whose pack had not arrived were skipped by
     * `setupInstanceChildren`, so it is re-run once the packs are in.
     */
    private catchUpResources(): void {
        const generation = this._bindGeneration;
        if (this._catchUpFor === generation) return;
        this._catchUpFor = generation;
        const animationName = this._animationName;
        this.prepareResources()
            .then(() => {
                // Only the instances: the effects play the pack's own effect
                // data, which was there from the bind, and rebuilding them would
                // restart every effect already running.
                if (generation === this._bindGeneration && this._animationName) this.setupInstanceChildren();
            })
            .catch(e => {
                // Only for the pack still bound. A load the player has left
                // behind, for another pack or for its destroy, failed for
                // nothing it shows.
                if (generation === this._bindGeneration) {
                    console.error(`[SSPlayer] Failed to load the assets for "${animationName}"`, e);
                }
            })
            .finally(() => {
                if (this._catchUpFor === generation) this._catchUpFor = -1;
            });
    }

        private setupEffectChildren() {
        this.destroyEffectChildren();
        if (!this._ssabResource) return;

        const parts = this.runtimeManager.getEffectParts();
        for (const part of parts) {
            try {
                const slot = new EffectSlotHandle(this._ssabResource.raw, part.hash, part.seed);
                this._effectChildren.set(part.partIndex, { slot, visible: false, ev: null, frame: 0, drawn: true });
            } catch (e) {
                console.error(`Failed to create EffectSlot for part ${part.partIndex}`, e);
            }
        }
    }

    private destroyInstanceChildren() {
        this._instanceChildren.forEach(child => {
            try { child.player.destroy(); } catch { /* ignore */ }
            // child.slot is an InstanceSlotHandle (destroy() frees the WASM
            // handle and unregisters the finalizer). The previous `.free?.()`
            // was a no-op — the handle has no `free`, only `raw.free` — which
            // leaked the slot until GC on every re-`setAnimation`.
            try { child.slot.destroy(); } catch { /* ignore */ }
        });
        this._instanceChildren.clear();
    }

    // Leaves the effects alone. setAnimation rebuilds them itself, and a
    // catch-up re-runs this alone, once the instance packs are in.
    private setupInstanceChildren() {
        this.destroyInstanceChildren();

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
        // As in bindResource: nothing is set up on the pack just bound. The
        // caller (setupInstanceChildren) assigns the child's animation itself
        // right after, so this only matters for a child rebound to another pack.
        this._animationName = '';
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
     * parts, transitively, into `into`: the `_instancePackResources` registry of
     * the pack bound when the load began (delegated to the engine-agnostic
     * `resolveInstancePacks`). The runtime manager then creates the child
     * contexts on `setupAnimation`.
     */
    private async loadInstancePacks(into: Map<number, SSABResource>): Promise<void> {
        const buf = this.getSsabBuffer();
        if (!buf) return;

        await resolveInstancePacks({
            rootSsab: buf,
            assetBaseUrl: this._assetBaseUrl,
            provider: this._instancePackProvider,
            resourceManager: this._resourceManager,
            into,
        });
    }

    /**
     * The animation track 0 plays: the one {@link setAnimation} selected, or the
     * one a {@link crossfade} or {@link setTrackAnimation} on track 0 laid there
     * since — from the call on, not from the end of the fade. `''` before the
     * first selection.
     */
    public get currentAnimation(): string {
        return this._animationName;
    }

    /**
     * Starts the animation playback from the head of its section, re-arming the
     * loop count.
     *
     * **Not a resume**: `-1` heads out from the section start (its end when the
     * direction is backward) rather than carrying on from the playhead. Pass
     * `getFrameNo()` to play on from where it stands, and {@link resume} to lift
     * a hold.
     * @param startFrame The frame to start playing from. -1 means from the start of the section.
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
        // (setupInstanceChildren) would destroy every child player, invalidating
        // any player the host took from getInstanceChild().
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
     * Holds playback on the current frame.
     *
     * Idempotent, and ignored while nothing is playing. `isPlaying` stays true
     * while held — a pause is a hold, not a stop — so `isPausing` is what tells
     * the two apart.
     */
    public pause() {
        this.runtimeManager.context.pause();
    }

    /**
     * Lifts a {@link pause}, carrying on from the same frame.
     *
     * Idempotent, and a no-op on a stopped animation: starting one is
     * {@link play}'s job, and `play` heads out to the section start rather than
     * carrying on.
     */
    public resume() {
        this.runtimeManager.context.resume();
    }

    /**
     * Ends playback. The playhead **stays where it stands** — nothing rewinds, so
     * the renderer keeps drawing the frame it stopped on. `play()` is what returns
     * to the head; `setFrameNo()` seeks anywhere else.
     */
    public stop() {
        this.runtimeManager.context.stop();
        this._ran = false;
    }

    // Whether the last update() moved the runtime's clock. The runtime keeps its
    // track loop pulses until its next update, so a tick that did not run one
    // would otherwise report the last tick's loop again.
    private _ran: boolean = false;

    /**
     * Whether {@link update} has anything to move — what a renderer gates its
     * per-tick work on, rather than {@link isPlaying}.
     *
     * Wider than `isPlaying` in one case: track 0 running out does not stop the
     * character's clock. The tracks above it, the sources added to any track and
     * any fade carry on, and only track 0 reports the end, so a character whose
     * track 0 has finished still ticks while {@link isStackInMotion}.
     * {@link stop} stops all of it.
     */
    public get isTicking(): boolean {
        if (this.isPlaying) return true;
        // The clock, not track 0: a stop raises neither `isPlaying` nor
        // `isFinished`, and a stop after the end leaves `isFinished` latched.
        const ctx = this.runtimeManager.context;
        return ctx.is_clock_playing() && ctx.is_stack_in_motion();
    }

    /**
     * Whether the track stack moves the pose apart from track 0's frame: a fade
     * is running, or an audible track plays a source other than track 0's main
     * one at a speed and weight above 0. The runtime answers, since it releases
     * tracks and sources on its own as fades complete.
     *
     * It does not read the clock, so a pause or a stop leaves it true. Read it
     * **before** {@link update}: the tick a fade or a track ends on still moves
     * the pose, and reads false afterwards.
     */
    public get isStackInMotion(): boolean {
        return this.runtimeManager.context.is_stack_in_motion();
    }

    /**
     * Whether a {@link pause} holds the character's clock — what a renderer reads,
     * rather than {@link isPausing}, to tell whether a tick moves the timeline and
     * so has events to poll.
     *
     * Wider than `isPausing` in the same case as {@link isTicking}: `isPausing`
     * reports track 0, so once track 0 has finished it stays false through a
     * pause, while the pause still holds the tracks above it and any fade.
     */
    public get isHeld(): boolean {
        return this.runtimeManager.context.is_clock_pausing();
    }

    /**
     * Updates the animation frame by the given delta time.
     *
     * When paused, the main timeline is NOT advanced, but the effect / instance
     * slots are still stepped with the real delta so that `independent` parts keep
     * running on their own clock (SpriteStudio independent semantics; mirrors
     * SSPlayerForGodot). The runtime's `step()` ignores the delta for
     * non-independent slots — they stay synced to the (frozen) parent frame — so
     * passing the real delta unconditionally is safe. When nothing ticks
     * ({@link isTicking}), nothing advances.
     * @param deltaMs The elapsed time since the last frame in milliseconds.
     */
    public update(deltaMs: number) {
        this._ran = false;
        this._childrenMoved = false;
        if (!this.isTicking) return;
        const deltaSeconds = deltaMs / 1000.0;

        if (this.isHeld) {
            // Paused: keep independent slots advancing; do not touch the timeline.
            const effects = this.stepEffectSlots(deltaSeconds, false);
            const instances = this.stepInstanceSlots(deltaSeconds, false);
            this._childrenMoved = effects || instances;
            return;
        }

        // Delegate to the manager so animation playback advances
        const ctx = this.runtimeManager.context;
        const before = ctx.get_frame_no();
        this.runtimeManager.update(deltaMs);
        this._ran = true;
        const effects = this.stepEffectSlots(deltaSeconds, ctx.just_looped());
        const instances = this.stepInstanceSlots(deltaSeconds, ctx.just_looped());
        // A synced slot follows the playhead, which moves between the frames a
        // renderer draws whenever subFrameEnabled is off.
        this._childrenMoved = effects || instances
            || ((this._effectChildren.size > 0 || this._instanceChildren.size > 0) && ctx.get_frame_no() !== before);
    }

    private _childrenMoved = false;

    /**
     * Whether the last {@link update} moved an effect or instance child — one
     * playing on its own clock, or one synced to a playhead that moved — so a
     * renderer that skips a frame it has already drawn knows that frame changed.
     * Held players move only their independent children.
     */
    public get childrenMoved(): boolean {
        return this._childrenMoved;
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
        const looped = ctx.just_looped();
        const finished = ctx.is_finished();
        const rising = finished && !this._prevFinished;
        this._prevFinished = finished;
        this._justLooped = looped;
        this._justFinished = rising;
        return { looped, finished: rising };
    }

    private _justLooped = false;
    private _justFinished = false;

    /**
     * Whether the last {@link pollPlaybackEvents} saw a loop boundary crossed.
     *
     * A **pulse**, not a state: it describes the tick that just ran and is
     * replaced by the next one. Read from the copy the poll took rather than
     * from the live runtime, which clears its own flag at the top of every
     * update — reading that directly is how a caller loses the edge.
     */
    public get justLooped(): boolean {
        return this._justLooped;
    }

    /**
     * Whether the last {@link pollPlaybackEvents} saw playback complete — the
     * rising edge of the sticky finished state, so it is true for exactly one
     * tick. Distinct from `is_finished`, which stays true.
     */
    public get justFinished(): boolean {
        return this._justFinished;
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

    /**
     * Whether every configured loop has played.
     *
     * A **state**, not a pulse: it latches when playback completes and stays
     * true until the next {@link play} or switch of track 0's animation
     * ({@link setAnimation}, or a {@link crossfade} or {@link setTrackAnimation}
     * on track 0). It is track 0's: an overlay track finishing does not raise
     * it, and neither does the outgoing side of a crossfade. Never true under
     * an infinite loop count, and **not raised by {@link stop}** — a commanded
     * stop is not a completion, which is what makes this readable as "the run
     * ended on its own" where `!isPlaying` cannot tell the two apart.
     *
     * For a one-shot notification take the edge instead — {@link justFinished},
     * or the player's own animation-end listener.
     */
    public get isFinished(): boolean {
        return this.runtimeManager.context.is_finished();
    }

    /**
     * Whether the playhead is currently walking forwards.
     *
     * The *instantaneous heading*, not the configured direction: a ping-pong on
     * its return leg reads false while {@link getPlaybackDirection} still reads
     * Forward. It is what an audio backend gates on — SpriteStudio has no
     * reverse audio — mirroring the Godot
     * and Unity players' `is_playing_forward`.
     *
     * Note this says nothing about {@link getSpeed}: the runtime clamps a zero
     * or negative rate to a stop rather than to reverse playback, so the speed
     * can never flip the heading and does not belong in a gate built on this.
     */
    public get isPlayingForward(): boolean {
        return this.runtimeManager.context.is_playing_forward();
    }

    public setSpeedScale(speed: number) {
        this.runtimeManager.context.set_speed_scale(speed);
    }

    /**
     * The playback speed in effect, as a multiple of the frame rate.
     *
     * Read from the runtime rather than from a copy of what was last set: the
     * runtime clamps a zero or negative rate to a stop, so a cache would report
     * the `-1.0` that was asked for while playback is actually held at `0.0`.
     */
    public getSpeedScale(): number {
        return this.runtimeManager.context.get_speed_scale();
    }

    
    public getEffectDrawPlan(partIndex: number): EffectDrawPlan | null {
        const item = this._effectChildren.get(partIndex);
        if (!item) return null;
        // A frame handed out has built the plans of the parts it draws. One asked
        // for that the last step left unbuilt is built here.
        if (item.ev) this.buildEffectPlan(item);
        if (!item.visible) return null;

        const ptr = item.slot.raw.get_draw_plan_buf();
        const len = item.slot.raw.get_draw_plan_len();
        if (ptr === 0 || len === 0) return null;

        const buf = new Uint8Array(getWasmMemory().buffer, ptr, len);
        const bb = new flatbuffers.ByteBuffer(buf);
        return EffectDrawPlan.getRootAsEffectDrawPlan(bb);
    }

    /**
     * Moves the playhead to `frameNo`, which may be fractional.
     *
     * Stored as given even while {@link subFrameEnabled} is off. Flooring is a
     * property of the frame that gets *drawn* — {@link getDrawFrame} — not of
     * the playhead, so turning sub-frame back on recovers the fraction instead
     * of finding it already thrown away.
     */
    public setFrameNo(frameNo: number) {
        this.runtimeManager.context.set_frame_no(frameNo);
        this.stepEffectSlots(0, false);
        this.stepInstanceSlots(0, false);
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

    /**
     * Where the playhead is, fractional — the value the conventions call
     * `frameNo`.
     *
     * Reports the playhead itself, **not** the frame being drawn: with
     * {@link subFrameEnabled} off the renderer shows frame 12 while this still
     * reads 12.4, the same way ForGodot, ForUnity, ForFlutter, ForReactNative
     * and ForWgpu all report it. Use {@link getDrawFrame} to ask what is on
     * screen.
     */
    public getFrameNo(): number {
        return this.runtimeManager.context.get_frame_no();
    }

    /**
     * The frame actually drawn this tick: the playhead, floored while
     * {@link subFrameEnabled} is off.
     *
     * Every draw-side read goes through this — the renderers, the instance
     * children's frames, {@link isPartHidden} — so that what is asked of the
     * runtime is always the frame that ends up on screen. Turning sub-frame off
     * does nothing else; this is the whole of it.
     *
     * The siblings compute the same value at their own draw sites and call it
     * the same thing (ForGodot's `draw_frame`, ForReactNative's `drawFrame`).
     */
    public getDrawFrame(): number {
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
        return this.runtimeManager.context.get_frame_rate();
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

    /**
     * How many times to play: `n` cycles then stop, `-1` loops forever, and `0`
     * asks for the same as `-1` rather than "no cycles".
     *
     * Kept across a `setAnimation`, and across a {@link crossfade} or
     * {@link setTrackAnimation} on track 0, because it is the caller's
     * configuration rather than the animation's.
     */
    public setLoopCount(count: number) {
        this._loopCount = count;
        this.runtimeManager.context.set_loop_count(count);
    }

    /**
     * The count in force. Read from the runtime, so it is the *normalized*
     * value: ask for `0` and this reads back `-1`, the infinite sentinel.
     */
    public getLoopCount(): number {
        return this.runtimeManager.context.get_loop_count();
    }

    public setFrameSkipEnabled(skip: boolean) {
        this.runtimeManager.context.set_skip_frames(skip);
    }

    public isFrameSkipEnabled(): boolean {
        return this.runtimeManager.context.get_skip_frames();
    }

    // --- Motion blending: tracks and sources ---
    //
    // Pass-throughs to the runtime's track stack, on this player's own context.
    // Tracks fold onto the setup pose in ascending order; track 0 is what
    // setAnimation establishes, and it carries the structure (the discrete
    // attributes, the default events, the playback state). A track's alpha is
    // its strength; a source's weight only sets proportions among the
    // animations sharing one track. Instance children are not layered: they
    // run their own contexts, driven by their slots from this one's frame.
    //
    // A read of a track or source that does not exist answers `undefined`; a
    // command on one throws, naming the call. setAnimation folds the stack back
    // to track 0, dropping the tracks above with their settings and putting
    // every track's sync back to Free, so a host that layers on top lays its
    // tracks again after each switch. Track 0's own playback settings survive.
    //
    // A track's playback settings (speed, frame rate, frame skip, direction)
    // are the track's, not its animation's: they reach every animation on it
    // now, both sides of a crossfade included, and every one laid on it later.
    // Track 0's are the transport above (setSpeedScale and the rest). The loop
    // count is the exception: it belongs to the animation, and laying another
    // one starts it looping forever again — on track 0 this player puts the
    // host's count back, as setAnimation does.

    /** Number of tracks, empty ones included; 0 before an animation is set up. */
    public get trackCount(): number {
        return this.runtimeManager.context.get_track_count();
    }

    /**
     * Put `animationName` on `track`, replacing what it was playing, with no
     * fade. Tracks are made as needed. On track 0 it becomes the
     * {@link currentAnimation} from the call on; unlike {@link setAnimation} it
     * leaves the stack above and the instance children as they are.
     */
    public setTrackAnimation(track: number, animationName: string): void {
        this.trackCommand(`setTrackAnimation(${track}, "${animationName}")`,
            () => this.runtimeManager.setTrackAnimation(track, animationName), animationName);
        if (track === 0) this.trackZeroSwitched(animationName);
    }

    /** Silence a track. Track 0 cannot be emptied: fade it to alpha 0 with {@link fadeTrack} instead. */
    public clearTrack(track: number): void {
        this.trackCommand(`clearTrack(${track})`, ctx => ctx.clear_track(track));
    }

    /**
     * How much of `track` survives onto the pose below — the strength of a
     * layer. Not clamped: above 1 extrapolates, 0 or below contributes nothing.
     */
    public setTrackAlpha(track: number, alpha: number): void {
        this.trackCommand(`setTrackAlpha(${track}, ${alpha})`, ctx => ctx.set_track_alpha(track, alpha));
    }

    public getTrackAlpha(track: number): number | undefined {
        return this.runtimeManager.context.get_track_alpha(track);
    }

    /** {@link SSTrackBlend.Mix} lerps onto what is below; {@link SSTrackBlend.Additive} adds the offset from the setup pose. */
    public setTrackBlend(track: number, blend: SSTrackBlend): void {
        this.trackCommand(`setTrackBlend(${track}, ${blend})`, ctx => ctx.set_track_blend(track, blend));
    }

    public getTrackBlend(track: number): SSTrackBlend | undefined {
        return this.runtimeManager.context.get_track_blend(track);
    }

    /**
     * Where the animations laid on `track` from now on start:
     * {@link SSTrackSync.Free} from their head, {@link SSTrackSync.Start} at the
     * phase track 0 stands at. Set it **before** laying — it covers
     * {@link setTrackAnimation}, {@link crossfade} (track 0's too) and
     * {@link addTrackSource}.
     */
    public setTrackSync(track: number, sync: SSTrackSync): void {
        this.trackCommand(`setTrackSync(${track}, ${sync})`, ctx => ctx.set_track_sync(track, sync));
    }

    public getTrackSync(track: number): SSTrackSync | undefined {
        return this.runtimeManager.context.get_track_sync(track);
    }

    /** Seek `track`'s animation — how a continuous-control axis is driven, with its speed at 0. */
    public setTrackFrame(track: number, frame: number): void {
        this.trackCommand(`setTrackFrame(${track}, ${frame})`, ctx => ctx.set_track_frame(track, frame));
    }

    public getTrackFrame(track: number): number | undefined {
        return this.runtimeManager.context.get_track_frame(track);
    }

    /**
     * `track`'s playback speed, a multiple of its frame rate; 0 parks it where
     * {@link setTrackFrame} puts it. On track 0 this is {@link setSpeedScale}.
     */
    public setTrackSpeed(track: number, speed: number): void {
        this.trackCommand(`setTrackSpeed(${track}, ${speed})`, ctx => ctx.set_track_speed(track, speed));
    }

    /** What {@link setTrackSpeed} stored; a negative speed reads back as the 0 it became. */
    public getTrackSpeed(track: number): number | undefined {
        return this.runtimeManager.context.get_track_speed(track);
    }

    /** {@link setFrameRate} for one track. */
    public setTrackFrameRate(track: number, fps: number): void {
        this.trackCommand(`setTrackFrameRate(${track}, ${fps})`, ctx => ctx.set_track_frame_rate(track, fps));
    }

    /** The rate `track`'s animation plays at, the override or the authored rate; 0 for a track with neither. */
    public getTrackFrameRate(track: number): number | undefined {
        return this.runtimeManager.context.get_track_frame_rate(track);
    }

    /** {@link setFrameSkipEnabled} for one track. */
    public setTrackFrameSkipEnabled(track: number, skip: boolean): void {
        this.trackCommand(`setTrackFrameSkipEnabled(${track}, ${skip})`, ctx => ctx.set_track_skip_frames(track, skip));
    }

    public getTrackFrameSkipEnabled(track: number): boolean | undefined {
        return this.runtimeManager.context.get_track_skip_frames(track);
    }

    /** {@link setPlaybackDirection} for one track. */
    public setTrackPlaybackDirection(track: number, direction: WebPlaybackDirection, style: WebPlaybackStyle): void {
        this.trackCommand(`setTrackPlaybackDirection(${track}, ${direction}, ${style})`,
            ctx => ctx.set_track_playback_direction(track, direction, style));
    }

    public getTrackPlaybackDirection(track: number): WebPlaybackDirection | undefined {
        return this.runtimeManager.context.get_track_playback_direction(track);
    }

    public getTrackPlaybackStyle(track: number): WebPlaybackStyle | undefined {
        return this.runtimeManager.context.get_track_playback_style(track);
    }

    /**
     * How many times `track`'s animation plays before it holds its last frame;
     * `-1` (or `0`) loops forever. Throws on a track with no animation, and an
     * animation is laid looping forever, so set it after laying. A finished
     * track keeps mixing its last frame in until the host fades or clears it.
     *
     * On track 0 this is {@link setLoopCount}: the player keeps the count and
     * puts it back on every animation laid there.
     */
    public setTrackLoopCount(track: number, count: number): void {
        this.trackCommand(`setTrackLoopCount(${track}, ${count})`, ctx => ctx.set_track_loop_count(track, count));
        // Written past the kept count, the next switch of track 0 would put the
        // old one back.
        if (track === 0) this._loopCount = count;
    }

    /** `-1` for a track that loops forever; `undefined` for one with no animation. */
    public getTrackLoopCount(track: number): number | undefined {
        return this.runtimeManager.context.get_track_loop_count(track);
    }

    /**
     * Whether `track`'s animation has played its loop count out and holds its
     * last frame. A **state**, as {@link isFinished} is for track 0; there is no
     * listener for it. Only track 0 finishing ends the character's playback.
     */
    public isTrackFinished(track: number): boolean {
        return this.runtimeManager.context.is_track_finished(track);
    }

    /**
     * Whether the last {@link update} wrapped `track`'s animation back to its
     * start — a **pulse**, as `justLooped` is for track 0. False after an update
     * that moved nothing (paused, stopped), since the runtime keeps its pulse
     * until it next runs.
     */
    public trackJustLooped(track: number): boolean {
        return this._ran && this.runtimeManager.context.track_just_looped(track);
    }

    /**
     * How far into a crossfade on `track` the outgoing animation keeps firing
     * events: while its share of the track, `1 - progress`, is at least
     * `threshold`. The default, `Infinity`, silences it the moment the fade
     * begins — on track 0, just as the incoming one starts firing; `0.5` keeps
     * it firing for the first half. Kept by the track, so it holds for every
     * crossfade on it, and track 0's survives {@link setAnimation}.
     */
    public setTrackOutgoingEventThreshold(track: number, threshold: number): void {
        this.trackCommand(`setTrackOutgoingEventThreshold(${track}, ${threshold})`,
            ctx => ctx.set_track_outgoing_event_threshold(track, threshold));
    }

    public getTrackOutgoingEventThreshold(track: number): number | undefined {
        return this.runtimeManager.context.get_track_outgoing_event_threshold(track);
    }

    /**
     * Fade `track` to `animationName` over `durationMs`, from whatever it is
     * playing; every source on it fades out together. Advanced by
     * {@link update}, and an empty track starts playing at once.
     *
     * On track 0, `animationName` takes over **from the call on**, not when the
     * fade completes: it is the {@link currentAnimation}, its state is what
     * {@link isFinished} and the frame read-outs report, its events fire, and it
     * plays with the speed, direction and loop count the host set. The outgoing
     * one running out mid-fade does not finish the character. The instance
     * children are not rebuilt the way {@link setAnimation} rebuilds them: the
     * instance and effect parts belong to the pack, so they carry on.
     *
     * Crossfading again mid-fade takes the fade over where it stands, so the
     * pose does not jump.
     */
    public crossfade(track: number, animationName: string, durationMs: number): void {
        this.trackCommand(`crossfade(${track}, "${animationName}", ${durationMs})`,
            () => this.runtimeManager.crossfade(track, animationName, durationMs), animationName);
        if (track === 0) this.trackZeroSwitched(animationName);
    }

    /**
     * Drive `track`'s alpha to `targetAlpha` over `durationMs` — how strongly
     * it applies, not what it plays (that is {@link crossfade}). Fading track 0
     * to 0 settles the character onto the setup pose.
     */
    public fadeTrack(track: number, targetAlpha: number, durationMs: number): void {
        this.trackCommand(`fadeTrack(${track}, ${targetAlpha}, ${durationMs})`,
            ctx => ctx.fade_track(track, targetAlpha, durationMs));
    }

    /** How far the fade on `track` has got, 0 to 1; `undefined` when it is not fading. */
    public getTrackFadeProgress(track: number): number | undefined {
        return this.runtimeManager.context.get_track_fade_progress(track);
    }

    /** Stop the fade on `track`, leaving alpha and weights where they stand. */
    public cancelTrackFade(track: number): void {
        this.trackCommand(`cancelTrackFade(${track})`, ctx => ctx.cancel_track_fade(track));
    }

    /**
     * The source carrying `track`'s animation — the one {@link setAnimation},
     * {@link setTrackAnimation} or {@link crossfade} laid there (mid-crossfade,
     * the incoming one); `undefined` when it has none.
     */
    public getTrackMainSource(track: number): number | undefined {
        return this.runtimeManager.context.get_track_main_source(track);
    }

    /**
     * Lay `animationName` on `track` beside what it already carries, at
     * `weight`, and return its handle. On an empty track it becomes the main
     * source. A handle stays valid until its source is released — by a
     * crossfade completing, {@link clearTrack} or {@link setAnimation} — and is
     * then reused, so drop it then.
     */
    public addTrackSource(track: number, animationName: string, weight: number): number {
        return this.trackCommand(`addTrackSource(${track}, "${animationName}", ${weight})`,
            ctx => ctx.add_track_source(track, animationName, weight), animationName);
    }

    /** A source's share **within its track**; weights are ratios, so (0.7, 0.3) and (7, 3) mix alike. */
    public setSourceWeight(source: number, weight: number): void {
        this.trackCommand(`setSourceWeight(${source}, ${weight})`, ctx => ctx.set_source_weight(source, weight));
    }

    public getSourceWeight(source: number): number | undefined {
        return this.runtimeManager.context.get_source_weight(source);
    }

    /** Seek one source — how a host keeps sources of different lengths in step. */
    public setSourceFrame(source: number, frame: number): void {
        this.trackCommand(`setSourceFrame(${source}, ${frame})`, ctx => ctx.set_source_frame(source, frame));
    }

    public getSourceFrame(source: number): number | undefined {
        return this.runtimeManager.context.get_source_frame(source);
    }

    /**
     * The weight at or above which `source` fires its events. Only track 0's
     * main source fires by default — the default threshold is `Infinity` — so
     * lower this to the source's weight or below to have another one fire too.
     */
    public setSourceEventThreshold(source: number, threshold: number): void {
        this.trackCommand(`setSourceEventThreshold(${source}, ${threshold})`,
            ctx => ctx.set_source_event_threshold(source, threshold));
    }

    public getSourceEventThreshold(source: number): number | undefined {
        return this.runtimeManager.context.get_source_event_threshold(source);
    }

    /**
     * Run one track or source command against the runtime. The wasm boundary
     * throws the runtime's error enum as a bare string ("TrackNotFound"), naming
     * neither the call nor the pack; this layer knows both. A call that names
     * an animation also names the pack it looked in, as setAnimation's does.
     */
    private trackCommand<R>(call: string, action: (ctx: SSRuntimeManager['context']) => R, animationName?: string): R {
        try {
            return action(this.runtimeManager.context);
        } catch (cause) {
            const where = animationName !== undefined ? ` on ${this._ssabUrl || 'the loaded pack'}` : '';
            throw new Error(`[SSPlayer] ${call} failed${where} (${String(cause)}).`, { cause });
        }
    }

    // --- Part overrides ---
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
     *
     * The colour comes first and `blendOp` trails with a default, which is the
     * family's order. The C ABI puts the
     * blend first; this face deliberately does not.
     */
    public setPartColorOverride(
        part: number | string,
        rgba: number,
        blendOp: SSBlendOp = SSBlendOp.Mix,
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
        corners: readonly [number, number, number, number],
        blendOp: SSBlendOp = SSBlendOp.Mix,
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
     * empty names revert the part to the animation. See getCellmapNames /
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
    /**
     * Part names in part-index order, empty before an animation is set up.
     *
     * A part authored without a name reads as the empty string, so the list
     * stays aligned with the `partIndex` every event carries — which is what
     * turns one back into something a human reads. `length` is the part count.
     */
    public getPartNames(): string[] {
        return this.runtimeManager.getPartNames();
    }

    public getCellmapNames(): string[] {
        return this.runtimeManager.getCellmapNames();
    }

    /** Cell names inside `cellmapName`, empty if that map isn't in this SSAB. */
    public getCellNames(cellmapName: string): string[] {
        return this.runtimeManager.getCellNames(cellmapName);
    }

    // --- Runtime texture replacement -------------------------------------
    //
    // Swap the texture an animation samples, from your program (costume changes,
    // dynamic expressions) rather than from the authoring data. This is a
    // Player-side override and is NOT the Override Layer (per-part cell/colour/
    // visibility) above: it keys by CELL-MAP NAME, replacing the texture object
    // the ResourceManager hands the renderer for that name's hash. The renderer
    // resolves `DrawBatch.texture_hash` against that map every frame, so a swap
    // takes effect on the next draw with no batch re-planning.
    //
    // Two things to know: the replacement must be
    // the SAME size and layout as the original atlas (UVs stay in the original
    // cell-map's pixel space, normalized by the BOUND texture's size); and a
    // frame under an authored TextureChange (`TCHG`) binds through the texture
    // FILE-name hash instead, so to affect those frames replace that name (the
    // `xxx.png` entries {@link getReplaceableTextureNames} lists) rather than the
    // cell-map name.
    //
    // Instance children share this player's ResourceManager, so replacing a name
    // used by a child's sub-animation affects the child too — unlike engines
    // whose children keep independent texture maps.

    /**
     * Replace (or restore) the texture bound to a cell-map / external-texture
     * name at runtime.
     *
     * @param cellmapName A name from {@link getReplaceableTextureNames} — a
     *   cell-map name (`common`) or a TextureChange target file name
     *   (`common.png`). An unknown name hashes to a key nothing draws, so the
     *   call is a harmless no-op rather than an error.
     * @param texture The engine-specific texture object to bind, or `null` to
     *   clear the override and restore the originally loaded texture.
     *
     * The `texture` object is caller-owned; the player never frees it. Requires a
     * ResourceManager that implements {@link IResourceManager.setOverrideTexture};
     * throws otherwise.
     */
    public setCellmapTexture(cellmapName: string, texture: unknown | null): void {
        const rm = this._resourceManager;
        if (!rm || !rm.setOverrideTexture || !rm.clearOverrideTexture) {
            throw new Error(
                "This player's ResourceManager does not support runtime texture replacement (setOverrideTexture/clearOverrideTexture).",
            );
        }
        const hash = hashString(cellmapName);
        if (texture == null) {
            rm.clearOverrideTexture(hash);
        } else {
            rm.setOverrideTexture(hash, texture);
        }
    }

    /**
     * The current runtime override for `cellmapName` (the object last passed to
     * {@link setCellmapTexture}), or `undefined` when nothing is overridden. This
     * returns only the override — never the originally loaded texture.
     */
    public getCellmapTexture(cellmapName: string): unknown {
        return this._resourceManager?.getOverrideTexture?.(hashString(cellmapName));
    }

    /**
     * Names {@link setCellmapTexture} can replace: cell-map names plus
     * TextureChange target file names. See
     * {@link SSRuntimeManager.getReplaceableTextureNames}.
     */
    public getReplaceableTextureNames(): string[] {
        return this.runtimeManager.getReplaceableTextureNames();
    }

    // --- Root transform (flip / offset) ----------------------------------
    //
    // Mirror or shift what this player DRAWS, without touching the host object's
    // own transform — so anything parented to it (part-following targets, a DOM
    // overlay, the host's own children) stays where it is. Negating a container's
    // scale.x mirrors the artwork too, but drags all of that along with it; these
    // do not, which is the whole reason they live here rather than being left to
    // the host's transform.
    //
    // All three resolve into ONE affine, {@link getRootAffine}, and that single
    // affine is the only thing downstream reads. It has two consumers that MUST
    // agree: the renderer folds it into the geometry (as the root context's
    // parent matrix, or into the draw transform), and {@link getPartTransform}
    // composes it into what it reports. If the geometry moved and the part
    // transform did not, every attached object would detach the moment the
    // player was flipped.
    //
    // Top level only: an instance-part child inherits this through the composed
    // parent matrix its caller hands down, so the child's own root affine is
    // never read and setting it on a child player does nothing.

    private _flipX: boolean = false;
    private _flipY: boolean = false;
    private _offsetX: number = 0;
    private _offsetY: number = 0;
    // [m00, m01, m10, m11, tx, ty] = scale(±1, ±1) followed by translate(offset),
    // i.e. p' = S*p + O — the same order Godot's Transform2D root and Unity's
    // RootScale/RootOffset use. Rebuilt on write; writes are rare, reads are
    // per-frame. Allocated on first write, so a player that never flips or
    // offsets carries no buffer at all. m01/m10 are never written: a flip is a
    // mirror, never a rotation or a skew, so they stay at the zeros they start
    // as.
    private _rootAffine: Float32Array | null = null;
    // False while the affine is the identity, so an untouched player hands the
    // renderer a null parent matrix and the hot path costs exactly what it did
    // before this existed.
    private _rootAffineActive: boolean = false;

    private updateRootAffine(): void {
        const a = (this._rootAffine ??= new Float32Array(6));
        a[0] = this._flipX ? -1 : 1;
        a[3] = this._flipY ? -1 : 1;
        a[4] = this._offsetX;
        a[5] = this._offsetY;
        this._rootAffineActive =
            this._flipX || this._flipY || this._offsetX !== 0 || this._offsetY !== 0;
    }

    /**
     * Mirror the drawn animation horizontally. Only this player's own drawing is
     * mirrored — the host object's transform, and anything parented to it, are
     * left alone. Part-following targets follow the mirrored pose.
     */
    public get flipX(): boolean { return this._flipX; }
    public set flipX(v: boolean) { this._flipX = v; this.updateRootAffine(); }

    /** Mirror the drawn animation vertically. See {@link flipX}. */
    public get flipY(): boolean { return this._flipY; }
    public set flipY(v: boolean) { this._flipY = v; this.updateRootAffine(); }

    /**
     * Shift the drawn animation horizontally, in animation-local pixels, without
     * moving the host object — useful for nudging artwork off its authored origin
     * while the host keeps marking the logical position. Applied after
     * {@link flipX}, so it is not itself mirrored.
     */
    public get offsetX(): number { return this._offsetX; }
    public set offsetX(v: number) { this._offsetX = v; this.updateRootAffine(); }

    /** Shift the drawn animation vertically (Y-down). See {@link offsetX}. */
    public get offsetY(): number { return this._offsetY; }
    public set offsetY(v: number) { this._offsetY = v; this.updateRootAffine(); }

    /**
     * {@link flipX} / {@link flipY} / {@link offsetX} / {@link offsetY} resolved
     * into one 2D affine `[m00, m01, m10, m11, tx, ty]`, or **null** when they
     * are all at their defaults.
     *
     * The returned array is this player's live buffer — read it, do not retain
     * or mutate it. Renderers compose it as the root context's parent matrix (or
     * into the draw transform); nothing else should apply it, or it lands twice.
     */
    public getRootAffine(): Float32Array | null {
        return this._rootAffineActive ? this._rootAffine : null;
    }

    // --- Part following (transform read-out) -----------------------------
    //
    // Read a part's current-frame transform so an external object can follow it
    // (a weapon, effect or hitbox tracking a null part). Unlike the overrides
    // above these are pure reads: they report the frame last evaluated, and
    // update() / setFrameNo() evaluate nothing — they only move the playhead. A
    // frame is evaluated when the renderer draws it, or by evaluateDrawFrame(),
    // so a facade whose per-frame seam runs before its draw evaluates first.
    // Part indices are stable within one SSAB, so resolve a name once and pass
    // the index if you follow a part every frame.

    /**
     * Evaluates the frame the renderer is about to draw ({@link getDrawFrame}),
     * so the part read-outs report it. Called by a facade that drives its
     * followers or `onFrame` listeners before its own draw: without it they read
     * the frame drawn last time, one behind. The draw evaluates the frame again,
     * so call it only when something is going to read. Allocates nothing.
     */
    public evaluateDrawFrame(): void {
        this.runtimeManager.prepareFrame(this.getDrawFrame());
    }

    /**
     * The part's current-frame transform as a 2D affine `[m00, m01, m10, m11,
     * tx, ty]` in animation-local (Y-down) space, copied out of WASM (safe to
     * retain). Returns null when the part name/index is unknown in the current
     * animation. Pass `out` (a `Float32Array(6)`) to avoid allocation. Valid for
     * the frame last evaluated — the last one drawn, or the one
     * {@link evaluateDrawFrame} evaluated; the matrix is computed for every part
     * regardless of `hide`, so a hidden part still reports where it would be.
     *
     * {@link flipX} / {@link flipY} / {@link offsetX} / {@link offsetY} are
     * included: this reports where the part is actually drawn, so a follower
     * stays pinned to it across a flip.
     */
    public getPartTransform(part: number | string, out?: Float32Array): Float32Array | null {
        const index = this.resolveKnownPartIndex(part);
        if (index < 0) return null;
        const m = this.runtimeManager.getWorldMatrix2D(index, out);
        // The same root affine the renderer folds into the geometry — the two
        // must not drift apart (see the root-transform section above).
        // composeAffine reads both operands into locals before it writes, so
        // composing in place over `m` is safe.
        const root = this.getRootAffine();
        return root ? GeometryBuilder.composeAffine(root, m, m) : m;
    }

    /**
     * Whether the part is hidden on the frame last evaluated — the last one
     * drawn, or the one {@link evaluateDrawFrame} evaluated, the same frame
     * {@link getPartTransform} reads. That is the visibility the renderer
     * honours: the animation's `hide` keyframe with a
     * {@link setPartVisibilityOverride} force-hide and its cascade applied.
     *
     * It evaluates nothing, so an override reads back from the next frame
     * evaluated, as it is drawn. Evaluating here would also change what the next
     * update builds: an `OverwriteOnNextKeyframe` override set right after
     * {@link play} or a seek goes back to the animation if any frame is built
     * before that update. Returns false for a known part before any frame has
     * been evaluated, and null when the part is unknown.
     */
    public isPartHidden(part: number | string): boolean | null {
        const index = this.resolveKnownPartIndex(part);
        if (index < 0) return null;
        const frameData = this.runtimeManager.getLastFrameData();
        // The frame's parts vector is num_parts long, ordered by part index
        // (same indexing as the renderer's per-part reads), so `index` addresses
        // this part directly. The frame can be one built before another pack was
        // bound, hence the bound. A part absent from the frame reads as visible.
        if (!frameData || index >= frameData.partsLength()) return false;
        const state = frameData.parts(index, this._partState);
        return state ? state.hide() : false;
    }

    /**
     * Whether the part is a **skinned mesh** — a mesh part bound to bones, whose
     * vertices are drawn by bone skinning while the part's own transform stays at
     * its setup node position (usually near the character root). Returns null when
     * the part name/index is unknown.
     *
     * This is a static property of the asset, not of a frame, and it exists for
     * part following: {@link getPartTransform} reports a part's *node* transform,
     * which for a skinned mesh is not where its art ends up, so following one
     * snaps the target near the root rather than onto the visible mesh. Target a
     * NULL / bone / joint part placed at that spot instead. A rigid (deform-only,
     * unbound) mesh returns false — its node transform does move with the art, so
     * it follows correctly. Nothing here blocks following either way; this only
     * lets a host mark a poor target (e.g. dim it in a follow-target picker).
     */
    public isPartSkinnedMesh(part: number | string): boolean | null {
        const index = this.resolveKnownPartIndex(part);
        if (index < 0) return null;
        return this.runtimeManager.getPartSkinnedFlag(index);
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

    /** Returns whether a slot playing on its own clock was stepped by a nonzero delta. */
    private stepEffectSlots(deltaSeconds: number, parentLooped: boolean): boolean {
        if (this._effectChildren.size === 0) return false;

        let independentMoved = false;
        const frame = this.runtimeManager.context.get_frame_no();
        for (const [partIndex, item] of this._effectChildren.entries()) {
            // Every slot steps every tick, drawn or not, or an effect playing on its
            // own clock would freeze while its part is hidden. Whether this tick
            // draws the part is known only once the frame is evaluated, after this,
            // so the step takes the last frame's word for it. A part hidden there
            // moves just its clock and transitions, and keeps the step in case the
            // frame draws it after all (buildEffectPlans).
            const ev = this.runtimeManager.context.get_active_effect_event(partIndex);
            // y_flip = true for PixiJS (y-down), vert_stride = 2 (x,y)
            item.visible = item.slot.raw.step(ev, frame, deltaSeconds, this.getFrameRate(), parentLooped, true, 2, item.drawn);
            if (deltaSeconds !== 0 && item.slot.raw.is_independent()) independentMoved = true;
            item.ev?.free();
            if (item.drawn) {
                ev.free();
                item.ev = null;
            } else {
                item.ev = ev;
                item.frame = frame;
            }
        }
        return independentMoved;
    }

    /**
     * Note which effect parts `frameData` draws, for the next step to go by, and
     * build the plan of any it draws whose last step guessed it hidden. The
     * runtime manager calls this with every frame it hands out, so a renderer
     * reaching an effect batch finds the plan built. Returns whether it built one.
     */
    private buildEffectPlans(frameData: FrameData): boolean {
        if (this._effectChildren.size === 0) return false;

        // The runtime leaves a hidden part out of the draw order. Every flag is
        // read before the first build, which can grow WASM memory and detach
        // `frameData`.
        const parts = frameData.partsLength();
        let unbuilt = false;
        for (const [partIndex, item] of this._effectChildren.entries()) {
            item.drawn = partIndex < parts && !frameData.parts(partIndex, this._partState)!.hide();
            if (item.drawn && item.ev) unbuilt = true;
        }
        if (!unbuilt) return false;
        for (const item of this._effectChildren.values()) {
            if (item.drawn && item.ev) this.buildEffectPlan(item);
        }
        return true;
    }

    /**
     * Step the slot again on its last step's event and frame, with no time passing
     * and draw = true. That moves nothing, and builds the plan the last step would
     * have built had it drawn: the particles are a function of the effect's time.
     */
    private buildEffectPlan(item: EffectChildState) {
        item.visible = item.slot.raw.step(item.ev!, item.frame, 0, this.getFrameRate(), false, true, 2, true);
        item.ev!.free();
        item.ev = null;
    }

    private destroyEffectChildren() {
        this._effectChildren.forEach(child => {
            child.ev?.free();
            child.slot.destroy();
        });
        this._effectChildren.clear();
    }

    /** Returns whether a slot playing on its own clock, at any depth, was stepped by a nonzero delta. */
    private stepInstanceSlots(deltaSeconds: number, parentLooped: boolean): boolean {
        if (this._instanceChildren.size === 0) return false;

        let independentMoved = false;
        const parentFrame = this.runtimeManager.context.get_frame_no();
        for (const [partIndex, childState] of this._instanceChildren.entries()) {
            const ev = this.runtimeManager.context.get_active_event_instance(partIndex);
            // The step writes the child's context from inside the runtime, which
            // the child's manager does not see. It moves only the child's frame,
            // and a frame not evaluated yet is evaluated anyway; a transition
            // goes on below through calls the manager does see.
            const visible = childState.slot.raw.step(ev, childState.player.runtimeManager.context, parentFrame, deltaSeconds, parentLooped);

            // The child's own effects and instances run at the speed the slot just
            // stepped the child at, read after the step. The event's speed is not
            // that: before the first real key the event is the implicit one at
            // speed 1, while a slot that last started an independent key ignores
            // it and keeps that key's speed, leaving the sub-tree behind the child.
            const childDeltaSeconds = deltaSeconds * Math.abs(childState.slot.raw.get_speed());

            if ((ev as any).free) (ev as any).free();

            childState.visible = visible;
            if (childState.slot.raw.transitioned()) {
                const childContext = childState.player.runtimeManager.context;
                childContext.play();
                // The slot has already put the child on the frame to draw this tick:
                // its section's first frame when it plays on its own — where play()
                // leaves it — and the parent-relative frame when it is synced.
                // play() puts a synced child back on the section's first frame, and
                // the renderers read the child's playhead, so put it back.
                if (!childState.slot.raw.independent()) {
                    childContext.set_frame_no(childState.slot.raw.child_frame_no());
                }
            }

            if (deltaSeconds !== 0 && childState.slot.raw.independent()) independentMoved = true;

            // Advance the child's own effects
            if (childState.player.stepEffectSlots(childDeltaSeconds, childState.slot.raw.child_looped())) independentMoved = true;
            // Advance the child's own instance children recursively
            if (childState.player.stepInstanceSlots(childDeltaSeconds, childState.slot.raw.child_looped())) independentMoved = true;
        }
        return independentMoved;
    }

    public getInstanceChild(partIndex: number): InstanceChildState<T> | undefined {
        return this._instanceChildren.get(partIndex);
    }

    /**
     * Whether this player's pack, or an instance child's at any depth, has a
     * part that can write a mask. When it is false, a mask plan of this tree
     * finds no writer.
     */
    public hasMaskWriterParts(): boolean {
        if (this.runtimeManager.hasMaskWriterParts()) return true;
        if (this._instanceChildren.size === 0) return false;
        for (const child of this._instanceChildren.values()) {
            if (child.player.hasMaskWriterParts()) return true;
        }
        return false;
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
        // A load still running stops at its next check, as it does for a bind.
        // It would otherwise set instances up on the runtime freed below, and
        // keep the instance packs it resolves after the map below is emptied.
        this._bindGeneration++;

        this.stop();

        // Teardown is the one thing that does stop sound: there is no player left
        // to own the voices. A child player shares the manager with its parent, so
        // only the owner may sweep it.
        if (!this._isChildPlayer) this._audioManager?.stopAll?.();

        this.destroyInstanceChildren();
        this.destroyEffectChildren();

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
