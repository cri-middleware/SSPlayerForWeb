import { describe, expect, it } from 'vitest';
import {
    applyPartOverrides,
    mergePartOverride,
    parsePartOverrideColor,
    prunePartOverridesForNewAnimation,
    removePartOverrides,
    SSBlendOp,
    SSOverridePriority,
    type SSPartOverride,
    type SSPartOverrideTarget,
} from '../src/PartOverride.js';

// The store is the policy hosts share when they have to survive a player being
// rebuilt (RPG Maker MZ pictures, TyranoScript save state). It is pure data, so
// it is pinned once here rather than once per host — the point of hoisting it
// into core is that the hosts cannot drift apart.

const color = (part: string, priority = SSOverridePriority.HoldUntilNextAnimation): SSPartOverride =>
    ({ kind: 'color', part, blendOp: SSBlendOp.Mix, rgba: 0xff0000ff, priority });
const cell = (part: string, priority = SSOverridePriority.HoldUntilNextAnimation): SSPartOverride =>
    ({ kind: 'cell', part, cellmap: 'Ringo', cell: 'effect3', priority });
const hidden = (part: string): SSPartOverride => ({ kind: 'visibility', part, hide: true, cascade: false });

describe('mergePartOverride', () => {
    it('replaces an override of the same kind on the same part', () => {
        const first = mergePartOverride([], color('apple'));
        const second = mergePartOverride(first, { ...color('apple'), rgba: 0x00ff00ff } as SSPartOverride);
        expect(second).toHaveLength(1);
        expect((second[0] as { rgba: number }).rgba).toBe(0x00ff00ff);
    });

    it('keeps different kinds on the same part side by side', () => {
        const list = mergePartOverride(mergePartOverride([], color('apple')), cell('apple'));
        expect(list.map(o => o.kind)).toEqual(['color', 'cell']);
    });

    it('keeps the same kind on different parts', () => {
        const list = mergePartOverride(mergePartOverride([], color('apple')), color('heta'));
        expect(list.map(o => o.part)).toEqual(['apple', 'heta']);
    });

    it('starts from an empty list when the host has none yet', () => {
        expect(mergePartOverride(undefined, color('apple'))).toHaveLength(1);
    });
});

describe('removePartOverrides', () => {
    it('drops every override on the named part only', () => {
        const list = [color('apple'), cell('apple'), hidden('heta')];
        expect(removePartOverrides(list, 'apple')).toEqual([hidden('heta')]);
    });

    it('clears everything when no part is named', () => {
        expect(removePartOverrides([color('apple'), hidden('heta')])).toEqual([]);
    });
});

describe('prunePartOverridesForNewAnimation', () => {
    // Mirrors the runtime: setting up an animation keeps only Permanent colour /
    // cell overrides and clears visibility unconditionally.
    it('keeps only the Permanent colour and cell overrides', () => {
        const list = [
            color('apple', SSOverridePriority.Permanent),
            color('heta', SSOverridePriority.HoldUntilNextAnimation),
            cell('apple', SSOverridePriority.Permanent),
            cell('heta', SSOverridePriority.OverwriteOnNextKeyframe),
        ];
        expect(prunePartOverridesForNewAnimation(list)).toEqual([
            color('apple', SSOverridePriority.Permanent),
            cell('apple', SSOverridePriority.Permanent),
        ]);
    });

    it('always drops visibility, which has no priority mode', () => {
        expect(prunePartOverridesForNewAnimation([hidden('apple')])).toEqual([]);
    });

    it('tolerates a host with no overrides', () => {
        expect(prunePartOverridesForNewAnimation(undefined)).toEqual([]);
    });
});

describe('applyPartOverrides', () => {
    function makeTarget(rejectParts: string[] = []) {
        const calls: { fn: string; args: unknown[] }[] = [];
        const record = (fn: string) => (...args: unknown[]) => {
            calls.push({ fn, args });
            return !rejectParts.includes(String(args[0]));
        };
        const target = {
            setPartColorOverride: record('color'),
            setPartCellOverride: record('cell'),
            setPartVisibilityOverride: record('visibility'),
        } as unknown as SSPartOverrideTarget;
        return { target, calls };
    }

    it('routes each kind to its own player method', () => {
        const { target, calls } = makeTarget();
        applyPartOverrides(target, [color('apple'), cell('apple'), hidden('heta')]);
        expect(calls.map(c => c.fn)).toEqual(['color', 'cell', 'visibility']);
        expect(calls[0].args).toEqual(['apple', SSBlendOp.Mix, 0xff0000ff, SSOverridePriority.HoldUntilNextAnimation]);
        expect(calls[1].args).toEqual(['apple', 'Ringo', 'effect3', SSOverridePriority.HoldUntilNextAnimation]);
        expect(calls[2].args).toEqual(['heta', true, false]);
    });

    it('keeps going when one entry is rejected, so a stale part name costs only itself', () => {
        const { target, calls } = makeTarget(['gone']);
        applyPartOverrides(target, [color('gone'), color('apple')]);
        expect(calls).toHaveLength(2);
    });

    it('does nothing when there is nothing stored', () => {
        const { target, calls } = makeTarget();
        applyPartOverrides(target, undefined);
        applyPartOverrides(target, []);
        expect(calls).toHaveLength(0);
    });
});

describe('parsePartOverrideColor', () => {
    it('accepts #RRGGBB and defaults alpha to opaque', () => {
        expect(parsePartOverrideColor('#0033FF')).toBe(0x0033ffff);
    });

    it('accepts #RRGGBBAA verbatim', () => {
        expect(parsePartOverrideColor('#0033FFBF')).toBe(0x0033ffbf);
    });

    it('expands the #RGB shorthand', () => {
        expect(parsePartOverrideColor('#03F')).toBe(0x0033ffff);
    });

    it('accepts the 0x-prefixed and bare forms', () => {
        expect(parsePartOverrideColor('0x0033FF')).toBe(0x0033ffff);
        expect(parsePartOverrideColor('0033ffbf')).toBe(0x0033ffbf);
    });

    it('returns null for input it cannot parse, so the caller can warn', () => {
        expect(parsePartOverrideColor('red')).toBeNull();
        expect(parsePartOverrideColor('#12345')).toBeNull();
        expect(parsePartOverrideColor('')).toBeNull();
    });
});
