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
    SSPartOverrideStore,
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
        expect(calls[0].args).toEqual(['apple', 0xff0000ff, SSBlendOp.Mix, SSOverridePriority.HoldUntilNextAnimation]);
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

// --- SSPartOverrideStore ---------------------------------------------------
//
// What matters here is
// that the stored list and the live runtime cannot drift: every operation has to
// touch both, and the pair of animation-change methods has to differ in exactly
// the documented way.

describe('SSPartOverrideStore', () => {
    function makeStore(initial: SSPartOverride[] = [], withPlayer = true) {
        const calls: string[] = [];
        let list: SSPartOverride[] | undefined = initial.length ? [...initial] : undefined;
        const player = {
            setPartColorOverride: (p: number | string) => { calls.push(`color:${p}`); return true; },
            setPartCellOverride: (p: number | string) => { calls.push(`cell:${p}`); return true; },
            setPartVisibilityOverride: (p: number | string) => { calls.push(`vis:${p}`); return true; },
            clearPartColorOverride: (p: number | string) => { calls.push(`-color:${p}`); return true; },
            clearPartCellOverride: (p: number | string) => { calls.push(`-cell:${p}`); return true; },
            clearPartVisibilityOverride: (p: number | string) => { calls.push(`-vis:${p}`); return true; },
            clearAllPartOverrides: () => { calls.push('-all'); return true; },
        };
        const writes: number[] = [];
        const store = new SSPartOverrideStore({
            read: () => list,
            write: (l) => { list = l; writes.push(l.length); },
            player: () => (withPlayer ? player : null),
        });
        return { store, calls, writes, current: () => list ?? [] };
    }

    const color = (part: string, priority = SSOverridePriority.HoldUntilNextAnimation): SSPartOverride =>
        ({ kind: 'color', part, blendOp: SSBlendOp.Mix, rgba: 0xff0000ff, priority });

    it('set stores and applies in one step', () => {
        const s = makeStore();
        s.store.set(color('body'));
        expect(s.current()).toEqual([color('body')]);
        expect(s.calls).toEqual(['color:body']);
    });

    it('set still stores when no player is mounted yet', () => {
        // RPG Maker MZ writes overrides onto a picture whose .ssab is still
        // loading; the stored copy is what the mount replays.
        const s = makeStore([], false);
        s.store.set(color('body'));
        expect(s.current()).toEqual([color('body')]);
        expect(s.calls).toEqual([]);
    });

    it('clear drops one part from both the list and the runtime', () => {
        const s = makeStore([color('body'), color('head')]);
        s.store.clear('body');
        expect(s.current()).toEqual([color('head')]);
        expect(s.calls).toEqual(['-color:body', '-cell:body', '-vis:body']);
    });

    it('clear with no part empties both', () => {
        const s = makeStore([color('body'), color('head')]);
        s.store.clear();
        expect(s.current()).toEqual([]);
        expect(s.calls).toEqual(['-all']);
    });

    it('pruneForNewAnimation keeps only what the runtime keeps, and touches nothing else', () => {
        const s = makeStore([color('body'), color('head', SSOverridePriority.Permanent)]);
        s.store.pruneForNewAnimation();
        // The runtime already dropped the non-Permanent one itself, so this must
        // NOT re-apply anything — it only stops a later restore resurrecting it.
        expect(s.current()).toEqual([color('head', SSOverridePriority.Permanent)]);
        expect(s.calls).toEqual([]);
    });

    it('pruneForNewAnimation does not write when there is nothing stored', () => {
        const s = makeStore();
        s.store.pruneForNewAnimation();
        expect(s.writes).toEqual([]);
    });

    it('reapply puts the whole list back without changing it', () => {
        // The lip-sync swap: an animation change the author never asked for, so
        // the overrides it dropped are collateral damage and go straight back.
        const s = makeStore([color('body'), color('head')]);
        s.store.reapply();
        expect(s.calls).toEqual(['color:body', 'color:head']);
        expect(s.writes).toEqual([]);
        expect(s.current()).toHaveLength(2);
    });

    it('prune and reapply are opposites, which is the distinction hosts get wrong', () => {
        const pruned = makeStore([color('body')]);
        pruned.store.pruneForNewAnimation();
        expect(pruned.current()).toEqual([]); // gone for good

        const kept = makeStore([color('body')]);
        kept.store.reapply();
        expect(kept.current()).toEqual([color('body')]); // still there, and back on screen
        expect(kept.calls).toEqual(['color:body']);
    });
});
