import { Container, Mesh, MeshGeometry, Texture, BLEND_MODES, Ticker, Text, Assets } from 'pixi.js';
import { SSRuntimeManager, SSABResource, BlendType, DrawBatchKind } from '@spritestudio/ssplayer-core';

export class SSPlayer extends Container {
    private ssManager: SSRuntimeManager;
    
    private positionData: Float32Array = new Float32Array();
    private worldPositions: Float32Array = new Float32Array(0);
    private uvData: Float32Array = new Float32Array(0);
    private colorData: Float32Array = new Float32Array(0);
    
    private meshPool: Mesh[] = [];
    private activeMeshes: number = 0;
    
    private textures: Map<number, Texture> = new Map();
    private debugText: Text;
    
    private _isPlaying: boolean = false;
    private _isPausing: boolean = false;
    private _isLoaded: boolean = false;

    constructor() {
        super();
        this.ssManager = new SSRuntimeManager();
        this.ssManager.context.set_render_mode(0); // 0 corresponds to RenderMode::Direct
        this.ssManager.context.set_coordinate_system(1); // 1 = YDown
        
        // Remove debug text by default, or keep it hidden
        this.debugText = new Text({ text: "Frame: 0", style: { fill: 0xffffff } });
        this.debugText.visible = false;
        this.addChild(this.debugText);

        Ticker.shared.add(this.update, this);
    }
    
    public override destroy(options?: any) {
        Ticker.shared.remove(this.update, this);
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
    public async load(ssabUrl: string, textureBaseUrl?: string): Promise<void> {
        // Fetch the SSAB binary
        const response = await fetch(ssabUrl);
        if (!response.ok) {
            throw new Error(`Failed to load SSAB: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        // Bind to the runtime
        const ssabResource = new SSABResource(new Uint8Array(buffer));
        this.ssManager.bindResource(ssabResource);
        
        // Extract textures and load them via Pixi Assets
        const texturePaths = SSRuntimeManager.extractTexturePaths(buffer);
        
        const baseDir = textureBaseUrl || ssabUrl.substring(0, ssabUrl.lastIndexOf('/'));
        const prefix = baseDir ? baseDir + '/' : '';
        
        const promises = texturePaths.map(async (info) => {
            const texUrl = prefix + info.path;
            const tex = await Assets.load<Texture>(texUrl);
            this.textures.set(info.hash, tex);
        });
        
        await Promise.all(promises);
        this._isLoaded = true;
    }

    /**
     * Sets the animation to play
     * @param animationName Name of the animation inside the SSAB
     * @param loop Number of loops (0 = infinite)
     */
    public playAnimation(animationName: string, loop: number = 0) {
        if (!this._isLoaded) {
            console.warn("SSPlayer: Call load() before playAnimation()");
            return;
        }
        this.ssManager.context.setup_animation(animationName);
        this.ssManager.context.set_loop(loop);
        this.ssManager.context.play();
        this._isPlaying = true;
        this._isPausing = false;
    }

    public play() {
        this._isPlaying = true;
        this._isPausing = false;
    }

    public pause() {
        this._isPausing = true;
    }

    public stop() {
        this._isPlaying = false;
    }
    
    public setTexture(textureHash: number, texture: Texture) {
        this.textures.set(textureHash, texture);
    }

    private update(ticker: Ticker) {
        if (!this._isPlaying || this._isPausing || !this._isLoaded) return;
        
        const deltaMs = ticker.deltaMS;
        
        // Update wasm state
        this.ssManager.context.update(deltaMs);
        const frameNo = Math.floor(this.ssManager.context.get_frame_no());
        
        if (this.debugText.visible) {
            this.debugText.text = `Frame: ${frameNo} (dt: ${deltaMs.toFixed(2)}ms)`;
        }
        
        this.renderFrame(frameNo);
    }

    private renderFrame(frameNo: number) {
        const frameData = this.ssManager.getFrameData(frameNo);
        if (!frameData) return;
        
        // Zero-copy buffers
        const posPtr = this.ssManager.context.get_local_vertices_buf();
        const posLen = this.ssManager.context.get_local_vertices_len();
        
        if (posPtr && posLen > 0) {
            this.positionData = this.ssManager.getFloat32Array(posPtr, posLen);
        }
        
        const uvPtr = this.ssManager.context.get_local_uvs_buf();
        const uvLen = this.ssManager.context.get_local_uvs_len();
        if (uvPtr && uvLen > 0) {
            this.uvData = this.ssManager.getFloat32Array(uvPtr, uvLen);
        }

        const matrices = this.ssManager.getWorldMatrices();
        if (this.worldPositions.length !== this.positionData.length) {
            this.worldPositions = new Float32Array(this.positionData.length);
        }
        
        // Fetch mesh buffers
        const meshVx = this.ssManager.getMeshVerticesX();
        const meshVy = this.ssManager.getMeshVerticesY();
        const meshUv = this.ssManager.getMeshUVs();
        const meshIdx = this.ssManager.getMeshIndices();
        const meshVOff = this.ssManager.getMeshVertexOffsets();
        const meshIOff = this.ssManager.getMeshIndexOffsets();

        // Compute world coordinates for normal parts
        for (let i = 0; i < matrices.length / 16; i++) {
            const mOff = i * 16;
            const vOff = i * 10;
            
            const m00 = matrices[mOff + 0];
            const m10 = matrices[mOff + 1];
            const m01 = matrices[mOff + 4];
            const m11 = matrices[mOff + 5];
            const tx  = matrices[mOff + 12];
            const ty  = matrices[mOff + 13];
            
            for (let v = 0; v < 5; v++) {
                const vx = this.positionData[vOff + v * 2];
                const vy = this.positionData[vOff + v * 2 + 1];
                
                this.worldPositions[vOff + v * 2] = m00 * vx + m01 * vy + tx;
                this.worldPositions[vOff + v * 2 + 1] = m10 * vx + m11 * vy + ty;
            }
        }

        const drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;
        
        // Hide all meshes in the pool
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
            if (kind !== DrawBatchKind.Normal && kind !== DrawBatchKind.Mesh) continue;
            
            const textureHash = batch.textureHash();
            const texture = this.textures.get(textureHash) || Texture.WHITE;
            
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
            
            if (kind === DrawBatchKind.Normal) {
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const srcBase = partIdx * 10;
                    
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue; // Skip invisible parts
                    
                    let mesh = this.getMeshFromPool(this.activeMeshes);
                    this.activeMeshes++;
                    
                    const posBuffer = mesh.geometry.getBuffer('aPosition');
                    const positions = posBuffer.data as Float32Array;
                    const uvBuffer = mesh.geometry.getBuffer('aUV');
                    const uvs = uvBuffer.data as Float32Array;
                    
                    for (let j = 0; j < 5; j++) {
                        positions[j * 2] = this.worldPositions[srcBase + j * 2];
                        positions[j * 2 + 1] = this.worldPositions[srcBase + j * 2 + 1];
                        uvs[j * 2] = this.uvData[srcBase + j * 2] * invTexW;
                        uvs[j * 2 + 1] = this.uvData[srcBase + j * 2 + 1] * invTexH;
                    }
                    
                    posBuffer.update();
                    uvBuffer.update();
                    
                    mesh.texture = texture;
                    mesh.blendMode = blendMode;
                    mesh.alpha = alpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            } else if (kind === DrawBatchKind.Mesh) {
                // Mesh parts are already contiguous per batch? No, they can be multiple mesh parts.
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
                    
                    const posBuffer = mesh.geometry.getBuffer('aPosition');
                    const positions = posBuffer.data as Float32Array;
                    const uvBuffer = mesh.geometry.getBuffer('aUV');
                    const uvs = uvBuffer.data as Float32Array;
                    const indexBuffer = mesh.geometry.getIndex();
                    const indices = indexBuffer.data as Uint32Array;
                    
                    for (let v = 0; v < pCount; v++) {
                        positions[v * 2] = meshVx[v0 + v];
                        positions[v * 2 + 1] = meshVy[v0 + v];
                        uvs[v * 2] = meshUv[(v0 + v) * 2] * invTexW;
                        uvs[v * 2 + 1] = meshUv[(v0 + v) * 2 + 1] * invTexH;
                    }
                    for (let j = 0; j < iCount; j++) {
                        indices[j] = meshIdx[i0 + j];
                    }
                    
                    posBuffer.update();
                    uvBuffer.update();
                    indexBuffer.update();
                    
                    mesh.texture = texture;
                    mesh.blendMode = blendMode;
                    mesh.alpha = alpha;
                    mesh.visible = true;
                    this.addChild(mesh);
                }
            }
        }
    }
    
    private getMeshFromPool(index: number, requiredVertices: number = 5, requiredIndices: number = 12): Mesh {
        if (index < this.meshPool.length) {
            const m = this.meshPool[index];
            const pBuf = m.geometry.getBuffer('aPosition');
            const iBuf = m.geometry.getIndex();
            // Re-allocate buffers if the required size is different (useful for Mesh parts)
            if (pBuf.data.length !== requiredVertices * 2 || iBuf.data.length !== requiredIndices) {
                pBuf.data = new Float32Array(requiredVertices * 2);
                m.geometry.getBuffer('aUV').data = new Float32Array(requiredVertices * 2);
                iBuf.data = new Uint32Array(requiredIndices);
            }
            // For normal parts, always ensure index buffer matches normal part topology
            if (requiredIndices === 12) {
                const indices = iBuf.data as Uint32Array;
                indices[0] = 0; indices[1] = 1; indices[2] = 4;
                indices[3] = 1; indices[4] = 3; indices[5] = 4;
                indices[6] = 3; indices[7] = 2; indices[8] = 4;
                indices[9] = 2; indices[10] = 0; indices[11] = 4;
            }
            return m;
        }
        
        const geometry = new MeshGeometry({
            positions: new Float32Array(requiredVertices * 2),
            uvs: new Float32Array(requiredVertices * 2),
            indices: new Uint32Array(requiredIndices),
        });
        
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
        
        this.meshPool.push(mesh);
        return mesh;
    }


}
