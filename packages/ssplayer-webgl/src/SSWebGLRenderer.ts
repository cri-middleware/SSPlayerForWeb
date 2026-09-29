import { GeometryBuilder, DirectInternalPlayer, DrawBatchKind, DrawBatch, FrameData, FrameDataRaw, type MaskPlanner, MaskTreePlanner, type MaskTreeVisitor, getWasmMemory, InstanceResolver, EffectBatchPlanner, ShaderAttributeResolver, ssBlendState, SSBlendFactor, SSBlendEquation, composeVisibleInside, ROOT_MASK_INFLUENCE, ROOT_VISIBLE_INSIDE } from '@spritestudio/ssplayer-core';
import { PartsColorProgram } from './programs/PartsColorProgram.js';
import { MaskProgram } from './programs/MaskProgram.js';
import { SS_SHADER_SOURCES, SsShaderProgram } from './programs/SSShaderLib.js';
import type { SSWebGLResourceManager } from './SSWebGLResourceManager.js';

// Stencil bit planes for mask writers. INVERT and
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
// The counter can hold 127 writers overlapping at one pixel. A tree may carry
// more writers than that (MAX_TREE_WRITERS), but not stacked on one spot in
// practice — unlike ForUnity, which had to fit inside URP's 4 reserved bits and
// lives with a limit of 7.
export const MASK_PLANE_PARITY = 0x80;  // INVERT writers (mask_influence 1): parity, no overlap limit
export const MASK_PLANE_COUNTER = 0x7F; // INCR/DECR writers (mask_influence 0): up to 127 overlaps

/** Stencil write mask for one op — each op owns exactly one plane. */
export function maskPlaneForOp(gl: WebGLRenderingContext | WebGL2RenderingContext, op: number): number {
  return op === gl.INVERT ? MASK_PLANE_PARITY : MASK_PLANE_COUNTER;
}

/**
 * Mask context an instance part hands to the sub-animation it calls.
 * The instance part's settings do not replace the callee's — they COMPOSE:
 * `mask_influence` with AND, `visible_inside_mask` with OR — and only the
 * instance part's own flags go down, one level (see MaskComposition).
 *
 * `mask_write` is deliberately absent: writing your own mask is a local fact,
 * not something descendants inherit.
 */
interface InheritedStencilMask {
  /** The instance part's own mask_influence. */
  influence: boolean;
  /** The instance part's own visible_inside_mask. */
  visibleInside: boolean;
}

// Writers one instance tree can hold. The stencil spends no bit per writer —
// only the counter plane's depth bounds how many may overlap at one pixel — so
// this is a storage bound, set well past what a tree plausibly carries.
const MAX_TREE_WRITERS = 256;

/** Identity affine, for a writer whose context has no placement of its own. */
const IDENTITY_AFFINE = new Float32Array([1, 0, 0, 1, 0, 0]);

export class SSWebGLRenderer {
  public gl: WebGLRenderingContext | WebGL2RenderingContext;
  // Assigned in _createGLResources() (constructor + context restore).
  private partsColorProgram!: PartsColorProgram;
  // Stencil-buffer mask program (MaskWrite pass). Lazily compiled on the first
  // masked frame so mask-free animations never pay for it. See writeTreeWriter.
  private maskProgram: MaskProgram | null = null;
  // True when the GL context was created with a stencil buffer (the `stencil`
  // context attribute). Masking is skipped entirely when absent (masked content
  // draws unclipped) — graceful degradation on contexts without a stencil attachment.
  private _stencilSupported = false;
  // Vertex count produced by the last buildOnePart() call (its index count is returned).
  private _builtVerts = 0;
  // Engine-agnostic mask planning for the whole instance tree (core), shared
  // with ssplayer-pixi: the editor-verified writer selection/classification
  // (pure masks from Mask batches, clipping writers from mask_write drawn
  // parts), each writer's interval on the tree's draw sequence, and every
  // part's number on it. One stencil serves the whole tree: a writer is added
  // when drawing passes its interval's start and removed when it reaches the
  // end (see syncMaskTo), which is what makes a sub-animation's own masks clip
  // it and a clipping mask written inside an instance clip the caller after it.
  private maskTree = new MaskTreePlanner<DirectInternalPlayer>(MAX_TREE_WRITERS);
  // Writers in the tree planned for the current render() call.
  private _treeCount = 0;
  // Each writer's geometry, captured while its context's frame was current so
  // it can be written or cancelled at any later point of the draw: positions
  // (context-local), UVs, indices, counts, cutout texture + threshold, and the
  // context's placement (uTransform). Pooled per writer slot.
  private _wPos: Float32Array[] = [];
  private _wUv: Float32Array[] = [];
  private _wIdx: Array<Uint16Array | Uint32Array> = [];
  private readonly _wVerts = new Int32Array(MAX_TREE_WRITERS);
  private readonly _wIndices = new Int32Array(MAX_TREE_WRITERS);
  private readonly _wTex = new Uint32Array(MAX_TREE_WRITERS);
  private readonly _wThreshold = new Float32Array(MAX_TREE_WRITERS);
  private _wMatrix: Float32Array[] = [];
  // Per writer: 0 = not yet in the stencil, 1 = in it, 2 = done with.
  private readonly _wState = new Uint8Array(MAX_TREE_WRITERS);
  private readonly _maskTransform3 = new Float32Array(9);
  // Visitor state while planning: the resource manager and the placement of
  // the context whose writers are being reported.
  private _visitRM: SSWebGLResourceManager | null = null;
  // The resource manager of the render() call in progress, for syncMaskTo.
  private _drawRM: SSWebGLResourceManager | null = null;
  private _visitMatrix: Float32Array = IDENTITY_AFFINE;
  private readonly _captureVisitor: MaskTreeVisitor<DirectInternalPlayer> = {
    beginContext: (player, _fd, matrix) => {
      // Geometry is built context-local (the context's placement rides on
      // uTransform), as when the context draws.
      const gb = player.geometryBuilder;
      gb.parentMatrix = null;
      gb.updateWorldPositions();
      this._visitMatrix = matrix ?? IDENTITY_AFFINE;
    },
    writer: (player, fd, planner, w, index) => this.captureWriter(player, fd, planner, w, index),
  };

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
  // WebGL2 takes (srcData, usage, srcOffset, length) on bufferData — see uploadRange.
  private _isWebGL2 = false;
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
  // The current context's uColor: the player `_tint` scaled by the parent-chain
  // opacity (the product of the enclosing instance parts' alphas). A part's OWN
  // alpha is already premultiplied into aColor.a by the GeometryBuilder, so this
  // carries only the instance ancestry's — mirroring pixi's `mesh.alpha`. Stays
  // premultiplied like `_tint`: scaling all four channels by the same factor
  // keeps (rgb * a, a) valid. Reset per context in `_renderContext`.
  private readonly _ctxTint = new Float32Array([1, 1, 1, 1]);

  // Engine-agnostic Effect batching (core), shared with ssplayer-pixi: which
  // particle commands draw, and which neighbours merge into one draw call by
  // (cellmap, blend). Issuing that draw call is ours. Pooled, so steady-state
  // rendering allocates nothing.
  private _fx = new EffectBatchPlanner<DirectInternalPlayer>();
  private _whiteTex: WebGLTexture | null = null;

  // The caller's transform with the player's root affine (flip / offset) folded
  // in. Has to stay valid for the whole call, so it is never used as scratch.
  private rootedTransform = new Float32Array(6);
  // Engine-agnostic per-instance-part resolution (core), shared with
  // ssplayer-pixi: slot visibility, alpha, composed placement, mask context
  // and the child's subframe-aware playhead. Only the drawing that follows is
  // ours. Its record is reused across calls (including across the recursion), so
  // the call site reads out what it needs immediately.
  private _instanceResolver = new InstanceResolver<DirectInternalPlayer>();
  // Reused FlatBuffer accessor so the batch loop allocates nothing in steady state
  // (re-`__init`s into this instead of `new`-ing per call).
  private _scratchBatch = new DrawBatch();
  // Zero-copy raw reader for the per-part struct-vector fields (part_state /
  // parts_color) — bypasses the per-element accessors.
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
  // Engine-agnostic `SHDR` read (core), shared with ssplayer-pixi: program id,
  // param0..7 and the cell UV rect derived from the quad's corners.
  private _shaderAttr = new ShaderAttributeResolver();

  // Pooled InheritedStencilMask, one per recursion depth (a child holds its own
  // while ours stays live up the stack) — see inheritedAtDepth.
  private _inheritedPool: InheritedStencilMask[] = [];
  private _depth = 0;

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
    this._isWebGL2 = isWebGL2;
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

  /** The pooled InheritedStencilMask for one recursion depth, grown on demand. */
  private inheritedAtDepth(depth: number): InheritedStencilMask {
    let m = this._inheritedPool[depth];
    if (!m) {
      m = { influence: false, visibleInside: false };
      this._inheritedPool[depth] = m;
    }
    return m;
  }

  /**
   * `bufferData` the first `length` elements of an (oversized) batch buffer into the
   * currently bound `target`. WebGL2 takes the range directly; WebGL1 has only the
   * 3-argument form and still pays a `subarray` view per upload.
   */
  private uploadRange(target: number, src: Float32Array | Uint16Array | Uint32Array, length: number): void {
    const gl = this.gl;
    if (this._isWebGL2) {
      (gl as WebGL2RenderingContext).bufferData(target, src, gl.DYNAMIC_DRAW, 0, length);
    } else {
      gl.bufferData(target, src.subarray(0, length), gl.DYNAMIC_DRAW);
    }
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
    // Which state SpriteStudio draws this blend with is core's table; turning its
    // factors into GL constants is ours. ssplayer-pixi registers the same states
    // as real GPU blend modes, which is what keeps the two identical.
    const st = ssBlendState(blendType);
    gl.blendFuncSeparate(this.glFactor(st.srcRGB), this.glFactor(st.dstRGB), gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.blendEquationSeparate(
      st.eqRGB === SSBlendEquation.ReverseSubtract ? gl.FUNC_REVERSE_SUBTRACT : gl.FUNC_ADD,
      gl.FUNC_ADD,
    );
  }

  /** One engine-neutral blend factor as this context's constant. */
  private glFactor(factor: SSBlendFactor): number {
    const gl = this.gl;
    switch (factor) {
      case SSBlendFactor.Zero: return gl.ZERO;
      case SSBlendFactor.One: return gl.ONE;
      case SSBlendFactor.DstColor: return gl.DST_COLOR;
      case SSBlendFactor.OneMinusSrcAlpha: return gl.ONE_MINUS_SRC_ALPHA;
      case SSBlendFactor.OneMinusDstColor: return gl.ONE_MINUS_DST_COLOR;
      case SSBlendFactor.OneMinusSrcColor: return gl.ONE_MINUS_SRC_COLOR;
      default: return gl.ONE;
    }
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
    if (!player.currentAnimation) return;

    // Latch the player tint for this whole call (see _tint). Omitted → identity,
    // which is what every caller before per-player alpha existed relied on.
    const t = this._tint;
    if (tint) { t[0] = tint[0]; t[1] = tint[1]; t[2] = tint[2]; t[3] = tint[3]; }
    else { t[0] = 1; t[1] = 1; t[2] = 1; t[3] = 1; }

    const gl = this.gl;
    gl.useProgram(this.partsColorProgram.program);

    // Orthographic projection: canvas pixel space (origin top-left, Y-down) ->
    // clip space. Written into a reused scratch to avoid per-frame allocation.
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

    // Fold in the player's root transform (flip / offset), if it has one. It
    // belongs UNDER the caller's transform — it mirrors/shifts the animation
    // within its own space, leaving where the caller placed the player alone —
    // and it has to ride on `transform` rather than the geometry so that
    // instance children, which compose against it, inherit it too. Untouched
    // players get null here and the call is exactly what it was before.
    const rootAffine = player.getRootAffine();
    const rootedTransform = rootAffine
      ? GeometryBuilder.composeAffine(transform, rootAffine, this.rootedTransform)
      : transform;

    this._depth = 0;
    this._treeCount = 0;
    this._drawRM = resourceManager;
    this._renderContext(player, resourceManager, rootedTransform);
    // Take every writer still standing back out of the stencil, so nothing this
    // player wrote leaks into whatever draws next on the same surface.
    if (this._treeCount > 0) this.closeMaskTree();
    this._drawRM = null;

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

  /** Set `_ctxTint` = the player tint scaled by the parent-chain opacity (§opacity). */
  private applyCtxTint(parentAlpha: number): void {
    const t = this._tint, ct = this._ctxTint;
    ct[0] = t[0] * parentAlpha; ct[1] = t[1] * parentAlpha;
    ct[2] = t[2] * parentAlpha; ct[3] = t[3] * parentAlpha;
  }

  /**
   * Draw one player context (also invoked recursively for instance children).
   * The root context plans the masks of the whole instance tree; every context
   * then brings the one shared stencil up to each target part's number on the
   * tree sequence before drawing it (syncMaskTo).
   *
   * `inherited` carries the mask context the instance part handed down. A
   * child applies it per part rather than the caller wrapping the whole
   * recursion in one stencil test: the AND means a sub-animation part that
   * opted out is not clipped even when its instance part was a target, which a
   * single enclosing test cannot express.
   */
  private _renderContext(player: DirectInternalPlayer, resourceManager: SSWebGLResourceManager, transform: Float32Array, inherited: InheritedStencilMask | null = null, parentAlpha: number = 1): void {
    if (!player.currentAnimation) return;

    const gl = this.gl;
    const frameNo = player.getDrawFrame();
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
    // resolve masked-content polarity. Null only before an animation is set.
    const maskFlags = player.runtimeManager.getPartMaskFlags();

    const pcp = this.partsColorProgram;

    // Position this context (uTransform) and seed the parent-chain colour from
    // the player tint scaled by the instance-ancestry opacity (`parentAlpha`).
    this.setTransformUniform(transform);
    this.applyCtxTint(parentAlpha);
    if (pcp.uColor) {
      gl.uniform4fv(pcp.uColor, this._ctxTint);
    }

    // The VAO (if any) already carries the attribute layout, bound once in render();
    // only rebind attributes explicitly on the no-VAO fallback path.
    if (!this._vao) this.bindPartsAttribs();

    // Draw order is frame-invariant; fetch the zero-copy view once (it allocates a
    // fresh view per call). Re-fetched only after instance recursion, which is the
    // one place WASM memory can grow and detach it.
    let drawOrder = fd.drawOrderArray();
    if (!drawOrder) return;

    // At the root, plan the masks of the whole instance tree: number every part
    // of it on one draw sequence and capture every writer's geometry (see
    // maskTree). Nothing is written yet — syncMaskTo writes each writer when
    // drawing reaches its interval. No writer → content draws unclipped.
    if (!inherited && this._stencilSupported) {
      const memBuf = getWasmMemory().buffer;
      this._visitRM = resourceManager;
      this._treeCount = this.maskTree.plan(player, fd, transform, this._captureVisitor);
      this._visitRM = null;
      this._wState.fill(0, 0, this._treeCount);
      // Planning asked every visible instance child for its frame, which can
      // grow WASM memory and detach our views. Re-derive before drawing.
      if (getWasmMemory().buffer !== memBuf) {
        const fresh = player.runtimeManager.getFrameData(frameNo);
        const freshOrder = fresh?.drawOrderArray();
        if (!fresh || !freshOrder) return;
        fd = fresh;
        drawOrder = freshOrder;
      }
    }
    const hasMask = this._stencilSupported && this._treeCount > 0;
    // Where this context's ranks sit on the tree sequence.
    const seq = hasMask ? this.maskTree.seqOf(player) ?? null : null;

    // The mask context the instance part handed down: its own flags, one level.
    // Root identity: influence true / visibleInside false, so a top-level
    // animation evaluates every part by its own flags alone.
    const ctxInfluence = inherited ? inherited.influence : ROOT_MASK_INFLUENCE;
    const ctxVisibleInside = inherited ? inherited.visibleInside : ROOT_VISIBLE_INSIDE;
    // With no writer anywhere in the tree, a target that draws only inside a
    // mask is covered by nothing and draws nowhere.
    const insideDropsOut = this._stencilSupported && this._treeCount === 0;

    const batchesLen = fd.drawBatchesLength();
    for (let i = 0; i < batchesLen; i++) {
      const b = fd.drawBatches(i, this._scratchBatch);
      if (!b) continue;
      const kind = b.kind();

      // Mask batch (pure-mask writers): coverage only, no colour. Captured by the
      // tree plan and written / removed by syncMaskTo as drawing passes its
      // interval; nothing to draw here. (Clipping writers live in Normal/Shape/Mesh
      // batches and draw their colour there.)
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
      // stencil coverage. Handled per-part (not batched), so skip the batched
      // build/draw. The batch flag is the parts' own mask_influence, so
      // requiring it alongside ctxInfluence is the AND. A target no writer
      // reaches passes the test anyway; with no writer in the tree at all the
      // content draws unclipped, bar the parts that draw only inside a mask.
      const batchInfluence = (b.flags() & 0x01) !== 0;
      const target = batchInfluence && ctxInfluence;
      const dropInside = insideDropsOut && target;
      // Last read out of `b`: the instance recursion below re-points the shared
      // _scratchBatch, so the draw at the end of the loop must not read it again.
      const batchBlend = b.blendType();
      const isContentKind = kind === DrawBatchKind.Normal || kind === DrawBatchKind.Mesh || kind === DrawBatchKind.Shape;
      if (hasMask && isContentKind && target) {
        this.drawMaskedContent(b, kind, drawOrder, fd, gb, invW, invH, maskFlags, texInfo, meshVOff, meshIOff, shapeVertexCounts, seq, ctxVisibleInside);
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
        this.drawShaderNormalBatch(b, drawOrder, fd, gb, invW, invH, maskFlags, texInfo, meshVOff, meshIOff, shapeVertexCounts, dropInside ? ctxVisibleInside : null);
        continue;
      }

      let totalVerts = 0;
      let totalIndices = 0;

      for (let c = 0; c < count; c++) {
        const partIdx = drawOrder[startRank + c];
        // draw_as_mask parts are pure masks — coverage only, never their colour.
        if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue;
        if (dropInside && composeVisibleInside(ctxVisibleInside, maskFlags ? maskFlags[partIdx] : 0)) continue;
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
        if (dropInside && composeVisibleInside(ctxVisibleInside, maskFlags ? maskFlags[partIdx] : 0)) continue;

        // Each part writes straight into the shared buffers at (vOffset, iOffset);
        // the GeometryBuilder rebases its indices by vOffset itself.
        if (kind === DrawBatchKind.Normal) {
          const vCount = 5;
          const iCount = 12;

          gb.buildNormal(partIdx, fd, invW, invH,
            this.batchPos, this.batchUv, this.batchColor, this.batchVarg, vOffset);

          for (let j = 0; j < 12; j++) {
            this.batchIndices[iOffset + j] = this.normalIndices[j] + vOffset;
          }

          vOffset += vCount;
          iOffset += iCount;

        } else if (kind === DrawBatchKind.Mesh) {
          const vCount = meshVOff[partIdx + 1] - meshVOff[partIdx];
          const iCount = meshIOff[partIdx + 1] - meshIOff[partIdx];
          if (vCount === 0 || iCount === 0) continue;

          gb.buildMesh(partIdx, fd, vCount, iCount, invW, invH,
            this.batchPos, this.batchUv, this.batchColor, this.batchVarg, this.batchIndices,
            vOffset, iOffset);

          vOffset += vCount;
          iOffset += iCount;

        } else if (kind === DrawBatchKind.Shape) {
          const vCount = shapeVertexCounts[partIdx];
          if (vCount < 3) continue;   // matches the pre-count skip above
          const iCount = (vCount - 2) * 3;

          gb.buildShape(partIdx, fd, vCount, invW, invH,
            this.batchPos, this.batchUv, this.batchColor, this.batchVarg, this.batchIndices,
            vOffset, iOffset);

          vOffset += vCount;
          iOffset += iCount;
        }
      }

      if (kind === DrawBatchKind.Effect) {
        // Effect as a masked target (FLAG_MASK_INFLUENCE): clip the particle quads
        // against the coverage. Effect batches are unbatchable (one effect part each),
        // so the whole batch shares startRank's number + polarity. Bring the coverage
        // there, then keep the stencil test on for every quad draw below.
        const visInside = composeVisibleInside(ctxVisibleInside, maskFlags ? maskFlags[drawOrder[startRank]] : 0);
        if (dropInside && visInside) continue;
        const effectMasked = hasMask && target;
        if (effectMasked) {
          if (seq) this.syncMaskTo(seq[startRank]);
          gl.enable(gl.STENCIL_TEST);
          gl.stencilMask(0x00);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
          gl.stencilFunc(visInside ? gl.NOTEQUAL : gl.EQUAL, 0, 0xFF);
        }

        const fxCount = this._fx.collect(player, fd, drawOrder, startRank, count);

        let g = 0;
        while (g < fxCount) {
          const cellmap = this._fx.items[g].cellmap;
          const blend = this._fx.items[g].blend;
          const h = this._fx.runEnd(g);
          const totalQuads = this._fx.quadsIn(g, h);

          const pCount = totalQuads * 4;
          const iCount = totalQuads * 6;
          this.ensureBatchCapacity(pCount, iCount);

          let vOff = 0;
          let iOff = 0;
          for (let k = g; k < h; k++) {
            const d = this._fx.items[k];
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
          this.uploadRange(gl.ARRAY_BUFFER, this.batchPos, pCount * 2);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
          this.uploadRange(gl.ARRAY_BUFFER, this.batchUv, pCount * 2);
          gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
          this.uploadRange(gl.ARRAY_BUFFER, this.batchColor, pCount * 4);

          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
          this.uploadRange(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices, iCount);
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
          // Engine-agnostic resolution (core), shared with ssplayer-pixi: slot
          // visibility, alpha, the composed placement and the mask context
          // handed down. Its record is reused, so read out everything still
          // needed before the recursion below.
          const inst = this._instanceResolver.resolve(
            player, fd, drawOrder, startRank + c, transform, parentAlpha);
          if (!inst) continue;
          const child = inst.child;
          const composed = inst.composed;
          const childAlpha = inst.childAlpha;

          // Re-render child. The stencil is the tree's, so the child's parts
          // sync it themselves at their own numbers on the tree sequence — its
          // own writers included — and enable the test per part, with their
          // composed polarity.
          const childInherited = this.inheritedAtDepth(this._depth);
          childInherited.influence = inst.influence;
          childInherited.visibleInside = inst.visibleInside;
          // The child holds this slot for its whole render, so it must hand out a
          // different one to ITS children.
          this._depth++;
          this._renderContext(child.player, resourceManager, composed, childInherited, childAlpha);
          this._depth--;

          // Re-fetch WASM views in case the child's rendering grew WASM memory —
          // a grow detaches the ArrayBuffer these views point into, and the next
          // masked batch feeds them straight to buildOnePart (a detached view
          // reads as undefined, i.e. NaN counts).
          fd = player.runtimeManager.getFrameData(frameNo)!;
          drawOrder = fd.drawOrderArray()!;
          meshVOff = player.runtimeManager.getMeshVertexOffsets();
          meshIOff = player.runtimeManager.getMeshIndexOffsets();
          shapeVertexCounts = player.runtimeManager.getShapeVertexCounts();

          // Restore this context's program state after the child rebound it —
          // back to this context's tint (the child overwrote `_ctxTint` with its
          // own parentAlpha), not identity.
          gl.useProgram(this.partsColorProgram.program);
          this.setTransformUniform(transform);
          this.applyCtxTint(parentAlpha);
          if (pcp.uColor) {
            gl.uniform4fv(pcp.uColor, this._ctxTint);
          }
          // The VAO stays bound across the child recursion (same buffers/program);
          // only the no-VAO path must re-bind the attribute pointers.
          if (!this._vao) this.bindPartsAttribs();
          // The child changed blend state directly; force a re-apply next batch.
          this._lastBlend = -1;
        }
      }

      if (totalIndices > 0 && kind !== DrawBatchKind.Effect && kind !== DrawBatchKind.Instance) {
        this.applyBlend(batchBlend);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
        this.uploadRange(gl.ARRAY_BUFFER, this.batchPos, totalVerts * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
        this.uploadRange(gl.ARRAY_BUFFER, this.batchUv, totalVerts * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        this.uploadRange(gl.ARRAY_BUFFER, this.batchColor, totalVerts * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vargBuffer);
        this.uploadRange(gl.ARRAY_BUFFER, this.batchVarg, totalVerts * 4);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
        this.uploadRange(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices, totalIndices);
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
    // One part per draw, so offsets are 0 and the shared buffers go over whole.
    if (kind === DrawBatchKind.Normal) {
      gb.buildNormal(partIdx, fd, invW, invH, this.batchPos, this.batchUv, this.batchColor, this.batchVarg);
      for (let j = 0; j < 12; j++) this.batchIndices[j] = this.normalIndices[j];
    } else if (kind === DrawBatchKind.Mesh) {
      gb.buildMesh(partIdx, fd, vCount, iCount, invW, invH, this.batchPos, this.batchUv, this.batchColor, this.batchVarg, this.batchIndices);
    } else {
      gb.buildShape(partIdx, fd, vCount, invW, invH, this.batchPos, this.batchUv, this.batchColor, this.batchVarg, this.batchIndices);
    }
    this._builtVerts = vCount;
    return iCount;
  }

  /** Upload one part's shared-buffer geometry (all 4 attributes + indices) for a per-part draw. */
  private uploadPart(vCount: number, iCount: number): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    this.uploadRange(gl.ARRAY_BUFFER, this.batchPos, vCount * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    this.uploadRange(gl.ARRAY_BUFFER, this.batchUv, vCount * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    this.uploadRange(gl.ARRAY_BUFFER, this.batchColor, vCount * 4);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vargBuffer);
    this.uploadRange(gl.ARRAY_BUFFER, this.batchVarg, vCount * 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    this.uploadRange(gl.ELEMENT_ARRAY_BUFFER, this.batchIndices, iCount);
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
    // Engine-agnostic read (core), shared with ssplayer-pixi: the program's id,
    // its eight parameters, and the cell UV rect derived from the quad's corner
    // UVs buildOnePart wrote to batchUv. Binding them to the GL program is ours.
    if (!this._shaderAttr.resolve(fd, shaderIdx, this.batchUv)) return null;
    const prog = this.acquireSsShaderProgram(this._shaderAttr.idHash);
    if (!prog) return null;

    const gl = this.gl;
    gl.useProgram(prog.program);
    if (prog.uProjection) gl.uniformMatrix3fv(prog.uProjection, false, this.projMatrix);
    if (prog.uTransform) gl.uniformMatrix3fv(prog.uTransform, false, this.transformMatrix3);
    if (prog.uColor) gl.uniform4fv(prog.uColor, this._ctxTint);
    if (prog.uTexture) gl.uniform1i(prog.uTexture, 0);

    if (prog.uParams) gl.uniform4fv(prog.uParams, this._shaderAttr.params);
    if (prog.uCellRect) gl.uniform4fv(prog.uCellRect, this._shaderAttr.cellRect);
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
   *
   * `dropInsideOf` is non-null when the batch's parts are mask targets but the
   * tree has no writer: it is the handed-down visible_inside_mask, and a part
   * that composes to "inside" is skipped — covered by nothing, it draws nowhere.
   */
  private drawShaderNormalBatch(
    b: DrawBatch, drawOrder: Uint16Array, fd: FrameData, gb: GeometryBuilder,
    invW: number, invH: number, maskFlags: Uint8Array | null,
    texInfo: { tex: WebGLTexture; width: number; height: number } | null | undefined,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array,
    dropInsideOf: boolean | null
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
      if (dropInsideOf !== null && composeVisibleInside(dropInsideOf, maskFlags ? maskFlags[partIdx] : 0)) continue;
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
   * Capture tree writer `index` (the planner's writer `w`) while its context's
   * frame is current (MaskTreeVisitor): build its geometry context-local with
   * its cutout texture's UV scale, and keep the positions, UVs and indices with
   * the context's placement, so syncMaskTo can write — and later cancel — it
   * wherever in the draw its interval begins and ends.
   */
  private captureWriter(player: DirectInternalPlayer, fd: FrameData, planner: MaskPlanner, w: number, index: number): void {
    const texHash = planner.textureHash[w] >>> 0;
    const texInfo = texHash !== 0 ? this._visitRM?.getTexture(texHash) : undefined;
    const invW = texInfo ? 1.0 / texInfo.width : 1.0;
    const invH = texInfo ? 1.0 / texInfo.height : 1.0;
    const geomKind = planner.geomKind[w] === 1 ? DrawBatchKind.Shape : (planner.geomKind[w] === 2 ? DrawBatchKind.Mesh : DrawBatchKind.Normal);
    const m = player.runtimeManager;

    const iCount = this.buildOnePart(geomKind, planner.partIdx[w], fd, player.geometryBuilder, invW, invH,
      m.getMeshVertexOffsets(), m.getMeshIndexOffsets(), m.getShapeVertexCounts());
    const vCount = this._builtVerts;

    let pos = this._wPos[index];
    if (!pos || pos.length < vCount * 2) {
      pos = this._wPos[index] = new Float32Array(Math.max(vCount * 2, 16));
      this._wUv[index] = new Float32Array(pos.length);
    }
    let idx = this._wIdx[index];
    if (!idx || idx.length < iCount || (this._uint32Index !== (idx instanceof Uint32Array))) {
      const n = Math.max(iCount, 24);
      idx = this._wIdx[index] = this._uint32Index ? new Uint32Array(n) : new Uint16Array(n);
    }
    pos.set(this.batchPos.subarray(0, vCount * 2));
    this._wUv[index].set(this.batchUv.subarray(0, vCount * 2));
    idx.set(this.batchIndices.subarray(0, iCount));
    this._wVerts[index] = vCount;
    this._wIndices[index] = iCount;
    this._wTex[index] = texHash;
    this._wThreshold[index] = planner.threshold[w];
    this._wMatrix[index] = this._visitMatrix;
  }

  /**
   * Rasterise captured tree writer `i` into the stencil with `stencilOp`. The
   * mask program must be active (beginMaskWrite) with colour writes off. Binds
   * the writer's cutout texture, applies its threshold (`< 0` → whole geometry)
   * and places it with its own context's transform.
   */
  private writeTreeWriter(mp: MaskProgram, resourceManager: SSWebGLResourceManager, i: number, stencilOp: number): void {
    const gl = this.gl;
    const iCount = this._wIndices[i];
    if (iCount === 0) return;
    this.bindMaskTexture(mp, resourceManager, this._wTex[i]);
    if (mp.uThreshold) gl.uniform1f(mp.uThreshold, this._wThreshold[i]);
    gl.stencilOp(gl.KEEP, gl.KEEP, stencilOp);
    // Confine this op to its own bit plane. Set per writer because a
    // single pass interleaves both ops as the planner ordered them.
    gl.stencilMask(maskPlaneForOp(gl, stencilOp));

    const t = this._wMatrix[i];
    const m3 = this._maskTransform3;
    m3[0] = t[0]; m3[1] = t[2]; m3[2] = 0;
    m3[3] = t[1]; m3[4] = t[3]; m3[5] = 0;
    m3[6] = t[4]; m3[7] = t[5]; m3[8] = 1;
    if (mp.uTransform) gl.uniformMatrix3fv(mp.uTransform, false, m3);

    const vCount = this._wVerts[i];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    this.uploadRange(gl.ARRAY_BUFFER, this._wPos[i], vCount * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    this.uploadRange(gl.ARRAY_BUFFER, this._wUv[i], vCount * 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    this.uploadRange(gl.ELEMENT_ARRAY_BUFFER, this._wIdx[i], iCount);
    gl.drawElements(gl.TRIANGLES, iCount, this.indexType, 0);
  }

  /**
   * Set the shared mask-write GL state (mask program, projection, colour off,
   * stencil test on, func ALWAYS). Each writer sets its own transform. Caller
   * draws writers, then calls endMaskWrite() to restore colour writes + the
   * parts-color program.
   */
  private beginMaskWrite(mp: MaskProgram): void {
    const gl = this.gl;
    gl.useProgram(mp.program);
    if (mp.uProjection) gl.uniformMatrix3fv(mp.uProjection, false, this.projMatrix);
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    // The write mask is NOT set here: it is per-writer, derived from that
    // writer's op by writeTreeWriter.
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
   * Bring the stencil to the coverage for content at tree sequence number `at`:
   * every writer whose interval (open, close) holds `at` is in it, every other
   * one is not. Drawing only moves forward on the sequence, so each writer is
   * added once, when drawing first passes its open end, and removed once, when
   * it reaches its close end — a pure mask at its own number, having covered
   * its animation back to the start; a clipping writer never (closeMaskTree
   * takes it out at the end). A writer whose whole interval was passed without
   * a target inside it is never written at all. Removal uses the inverse op
   * (INVERT is self-inverse; INCR_WRAP → DECR_WRAP — the wrapping pair is exact
   * within the counter plane), and since the two ops write disjoint planes the
   * order writers go in and out does not matter.
   *
   * Only switches to the mask program when there is work; restores the
   * parts-color program (and disables the stencil test) on return, so the
   * caller must re-establish its own draw state afterwards.
   */
  private syncMaskTo(at: number): void {
    const gl = this.gl;
    const tree = this.maskTree;
    const rm = this._drawRM!;
    let mp: MaskProgram | null = null;
    for (let i = 0; i < this._treeCount; i++) {
      const state = this._wState[i];
      if (state === 2) continue;
      const close = tree.close[i];
      const closed = close >= 0 && close <= at;
      if (state === 0) {
        if (closed) { this._wState[i] = 2; continue; }
        if (tree.open[i] >= at) continue;
        if (!mp) { mp = this.ensureMaskProgram(); this.beginMaskWrite(mp); }
        this.writeTreeWriter(mp, rm, i, tree.opInvert[i] !== 0 ? gl.INVERT : gl.INCR_WRAP);
        this._wState[i] = 1;
      } else if (closed) {
        if (!mp) { mp = this.ensureMaskProgram(); this.beginMaskWrite(mp); }
        this.writeTreeWriter(mp, rm, i, tree.opInvert[i] !== 0 ? gl.INVERT : gl.DECR_WRAP);
        this._wState[i] = 2;
      }
    }
    if (mp) this.endMaskWrite();
  }

  /**
   * Remove every writer still in the stencil at the end of the tree — the
   * clipping writers, which hold to its end, and any pure mask whose close end
   * was never reached. The stencil is shared by every player on the surface, so
   * leaving them would clip whatever draws next.
   */
  private closeMaskTree(): void {
    const gl = this.gl;
    const tree = this.maskTree;
    const rm = this._drawRM!;
    let mp: MaskProgram | null = null;
    for (let i = 0; i < this._treeCount; i++) {
      if (this._wState[i] !== 1) continue;
      if (!mp) { mp = this.ensureMaskProgram(); this.beginMaskWrite(mp); }
      this.writeTreeWriter(mp, rm, i, tree.opInvert[i] !== 0 ? gl.INVERT : gl.DECR_WRAP);
      this._wState[i] = 2;
    }
    if (mp) this.endMaskWrite();
    // Back to the stencil write mask the rest of the renderer assumes.
    gl.stencilMask(0xFF);
  }

  /**
   * Draw a masked content batch (parts with FLAG_MASK_INFLUENCE). For each part, in
   * ascending rank order, first bring the stencil coverage to its number on the
   * tree sequence (syncMaskTo), then draw it clipped by the current coverage. Polarity is per-part: visible_inside_mask (mask flag
   * 0x01) keeps texels where the stencil is set (NOTEQUAL 0), else where it is clear
   * (EQUAL 0). Per-part because both the coverage AND the polarity can change within a
   * batch (the batch key groups by texture/blend/mask-influence, not rank or polarity).
   * draw_as_mask parts (0x08) are pure masks and never draw their colour.
   */
  private drawMaskedContent(
    b: DrawBatch, kind: number, drawOrder: Uint16Array, fd: FrameData, gb: GeometryBuilder,
    invW: number, invH: number, maskFlags: Uint8Array | null,
    texInfo: { tex: WebGLTexture; width: number; height: number } | null | undefined,
    meshVOff: Uint32Array, meshIOff: Int32Array, shapeVertexCounts: Int32Array,
    seq: Float32Array | null, ctxVisibleInside: boolean
  ): void {
    const gl = this.gl;
    const pcp = this.partsColorProgram;
    const startRank = b.startRank();
    const count = b.count();
    const blendType = b.blendType();

    for (let c = 0; c < count; c++) {
      const partIdx = drawOrder[startRank + c];
      if (maskFlags && (maskFlags[partIdx] & 0x08) !== 0) continue; // pure mask: coverage only
      const alpha = this._raw.partAlphaOf(fd, partIdx);
      if (alpha <= 0) continue;

      // Bring the coverage up to this part's number. This may switch to the mask
      // program and rebind textures, so re-establish the content draw state below.
      if (seq) this.syncMaskTo(seq[startRank + c]);
      gl.useProgram(pcp.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texInfo ? texInfo.tex : this.getWhiteTexture(gl));
      if (pcp.uTexture) gl.uniform1i(pcp.uTexture, 0);

      const iCount = this.buildOnePart(kind, partIdx, fd, gb, invW, invH, meshVOff, meshIOff, shapeVertexCounts);
      if (iCount === 0) continue;
      this.uploadPart(this._builtVerts, iCount);

      // OR: an instance part that asked for "inside" wins for its sub-animation,
      // otherwise the part decides for itself.
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
