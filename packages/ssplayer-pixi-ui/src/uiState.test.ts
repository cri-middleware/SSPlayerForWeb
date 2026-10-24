import { describe, it, expect } from 'vitest';
import type { SSLabelTable } from '@spritestudio/ssplayer-pixi';
import { resolveUiSection, uiStateOf, type SSUiClips, type SSUiSection, type SSUiState } from './uiState.js';

// The UI state rule, with no runtime: which state wins, which section each
// plays, where a state without a label falls back to, and what reduced motion
// holds. The label tables are written out here, since no example pack names
// its labels after the states.

function table(endFrame: number, labels: Record<string, number>): SSLabelTable {
    const list = Object.entries(labels).map(([name, frame]) => ({ name, frame })).sort((a, b) => a.frame - b.frame);
    return { labels: list, startFrame: 0, endFrame };
}

const TABLES: Record<string, SSLabelTable> = {
    button: table(99, { normal: 0, hover: 20, pressed: 40, disabled: 60, reduced_motion: 80 }),
    only_normal: table(49, { normal: 10, other: 30 }),
    with_hover: table(49, { normal: 0, hover: 25 }),
    plain: table(29, {}),
    glow: table(39, { calm: 5 }),
    caps: table(9, { Normal: 0, HOVER: 5 }),
};

function resolve(
    state: SSUiState,
    animation: string,
    options: { clips?: SSUiClips; reducedMotion?: boolean; missing?: string[] } = {},
): [string, number, number, boolean] | null {
    const s: SSUiSection | null = resolveUiSection(state, {
        animation,
        tableOf: name => TABLES[name] ?? null,
        clips: options.clips,
        reducedMotion: options.reducedMotion,
        onMissingClip: (st, clip) => options.missing?.push(`${st}:${JSON.stringify(clip)}`),
    });
    return s && [s.animation, s.startFrame, s.endFrame, s.hold];
}

describe('the UI state rule', () => {
    it('lets one state win: disabled, pressed, hover, focused, normal', () => {
        expect(uiStateOf({ disabled: true, pressed: true, hovered: true, focused: true })).toBe('disabled');
        expect(uiStateOf({ pressed: true, hovered: true, focused: true })).toBe('pressed');
        expect(uiStateOf({ hovered: true, focused: true })).toBe('hover');
        expect(uiStateOf({ focused: true })).toBe('focused');
        expect(uiStateOf({})).toBe('normal');
    });

    it('runs each state from its label to the frame before the next', () => {
        expect(resolve('normal', 'button')).toEqual(['button', 0, 19, false]);
        expect(resolve('hover', 'button')).toEqual(['button', 20, 39, false]);
        expect(resolve('pressed', 'button')).toEqual(['button', 40, 59, false]);
        expect(resolve('disabled', 'button')).toEqual(['button', 60, 79, false]);
        // The last label runs to the end of the animation.
        expect(resolve('normal', 'with_hover')).toEqual(['with_hover', 0, 24, false]);
        expect(resolve('hover', 'with_hover')).toEqual(['with_hover', 25, 49, false]);
    });

    it('falls a state without a label back', () => {
        // hover, focused and disabled to normal; pressed to hover, then normal.
        for (const s of ['hover', 'focused', 'disabled', 'pressed'] as const) {
            expect(resolve(s, 'only_normal'), s).toEqual(['only_normal', 10, 29, false]);
        }
        expect(resolve('pressed', 'with_hover')).toEqual(['with_hover', 25, 49, false]);
        expect(resolve('focused', 'button')).toEqual(['button', 0, 19, false]);
    });

    it('plays the whole animation with no normal either', () => {
        expect(resolve('hover', 'plain')).toEqual(['plain', 0, 29, false]);
    });

    it('matches labels exactly', () => {
        expect(resolve('hover', 'caps')).toEqual(['caps', 0, 9, false]);
    });

    it('lets a clip replace a state, and the states that fall back to it', () => {
        const clips: SSUiClips = {
            hover: { animation: 'glow' },
            disabled: { label: 'reduced_motion' },
            focused: { animation: 'glow', label: 'calm' },
        };
        expect(resolve('hover', 'only_normal', { clips })).toEqual(['glow', 0, 39, false]);
        // pressed has no label in only_normal, so it takes hover's clip.
        expect(resolve('pressed', 'only_normal', { clips })).toEqual(['glow', 0, 39, false]);
        expect(resolve('disabled', 'button', { clips })).toEqual(['button', 80, 99, false]);
        expect(resolve('focused', 'button', { clips })).toEqual(['glow', 5, 39, false]);
    });

    it('reports a clip the pack lacks, and plays the label', () => {
        const missing: string[] = [];
        expect(resolve('hover', 'button', { clips: { hover: { animation: 'nope' } }, missing })).toEqual(['button', 20, 39, false]);
        expect(missing).toHaveLength(1);
        missing.length = 0;
        expect(resolve('hover', 'button', { clips: { hover: { label: 'nope' } }, missing })).toEqual(['button', 20, 39, false]);
        expect(missing).toHaveLength(1);
    });

    it('has no section for an animation the pack lacks', () => {
        expect(resolve('normal', 'nope')).toBeNull();
    });

    describe('under reduced motion', () => {
        it('holds the section of every state but normal', () => {
            expect(resolve('hover', 'button', { reducedMotion: true })).toEqual(['button', 20, 39, true]);
            expect(resolve('disabled', 'button', { reducedMotion: true })).toEqual(['button', 60, 79, true]);
        });

        it('plays reduced_motion in place of normal, where there is one', () => {
            expect(resolve('normal', 'button', { reducedMotion: true })).toEqual(['button', 80, 99, false]);
            // focused has no label of its own and falls back to normal, so it
            // plays the calm loop too.
            expect(resolve('focused', 'button', { reducedMotion: true })).toEqual(['button', 80, 99, false]);
        });

        it('holds normal where there is none', () => {
            expect(resolve('normal', 'only_normal', { reducedMotion: true })).toEqual(['only_normal', 10, 29, true]);
            expect(resolve('normal', 'plain', { reducedMotion: true })).toEqual(['plain', 0, 29, true]);
        });
    });
});
