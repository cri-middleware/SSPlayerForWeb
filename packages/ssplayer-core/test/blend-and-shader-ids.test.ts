import { describe, expect, it } from 'vitest';
import { BlendType } from '../src/ss/runtime/blend-type.js';
import {
    SSBlendEquation,
    SSBlendFactor,
    SSBlendMode,
    SS_BLEND_STATES,
    ssBlendMode,
    ssBlendState,
} from '../src/BlendState.js';
import { SS_SHADER_IDS, SS_SHADER_ID_HASHES, ssFnv1a, ssShaderIdHash } from '../src/ShaderIds.js';

/**
 * The blend table and the `ss-*` id ↔ hash pairing live once, in core. These
 * tests assert against literal values, so a change to the shared table has to be a deliberate
 * one rather than a typo nobody sees until a blend looks off or a shader silently
 * never matches.
 */
describe('SS blend states', () => {
    it('realises the twelve BlendType values as the seven fixed-function states', () => {
        // The eight with a state of their own.
        expect(ssBlendMode(BlendType.Mix)).toBe(SSBlendMode.Mix);
        expect(ssBlendMode(BlendType.Mul)).toBe(SSBlendMode.Mul);
        expect(ssBlendMode(BlendType.Add)).toBe(SSBlendMode.Add);
        expect(ssBlendMode(BlendType.Sub)).toBe(SSBlendMode.Sub);
        expect(ssBlendMode(BlendType.Screen)).toBe(SSBlendMode.Screen);
        expect(ssBlendMode(BlendType.Exclusion)).toBe(SSBlendMode.Exclusion);
        expect(ssBlendMode(BlendType.Invert)).toBe(SSBlendMode.Invert);

        // The SS6-era "2" variants, approximated.
        expect(ssBlendMode(BlendType.Mulalpha)).toBe(SSBlendMode.Mul);
        expect(ssBlendMode(BlendType.Mul2)).toBe(SSBlendMode.Mul);
        expect(ssBlendMode(BlendType.Screen2)).toBe(SSBlendMode.Screen);
        expect(ssBlendMode(BlendType.Div2)).toBe(SSBlendMode.Mix);
        expect(ssBlendMode(BlendType.Overlay2)).toBe(SSBlendMode.Mix);
    });

    it('falls back to Mix for a value the runtime has not taught it', () => {
        expect(ssBlendMode(99)).toBe(SSBlendMode.Mix);
    });

    it('keeps the factor pairs the renderers were carrying', () => {
        const f = SSBlendFactor;
        const expected: Record<SSBlendMode, [SSBlendFactor, SSBlendFactor, SSBlendEquation]> = {
            [SSBlendMode.Mix]: [f.One, f.OneMinusSrcAlpha, SSBlendEquation.Add],
            [SSBlendMode.Add]: [f.One, f.One, SSBlendEquation.Add],
            [SSBlendMode.Mul]: [f.DstColor, f.OneMinusSrcAlpha, SSBlendEquation.Add],
            [SSBlendMode.Sub]: [f.One, f.One, SSBlendEquation.ReverseSubtract],
            [SSBlendMode.Screen]: [f.OneMinusDstColor, f.One, SSBlendEquation.Add],
            [SSBlendMode.Invert]: [f.OneMinusDstColor, f.Zero, SSBlendEquation.Add],
            [SSBlendMode.Exclusion]: [f.OneMinusDstColor, f.OneMinusSrcColor, SSBlendEquation.Add],
        };
        for (const [mode, [srcRGB, dstRGB, eqRGB]] of Object.entries(expected)) {
            expect(SS_BLEND_STATES[Number(mode)]).toEqual({ srcRGB, dstRGB, eqRGB });
        }
    });

    it('has a state for every mode, and resolves one for every BlendType', () => {
        expect(SS_BLEND_STATES).toHaveLength(7);
        for (const value of Object.values(BlendType)) {
            if (typeof value !== 'number') continue;
            expect(ssBlendState(value)).toBeDefined();
        }
    });
});

describe('ss-* shader ids', () => {
    // The values ssplayer-webgl carried as literals. Keeping them here is what
    // lets the pairing be computed rather than written out in each renderer.
    const KNOWN: Record<string, number> = {
        'ss-sepia': 0x36629dfc,
        'ss-hsb': 0x8a5c3037,
        'ss-step': 0x1b721788,
        'ss-pix': 0xc488a527,
        'ss-noise': 0x80d6d514,
        'ss-bmask': 0x64e07450,
        'ss-outline': 0x8f8307d4,
        'ss-blur': 0xb59c8d1b,
        'ss-wave': 0xe1df9a2b,
        'ss-move': 0xe1c1ee07,
        'ss-scatter': 0x45e35578,
        'ss-circle': 0x9b90e282,
        'ss-spot': 0x7140896a,
    };

    it('ss_shader_id_hashes_are_stable', () => {
        expect(SS_SHADER_IDS).toHaveLength(13);
        expect([...SS_SHADER_IDS].sort()).toEqual(Object.keys(KNOWN).sort());
        for (const [id, hash] of Object.entries(KNOWN)) {
            expect(ssShaderIdHash(id)).toBe(hash);
            expect(SS_SHADER_ID_HASHES.get(id)).toBe(hash);
        }
    });

    it('hashes an unknown id rather than refusing it', () => {
        // A shader id the SDK adds later still resolves, so a renderer that ships
        // a program for it works without a core release.
        expect(ssShaderIdHash('ss-not-a-builtin')).toBe(ssFnv1a('ss-not-a-builtin'));
    });

    it('matches the FNV-1a the converter and runtime use', () => {
        // The empty string is FNV-1a's offset basis; "a" is one round of it.
        expect(ssFnv1a('')).toBe(2166136261);
        expect(ssFnv1a('a')).toBe(0xe40c292c);
    });
});
