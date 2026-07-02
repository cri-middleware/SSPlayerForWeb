import { GeometryBuilder, SSRuntimeManager, InternalPlayerBase, DirectInternalPlayer, DrawBatchKind, getWasmMemory } from '@spritestudio/ssplayer-core';
import { PartsColorProgram } from './programs/PartsColorProgram.js';
import type { SSWebGLResourceManager } from './SSWebGLResourceManager.js';

export class SSWebGLRenderer {
  public gl: WebGLRenderingContext | WebGL2RenderingContext;
  private partsColorProgram: PartsColorProgram;
  
  private posBuffer: WebGLBuffer;
  private uvBuffer: WebGLBuffer;
  private colorBuffer: WebGLBuffer;
  private vargBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;

  // Batch arrays for GeometryBuilder
  private batchPos = new Float32Array(512 * 2);
  private batchUv = new Float32Array(512 * 2);
  private batchColor = new Float32Array(512 * 4);
  private batchVarg = new Float32Array(512 * 4);
  private batchIndices = new Uint16Array(512 * 3);
  
  // For Effect batching
  private _fxDesc: { partIdx: number, plan: any, cellmap: number, blend: number, quadCount: number, particleOffset: number, partAlpha: number }[] = [];
  private _fxCount = 0;
  private _whiteTex: WebGLTexture | null = null;

  private scratchMatrix = new Float32Array(6);

  // Normal has 12 indices
  private normalIndices = new Uint16Array([
    0, 1, 4,
    1, 3, 4,
    3, 2, 4,
    2, 0, 4
  ]);

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;
    this.partsColorProgram = new PartsColorProgram(gl);

    this.posBuffer = gl.createBuffer()!;
    this.uvBuffer = gl.createBuffer()!;
    this.colorBuffer = gl.createBuffer()!;
    this.vargBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    // Removed static upload of normalIndices because we will dynamically batch indices
  }

  private ensureBatchCapacity(vCount: number, iCount: number) {
    if (this.batchPos.length < vCount * 2) {
      let newLen = this.batchPos.length;
      while (newLen < vCount * 2) newLen *= 2;
      this.batchPos = new Float32Array(newLen);
      this.batchUv = new Float32Array(newLen);
    }
    if (this.batchColor.length < vCount * 4) {
      let newLen = this.batchColor.length;
      while (newLen < vCount * 4) newLen *= 2;
      this.batchColor = new Float32Array(newLen);
      this.batchVarg = new Float32Array(newLen);
    }
    if (this.batchIndices.length < iCount) {
      let newLen = this.batchIndices.length;
      while (newLen < iCount) newLen *= 2;
      this.batchIndices = new Uint16Array(newLen);
    }
  }

  private getWhiteTexture(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLTexture {
    if (!this._whiteTex) {
      this._whiteTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this._whiteTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    return this._whiteTex;
  }

  public render(player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager, transform: Float32Array): void {
    if (!player.animationName) return;

    const gl = this.gl;
    const frameNo = player.getFrameNo();
    let fd = player.runtimeManager.getFrameData(frameNo);
    if (!fd) return;

    const gb = player.geometryBuilder;
    gb.parentMatrix = null;
    gb.updateWorldPositions();

    gl.useProgram(this.partsColorProgram.program);

    // Setup orthographic projection (Y-down)
    const hw = gl.canvas.width / 2;
    const hh = gl.canvas.height / 2;
    const proj = new Float32Array([
      1 / hw, 0, 0,
      0, -1 / hh, 0,
      -1, 1, 1
    ]);
    if (this.partsColorProgram.uProjection) {
      gl.uniformMatrix3fv(this.partsColorProgram.uProjection, false, proj);
    }

    // uTransform (transform is [sx, 0, 0, sy, tx, ty])
    const sx = transform[0], sy = transform[3], tx = transform[4], ty = transform[5];
    const matTransform = new Float32Array([
      sx, 0, 0,
      0, sy, 0,
      tx, ty, 1
    ]);
    if (this.partsColorProgram.uTransform) {
      gl.uniformMatrix3fv(this.partsColorProgram.uTransform, false, matTransform);
    }

    // Set uColor to white (parent chain alpha)
    if (this.partsColorProgram.uColor) {
      gl.uniform4f(this.partsColorProgram.uColor, 1.0, 1.0, 1.0, 1.0);
    }

    // Bind Buffers
    const pcp = this.partsColorProgram;
    if (pcp.aPosition >= 0) {
      gl.enableVertexAttribArray(pcp.aPosition);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
      gl.vertexAttribPointer(pcp.aPosition, 2, gl.FLOAT, false, 0, 0);
    }

    if (pcp.aUV >= 0) {
      gl.enableVertexAttribArray(pcp.aUV);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
      gl.vertexAttribPointer(pcp.aUV, 2, gl.FLOAT, false, 0, 0);
    }

    if (pcp.aColor >= 0) {
      gl.enableVertexAttribArray(pcp.aColor);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.vertexAttribPointer(pcp.aColor, 4, gl.FLOAT, false, 0, 0);
    }

    if (pcp.aVarg >= 0) {
      gl.enableVertexAttribArray(pcp.aVarg);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vargBuffer);
      gl.vertexAttribPointer(pcp.aVarg, 4, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    // Setup blend state (default premultiplied alpha blend)
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);

    let drawOrder = fd.drawOrderArray()!;
    const batchesLen = fd.drawBatchesLength();
    for (let i = 0; i < batchesLen; i++) {
      const b = fd.drawBatches(i);
      if (!b) continue;
      const kind = b.kind();

      let texInfo = null;
      if (kind !== DrawBatchKind.Instance) {
        texInfo = resourceManager.getTexture(b.textureHash());
        if (texInfo) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texInfo.tex);
          if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);
        } else if (kind !== DrawBatchKind.Shape && kind !== DrawBatchKind.Effect) {
          continue;
        }
      }
      const invW = texInfo ? 1.0 / texInfo.width : 1.0;
      const invH = texInfo ? 1.0 / texInfo.height : 1.0;

        let matrices = player.runtimeManager.getWorldMatrices();
        let meshVOff = player.runtimeManager.getMeshVertexOffsets();
        let meshIOff = player.runtimeManager.getMeshIndexOffsets();
        let shapeVertexCounts = player.runtimeManager.getShapeVertexCounts();

        const startRank = b.startRank();
        const count = b.count();
        let drawOrder = fd.drawOrderArray();
        if (!drawOrder) continue;
        
        // Track the current WASM memory buffer to detect growth during Instance recursion
        let memBuf = getWasmMemory().buffer;

        let totalVerts = 0;
        let totalIndices = 0;

        for (let c = 0; c < count; c++) {
          const partIdx = drawOrder[startRank + c];
          if (kind === DrawBatchKind.Normal) {
            totalVerts += 5;
            totalIndices += 12;
          } else if (kind === DrawBatchKind.Mesh) {
            totalVerts += meshVOff[partIdx + 1] - meshVOff[partIdx];
            totalIndices += meshIOff[partIdx + 1] - meshIOff[partIdx];
          } else if (kind === DrawBatchKind.Shape) {
            const vc = shapeVertexCounts[partIdx];
            totalVerts += vc;
            totalIndices += (vc - 2) * 3;
          }
        }

        if ((kind === DrawBatchKind.Normal || kind === DrawBatchKind.Mesh || kind === DrawBatchKind.Shape) && (totalVerts === 0 || totalIndices === 0)) continue;
        if (totalVerts > 0 && totalIndices > 0) {
          this.ensureBatchCapacity(totalVerts, totalIndices);
        }

        let vOffset = 0;
        let iOffset = 0;

        for (let c = 0; c < count; c++) {
          const partIdx = drawOrder[startRank + c];

          if (kind === DrawBatchKind.Normal) {
            const vCount = 5;
            const iCount = 12;

            const subPos = this.batchPos.subarray(vOffset * 2, (vOffset + vCount) * 2);
            const subUv = this.batchUv.subarray(vOffset * 2, (vOffset + vCount) * 2);
            const subColor = this.batchColor.subarray(vOffset * 4, (vOffset + vCount) * 4);
            const subVarg = this.batchVarg.subarray(vOffset * 4, (vOffset + vCount) * 4);

            gb.buildNormal(partIdx, fd, invW, invH, subPos, subUv, subColor, subVarg);

            for (let j = 0; j < 12; j++) {
              this.batchIndices[iOffset + j] = this.normalIndices[j] + vOffset;
            }

            vOffset += vCount;
            iOffset += iCount;

          } else if (kind === DrawBatchKind.Mesh) {
            const vCount = meshVOff[partIdx + 1] - meshVOff[partIdx];
            const iCount = meshIOff[partIdx + 1] - meshIOff[partIdx];
            if (vCount === 0 || iCount === 0) continue;

            const subPos = this.batchPos.subarray(vOffset * 2, (vOffset + vCount) * 2);
            const subUv = this.batchUv.subarray(vOffset * 2, (vOffset + vCount) * 2);
            const subColor = this.batchColor.subarray(vOffset * 4, (vOffset + vCount) * 4);
            const subVarg = this.batchVarg.subarray(vOffset * 4, (vOffset + vCount) * 4);
            // We use the main buffer view to build the mesh indices, which will be 0-based
            const subIndices = this.batchIndices.subarray(iOffset, iOffset + iCount);

            gb.buildMesh(partIdx, fd, vCount, iCount, invW, invH, subPos, subUv, subColor, subVarg, subIndices);

            // Shift indices by vOffset for this batch
            for (let j = 0; j < iCount; j++) {
              this.batchIndices[iOffset + j] += vOffset;
            }

            vOffset += vCount;
            iOffset += iCount;

          } else if (kind === DrawBatchKind.Shape) {
            const vCount = shapeVertexCounts[partIdx];
            const iCount = (vCount - 2) * 3;
            if (vCount === 0 || iCount === 0) continue;

            const subPos = this.batchPos.subarray(vOffset * 2, (vOffset + vCount) * 2);
            const subUv = this.batchUv.subarray(vOffset * 2, (vOffset + vCount) * 2);
            const subColor = this.batchColor.subarray(vOffset * 4, (vOffset + vCount) * 4);
            const subVarg = this.batchVarg.subarray(vOffset * 4, (vOffset + vCount) * 4);
            const subIndices = this.batchIndices.subarray(iOffset, iOffset + iCount);

            gb.buildShape(partIdx, fd, vCount, invW, invH, subPos, subUv, subColor, subVarg, subIndices);

            // Shift indices by vOffset
            for (let j = 0; j < iCount; j++) {
              this.batchIndices[iOffset + j] += vOffset;
            }

            vOffset += vCount;
            iOffset += iCount;
          }
        }

        if (kind === DrawBatchKind.Effect) {
          this._fxCount = 0;
          for (let c = 0; c < count; c++) {
            const partIdx = drawOrder[startRank + c];
            const partState = fd.parts(partIdx);
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
            this.ensureBatchCapacity(pCount, iCount); 

            let vOff = 0;
            let iOff = 0;
            for (let k = g; k < h; k++) {
              const d = this._fxDesc[k];
              gb.buildEffectCommand(
                d.partIdx, d.plan, d.particleOffset, d.quadCount,
                this.batchPos, this.batchUv, this.batchColor, this.batchIndices, vOff, iOff, d.partAlpha
              );

              vOff += d.quadCount * 4;
              iOff += d.quadCount * 6;
            }

            const texInfo = resourceManager.getTexture(cellmap);
            gl.activeTexture(gl.TEXTURE0);
            if (texInfo) {
              gl.bindTexture(gl.TEXTURE_2D, texInfo.tex);
            } else {
              gl.bindTexture(gl.TEXTURE_2D, this.getWhiteTexture(gl));
            }
            if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);

            // Temporarily disable aVarg array and use constant attribute to emulate EffectShader
            if (pcp.aVarg >= 0) {
              gl.disableVertexAttribArray(pcp.aVarg);
              gl.vertexAttrib4f(pcp.aVarg, 1.0, 0.0, 1.0, 0.0);
            }

            if (blend === 1) {
              gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE); // Additive with premultiplied alpha
            } else {
              gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Mix
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.batchPos.subarray(0, pCount * 2), gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.batchUv.subarray(0, pCount * 2), gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, this.batchColor.subarray(0, pCount * 4), gl.DYNAMIC_DRAW);
            
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices.subarray(0, iCount), gl.DYNAMIC_DRAW);
            gl.drawElements(gl.TRIANGLES, iCount, gl.UNSIGNED_SHORT, 0);

            // Restore aVarg array and blend mode
            if (pcp.aVarg >= 0) gl.enableVertexAttribArray(pcp.aVarg);
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

            g = h;
          }
        }

        if (kind === DrawBatchKind.Instance) {
          for (let c = 0; c < count; c++) {
            const partIdx = drawOrder[startRank + c];
            const partState = fd.parts(partIdx);
            const alpha = partState ? partState.alpha() : 1.0;
            if (alpha <= 0) continue;

            const child = player.getInstanceChild(partIdx);
            if (!child || !child.visible) continue;

            player.runtimeManager.getWorldMatrix2D(partIdx, this.scratchMatrix);
            const composed = GeometryBuilder.composeAffine(transform, this.scratchMatrix, child.parentMatrix);

            // Re-render child
            this.render(child.player, resourceManager, composed);

            // Re-fetch WASM views in case of memory growth
            fd = player.runtimeManager.getFrameData(frameNo)!;
            drawOrder = fd.drawOrderArray()!;

            // Restore state
            gl.useProgram(this.partsColorProgram.program);
            if (this.partsColorProgram.uTransform) {
              gl.uniformMatrix3fv(this.partsColorProgram.uTransform, false, matTransform);
            }
            if (this.partsColorProgram.uColor) {
              gl.uniform4f(this.partsColorProgram.uColor, 1.0, 1.0, 1.0, 1.0);
            }
            
            if (pcp.aPosition >= 0) {
              gl.enableVertexAttribArray(pcp.aPosition);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
              gl.vertexAttribPointer(pcp.aPosition, 2, gl.FLOAT, false, 0, 0);
            }
            if (pcp.aUV >= 0) {
              gl.enableVertexAttribArray(pcp.aUV);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
              gl.vertexAttribPointer(pcp.aUV, 2, gl.FLOAT, false, 0, 0);
            }
            if (pcp.aColor >= 0) {
              gl.enableVertexAttribArray(pcp.aColor);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
              gl.vertexAttribPointer(pcp.aColor, 4, gl.FLOAT, false, 0, 0);
            }
            if (pcp.aVarg >= 0) {
              gl.enableVertexAttribArray(pcp.aVarg);
              gl.bindBuffer(gl.ARRAY_BUFFER, this.vargBuffer);
              gl.vertexAttribPointer(pcp.aVarg, 4, gl.FLOAT, false, 0, 0);
            }
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          }
        }

        if (totalIndices > 0 && kind !== DrawBatchKind.Effect && kind !== DrawBatchKind.Instance) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchPos.subarray(0, totalVerts * 2), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchUv.subarray(0, totalVerts * 2), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchColor.subarray(0, totalVerts * 4), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.vargBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchVarg.subarray(0, totalVerts * 4), gl.DYNAMIC_DRAW);
          
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices.subarray(0, totalIndices), gl.DYNAMIC_DRAW);
          gl.drawElements(gl.TRIANGLES, totalIndices, gl.UNSIGNED_SHORT, 0);
        }
    }

    if (pcp.aPosition >= 0) gl.disableVertexAttribArray(pcp.aPosition);
    if (pcp.aUV >= 0) gl.disableVertexAttribArray(pcp.aUV);
    if (pcp.aColor >= 0) gl.disableVertexAttribArray(pcp.aColor);
    if (pcp.aVarg >= 0) gl.disableVertexAttribArray(pcp.aVarg);
  }

  public destroy(): void {
    const gl = this.gl;
    this.partsColorProgram.destroy(gl);
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteBuffer(this.colorBuffer);
    gl.deleteBuffer(this.vargBuffer);
    gl.deleteBuffer(this.indexBuffer);
  }
}
