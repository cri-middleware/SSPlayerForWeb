import { GpuBlendModesToPixi } from 'pixi.js';
import { SSBlendEquation, SSBlendFactor, SSBlendMode, SS_BLEND_STATES } from '@spritestudio/ssplayer-core';

/**
 * SpriteStudio framebuffer-composite blend modes that PixiJS has no GPU-native
 * equivalent for.
 *
 * **What the states are lives in core** (`SS_BLEND_STATES`): SpriteStudio
 * realises EVERY blend as a fixed-function GPU blend state, reading the
 * destination framebuffer through Dst*Color factors, and that is the same answer
 * whichever backend asks. What lives here is the registration: the three tables
 * below (PixiJS mode names, its WebGPU map, its WebGL map) are all derived from
 * the one in core rather than written out again.
 *
 * We register them the SAME way — as real GPU blend states (like PixiJS's own
 * normal/add/multiply/screen) — NOT as PixiJS "advanced" blend modes. Advanced
 * blend modes are backdrop-sampling FILTERS: heavier, and in this batch-draw setup
 * they do not reliably engage / read the live framebuffer. Fixed-function GPU blend
 * always engages and blends against the actual framebuffer, exactly like SS.
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

/**
 * PixiJS blend-mode name per {@link SSBlendMode}, in the enum's order — so
 * `SS_BLEND_MODE_NAMES[ssBlendMode(batchBlend)]` is the mode to draw a batch with.
 */
export const SS_BLEND_MODE_NAMES: readonly string[] = [
    SS_MIX_BLEND,       // SSBlendMode.Mix
    SS_ADD_BLEND,       // SSBlendMode.Add
    SS_MUL_BLEND,       // SSBlendMode.Mul
    SS_SUB_BLEND,       // SSBlendMode.Sub
    SS_SCREEN_BLEND,    // SSBlendMode.Screen
    SS_INVERT_BLEND,    // SSBlendMode.Invert
    SS_EXCLUSION_BLEND, // SSBlendMode.Exclusion
];

// Premultiplied-coverage alpha shared by every custom mode.
const PM_ALPHA = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };

/** One core blend factor as PixiJS's WebGPU factor string. */
function gpuFactor(factor: SSBlendFactor): string {
    switch (factor) {
        case SSBlendFactor.Zero: return 'zero';
        case SSBlendFactor.One: return 'one';
        case SSBlendFactor.DstColor: return 'dst';
        case SSBlendFactor.OneMinusSrcAlpha: return 'one-minus-src-alpha';
        case SSBlendFactor.OneMinusDstColor: return 'one-minus-dst';
        case SSBlendFactor.OneMinusSrcColor: return 'one-minus-src';
        default: return 'one';
    }
}

/** One core blend factor as this GL context's constant. */
function glFactor(gl: WebGLRenderingContext, factor: SSBlendFactor): number {
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

// --- WebGPU: GpuBlendModesToPixi is a module-global map read at draw time, so we
//     can register up-front (no renderer needed). ---
{
    const gpu = GpuBlendModesToPixi as unknown as Record<string, unknown>;
    if (!gpu['_ss_patched']) {
        gpu['_ss_patched'] = true;
        for (let mode = 0; mode < SS_BLEND_STATES.length; mode++) {
            const st = SS_BLEND_STATES[mode];
            gpu[SS_BLEND_MODE_NAMES[mode]] = {
                color: {
                    srcFactor: gpuFactor(st.srcRGB),
                    dstFactor: gpuFactor(st.dstRGB),
                    operation: st.eqRGB === SSBlendEquation.ReverseSubtract ? 'reverse-subtract' : 'add',
                },
                alpha: { ...PM_ALPHA },
            };
        }
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
    for (let mode = 0; mode < SS_BLEND_STATES.length; mode++) {
        const st = SS_BLEND_STATES[mode];
        const entry = [glFactor(gl, st.srcRGB), glFactor(gl, st.dstRGB), gl.ONE, gl.ONE_MINUS_SRC_ALPHA];
        // Only Sub departs from FUNC_ADD; the six-entry form adds the equations.
        // Some older WebGL1 drivers may lack reverse-subtract without an extension,
        // but we map it directly.
        if (st.eqRGB === SSBlendEquation.ReverseSubtract) entry.push(gl.FUNC_REVERSE_SUBTRACT, gl.FUNC_ADD);
        map[SS_BLEND_MODE_NAMES[mode]] = entry;
    }
    glPatched.add(map);
}

// A compile-time nudge: the name table is indexed by SSBlendMode, so a mode added
// to core without a name here is a hole rather than a silent fallback.
const _NAMES_COVER_EVERY_MODE: Record<SSBlendMode, string> = {
    [SSBlendMode.Mix]: SS_MIX_BLEND,
    [SSBlendMode.Add]: SS_ADD_BLEND,
    [SSBlendMode.Mul]: SS_MUL_BLEND,
    [SSBlendMode.Sub]: SS_SUB_BLEND,
    [SSBlendMode.Screen]: SS_SCREEN_BLEND,
    [SSBlendMode.Invert]: SS_INVERT_BLEND,
    [SSBlendMode.Exclusion]: SS_EXCLUSION_BLEND,
};
void _NAMES_COVER_EVERY_MODE;
