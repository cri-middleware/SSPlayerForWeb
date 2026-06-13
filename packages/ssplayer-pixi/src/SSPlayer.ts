import { Container, Mesh, Geometry, Texture, Ticker, Text, Shader, Buffer, BufferUsage, RenderTexture, UniformGroup, Matrix, type Renderer } from 'pixi.js';
import { DirectInternalPlayer, BlendType, DrawBatchKind, GeometryBuilder, SSRuntimeManager, FrameData, PartState, initializeWasm, WebPlaybackDirection, WebPlaybackStyle } from '@spritestudio/ssplayer-core';
import { PartsColorShader, PartsColorShaderWGSL } from './PartsColorShader.js';
import { EffectShader, EffectShaderWGSL } from './EffectShader.js';
import { MaskWriteShader, MaskWriteShaderWGSL } from './MaskWriteShader.js';
import { MaskedPartsColorShader, MaskedPartsColorShaderWGSL } from './MaskedPartsColorShader.js';
import { PixiResourceManager } from './PixiResourceManager.js';

// Max simultaneous mask writers per context: one bit each, packed into the
// R/G/B channels of an RGBA8 coverage texture (8 bits x 3 = 24). Matches the
// runtime contract in 09_mask.ja.md §3-2.
const MAX_MASK_WRITERS = 24;

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

    private pixiResourceManager: PixiResourceManager;
    private debugText: Text;
    private partsColorShaders: Map<Texture, Shader> = new Map();
    private effectShaders: Map<Texture, Shader> = new Map();

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
    // Writer selection scratch: (partIdx, rankPos, opInvert, isClipping) × MAX,
    // plus the writer's batch texture hash (masks resolve their cutout texture
    // from their own DrawBatch, like the Godot/Unity reference players).
    private readonly scratchWriterSel = new Int32Array(MAX_MASK_WRITERS * 4);
    private readonly scratchWriterTex = new Uint32Array(MAX_MASK_WRITERS);
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
        this.onRender = (renderer: Renderer) => { this.renderer = renderer; };

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
     * @param textureBaseUrl Base URL for textures (defaults to ssabUrl's directory)
     */
    public async load(ssabUrl: string, textureBaseUrl?: string) {
        await this.internalPlayer.load(ssabUrl, textureBaseUrl);
        this.internalPlayer.runtimeManager.context.set_render_mode(0); // 0 corresponds to RenderMode::Direct
        this.internalPlayer.runtimeManager.context.set_coordinate_system(1); // 1 = YDown
    }

    public async setAnimation(animationName: string, loop: number = -1, textureBaseUrl?: string) {
        await this.internalPlayer.setAnimation(animationName, textureBaseUrl);
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

    private update(ticker: Ticker) {
        // console.log("update tick", this.internalPlayer.isPlaying, this.internalPlayer.isPausing, this.internalPlayer.getFrameNo());
        if (!this.internalPlayer.isPlaying) return;
        
        const deltaMs = ticker.deltaMS;
        
        // Update wasm state only if not paused
        if (!this.internalPlayer.isPausing) {
            this.internalPlayer.update(deltaMs);
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
        this.removeChildren();
        this.addChild(this.debugText);

        // The root animation renders with no parent transform and full alpha;
        // instance-part children recurse through here with their accumulated
        // transform and alpha.
        this.renderContext(
            this.internalPlayer,
            frameData,
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
        parentMatrix: Float32Array | null,
        parentAlpha: number
    ) {
        const manager = player.runtimeManager;
        const geometryBuilder = player.geometryBuilder;

        geometryBuilder.parentMatrix = parentMatrix;
        geometryBuilder.updateWorldPositions();

        const drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;

        const maskFlags = manager.getPartMaskFlags();

        // Mask coverage pre-pass: rasterise this context's mask contributors
        // (DrawBatchKind.Mask batches) into an offscreen coverage texture, then
        // masked content samples it below. Null when the context has no masks or
        // no renderer is available yet (the first frame) — masked parts then draw
        // unclipped. Runs here, in the ticker, so coverage is ready before the
        // stage render draws our children. See buildMaskCoverage / 09_mask.ja.md.
        const cov = (this.renderer && this.maskEnabled) ? this.buildMaskCoverage(manager, geometryBuilder, frameData, drawOrder) : null;

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
                    this.renderContext(child.player, childFrameData, composed, parentAlpha * alpha);
                }
                continue;
            }

            const textureHash = batch.textureHash();
            // Effect batches (and root/null parts) carry textureHash 0; their real
            // texture is resolved per draw command, so avoid the missing-asset warning.
            const texture = textureHash !== 0 ? (this.pixiResourceManager.getTexture(textureHash) || Texture.WHITE) : Texture.WHITE;

            let blendMode: any = 'normal';
            switch (batch.blendType()) {
                case BlendType.Mix: blendMode = 'normal'; break;
                case BlendType.Add: blendMode = 'add'; break;
                case BlendType.Sub: blendMode = 'subtract'; break;
                case BlendType.Mul: blendMode = 'multiply'; break;
                case BlendType.Screen: blendMode = 'screen'; break;
            }
            
            const invTexW = 1.0 / texture.width;
            const invTexH = 1.0 / texture.height;
            
            // Parts in this batch are clipped by the mask when the runtime set
            // FLAG_MASK_INFLUENCE (0x01) and this context produced coverage.
            // Masked parts use a separate pool (carrying aMaskUV) and shader.
            const masked = cov !== null && (batch.flags() & 0x01) !== 0;

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

                    this.finishPart(mesh, 5, masked, partIdx, startRank + c, cov, texture, blendMode, alpha * parentAlpha, maskFlags);
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

                    this.finishPart(mesh, numVerts, masked, partIdx, startRank + c, cov, texture, blendMode, alpha * parentAlpha, maskFlags);
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

                    this.finishPart(mesh, pCount, masked, partIdx, startRank + c, cov, texture, blendMode, alpha * parentAlpha, maskFlags);
                }
            } else if (kind === DrawBatchKind.Effect) {
                // Particle geometry is simulated in the WASM runtime and returned as an
                // EffectDrawPlan per effect part: one command per (cellmap, blend) emitter
                // group, slicing shared flat buffers. The per-vertex math lives in core's
                // GeometryBuilder.buildEffectCommand; here we only resolve the texture,
                // blend and shader and push the geometry to a pooled PixiJS Mesh.
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

                        const pCount = quadCount * 4;
                        const iCount = quadCount * 6;

                        const mesh = this.getMeshFromPool(this.activeMeshes, pCount, iCount);
                        this.activeMeshes++;

                        const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                        const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                        const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                        const indices = mesh.geometry.getIndex().data as Uint32Array;

                        geometryBuilder.buildEffectCommand(
                            partIdx, plan, cmd, positions, uvs, colors, indices
                        );

                        mesh.geometry.getBuffer('aPosition').update();
                        mesh.geometry.getBuffer('aUV').update();
                        mesh.geometry.getBuffer('aColor').update();
                        mesh.geometry.getIndex().update();

                        const effectTex = this.pixiResourceManager.getTexture(cmd.cellmapHash()) || Texture.WHITE;
                        mesh.shader = this.getEffectShader(effectTex) as any;
                        // Raw EmitterState.blend_type: 0 = Mix, 1 = Add.
                        mesh.blendMode = cmd.blend() === 1 ? 'add' : 'normal';
                        mesh.alpha = alpha * parentAlpha;
                        mesh.visible = true;
                        this.addChild(mesh);
                    }
                }
            }
        }
    }

    /**
     * Set shader / blend / alpha for a content part and add it to the display
     * list. For masked parts, binds the masked shader (with this context's
     * coverage + writer metadata) and fills the per-vertex coverage UVs; for
     * unmasked parts, the plain PartsColor shader.
     */
    private finishPart(
        mesh: Mesh<any>,
        numVerts: number,
        masked: boolean,
        partIdx: number,
        thisRank: number,
        cov: MaskCoverage | null,
        texture: Texture,
        blendMode: any,
        alpha: number,
        maskFlags: Uint8Array | null
    ): void {
        if (masked && cov) {
            // visible_inside_mask (bit 0x01) → show inside (1) vs outside (0).
            const mode = (maskFlags && (maskFlags[partIdx] & 0x01) !== 0) ? 1 : 0;
            this.fillMaskUV(mesh, numVerts, thisRank, mode, cov);
            mesh.shader = this.getMaskedShader(texture, cov) as any;
        } else {
            mesh.shader = this.getPartsColorShader(texture) as any;
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
        const meta = covObj.meta;
        const maskFlags = manager.getPartMaskFlags();

        const root = this.maskRenderRoot;

        const drawBatchesLength = frameData.drawBatchesLength();
        const shapeVertexCounts = manager.getShapeVertexCounts();
        const meshVOff = manager.getMeshVertexOffsets();
        const meshIOff = manager.getMeshIndexOffsets();

        let count = 0;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        // Select writers in draw order (09_mask.ja.md §1-2):
        //   pure masks  — DrawBatchKind.Mask batches emitted by the runtime
        //                 (PartTypeMask / draw_as_mask); OP rides in the batch
        //                 flag (0x01: 0 = increment, 1 = invert, §2-3).
        //   clipping    — drawn parts with mask_write (runtime emits NO twin
        //                 batch for these), detected via the cached PartData
        //                 flags; their mask_influence doubles as the OP (§1-2),
        //                 and they scope FORWARD (rank > writer, §2-1).
        // (partIdx, rankPos, opInvert, isClipping) per writer.
        const sel = this.scratchWriterSel;
        const selTex = this.scratchWriterTex;
        for (let i = 0; i < drawBatchesLength && count < MAX_MASK_WRITERS; i++) {
            const batch = frameData.drawBatches(i);
            if (!batch) continue;
            const kind = batch.kind();
            const rank = batch.startRank();
            const bcount = batch.count();
            // The writer's cutout texture comes from its own DrawBatch, exactly
            // like the Godot/Unity reference players (no extra runtime API). A
            // pure-mask (Mask) batch carries textureHash 0, so pure masks get no
            // alpha cutout — their geometry is the mask.
            const texHash = batch.textureHash() >>> 0;

            if (kind === DrawBatchKind.Mask) {
                const opInvert = (batch.flags() & 0x01) !== 0 ? 1 : 0;
                for (let c = 0; c < bcount && count < MAX_MASK_WRITERS; c++) {
                    const partIdx = drawOrder[rank + c];
                    sel[count * 4 + 0] = partIdx;
                    sel[count * 4 + 1] = rank + c;
                    sel[count * 4 + 2] = opInvert;
                    sel[count * 4 + 3] = 0;
                    selTex[count] = texHash;
                    count++;
                }
            } else if (maskFlags && (kind === DrawBatchKind.Normal || kind === DrawBatchKind.Shape || kind === DrawBatchKind.Mesh)) {
                for (let c = 0; c < bcount && count < MAX_MASK_WRITERS; c++) {
                    const partIdx = drawOrder[rank + c];
                    const mf = maskFlags[partIdx];
                    // mask_write drawn part = clipping writer (draw_as_mask
                    // parts are pure masks and already covered above).
                    if ((mf & 0x02) === 0 || (mf & 0x08) !== 0) continue;
                    sel[count * 4 + 0] = partIdx;
                    sel[count * 4 + 1] = rank + c;
                    sel[count * 4 + 2] = (mf & 0x04) !== 0 ? 1 : 0;
                    sel[count * 4 + 3] = 1;
                    selTex[count] = texHash;
                    count++;
                }
            }
        }

        const selected = count;
        count = 0;
        for (let w = 0; w < selected; w++) {
            {
                const partIdx = sel[w * 4 + 0];
                const rankPos = sel[w * 4 + 1];
                const opInvert = sel[w * 4 + 2];
                const isClipping = sel[w * 4 + 3];
                const partState = frameData.parts(partIdx, this.scratchPartState);
                if (!partState) continue;
                const maskVal = partState.mask();
                if (maskVal <= 0) continue; // §2-2: mask == 0 writer is inert.

                // Cutout texture from the writer's DrawBatch (§2-5). 0 = no cell
                // (pure masks, shapes) → no cutout, geometry is the mask.
                const texHash = selTex[w];
                const texture = texHash !== 0 ? (this.pixiResourceManager.getTexture(texHash) || Texture.WHITE) : Texture.WHITE;
                const invTexW = 1.0 / texture.width;
                const invTexH = 1.0 / texture.height;
                const threshold = texHash !== 0 ? (255 - maskVal) / 255 : -1.0;

                // Resolve the writer's geometry kind (the Mask batch doesn't
                // carry it): shape vertex count, then mesh slice, else a quad.
                const shapeVerts = shapeVertexCounts[partIdx];
                const meshVCount = meshVOff[partIdx + 1] - meshVOff[partIdx];
                let numVerts: number;
                let numIndices: number;
                let geomKind: 0 | 1 | 2; // 0 normal, 1 shape, 2 mesh
                if (shapeVerts >= 3) { numVerts = shapeVerts; numIndices = (shapeVerts - 2) * 3; geomKind = 1; }
                else if (meshVCount > 0) { numVerts = meshVCount; numIndices = meshIOff[partIdx + 1] - meshIOff[partIdx]; geomKind = 2; }
                else { numVerts = 5; numIndices = 12; geomKind = 0; }
                if (numIndices <= 0) continue;

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

                // Pre-encode this writer's bit into aColor (one R/G/B channel)
                // and its cutout threshold into aVarg.x; accumulate the bbox.
                const bit = count;
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

                // meta[i] = (drawRank, bit, opInvert, isClipping); replayed by
                // the masked shader in writer order (§2-1/§2-3).
                meta[count * 4 + 0] = rankPos;
                meta[count * 4 + 1] = bit;
                meta[count * 4 + 2] = opInvert;
                meta[count * 4 + 3] = isClipping;
                count++;
            }
        }

        if (count === 0) return null;
        if (count >= MAX_MASK_WRITERS && !this.maskWritersExceeded) {
            this.maskWritersExceeded = true;
            console.warn(`[SSPlayer] mask writers exceeded ${MAX_MASK_WRITERS}; extra masks ignored.`);
        }

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
