import { Container, Mesh, Geometry, Texture, Ticker, Text, Shader, Buffer, BufferUsage, RenderTexture, UniformGroup, Matrix, type Renderer } from 'pixi.js';
import { DirectInternalPlayer, BlendType, DrawBatchKind, GeometryBuilder, SSRuntimeManager, FrameData, PartState, MaskPlanner, FrameDataMaskSource, MAX_MASK_WRITERS, initializeWasm, getWasmMemory, WebPlaybackDirection, WebPlaybackStyle, ssFormat, EffectDrawPlan, IAudioManager } from '@spritestudio/ssplayer-core';
import { SSWebAudioManager } from './SSWebAudioManager.js';
import { PartsColorShader, PartsColorShaderWGSL } from './PartsColorShader.js';
import { EffectShader, EffectShaderWGSL } from './EffectShader.js';
import { MaskWriteShader, MaskWriteShaderWGSL } from './MaskWriteShader.js';
import { MaskedPartsColorShader, MaskedPartsColorShaderWGSL } from './MaskedPartsColorShader.js';
import { PixiResourceManager } from './PixiResourceManager.js';
import { SS_SHADER_SOURCES } from './SSShaderLib.js';
// SpriteStudio framebuffer blend modes (Invert / Exclusion / Sub) registered as
// fixed-function GPU blend states — the same mechanism SpriteStudio uses — rather
// than PixiJS "advanced" filter blends (which don't reliably engage / read the
// live framebuffer here). Importing registers the WebGPU entries; the WebGL map is
// patched via registerSSBlendModesGL once the renderer is known. See SSBlendModes.
import { SS_INVERT_BLEND, SS_EXCLUSION_BLEND, registerSSBlendModesGL } from './SSBlendModes.js';

// MAX_MASK_WRITERS is defined alongside the planner in ssplayer-core.

// --- Animation event payloads (06_playback_control.ja.md) ---
// Event extraction lives here in the renderer package (not core): it reads the
// SSAB events table for the current animation via the runtime manager's
// introspection accessors, parses the FlatBuffer payloads, and dispatches typed
// callbacks. Driven once per frame from the ticker (see pollEvents / update).

/**
 * A user-data event fired by a part on the frame it was authored. Optional
 * fields mirror the SSAB payload: each is present only if that value type was
 * authored (an authored integer of `0` is still present, distinct from absent).
 */
export interface SSUserDataEvent {
    partIndex: number;
    partName: string | null;
    integer?: number;
    str?: string;
    /** User-data rectangle as authored (left/top/right/bottom). */
    rect?: { x1: number; y1: number; x2: number; y2: number };
    /** User-data point as authored. */
    point?: { x: number; y: number };
}

/**
 * A signal event fired by a part. `params` maps each command parameter id to
 * its authored value (bool / int / float / string). Only **active** signals are
 * dispatched (mirroring the Godot / Unity players and the porting guide).
 */
export interface SSSignalEvent {
    partIndex: number;
    partName: string | null;
    active: boolean;
    commandId: string | null;
    params: Record<string, boolean | number | string>;
}

/**
 * An audio event fired by a part: the SSAB sound reference (hashes + alias
 * name) plus loop count. The runtime plays no audio — the host resolves the
 * sound and plays it on its own audio engine (11_optional_features.ja.md).
 */
export interface SSAudioEvent {
    partIndex: number;
    partName: string | null;
    soundListNameHash: number;
    soundNameHash: number;
    soundName: string | null;
    loopNum: number;
}

/** Unsubscribe handle returned by the `onX` event-registration methods. */
export type Unsubscribe = () => void;

// Per-context mask coverage produced by the pre-pass: the offscreen texture,
// the affine that maps a part's player-local position into the coverage's
// [0,1] UV space, and the writer metadata replayed by the masked shader.
interface MaskCoverage {
    rt: RenderTexture;
    minX: number;
    minY: number;
    invW: number;
    invH: number;
    meta: Float32Array; // MAX_MASK_WRITERS * vec4 (drawRank, bit, opInvert, isClipping)
    count: number;
}

// Mask inherited by an instance-part child from its parent (09_mask.ja.md §3-2-2).
// A masked instance part clips its WHOLE referenced sub-animation against the
// parent's coverage, judged once by the instance part's own draw rank and
// visible_inside_mask polarity (single level — the sub-anime is one target).
interface InheritedMask {
    cov: MaskCoverage; // the parent context's coverage (same player-local space as the child's composited positions)
    rank: number;      // the instance part's rank in the parent draw order
    mode: number;      // the instance part's visible_inside_mask polarity (1 = inside, 0 = outside)
}

export class SSPlayer extends Container {
    public static async initialize(wasmUrl?: string | URL) {
        await initializeWasm(wasmUrl);
    }

    public internalPlayer: DirectInternalPlayer;

    private meshPool: Mesh<any>[] = [];
    private activeMeshes: number = 0;

    // Reused per-frame scratch so the render hot path allocates nothing: a
    // shared PartState wrapper (re-positioned per part) and a transient 2D
    // affine for an instance part's own world matrix before composition.
    private readonly scratchPartState = new PartState();
    private readonly scratchInstMat = new Float32Array(6);

    // Reused per-frame scratch for effect draw-call batching: a pooled list of the
    // current Effect batch's particle draw commands (descriptors), greedily merged
    // by (cellmap, blend) at draw time. Pooled so steady-state rendering allocates
    // nothing; only entries [0, _fxCount) are live each frame.
    private readonly _fxDesc: { partIdx: number; plan: EffectDrawPlan; cellmap: number; blend: number; quadCount: number; particleOffset: number; partAlpha: number; }[] = [];
    private _fxCount = 0;

    private pixiResourceManager: PixiResourceManager;
    private debugText: Text;

    // --- Animation event listeners (06_playback_control.ja.md) ---
    private readonly _userDataListeners = new Set<(e: SSUserDataEvent) => void>();
    private readonly _signalListeners = new Set<(e: SSSignalEvent) => void>();
    private readonly _audioListeners = new Set<(e: SSAudioEvent) => void>();
    private readonly _animEndListeners = new Set<() => void>();
    private readonly _animLoopListeners = new Set<() => void>();
    // Rising-edge memory for onAnimationEnd (!playing && end-reached): the
    // runtime leaves is_end_frame_reached() asserted after stopping, so we
    // notify once on the false→true transition.
    private _prevFinished = false;
    private partsColorShaders: Map<Texture, Shader> = new Map();
    private effectShaders: Map<Texture, Shader> = new Map();

    // --- SpriteStudio integration shaders (ssae `SHDR` attribute) ---
    // A part carrying a shader attribute needs its OWN per-part uniforms
    // (param0..7, cell rect, pixel size), so the plain per-texture caching used
    // for PartsColorShader can't be shared across parts. Instead we pool one
    // Shader instance per (id_hash, texture) per simultaneously-drawn part: the
    // pool is keyed `${idHash}_${texUid}` and `ssShaderActive` counts how many
    // of each key were used this frame (reset in renderFrame), so part N of a
    // key reuses pool[N] — each with its own UniformGroup written that frame.
    private ssShaderPools: Map<string, Shader[]> = new Map();
    private ssShaderActive: Map<string, number> = new Map();

    // --- Mask coverage state (see 09_mask.ja.md §3-2) ---
    // The renderer, captured lazily on the first render via onRender; the
    // coverage pre-pass needs it to rasterise into RenderTextures, and it runs
    // before the stage render (in the ticker) so coverage is ready by draw time.
    private renderer: Renderer | null = null;
    private maskRenderRoot = new Container();
    // Separate pools so each pool's vertex layout matches its shader exactly:
    // coverage meshes (MaskWrite) share the normal layout; masked-content
    // meshes carry the extra aMaskUV attribute (MaskedPartsColor).
    private maskMeshPool: Mesh<any>[] = [];
    private activeMaskMeshes: number = 0;
    private maskedMeshPool: Mesh<any>[] = [];
    private activeMaskedMeshes: number = 0;
    // Pooled offscreen coverage textures (one per mask-bearing context per frame).
    private rtPool: RenderTexture[] = [];
    // Pooled per-context coverage records, indexed in lockstep with rtPool.
    private covPool: MaskCoverage[] = [];
    private activeRTs: number = 0;
    // Bbox→RT mapping for the coverage pass, passed as the render-root transform
    // (a render-group root's own scale/position are ignored by renderer.render).
    private readonly scratchCovTransform = new Matrix();
    // Engine-agnostic mask writer planner (core) + its FrameData adapter. The
    // planner does all writer selection/classification; this class only
    // rasterises the resulting plan into the coverage bitmap.
    private readonly maskPlanner = new MaskPlanner();
    private readonly maskSource = new FrameDataMaskSource();
    private maskWriteShaders: Map<Texture, Shader> = new Map();
    // Masked-content shaders keyed by `${contentTexUid}_${coverageRtUid}` so the
    // bound coverage sampler (a per-context resource) stays consistent.
    private maskedShaders: Map<string, Shader> = new Map();
    private maskWritersExceeded: boolean = false;
    /**
     * Enables SpriteStudio mask / clipping rendering (the coverage pre-pass and
     * per-part clipping). On by default; set false to draw every part unclipped
     * (mask parts themselves stay hidden, as they carry no colour).
     */
    public maskEnabled: boolean = true;
    
    /**
     * Optional AudioManager. If set, setAnimation will automatically preload sounds
     * required by the current animation.
     */
    public get audioManager(): IAudioManager | null {
        return this.internalPlayer.audioManager;
    }
    public set audioManager(value: IAudioManager | null) {
        this.internalPlayer.audioManager = value;
    }
    public get subframe(): boolean {
        return this.internalPlayer.subFrameEnabled;
    }

    public set subframe(value: boolean) {
        this.internalPlayer.subFrameEnabled = value;
    }
    
    public get speedScale(): number {
        return this.internalPlayer.getSpeed();
    }
    public set speedScale(speed: number) {
        this.internalPlayer.setSpeed(speed);
    }
    
    private getPartsColorShader(texture: Texture): Shader {
        let shader = this.partsColorShaders.get(texture);
        if (!shader) {
            shader = Shader.from({
                gl: PartsColorShader,
                gpu: PartsColorShaderWGSL,
                resources: {
                    uTexture: texture.source,
                    uTextureSampler: texture.source.style
                }
            });
            this.partsColorShaders.set(texture, shader);
        }
        return shader;
    }

    private getEffectShader(texture: Texture): Shader {
        let shader = this.effectShaders.get(texture);
        if (!shader) {
            shader = Shader.from({
                gl: EffectShader,
                gpu: EffectShaderWGSL,
                resources: {
                    uTexture: texture.source,
                    uTextureSampler: texture.source.style
                }
            });
            this.effectShaders.set(texture, shader);
        }
        return shader;
    }

    /**
     * Acquire a Shader for a part's SpriteStudio integration shader
     * (`SHDR` attribute). Returns null when `idHash` isn't one of the built-in
     * `ss-*` shaders (the caller then uses the plain PartsColorShader).
     *
     * Pooled per (idHash, texture) and handed out in draw order within a frame
     * (see `ssShaderActive`), so each drawn shader-part gets a distinct Shader
     * instance whose per-part uniforms (param0..7 / cellRect / pixelSize) the
     * caller fills without clobbering another part's. Reused across frames.
     */
    private acquireSsShader(idHash: number, texture: Texture): Shader | null {
        const src = SS_SHADER_SOURCES.get(idHash);
        if (!src) return null;

        const key = `${idHash}_${(texture.source as any).uid}`;
        let pool = this.ssShaderPools.get(key);
        if (!pool) {
            pool = [];
            this.ssShaderPools.set(key, pool);
        }
        const idx = this.ssShaderActive.get(key) ?? 0;
        this.ssShaderActive.set(key, idx + 1);

        let shader = pool[idx];
        if (!shader) {
            const ssUniforms = new UniformGroup({
                uParams: { value: new Float32Array(8), type: 'vec4<f32>', size: 2 },
                uCellRect: { value: new Float32Array([0, 0, 1, 1]), type: 'vec4<f32>' },
                uPixelSize: { value: new Float32Array([0, 0]), type: 'vec2<f32>' },
            });
            shader = Shader.from({
                gl: src.gl,
                gpu: src.gpu,
                resources: {
                    uTexture: texture.source,
                    uTextureSampler: texture.source.style,
                    ssUniforms,
                },
            });
            pool.push(shader);
        }
        return shader;
    }

    /**
     * Resolve a part's `SHDR` attribute (shaders-array index) to a configured
     * Shader: looks up the `PartAttributeShader` (id_hash + param0..7), acquires
     * the matching `ss-*` program, and writes its per-part uniforms — param0..7,
     * the cell's UV rect (from the quad's corner UVs, for ss-circle / ss-spot),
     * and pixel size (1/texW, 1/texH). Returns null when the id_hash isn't a
     * built-in shader (caller falls back to PartsColorShader).
     *
     * `uvs` is the part's already-built per-vertex UV buffer (5-vertex quad:
     * corners 0..3 + centre 4); the cell rect is min/max over the four corners.
     */
    private resolveSsShader(
        frameData: FrameData,
        shaderIdx: number,
        uvs: Float32Array,
        texture: Texture,
        invTexW: number,
        invTexH: number
    ): Shader | null {
        const attr = frameData.shaders(shaderIdx);
        if (!attr) return null;
        const shader = this.acquireSsShader(attr.idHash(), texture);
        if (!shader) return null;

        const u = (shader.resources.ssUniforms as UniformGroup).uniforms;
        const params = u.uParams as Float32Array;
        params[0] = attr.param0(); params[1] = attr.param1();
        params[2] = attr.param2(); params[3] = attr.param3();
        params[4] = attr.param4(); params[5] = attr.param5();
        params[6] = attr.param6(); params[7] = attr.param7();

        // Cell UV rect = (left, top, right, bottom) over the quad's 4 corners.
        let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
        for (let q = 0; q < 4; q++) {
            const uu = uvs[q * 2];
            const vv = uvs[q * 2 + 1];
            if (uu < minU) minU = uu;
            if (uu > maxU) maxU = uu;
            if (vv < minV) minV = vv;
            if (vv > maxV) maxV = vv;
        }
        const cr = u.uCellRect as Float32Array;
        cr[0] = minU; cr[1] = minV; cr[2] = maxU; cr[3] = maxV;

        const psz = u.uPixelSize as Float32Array;
        psz[0] = invTexW; psz[1] = invTexH;

        (shader.resources.ssUniforms as UniformGroup).update();
        return shader;
    }

    constructor() {
        super();
        this.pixiResourceManager = new PixiResourceManager();
        this.internalPlayer = new DirectInternalPlayer(this.pixiResourceManager);
        this.debugText = new Text({ text: "Frame: 0", style: { fill: 0xffffff } });
        this.debugText.visible = false;
        this.addChild(this.debugText);

        // Capture the renderer the first time we're drawn. The mask coverage
        // pre-pass renders to offscreen textures and needs a renderer; running
        // it from the ticker (before the stage render) keeps coverage ready by
        // the time our masked children are drawn. Masking therefore starts on
        // the second frame (the first has no renderer yet) — harmless.
        this.onRender = (renderer: Renderer) => {
            this.renderer = renderer;
            // WebGL: register the SS fixed-function blend modes into this renderer's
            // blend map (idempotent; no-op on WebGPU, handled at import time).
            registerSSBlendModesGL(renderer);
        };

        Ticker.shared.add(this.update, this);
    }
    
    public override destroy(options?: any) {
        Ticker.shared.remove(this.update, this);
        if (this.internalPlayer) {
            this.internalPlayer.destroy();
        }
        for (const rt of this.rtPool) rt.destroy(true);
        this.rtPool.length = 0;

        for (const m of this.meshPool) m.destroy({ children: true, texture: false, textureSource: false });
        for (const m of this.maskedMeshPool) m.destroy({ children: true, texture: false, textureSource: false });
        for (const m of this.maskMeshPool) m.destroy({ children: true, texture: false, textureSource: false });
        this.meshPool.length = 0;
        this.maskedMeshPool.length = 0;
        this.maskMeshPool.length = 0;

        super.destroy(options);
    }
    
    public setDebugVisible(visible: boolean) {
        this.debugText.visible = visible;
    }

    /**
     * Loads the SSAB file and its associated textures.
     * @param ssabUrl URL to the .ssab file
     * @param assetBaseUrl Base URL for assets (defaults to ssabUrl's directory)
     */
    public async load(ssabUrl: string, assetBaseUrl?: string) {
        await this.internalPlayer.load(ssabUrl, assetBaseUrl);
        this.internalPlayer.runtimeManager.context.set_render_mode(0); // 0 corresponds to RenderMode::Direct
        this.internalPlayer.runtimeManager.context.set_coordinate_system(1); // 1 = YDown

        // Lazy initialize the audio manager only if the loaded SSAB contains sounds,
        // so that projects without audio don't waste resources creating AudioContexts.
        const sounds = this.internalPlayer.runtimeManager.getSounds();
        if (sounds.length > 0 && !this.audioManager) {
            const defaultAudioManager = new SSWebAudioManager();
            defaultAudioManager.bindToPlayer(this);
            this.audioManager = defaultAudioManager;
        }
    }

    public async setAnimation(animationName: string, loop: number = -1, assetBaseUrl?: string) {
        await this.internalPlayer.setAnimation(animationName, assetBaseUrl);
        this.internalPlayer.setLoop(loop);
    }

    public get animationName(): string {
        return this.internalPlayer.animationName;
    }

    public play(startFrame: number = -1) {
        this.internalPlayer.play(startFrame);
    }

    public pause() {
        this.internalPlayer.pause();
    }

    public stop() {
        this.internalPlayer.stop();
    }
    
    public resume() {
        this.internalPlayer.resume();
    }

    public get frame(): number {
        return this.internalPlayer.getFrameNo();
    }

    public set frame(value: number) {
        this.internalPlayer.setFrame(value);
    }



    public get totalFrames(): number {
        return this.internalPlayer.getTotalFrames();
    }

    public get startFrame(): number {
        return this.internalPlayer.getAnimationSectionStart();
    }

    public get endFrame(): number {
        return this.internalPlayer.getAnimationSectionEnd();
    }

    public get fps(): number {
        return this.internalPlayer.getFrameRate();
    }

    public set fps(value: number) {
        this.internalPlayer.setFrameRate(value);
    }

    public get isPlaying(): boolean {
        return this.internalPlayer.isPlaying;
    }

    public get isPausing(): boolean {
        return this.internalPlayer.isPausing;
    }

    public setAnimationSection(startFrame: number, endFrame: number) {
        this.internalPlayer.setAnimationSection(startFrame, endFrame);
    }

    public setPlaybackDirection(direction: WebPlaybackDirection, style: WebPlaybackStyle) {
        this.internalPlayer.setPlaybackDirection(direction, style);
    }

    public get loopCount(): number {
        return this.internalPlayer.getLoop();
    }

    public set loopCount(value: number) {
        this.internalPlayer.setLoop(value);
    }

    public get frameSkipEnabled(): boolean {
        return this.internalPlayer.isSkipFrames();
    }

    public set frameSkipEnabled(value: boolean) {
        this.internalPlayer.setSkipFrames(value);
    }

    public getPartIndexFromName(partName: string): number {
        return this.internalPlayer.runtimeManager.getPartIndexFromName(partName);
    }

    public getPartsCount(): number {
        return this.internalPlayer.runtimeManager.getPartsCount();
    }

    // --- Animation events (06_playback_control.ja.md) ---
    //
    // Listeners are drained each frame by the ticker via pollEvents() (see
    // update()). Each registration returns an unsubscribe function. The runtime
    // plays no audio — onAudio hands the sound reference to the host.

    /** Registers a user-data event listener. Returns an unsubscribe function. */
    public onUserData(listener: (e: SSUserDataEvent) => void): Unsubscribe {
        this._userDataListeners.add(listener);
        return () => { this._userDataListeners.delete(listener); };
    }

    /** Registers a signal event listener (active signals only). Returns an unsubscribe function. */
    public onSignal(listener: (e: SSSignalEvent) => void): Unsubscribe {
        this._signalListeners.add(listener);
        return () => { this._signalListeners.delete(listener); };
    }

    /** Registers an audio event listener. Returns an unsubscribe function. */
    public onAudio(listener: (e: SSAudioEvent) => void): Unsubscribe {
        this._audioListeners.add(listener);
        return () => { this._audioListeners.delete(listener); };
    }

    /** Fires once when a non-looping animation reaches its end and stops. */
    public onAnimationEnd(listener: () => void): Unsubscribe {
        this._animEndListeners.add(listener);
        return () => { this._animEndListeners.delete(listener); };
    }

    /** Fires on each loop boundary crossing. */
    public onAnimationLoop(listener: () => void): Unsubscribe {
        this._animLoopListeners.add(listener);
        return () => { this._animLoopListeners.delete(listener); };
    }

    /**
     * Drain and dispatch the events accumulated by the last runtime update:
     * user-data / signal / audio, plus animation end (edge) and loop (pulse).
     * Called from the ticker right after `internalPlayer.update()`, while the
     * runtime's passed-event buffer is still valid. Reads event payloads from
     * the current animation's SSAB events table via the runtime manager's
     * introspection accessors. Safe with no listeners / no animation.
     */
    private pollEvents(): void {
        const ctx = this.internalPlayer.runtimeManager.context;

        // onAnimationEnd: rising edge of "stopped at end" (the runtime leaves
        // is_end_frame_reached() asserted after stopping, so notify once).
        const finished = !ctx.is_playing() && ctx.is_end_frame_reached();
        if (finished && !this._prevFinished) {
            if (this._animEndListeners.size > 0) {
                this._animEndListeners.forEach(cb => cb());
            }
        }
        this._prevFinished = finished;

        // onAnimationLoop: is_looped() pulses true for the single update that
        // crossed a loop boundary, so dispatch it verbatim.
        if (this._animLoopListeners.size > 0 && ctx.is_looped()) {
            this._animLoopListeners.forEach(cb => cb());
        }

        const count = ctx.get_passed_event_count();
        if (count <= 0) return;
        if (this._userDataListeners.size === 0 && this._signalListeners.size === 0 && this._audioListeners.size === 0) return;

        const anim = this.internalPlayer.runtimeManager.getCurrentAnimationData();
        if (!anim) return;

        for (let i = 0; i < count; i++) {
            // get_passed_event_index returns the index into this animation's
            // per-frame events table (single-source playback: always primary).
            const eventIdx = ctx.get_passed_event_index(i);
            const events = anim.events(eventIdx);
            if (!events) continue;
            if (this._userDataListeners.size > 0) this.dispatchUserData(events);
            if (this._signalListeners.size > 0) this.dispatchSignals(events);
            
            // Only play audio if we are effectively playing forward.
            // is_playing_forward() handles the Forward/Backward/PingPong direction state,
            // while speedScale handles user-level time reversal.
            const isPlayingForward = (ctx.is_playing_forward() === (this.speedScale >= 0));
            if (this._audioListeners.size > 0 && isPlayingForward) {
                this.dispatchAudios(events);
            }
        }
    }

    private dispatchUserData(events: ssFormat.EventsPerFrame): void {
        const mgr = this.internalPlayer.runtimeManager;
        const n = events.usersLength();
        for (let j = 0; j < n; j++) {
            const user = events.users(j);
            const val = user?.value();
            if (!user || !val) continue;
            const partIndex = user.partIndex();
            const ev: SSUserDataEvent = { partIndex, partName: mgr.getPartName(partIndex) };
            const intEntry = val.integer();
            if (intEntry) ev.integer = intEntry.value();
            const str = val.str();
            if (str !== null) ev.str = str;
            const rect = val.rect();
            if (rect) ev.rect = { x1: rect.x1(), y1: rect.y1(), x2: rect.x2(), y2: rect.y2() };
            const point = val.point();
            if (point) ev.point = { x: point.v1(), y: point.v2() };
            this._userDataListeners.forEach(cb => cb(ev));
        }
    }

    private dispatchSignals(events: ssFormat.EventsPerFrame): void {
        const mgr = this.internalPlayer.runtimeManager;
        const n = events.signalsLength();
        for (let j = 0; j < n; j++) {
            const sig = events.signals(j);
            const val = sig?.value();
            if (!sig || !val) continue;
            // Skip inactive signals (Godot / Unity / porting-guide behaviour).
            if (!val.active()) continue;

            const params: Record<string, boolean | number | string> = {};
            const pn = val.paramsLength();
            for (let k = 0; k < pn; k++) {
                const param = val.params(k);
                if (!param) continue;
                const paramId = param.paramId();
                if (paramId === null) continue;

                // Resolve the param's union value (Bool/Index/Integer/Floating/Text).
                let boxed: boolean | number | string | undefined;
                switch (param.valueType()) {
                    case ssFormat.SignalCommandParamValue.Bool:
                        boxed = (param.value(new ssFormat.BoolValueEntry()) as ssFormat.BoolValueEntry | null)?.value(); break;
                    case ssFormat.SignalCommandParamValue.Index:
                    case ssFormat.SignalCommandParamValue.Integer:
                        boxed = (param.value(new ssFormat.IntValueEntry()) as ssFormat.IntValueEntry | null)?.value(); break;
                    case ssFormat.SignalCommandParamValue.Floating:
                        boxed = (param.value(new ssFormat.FloatValueEntry()) as ssFormat.FloatValueEntry | null)?.value(); break;
                    case ssFormat.SignalCommandParamValue.Text: {
                        const s = (param.value(new ssFormat.StringValueEntry()) as ssFormat.StringValueEntry | null)?.value();
                        boxed = s ?? undefined; break;
                    }
                    default: continue;
                }
                if (boxed !== undefined) params[paramId] = boxed;
            }

            const partIndex = sig.partIndex();
            const ev: SSSignalEvent = {
                partIndex,
                partName: mgr.getPartName(partIndex),
                active: true,
                commandId: val.commandId(),
                params,
            };
            this._signalListeners.forEach(cb => cb(ev));
        }
    }

    private dispatchAudios(events: ssFormat.EventsPerFrame): void {
        const mgr = this.internalPlayer.runtimeManager;
        const n = events.audiosLength();
        for (let j = 0; j < n; j++) {
            const audio = events.audios(j);
            const val = audio?.value();
            if (!audio || !val) continue;
            const partIndex = audio.partIndex();
            const ev: SSAudioEvent = {
                partIndex,
                partName: mgr.getPartName(partIndex),
                soundListNameHash: val.soundListNameHash(),
                soundNameHash: val.soundNameHash(),
                soundName: val.soundName(),
                loopNum: val.loopNum(),
            };
            this._audioListeners.forEach(cb => cb(ev));
        }
    }

    private update(ticker: Ticker) {
        // console.log("update tick", this.internalPlayer.isPlaying, this.internalPlayer.isPausing, this.internalPlayer.getFrameNo());
        if (!this.internalPlayer.isPlaying) return;

        const deltaMs = ticker.deltaMS;

        // Advance every tick. While playing this steps the timeline; while paused
        // internalPlayer.update() still advances `independent` effect / instance
        // slots on their own clock (see InternalPlayerBase.update), so paused
        // particles / sub-animations keep running and we re-render below.
        const pausing = this.internalPlayer.isPausing;
        this.internalPlayer.update(deltaMs);
        if (!pausing) {
            // Drain the events accumulated by this update (user-data / signal /
            // audio + animation end/loop) right away, while the runtime's
            // passed-event buffer is still valid. Must run on the same tick that
            // advanced — including the tick a non-looping animation finishes on,
            // since the next tick early-returns on !isPlaying. Skipped while paused
            // (the timeline did not move, so no events were passed).
            this.pollEvents();
        }

        const frameNo = this.internalPlayer.getFrameNo();
        
        if (this.debugText.visible) {
            this.debugText.text = `Frame: ${frameNo} (dt: ${deltaMs.toFixed(2)}ms)`;
        }
        
        this.renderFrame(frameNo);
    }

    private renderFrame(frameNo: number) {
        const frameData = this.internalPlayer.runtimeManager.getFrameData(frameNo);
        if (!frameData) return;

        for (let i = 0; i < this.meshPool.length; i++) {
            this.meshPool[i].visible = false;
        }
        for (let i = 0; i < this.maskedMeshPool.length; i++) {
            this.maskedMeshPool[i].visible = false;
        }

        this.activeMeshes = 0;
        this.activeMaskedMeshes = 0;
        this.activeMaskMeshes = 0;
        this.activeRTs = 0;
        // Per-frame reset of the integration-shader pool hand-out counters so
        // each frame re-issues pooled Shader instances from index 0.
        this.ssShaderActive.clear();
        this.removeChildren();
        this.addChild(this.debugText);

        // The root animation renders with no parent transform and full alpha;
        // instance-part children recurse through here with their accumulated
        // transform and alpha.
        this.renderContext(
            this.internalPlayer,
            frameData,
            frameNo,
            null,
            1.0
        );
    }

    /**
     * Render one runtime context (the root, or an instance-part child) into the
     * shared mesh pool. `parentMatrix` (a 2D affine, or null at the root) places
     * the context under its parent instance part, and `parentAlpha` folds the
     * parent chain's opacity into every emitted mesh. Instance batches recurse,
     * composing the instance part's world matrix and alpha as they descend.
     */
    private renderContext(
        player: DirectInternalPlayer,
        frameData: FrameData,
        frameNo: number,
        parentMatrix: Float32Array | null,
        parentAlpha: number,
        inheritedMask: InheritedMask | null = null
    ) {
        const manager = player.runtimeManager;
        const geometryBuilder = player.geometryBuilder;

        geometryBuilder.parentMatrix = parentMatrix;
        geometryBuilder.updateWorldPositions();

        let drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;

        // `frameData` (a FlatBuffer ByteBuffer) and `drawOrder` are zero-copy
        // views over the WASM memory buffer. An instance child's getFrameData()
        // in the batch loop below can grow WASM memory, which detaches the old
        // ArrayBuffer (grow preserves contents but swaps the buffer object) and
        // leaves these views reading garbage for this context's remaining
        // batches. We track the buffer identity and re-derive both whenever it
        // changes after recursing — zero cost unless a grow actually happened.
        // See the wasm-buffer-detach-on-grow project note.
        let memBuf = getWasmMemory().buffer;

        const maskFlags = manager.getPartMaskFlags();

        // Mask coverage pre-pass: rasterise this context's mask contributors
        // (DrawBatchKind.Mask batches) into an offscreen coverage texture, then
        // masked content samples it below. Null when the context has no masks or
        // no renderer is available yet (the first frame) — masked parts then draw
        // unclipped. Runs here, in the ticker, so coverage is ready before the
        // stage render draws our children. See buildMaskCoverage / 09_mask.ja.md.
        const cov = (this.renderer && this.maskEnabled) ? this.buildMaskCoverage(manager, geometryBuilder, frameData, drawOrder) : null;

        // When this context is a masked instance child, every drawn part is
        // clipped by the inherited (parent) coverage instead of this context's
        // own; otherwise parts use this context's own coverage per-part (§3-2-2).
        const effCov = inheritedMask ? inheritedMask.cov : cov;

        const drawBatchesLength = frameData.drawBatchesLength();
        for (let i = 0; i < drawBatchesLength; i++) {
            const batch = frameData.drawBatches(i);
            if (!batch) continue;

            const kind = batch.kind();
            // DrawBatchKind.Mask is consumed by the coverage pre-pass above.
            if (kind !== DrawBatchKind.Normal && kind !== DrawBatchKind.Mesh && kind !== DrawBatchKind.Shape && kind !== DrawBatchKind.Effect && kind !== DrawBatchKind.Instance) continue;

            const startRank = batch.startRank();
            const count = batch.count();
            if (count === 0) continue;

            // Instance batches carry no texture/blend of their own — each is a
            // single instance part whose referenced animation is rendered here
            // by recursing into its child context.
            if (kind === DrawBatchKind.Instance) {
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const partState = frameData.parts(partIdx, this.scratchPartState);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const child = player.getInstanceChild(partIdx);
                    if (!child || !child.visible) continue;

                    const childFrame = child.player.runtimeManager.context.get_frame_no();
                    const childFrameData = child.player.runtimeManager.getFrameData(childFrame);
                    if (!childFrameData) continue;

                    manager.getWorldMatrix2D(partIdx, this.scratchInstMat);
                    const composed = GeometryBuilder.composeAffine(parentMatrix, this.scratchInstMat, child.parentMatrix);

                    // §3-2-2 instance mask inheritance: if this context produced
                    // coverage and the instance part is a mask target
                    // (mask_influence, bit 0x04), the whole sub-animation is
                    // clipped by THIS coverage, judged by the instance part's own
                    // rank and visible_inside_mask polarity (single level). The
                    // child's composited positions are already in this coverage's
                    // space, so its parts can sample `cov` directly.
                    const childInherited: InheritedMask | null =
                        (cov && maskFlags && (maskFlags[partIdx] & 0x04) !== 0)
                            ? { cov, rank: startRank + c, mode: (maskFlags[partIdx] & 0x01) !== 0 ? 1 : 0 }
                            : null;
                    this.renderContext(child.player, childFrameData, childFrame, composed, parentAlpha * alpha, childInherited);

                    // The child's getFrameData()/recursion may have grown WASM
                    // memory and detached our frameData/drawOrder views. Re-derive
                    // from the current buffer (contents are preserved) before
                    // reading more of this context's frame. Only runs on actual
                    // growth, so steady-state instance rendering pays nothing.
                    if (getWasmMemory().buffer !== memBuf) {
                        const fresh = manager.getFrameData(frameNo);
                        const freshOrder = fresh?.drawOrderArray();
                        if (!fresh || !freshOrder) return;
                        frameData = fresh;
                        drawOrder = freshOrder;
                        memBuf = getWasmMemory().buffer;
                    }
                }
                continue;
            }

            const textureHash = batch.textureHash();
            // Effect batches (and root/null parts) carry textureHash 0; their real
            // texture is resolved per draw command, so avoid the missing-asset warning.
            const texture = textureHash !== 0 ? (this.pixiResourceManager.getTexture(textureHash) || Texture.WHITE) : Texture.WHITE;

            // SpriteStudio framebuffer-composite blend (alpha_blend_type, 12 values)
            // → PixiJS blend mode. See 10_parts_color §1-0: this is the framebuffer
            // composite, distinct from the PartColor (vertex) blend.
            // Factors verified against SS6PlayerForUnity. GPU-native pixi modes:
            //  Mix→normal [one,1-srcA]; Add→add; Mul→multiply [dst,1-srcA];
            //  Screen→screen (== SS [1-dst,one] for premultiplied). Mulalpha (SS
            //  [zero,srcColor] = dst*src) == premultiplied multiply for opaque parts.
            // Exclusion / Invert have no GPU-native pixi mode and are registered as
            // fixed-function GPU blends (SSBlendModes) — NOT advanced filters. Sub is
            // intentionally left as the original 'subtract' (which is not registered,
            // so it falls back to 'normal') per user preference — the true SS
            // reverse-subtract looked wrong (greyed-out) for the bundled asset.
            let blendMode: any = 'normal';
            switch (batch.blendType()) {
                case BlendType.Mix: blendMode = 'normal'; break;
                case BlendType.Mul: blendMode = 'multiply'; break;
                case BlendType.Add: blendMode = 'add'; break;
                case BlendType.Sub: blendMode = 'subtract'; break;
                case BlendType.Mulalpha: blendMode = 'multiply'; break;
                case BlendType.Screen: blendMode = 'screen'; break;
                case BlendType.Exclusion: blendMode = SS_EXCLUSION_BLEND; break;
                case BlendType.Invert: blendMode = SS_INVERT_BLEND; break;
                // SS6 "2" composite variants: not used by any bundled asset and with
                // no exact PixiJS equivalent — best-effort to the nearest GPU-native
                // mode (Div2/Overlay2 have none → 'normal'). Unverified.
                case BlendType.Mul2: blendMode = 'multiply'; break;
                case BlendType.Div2: blendMode = 'normal'; break;
                case BlendType.Screen2: blendMode = 'screen'; break;
                case BlendType.Overlay2: blendMode = 'normal'; break;
                default: blendMode = 'normal'; break;
            }
            
            const invTexW = 1.0 / texture.width;
            const invTexH = 1.0 / texture.height;
            
            // Parts in this batch are clipped by the mask when the runtime set
            // FLAG_MASK_INFLUENCE (0x01) and this context produced coverage, or
            // unconditionally when this whole context is a masked instance child
            // (inherited mask — §3-2-2). Masked parts use a separate pool
            // (carrying aMaskUV) and shader.
            const masked = inheritedMask !== null || (cov !== null && (batch.flags() & 0x01) !== 0);

            if (kind === DrawBatchKind.Normal) {
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    // draw_as_mask parts are pure masks: coverage only, no colour.
                    if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
                    const partState = frameData.parts(partIdx, this.scratchPartState);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const mesh = masked
                        ? this.acquireMesh(this.maskedMeshPool, this.activeMaskedMeshes++, 5, 12, true)
                        : this.acquireMesh(this.meshPool, this.activeMeshes++, 5, 12, false);

                    const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                    const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                    const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                    const vargs = mesh.geometry.getBuffer('aVarg').data as Float32Array;

                    geometryBuilder.buildNormal(
                        partIdx, frameData, invTexW, invTexH,
                        positions, uvs, colors, vargs
                    );
                    mesh.geometry.getBuffer('aPosition').update();
                    mesh.geometry.getBuffer('aUV').update();
                    mesh.geometry.getBuffer('aColor').update();
                    mesh.geometry.getBuffer('aVarg').update();

                    // SpriteStudio integration shader (`SHDR`): if this part
                    // carries a shader attribute resolving to a built-in `ss-*`
                    // program, draw it with that program (param0..7 + cell rect
                    // + pixel size as per-part uniforms) instead of the plain
                    // PartsColorShader. Not combined with masking (v1) — a
                    // masked shader part falls back to the plain masked path.
                    const ssShader = (!masked && partState && partState.shader() >= 0)
                        ? this.resolveSsShader(frameData, partState.shader(), uvs, texture, invTexW, invTexH)
                        : null;

                    this.finishPart(mesh, 5, masked,
                        inheritedMask ? inheritedMask.rank : startRank + c,
                        inheritedMask ? inheritedMask.mode : ((maskFlags && (maskFlags[partIdx] & 0x01) !== 0) ? 1 : 0),
                        effCov, texture, blendMode, parentAlpha, ssShader);
                }
            } else if (kind === DrawBatchKind.Shape) {
                const shapeVertexCounts = manager.getShapeVertexCounts();

                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
                    const numVerts = shapeVertexCounts[partIdx];
                    if (numVerts < 3) continue;

                    const partState = frameData.parts(partIdx, this.scratchPartState);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const numIndices = (numVerts - 2) * 3;
                    const mesh = masked
                        ? this.acquireMesh(this.maskedMeshPool, this.activeMaskedMeshes++, numVerts, numIndices, true)
                        : this.acquireMesh(this.meshPool, this.activeMeshes++, numVerts, numIndices, false);

                    const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                    const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                    const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                    const vargs = mesh.geometry.getBuffer('aVarg').data as Float32Array;
                    const indices = mesh.geometry.getIndex().data as Uint32Array;

                    geometryBuilder.buildShape(
                        partIdx, frameData, numVerts, invTexW, invTexH,
                        positions, uvs, colors, vargs, indices
                    );

                    mesh.geometry.getBuffer('aPosition').update();
                    mesh.geometry.getBuffer('aUV').update();
                    mesh.geometry.getBuffer('aColor').update();
                    mesh.geometry.getBuffer('aVarg').update();
                    mesh.geometry.getIndex().update();

                    this.finishPart(mesh, numVerts, masked,
                        inheritedMask ? inheritedMask.rank : startRank + c,
                        inheritedMask ? inheritedMask.mode : ((maskFlags && (maskFlags[partIdx] & 0x01) !== 0) ? 1 : 0),
                        effCov, texture, blendMode, parentAlpha);
                }
            } else if (kind === DrawBatchKind.Mesh) {
                const meshVOff = manager.getMeshVertexOffsets();
                const meshIOff = manager.getMeshIndexOffsets();

                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
                    const partState = frameData.parts(partIdx, this.scratchPartState);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const v0 = meshVOff[partIdx];
                    const v1 = meshVOff[partIdx + 1];
                    const i0 = meshIOff[partIdx];
                    const i1 = meshIOff[partIdx + 1];

                    const pCount = v1 - v0;
                    const iCount = i1 - i0;
                    if (pCount === 0 || iCount === 0) continue;

                    const mesh = masked
                        ? this.acquireMesh(this.maskedMeshPool, this.activeMaskedMeshes++, pCount, iCount, true)
                        : this.acquireMesh(this.meshPool, this.activeMeshes++, pCount, iCount, false);

                    const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                    const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                    const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                    const vargs = mesh.geometry.getBuffer('aVarg').data as Float32Array;
                    const indices = mesh.geometry.getIndex().data as Uint32Array;

                    geometryBuilder.buildMesh(
                        partIdx, frameData, pCount, iCount, invTexW, invTexH,
                        positions, uvs, colors, vargs, indices
                    );
                    mesh.geometry.getBuffer('aPosition').update();
                    mesh.geometry.getBuffer('aUV').update();
                    mesh.geometry.getBuffer('aColor').update();
                    mesh.geometry.getBuffer('aVarg').update();
                    mesh.geometry.getIndex().update();

                    this.finishPart(mesh, pCount, masked,
                        inheritedMask ? inheritedMask.rank : startRank + c,
                        inheritedMask ? inheritedMask.mode : ((maskFlags && (maskFlags[partIdx] & 0x01) !== 0) ? 1 : 0),
                        effCov, texture, blendMode, parentAlpha);
                }
            } else if (kind === DrawBatchKind.Effect) {
                // Particle geometry is simulated in the WASM runtime and returned as an
                // EffectDrawPlan per effect part: one command per (cellmap, blend) emitter
                // group, slicing shared flat buffers. The per-vertex math lives in core's
                // GeometryBuilder.buildEffectCommand.
                //
                // Dynamic batching (08_advanced_rendering §2): we gather every particle
                // command in this batch in draw order — folding each effect part's own
                // opacity into the vertex alpha — then merge consecutive commands sharing
                // the same (cellmap, blend) into a single pooled Mesh / draw call. Only
                // *consecutive* runs are merged, so draw order (hence blend compositing)
                // is preserved exactly.
                this._fxCount = 0;
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const partState = frameData.parts(partIdx, this.scratchPartState);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const plan = player.getEffectDrawPlan(partIdx);
                    if (!plan) continue;

                    const cmdCount = plan.commandsLength();
                    for (let cmdIdx = 0; cmdIdx < cmdCount; cmdIdx++) {
                        const cmd = plan.commands(cmdIdx);
                        if (!cmd) continue;
                        const quadCount = cmd.quadCount();
                        if (quadCount === 0) continue;

                        let d = this._fxDesc[this._fxCount];
                        if (!d) {
                            d = { partIdx: 0, plan, cellmap: 0, blend: 0, quadCount: 0, particleOffset: 0, partAlpha: 1 };
                            this._fxDesc[this._fxCount] = d;
                        }
                        d.partIdx = partIdx;
                        d.plan = plan;
                        d.cellmap = cmd.cellmapHash();
                        d.blend = cmd.blend();
                        d.quadCount = quadCount;
                        d.particleOffset = cmd.particleOffset();
                        d.partAlpha = alpha;
                        this._fxCount++;
                    }
                }

                // The descriptors hold zero-copy EffectDrawPlan views over WASM
                // memory. Nothing between the gather above and the build below
                // allocates in WASM (getEffectShader / getTexture / buffer updates
                // are all JS/GPU side), so the views stay valid — no re-derive needed.
                let g = 0;
                while (g < this._fxCount) {
                    const cellmap = this._fxDesc[g].cellmap;
                    const blend = this._fxDesc[g].blend;
                    let h = g;
                    let totalQuads = 0;
                    while (h < this._fxCount && this._fxDesc[h].cellmap === cellmap && this._fxDesc[h].blend === blend) {
                        totalQuads += this._fxDesc[h].quadCount;
                        h++;
                    }

                    const pCount = totalQuads * 4;
                    const iCount = totalQuads * 6;
                    const mesh = this.getMeshFromPool(this.activeMeshes, pCount, iCount);
                    this.activeMeshes++;

                    const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                    const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                    const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                    const indices = mesh.geometry.getIndex().data as Uint32Array;

                    let vOff = 0;
                    let iOff = 0;
                    for (let k = g; k < h; k++) {
                        const d = this._fxDesc[k];
                        geometryBuilder.buildEffectCommand(
                            d.partIdx, d.plan, d.particleOffset, d.quadCount,
                            positions, uvs, colors, indices, vOff, iOff, d.partAlpha
                        );
                        vOff += d.quadCount * 4;
                        iOff += d.quadCount * 6;
                    }

                    mesh.geometry.getBuffer('aPosition').update();
                    mesh.geometry.getBuffer('aUV').update();
                    mesh.geometry.getBuffer('aColor').update();
                    mesh.geometry.getIndex().update();

                    const effectTex = this.pixiResourceManager.getTexture(cellmap) || Texture.WHITE;
                    mesh.shader = this.getEffectShader(effectTex) as any;
                    // Raw EmitterState.blend_type: 0 = Mix, 1 = Add.
                    mesh.blendMode = blend === 1 ? 'add' : 'normal';
                    // Per-part opacity was folded into the vertex alpha above, so the mesh
                    // alpha only carries the (uniform) parent-chain opacity.
                    mesh.alpha = parentAlpha;
                    mesh.visible = true;
                    this.addChild(mesh);

                    g = h;
                }
            }
        }
    }

    /**
     * Set shader / blend / alpha for a content part and add it to the display
     * list. For masked parts, binds the masked shader (with this context's
     * coverage + writer metadata) and fills the per-vertex coverage UVs; for
     * unmasked parts, the plain PartsColor shader.
     *
     * `alpha` here is the PARENT-CHAIN opacity only (parentAlpha). The part's own
     * hierarchical alpha (state.alpha()) is carried per-vertex in aColor.a by the
     * GeometryBuilder — pre-multiplied into parts_color by the runtime, or written
     * directly for the default path — and the shader's output alpha is
     * texColor.a * vColor.a. Folding state.alpha() into mesh.alpha here as well
     * would double-apply it (10_parts_color §1-3).
     */
    private finishPart(
        mesh: Mesh<any>,
        numVerts: number,
        masked: boolean,
        maskRank: number,
        maskMode: number,
        cov: MaskCoverage | null,
        texture: Texture,
        blendMode: any,
        alpha: number,
        ssShader: Shader | null = null
    ): void {
        if (masked && cov) {
            // maskMode = visible_inside_mask: show inside (1) vs outside (0).
            this.fillMaskUV(mesh, numVerts, maskRank, maskMode, cov);
            mesh.shader = this.getMaskedShader(texture, cov) as any;
        } else {
            // SpriteStudio integration shader if the part carries one, else the
            // plain PartsColor shader (masked parts never take a shader — v1).
            mesh.shader = (ssShader ?? this.getPartsColorShader(texture)) as any;
        }
        mesh.blendMode = blendMode;
        mesh.alpha = alpha;
        mesh.visible = true;
        this.addChild(mesh);
    }

    /** Write per-vertex aMaskUV (coverage uv, rank, polarity) for a masked part. */
    private fillMaskUV(mesh: Mesh<any>, numVerts: number, thisRank: number, mode: number, cov: MaskCoverage): void {
        const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
        const buf = mesh.geometry.getBuffer('aMaskUV');
        const muv = buf.data as Float32Array;
        for (let v = 0; v < numVerts; v++) {
            const x = positions[v * 2];
            const y = positions[v * 2 + 1];
            muv[v * 4 + 0] = (x - cov.minX) * cov.invW;
            muv[v * 4 + 1] = (y - cov.minY) * cov.invH;
            muv[v * 4 + 2] = thisRank;
            muv[v * 4 + 3] = mode;
        }
        buf.update();
    }

    /**
     * Rasterise this context's mask contributors (DrawBatchKind.Mask batches)
     * into an offscreen coverage texture using the bit-packed bitmap method
     * (09_mask.ja.md §3-2): each writer gets one bit (0..23) packed into the
     * R/G/B channels via additive blending, cut out by its alpha threshold.
     * Returns the coverage texture, the bbox→UV mapping, and the per-writer
     * metadata replayed by the masked shader; null when there are no active
     * writers. Rendered immediately (we run before the stage render), so the
     * texture is ready when masked content samples it.
     */
    private buildMaskCoverage(
        manager: SSRuntimeManager,
        geometryBuilder: GeometryBuilder,
        frameData: FrameData,
        drawOrder: Uint16Array
    ): MaskCoverage | null {
        const slot = this.activeRTs;
        const covObj = this.ensureCov(slot);

        // Engine-agnostic planning (core): select writers, classify OP / scope /
        // clipping, resolve cutout threshold + geometry kind, assign coverage
        // bits and the replay meta. This class only rasterises the plan below.
        const planner = this.maskPlanner;
        this.maskSource.bind(frameData, drawOrder, manager);
        const count = planner.plan(this.maskSource);
        if (count === 0) return null;
        if (planner.exceeded && !this.maskWritersExceeded) {
            this.maskWritersExceeded = true;
            console.warn(`[SSPlayer] mask writers exceeded ${MAX_MASK_WRITERS}; extra masks ignored.`);
        }

        const root = this.maskRenderRoot;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Rasterise each planned writer into the coverage bitmap: its geometry,
        // with its coverage bit pre-encoded into one R/G/B channel and its cutout
        // threshold in aVarg.x, additive-blended so disjoint bits OR together
        // (09_mask.ja.md §3-2). Cutout texture comes from the planner's
        // DrawBatch.textureHash (0 = pure mask/shape → no cutout, geometry is the mask).
        for (let w = 0; w < count; w++) {
            const partIdx = planner.partIdx[w];
            const geomKind = planner.geomKind[w];
            const numVerts = planner.numVerts[w];
            const numIndices = planner.numIndices[w];
            const texHash = planner.textureHash[w];
            const threshold = planner.threshold[w];
            const bit = planner.bit[w];

            const texture = texHash !== 0 ? (this.pixiResourceManager.getTexture(texHash) || Texture.WHITE) : Texture.WHITE;
            const invTexW = 1.0 / texture.width;
            const invTexH = 1.0 / texture.height;

            const mesh = this.acquireMesh(this.maskMeshPool, this.activeMaskMeshes++, numVerts, numIndices, false);
            const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
            const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
            const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
            const vargs = mesh.geometry.getBuffer('aVarg').data as Float32Array;

            if (geomKind === 1) {
                const indices = mesh.geometry.getIndex().data as Uint32Array;
                geometryBuilder.buildShape(partIdx, frameData, numVerts, invTexW, invTexH, positions, uvs, colors, vargs, indices);
                mesh.geometry.getIndex().update();
            } else if (geomKind === 2) {
                const indices = mesh.geometry.getIndex().data as Uint32Array;
                geometryBuilder.buildMesh(partIdx, frameData, numVerts, numIndices, invTexW, invTexH, positions, uvs, colors, vargs, indices);
                mesh.geometry.getIndex().update();
            } else {
                geometryBuilder.buildNormal(partIdx, frameData, invTexW, invTexH, positions, uvs, colors, vargs);
            }

            // Pre-encode this writer's bit into aColor (one R/G/B channel) and its
            // cutout threshold into aVarg.x; accumulate the bbox.
            const chan = (bit / 8) | 0;
            const bitVal = (1 << (bit % 8)) / 255;
            const br = chan === 0 ? bitVal : 0;
            const bg = chan === 1 ? bitVal : 0;
            const bb = chan === 2 ? bitVal : 0;
            for (let v = 0; v < numVerts; v++) {
                colors[v * 4 + 0] = br; colors[v * 4 + 1] = bg; colors[v * 4 + 2] = bb; colors[v * 4 + 3] = 1;
                vargs[v * 4 + 0] = threshold;
                const x = positions[v * 2], y = positions[v * 2 + 1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
            mesh.geometry.getBuffer('aPosition').update();
            mesh.geometry.getBuffer('aUV').update();
            mesh.geometry.getBuffer('aColor').update();
            mesh.geometry.getBuffer('aVarg').update();

            mesh.shader = this.getMaskWriteShader(texture) as any;
            mesh.blendMode = 'add';
            mesh.alpha = 1;
            mesh.visible = true;
            root.addChild(mesh);
        }

        // The planner's `meta` is reusable scratch (overwritten by the next
        // plan() — e.g. an instance child's). Copy it into the pooled per-slot
        // record so an inheriting child (§3-2-2) can replay this coverage at draw
        // time, after the child's own plan() has run.
        covObj.meta.set(planner.meta);

        // Pad 1px so the mask's own edge texels aren't clipped; guard degeneracy.
        minX -= 1; minY -= 1; maxX += 1; maxY += 1;
        let boxW = maxX - minX;
        let boxH = maxY - minY;
        if (boxW < 1) boxW = 1;
        if (boxH < 1) boxH = 1;

        const rt = this.acquireCoverageRT(slot, boxW, boxH);

        // Map the bbox onto the full RT: (minX,minY) → pixel (0,0), (maxX,maxY)
        // → (rtW,rtH). The masked shader's coverage uv = (pos - min) / box ∈ [0,1].
        // The container passed to renderer.render() is a render-group root whose
        // OWN transform is ignored, so the bbox mapping must go through the
        // RenderOptions `transform` instead of root.scale/position.
        const sx = rt.width / boxW;
        const sy = rt.height / boxH;
        this.scratchCovTransform.set(sx, 0, 0, sy, -minX * sx, -minY * sy);

        this.renderer!.render({ container: root, target: rt, clear: true, clearColor: [0, 0, 0, 0], transform: this.scratchCovTransform });
        root.removeChildren();

        covObj.rt = rt;
        covObj.minX = minX;
        covObj.minY = minY;
        covObj.invW = 1 / boxW;
        covObj.invH = 1 / boxH;
        covObj.count = count;
        this.activeRTs = slot + 1;
        return covObj;
    }

    /** Pooled MaskCoverage record for a context slot (its meta array is reused). */
    private ensureCov(slot: number): MaskCoverage {
        let c = this.covPool[slot];
        if (!c) {
            c = { rt: null as any, minX: 0, minY: 0, invW: 0, invH: 0, meta: new Float32Array(MAX_MASK_WRITERS * 4), count: 0 };
            this.covPool[slot] = c;
        }
        return c;
    }

    /** Pooled offscreen coverage texture for a slot, resized (pow2, clamped) as needed. */
    private acquireCoverageRT(slot: number, boxW: number, boxH: number): RenderTexture {
        const qw = SSPlayer.quantizeMaskSize(boxW);
        const qh = SSPlayer.quantizeMaskSize(boxH);
        let rt = this.rtPool[slot];
        if (!rt) {
            rt = RenderTexture.create({ width: qw, height: qh, scaleMode: 'nearest', antialias: false });
            this.rtPool[slot] = rt;
        } else if (rt.width !== qw || rt.height !== qh) {
            rt.resize(qw, qh);
        }
        return rt;
    }

    // Coverage resolution: 1:1 with the bbox, rounded up to a power of two and
    // clamped to [64, 1024] per axis (09_mask.ja.md §3-2 sizing note).
    private static quantizeMaskSize(v: number): number {
        let s = Math.ceil(v);
        if (s < 64) s = 64;
        if (s >= 1024) return 1024;
        let p = 64;
        while (p < s) p <<= 1;
        return p;
    }

    private getMaskWriteShader(texture: Texture): Shader {
        let shader = this.maskWriteShaders.get(texture);
        if (!shader) {
            shader = Shader.from({
                gl: MaskWriteShader,
                gpu: MaskWriteShaderWGSL,
                resources: {
                    uTexture: texture.source,
                    uTextureSampler: texture.source.style
                }
            });
            this.maskWriteShaders.set(texture, shader);
        }
        return shader;
    }

    private getMaskedShader(texture: Texture, cov: MaskCoverage): Shader {
        const key = `${(texture.source as any).uid}_${(cov.rt.source as any).uid}`;
        let shader = this.maskedShaders.get(key);
        if (!shader) {
            const maskUniforms = new UniformGroup({
                uMaskMeta: { value: new Float32Array(MAX_MASK_WRITERS * 4), type: 'vec4<f32>', size: MAX_MASK_WRITERS },
                uMaskCount: { value: 0, type: 'f32' }
            });
            shader = Shader.from({
                gl: MaskedPartsColorShader,
                gpu: MaskedPartsColorShaderWGSL,
                resources: {
                    uTexture: texture.source,
                    uTextureSampler: texture.source.style,
                    uMaskTexture: cov.rt.source,
                    uMaskSampler: cov.rt.source.style,
                    maskUniforms
                }
            });
            this.maskedShaders.set(key, shader);
        }
        // Refresh this context's writer metadata (changes every frame).
        const mu = shader.resources.maskUniforms as UniformGroup;
        (mu.uniforms.uMaskMeta as Float32Array).set(cov.meta);
        mu.uniforms.uMaskCount = cov.count;
        mu.update();
        return shader;
    }

    private getMeshFromPool(index: number, requiredVertices: number = 5, requiredIndices: number = 12): Mesh {
        return this.acquireMesh(this.meshPool, index, requiredVertices, requiredIndices, false);
    }

    private acquireMesh(pool: Mesh<any>[], index: number, requiredVertices: number, requiredIndices: number, withMaskUV: boolean): Mesh {
        if (index < pool.length) {
            let m = pool[index];
            const pBuf = m.geometry.getBuffer('aPosition');
            const iBuf = m.geometry.getIndex();
            if (pBuf.data.length !== requiredVertices * 2 || iBuf.data.length !== requiredIndices) {
                m.destroy({ children: true, texture: false, textureSource: false });
                m = this.createNewMesh(requiredVertices, requiredIndices, withMaskUV);
                pool[index] = m;
            }
            if (requiredIndices === 12) {
                const indices = m.geometry.getIndex().data as Uint32Array;
                indices[0] = 0; indices[1] = 1; indices[2] = 4;
                indices[3] = 1; indices[4] = 3; indices[5] = 4;
                indices[6] = 3; indices[7] = 2; indices[8] = 4;
                indices[9] = 2; indices[10] = 0; indices[11] = 4;
            }
            (m as any).size = requiredIndices; // Tell PixiJS how many indices to draw
            return m;
        }

        const m = this.createNewMesh(requiredVertices, requiredIndices, withMaskUV);
        (m as any).size = requiredIndices;
        pool.push(m);
        return m;
    }

    private createNewMesh(requiredVertices: number, requiredIndices: number, withMaskUV: boolean = false): Mesh<any> {
        const positionsBuffer = new Buffer({
            data: new Float32Array(requiredVertices * 2),
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
        });
        const uvsBuffer = new Buffer({
            data: new Float32Array(requiredVertices * 2),
            usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
        });
        const indicesBuffer = new Buffer({
            data: new Uint32Array(requiredIndices),
            usage: BufferUsage.INDEX | BufferUsage.COPY_DST
        });

        const geometry = new Geometry();
        geometry.addAttribute('aPosition', { buffer: positionsBuffer, size: 2 });
        geometry.addAttribute('aUV', { buffer: uvsBuffer, size: 2 });
        geometry.addIndex(indicesBuffer);

        geometry.addAttribute('aColor', {
            buffer: new Buffer({
                data: new Float32Array(requiredVertices * 4),
                usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
            }),
            size: 4
        } as any);
        geometry.addAttribute('aVarg', {
            buffer: new Buffer({
                data: new Float32Array(requiredVertices * 4),
                usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
            }),
            size: 4
        } as any);

        // Masked-content meshes carry an extra per-vertex attribute (coverage
        // uv + rank + polarity) consumed by MaskedPartsColorShader at location 4.
        if (withMaskUV) {
            geometry.addAttribute('aMaskUV', {
                buffer: new Buffer({
                    data: new Float32Array(requiredVertices * 4),
                    usage: BufferUsage.VERTEX | BufferUsage.COPY_DST
                }),
                size: 4
            } as any);
        }

        if (requiredIndices === 12) {
            const indices = geometry.getIndex().data as Uint32Array;
            indices[0] = 0; indices[1] = 1; indices[2] = 4;
            indices[3] = 1; indices[4] = 3; indices[5] = 4;
            indices[6] = 3; indices[7] = 2; indices[8] = 4;
            indices[9] = 2; indices[10] = 0; indices[11] = 4;
        }

        const mesh = new Mesh({
            geometry: geometry
        });

        return mesh as Mesh<any>;
    }


}
