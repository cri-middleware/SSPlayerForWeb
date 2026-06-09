import { Container, Mesh, MeshGeometry, Texture, BLEND_MODES, Ticker, Text, Assets, Shader } from 'pixi.js';
import { SSRuntimeManager, SSABResource, BlendType, DrawBatchKind } from '@spritestudio/ssplayer-core';
import { PartsColorShader } from './PartsColorShader.js';

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
    private partsColorShaders: Map<Texture, Shader> = new Map();
    private _subframe: boolean = false;
    
    public get subframe(): boolean {
        return this._subframe;
    }
    public set subframe(value: boolean) {
        this._subframe = value;
    }
    
    public get animationSpeed(): number {
        return this.ssManager.context.get_active_event_instance(0).speed;
    }
    public set animationSpeed(speed: number) {
        this.ssManager.context.set_animation_speed(speed);
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
    private _isPlaying: boolean = false;
    private _isPausing: boolean = false;
    private _ssabUrl?: string;
    private _textureBaseUrl?: string;
    private ssabResource?: SSABResource;
    private _texturePaths: { hash: number, path: string }[] = [];

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
        this._ssabUrl = ssabUrl;
        this._textureBaseUrl = textureBaseUrl;

        // Fetch the SSAB binary
        const response = await fetch(ssabUrl);
        if (!response.ok) {
            throw new Error(`Failed to load SSAB: ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        
        // Bind to the runtime
        this.ssabResource = new SSABResource(new Uint8Array(buffer));
        this.ssManager.bindResource(this.ssabResource);
        
        // Extract texture paths to load later
        this._texturePaths = SSRuntimeManager.extractTexturePaths(buffer);
        
        this._isLoaded = true;
    }

    /**
     * Set the animation to play
     * @param animationName Name of the animation inside the SSAB
     * @param loop Number of loops (0 = infinite)
     */
    public async setAnimation(animationName: string, loop: number = 0, textureBaseUrl?: string) {
        if (!this._isLoaded) {
            console.warn("SSPlayer: Call load() before setAnimation()");
            return;
        }

        const baseDir = textureBaseUrl || this._textureBaseUrl || (this._ssabUrl ? this._ssabUrl.substring(0, this._ssabUrl.lastIndexOf('/')) : '');
        const prefix = baseDir ? baseDir + '/' : '';

        const promises = this._texturePaths.map(async (info) => {
            if (!this.textures.has(info.hash)) {
                const texUrl = prefix + info.path;
                try {
                    const tex = await Assets.load<Texture>(texUrl);
                    this.textures.set(info.hash, tex);
                } catch (e) {
                    console.error(`Failed to load texture: ${texUrl}`, e);
                }
            }
        });

        await Promise.all(promises);

        this.ssManager.context.setup_animation(animationName);
        this.ssManager.context.set_loop(loop);
        
        // Ensure geometry buffers are re-allocated/cleared if needed?
        // Usually handled during renderFrame
    }

    public play() {
        if (!this._isLoaded) return;
        this.ssManager.context.play();
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
        
        const meshVx = this.ssManager.getMeshVerticesX();
        const meshVy = this.ssManager.getMeshVerticesY();
        const meshUv = this.ssManager.getMeshUVs();
        const meshIdx = this.ssManager.getMeshIndices();
        const meshVOff = this.ssManager.getMeshVertexOffsets();
        const meshIOff = this.ssManager.getMeshIndexOffsets();
        
        

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
            if (kind !== DrawBatchKind.Normal && kind !== DrawBatchKind.Mesh && kind !== DrawBatchKind.Shape) continue;
            
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
            
            const batchShader = this.getPartsColorShader(texture);
            
            if (kind === DrawBatchKind.Normal) {
                for (let c = 0; c < count; c++) {
                    const partIdx = drawOrder[startRank + c];
                    const srcBase = partIdx * 10;
                    
                    const partState = frameData.parts(partIdx);
                    const alpha = partState ? partState.alpha() : 1.0;
                    if (alpha <= 0) continue;
                    
                    let mesh = this.getMeshFromPool(this.activeMeshes);
                    this.activeMeshes++;
                    
                    const positions = mesh.geometry.getBuffer('aPosition').data as Float32Array;
                    const uvs = mesh.geometry.getBuffer('aUV').data as Float32Array;
                    const colors = mesh.geometry.getBuffer('aColor').data as Float32Array;
                    const vargs = mesh.geometry.getBuffer('aVarg').data as Float32Array;
                    
                    const pc = (partState && partState.partColor() >= 0) ? frameData.partsColor(partState.partColor()) : null;
                    const mOff = partIdx * 16;
                    
                    let pc_rates = [1, 1, 1, 1, 1];
                    let pc_colors = [[1,1,1,1], [1,1,1,1], [1,1,1,1], [1,1,1,1], [1,1,1,1]];
                    let pc_blendType = BlendType.Mix;
                    let hasPc = false;

                    if (pc) {
                        hasPc = true;
                        pc_blendType = pc.blendType();
                        const lt = pc.lt(); const lt_rgba = lt?.rgba();
                        const rt = pc.rt(); const rt_rgba = rt?.rgba();
                        const lb = pc.lb(); const lb_rgba = lb?.rgba();
                        const rb = pc.rb(); const rb_rgba = rb?.rgba();
                        
                        pc_rates[0] = lt?.rate() || 0;
                        pc_rates[1] = rt?.rate() || 0;
                        pc_rates[2] = lb?.rate() || 0;
                        pc_rates[3] = rb?.rate() || 0;
                        pc_rates[4] = (pc_rates[0] + pc_rates[1] + pc_rates[2] + pc_rates[3]) / 4.0;
                        
                        const toColor = (rgba: any) => rgba ? [rgba.r()/255.0, rgba.g()/255.0, rgba.b()/255.0, rgba.a()/255.0] : [1,1,1,1];
                        pc_colors[0] = toColor(lt_rgba);
                        pc_colors[1] = toColor(rt_rgba);
                        pc_colors[2] = toColor(lb_rgba);
                        pc_colors[3] = toColor(rb_rgba);
                        pc_colors[4] = [
                            (pc_colors[0][0] + pc_colors[1][0] + pc_colors[2][0] + pc_colors[3][0]) / 4.0,
                            (pc_colors[0][1] + pc_colors[1][1] + pc_colors[2][1] + pc_colors[3][1]) / 4.0,
                            (pc_colors[0][2] + pc_colors[1][2] + pc_colors[2][2] + pc_colors[3][2]) / 4.0,
                            (pc_colors[0][3] + pc_colors[1][3] + pc_colors[2][3] + pc_colors[3][3]) / 4.0,
                        ];
                    }

                    for (let j = 0; j < 5; j++) {
                        positions[j * 2] = this.worldPositions[srcBase + j * 2];
                        positions[j * 2 + 1] = this.worldPositions[srcBase + j * 2 + 1];
                        uvs[j * 2] = this.uvData[srcBase + j * 2] * invTexW;
                        uvs[j * 2 + 1] = this.uvData[srcBase + j * 2 + 1] * invTexH;
                        
                        if (hasPc) {
                            colors[j * 4 + 0] = pc_colors[j][0];
                            colors[j * 4 + 1] = pc_colors[j][1];
                            colors[j * 4 + 2] = pc_colors[j][2];
                            colors[j * 4 + 3] = pc_colors[j][3];
                            vargs[j * 4 + 0] = pc_rates[j];
                            vargs[j * 4 + 1] = pc_blendType === BlendType.Mix ? 1 : 0;
                            vargs[j * 4 + 2] = pc_blendType === BlendType.Mul ? 1 : 0;
                            vargs[j * 4 + 3] = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);
                        } else {
                            colors[j * 4 + 0] = 1.0; colors[j * 4 + 1] = 1.0; colors[j * 4 + 2] = 1.0; colors[j * 4 + 3] = 1.0;
                            vargs[j * 4 + 0] = 1.0; vargs[j * 4 + 1] = 0; vargs[j * 4 + 2] = 1.0; vargs[j * 4 + 3] = 0;
                        }
                    }
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
                const shapeVertices = this.ssManager.getShapeVertices();
                const shapeVertexBoxCoords = this.ssManager.getShapeVertexBoxCoords();
                const shapeVertexCounts = this.ssManager.getShapeVertexCounts();
                const SHAPE_VERTICES_STRIDE = 24; // 24 floats max per shape (12 vertices max)
                
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

                    const srcBase = partIdx * SHAPE_VERTICES_STRIDE; // 24 floats max

                    const pc = (partState && partState.partColor() >= 0) ? frameData.partsColor(partState.partColor()) : null;
                    
                    let ltColor = [1,1,1,1], rtColor = [1,1,1,1], lbColor = [1,1,1,1], rbColor = [1,1,1,1];
                    let ltRate = 0, rtRate = 0, lbRate = 0, rbRate = 0;
                    let pc_blendType = BlendType.Mix;
                    
                    if (pc) {
                        pc_blendType = pc.blendType();
                        const toColor = (attr: any) => {
                            if (!attr || !attr.rgba()) return { c: [1,1,1,1], r: 0 };
                            const rgba = attr.rgba();
                            return {
                                c: [rgba.r()/255.0, rgba.g()/255.0, rgba.b()/255.0, rgba.a()/255.0],
                                r: attr.rate()
                            };
                        };
                        const clt = toColor(pc.lt()); ltColor = clt.c; ltRate = clt.r;
                        const crt = toColor(pc.rt()); rtColor = crt.c; rtRate = crt.r;
                        const clb = toColor(pc.lb()); lbColor = clb.c; lbRate = clb.r;
                        const crb = toColor(pc.rb()); rbColor = crb.c; rbRate = crb.r;
                    }

                    const mOff = partIdx * 16;
                    const m00 = matrices[mOff + 0];
                    const m10 = matrices[mOff + 1];
                    const m01 = matrices[mOff + 4];
                    const m11 = matrices[mOff + 5];
                    const tx  = matrices[mOff + 12];
                    const ty  = matrices[mOff + 13];

                    for (let v = 0; v < numVerts; v++) {
                        const vx = shapeVertices[srcBase + v * 2 + 0];
                        const vy = shapeVertices[srcBase + v * 2 + 1];
                        const fx = shapeVertexBoxCoords[srcBase + v * 2 + 0];
                        const fy = shapeVertexBoxCoords[srcBase + v * 2 + 1];
                        
                        // Bilinear interpolation for colors
                        const topColor = [
                            ltColor[0] + (rtColor[0] - ltColor[0]) * fx,
                            ltColor[1] + (rtColor[1] - ltColor[1]) * fx,
                            ltColor[2] + (rtColor[2] - ltColor[2]) * fx,
                            ltColor[3] + (rtColor[3] - ltColor[3]) * fx,
                        ];
                        const bottomColor = [
                            lbColor[0] + (rbColor[0] - lbColor[0]) * fx,
                            lbColor[1] + (rbColor[1] - lbColor[1]) * fx,
                            lbColor[2] + (rbColor[2] - lbColor[2]) * fx,
                            lbColor[3] + (rbColor[3] - lbColor[3]) * fx,
                        ];
                        
                        const cr = topColor[0] + (bottomColor[0] - topColor[0]) * fy;
                        const cg = topColor[1] + (bottomColor[1] - topColor[1]) * fy;
                        const cb = topColor[2] + (bottomColor[2] - topColor[2]) * fy;
                        const ca = topColor[3] + (bottomColor[3] - topColor[3]) * fy;

                        const topRate = ltRate + (rtRate - ltRate) * fx;
                        const bottomRate = lbRate + (rbRate - lbRate) * fx;
                        const mixRate = topRate + (bottomRate - topRate) * fy;

                        positions[v * 2 + 0] = m00 * vx + m01 * vy + tx;
                        positions[v * 2 + 1] = m10 * vx + m11 * vy + ty;
                        
                        // UV mapping
                        if (partState && partState.cell() >= 0) {
                            const uvBase = partIdx * 10;
                            // us: center, top-left, top-right, bottom-left, bottom-right
                            // vs: center, top-left, top-right, bottom-left, bottom-right
                            // 0: center, 2: tl, 4: tr, 6: bl, 8: br
                            const tlU = this.uvData[uvBase + 2]; const tlV = this.uvData[uvBase + 3];
                            const trU = this.uvData[uvBase + 4]; const trV = this.uvData[uvBase + 5];
                            const blU = this.uvData[uvBase + 6]; const blV = this.uvData[uvBase + 7];
                            const brU = this.uvData[uvBase + 8]; const brV = this.uvData[uvBase + 9];
                            
                            const topU = tlU + (trU - tlU) * fx;
                            const topV = tlV + (trV - tlV) * fx;
                            const bottomU = blU + (brU - blU) * fx;
                            const bottomV = blV + (brV - blV) * fx;
                            
                            uvs[v * 2 + 0] = (topU + (bottomU - topU) * fy) / texture.width;
                            uvs[v * 2 + 1] = (topV + (bottomV - topV) * fy) / texture.height;
                        } else {
                            uvs[v * 2 + 0] = 0.5;
                            uvs[v * 2 + 1] = 0.5;
                        }
                        
                        // Color
                        colors[v * 4 + 0] = cr;
                        colors[v * 4 + 1] = cg;
                        colors[v * 4 + 2] = cb;
                        colors[v * 4 + 3] = ca;
                        
                        vargs[v * 4 + 0] = mixRate;
                        vargs[v * 4 + 1] = pc_blendType === BlendType.Mix ? 1 : 0;
                        vargs[v * 4 + 2] = pc_blendType === BlendType.Mul ? 1 : 0;
                        vargs[v * 4 + 3] = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);
                    }

                    // Indices (Triangle Fan)
                    let indexCursor = 0;
                    for (let j = 1; j < numVerts - 1; j++) {
                        indices[indexCursor++] = 0;
                        indices[indexCursor++] = j;
                        indices[indexCursor++] = j + 1;
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
            } else if (kind === DrawBatchKind.Mesh) {
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
                    
                    const pc = (partState && partState.partColor() >= 0) ? frameData.partsColor(partState.partColor()) : null;
                    
                    let pc_rate = 1;
                    let pc_color = [1,1,1,1];
                    let pc_blendType = BlendType.Mix;
                    let hasPc = false;

                    if (pc) {
                        hasPc = true;
                        pc_blendType = pc.blendType();
                        const lt = pc.lt(); const lt_rgba = lt?.rgba();
                        pc_rate = lt?.rate() || 0;
                        if (lt_rgba) {
                            pc_color = [lt_rgba.r()/255.0, lt_rgba.g()/255.0, lt_rgba.b()/255.0, lt_rgba.a()/255.0];
                        }
                    }

                    for (let v = 0; v < pCount; v++) {
                        positions[v * 2] = meshVx[v0 + v];
                        positions[v * 2 + 1] = meshVy[v0 + v];
                        uvs[v * 2] = meshUv[(v0 + v) * 2] * invTexW;
                        uvs[v * 2 + 1] = meshUv[(v0 + v) * 2 + 1] * invTexH;
                        
                        if (hasPc) {
                            colors[v * 4 + 0] = pc_color[0];
                            colors[v * 4 + 1] = pc_color[1];
                            colors[v * 4 + 2] = pc_color[2];
                            colors[v * 4 + 3] = pc_color[3];
                            vargs[v * 4 + 0] = pc_rate;
                            vargs[v * 4 + 1] = pc_blendType === BlendType.Mix ? 1 : 0;
                            vargs[v * 4 + 2] = pc_blendType === BlendType.Mul ? 1 : 0;
                            vargs[v * 4 + 3] = pc_blendType === BlendType.Add ? 1 : (pc_blendType === BlendType.Sub ? -1 : 0);
                        } else {
                            colors[v * 4 + 0] = 1.0; colors[v * 4 + 1] = 1.0; colors[v * 4 + 2] = 1.0; colors[v * 4 + 3] = 1.0;
                            vargs[v * 4 + 0] = 1.0; vargs[v * 4 + 1] = 0; vargs[v * 4 + 2] = 1.0; vargs[v * 4 + 3] = 0;
                        }
                    }
                    for (let j = 0; j < iCount; j++) {
                        indices[j] = meshIdx[i0 + j];
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
        }
    }

    private getMeshFromPool(index: number, requiredVertices: number = 5, requiredIndices: number = 12): Mesh {
        if (index < this.meshPool.length) {
            const m = this.meshPool[index];
            const pBuf = m.geometry.getBuffer('aPosition');
            const iBuf = m.geometry.getIndex();
            if (pBuf.data.length !== requiredVertices * 2 || iBuf.data.length !== requiredIndices) {
                pBuf.data = new Float32Array(requiredVertices * 2);
                m.geometry.getBuffer('aUV').data = new Float32Array(requiredVertices * 2);
                m.geometry.getBuffer('aColor').data = new Float32Array(requiredVertices * 4);
                m.geometry.getBuffer('aVarg').data = new Float32Array(requiredVertices * 4);
                iBuf.data = new Uint32Array(requiredIndices);
            }
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
        
        this.meshPool.push(mesh);
        return mesh;
    }


}
