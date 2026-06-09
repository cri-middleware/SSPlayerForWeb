import { Container, Mesh, MeshGeometry, Texture, Ticker, Text, Shader } from 'pixi.js';
import { DirectInternalPlayer, BlendType, DrawBatchKind } from '@spritestudio/ssplayer-core';
import { PartsColorShader } from './PartsColorShader.js';
import { PixiResourceManager } from './PixiResourceManager.js';

export class SSPlayer extends Container {
    public internalPlayer: DirectInternalPlayer;

    private meshPool: Mesh[] = [];
    private activeMeshes: number = 0;

    private pixiResourceManager: PixiResourceManager;
    private debugText: Text;
    private partsColorShaders: Map<Texture, Shader> = new Map();
    public get subframe(): boolean {
        return this.internalPlayer.subFrameEnabled;
    }

    public set subframe(value: boolean) {
        this.internalPlayer.subFrameEnabled = value;
    }
    
    public get animationSpeed(): number {
        return this._isLoaded ? this.internalPlayer.runtimeManager.context.get_active_event_instance(0).speed : 1;
    }
    public set animationSpeed(speed: number) {
        if (this._isLoaded) this.internalPlayer.runtimeManager.context.set_animation_speed(speed);
    }
    
    private getPartsColorShader(texture: Texture): Shader {
        let shader = this.partsColorShaders.get(texture);
        if (!shader) {
            shader = Shader.from({
                gl: PartsColorShader,
                resources: {
                    uTexture: texture.source,
                    textureUniforms: {
                        uTextureMatrix: { type: 'mat3x3<f32>', value: texture.textureMatrix.mapCoord }
                    }
                }
            });
            this.partsColorShaders.set(texture, shader);
        }
        return shader;
    }
    
    private _isLoaded: boolean = false;

    constructor() {
        super();
        this.pixiResourceManager = new PixiResourceManager();
        this.internalPlayer = new DirectInternalPlayer(this.pixiResourceManager);
        
        // Remove debug text by default, or keep it hidden
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
        
        this._isLoaded = true;
    }

    /**
     * Set the animation to play
     * @param animationName Name of the animation inside the SSAB
     * @param loop Number of loops (-1 = infinite)
     */
    public async setAnimation(animationName: string, loop: number = -1, textureBaseUrl?: string) {
        if (!this._isLoaded) {
            console.warn("SSPlayer: Call load() before setAnimation()");
            return;
        }

        await this.internalPlayer.setAnimation(animationName, textureBaseUrl);
        this.internalPlayer.setLoop(loop);
        // Ensure geometry buffers are re-allocated/cleared if needed?
        // Usually handled during renderFrame
    }

    public play() {
        if (!this._isLoaded) return;
        this.internalPlayer.play();
    }

    public pause() {
        this.internalPlayer.pause();
    }

    public stop() {
        this.internalPlayer.stop();
    }
    
    public resume() {
        if (!this._isLoaded) return;
        this.internalPlayer.resume();
    }

    public get frame(): number {
        return this._isLoaded ? this.internalPlayer.getFrameNo() : 0;
    }

    public set frame(value: number) {
        if (this._isLoaded) this.internalPlayer.runtimeManager.context.set_frame_no(value);
    }

    public get startFrame(): number {
        return this._isLoaded ? this.internalPlayer.runtimeManager.context.get_start_frame() : 0;
    }

    public get endFrame(): number {
        return this._isLoaded ? this.internalPlayer.runtimeManager.context.get_end_frame() : 0;
    }

    public get fps(): number {
        return this._isLoaded ? this.internalPlayer.runtimeManager.context.get_fps() : 30;
    }

    public get isPlaying(): boolean {
        return this.internalPlayer.isPlaying;
    }

    public get isPausing(): boolean {
        return this.internalPlayer.isPausing;
    }

    
    public setTexture(textureHash: number, texture: Texture) {
        // Obsolete or adapt if needed, or pass directly to PixiResourceManager
    }

    private update(ticker: Ticker) {
        if (!this._isLoaded) return;
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

        this.internalPlayer.geometryBuilder.updateWorldPositions();

        const drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;
        
        for (let i = 0; i < this.meshPool.length; i++) {
            this.meshPool[i].visible = false;
        }
        
        this.activeMeshes = 0;
        this.removeChildren();
        this.addChild(this.debugText);
        
        const drawBatchesLength = frameData.drawBatchesLength();
        for (let i = 0; i < drawBatchesLength; i++) {
            const batch = frameData.drawBatches(i);
            if (!batch) continue;
            
            const kind = batch.kind();
            if (kind !== DrawBatchKind.Normal && kind !== DrawBatchKind.Mesh && kind !== DrawBatchKind.Shape && kind !== DrawBatchKind.Effect) continue;
            
            const textureHash = batch.textureHash();
            const texture = this.pixiResourceManager.getTexture(textureHash) || Texture.WHITE;
            
            const startRank = batch.startRank();
            const count = batch.count();
            if (count === 0) continue;
            
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
                    
                    this.internalPlayer.geometryBuilder.buildNormal(
                        partIdx, frameData, invTexW, invTexH,
                        positions, uvs, colors, vargs
                    );
                    mesh.geometry.getBuffer('aPosition').update();
                    mesh.geometry.getBuffer('aUV').update();
                    mesh.geometry.getBuffer('aColor').update();
                    mesh.geometry.getBuffer('aVarg').update();
                    
                    mesh.shader = batchShader as any;
                    mesh.blendMode = blendMode;
                    mesh.alpha = alpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Shape) {
                const shapeVertexCounts = this.internalPlayer.runtimeManager.getShapeVertexCounts();
                
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

                    this.internalPlayer.geometryBuilder.buildShape(
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
                    mesh.alpha = alpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Mesh) {
                const meshVOff = this.internalPlayer.runtimeManager.getMeshVertexOffsets();
                const meshIOff = this.internalPlayer.runtimeManager.getMeshIndexOffsets();

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

                    this.internalPlayer.geometryBuilder.buildMesh(
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
                    mesh.alpha = alpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Effect) {
                // Effect rendering temporarily removed at user's request
                /*
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;

                    const plan = this.internalPlayer.runtimeManager.getEffectDrawPlan(partIdx);
                    if (!plan) continue;

                    const planVerts = plan.vertsArray();
                    const planUvs = plan.uvsArray();
                    const planColors = plan.colorsArray();
                    const planIndices = plan.indicesArray();
                    if (!planVerts || !planUvs || !planColors || !planIndices) continue;

                    const mOff = partIdx * 16;
                    const m00 = matrices[mOff + 0];
                    const m10 = matrices[mOff + 1];
                    const m01 = matrices[mOff + 4];
                    const m11 = matrices[mOff + 5];
                    const tx  = matrices[mOff + 12];
                    const ty  = matrices[mOff + 13];

                    const cmdCount = plan.commandsLength();
                    for (let cmdIdx = 0; cmdIdx < cmdCount; cmdIdx++) {
                        const cmd = plan.commands(cmdIdx);
                        if (!cmd) continue;

                        const texHash = cmd.cellmapHash();
                        const effectTex = this.textures.get(texHash) || Texture.WHITE;
                        const texW = effectTex.width;
                        const texH = effectTex.height;
                        const invTexW = texW > 0 ? 1.0 / texW : 1.0;
                        const invTexH = texH > 0 ? 1.0 / texH : 1.0;

                        const isAdditive = cmd.blend() === 1;
                        const blendMode = isAdditive ? 'add' : 'normal';
                        const batchShader = this.getPartsColorShader(effectTex);

                        const quadCount = cmd.quadCount();
                        const pOff = cmd.particleOffset();
                        const vOff = pOff * 4;
                        const iOff = pOff * 6;

                        const pCount = quadCount * 4;
                        const iCount = quadCount * 6;

                        const mesh = this.getMeshFromPool(this.activeMeshes, pCount, iCount);
                        this.activeMeshes++;
                        mesh.shader = batchShader as any;
                        mesh.blendMode = blendMode as any;
                        mesh.visible = true;

                        const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                        const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                        const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                        const vargs = mesh.geometry.getBuffer('aVarg').data as Float32Array;
                        const indices = mesh.geometry.getIndex().data as Uint32Array;

                        for (let v = 0; v < pCount; v++) {
                            const globalV = vOff + v;
                            const vx = planVerts[globalV * 2 + 0];
                            const vy = planVerts[globalV * 2 + 1];
                            positions[v * 2 + 0] = m00 * vx + m01 * vy + tx;
                            positions[v * 2 + 1] = m10 * vx + m11 * vy + ty;
                            
                            uvs[v * 2 + 0] = planUvs[globalV * 2 + 0] * invTexW;
                            uvs[v * 2 + 1] = planUvs[globalV * 2 + 1] * invTexH;
                            
                            colors[v * 4 + 0] = planColors[globalV * 4 + 0];
                            colors[v * 4 + 1] = planColors[globalV * 4 + 1];
                            colors[v * 4 + 2] = planColors[globalV * 4 + 2];
                            colors[v * 4 + 3] = planColors[globalV * 4 + 3];

                            vargs[v * 4 + 0] = 1.0; 
                            vargs[v * 4 + 1] = isAdditive ? 0.0 : 1.0; 
                            vargs[v * 4 + 2] = 0.0; 
                            vargs[v * 4 + 3] = isAdditive ? 1.0 : 0.0; 
                        }

                        // planIndices is quad-local 0-based (each quad has indices 0..3)
                        for (let q = 0; q < quadCount; q++) {
                            for (let j = 0; j < 6; j++) {
                                indices[q * 6 + j] = planIndices[iOff + q * 6 + j] + (q * 4);
                            }
                        }

                        mesh.geometry.getBuffer('aPosition').update();
                        mesh.geometry.getBuffer('aUV').update();
                        mesh.geometry.getBuffer('aColor').update();
                        mesh.geometry.getBuffer('aVarg').update();
                        mesh.geometry.getIndex().update();
                        
                        mesh.shader = batchShader as any;
                        mesh.blendMode = blendMode;
                        mesh.alpha = alpha;
                        mesh.visible = true;
                        this.addChild(mesh);
                    }
                }
                */
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

    private createNewMesh(requiredVertices: number, requiredIndices: number): Mesh {
        const geometry = new MeshGeometry({
            positions: new Float32Array(requiredVertices * 2),
            uvs: new Float32Array(requiredVertices * 2),
            indices: new Uint32Array(requiredIndices),
        });
        geometry.addAttribute('aColor', { buffer: new Float32Array(requiredVertices * 4), size: 4 } as any);
        geometry.addAttribute('aVarg', { buffer: new Float32Array(requiredVertices * 4), size: 4 } as any);
        
        if (requiredIndices === 12) {
            const indices = geometry.getIndex().data as Uint32Array;
            indices[0] = 0; indices[1] = 1; indices[2] = 4;
            indices[3] = 1; indices[4] = 3; indices[5] = 4;
            indices[6] = 3; indices[7] = 2; indices[8] = 4;
            indices[9] = 2; indices[10] = 0; indices[11] = 4;
        }
        
        const mesh = new Mesh({
            geometry: geometry,
            texture: Texture.WHITE
        });
        
        return mesh;
    }


}
