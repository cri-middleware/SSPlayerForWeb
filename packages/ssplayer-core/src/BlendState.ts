import { BlendType } from './ss/runtime/blend-type.js';

/**
 * Blend factors, named for what they multiply rather than for any one graphics
 * API's spelling. Each renderer maps these onto its own constants once.
 */
export enum SSBlendFactor {
    Zero,
    One,
    DstColor,
    OneMinusSrcAlpha,
    OneMinusDstColor,
    OneMinusSrcColor,
}

/** How the weighted source and destination are combined. */
export enum SSBlendEquation {
    Add,
    ReverseSubtract,
}

/**
 * The seven fixed-function states SpriteStudio's twelve `BlendType` values
 * actually realise. Five of the twelve have no GPU-native equivalent and land on
 * one of these; see {@link ssBlendMode}.
 */
export enum SSBlendMode {
    Mix,
    Add,
    Mul,
    Sub,
    Screen,
    Invert,
    Exclusion,
}

/** One fixed-function colour blend: `src * srcRGB (eqRGB) dst * dstRGB`. */
export interface SSBlendState {
    srcRGB: SSBlendFactor;
    dstRGB: SSBlendFactor;
    eqRGB: SSBlendEquation;
}

/**
 * The alpha half, identical for every mode: premultiplied coverage, so parts
 * stay visible against a target whose destination alpha SpriteStudio treats as
 * moot (it renders to an opaque one).
 */
export const SS_BLEND_ALPHA: Readonly<SSBlendState> = {
    srcRGB: SSBlendFactor.One,
    dstRGB: SSBlendFactor.OneMinusSrcAlpha,
    eqRGB: SSBlendEquation.Add,
};

/**
 * The colour blend for each {@link SSBlendMode}, indexed by it.
 *
 * SpriteStudio realises every blend as a fixed-function GPU blend state, reading
 * the destination framebuffer through the `Dst*` factors. These are those
 * states, and they are the same states whichever API is asked for them:
 * `ssplayer-webgl` hands them to `gl.blendFuncSeparate`, `ssplayer-pixi` registers
 * them as real GPU blend modes for both its WebGL and WebGPU backends. Writing
 * them once is what keeps the three tables from disagreeing.
 */
export const SS_BLEND_STATES: readonly Readonly<SSBlendState>[] = [
    // Mix       — src over dst
    { srcRGB: SSBlendFactor.One, dstRGB: SSBlendFactor.OneMinusSrcAlpha, eqRGB: SSBlendEquation.Add },
    // Add       — src + dst
    { srcRGB: SSBlendFactor.One, dstRGB: SSBlendFactor.One, eqRGB: SSBlendEquation.Add },
    // Mul       — src * dst
    { srcRGB: SSBlendFactor.DstColor, dstRGB: SSBlendFactor.OneMinusSrcAlpha, eqRGB: SSBlendEquation.Add },
    // Sub       — dst - src
    { srcRGB: SSBlendFactor.One, dstRGB: SSBlendFactor.One, eqRGB: SSBlendEquation.ReverseSubtract },
    // Screen    — (1-dst)*src + dst
    { srcRGB: SSBlendFactor.OneMinusDstColor, dstRGB: SSBlendFactor.One, eqRGB: SSBlendEquation.Add },
    // Invert    — (1-dst)*src
    { srcRGB: SSBlendFactor.OneMinusDstColor, dstRGB: SSBlendFactor.Zero, eqRGB: SSBlendEquation.Add },
    // Exclusion — (1-dst)*src + (1-src)*dst
    { srcRGB: SSBlendFactor.OneMinusDstColor, dstRGB: SSBlendFactor.OneMinusSrcColor, eqRGB: SSBlendEquation.Add },
];

/**
 * Which of the seven states a `BlendType` is drawn with.
 *
 * Seven of the twelve map to a state of their own. The remaining five have no
 * fixed-function equivalent and are approximated: `Mulalpha` and `Mul2` fall
 * back to `Mul`, `Screen2` to `Screen`, and `Div2` / `Overlay2` to `Mix` — the
 * same fallback an unrecognised value takes.
 */
export function ssBlendMode(blendType: BlendType | number): SSBlendMode {
    switch (blendType) {
        case BlendType.Mix: return SSBlendMode.Mix;
        case BlendType.Mul: return SSBlendMode.Mul;
        case BlendType.Add: return SSBlendMode.Add;
        case BlendType.Sub: return SSBlendMode.Sub;
        case BlendType.Screen: return SSBlendMode.Screen;
        case BlendType.Exclusion: return SSBlendMode.Exclusion;
        case BlendType.Invert: return SSBlendMode.Invert;
        case BlendType.Mulalpha: return SSBlendMode.Mul;
        case BlendType.Mul2: return SSBlendMode.Mul;
        case BlendType.Screen2: return SSBlendMode.Screen;
        case BlendType.Div2: return SSBlendMode.Mix;
        case BlendType.Overlay2: return SSBlendMode.Mix;
        default: return SSBlendMode.Mix;
    }
}

/** The colour blend a `BlendType` is drawn with — {@link ssBlendMode} resolved. */
export function ssBlendState(blendType: BlendType | number): Readonly<SSBlendState> {
    return SS_BLEND_STATES[ssBlendMode(blendType)];
}
