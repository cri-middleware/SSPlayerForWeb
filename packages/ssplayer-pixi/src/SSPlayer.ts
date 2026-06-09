import { Container, Mesh, MeshGeometry, Texture, BLEND_MODES, Ticker, Text } from 'pixi.js';
import { SSRuntimeManager, BlendType, DrawBatchKind } from '@spritestudio/ssplayer-core';

export class SSPlayer extends Container {
    public readonly ssManager: SSRuntimeManager;
    
    private positionData: Float32Array = new Float32Array(0);
    private worldPositions: Float32Array = new Float32Array(0);
    private uvData: Float32Array = new Float32Array(0);
    private colorData: Float32Array = new Float32Array(0);
    
    private meshPool: Mesh[] = [];
    private activeMeshes: number = 0;
    
    private textures: Map<number, Texture> = new Map();
    private debugText: Text;
    
    private _startFrame: number = 0;
    private _endFrame: number = 0;
    private _currentFrame: number = 0;
    private _isPlaying: boolean = false;
    private _isPausing: boolean = false;
    private playDirection: number = 1;
    private updateInterval: number = 1000 / 60;
    private nextFrameTime: number = 0;

    constructor(ssManager: SSRuntimeManager) {
        super();
        this.ssManager = ssManager;
        this.ssManager.context.set_render_mode(0); // 0 corresponds to RenderMode::Direct
        this.ssManager.context.set_coordinate_system(1); // 1 = YDown
        
        this.debugText = new Text({ text: "Frame: 0", style: { fill: 0xffffff } });
        this.addChild(this.debugText);

        // Add to ticker directly
        Ticker.shared.add(this.update, this);
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
        if (!this._isPlaying || this._isPausing) return;
        
        const deltaMs = ticker.deltaMS;
        
        // Update wasm state
        this.ssManager.context.update(deltaMs);
        const frameNo = Math.floor(this.ssManager.context.get_frame_no());
        
        this.debugText.text = `Frame: ${frameNo} (dt: ${deltaMs.toFixed(2)}ms)`;
        
        this.renderFrame(frameNo);
    }

    private renderFrame(frameNo: number) {
        const frameData = this.ssManager.getFrameData(frameNo);
        if (!frameData) return;
        
        // Zero-copy buffers
        const posPtr = this.ssManager.context.get_local_vertices_buf();
        const posLen = this.ssManager.context.get_local_vertices_len();
        const uvPtr = this.ssManager.context.get_local_uvs_buf();
        const uvLen = this.ssManager.context.get_local_uvs_len();
        
        if (posPtr && posLen > 0) {
            // Memory is from WASM, zero copy
            this.positionData = this.ssManager.getFloat32Array(posPtr, posLen);
        }
        
        if (uvPtr && uvLen > 0) {
            this.uvData = this.ssManager.getFloat32Array(uvPtr, uvLen);
        }

        const drawBatchesLength = frameData.drawBatchesLength();
        const drawOrder = frameData.drawOrderArray();
        if (!drawOrder) return;

        const matrices = this.ssManager.getWorldMatrices();
        if (this.worldPositions.length !== this.positionData.length) {
            this.worldPositions = new Float32Array(this.positionData.length);
        }

        const partCount = this.positionData.length / 10;
        for (let i = 0; i < partCount; i++) {
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
                this.worldPositions[vOff + v * 2] = vx * m00 + vy * m01 + tx;
                this.worldPositions[vOff + v * 2 + 1] = vx * m10 + vy * m11 + ty;
            }
        }

        this.activeMeshes = 0;
        this.removeChildren();
        this.addChild(this.debugText);

        for (let i = 0; i < drawBatchesLength; i++) {
            const batch = frameData.drawBatches(i);
            if (!batch) continue;
            
            const kind = batch.kind();
            if (kind !== DrawBatchKind.Normal && kind !== DrawBatchKind.Mesh) {
                // Ignore mask or other types for now, add support later
                continue;
            }

            const textureHash = batch.textureHash();
            const texture = this.textures.get(textureHash) || Texture.WHITE;
            
            const startRank = batch.startRank();
            const count = batch.count();
            
            const numParts = count;
            const numVerts = numParts * 5;
            const numIndices = numParts * 12;
            
            const batchPositions = new Float32Array(numVerts * 2);
            const batchUVs = new Float32Array(numVerts * 2);
            const batchIndices = new Uint32Array(numIndices);
            
            let idxOffset = 0;
            
            const invTexW = 1.0 / texture.width;
            const invTexH = 1.0 / texture.height;

            for (let c = 0; c < count; c++) {
                const partIdx = drawOrder[startRank + c];
                const srcBase = partIdx * 10; // 5 vertices * 2 floats
                const dstBase = c * 10;
                
                // Copy positions and normalize UVs for this part
                for (let i = 0; i < 5; i++) {
                    batchPositions[dstBase + i * 2] = this.worldPositions[srcBase + i * 2];
                    batchPositions[dstBase + i * 2 + 1] = this.worldPositions[srcBase + i * 2 + 1];
                    batchUVs[dstBase + i * 2] = this.uvData[srcBase + i * 2] * invTexW;
                    batchUVs[dstBase + i * 2 + 1] = this.uvData[srcBase + i * 2 + 1] * invTexH;
                }
                
                const baseVert = c * 5; // local to this batch
                
                // Assuming 5 vertices per part
                batchIndices[idxOffset++] = baseVert + 0;
                batchIndices[idxOffset++] = baseVert + 1;
                batchIndices[idxOffset++] = baseVert + 4;
                
                batchIndices[idxOffset++] = baseVert + 1;
                batchIndices[idxOffset++] = baseVert + 3;
                batchIndices[idxOffset++] = baseVert + 4;
                
                batchIndices[idxOffset++] = baseVert + 3;
                batchIndices[idxOffset++] = baseVert + 2;
                batchIndices[idxOffset++] = baseVert + 4;
                
                batchIndices[idxOffset++] = baseVert + 2;
                batchIndices[idxOffset++] = baseVert + 0;
                batchIndices[idxOffset++] = baseVert + 4;
            }

            const mesh = this.getMesh(texture);
            mesh.texture = texture;
            mesh.blendMode = this.getPixiBlendMode(batch.blendType());
            
            // In PixiJS v8, explicitly update buffers
            const posBuffer = mesh.geometry.getBuffer('aPosition');
            posBuffer.data = batchPositions;
            posBuffer.update();

            const uvBuffer = mesh.geometry.getBuffer('aUV');
            uvBuffer.data = batchUVs;
            uvBuffer.update();

            const indexBuffer = mesh.geometry.getIndex();
            indexBuffer.data = batchIndices;
            indexBuffer.update();
            
            this.addChild(mesh);
        }
    }

    private getMesh(texture: Texture): Mesh {
        if (this.activeMeshes < this.meshPool.length) {
            return this.meshPool[this.activeMeshes++];
        }
        
        const geometry = new MeshGeometry({
            positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
            indices: new Uint32Array([0, 1, 2, 0, 2, 3])
        });
        
        const mesh = new Mesh({ geometry, texture });
        this.meshPool.push(mesh);
        this.activeMeshes++;
        return mesh;
    }

    private getPixiBlendMode(blendType: number): BLEND_MODES {
        switch (blendType) {
            case BlendType.Mix: return 'normal';
            case BlendType.Mul: return 'multiply';
            case BlendType.Add: return 'add';
            case BlendType.Sub: return 'subtract';
            case BlendType.Mulalpha: return 'multiply';
            case BlendType.Screen: return 'screen';
            case BlendType.Exclusion: return 'exclusion';
            case BlendType.Invert: return 'normal'; // fallback
            default: return 'normal';
        }
    }
}
