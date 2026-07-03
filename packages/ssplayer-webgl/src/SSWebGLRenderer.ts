import { GeometryBuilder, DirectInternalPlayer, DrawBatchKind, BlendType, DrawBatch, PartState, FrameData, MaskPlanner, FrameDataMaskSource, ssRuntime } from '@spritestudio/ssplayer-core';
import { PartsColorProgram } from './programs/PartsColorProgram.js';
import { MaskProgram } from './programs/MaskProgram.js';
import { SS_SHADER_SOURCES, SsShaderProgram } from './programs/SSShaderLib.js';
import type { SSWebGLResourceManager } from './SSWebGLResourceManager.js';

export class SSWebGLRenderer {
  public gl: WebGLRenderingContext | WebGL2RenderingContext;
  private partsColorProgram: PartsColorProgram;
  // Stencil-buffer mask program (MaskWrite pass). Lazily compiled on the first
  // masked frame so mask-free animations never pay for it. See _writePlannedWriter.
  private maskProgram: MaskProgram | null = null;
  // True when the GL context was created with a stencil buffer (SSPLAYER_WEBGL_SPEC
  // §8-5 / §5.1 `stencil`). Masking is skipped entirely when absent (masked content
  // draws unclipped) — graceful degradation on contexts without a stencil attachment.
  private _stencilSupported = false;
  // Vertex count produced by the last buildOnePart() call (its index count is returned).
  private _builtVerts = 0;
  // Engine-agnostic mask writer planner (core) + its FrameData adapter — the same
  // editor-verified writer selection/classification ssplayer-pixi uses. Selects pure
  // masks (Mask batches) AND clipping writers (mask_write drawn parts in Normal/Shape/
  // Mesh batches), with per-writer rank, OP, geometry, cutout threshold, and clip flag.
  private maskPlanner = new MaskPlanner();
  private maskSource = new FrameDataMaskSource();
  // Cursor into the (rank-sorted) planner writer list: index of the next writer whose
  // scope transition to apply as content is drawn in ascending rank order (syncMasksTo).
  private _maskCursor = 0;

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

  // --- SpriteStudio integration shaders (ssae `SHDR` attribute; SSPLAYER_WEBGL_SPEC
  // §6/§10) ---
  // Compiled ss-* programs keyed by id_hash (null cached = not a built-in id → the
  // part falls back to the plain parts-color program). Lazily compiled on the first
  // shader part so shader-free animations never pay for them; one program per
  // id_hash, reused across all parts/textures (the texture is bound to a unit and
  // the ss uniforms are set per draw, so no per-texture pooling is needed — unlike
  // ssplayer-pixi, whose Shader objects bake in their resources).
  private ssShaderPrograms = new Map<number, SsShaderProgram | null>();
  // Reused shader-attribute accessor + param scratch (GC-zero hot path, §6/§9).
  private _scratchShader = new ssRuntime.PartAttributeShader();
  private _ssParams = new Float32Array(8);

  // Normal has 12 indices
  private normalIndices = new Uint16Array([
    0, 1, 4,
    1, 3, 4,
    3, 2, 4,
    2, 0, 4
  ]);

  constructor(gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = gl;

    // Masking (stencil) needs a stencil attachment on the drawing buffer; probe the
    // realised context attributes rather than trusting the request (a driver may deny it).
    const ctxAttrs = gl.getContextAttributes();
    this._stencilSupported = !!(ctxAttrs && ctxAttrs.stencil);

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

  /**
   * Draw one player context (also invoked recursively for instance children).
   * `maskingAllowed` is false for instance children: masking is confined to the
   * root context so children never write to the shared stencil (no cross-context
   * contamination). Sub-animation-internal masks are therefore not applied — a
   * documented limitation of the single-stencil path (the pixi coverage method,
   * with a per-context coverage texture, is the general solution).
   */
  private _renderContext(player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager, transform: Float32Array, maskingAllowed: boolean = true): void {
    if (!player.animationName) return;

    const gl = this.gl;
    const frameNo = player.getFrameNo();
    let fd = player.runtimeManager.getFrameData(frameNo);
    if (!fd) return;

    const gb = player.geometryBuilder;
    gb.parentMatrix = null;
    gb.updateWorldPositions();

    // Whether this frame carries ANY `SHDR` (integration-shader) attributes. Frame-
    // level gate so shader-free content skips the per-batch shader scan entirely.
    const hasShaders = fd.shadersLength() > 0;

    // Static per-part mask flags (JS-cached, stable across WASM growth): 0x01
    // visibleInsideMask, 0x08 drawAsMask. Used to skip pure-mask colour and to
    // resolve masked-content polarity (§2-4). Null only before an animation is set.
    const maskFlags = player.runtimeManager.getPartMaskFlags();

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

    // Plan this context's mask writers (pure + clipping) via the core planner, then
    // pre-write the PURE masks into the stencil (they scope to lower/earlier ranks, so
    // all are in scope for the first content). As content is drawn in ascending rank
    // order, syncMasksTo() removes each pure writer at its rank and adds clipping
    // writers at theirs (§2-1 scope). maskWriterCount == 0 → content draws unclipped.
    let maskWriterCount = 0;
    if (this._stencilSupported && maskingAllowed) {
      this.maskSource.bind(fd, drawOrder, player.runtimeManager);
      maskWriterCount = this.maskPlanner.plan(this.maskSource);
      this._maskCursor = 0;
      if (maskWriterCount > 0) this._prewritePureMasks(player, resourceManager, fd, gb);
    }

    const batchesLen = fd.drawBatchesLength();
    for (let i = 0; i < batchesLen; i++) {
      const b = fd.drawBatches(i, this._scratchBatch);
      if (!b) continue;
      const kind = b.kind();

      // Mask batch (pure-mask writers): coverage only, no colour (§8-5). Pre-written
      // into the stencil above and removed lazily by syncMasksTo() as content passes
      // its rank; nothing to draw here. (Clipping writers live in Normal/Shape/Mesh
      // batches, not here — they're added by syncMasksTo at their own rank.)
      if (kind === DrawBatchKind.Mask) continue;

      let texInfo = null;
      if (kind !== DrawBatchKind.Instance) {
        texInfo = resourceManager.getTexture(b.textureHash());
        if (texInfo) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texInfo.tex);
          if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);
        } else if (kind === DrawBatchKind.Shape) {
          // Pure-colour shapes carry textureHash 0 (no cell assigned); a textured
          // shape whose atlas hasn't loaded yet also lands here. Bind the 1x1 white
          // texture so the parts-colour shader samples opaque white at the fixed
          // (0.5,0.5) UV buildShape emits, and the shape renders as its interpolated
          // vertex colour (mirrors ssplayer-pixi's Texture.WHITE fallback). Without
          // this bind the previous batch's atlas would bleed through the shape.
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.getWhiteTexture(gl));
          if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);
        } else if (kind !== DrawBatchKind.Effect) {
          // Normal/Mesh with no resolved texture: nothing sensible to draw. (Effect
          // resolves its cellmap texture per draw command below.)
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

      // Masked content (FLAG_MASK_INFLUENCE, 0x01): clip each part against the
      // current stencil coverage (§2-4 polarity per part). Handled per-part (not
      // batched), so skip the batched build/draw. Only when the context has active
      // mask writers — otherwise mask_count == 0 and content draws unclipped.
      if (this._stencilSupported && maskWriterCount > 0 && (b.flags() & 0x01) !== 0 &&
          (kind === DrawBatchKind.Normal || kind === DrawBatchKind.Mesh || kind === DrawBatchKind.Shape)) {
        this.drawMaskedContent(player, resourceManager, b, kind, drawOrder, fd, gb, invW, invH, maskFlags, texInfo, meshVOff, meshIOff, shapeVertexCounts);
        continue;
      }

      // SpriteStudio integration shader (`SHDR`): a NON-masked Normal batch that
      // contains any shader part is drawn per-part (each with its own ss-* program +
      // per-part uniforms, in draw order) instead of the batched path, so the shader
      // parts composite correctly. Only reached when the frame has shaders. Not
      // combined with masking (v1, matches ssplayer-pixi) — a masked shader part
      // already took the drawMaskedContent path above and draws with the plain program.
      if (hasShaders && kind === DrawBatchKind.Normal &&
          this.normalBatchHasShader(fd, drawOrder, startRank, count, maskFlags)) {
        this.drawShaderNormalBatch(b, drawOrder, fd, gb, invW, invH, maskFlags, texInfo, meshVOff, meshIOff, shapeVertexCounts);
        continue;
      }

      let totalVerts = 0;
      let totalIndices = 0;

      for (let c = 0; c < count; c++) {
        const partIdx = drawOrder[startRank + c];
        // draw_as_mask parts are pure masks — coverage only, never their colour (§3-3).
        if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
        if (kind === DrawBatchKind.Normal) {
          totalVerts += 5;
          totalIndices += 12;
        } else if (kind === DrawBatchKind.Mesh) {
          totalVerts += meshVOff[partIdx + 1] - meshVOff[partIdx];
          totalIndices += meshIOff[partIdx + 1] - meshIOff[partIdx];
        } else if (kind === DrawBatchKind.Shape) {
          const vc = shapeVertexCounts[partIdx];
          if (vc < 3) continue;   // degenerate fan (needs >=3 verts); keep in lockstep with build
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
        // Keep in lockstep with the pre-count skip above so vOffset/iOffset stay
        // consistent with totalVerts/totalIndices (draw_as_mask parts draw no colour).
        if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;

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
          if (vCount < 3) continue;   // matches the pre-count skip above
          const iCount = (vCount - 2) * 3;

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
        // Effect as a masked target (FLAG_MASK_INFLUENCE): clip the particle quads
        // against the coverage. Effect batches are unbatchable (one effect part each),
        // so the whole batch shares startRank's rank + polarity. Bring the coverage to
        // that rank, then keep the stencil test on for every quad draw below.
        const effectMasked = this._stencilSupported && maskWriterCount > 0 && (b.flags() & 0x01) !== 0;
        if (effectMasked) {
          this.syncMasksTo(startRank, player, resourceManager, fd, gb, meshVOff, meshIOff, shapeVertexCounts);
          const visInside = !!(maskFlags && (maskFlags[drawOrder[startRank]] & 0x01) !== 0);
          gl.enable(gl.STENCIL_TEST);
          gl.stencilMask(0x00);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.stencilFunc(visInside ? gl.NOTEQUAL : gl.EQUAL, 0, 0xFF);
        }

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
        if (effectMasked) {
          gl.disable(gl.STENCIL_TEST);
          gl.stencilMask(0xFF);
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

          // §3-2-2 instance mask inheritance: when the instance part is a masked target
          // (mask_influence, flag 0x04), the WHOLE referenced sub-animation is clipped by
          // this context's coverage, judged once by the instance part's own rank +
          // visible_inside polarity. The stencil is a screen-space buffer, so simply
          // leaving the test enabled across the child recursion clips every child draw —
          // no per-child coverage UV needed (unlike the pixi coverage method). The child
          // renders with maskingAllowed=false (stencilMask 0 → it can't disturb coverage).
          const instMasked = this._stencilSupported && maskWriterCount > 0 && !!(maskFlags && (maskFlags[partIdx] & 0x04) !== 0);
          if (instMasked) {
            this.syncMasksTo(startRank + c, player, resourceManager, fd, gb, meshVOff, meshIOff, shapeVertexCounts);
            const visInside = !!(maskFlags && (maskFlags[partIdx] & 0x01) !== 0);
            gl.enable(gl.STENCIL_TEST);
            gl.stencilMask(0x00);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            gl.stencilFunc(visInside ? gl.NOTEQUAL : gl.EQUAL, 0, 0xFF);
          }

          // Re-render child. maskingAllowed=false: children don't touch the shared
          // stencil, so the parent's mask coverage and cursor survive the recursion
          // (and any instMasked stencil test above clips the whole child sub-anime).
          this._renderContext(child.player, resourceManager, composed, false);

          if (instMasked) {
            gl.disable(gl.STENCIL_TEST);
            gl.stencilMask(0xFF);
          }

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

  private ensureMaskProgram(): MaskProgram {
    if (!this.maskProgram) this.maskProgram = new MaskProgram(this.gl);
    return this.maskProgram;
  }

  /**
   * Build one part's geometry into the shared batch buffers at offset 0 (indices
   * 0-based) for the per-part mask / masked-content paths. Returns the index count
   * (0 = degenerate → skip); the vertex count lands in `_builtVerts`. The caller
   * uploads (uploadPart) and draws. `kind` selects the geometry (Normal quad /
   * Shape fan / Mesh); the mask-write path resolves it from the part's vertex data.
   */
  private buildOnePart(
    kind: number, partIdx: number, fd: FrameData, gb: GeometryBuilder,
    invW: number, invH: number,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array
  ): number {
    let vCount = 0;
    let iCount = 0;
    if (kind === DrawBatchKind.Normal) {
      vCount = 5; iCount = 12;
    } else if (kind === DrawBatchKind.Mesh) {
      vCount = meshVOff[partIdx + 1] - meshVOff[partIdx];
      iCount = meshIOff[partIdx + 1] - meshIOff[partIdx];
    } else if (kind === DrawBatchKind.Shape) {
      vCount = shapeVertexCounts[partIdx];
      iCount = vCount >= 3 ? (vCount - 2) * 3 : 0;
    }
    if (vCount <= 0 || iCount <= 0) { this._builtVerts = 0; return 0; }

    this.ensureBatchCapacity(vCount, iCount);
    const subPos = this.batchPos.subarray(0, vCount * 2);
    const subUv = this.batchUv.subarray(0, vCount * 2);
    const subColor = this.batchColor.subarray(0, vCount * 4);
    const subVarg = this.batchVarg.subarray(0, vCount * 4);

    if (kind === DrawBatchKind.Normal) {
      gb.buildNormal(partIdx, fd, invW, invH, subPos, subUv, subColor, subVarg);
      for (let j = 0; j < 12; j++) this.batchIndices[j] = this.normalIndices[j];
    } else if (kind === DrawBatchKind.Mesh) {
      gb.buildMesh(partIdx, fd, vCount, iCount, invW, invH, subPos, subUv, subColor, subVarg, this.batchIndices.subarray(0, iCount));
    } else {
      gb.buildShape(partIdx, fd, vCount, invW, invH, subPos, subUv, subColor, subVarg, this.batchIndices.subarray(0, iCount));
    }
    this._builtVerts = vCount;
    return iCount;
  }

  /** Upload one part's shared-buffer geometry (all 4 attributes + indices) for a per-part draw. */
  private uploadPart(vCount: number, iCount: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batchPos.subarray(0, vCount * 2), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batchUv.subarray(0, vCount * 2), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batchColor.subarray(0, vCount * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vargBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.batchVarg.subarray(0, vCount * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices.subarray(0, iCount), gl.DYNAMIC_DRAW);
  }

  /**
   * Whether any drawable part in a batch carries a `SHDR` attribute. Cheap scan
   * (reads part_state.shader()); only reached when the frame has shaders
   * (fd.shadersLength() > 0). draw_as_mask parts are skipped — they never draw their
   * colour, so their shader (if any) is irrelevant.
   */
  private normalBatchHasShader(fd: FrameData, drawOrder: Uint16Array, startRank: number, count: number, maskFlags: Uint8Array | null): boolean {
    for (let c = 0; c < count; c++) {
      const partIdx = drawOrder[startRank + c];
      if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
      const ps = fd.parts(partIdx, this._scratchPart);
      if (ps && ps.shader() >= 0) return true;
    }
    return false;
  }

  /** Lazily compile (and cache) the ss-* program for `idHash`; null = not a built-in id. */
  private acquireSsShaderProgram(idHash: number): SsShaderProgram | null {
    let prog = this.ssShaderPrograms.get(idHash);
    if (prog === undefined) {
      const src = SS_SHADER_SOURCES.get(idHash);
      prog = src ? new SsShaderProgram(this.gl, src) : null;
      this.ssShaderPrograms.set(idHash, prog);
    }
    return prog;
  }

  /**
   * Activate the ss-* program for a part's `SHDR` attribute and upload its per-part
   * uniforms: param0..7, the cell's UV rect (min/max over the quad's 4 corner UVs, for
   * ss-circle / ss-spot), and pixel size (1/texW, 1/texH). MUST be called AFTER the
   * part's geometry is built (reads the corner UVs from this.batchUv). Returns the
   * program (caller draws), or null when the id_hash isn't a built-in ss-* shader (the
   * caller then falls back to the plain parts-color program). uProjection/uTransform/
   * uColor mirror the context state the parts-color program uses (world tint = identity).
   */
  private applySsShader(fd: FrameData, shaderIdx: number, invW: number, invH: number): SsShaderProgram | null {
    const attr = fd.shaders(shaderIdx, this._scratchShader);
    if (!attr) return null;
    const prog = this.acquireSsShaderProgram(attr.idHash());
    if (!prog) return null;

    const gl = this.gl;
    gl.useProgram(prog.program);
    if (prog.uProjection) gl.uniformMatrix3fv(prog.uProjection, false, this.projMatrix);
    if (prog.uTransform) gl.uniformMatrix3fv(prog.uTransform, false, this.transformMatrix3);
    if (prog.uColor) gl.uniform4f(prog.uColor, 1.0, 1.0, 1.0, 1.0);
    if (prog.uTexture) gl.uniform1i(prog.uTexture, 0);

    const p = this._ssParams;
    p[0] = attr.param0(); p[1] = attr.param1(); p[2] = attr.param2(); p[3] = attr.param3();
    p[4] = attr.param4(); p[5] = attr.param5(); p[6] = attr.param6(); p[7] = attr.param7();
    if (prog.uParams) gl.uniform4fv(prog.uParams, p);

    // Cell UV rect = (left, top, right, bottom) over the quad's 4 corner UVs (vertices
    // 0..3; vertex 4 is the centre). buildOnePart wrote the normalised UVs to batchUv.
    const uv = this.batchUv;
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (let q = 0; q < 4; q++) {
      const uu = uv[q * 2];
      const vv = uv[q * 2 + 1];
      if (uu < minU) minU = uu;
      if (uu > maxU) maxU = uu;
      if (vv < minV) minV = vv;
      if (vv > maxV) maxV = vv;
    }
    if (prog.uCellRect) gl.uniform4f(prog.uCellRect, minU, minV, maxU, maxV);
    if (prog.uPixelSize) gl.uniform2f(prog.uPixelSize, invW, invH);
    return prog;
  }

  /**
   * Draw a NON-masked Normal batch containing ≥1 shader part, one part at a time in
   * draw order (so overlap/compositing within the batch stays correct). Each part is
   * built into the shared buffers, then drawn either with its ss-* program (SHDR
   * resolves to a built-in) or the plain parts-color program (no/unknown shader). The
   * batch shares one texture + blend, so the texture is bound once to unit 0 (both
   * programs sample unit 0). Restores the parts-color program on return.
   */
  private drawShaderNormalBatch(
    b: DrawBatch, drawOrder: Uint16Array, fd: FrameData, gb: GeometryBuilder,
    invW: number, invH: number, maskFlags: Uint8Array | null,
    texInfo: { tex: WebGLTexture; width: number; height: number } | null | undefined,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array
  ): void {
    const gl = this.gl;
    const pcp = this.partsColorProgram;
    const startRank = b.startRank();
    const count = b.count();

    this.applyBlend(b.blendType());
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texInfo ? texInfo.tex : this.getWhiteTexture(gl));

    for (let c = 0; c < count; c++) {
      const partIdx = drawOrder[startRank + c];
      if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue; // draw_as_mask: coverage only
      const ps = fd.parts(partIdx, this._scratchPart);
      const alpha = ps ? ps.alpha() : 1.0;
      if (alpha <= 0) continue;
      const shaderIdx = ps ? ps.shader() : -1;

      // Build first so applySsShader can read the corner UVs for the cell rect.
      const iCount = this.buildOnePart(DrawBatchKind.Normal, partIdx, fd, gb, invW, invH, meshVOff, meshIOff, shapeVertexCounts);
      if (iCount === 0) continue;

      const ssProg = shaderIdx >= 0 ? this.applySsShader(fd, shaderIdx, invW, invH) : null;
      if (!ssProg) {
        // Plain part: the parts-color program (its context-level uniforms —
        // projection/transform/colour — persist across program switches).
        gl.useProgram(pcp.program);
        if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);
      }

      this.uploadPart(this._builtVerts, iCount);
      gl.drawElements(gl.TRIANGLES, iCount, this.indexType, 0);
    }

    // Restore the parts-color program for the following batches in this context.
    gl.useProgram(pcp.program);
  }

  /**
   * Rasterise one planned writer (maskPlanner index `w`) into the stencil with
   * `stencilOp`. The mask program must be active (beginMaskWrite) with colour writes
   * off. Binds the writer's cutout texture, applies its precomputed §2-5 threshold
   * (`< 0` → whole geometry), and builds its geometry from the planner's kind
   * (0 Normal / 1 Shape / 2 Mesh).
   */
  private _writePlannedWriter(
    mp: MaskProgram, resourceManager: SSWebGLResourceManager, w: number,
    fd: FrameData, gb: GeometryBuilder, stencilOp: number,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array
  ): void {
    const gl = this.gl;
    const p = this.maskPlanner;
    const texInfo = this.bindMaskTexture(mp, resourceManager, p.textureHash[w] >>> 0);
    if (mp.uThreshold) gl.uniform1f(mp.uThreshold, p.threshold[w]);
    gl.stencilOp(gl.KEEP, gl.KEEP, stencilOp);

    const invW = texInfo ? 1.0 / texInfo.width : 1.0;
    const invH = texInfo ? 1.0 / texInfo.height : 1.0;
    const geomKind = p.geomKind[w] === 1 ? DrawBatchKind.Shape : (p.geomKind[w] === 2 ? DrawBatchKind.Mesh : DrawBatchKind.Normal);

    const iCount = this.buildOnePart(geomKind, p.partIdx[w], fd, gb, invW, invH, meshVOff, meshIOff, shapeVertexCounts);
    if (iCount === 0) return;
    this.uploadPart(this._builtVerts, iCount);
    gl.drawElements(gl.TRIANGLES, iCount, this.indexType, 0);
  }

  /**
   * Set the shared mask-write GL state (mask program, projection/transform,
   * colour off, stencil test on, func ALWAYS). Caller draws writers, then calls
   * endMaskWrite() to restore colour writes + the parts-color program.
   */
  private beginMaskWrite(mp: MaskProgram): void {
    const gl = this.gl;
    gl.useProgram(mp.program);
    if (mp.uProjection) gl.uniformMatrix3fv(mp.uProjection, false, this.projMatrix);
    if (mp.uTransform) gl.uniformMatrix3fv(mp.uTransform, false, this.transformMatrix3);
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilMask(0xFF);
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.activeTexture(gl.TEXTURE0);
  }

  private endMaskWrite(): void {
    const gl = this.gl;
    gl.colorMask(true, true, true, true);
    gl.disable(gl.STENCIL_TEST);
    gl.useProgram(this.partsColorProgram.program);
  }

  /** Bind a Mask batch's cutout texture (white when it has none) for the writes below. */
  private bindMaskTexture(mp: MaskProgram, resourceManager: SSWebGLResourceManager, texHash: number): { tex: WebGLTexture; width: number; height: number } | undefined {
    const gl = this.gl;
    const texInfo = texHash !== 0 ? resourceManager.getTexture(texHash) : undefined;
    gl.bindTexture(gl.TEXTURE_2D, texInfo ? texInfo.tex : this.getWhiteTexture(gl));
    if (mp.uTexture) gl.uniform1i(mp.uTexture, 0);
    return texInfo;
  }

  /**
   * Pre-write every PURE mask writer's coverage into the stencil (SSPLAYER_WEBGL_SPEC
   * §8-5; per-rank scope matches the editor-verified coverage replay — 09_mask.ja.md
   * §2-1/§2-4). Pure masks scope to LOWER/earlier ranks, so all are in scope for the
   * first content; syncMasksTo() then removes each at its own rank. Clipping writers
   * (which scope FORWARD) are NOT pre-written — syncMasksTo adds them at their rank.
   * Writers come from maskPlanner (already planned by the caller).
   *
   * Limitation: overlapping writers that mix increment and invert ops can't be
   * reproduced exactly by a single stencil value (INCR saturates at 255, and the ops
   * don't commute), so such overlaps are approximate; the coverage-bitmap method
   * (ssplayer-pixi) is exact there.
   */
  private _prewritePureMasks(
    player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager,
    fd: FrameData, gb: GeometryBuilder
  ): void {
    const gl = this.gl;
    const p = this.maskPlanner;
    const mp = this.ensureMaskProgram();
    const meshVOff = player.runtimeManager.getMeshVertexOffsets();
    const meshIOff = player.runtimeManager.getMeshIndexOffsets();
    const shapeVertexCounts = player.runtimeManager.getShapeVertexCounts();

    this.beginMaskWrite(mp);
    for (let w = 0; w < p.count; w++) {
      if (p.isClipping[w] !== 0) continue; // clipping added at its own rank (syncMasksTo)
      this._writePlannedWriter(mp, resourceManager, w, fd, gb, p.opInvert[w] !== 0 ? gl.INVERT : gl.INCR, meshVOff, meshIOff, shapeVertexCounts);
    }
    this.endMaskWrite();
  }

  /**
   * Advance the stencil coverage to the scope for content at `rank`: for every planned
   * writer with `rank < rank` not yet processed (maskCursor), apply its transition —
   * clipping writers are ADDED (forward scope begins), pure writers REMOVED (backward
   * scope ended). Removal uses the inverse op (INVERT is self-inverse; INCR → DECR).
   * Only switches to the mask program when there is work; restores the parts-color
   * program (and disables the stencil test) on return, so the caller must re-establish
   * its own draw state afterwards.
   */
  private syncMasksTo(
    rank: number, player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager,
    fd: FrameData, gb: GeometryBuilder,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array
  ): void {
    const gl = this.gl;
    const p = this.maskPlanner;
    if (this._maskCursor >= p.count || p.rank[this._maskCursor] >= rank) return;

    const mp = this.ensureMaskProgram();
    this.beginMaskWrite(mp);
    while (this._maskCursor < p.count && p.rank[this._maskCursor] < rank) {
      const w = this._maskCursor;
      const opInvert = p.opInvert[w] !== 0;
      const op = p.isClipping[w] !== 0
        ? (opInvert ? gl.INVERT : gl.INCR)   // clipping: forward scope begins → add
        : (opInvert ? gl.INVERT : gl.DECR);  // pure: backward scope ended → remove
      this._writePlannedWriter(mp, resourceManager, w, fd, gb, op, meshVOff, meshIOff, shapeVertexCounts);
      this._maskCursor++;
    }
    this.endMaskWrite();
  }

  /**
   * Draw a masked content batch (parts with FLAG_MASK_INFLUENCE). For each part, in
   * ascending rank order, first advance the stencil coverage to its rank
   * (syncMasksTo — adds clipping / removes pure writers), then draw it clipped by the
   * current coverage. Polarity is per-part (§2-4): visible_inside_mask (mask flag
   * 0x01) keeps texels where the stencil is set (NOTEQUAL 0), else where it is clear
   * (EQUAL 0). Per-part because both the coverage AND the polarity can change within a
   * batch (the batch key groups by texture/blend/mask-influence, not rank or polarity).
   * draw_as_mask parts (0x08) are pure masks and never draw their colour (§3-3).
   */
  private drawMaskedContent(
    player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager,
    b: DrawBatch, kind: number, drawOrder: Uint16Array, fd: FrameData, gb: GeometryBuilder,
    invW: number, invH: number, maskFlags: Uint8Array | null,
    texInfo: { tex: WebGLTexture; width: number; height: number } | null | undefined,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array
  ): void {
    const gl = this.gl;
    const pcp = this.partsColorProgram;
    const startRank = b.startRank();
    const count = b.count();
    const blendType = b.blendType();

    for (let c = 0; c < count; c++) {
      const partIdx = drawOrder[startRank + c];
      if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue; // pure mask: coverage only (§3-3)
      const ps = fd.parts(partIdx, this._scratchPart);
      const alpha = ps ? ps.alpha() : 1.0;
      if (alpha <= 0) continue;

      // Bring the coverage up to this part's rank. This may switch to the mask
      // program and rebind textures, so re-establish the content draw state below.
      this.syncMasksTo(startRank + c, player, resourceManager, fd, gb, meshVOff, meshIOff, shapeVertexCounts);
      gl.useProgram(pcp.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texInfo ? texInfo.tex : this.getWhiteTexture(gl));
      if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);

      const iCount = this.buildOnePart(kind, partIdx, fd, gb, invW, invH, meshVOff, meshIOff, shapeVertexCounts);
      if (iCount === 0) continue;
      this.uploadPart(this._builtVerts, iCount);

      const visInside = !!(maskFlags && (maskFlags[partIdx] & 0x01) !== 0);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0x00); // content never modifies the stencil
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.stencilFunc(visInside ? gl.NOTEQUAL : gl.EQUAL, 0, 0xFF);
      this.applyBlend(blendType);
      gl.drawElements(gl.TRIANGLES, iCount, this.indexType, 0);
    }

    gl.disable(gl.STENCIL_TEST);
    gl.stencilMask(0xFF);
  }

  public destroy(): void {
    const gl = this.gl;
    if (this._vao) {
      if (this._vaoExt) this._vaoExt.deleteVertexArrayOES(this._vao);
      else (gl as WebGL2RenderingContext).deleteVertexArray(this._vao);
      this._vao = null;
    }
    this.partsColorProgram.destroy(gl);
    if (this.maskProgram) {
      this.maskProgram.destroy(gl);
      this.maskProgram = null;
    }
    for (const prog of this.ssShaderPrograms.values()) {
      if (prog) prog.destroy(gl);
    }
    this.ssShaderPrograms.clear();
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
