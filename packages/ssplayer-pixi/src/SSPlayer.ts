import { Container, Mesh, Geometry, Texture, Ticker, Text, Shader, Buffer, BufferUsage, RenderTexture, UniformGroup, Matrix, type Renderer } from 'pixi.js';
import { DirectInternalPlayer, type InstanceChildState, DrawBatch, DrawBatchKind, GeometryBuilder, SSRuntimeManager, FrameData, FrameDataRaw, MaskPlanner, FrameDataMaskSource, InstanceResolver, EffectBatchPlanner, ShaderAttributeResolver, ssBlendMode, MAX_MASK_WRITERS, initializeWasm, getWasmMemory, WebPlaybackDirection, WebPlaybackStyle, ssFormat, IAudioManager, SSBlendOp, SSOverridePriority, SSPartFollower, type SSPartFollowOptions, type SSPartAttachment as SSPartAttachmentOf, composeVisibleInside, ROOT_MASK_INFLUENCE, ROOT_VISIBLE_INSIDE } from '@spritestudio/ssplayer-core';
import { SSWebAudioManager } from '@spritestudio/ssplayer-core/audio';
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
import { SS_MIX_BLEND, SS_ADD_BLEND, SS_BLEND_MODE_NAMES, registerSSBlendModesGL } from './SSBlendModes.js';

// MAX_MASK_WRITERS is defined alongside the planner in ssplayer-core.

// --- Animation event payloads ---
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
    /**
     * The frame the key is authored on — not necessarily the frame it was
     * noticed on, since one tick can step across several.
     */
    frameNo: number;
    integer?: number;
    str?: string;
    /** User-data rectangle as authored (left/top/right/bottom). */
    rect?: { left: number; top: number; right: number; bottom: number };
    /** User-data point as authored. */
    point?: { x: number; y: number };
}

/**
 * A signal event fired by a part. `params` maps each command parameter id to
 * its authored value (bool / int / float / string). Only **active** signals are
 * dispatched (mirroring the Godot / Unity players).
 */
export interface SSSignalEvent {
    partIndex: number;
    partName: string | null;
    /**
     * The frame the key is authored on — not necessarily the frame it was
     * noticed on, since one tick can step across several.
     */
    frameNo: number;
    active: boolean;
    commandId: string | null;
    params: Record<string, boolean | number | string>;
}

/**
 * An audio event fired by a part: the SSAB sound reference (hashes + alias
 * name) plus loop count. The runtime plays no audio — the host resolves the
 * sound and plays it on its own audio engine.
 */
export interface SSAudioEvent {
    partIndex: number;
    partName: string | null;
    /**
     * The frame the key is authored on — not necessarily the frame it was
     * noticed on, since one tick can step across several.
     */
    frameNo: number;
    soundListNameHash: number;
    soundNameHash: number;
    soundName: string | null;
    loopNum: number;
}

/** Unsubscribe handle returned by the `onX` event-registration methods. */
export type Unsubscribe = () => void;

/**
 * A live part attachment created by {@link SSPlayer.attachToPart}: `target`
 * follows the part each frame until {@link detach} (or `detachFromPart`) is
 * called. Re-export of the follow options lives in ssplayer-core
 * ({@link SSPartFollowOptions}).
 */
export type SSPartAttachment = SSPartAttachmentOf<Container>;

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

// Mask context an instance part hands to the sub-animation it calls.
// The caller's settings do NOT replace the
// callee's — they COMPOSE: `mask_influence` with AND, `visible_inside_mask`
// with OR. Every part in the sub-animation then resolves its own role against
// the composed value, so a caller can never silently discard what a callee part
// asked for (nor the other way round). Because each level passes an already
// composed value down, nesting chains with no extra bookkeeping.
//
// A fallback of the shape "the callee wins if it has its own setting, otherwise
// inherit the caller's" is NOT equivalent to either operator and disagrees with
// SpriteStudio 7.5 in both directions — that was the defect this replaced.
interface InheritedMask {
    // Ancestor coverage the sub-animation clips against, or null when no mask
    // reaches it (the child then falls back to its own coverage, if it has one).
    cov: MaskCoverage | null;
    // Rank of the instance part in the draw order of whoever OWNS `cov`. The
    // scope test is judged at the instance part's slot, not the child
    // part's, because that is where the sub-animation sits in the caller.
    rank: number;
    // Composed caller-chain values. `influence: false` is absorbing: once a
    // caller is not a mask target, nothing below it is either.
    influence: boolean;
    visibleInside: boolean;
}

export class SSPlayer extends Container {
    public static async initialize(wasmUrl?: string | URL) {
        await initializeWasm(wasmUrl);
    }

    public readonly internalPlayer: DirectInternalPlayer;

    private meshPool: Mesh<any>[] = [];
    private activeMeshes: number = 0;

    // Reused per-frame scratch so the render hot path allocates nothing: a
    // zero-copy raw reader for the FlatBuffers struct vectors (bypasses the
    // per-element accessors) and a reused DrawBatch
    // accessor. The raw reader is bound via its `*Of(frameData, …)` helpers at
    // each read so it stays correct across instance-child recursion (which
    // rebinds it) and re-fetches.
    private readonly _raw = new FrameDataRaw();
    private readonly _scratchBatch = new DrawBatch();
    // Engine-agnostic `SHDR` read (core), shared with ssplayer-webgl: program id,
    // param0..7 and the cell UV rect derived from the quad's corners.
    private readonly _shaderAttr = new ShaderAttributeResolver();
    // Engine-agnostic per-instance-part resolution (core), shared with
    // ssplayer-webgl: slot visibility, alpha, composed placement, mask
    // context and the child's subframe-aware playhead. Only the drawing that
    // follows is ours. Its record is reused across calls (including across the
    // recursion), so each call site reads out what it needs immediately.
    private readonly _instanceResolver = new InstanceResolver<DirectInternalPlayer>();

    // Pooled InheritedMask, one per instance-recursion depth (a child holds its own
    // while ours stays live up the stack) — see inheritedAtDepth.
    private readonly _inheritedPool: InheritedMask[] = [];
    private _depth = 0;

    // Engine-agnostic Effect batching (core), shared with ssplayer-webgl: which
    // particle commands draw, and which neighbours merge into one draw call by
    // (cellmap, blend). Issuing that draw call is ours. Pooled, so steady-state
    // rendering allocates nothing.
    private readonly _fx = new EffectBatchPlanner<DirectInternalPlayer>();

    private pixiResourceManager: PixiResourceManager;
    private debugText: Text;

    // --- Animation event listeners ---
    private readonly _userDataListeners = new Set<(e: SSUserDataEvent) => void>();
    private readonly _signalListeners = new Set<(e: SSSignalEvent) => void>();
    private readonly _audioListeners = new Set<(e: SSAudioEvent) => void>();
    private readonly _animStartedListeners = new Set<() => void>();
    private readonly _animFinishedListeners = new Set<() => void>();
    private readonly _animLoopedListeners = new Set<() => void>();
    private readonly _frameListeners = new Set<(frame: number) => void>();

    // --- Part following (part-following) ---
    // Targets driven to follow a part each frame. `_attachmentLayer` holds the
    // targets attached with addAsChild (the default): renderFrame() clears our
    // children every frame, so the layer is re-added and driven at the end of
    // renderFrame() — after the meshes, so followers draw on top.
    private readonly _attachmentLayer = new Container();
    private readonly _attachMatrix = new Matrix();
    // The bookkeeping (who follows what, did we hide it, detach ordering) is
    // core's, shared with ssplayer-rmmz which had the same code; only the write
    // onto a Pixi object below is engine-specific.
    private readonly _follower = new SSPartFollower<Container>(
        { 
            findPartIndex: (n) => this.internalPlayer.findPartIndex(n),
            isPartHidden: (p) => this.internalPlayer.isPartHidden(p),
            getPartTransform: (p, out) => this.internalPlayer.getPartTransform(p, out),
        },
        {
            addChild: (t) => { this._attachmentLayer.addChild(t); },
            removeChild: (t) => { if (t.parent === this._attachmentLayer) this._attachmentLayer.removeChild(t); },
            setVisible: (t, v) => { t.visible = v; },
            applyAffine: (t, affine) => {
                // Pixi Matrix is (a, b, c, d, tx, ty) = (m00, m10, m01, m11, tx, ty).
                this._attachMatrix.set(affine[0], affine[2], affine[1], affine[3], affine[4], affine[5]);
                t.setFromMatrix(this._attachMatrix);
            },
            applyDecomposed: (t, d, axes) => {
                if (axes.position) t.position.set(d.x, d.y);
                if (axes.rotation) t.rotation = d.rotation;
                if (axes.scale) t.scale.set(d.scaleX, d.scaleY);
            },
        },
    );

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

    // --- Mask coverage state ---
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
    // Carry-over scratch: the running coverage bbox shared by every baked
    // writer, and a pooled candidate list of visible instance children whose
    // clipping writers are carried up into this context's coverage.
    private readonly _covBBox = new Float32Array(4);
    private readonly _bubbleCands: { rank: number; child: InstanceChildState<DirectInternalPlayer>; influence: boolean; composed: Float32Array }[] = [];
    private _bubbleCount = 0;
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
    /**
     * Sub-frame interpolation: evaluate the timeline at fractional frames rather
     * than snapping to integers (on by default). Pairs with
     * {@link frameSkipEnabled} — turning frame skipping off without turning this
     * off too leaves the playhead advancing fractionally, so the timing drifts.
     */
    public get subFrameEnabled(): boolean {
        return this.internalPlayer.subFrameEnabled;
    }

    public set subFrameEnabled(value: boolean) {
        this.internalPlayer.subFrameEnabled = value;
    }
    
    public get speedScale(): number {
        return this.internalPlayer.getSpeedScale();
    }
    public set speedScale(speed: number) {
        this.internalPlayer.setSpeedScale(speed);
    }

    /**
     * Mirror the drawn animation horizontally.
     *
     * This is deliberately not the same as `player.scale.x = -1`. It mirrors what
     * this player draws and nothing else: our own Container transform is
     * untouched, so targets attached with {@link attachToPart} — and any other
     * child a host has parented onto us — are not mirrored along with the
     * artwork. They still FOLLOW the mirrored pose, because
     * {@link getPartTransform} reports it.
     *
     * Reach for `scale.x` instead when you do want the whole subtree mirrored.
     */
    public get flipX(): boolean {
        return this.internalPlayer.flipX;
    }
    public set flipX(value: boolean) {
        this.internalPlayer.flipX = value;
    }

    /** Mirror the drawn animation vertically. See {@link flipX}. */
    public get flipY(): boolean {
        return this.internalPlayer.flipY;
    }
    public set flipY(value: boolean) {
        this.internalPlayer.flipY = value;
    }

    /**
     * Shift the drawn animation horizontally, in animation-local pixels, without
     * moving this Container — so the artwork can sit off its authored origin
     * while our own position keeps marking the logical spot. Applied after
     * {@link flipX}, so flipping does not mirror the offset itself.
     */
    public get offsetX(): number {
        return this.internalPlayer.offsetX;
    }
    public set offsetX(value: number) {
        this.internalPlayer.offsetX = value;
    }

    /** Shift the drawn animation vertically (Y-down). See {@link offsetX}. */
    public get offsetY(): number {
        return this.internalPlayer.offsetY;
    }
    public set offsetY(value: number) {
        this.internalPlayer.offsetY = value;
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
        // Engine-agnostic read (core), shared with ssplayer-webgl: the program's
        // id, its eight parameters, and the cell UV rect derived from the quad's
        // corners. Binding them to a UniformGroup is ours.
        if (!this._shaderAttr.resolve(frameData, shaderIdx, uvs)) return null;
        const shader = this.acquireSsShader(this._shaderAttr.idHash, texture);
        if (!shader) return null;

        const u = (shader.resources.ssUniforms as UniformGroup).uniforms;
        (u.uParams as Float32Array).set(this._shaderAttr.params);
        (u.uCellRect as Float32Array).set(this._shaderAttr.cellRect);

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
        // the time our masked children are drawn. Until then the pre-pass cannot
        // run, so the parts a mask would clip are held back for that one frame
        // rather than flashing unclipped — see renderContext. Call
        // {@link attachRenderer} to have masks correct from the very first frame.
        this.onRender = (renderer: Renderer) => {
            this.attachRenderer(renderer);
        };

        Ticker.shared.add(this.update, this);
    }
    
    /**
     * Hand the player its renderer before it is first drawn.
     *
     * The mask coverage pre-pass rasterises into offscreen textures, so it needs
     * a renderer; the player otherwise only learns of one when it is first drawn
     * (`onRender`), which is one frame too late for that frame's masks. A player
     * added to a stage and drawn straight away therefore holds its masked parts
     * back for exactly one frame. Pass the renderer here — right after
     * construction — and masking is correct from the first frame:
     *
     * ```ts
     * const player = new SSPlayer();
     * player.attachRenderer(app.renderer);
     * ```
     *
     * Idempotent, and harmless to call with a renderer the player is already
     * using. If the player is later drawn by a different renderer, `onRender`
     * replaces this one. Nothing else needs it: an animation without masks
     * renders identically either way.
     */
    public attachRenderer(renderer: Renderer) {
        if (this.renderer === renderer) return;
        this.renderer = renderer;
        // WebGL: register the SS fixed-function blend modes into this renderer's
        // blend map (idempotent; no-op on WebGPU, handled at import time).
        registerSSBlendModesGL(renderer);
    }

    public override destroy(options?: any) {
        Ticker.shared.remove(this.update, this);

        // Detach followers (removes them from our layer and restores any
        // visibility we changed) so destroying the player never destroys or
        // hides a target the host still owns, then free the now-empty layer.
        this._follower.detachAll();
        this._attachmentLayer.destroy({ children: false });

        if (this.internalPlayer) {
            this.internalPlayer.destroy();
        }
        // The shaders and pooled meshes first: they hold the textures and mask
        // render targets freed below, and PixiJS warns for every one freed while
        // still bound.
        this.releaseTextureBindings();
        // Free this instance's owned (embedded-mode) textures; never invoked
        // before, so those textures leaked on every player teardown.
        this.pixiResourceManager.destroy();
        for (const rt of this.rtPool) rt.destroy(true);
        this.rtPool.length = 0;

        super.destroy(options);
    }
    
    public setDebugVisible(visible: boolean) {
        this.debugText.visible = visible;
    }

    /**
     * Loads the SSAB file and its associated textures. Textures resolve relative
     * to the .ssab's own location (the structure ssconverter emits).
     * @param ssabUrl URL to the .ssab file
     */
    public async load(ssabUrl: string) {
        this.releaseTextureBindings();
        await this.internalPlayer.load(ssabUrl);
        this.configureContext();
        await this.ensureAutoAudio();
    }

    /**
     * Drop everything still holding the previous pack's `TextureSource`s, so the
     * ResourceManager can free them when the core resets it on `bindResource`.
     * The shader caches are keyed by `Texture` and a pooled mesh keeps the
     * shader it was last drawn with, so freeing a texture out from under either
     * is a crash, not a leak.
     */
    private releaseTextureBindings() {
        for (const s of this.partsColorShaders.values()) s.destroy();
        for (const s of this.effectShaders.values()) s.destroy();
        for (const s of this.maskWriteShaders.values()) s.destroy();
        for (const s of this.maskedShaders.values()) s.destroy();
        for (const pool of this.ssShaderPools.values()) for (const s of pool) s.destroy();
        this.partsColorShaders.clear();
        this.effectShaders.clear();
        this.maskWriteShaders.clear();
        this.maskedShaders.clear();
        this.ssShaderPools.clear();

        for (const m of this.meshPool) m.destroy({ children: true, texture: false, textureSource: false });
        for (const m of this.maskedMeshPool) m.destroy({ children: true, texture: false, textureSource: false });
        for (const m of this.maskMeshPool) m.destroy({ children: true, texture: false, textureSource: false });
        this.meshPool.length = 0;
        this.maskedMeshPool.length = 0;
        this.maskMeshPool.length = 0;
        this.activeMeshes = 0;
    }

    /**
     * Load a pack from bytes already in memory, with its textures supplied by
     * cell-map hash — for packs that are not URL-addressable (drag-and-drop, an
     * in-memory bundle). The counterpart of `load()`, and the same signature
     * `ssplayer-webgl` takes. Each texture may be a URL, the encoded bytes of an
     * image (PNG/JPEG), or a decoded image source.
     *
     * @param ssab The `.ssab` bytes.
     * @param textures Cell-map name hash → URL / encoded bytes / image source.
     */
    public async loadBuffer(
        ssab: ArrayBuffer | Uint8Array,
        textures: Map<number, ImageBitmap | HTMLImageElement | HTMLCanvasElement | ArrayBuffer | Uint8Array | string>,
    ): Promise<void> {
        this.releaseTextureBindings();
        this.internalPlayer.bindResource(new Uint8Array(ssab));
        this.configureContext();
        for (const [hash, src] of textures.entries()) {
            if (typeof src === 'string') {
                await this.pixiResourceManager.loadTexture(src, hash);
            } else if (src instanceof ArrayBuffer || src instanceof Uint8Array) {
                await this.pixiResourceManager.loadTextureFromBytes(src instanceof ArrayBuffer ? new Uint8Array(src) : src, hash);
            } else {
                this.pixiResourceManager.bindTextureSource(src, hash);
            }
        }
        // Finish the pack's asset load here, like `load()` does, so `setAnimation`
        // stays a pure runtime switch. Textures the caller just supplied are already
        // in the manager under their hash and are not fetched again; this resolves
        // what the caller could not — embedded textures and instance packs.
        await this.internalPlayer.prepareResources();
        await this.ensureAutoAudio();
    }

    private configureContext() {
        this.internalPlayer.runtimeManager.context.set_render_mode(0); // 0 corresponds to RenderMode::Direct
        this.internalPlayer.runtimeManager.context.set_coordinate_system(1); // 1 = YDown
    }

    /**
     * Lazy initialize the audio manager only if the loaded SSAB contains sounds,
     * so that projects without audio don't waste resources creating AudioContexts.
     */
    private async ensureAutoAudio() {
        const sounds = this.internalPlayer.runtimeManager.getSounds();
        if (sounds.length > 0 && !this.audioManager) {
            // bindToPlayer sets `this.audioManager` and subscribes onAudio → play.
            new SSWebAudioManager().bindToPlayer(this);
            // Attaching starts the preload; finish it here so `load()` still means
            // "everything this pack needs is in memory" and setAnimation stays sync.
            await this.internalPlayer.preloadSounds();
        }
    }

    /**
     * Select an animation. Synchronous: `load()` has already brought in the
     * pack's textures, instance packs and sounds, so a switch is a runtime reset.
     *
     * Playback settings are separate properties — set {@link loopCount} after
     * this, the way the Godot / Unity players do it.
     */
    /**
     * Every animation in the bound pack, in the order the `.ssab` lists them.
     *
     * The names {@link setAnimation} takes, so a host can check one before
     * calling rather than finding out at play time. Read out of the pack when it
     * is bound, so this costs no second read of the `.ssab`.
     */
    public getAnimationNames(): readonly string[] {
        return this.internalPlayer.animationNames;
    }

    public setAnimation(animationName: string): void {
        this.internalPlayer.setAnimation(animationName);
    }

    public get currentAnimation(): string {
        return this.internalPlayer.currentAnimation;
    }

    public play(startFrame: number = -1) {
        this.internalPlayer.play(startFrame);
        this._animStartedListeners.forEach(cb => cb());
    }

    public pause() {
        this.internalPlayer.pause();
    }

    /**
     * Ends playback. The playhead **stays where it stands** — nothing rewinds, so
     * the sprite keeps drawing the frame it stopped on. `play()` is what returns
     * to the head; `setFrameNo()` seeks anywhere else.
     */
    public stop() {
        this.internalPlayer.stop();
    }
    
    public resume() {
        this.internalPlayer.resume();
    }

    public get frameNo(): number {
        return this.internalPlayer.getFrameNo();
    }

    public set frameNo(value: number) {
        this.internalPlayer.setFrameNo(value);
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

    public get frameRate(): number {
        return this.internalPlayer.getFrameRate();
    }

    public set frameRate(value: number) {
        this.internalPlayer.setFrameRate(value);
    }

    public get isPlaying(): boolean {
        return this.internalPlayer.isPlaying;
    }

    /**
     * Whether the last {@link update} crossed a loop boundary. A **pulse**, true
     * only inside the tick that crossed — take {@link onAnimationLooped} instead if
     * you would rather have it delivered than polled.
     */
    public get justLooped(): boolean {
        return this.internalPlayer.justLooped;
    }

    public get isPausing(): boolean {
        return this.internalPlayer.isPausing;
    }

    /**
     * Whether every configured loop has played.
     *
     * A **state**, not a pulse: it latches on completion and stays true until
     * the next {@link play} or {@link setAnimation}. Never true under an
     * infinite loop count, and **not raised by {@link stop}** — so unlike
     * `!isPlaying` it tells a run that ended on its own apart from one that was
     * stopped. Take {@link onAnimationFinished} for the one-shot edge.
     */
    public get isFinished(): boolean {
        return this.internalPlayer.isFinished;
    }

    /**
     * Whether the playhead is walking forwards right now — the instantaneous
     * heading, so a ping-pong on its return leg reads false while
     * {@link getPlaybackDirection} still reads Forward.
     *
     * Gate an audio backend on this: SpriteStudio has no reverse audio, so
     * {@link onAudio} still reports every key it crosses (as the Godot and Unity
     * players do) and it is the *playing* that has to be suppressed.
     */
    public get isPlayingForward(): boolean {
        return this.internalPlayer.isPlayingForward;
    }

    public setAnimationSection(startFrame: number, endFrame: number) {
        this.internalPlayer.setAnimationSection(startFrame, endFrame);
    }

    public setPlaybackDirection(direction: WebPlaybackDirection, style: WebPlaybackStyle) {
        this.internalPlayer.setPlaybackDirection(direction, style);
    }

    /** The configured heading — not the instantaneous one, which is {@link isPlayingForward}. */
    public getPlaybackDirection(): WebPlaybackDirection {
        return this.internalPlayer.getPlaybackDirection();
    }

    /** What the playhead does at the far end of the section. */
    public getPlaybackStyle(): WebPlaybackStyle {
        return this.internalPlayer.getPlaybackStyle();
    }

    public get loopCount(): number {
        return this.internalPlayer.getLoopCount();
    }

    public set loopCount(value: number) {
        this.internalPlayer.setLoopCount(value);
    }

    public get frameSkipEnabled(): boolean {
        return this.internalPlayer.isFrameSkipEnabled();
    }

    public set frameSkipEnabled(value: boolean) {
        this.internalPlayer.setFrameSkipEnabled(value);
    }

    /**
     * Part names in part-index order, empty before an animation is set up.
     *
     * A part authored without a name reads as the empty string, so the list
     * stays aligned with the `partIndex` every event carries. `length` is the
     * part count — there is no separate accessor for it.
     */
    public getPartNames(): string[] {
        return this.internalPlayer.getPartNames();
    }

    // --- Part following: transform read-out ---
    // Pull API for following a part by hand (place your own object, or drive a
    // DOM overlay). For a managed follower use attachToPart below. See the core
    // player (InternalPlayerBase.getPartTransform) for the contract.

    /**
     * The part's current-frame transform as a 2D affine `[m00, m01, m10, m11,
     * tx, ty]` in animation-local (Y-down) space — the space this Container draws
     * its parts in, so an object placed under the player lands on the part. Null
     * when the part is unknown. Pass `out` (a `Float32Array(6)`) to avoid
     * allocation. Read it after a frame has advanced (e.g. from `onFrame`).
     */
    public getPartTransform(part: number | string, out?: Float32Array): Float32Array | null {
        return this.internalPlayer.getPartTransform(part, out);
    }

    /** Whether the part is hidden on the current frame (animation `hide`), or null if unknown. */
    public isPartHidden(part: number | string): boolean | null {
        return this.internalPlayer.isPartHidden(part);
    }

    /**
     * Whether the part is a skinned (bone-bound) mesh, or null if unknown. Such a
     * part is a poor {@link attachToPart} target: its node transform sits near the
     * character root, not on the drawn mesh. Follow a NULL / bone / joint part
     * placed there instead. Following is not blocked — this only flags the target.
     */
    public isPartSkinnedMesh(part: number | string): boolean | null {
        return this.internalPlayer.isPartSkinnedMesh(part);
    }

    // --- Part overrides ---
    //
    // Thin pass-throughs to the core player, which owns the contract (see
    // InternalPlayerBase): part is a name or an index, false means the part is
    // unknown or the runtime rejected the call, and the runtime keeps the
    // override itself — nothing is re-applied per frame here.
    //
    // The one renderer-side concern is that update() early-returns while the
    // player is stopped, so a change made then would not reach the screen until
    // playback resumed. Each successful call therefore re-renders the current
    // frame, which is this player's equivalent of invalidating a frame cache.

    /** Resolve a part name to its index, or -1 if the part is not in the current animation. */
    public findPartIndex(partName: string): number {
        return this.internalPlayer.findPartIndex(partName);
    }

    /** Force-hide a part (or revert it to the animation), optionally cascading to its descendants. */
    public setPartVisibilityOverride(part: number | string, hide: boolean, cascade: boolean = false): boolean {
        return this.afterOverride(this.internalPlayer.setPartVisibilityOverride(part, hide, cascade));
    }

    /** Clear a part's visibility override (revert it to the animation). */
    public clearPartVisibilityOverride(part: number | string): boolean {
        return this.afterOverride(this.internalPlayer.clearPartVisibilityOverride(part));
    }

    /** Override a Normal part's colour with a single `0xRRGGBBAA` value (all four corners). */
    public setPartColorOverride(
        part: number | string,
        rgba: number,
        blendOp: SSBlendOp = SSBlendOp.Mix,
        priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
    ): boolean {
        return this.afterOverride(this.internalPlayer.setPartColorOverride(part, rgba, blendOp, priority));
    }

    /** Override a Normal part's colour with four `0xRRGGBBAA` corners (left-top, right-top, left-bottom, right-bottom). */
    public setPartColorOverrideCorners(
        part: number | string,
        corners: readonly [number, number, number, number],
        blendOp: SSBlendOp = SSBlendOp.Mix,
        priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
    ): boolean {
        return this.afterOverride(this.internalPlayer.setPartColorOverrideCorners(part, corners, blendOp, priority));
    }

    /** Clear a part's colour override (revert it to the animation). */
    public clearPartColorOverride(part: number | string): boolean {
        return this.afterOverride(this.internalPlayer.clearPartColorOverride(part));
    }

    /** Make a Normal / mask part draw a different cell, named by its cell map (without .ssce) and cell name. */
    public setPartCellOverride(
        part: number | string,
        cellmapName: string,
        cellName: string,
        priority: SSOverridePriority = SSOverridePriority.HoldUntilNextAnimation,
    ): boolean {
        return this.afterOverride(this.internalPlayer.setPartCellOverride(part, cellmapName, cellName, priority));
    }

    /** Clear a part's cell override (revert it to the animation). */
    public clearPartCellOverride(part: number | string): boolean {
        return this.afterOverride(this.internalPlayer.clearPartCellOverride(part));
    }

    /** Clear every per-part override on this player. */
    public clearAllPartOverrides(): boolean {
        return this.afterOverride(this.internalPlayer.clearAllPartOverrides());
    }

    /** Cell-map names in the loaded .ssab (for discovering cell-override targets). */
    public getCellmapNames(): string[] {
        return this.internalPlayer.getCellmapNames();
    }

    /** Cell names in the named cell map (for discovering cell-override targets). */
    public getCellNames(cellmapName: string): string[] {
        return this.internalPlayer.getCellNames(cellmapName);
    }

    /**
     * Runtime texture replacement: bind `texture` for a cell-map / external-texture
     * name (costume changes, dynamic expressions), or pass `null` to restore the
     * original. `cellmapName` is a {@link getReplaceableTextureNames} entry — a
     * cell-map name (`common`) or a TextureChange target file name (`common.png`).
     *
     * The `texture` is caller-owned and never destroyed by the player; it must be
     * a same-size, same-layout atlas as the original (UVs are normalized by the
     * bound texture's size). Instance children share this player's textures, so a
     * name used by a child's sub-animation is replaced there too.
     */
    public setCellmapTexture(cellmapName: string, texture: Texture | null): void {
        this.internalPlayer.setCellmapTexture(cellmapName, texture);
    }

    /** The current runtime texture override for `cellmapName` (never the original), or undefined. */
    public getCellmapTexture(cellmapName: string): Texture | undefined {
        return this.internalPlayer.getCellmapTexture(cellmapName) as Texture | undefined;
    }

    /** Names {@link setCellmapTexture} can replace (cell-map names + TextureChange targets). */
    public getReplaceableTextureNames(): string[] {
        return this.internalPlayer.getReplaceableTextureNames();
    }

    /**
     * Repaint after an override took effect while the ticker is not advancing.
     * Overrides change the output without changing the frame number, so a
     * stopped player would otherwise keep showing its last drawn frame.
     */
    private afterOverride(applied: boolean): boolean {
        if (applied && !this.internalPlayer.isPlaying) {
            this.renderFrame(this.internalPlayer.getDrawFrame());
        }
        return applied;
    }

    // --- Animation events ---
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

    /**
     * Fires when playback heads out — a `play()`, including one an autoplay or a
     * host script issued rather than the caller. Not a resume: lifting a pause
     * carries on, it does not start.
     */
    public onAnimationStarted(listener: () => void): Unsubscribe {
        this._animStartedListeners.add(listener);
        return () => { this._animStartedListeners.delete(listener); };
    }

    /** Fires once every configured loop has played. Never under an infinite loop count, nor on stop(). */
    public onAnimationFinished(listener: () => void): Unsubscribe {
        this._animFinishedListeners.add(listener);
        return () => { this._animFinishedListeners.delete(listener); };
    }

    /** Fires on each loop boundary crossing. */
    public onAnimationLooped(listener: () => void): Unsubscribe {
        this._animLoopedListeners.add(listener);
        return () => { this._animLoopedListeners.delete(listener); };
    }

    /**
     * Fires once per advanced frame, right after the timeline updated and its
     * world matrices are final — the point at which {@link getPartTransform} is
     * valid for the new frame. Returns an unsubscribe function. Not fired while
     * the player is stopped (the ticker early-returns).
     */
    public onFrame(listener: (frame: number) => void): Unsubscribe {
        this._frameListeners.add(listener);
        return () => { this._frameListeners.delete(listener); };
    }

    // --- Part following: managed attachments ---

    /**
     * Make `target` follow `part` (a name or index) every frame — a weapon,
     * effect or hitbox tracking a null part. By default the target is parented
     * under the player (so it inherits the player's own transform and lands
     * exactly on the part) and its position, rotation and scale are all driven;
     * see {@link SSPartFollowOptions} to change any of that. When all three axes
     * are driven the full affine is applied, so a mirrored part is reproduced
     * exactly; otherwise only the enabled axes are written and the target keeps
     * its own value for the rest. A part's own skew is not carried — the runtime
     * keeps it out of the world matrix (matching SpriteStudio). Attaching the
     * same target twice
     * replaces the earlier attachment. Returns a handle whose `detach()` stops
     * the following.
     */
    public attachToPart(part: number | string, target: Container, options: SSPartFollowOptions = {}): SSPartAttachment {
        return this._follower.attach(part, target, options);
    }

    /** Stop following for `target`; reverses the parenting/visibility attach set up. */
    public detachFromPart(target: Container): void {
        this._follower.detach(target);
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

        const { looped, finished } = this.internalPlayer.pollPlaybackEvents();
        if (finished && this._animFinishedListeners.size > 0) {
            this._animFinishedListeners.forEach(cb => cb());
        }
        if (looped && this._animLoopedListeners.size > 0) {
            this._animLoopedListeners.forEach(cb => cb());
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

            // Audio keys are reported whichever way the playhead is walking — the
            // observation channel is not the playback. SpriteStudio has no reverse
            // audio, so it is the backend that gates on `isPlayingForward`
            // (SSWebAudioManager.bindToPlayer does), exactly as the Godot and Unity
            // players do. Suppressing the event instead used to hide the key from
            // hosts doing something other than playing a sound with it.
            if (this._audioListeners.size > 0) {
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
            const ev: SSUserDataEvent = { partIndex, partName: mgr.getPartName(partIndex), frameNo: events.frameIndex() };
            const intEntry = val.integer();
            if (intEntry) ev.integer = intEntry.value();
            const str = val.str();
            if (str !== null) ev.str = str;
            const rect = val.rect();
            if (rect) ev.rect = { left: rect.left(), top: rect.top(), right: rect.right(), bottom: rect.bottom() };
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
            // Skip inactive signals (Godot / Unity behaviour).
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
                frameNo: events.frameIndex(),
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
                frameNo: events.frameIndex(),
                soundListNameHash: val.soundListNameHash(),
                soundNameHash: val.soundNameHash(),
                soundName: val.soundName(),
                loopNum: val.loopNum(),
            };
            this._audioListeners.forEach(cb => cb(ev));
        }
    }

    private update(ticker: Ticker) {
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

        // The playhead for anything that reports a number, the drawn frame for
        // anything that asks the runtime for pixels. They differ only while
        // `subFrameEnabled` is off, and that difference is the point.
        const frameNo = this.internalPlayer.getFrameNo();

        if (this.debugText.visible) {
            this.debugText.text = `Frame: ${frameNo} (dt: ${deltaMs.toFixed(2)}ms)`;
        }

        this.renderFrame(this.internalPlayer.getDrawFrame());

        // After the frame is placed (meshes + attachments), notify per-frame
        // listeners — the point at which getPartTransform is valid for frameNo.
        if (this._frameListeners.size > 0) {
            this._frameListeners.forEach(cb => cb(frameNo));
        }
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

        this._depth = 0;

        // The root animation renders under the player's root transform (flip /
        // offset — null unless one is set) at full alpha; instance-part children
        // recurse through here with their accumulated transform and alpha, so
        // they inherit it through the composition rather than re-applying it.
        // Folding it in here rather than onto our own Container keeps it off the
        // attachment layer: a followed target is placed from getPartTransform,
        // which composes the same affine itself.
        this.renderContext(
            this.internalPlayer,
            frameData,
            frameNo,
            this.internalPlayer.getRootAffine(),
            1.0
        );

        // renderContext addChild'd this frame's meshes onto us; re-add the
        // attachment layer last so followers draw above the animation, then
        // drive each target to its part's just-finalized transform.
        if (this._follower.size > 0) {
            this.addChild(this._attachmentLayer);
            this._follower.update();
        }
    }

    /** The pooled InheritedMask for one recursion depth, grown on demand. */
    private inheritedAtDepth(depth: number): InheritedMask {
        let m = this._inheritedPool[depth];
        if (!m) {
            m = { cov: null, rank: 0, influence: ROOT_MASK_INFLUENCE, visibleInside: ROOT_VISIBLE_INSIDE };
            this._inheritedPool[depth] = m;
        }
        return m;
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
        // masked content samples it below. Null when the context has no masks.
        // Runs here, in the ticker, so coverage is ready before the stage render
        // draws our children. See buildMaskCoverage.
        //
        // Without a renderer we cannot rasterise at all. That happens on the
        // first drawn frame of a player the host did not attachRenderer() to —
        // onRender, which captures it, only fires once we are drawn. Drawing the
        // masked parts unclipped for that frame is the wrong fallback: a mask
        // exists precisely to remove pixels, so the miss reads as a full-bleed
        // flash of content that should never have been visible. Plan the writers
        // anyway (pure CPU, no renderer needed) and, if this frame does have
        // masks, hold their targets back until coverage can be produced —
        // one missing frame instead of one wrong one.
        // Composed mask context from the caller chain. The root identity
        // is influence = true / visibleInside = false, which makes every part of
        // a top-level animation evaluate exactly by its own flags. Resolved here,
        // ahead of the coverage pass, because carry-over composes each bubbled
        // writer's op with this influence.
        const ctxInfluence = inheritedMask ? inheritedMask.influence : ROOT_MASK_INFLUENCE;
        const ctxVisibleInside = inheritedMask ? inheritedMask.visibleInside : ROOT_VISIBLE_INSIDE;

        let cov: MaskCoverage | null = null;
        let maskDeferred = false;
        if (this.maskEnabled) {
            if (this.renderer) {
                cov = this.buildMaskCoverage(player, manager, geometryBuilder, frameData, drawOrder, ctxInfluence);
                // buildMaskCoverage reads instance children's frames to carry their
                // clipping masks up, which can grow WASM memory and detach
                // our frameData / drawOrder views. Re-derive before the batch loop
                // reads them; only runs on an actual grow.
                if (getWasmMemory().buffer !== memBuf) {
                    const fresh = manager.getFrameData(frameNo);
                    const freshOrder = fresh?.drawOrderArray();
                    if (!fresh || !freshOrder) return;
                    frameData = fresh;
                    drawOrder = freshOrder;
                    memBuf = getWasmMemory().buffer;
                }
            } else {
                this.maskSource.bind(frameData, drawOrder, manager);
                maskDeferred = this.maskPlanner.plan(this.maskSource) > 0;
            }
        }

        // Coverage this context's parts clip against. An ancestor's coverage
        // wins over our own when one reaches here, because a sub-animation is
        // drawn into the caller's coverage space. When the composed influence is
        // false the AND has already settled the whole subtree as non-target, so
        // nothing here clips at all.
        //
        // Known limitation: a child that BOTH inherits coverage and owns masks
        // of its own keeps only the inherited one — the replay samples a single
        // coverage texture. Composing two would need a second sampler.
        const effCov = ctxInfluence ? (inheritedMask?.cov ?? cov) : null;

        /** Polarity for one part: the caller chain's OR its own. */
        const polarityOf = (partIdx: number): number =>
            composeVisibleInside(ctxVisibleInside, maskFlags ? maskFlags[partIdx] : 0) ? 1 : 0;

        const drawBatchesLength = frameData.drawBatchesLength();
        for (let i = 0; i < drawBatchesLength; i++) {
            const batch = frameData.drawBatches(i, this._scratchBatch);
            if (!batch) continue;

            // Every field up front: the instance recursion below re-points the
            // shared _scratchBatch, so `batch` must not be read after it.
            const kind = batch.kind();
            const startRank = batch.startRank();
            const count = batch.count();
            const flags = batch.flags();
            const textureHash = batch.textureHash();
            const batchBlend = batch.blendType();

            // DrawBatchKind.Mask is consumed by the coverage pre-pass above.
            if (kind !== DrawBatchKind.Normal && kind !== DrawBatchKind.Mesh && kind !== DrawBatchKind.Shape && kind !== DrawBatchKind.Effect && kind !== DrawBatchKind.Instance) continue;
            if (count === 0) continue;

            // Instance batches carry no texture/blend of their own — each is a
            // single instance part whose referenced animation is rendered here
            // by recursing into its child context.
            if (kind === DrawBatchKind.Instance) {
                for (let c = 0; c < count; c++) {
                    // Engine-agnostic resolution (core): slot visibility, alpha,
                    // the composed placement, the mask context handed down
                    // and the child's subframe-aware playhead. Its record is
                    // reused, so read out what must survive the recursion below.
                    const inst = this._instanceResolver.resolve(
                        player, frameData, drawOrder, startRank + c,
                        parentMatrix, parentAlpha, ctxInfluence, ctxVisibleInside);
                    if (!inst) continue;
                    const child = inst.child;
                    const composed = inst.composed;
                    const childAlpha = inst.childAlpha;
                    const instInfluence = inst.influence;
                    const instVisibleInside = inst.visibleInside;

                    // Coverage is deferred this frame (see maskDeferred): a mask
                    // target instance part would draw its whole sub-animation
                    // unclipped, so hold it back instead.
                    if (maskDeferred && instInfluence) continue;

                    const childFrame = inst.frameNo;
                    const childFrameData = child.player.runtimeManager.getFrameData(childFrame);
                    if (!childFrameData) continue;

                    // Instance mask inheritance. The child's composited
                    // positions are already in this coverage's space, so its
                    // parts sample `effCov` directly; the scope test stays at
                    // the rank that owns that coverage, which is this instance
                    // part's own rank unless we are ourselves a sub-animation
                    // clipping against an ancestor's.
                    const childInherited = this.inheritedAtDepth(this._depth);
                    childInherited.cov = effCov;
                    childInherited.rank = inheritedMask ? inheritedMask.rank : startRank + c;
                    childInherited.influence = instInfluence;
                    childInherited.visibleInside = instVisibleInside;
                    // The child holds this slot for its whole render, so it must
                    // hand out a different one to ITS children.
                    this._depth++;
                    this.renderContext(child.player, childFrameData, childFrame, composed, childAlpha, childInherited);
                    this._depth--;

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

            // Coverage is deferred this frame (see maskDeferred): the parts this
            // batch would have had clipped are held back rather than drawn
            // unclipped. Same predicate as `masked` below, so exactly the parts
            // the mask governs are the ones that wait for it.
            if (maskDeferred && (flags & 0x01) !== 0) continue;

            // Effect batches (and root/null parts) carry textureHash 0; their real
            // texture is resolved per draw command, so avoid the missing-asset warning.
            const texture = textureHash !== 0 ? (this.pixiResourceManager.getTexture(textureHash) || Texture.WHITE) : Texture.WHITE;

            // SpriteStudio framebuffer-composite blend (alpha_blend_type, 12 values)
            // → PixiJS blend mode. This is the framebuffer
            // composite stage (after parts_color is applied in the shader).
            // All blend modes are mapped to custom states (SS_*_BLEND) defined in
            // SSBlendModes.ts. This ensures 100% parity with the fixed-function
            // GPU blend equations used in ssplayer-webgl across both WebGL and WebGPU.
            // Which of the seven fixed-function states a BlendType draws with is
            // core's table (ssplayer-webgl reads the same one); naming the mode we
            // registered for that state is ours. See SSBlendModes.
            const blendMode: any = SS_BLEND_MODE_NAMES[ssBlendMode(batchBlend)];
            
            const invTexW = 1.0 / texture.width;
            const invTexH = 1.0 / texture.height;
            
            // Parts in this batch are clipped when coverage reaches them AND the
            // runtime set the batch's FLAG_MASK_INFLUENCE (0x01). That flag is
            // the parts' own mask_influence (batches are keyed by it), so this
            // conjunction IS the AND: `effCov` already carries the caller
            // chain's half, and a sub-animation part that opted out is not
            // clipped even though its caller was a mask target. Masked parts use
            // a separate pool (carrying aMaskUV) and shader.
            const masked = effCov !== null && (flags & 0x01) !== 0;

            if (kind === DrawBatchKind.Normal) {
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    // draw_as_mask parts are pure masks: coverage only, no colour.
                    if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
                    const alpha = this._raw.partAlphaOf(frameData, partIdx);
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
                    const shaderIdx = masked ? -1 : this._raw.partShaderOf(frameData, partIdx);
                    const ssShader = shaderIdx >= 0
                        ? this.resolveSsShader(frameData, shaderIdx, uvs, texture, invTexW, invTexH)
                        : null;

                    this.finishPart(mesh, 5, masked,
                        inheritedMask ? inheritedMask.rank : startRank + c,
                        polarityOf(partIdx),
                        effCov, texture, blendMode, parentAlpha, ssShader);
                }
            } else if (kind === DrawBatchKind.Shape) {
                const shapeVertexCounts = manager.getShapeVertexCounts();

                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
                    const numVerts = shapeVertexCounts[partIdx];
                    if (numVerts < 3) continue;

                    const alpha = this._raw.partAlphaOf(frameData, partIdx);
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
                        polarityOf(partIdx),
                        effCov, texture, blendMode, parentAlpha);
                }
            } else if (kind === DrawBatchKind.Mesh) {
                const meshVOff = manager.getMeshVertexOffsets();
                const meshIOff = manager.getMeshIndexOffsets();

                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
                    const alpha = this._raw.partAlphaOf(frameData, partIdx);
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
                        polarityOf(partIdx),
                        effCov, texture, blendMode, parentAlpha);
                }
            } else if (kind === DrawBatchKind.Effect) {
                // Particle geometry is simulated in the WASM runtime and returned as an
                // EffectDrawPlan per effect part: one command per (cellmap, blend) emitter
                // group, slicing shared flat buffers. The per-vertex math lives in core's
                // GeometryBuilder.buildEffectCommand.
                //
                // Dynamic batching: we gather every particle
                // command in this batch in draw order — folding each effect part's own
                // opacity into the vertex alpha — then merge consecutive commands sharing
                // the same (cellmap, blend) into a single pooled Mesh / draw call. Only
                // *consecutive* runs are merged, so draw order (hence blend compositing)
                // is preserved exactly.
                const fxCount = this._fx.collect(player, frameData, drawOrder, startRank, count);

                // The descriptors hold zero-copy EffectDrawPlan views over WASM
                // memory. Nothing between the gather above and the build below
                // allocates in WASM (getEffectShader / getTexture / buffer updates
                // are all JS/GPU side), so the views stay valid — no re-derive needed.
                let g = 0;
                while (g < fxCount) {
                    const cellmap = this._fx.items[g].cellmap;
                    const blend = this._fx.items[g].blend;
                    const h = this._fx.runEnd(g);
                    const totalQuads = this._fx.quadsIn(g, h);

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
                        const d = this._fx.items[k];
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
                    const bMode = (blend === 1) ? SS_ADD_BLEND : SS_MIX_BLEND;
                    mesh.blendMode = bMode;
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
     * would double-apply it.
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
     * into an offscreen coverage texture using the bit-packed bitmap method:
     * each writer gets one bit (0..23) packed into the
     * R/G/B channels via additive blending, cut out by its alpha threshold.
     * Returns the coverage texture, the bbox→UV mapping, and the per-writer
     * metadata replayed by the masked shader; null when there are no active
     * writers. Rendered immediately (we run before the stage render), so the
     * texture is ready when masked content samples it.
     */
    private buildMaskCoverage(
        player: DirectInternalPlayer,
        manager: SSRuntimeManager,
        geometryBuilder: GeometryBuilder,
        frameData: FrameData,
        drawOrder: Uint16Array,
        ctxInfluence: boolean
    ): MaskCoverage | null {
        const slot = this.activeRTs;
        const covObj = this.ensureCov(slot);

        // Engine-agnostic planning (core): select writers, classify OP / scope /
        // clipping, resolve cutout threshold + geometry kind, assign coverage
        // bits and the replay meta. This class only rasterises the plan below.
        const planner = this.maskPlanner;
        this.maskSource.bind(frameData, drawOrder, manager);
        const count = planner.plan(this.maskSource);
        if (planner.exceeded && !this.maskWritersExceeded) {
            this.maskWritersExceeded = true;
            console.warn(`[SSPlayer] mask writers exceeded ${MAX_MASK_WRITERS}; extra masks ignored.`);
        }

        // Carry-over: a mask written *inside* a visible instance child
        // reaches out to the parent's parts drawn after that instance. Snapshot
        // the instance placements now — before any child getFrameData() below can
        // grow WASM memory and detach `drawOrder` — then bake each child's
        // clipping writers into this coverage. The coverage pass runs even when
        // this context owns no writer of its own (count === 0), as long as a
        // child carries one up.
        const bubbleCount = this.collectClipBubbles(player, geometryBuilder, frameData, drawOrder, ctxInfluence);
        if (count === 0 && bubbleCount === 0) return null;

        const root = this.maskRenderRoot;
        const bbox = this._covBBox;
        bbox[0] = Infinity; bbox[1] = Infinity; bbox[2] = -Infinity; bbox[3] = -Infinity;

        // Own writers: rasterise each into the coverage bitmap (its coverage bit
        // pre-encoded into one R/G/B channel, cutout threshold in aVarg.x,
        // additive-blended so disjoint bits OR together).
        for (let w = 0; w < count; w++) {
            this.bakeCoverageWriter(geometryBuilder, frameData, planner.partIdx[w], planner.geomKind[w],
                planner.numVerts[w], planner.numIndices[w], planner.textureHash[w], planner.threshold[w],
                planner.bit[w], bbox);
        }

        // The planner's `meta` is reusable scratch (overwritten by the child
        // plan() below). Copy the own writers' entries into the pooled per-slot
        // record before that happens, so an inheriting child can replay
        // this coverage at draw time.
        covObj.meta.set(planner.meta.subarray(0, count * 4));

        // Bubble each visible instance child's clipping writers up. `total`
        // continues the own writers' bit numbering; the shared 24-bit budget
        // covers both (carry-over).
        let total = count;
        for (let bi = 0; bi < bubbleCount && total < MAX_MASK_WRITERS; bi++) {
            const cand = this._bubbleCands[bi];
            const childManager = cand.child.player.runtimeManager;
            const childFrame = cand.child.player.getDrawFrame();
            const childFrameData = childManager.getFrameData(childFrame);
            if (!childFrameData) continue;
            const childDrawOrder = childFrameData.drawOrderArray();
            if (!childDrawOrder) continue;

            this.maskSource.bind(childFrameData, childDrawOrder, childManager);
            const cCount = planner.plan(this.maskSource);
            if (cCount === 0) continue;

            // The child's geometry is built in this coverage's space via the
            // composed instance matrix, matching where the child's parts land
            // when it draws normally.
            const cgb = cand.child.player.geometryBuilder;
            cgb.parentMatrix = cand.composed;
            cgb.updateWorldPositions();

            for (let w = 0; w < cCount && total < MAX_MASK_WRITERS; w++) {
                // Only clipping writers carry out; a pure mask closes within the
                // sub-animation.
                if (!planner.isClipping[w]) continue;
                const bit = total;
                // Ranked at the instance part so it clips the owner parts drawn
                // after it; op composed with the influence handed down — a
                // mask_influence == 0 instance drops its writers onto the union
                // (increment) plane (op_invert = false).
                covObj.meta[bit * 4 + 0] = cand.rank;
                covObj.meta[bit * 4 + 1] = bit;
                covObj.meta[bit * 4 + 2] = (planner.opInvert[w] && cand.influence) ? 1 : 0;
                covObj.meta[bit * 4 + 3] = 1;
                this.bakeCoverageWriter(cgb, childFrameData, planner.partIdx[w], planner.geomKind[w],
                    planner.numVerts[w], planner.numIndices[w], planner.textureHash[w], planner.threshold[w],
                    bit, bbox);
                total++;
            }
        }

        if (total === 0) return null; // every candidate child turned out writer-less

        // Pad 1px so the mask's own edge texels aren't clipped; guard degeneracy.
        let minX = bbox[0] - 1, minY = bbox[1] - 1, maxX = bbox[2] + 1, maxY = bbox[3] + 1;
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
        covObj.count = total;
        this.activeRTs = slot + 1;
        return covObj;
    }

    /**
     * Rasterise one mask writer's geometry into the coverage bitmap under `bit`:
     * build its geometry (via `gb` from `fd`), pre-encode `bit` into one aColor
     * R/G/B channel and the cutout `threshold` into aVarg.x, accumulate the
     * writer's extent into `bbox` [minX,minY,maxX,maxY], and add the mesh to the
     * coverage render root (additive-blended). `gb` is this context's builder for
     * an own writer, or an instance child's builder placed into owner space for a
     * bubbled one. Cutout texture comes from the planner's DrawBatch
     * textureHash (0 = pure mask / shape → no cutout, the geometry is the mask).
     */
    private bakeCoverageWriter(
        gb: GeometryBuilder, fd: FrameData, partIdx: number, geomKind: number,
        numVerts: number, numIndices: number, texHash: number, threshold: number,
        bit: number, bbox: Float32Array
    ): void {
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
            gb.buildShape(partIdx, fd, numVerts, invTexW, invTexH, positions, uvs, colors, vargs, indices);
            mesh.geometry.getIndex().update();
        } else if (geomKind === 2) {
            const indices = mesh.geometry.getIndex().data as Uint32Array;
            gb.buildMesh(partIdx, fd, numVerts, numIndices, invTexW, invTexH, positions, uvs, colors, vargs, indices);
            mesh.geometry.getIndex().update();
        } else {
            gb.buildNormal(partIdx, fd, invTexW, invTexH, positions, uvs, colors, vargs);
        }

        const chan = (bit / 8) | 0;
        const bitVal = (1 << (bit % 8)) / 255;
        const br = chan === 0 ? bitVal : 0;
        const bg = chan === 1 ? bitVal : 0;
        const bb = chan === 2 ? bitVal : 0;
        for (let v = 0; v < numVerts; v++) {
            colors[v * 4 + 0] = br; colors[v * 4 + 1] = bg; colors[v * 4 + 2] = bb; colors[v * 4 + 3] = 1;
            vargs[v * 4 + 0] = threshold;
            const x = positions[v * 2], y = positions[v * 2 + 1];
            if (x < bbox[0]) bbox[0] = x; if (x > bbox[2]) bbox[2] = x;
            if (y < bbox[1]) bbox[1] = y; if (y > bbox[3]) bbox[3] = y;
        }
        mesh.geometry.getBuffer('aPosition').update();
        mesh.geometry.getBuffer('aUV').update();
        mesh.geometry.getBuffer('aColor').update();
        mesh.geometry.getBuffer('aVarg').update();

        mesh.shader = this.getMaskWriteShader(texture) as any;
        mesh.blendMode = 'add';
        mesh.alpha = 1;
        mesh.visible = true;
        this.maskRenderRoot.addChild(mesh);
    }

    /**
     * Snapshot the visible instance children whose clipping writers carry up into
     * this context's coverage. Fills the pooled `_bubbleCands` with, per
     * child: its `rank` in the owner draw order (where the carried mask starts
     * clipping), the child state, the composed `mask_influence` handed down (which
     * decides each bubbled writer's op plane), and the composed instance matrix
     * (owner parentMatrix ∘ instance world ∘ child local) that maps the child's
     * geometry into this coverage's space. Reads only the owner frame (no child
     * getFrameData), so it is safe to run before the detach-prone bubble bake.
     * Returns the candidate count.
     *
     * Which instance parts qualify is the core resolver's call, so a fully
     * transparent one is skipped here exactly as it is in the draw loop: an
     * instance the renderer never draws contributes no coverage either. It is
     * also the shared reading of "visible instance child" — ssplayer-webgl
     * reaches the same point by carrying the writers up from inside its draw loop.
     */
    private collectClipBubbles(
        player: DirectInternalPlayer, geometryBuilder: GeometryBuilder,
        frameData: FrameData, drawOrder: Uint16Array, ctxInfluence: boolean
    ): number {
        this._bubbleCount = 0;
        const ownerParent = geometryBuilder.parentMatrix;
        const n = drawOrder.length;
        for (let rank = 0; rank < n; rank++) {
            // parentAlpha / ctxVisibleInside play no part in a bubble: only the
            // rank, the composed placement and the op-deciding influence do.
            const inst = this._instanceResolver.resolve(
                player, frameData, drawOrder, rank, ownerParent, 1, ctxInfluence, ROOT_VISIBLE_INSIDE);
            if (!inst) continue;
            // The composed matrix reuses child.parentMatrix as its target, and is
            // recomputed identically when the child draws its own parts later this
            // frame — so holding it past the loop is safe.
            const child = inst.child;
            let e = this._bubbleCands[this._bubbleCount];
            if (!e) { e = { rank: 0, child, influence: false, composed: inst.composed }; this._bubbleCands[this._bubbleCount] = e; }
            e.rank = rank; e.child = child; e.influence = inst.influence; e.composed = inst.composed;
            this._bubbleCount++;
        }
        return this._bubbleCount;
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
    // clamped to [64, 1024] per axis.
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
