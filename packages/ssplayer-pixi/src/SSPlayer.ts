import { Container, Mesh, Geometry, Texture, Ticker, Text, Shader, Buffer, BufferUsage } from 'pixi.js';
import { DirectInternalPlayer, BlendType, DrawBatchKind, GeometryBuilder, SSRuntimeManager, FrameData, initializeWasm, WebPlaybackDirection, WebPlaybackStyle } from '@spritestudio/ssplayer-core';
import { PartsColorShader, PartsColorShaderWGSL } from './PartsColorShader.js';
import { EffectShader, EffectShaderWGSL } from './EffectShader.js';
import { PixiResourceManager } from './PixiResourceManager.js';

export class SSPlayer extends Container {
    public static async initialize(wasmUrl?: string | URL) {
        await initializeWasm(wasmUrl);
    }

    public internalPlayer: DirectInternalPlayer;

    private meshPool: Mesh<any>[] = [];
    private activeMeshes: number = 0;

    private pixiResourceManager: PixiResourceManager;
    private debugText: Text;
    private partsColorShaders: Map<Texture, Shader> = new Map();
    private effectShaders: Map<Texture, Shader> = new Map();
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

        Ticker.shared.add(this.update, this);
    }
    
    public override destroy(options?: any) {
        Ticker.shared.remove(this.update, this);
        if (this.internalPlayer) {
            this.internalPlayer.destroy();
        }
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

    
    public setTexture(textureHash: number, texture: Texture) {
        // Obsolete or adapt if needed, or pass directly to PixiResourceManager
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

        this.activeMeshes = 0;
        this.removeChildren();
        this.addChild(this.debugText);

        // The root animation renders with no parent transform and full alpha;
        // instance-part children recurse through here with their accumulated
        // transform and alpha.
        this.renderContext(
            this.internalPlayer.runtimeManager,
            this.internalPlayer.geometryBuilder,
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
        manager: SSRuntimeManager,
        geometryBuilder: GeometryBuilder,
        frameData: FrameData,
        parentMatrix: Float32Array | null,
        parentAlpha: number
    ) {
        geometryBuilder.parentMatrix = parentMatrix;
        geometryBuilder.updateWorldPositions();

        const drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;

        const drawBatchesLength = frameData.drawBatchesLength();
        for (let i = 0; i < drawBatchesLength; i++) {
            const batch = frameData.drawBatches(i);
            if (!batch) continue;

            const kind = batch.kind();
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
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const child = manager.getInstanceChild(partIdx);
                    if (!child || !child.visible) continue;

                    const childFrame = child.manager.context.get_frame_no();
                    const childFrameData = child.manager.getFrameData(childFrame);
                    if (!childFrameData) continue;

                    const instMat = manager.getWorldMatrix2D(partIdx);
                    const composed = GeometryBuilder.composeAffine(parentMatrix, instMat);
                    this.renderContext(child.manager, child.geometryBuilder, childFrameData, composed, parentAlpha * alpha);
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
            
            const batchShader = this.getPartsColorShader(texture);
            
            if (kind === DrawBatchKind.Normal) {
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;
                    
                    let mesh = this.getMeshFromPool(this.activeMeshes);
                    this.activeMeshes++;
                    
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
                    
                    mesh.shader = batchShader as any;
                    mesh.blendMode = blendMode;
                    mesh.alpha = alpha * parentAlpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Shape) {
                const shapeVertexCounts = manager.getShapeVertexCounts();
                
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const numVerts = shapeVertexCounts[partIdx];
                    if (numVerts < 3) continue;

                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const numIndices = (numVerts - 2) * 3;
                    let mesh = this.getMeshFromPool(this.activeMeshes, numVerts, numIndices);
                    this.activeMeshes++;
                    
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
                    
                    mesh.shader = batchShader as any;
                    mesh.blendMode = blendMode;
                    mesh.alpha = alpha * parentAlpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Mesh) {
                const meshVOff = manager.getMeshVertexOffsets();
                const meshIOff = manager.getMeshIndexOffsets();

                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;
                    
                    const v0 = meshVOff[partIdx];
                    const v1 = meshVOff[partIdx + 1];
                    const i0 = meshIOff[partIdx];
                    const i1 = meshIOff[partIdx + 1];
                    
                    const pCount = v1 - v0;
                    const iCount = i1 - i0;
                    if (pCount === 0 || iCount === 0) continue;
                    
                    let mesh = this.getMeshFromPool(this.activeMeshes, pCount, iCount);
                    this.activeMeshes++;
                    
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
                    
                    mesh.shader = batchShader as any;
                    mesh.blendMode = blendMode;
                    mesh.alpha = alpha * parentAlpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Effect) {
                // Particle geometry is simulated in the WASM runtime and returned as an
                // EffectDrawPlan per effect part: one command per (cellmap, blend) emitter
                // group, slicing shared flat buffers. The per-vertex math lives in core's
                // GeometryBuilder.buildEffectCommand; here we only resolve the texture,
                // blend and shader and push the geometry to a pooled PixiJS Mesh.
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const plan = manager.getEffectDrawPlan(partIdx);
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

    private getMeshFromPool(index: number, requiredVertices: number = 5, requiredIndices: number = 12): Mesh {
        if (index < this.meshPool.length) {
            let m = this.meshPool[index];
            const pBuf = m.geometry.getBuffer('aPosition');
            const iBuf = m.geometry.getIndex();
            if (pBuf.data.length !== requiredVertices * 2 || iBuf.data.length !== requiredIndices) {
                m.destroy({ children: true, texture: false, textureSource: false });
                m = this.createNewMesh(requiredVertices, requiredIndices);
                this.meshPool[index] = m;
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
        
        const m = this.createNewMesh(requiredVertices, requiredIndices);
        (m as any).size = requiredIndices;
        this.meshPool.push(m);
        return m;
    }

    private createNewMesh(requiredVertices: number, requiredIndices: number): Mesh<any> {
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
