import { GeometryBuilder, DirectInternalPlayer, DrawBatchKind, BlendType, DrawBatch, PartState } from '@spritestudio/ssplayer-core';
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
  private batchIndices: Uint16Array | Uint32Array = new Uint16Array(512 * 3);
  // Index element type: UNSIGNED_INT (WebGL2 / OES_element_index_uint) so large
  // batches (heavy effects, dense meshes) aren't capped at the 65535-vertex Uint16
  // limit; UNSIGNED_SHORT when 32-bit indices are unavailable. Set in the constructor.
  private indexType!: number;
  private _uint32Index = false;
  // VAO handle + WebGL1 extension. When supported, the attribute layout is recorded
  // once and bound per frame in a single call; null → per-context attrib rebind.
  private _vao: WebGLVertexArrayObject | null = null;
  private _vaoExt: OES_vertex_array_object | null = null;
  private _vaoSupported = false;

  // For Effect batching
  private _fxDesc: { partIdx: number, plan: any, cellmap: number, blend: number, quadCount: number, particleOffset: number, partAlpha: number }[] = [];
  private _fxCount = 0;
  private _whiteTex: WebGLTexture | null = null;

  private scratchMatrix = new Float32Array(6);
  // Reused FlatBuffer accessors so the batch/part loops allocate nothing in steady
  // state (the accessors re-`__init` into these instead of `new`-ing per call).
  private _scratchBatch = new DrawBatch();
  private _scratchPart = new PartState();
  // Reused per-frame uniforms (avoid per-frame allocation / GC — spec §6, §9).
  private projMatrix = new Float32Array(9);
  private transformMatrix3 = new Float32Array(9);
  // Last GL blend state applied via applyBlend(); -1 forces a re-apply.
  private _lastBlend = -1;

  // Normal has 12 indices
  private normalIndices = new Uint16Array([
    0, 1, 4,
    1, 3, 4,
    3, 2, 4,
    2, 0, 4
  ]);

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;

    // WebGL2 supports UNSIGNED_INT indices natively; WebGL1 needs
    // OES_element_index_uint. Promote when available so vertex counts above 65535
    // (large particle effects / meshes) render correctly instead of silently
    // wrapping the 16-bit index range.
    const isWebGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    this._uint32Index = isWebGL2 || !!gl.getExtension('OES_element_index_uint');
    this.indexType = this._uint32Index ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    if (this._uint32Index) this.batchIndices = new Uint32Array(512 * 3);

    this.partsColorProgram = new PartsColorProgram(gl);

    this.posBuffer = gl.createBuffer()!;
    this.uvBuffer = gl.createBuffer()!;
    this.colorBuffer = gl.createBuffer()!;
    this.vargBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;

    // Record the (fixed) attribute layout into a VAO so each frame restores it with
    // one bindVertexArray instead of re-issuing enable/vertexAttribPointer per context
    // (spec §8-10 / P4). WebGL2 has VAOs natively; WebGL1 needs the extension; without
    // either we fall back to rebinding attributes per context in _renderContext.
    if (isWebGL2) {
      this._vaoSupported = true;
    } else {
      this._vaoExt = gl.getExtension('OES_vertex_array_object');
      this._vaoSupported = !!this._vaoExt;
    }
    if (this._vaoSupported) {
      this._vao = this.createVAO();
      this.bindVAO(this._vao);
      this.bindPartsAttribs();
      this.bindVAO(null);
    }
  }

  private createVAO(): WebGLVertexArrayObject | null {
    if (this._vaoExt) return this._vaoExt.createVertexArrayOES();
    return (this.gl as WebGL2RenderingContext).createVertexArray();
  }

  private bindVAO(vao: WebGLVertexArrayObject | null): void {
    if (this._vaoExt) this._vaoExt.bindVertexArrayOES(vao);
    else (this.gl as WebGL2RenderingContext).bindVertexArray(vao);
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
      this.batchIndices = this._uint32Index ? new Uint32Array(newLen) : new Uint16Array(newLen);
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

  /**
   * Write the 2D affine `transform` ([m00,m01,m10,m11,tx,ty] — the layout
   * produced by GeometryBuilder.composeAffine) into the reused uTransform mat3
   * (column-major) and upload it. Recomputed from `transform` (never cached in a
   * shared field across recursion) so instance children can safely reuse the
   * scratch and the parent restores its own matrix afterwards.
   */
  private setTransformUniform(transform: Float32Array): void {
    const m = this.transformMatrix3;
    m[0] = transform[0]; m[1] = transform[2]; m[2] = 0;
    m[3] = transform[1]; m[4] = transform[3]; m[5] = 0;
    m[6] = transform[4]; m[7] = transform[5]; m[8] = 1;
    if (this.partsColorProgram.uTransform) {
      this.gl.uniformMatrix3fv(this.partsColorProgram.uTransform, false, m);
    }
  }

  /**
   * Apply the fixed-function GPU blend state for an SS BlendType (spec §7, matching
   * ssplayer-pixi/SSBlendModes). Shader output is premultiplied; alpha is
   * premultiplied-coverage (ONE, ONE_MINUS_SRC_ALPHA) for every mode. De-duplicated
   * against the last applied state so consecutive same-blend batches don't re-issue.
   */
  private applyBlend(blendType: number): void {
    if (this._lastBlend === blendType) return;
    this._lastBlend = blendType;

    const gl = this.gl;
    let sRGB: number = gl.ONE;
    let dRGB: number = gl.ONE_MINUS_SRC_ALPHA;
    let rgbEq: number = gl.FUNC_ADD;

    switch (blendType) {
      case BlendType.Mix: sRGB = gl.ONE; dRGB = gl.ONE_MINUS_SRC_ALPHA; break;
      case BlendType.Add: sRGB = gl.ONE; dRGB = gl.ONE; break;
      case BlendType.Mul: sRGB = gl.DST_COLOR; dRGB = gl.ONE_MINUS_SRC_ALPHA; break;
      case BlendType.Sub: sRGB = gl.ONE; dRGB = gl.ONE; rgbEq = gl.FUNC_REVERSE_SUBTRACT; break;
      case BlendType.Screen: sRGB = gl.ONE_MINUS_DST_COLOR; dRGB = gl.ONE; break;
      case BlendType.Invert: sRGB = gl.ONE_MINUS_DST_COLOR; dRGB = gl.ZERO; break;
      case BlendType.Exclusion: sRGB = gl.ONE_MINUS_DST_COLOR; dRGB = gl.ONE_MINUS_SRC_COLOR; break;
      // No GPU-native equivalent; mirror ssplayer-pixi's mapping (Mulalpha/Mul2 -> Mul,
      // Screen2 -> Screen, Div2/Overlay2 -> Mix) until verified against SS6PlayerForUnity.
      case BlendType.Mulalpha:
      case BlendType.Mul2: sRGB = gl.DST_COLOR; dRGB = gl.ONE_MINUS_SRC_ALPHA; break;
      case BlendType.Screen2: sRGB = gl.ONE_MINUS_DST_COLOR; dRGB = gl.ONE; break;
      default: sRGB = gl.ONE; dRGB = gl.ONE_MINUS_SRC_ALPHA; break;
    }

    gl.blendFuncSeparate(sRGB, dRGB, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquationSeparate(rgbEq, gl.FUNC_ADD);
  }

  /**
   * Bind the shared attribute buffers and enable the parts-color attribute arrays.
   * Called once per context entry and after each instance-child recursion (the
   * child rebinds for itself, so the parent must restore its own binding).
   */
  private bindPartsAttribs(): void {
    const gl = this.gl;
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
  }

  /**
   * Render `player` to the current framebuffer. Owns the once-per-frame setup
   * (program, projection, blend enable); the per-context drawing (and recursive
   * instance children) lives in `_renderContext`.
   */
  public render(player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager, transform: Float32Array): void {
    if (!player.animationName) return;

    const gl = this.gl;
    gl.useProgram(this.partsColorProgram.program);

    // Orthographic projection: canvas pixel space (origin at center, Y-down) ->
    // clip space. Written into a reused scratch to avoid per-frame allocation (§6/§9).
    const proj = this.projMatrix;
    proj[0] = 2 / gl.canvas.width; proj[1] = 0; proj[2] = 0;
    proj[3] = 0; proj[4] = -2 / gl.canvas.height; proj[5] = 0;
    proj[6] = -1; proj[7] = 1; proj[8] = 1;
    if (this.partsColorProgram.uProjection) {
      gl.uniformMatrix3fv(this.partsColorProgram.uProjection, false, proj);
    }

    gl.enable(gl.BLEND);
    this._lastBlend = -1;

    // With a VAO the attribute layout is bound once here for the whole frame
    // (including instance children, which share the same buffers/program).
    if (this._vao) this.bindVAO(this._vao);

    this._renderContext(player, resourceManager, transform);

    if (this._vao) {
      // Leave the VAO intact for next frame; just unbind for isolation. Disabling
      // the arrays here would corrupt the recorded layout.
      this.bindVAO(null);
    } else {
      const pcp = this.partsColorProgram;
      if (pcp.aPosition >= 0) gl.disableVertexAttribArray(pcp.aPosition);
      if (pcp.aUV >= 0) gl.disableVertexAttribArray(pcp.aUV);
      if (pcp.aColor >= 0) gl.disableVertexAttribArray(pcp.aColor);
      if (pcp.aVarg >= 0) gl.disableVertexAttribArray(pcp.aVarg);
    }
  }

  /** Draw one player context (also invoked recursively for instance children). */
  private _renderContext(player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager, transform: Float32Array): void {
    if (!player.animationName) return;

    const gl = this.gl;
    const frameNo = player.getFrameNo();
    let fd = player.runtimeManager.getFrameData(frameNo);
    if (!fd) return;

    const gb = player.geometryBuilder;
    gb.parentMatrix = null;
    gb.updateWorldPositions();

    const pcp = this.partsColorProgram;

    // Position this context (uTransform) and reset the parent-chain alpha.
    this.setTransformUniform(transform);
    if (pcp.uColor) {
      gl.uniform4f(pcp.uColor, 1.0, 1.0, 1.0, 1.0);
    }

    // The VAO (if any) already carries the attribute layout, bound once in render();
    // only rebind attributes explicitly on the no-VAO fallback path.
    if (!this._vao) this.bindPartsAttribs();

    // Draw order is frame-invariant; fetch the zero-copy view once (it allocates a
    // fresh view per call). Re-fetched only after instance recursion, which is the
    // one place WASM memory can grow and detach it.
    let drawOrder = fd.drawOrderArray();
    if (!drawOrder) return;

    const batchesLen = fd.drawBatchesLength();
    for (let i = 0; i < batchesLen; i++) {
      const b = fd.drawBatches(i, this._scratchBatch);
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

      const meshVOff = player.runtimeManager.getMeshVertexOffsets();
      const meshIOff = player.runtimeManager.getMeshIndexOffsets();
      const shapeVertexCounts = player.runtimeManager.getShapeVertexCounts();

      const startRank = b.startRank();
      const count = b.count();

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
          const partState = fd.parts(partIdx, this._scratchPart);
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

          const fxTexInfo = resourceManager.getTexture(cellmap);
          gl.activeTexture(gl.TEXTURE0);
          if (fxTexInfo) {
            gl.bindTexture(gl.TEXTURE_2D, fxTexInfo.tex);
          } else {
            gl.bindTexture(gl.TEXTURE_2D, this.getWhiteTexture(gl));
          }
          if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);

          // Effects carry no PartsColor overlay: disable aVarg and drive the parts-color
          // shader as a plain texture*color modulate (rate=1, mul) — identical output to
          // ssplayer-pixi's dedicated EffectShader.
          if (pcp.aVarg >= 0) {
            gl.disableVertexAttribArray(pcp.aVarg);
            gl.vertexAttrib4f(pcp.aVarg, 1.0, 0.0, 1.0, 0.0);
          }

          // Effect blend is per-command (0 = mix, 1 = additive), not the batch blendType.
          if (blend === 1) {
            gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE); // Additive with premultiplied alpha
          } else {
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // Mix
          }
          gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);

          gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchPos.subarray(0, pCount * 2), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchUv.subarray(0, pCount * 2), gl.DYNAMIC_DRAW);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
          gl.bufferData(gl.ARRAY_BUFFER, this.batchColor.subarray(0, pCount * 4), gl.DYNAMIC_DRAW);

          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices.subarray(0, iCount), gl.DYNAMIC_DRAW);
          gl.drawElements(gl.TRIANGLES, iCount, this.indexType, 0);

          // Restore the aVarg array for the next parts batch.
          if (pcp.aVarg >= 0) gl.enableVertexAttribArray(pcp.aVarg);

          g = h;
        }
        // Effects set blend state directly (bypassing applyBlend's cache); force a
        // re-apply for the next parts batch.
        this._lastBlend = -1;
      }

      if (kind === DrawBatchKind.Instance) {
        for (let c = 0; c < count; c++) {
          const partIdx = drawOrder[startRank + c];
          const partState = fd.parts(partIdx, this._scratchPart);
          const alpha = partState ? partState.alpha() : 1.0;
          if (alpha <= 0) continue;

          const child = player.getInstanceChild(partIdx);
          if (!child || !child.visible) continue;

          player.runtimeManager.getWorldMatrix2D(partIdx, this.scratchMatrix);
          const composed = GeometryBuilder.composeAffine(transform, this.scratchMatrix, child.parentMatrix);

          // Re-render child
          this._renderContext(child.player, resourceManager, composed);

          // Re-fetch WASM views in case the child's rendering grew WASM memory.
          fd = player.runtimeManager.getFrameData(frameNo)!;
          drawOrder = fd.drawOrderArray()!;

          // Restore this context's program state after the child rebound it.
          gl.useProgram(this.partsColorProgram.program);
          this.setTransformUniform(transform);
          if (pcp.uColor) {
            gl.uniform4f(pcp.uColor, 1.0, 1.0, 1.0, 1.0);
          }
          // The VAO stays bound across the child recursion (same buffers/program);
          // only the no-VAO path must re-bind the attribute pointers.
          if (!this._vao) this.bindPartsAttribs();
          // The child changed blend state directly; force a re-apply next batch.
          this._lastBlend = -1;
        }
      }

      if (totalIndices > 0 && kind !== DrawBatchKind.Effect && kind !== DrawBatchKind.Instance) {
        this.applyBlend(b.blendType());

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
        gl.drawElements(gl.TRIANGLES, totalIndices, this.indexType, 0);
      }
    }
  }

  public destroy(): void {
    const gl = this.gl;
    if (this._vao) {
      if (this._vaoExt) this._vaoExt.deleteVertexArrayOES(this._vao);
      else (gl as WebGL2RenderingContext).deleteVertexArray(this._vao);
      this._vao = null;
    }
    this.partsColorProgram.destroy(gl);
    gl.deleteBuffer(this.posBuffer);
    gl.deleteBuffer(this.uvBuffer);
    gl.deleteBuffer(this.colorBuffer);
    gl.deleteBuffer(this.vargBuffer);
    gl.deleteBuffer(this.indexBuffer);
    if (this._whiteTex) {
      gl.deleteTexture(this._whiteTex);
      this._whiteTex = null;
    }
  }
}
