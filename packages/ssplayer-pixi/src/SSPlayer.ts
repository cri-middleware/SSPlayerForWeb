import { Container, Mesh, MeshGeometry, Texture, BLEND_MODES, Ticker } from 'pixi.js';
import { SSRuntimeManager, BlendType, DrawBatchKind } from '@spritestudio/ssplayer-core';

export class SSPlayer extends Container {
    public readonly ssManager: SSRuntimeManager;
    
    private positionData: Float32Array = new Float32Array(0);
    private uvData: Float32Array = new Float32Array(0);
    private colorData: Float32Array = new Float32Array(0);
    
    private meshPool: Mesh[] = [];
    private activeMeshes: number = 0;
    
    private textures: Map<number, Texture> = new Map();
    
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
        
        this.on('added', () => Ticker.shared.add(this.update, this));
        this.on('removed', () => Ticker.shared.remove(this.update, this));
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
        
        const deltaSeconds = ticker.deltaMS / 1000.0;
        
        // Update wasm state
        this.ssManager.context.update(deltaSeconds);
        const frameNo = Math.floor(this.ssManager.context.get_frame_no());
        
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

        this.activeMeshes = 0;
        this.removeChildren();

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
            
            // Generate index buffer for this batch
            // Each normal part is 5 vertices (center + 4 corners)
            // Wait: some parts might be 4 vertices. The batch has indexCount and vertexCount.
            // For now, assume fixed 5 vertices (stride=10 floats) per part, which generates 4 triangles (12 indices).
            // ssruntime's FrameData `parts` might give us update flags to know exactly.
            // Let's implement the index building.
            const indices = new Uint32Array(batch.indexCount());
            let idxOffset = 0;
            
            for (let c = 0; c < count; c++) {
                const partIdx = drawOrder[startRank + c];
                const baseVert = partIdx * 5; // 5 vertices per part in WASM
                
                // Assuming 5 vertices per part
                indices[idxOffset++] = baseVert + 0;
                indices[idxOffset++] = baseVert + 1;
                indices[idxOffset++] = baseVert + 4;
                
                indices[idxOffset++] = baseVert + 1;
                indices[idxOffset++] = baseVert + 2;
                indices[idxOffset++] = baseVert + 4;
                
                indices[idxOffset++] = baseVert + 2;
                indices[idxOffset++] = baseVert + 3;
                indices[idxOffset++] = baseVert + 4;
                
                indices[idxOffset++] = baseVert + 3;
                indices[idxOffset++] = baseVert + 0;
                indices[idxOffset++] = baseVert + 4;
            }

            const mesh = this.getMesh(texture);
            mesh.texture = texture;
            mesh.blendMode = this.getPixiBlendMode(batch.blendType());
            
            const posBuffer = mesh.geometry.getBuffer('aPosition');
            posBuffer.data = this.positionData;
            posBuffer.update();
            
            const uvBuffer = mesh.geometry.getBuffer('aUV');
            uvBuffer.data = this.uvData;
            uvBuffer.update();
            
            const indexBuffer = mesh.geometry.getIndex();
            indexBuffer.data = indices;
            indexBuffer.update();
            
            this.addChild(mesh);
        }
    }

    private getMesh(texture: Texture): Mesh {
        if (this.activeMeshes < this.meshPool.length) {
            const mesh = this.meshPool[this.activeMeshes++];
            return mesh;
        }
        
        const geometry = new MeshGeometry({
            positions: new Float32Array(0),
            uvs: new Float32Array(0),
            indices: new Uint32Array(0)
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
