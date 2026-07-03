import { GpuBlendModesToPixi } from 'pixi.js';

/**
 * SpriteStudio framebuffer-composite blend modes that PixiJS has no GPU-native
 * equivalent for. SpriteStudio realises EVERY blend as a fixed-function GPU blend
 * state (Unity `Blend Src Dst` + BlendOp — verified against the official
 * SS6PlayerForUnity, `Library_SpriteStudio6.cs` FunctionMaterialSetUpAnimation),
 * reading the destination framebuffer through Dst*Color blend factors.
 *
 * We register them the SAME way — as real GPU blend states (like PixiJS's own
 * normal/add/multiply/screen) — NOT as PixiJS "advanced" blend modes. Advanced
 * blend modes are backdrop-sampling FILTERS: heavier, and in this batch-draw setup
 * they do not reliably engage / read the live framebuffer (Invert/Exclusion came
 * out wrong — the canvas backdrop had no effect on them). Fixed-function GPU blend
 * always engages and blends against the actual framebuffer, exactly like SS.
 *
 * SS color-blend factors (src, dst), BlendOp:
 *   Invert(7)    : OneMinusDstColor, Zero             , Add  → (1-dst) * src
 *   Exclusion(6) : OneMinusDstColor, OneMinusSrcColor , Add  → (1-dst)*src + (1-src)*dst
 *
 * Factors are written for PixiJS's PREMULTIPLIED pipeline; for the opaque sprites
 * these modes target, premultiplied == straight, so the result matches SS. The
 * alpha component keeps premultiplied coverage [one, one-minus-src-alpha] so the
 * parts stay visible (SS renders to an opaque target where dst alpha is moot).
 */

export const SS_MIX_BLEND = 'normal';
export const SS_ADD_BLEND = 'add';
export const SS_MUL_BLEND = 'multiply';
export const SS_SUB_BLEND = 'normal-npm'; // Map to unused native strings for unique WebGPU pipeline IDs
export const SS_SCREEN_BLEND = 'screen';
export const SS_INVERT_BLEND = 'add-npm';
export const SS_EXCLUSION_BLEND = 'screen-npm';

// Premultiplied-coverage alpha shared by every custom mode.
const PM_ALPHA = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };

// --- WebGPU: GpuBlendModesToPixi is a module-global map read at draw time, so we
//     can register up-front (no renderer needed). ---
{
    const gpu = GpuBlendModesToPixi as unknown as Record<string, unknown>;
    if (!gpu['_ss_patched']) {
        gpu['_ss_patched'] = true;
        gpu[SS_MIX_BLEND] = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { ...PM_ALPHA } };
        gpu[SS_ADD_BLEND] = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { ...PM_ALPHA } };
        gpu[SS_MUL_BLEND] = { color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { ...PM_ALPHA } };
        gpu[SS_SUB_BLEND] = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'reverse-subtract' }, alpha: { ...PM_ALPHA } };
        gpu[SS_SCREEN_BLEND] = { color: { srcFactor: 'one-minus-dst', dstFactor: 'one', operation: 'add' }, alpha: { ...PM_ALPHA } };
        gpu[SS_INVERT_BLEND] = { color: { srcFactor: 'one-minus-dst', dstFactor: 'zero', operation: 'add' }, alpha: { ...PM_ALPHA } };
        gpu[SS_EXCLUSION_BLEND] = { color: { srcFactor: 'one-minus-dst', dstFactor: 'one-minus-src', operation: 'add' }, alpha: { ...PM_ALPHA } };
    }
}

// --- WebGL: the blend-mode map is built per-renderer from the GL context, so it
//     must be patched once a renderer exists. SSPlayer calls this when it captures
//     the renderer. No-op (and harmless) on WebGPU, where renderer.gl is absent.
//     Array layout matches GlStateSystem: [srcRGB, dstRGB, srcAlpha, dstAlpha,
//     (opRGB, opAlpha)] — 4 entries = blendFuncSeparate, 6 = + blendEquationSeparate. ---
const glPatched = new WeakSet<object>();
export function registerSSBlendModesGL(renderer: unknown): void {
    const r = renderer as { gl?: WebGLRenderingContext; state?: { blendModesMap?: Record<string, number[]> } };
    const gl = r?.gl;
    const map = r?.state?.blendModesMap;
    if (!gl || !map || glPatched.has(map)) return;
    map[SS_MIX_BLEND] = [gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    map[SS_ADD_BLEND] = [gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    map[SS_MUL_BLEND] = [gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    
    // Some older WebGL1 drivers might lack reverse-subtract without extension, but we map it directly
    map[SS_SUB_BLEND] = [gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD];
    
    map[SS_SCREEN_BLEND] = [gl.ONE_MINUS_DST_COLOR, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    map[SS_INVERT_BLEND] = [gl.ONE_MINUS_DST_COLOR, gl.ZERO, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    map[SS_EXCLUSION_BLEND] = [gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
    glPatched.add(map);
}
