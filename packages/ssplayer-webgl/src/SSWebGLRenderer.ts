import { GeometryBuilder, DirectInternalPlayer, DrawBatchKind, BlendType, DrawBatch, FrameData, FrameDataRaw, MaskPlanner, FrameDataMaskSource, ssRuntime, composeMaskInfluence, composeVisibleInside, ROOT_MASK_INFLUENCE, ROOT_VISIBLE_INSIDE } from '@spritestudio/ssplayer-core';
import { PartsColorProgram } from './programs/PartsColorProgram.js';
import { MaskProgram } from './programs/MaskProgram.js';
import { SS_SHADER_SOURCES, SsShaderProgram } from './programs/SSShaderLib.js';
import type { SSWebGLResourceManager } from './SSWebGLResourceManager.js';

// Stencil bit planes for mask writers (09_mask.ja.md §3-1-4). INVERT and
// INCR/DECR are each self-inverse but do NOT commute, so letting them share bits
// makes the coverage of an overlap depend on the order the writers were drawn,
// and leaves residue that the cancelling pass can never take back to 0.
// Splitting the WRITE mask per op keeps each plane closed: a stencil write is
// `new = (op(old) & writeMask) | (old & ~writeMask)`, so the counter's carry and
// borrow land outside its mask and are dropped. That is also why the counter
// must use the *_WRAP ops — the carry that saturating INCR/DECR would clamp is
// exactly the bit being discarded, so wrapping is what keeps the plane correct.
//
// The TEST side deliberately keeps reading both planes (`!= 0` over the full
// byte), which is their union — the specified coverage when writers of differing
// mask_influence overlap. The renderer already claimed all 8 bits before this
// split, so its footprint against other stencil users is unchanged.
//
// The counter can hold 127 overlapping writers while MaskPlanner caps a context
// at MAX_MASK_WRITERS (24), so it cannot wrap in practice — unlike ForUnity,
// which had to fit inside URP's 4 reserved bits and lives with a limit of 7.
export const MASK_PLANE_PARITY = 0x80;  // INVERT writers (mask_influence 1): parity, no overlap limit
export const MASK_PLANE_COUNTER = 0x7F; // INCR/DECR writers (mask_influence 0): up to 127 overlaps

/** Stencil write mask for one op — each op owns exactly one plane (§3-1-4). */
export function maskPlaneForOp(gl: WebGLRenderingContext | WebGL2RenderingContext, op: number): number {
  return op === gl.INVERT ? MASK_PLANE_PARITY : MASK_PLANE_COUNTER;
}

/**
 * Mask context an instance part hands to the sub-animation it calls (§2-6).
 * The caller's settings do not replace the callee's — they COMPOSE:
 * `mask_influence` with AND, `visible_inside_mask` with OR. Passing the already
 * composed value down lets each sub-animation resolve its own parts, so nesting
 * chains for free and the caller never has to patch the callee's output.
 *
 * `mask_write` is deliberately absent: writing your own mask is a local fact,
 * not something descendants inherit.
 */
interface InheritedStencilMask {
  /** An ancestor's coverage stands in the stencil for the whole recursion. */
  active: boolean;
  /** Composed mask_influence. False is absorbing — the subtree is never a target. */
  influence: boolean;
  /** Composed visible_inside_mask polarity. */
  visibleInside: boolean;
}

export class SSWebGLRenderer {
  public gl: WebGLRenderingContext | WebGL2RenderingContext;
  // Assigned in _createGLResources() (constructor + context restore).
  private partsColorProgram!: PartsColorProgram;
  // Stencil-buffer mask program (MaskWrite pass). Lazily compiled on the first
  // masked frame so mask-free animations never pay for it. See _writePlannedWriter.
  private maskProgram: MaskProgram | null = null;
  // True when the GL context was created with a stencil buffer (the `stencil`
  // context attribute). Masking is skipped entirely when absent (masked content
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

  // Shared attribute / index VBOs. Assigned in _createGLResources() (from the
  // constructor and again on context restore), hence definite-assignment.
  private posBuffer!: WebGLBuffer;
  private uvBuffer!: WebGLBuffer;
  private colorBuffer!: WebGLBuffer;
  private vargBuffer!: WebGLBuffer;
  private indexBuffer!: WebGLBuffer;

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

  // Player-level tint fed into `uColor`, the world tint every fragment path
  // multiplies its premultiplied output by:
  //   gl_FragColor = vec4(outRgb * outA, outA) * uColor
  // (PartsColorProgram / SSShaderLib). ssplayer-pixi supplies Pixi's
  // (tint.rgb * worldAlpha, worldAlpha) here; standalone WebGL had no per-player
  // concept, so this stayed pinned at identity. Set once per render() call and
  // read by every program path, including instance-child recursion, so a tint
  // applies to the whole tree the player draws.
  //
  // MUST stay premultiplied — (rgb * a, a). uColor multiplies component-wise
  // against an already-premultiplied fragment, so scaling only the alpha channel
  // would leave RGB unattenuated and fades would wash out instead of dimming.
  private readonly _tint = new Float32Array([1, 1, 1, 1]);

  // For Effect batching
  private _fxDesc: { partIdx: number, plan: any, cellmap: number, blend: number, quadCount: number, particleOffset: number, partAlpha: number }[] = [];
  private _fxCount = 0;
  private _whiteTex: WebGLTexture | null = null;

  private scratchMatrix = new Float32Array(6);
  // Reused FlatBuffer accessor so the batch loop allocates nothing in steady state
  // (re-`__init`s into this instead of `new`-ing per call).
  private _scratchBatch = new DrawBatch();
  // Zero-copy raw reader for the per-part struct-vector fields (part_state /
  // parts_color) — bypasses the per-element accessors (07_render_loop.ja.md §2).
  // Read via its `*Of(fd, …)` helpers so it stays correct across instance-child
  // recursion (shared `this`, rebinds it) and post-recursion re-fetches.
  private _raw = new FrameDataRaw();
  // Reused per-frame uniforms (avoid per-frame allocation / GC).
  private projMatrix = new Float32Array(9);
  private transformMatrix3 = new Float32Array(9);
  // Last GL blend state applied via applyBlend(); -1 forces a re-apply.
  private _lastBlend = -1;

  // --- SpriteStudio integration shaders (ssae `SHDR` attribute) ---
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

    // Record the (fixed) attribute layout into a VAO so each frame restores it with
    // one bindVertexArray instead of re-issuing enable/vertexAttribPointer per context
    // WebGL2 has VAOs natively; WebGL1 needs the extension; without
    // either we fall back to rebinding attributes per context in _renderContext.
    if (isWebGL2) {
      this._vaoSupported = true;
    } else {
      this._vaoExt = gl.getExtension('OES_vertex_array_object');
      this._vaoSupported = !!this._vaoExt;
    }

    // Program / buffers / VAO objects. Split out so context-loss restore rebuilds
    // exactly these (the capability probes above are stable across a restore — the
    // same context is reused — so they stay in the constructor). See restoreContext.
    this._createGLResources();
  }

  /**
   * Create (or re-create) all GL objects this renderer owns: the parts-color
   * program, the shared attribute/index buffers, and the recorded VAO. Lazily
   * compiled resources (mask program, ss-* shader programs, 1×1 white texture)
   * are reset to their uncompiled state so the next frame recompiles them on
   * demand. Called once from the constructor and again from restoreContext()
   * after a `webglcontextrestored` event.
   */
  private _createGLResources(): void {
    const gl = this.gl;

    this.partsColorProgram = new PartsColorProgram(gl);
    // Drop lazy resources so they recompile against the (new) context on next use.
    this.maskProgram = null;
    this.ssShaderPrograms.clear();
    this._whiteTex = null;
    this._lastBlend = -1;

    this.posBuffer = gl.createBuffer()!;
    this.uvBuffer = gl.createBuffer()!;
    this.colorBuffer = gl.createBuffer()!;
    this.vargBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;

    if (this._vaoSupported) {
      this._vao = this.createVAO();
      this.bindVAO(this._vao);
      this.bindPartsAttribs();
      this.bindVAO(null);
    }
  }

  /**
   * Rebuild all GL objects after a `webglcontextrestored` event.
   * The old programs / buffers / VAO handles died with the context; recreate them
   * from the retained capability flags. Textures are the resource manager's job
   * (SSWebGLResourceManager.restoreContext), orchestrated by SSPlayer.
   */
  public restoreContext(): void {
    this._createGLResources();
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
      // Required, not cosmetic: the default TEXTURE_MIN_FILTER is
      // NEAREST_MIPMAP_LINEAR, so a single-level texture is mipmap-INCOMPLETE and
      // samples as opaque black — every fallback below would draw black instead of
      // white (a colour-only Shape part, a missing effect/mask cutout atlas).
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
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
   * Apply the fixed-function GPU blend state for an SS BlendType (matching
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
  public render(
    player: DirectInternalPlayer,
    resourceManager: SSWebGLResourceManager,
    transform: Float32Array,
    flipY = false,
    tint?: ArrayLike<number> | null,
  ): void {
    if (!player.animationName) return;

    // Latch the player tint for this whole call (see _tint). Omitted → identity,
    // which is what every caller before per-player alpha existed relied on.
    const t = this._tint;
    if (tint) { t[0] = tint[0]; t[1] = tint[1]; t[2] = tint[2]; t[3] = tint[3]; }
    else { t[0] = 1; t[1] = 1; t[2] = 1; t[3] = 1; }

    const gl = this.gl;
    gl.useProgram(this.partsColorProgram.program);

    // Orthographic projection: canvas pixel space (origin top-left, Y-down) ->
    // clip space. Written into a reused scratch to avoid per-frame allocation (§6/§9).
    // `flipY` inverts the vertical axis for render targets whose framebuffer Y is
    // opposite the default framebuffer — e.g. RPG Maker MZ's shared context, where
    // SS otherwise draws upside-down. Standalone canvases pass flipY = false.
    const proj = this.projMatrix;
    proj[0] = 2 / gl.canvas.width; proj[1] = 0; proj[2] = 0;
    proj[3] = 0; proj[4] = (flipY ? 2 : -2) / gl.canvas.height; proj[5] = 0;
    proj[6] = -1; proj[7] = flipY ? -1 : 1; proj[8] = 1;
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
   *
   * `inherited` carries the caller chain's composed mask context (§2-6). A child
   * applies it per part rather than the caller wrapping the whole recursion in
   * one stencil test: the AND means a sub-animation part that opted out is not
   * clipped even when its caller was a target, which a single enclosing test
   * cannot express.
   */
  private _renderContext(player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager, transform: Float32Array, maskingAllowed: boolean = true, inherited: InheritedStencilMask | null = null): void {
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

    // Position this context (uTransform) and seed the parent-chain colour from
    // the player tint (identity unless the caller set one).
    this.setTransformUniform(transform);
    if (pcp.uColor) {
      gl.uniform4fv(pcp.uColor, this._tint);
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

    // Caller chain's composed mask context (§2-6). Root identity: influence
    // true / visibleInside false, so a top-level animation evaluates every part
    // by its own flags alone. `inheritedActive` folds in the AND, so a subtree
    // whose caller opted out clips nothing regardless of the ancestor coverage.
    const ctxInfluence = inherited ? inherited.influence : ROOT_MASK_INFLUENCE;
    const ctxVisibleInside = inherited ? inherited.visibleInside : ROOT_VISIBLE_INSIDE;
    const inheritedActive = !!inherited?.active && ctxInfluence;

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

      // Re-fetched after instance recursion together with fd/drawOrder — the
      // WasmViewCache hands back the same view unless memory grew (see below).
      let meshVOff = player.runtimeManager.getMeshVertexOffsets();
      let meshIOff = player.runtimeManager.getMeshIndexOffsets();
      let shapeVertexCounts = player.runtimeManager.getShapeVertexCounts();

      const startRank = b.startRank();
      const count = b.count();

      // Masked content (FLAG_MASK_INFLUENCE, 0x01): clip each part against the
      // stencil coverage (§2-4 polarity per part). Handled per-part (not batched),
      // so skip the batched build/draw. The coverage is either this context's own
      // (we planned writers) or an ancestor's standing across an instance
      // recursion; the batch flag is the parts' own mask_influence, so requiring
      // it alongside ctxInfluence is the §2-6 AND. Without either coverage the
      // content draws unclipped.
      const batchInfluence = (b.flags() & 0x01) !== 0;
      const isContentKind = kind === DrawBatchKind.Normal || kind === DrawBatchKind.Mesh || kind === DrawBatchKind.Shape;
      if (this._stencilSupported && isContentKind && batchInfluence && ctxInfluence &&
          (maskWriterCount > 0 || inheritedActive)) {
        // Only a context that owns writers may advance the cursor; a child has no
        // plan of its own and the caller already positioned the coverage.
        this.drawMaskedContent(player, resourceManager, b, kind, drawOrder, fd, gb, invW, invH, maskFlags, texInfo, meshVOff, meshIOff, shapeVertexCounts, maskWriterCount > 0, ctxVisibleInside);
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
        const effectMasked = this._stencilSupported && batchInfluence && ctxInfluence &&
                             (maskWriterCount > 0 || inheritedActive);
        if (effectMasked) {
          if (maskWriterCount > 0) {
            this.syncMasksTo(startRank, player, resourceManager, fd, gb, meshVOff, meshIOff, shapeVertexCounts);
          }
          const visInside = composeVisibleInside(ctxVisibleInside, maskFlags ? maskFlags[drawOrder[startRank]] : 0);
          gl.enable(gl.STENCIL_TEST);
          gl.stencilMask(0x00);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.stencilFunc(visInside ? gl.NOTEQUAL : gl.EQUAL, 0, 0xFF);
        }

        this._fxCount = 0;
        for (let c = 0; c < count; c++) {
          const partIdx = drawOrder[startRank + c];
          const alpha = this._raw.partAlphaOf(fd, partIdx);
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
          const alpha = this._raw.partAlphaOf(fd, partIdx);
          if (alpha <= 0) continue;

          const child = player.getInstanceChild(partIdx);
          if (!child || !child.visible) continue;

          player.runtimeManager.getWorldMatrix2D(partIdx, this.scratchMatrix);
          const composed = GeometryBuilder.composeAffine(transform, this.scratchMatrix, child.parentMatrix);

          // §2-6 composition, resolved on the caller side and handed down, so the
          // sub-animation settles its own parts' roles and we never patch its
          // output afterwards. mask_write takes no part in it.
          const instFlags = maskFlags ? maskFlags[partIdx] : 0;
          const instInfluence = composeMaskInfluence(ctxInfluence, instFlags);
          const instVisibleInside = composeVisibleInside(ctxVisibleInside, instFlags);

          // Coverage reaching the sub-animation: ours, brought up to the instance
          // part's rank (§2-1 — the sub-anime sits at that slot in our draw
          // order), or an ancestor's already standing in the stencil. Being
          // screen-space, it clips the child's draws with no per-child UV.
          const coverageReachesChild = this._stencilSupported && instInfluence &&
                                       (maskWriterCount > 0 || inheritedActive);
          if (coverageReachesChild && maskWriterCount > 0) {
            this.syncMasksTo(startRank + c, player, resourceManager, fd, gb, meshVOff, meshIOff, shapeVertexCounts);
          }

          // Re-render child. maskingAllowed=false: children don't touch the shared
          // stencil, so the parent's mask coverage and cursor survive the
          // recursion. The child enables the test itself, per part, with the
          // composed polarity — one test wrapped around the whole recursion would
          // clip sub-animation parts that opted out of masking.
          this._renderContext(child.player, resourceManager, composed, false, {
            active: coverageReachesChild,
            influence: instInfluence,
            visibleInside: instVisibleInside,
          });

          // Re-fetch WASM views in case the child's rendering grew WASM memory —
          // a grow detaches the ArrayBuffer these views point into, and the next
          // masked child in this batch feeds them straight to syncMasksTo /
          // buildOnePart (a detached view reads as undefined, i.e. NaN counts).
          fd = player.runtimeManager.getFrameData(frameNo)!;
          drawOrder = fd.drawOrderArray()!;
          meshVOff = player.runtimeManager.getMeshVertexOffsets();
          meshIOff = player.runtimeManager.getMeshIndexOffsets();
          shapeVertexCounts = player.runtimeManager.getShapeVertexCounts();

          // Restore this context's program state after the child rebound it —
          // back to the PLAYER's tint, not identity (the child left its own).
          gl.useProgram(this.partsColorProgram.program);
          this.setTransformUniform(transform);
          if (pcp.uColor) {
            gl.uniform4fv(pcp.uColor, this._tint);
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
      if (this._raw.partShaderOf(fd, partIdx) >= 0) return true;
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
   * uColor mirror the context state the parts-color program uses (uColor = the player
   * tint latched for this render() call, identity when the caller passed none).
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
    if (prog.uColor) gl.uniform4fv(prog.uColor, this._tint);
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
      const alpha = this._raw.partAlphaOf(fd, partIdx);
      if (alpha <= 0) continue;
      const shaderIdx = this._raw.partShaderOf(fd, partIdx);

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
    // Confine this op to its own bit plane (§3-1-4). Set per writer because a
    // single pass interleaves both ops as the planner ordered them.
    gl.stencilMask(maskPlaneForOp(gl, stencilOp));

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
    // The write mask is NOT set here: it is per-writer, derived from that
    // writer's op by _writePlannedWriter (§3-1-4 bit planes).
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
   * Pre-write every PURE mask writer's coverage into the stencil (per-rank scope
   * matches the editor-verified coverage replay — 09_mask.ja.md
   * §2-1/§2-4). Pure masks scope to LOWER/earlier ranks, so all are in scope for the
   * first content; syncMasksTo() then removes each at its own rank. Clipping writers
   * (which scope FORWARD) are NOT pre-written — syncMasksTo adds them at their rank.
   * Writers come from maskPlanner (already planned by the caller).
   *
   * Overlapping writers that mix the increment and invert ops are exact: the two
   * ops write disjoint bit planes (§3-1-4), so neither the ordering nor the
   * cancellation of one can disturb the other.
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
      this._writePlannedWriter(mp, resourceManager, w, fd, gb, p.opInvert[w] !== 0 ? gl.INVERT : gl.INCR_WRAP, meshVOff, meshIOff, shapeVertexCounts);
    }
    this.endMaskWrite();
  }

  /**
   * Advance the stencil coverage to the scope for content at `rank`: for every planned
   * writer with `rank < rank` not yet processed (maskCursor), apply its transition —
   * clipping writers are ADDED (forward scope begins), pure writers REMOVED (backward
   * scope ended). Removal uses the inverse op (INVERT is self-inverse; INCR_WRAP →
   * DECR_WRAP — the wrapping pair is exact within the counter plane, §3-1-4).
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
        ? (opInvert ? gl.INVERT : gl.INCR_WRAP)   // clipping: forward scope begins → add
        : (opInvert ? gl.INVERT : gl.DECR_WRAP);  // pure: backward scope ended → remove
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
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array,
    advanceCoverage: boolean, ctxVisibleInside: boolean
  ): void {
    const gl = this.gl;
    const pcp = this.partsColorProgram;
    const startRank = b.startRank();
    const count = b.count();
    const blendType = b.blendType();

    for (let c = 0; c < count; c++) {
      const partIdx = drawOrder[startRank + c];
      if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue; // pure mask: coverage only (§3-3)
      const alpha = this._raw.partAlphaOf(fd, partIdx);
      if (alpha <= 0) continue;

      // Bring the coverage up to this part's rank. This may switch to the mask
      // program and rebind textures, so re-establish the content draw state below.
      // Skipped when clipping against an ancestor's coverage: this context owns
      // no plan, and the caller already positioned it at the instance part's rank.
      if (advanceCoverage) {
        this.syncMasksTo(startRank + c, player, resourceManager, fd, gb, meshVOff, meshIOff, shapeVertexCounts);
      }
      gl.useProgram(pcp.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texInfo ? texInfo.tex : this.getWhiteTexture(gl));
      if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);

      const iCount = this.buildOnePart(kind, partIdx, fd, gb, invW, invH, meshVOff, meshIOff, shapeVertexCounts);
      if (iCount === 0) continue;
      this.uploadPart(this._builtVerts, iCount);

      // §2-6 OR: a caller that asked for "inside" wins for everything below it,
      // otherwise the part decides for itself (§2-4).
      const visInside = composeVisibleInside(ctxVisibleInside, maskFlags ? maskFlags[partIdx] : 0);
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
