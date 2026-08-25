import { describe, it, expect, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';
import { SSBlendOp, SSOverridePriority } from '../src/PartOverride.js';

// The override methods only translate arguments and marshal the WASM boundary's
// throw-on-reject into the boolean contract shared with the Godot / Unity
// players, so they can be pinned against a fake context without booting WASM.
// `hashString` is the one real WASM call in the path — stubbed here so the cell
// override can be exercised too (the hash values themselves are the runtime's
// concern, pinned on its side).
vi.mock('../src/SSRuntimeManager.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/SSRuntimeManager.js')>()),
    hashString: (name: string) => (name ? name.length : 0),
}));

type Call = { fn: string; args: unknown[] };

/**
 * A stand-in runtime context that records what it was called with. `parts` maps
 * a part name to its index, mirroring `find_part_index` (-1 when unknown);
 * `reject` names the calls that should throw, as the real binding does when the
 * runtime refuses an override.
 */
function makePlayer(parts: Record<string, number> = { body: 3 }, reject: string[] = []) {
    const calls: Call[] = [];
    const record = (fn: string) => (...args: unknown[]) => {
        calls.push({ fn, args });
        if (reject.includes(fn)) throw new Error(`runtime rejected ${fn}`);
    };
    const ctx = {
        find_part_index: (name: string) => parts[name] ?? -1,
        set_part_visibility_override: record('set_part_visibility_override'),
        clear_part_visibility_override: record('clear_part_visibility_override'),
        set_part_color_override: record('set_part_color_override'),
        set_part_color_override_corners: record('set_part_color_override_corners'),
        clear_part_color_override: record('clear_part_color_override'),
        set_part_cell_override: record('set_part_cell_override'),
        clear_part_cell_override: record('clear_part_cell_override'),
        clear_all_part_overrides: record('clear_all_part_overrides'),
    };

    const player = Object.create(InternalPlayerBase.prototype) as InternalPlayerBase<never>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (player as any).runtimeManager = { context: ctx };
    return { player, calls };
}

describe('findPartIndex', () => {
    it('delegates to the runtime and reports an unknown part as -1', () => {
        const { player } = makePlayer({ body: 3 });
        expect(player.findPartIndex('body')).toBe(3);
        expect(player.findPartIndex('nope')).toBe(-1);
    });
});

describe('part resolution', () => {
    it('accepts a name and resolves it through the runtime', () => {
        const { player, calls } = makePlayer({ body: 3 });
        expect(player.clearPartColorOverride('body')).toBe(true);
        expect(calls[0]).toEqual({ fn: 'clear_part_color_override', args: [3] });
    });

    it('accepts an index and passes it straight through', () => {
        const { player, calls } = makePlayer();
        expect(player.clearPartColorOverride(7)).toBe(true);
        expect(calls[0]).toEqual({ fn: 'clear_part_color_override', args: [7] });
    });

    it('fails without calling the runtime when the name is unknown', () => {
        const { player, calls } = makePlayer({ body: 3 });
        expect(player.setPartVisibilityOverride('missing', true)).toBe(false);
        expect(calls).toHaveLength(0);
    });

    it('rejects a negative or fractional index without calling the runtime', () => {
        const { player, calls } = makePlayer();
        expect(player.clearPartCellOverride(-1)).toBe(false);
        expect(player.clearPartCellOverride(1.5)).toBe(false);
        expect(calls).toHaveLength(0);
    });
});

describe('visibility override', () => {
    it('maps hide to the runtime force flag and forwards cascade', () => {
        const { player, calls } = makePlayer();
        player.setPartVisibilityOverride(2, true, true);
        player.setPartVisibilityOverride(2, false);
        // force: 1 = force-hide, 0 = revert. cascade defaults to false.
        expect(calls[0].args).toEqual([2, 1, true]);
        expect(calls[1].args).toEqual([2, 0, false]);
    });
});

describe('colour override', () => {
    it('passes the packed RGBA through and defaults to HoldUntilNextAnimation', () => {
        const { player, calls } = makePlayer();
        player.setPartColorOverride(1, 0xff0000ff, SSBlendOp.Mul);
        expect(calls[0].args).toEqual([1, SSBlendOp.Mul, 0xff0000ff, SSOverridePriority.HoldUntilNextAnimation]);
    });

    it('defaults the blend to Mix when it is left out', () => {
        const { player, calls } = makePlayer();
        player.setPartColorOverride(1, 0xff0000ff);
        expect(calls[0].args[1]).toBe(SSBlendOp.Mix);
    });

    it('normalises a colour written as a negative int32 to its unsigned value', () => {
        const { player, calls } = makePlayer();
        // 0xFF0000FF authored as a signed literal — the runtime takes a u32.
        player.setPartColorOverride(1, -16776961, SSBlendOp.Mix);
        expect(calls[0].args[2]).toBe(0xff0000ff);
    });

    it('keeps the four corners in the runtime lt, rt, lb, rb order', () => {
        const { player, calls } = makePlayer();
        player.setPartColorOverrideCorners(
            1,
            [0x11111111, 0x22222222, 0x33333333, 0x44444444],
            SSBlendOp.Mix,
            SSOverridePriority.Permanent,
        );
        expect(calls[0].args[2]).toEqual(new Uint32Array([0x11111111, 0x22222222, 0x33333333, 0x44444444]));
        expect(calls[0].args[3]).toBe(SSOverridePriority.Permanent);
    });
});

describe('cell override', () => {
    it('hashes the cell-map and cell names for the runtime', () => {
        const { player, calls } = makePlayer();
        // The mocked hashString returns the name length.
        player.setPartCellOverride(4, 'Ringo', 'effect3');
        expect(calls[0].args).toEqual([4, 5, 7, SSOverridePriority.HoldUntilNextAnimation]);
    });

    it('sends the (0, 0) revert sentinel for empty names', () => {
        const { player, calls } = makePlayer();
        player.setPartCellOverride(4, '', '');
        expect(calls[0].args.slice(0, 3)).toEqual([4, 0, 0]);
    });
});

describe('runtime rejection', () => {
    it('reports a rejected override as false instead of throwing', () => {
        const { player } = makePlayer({ body: 3 }, ['set_part_cell_override']);
        expect(() => player.setPartCellOverride('body', 'Ringo', 'nope')).not.toThrow();
        expect(player.setPartCellOverride('body', 'Ringo', 'nope')).toBe(false);
    });

    it('reports a destroyed player as false rather than throwing', () => {
        const { player } = makePlayer();
        // destroy() nulls the context; hosts commonly clean up out of order.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (player as any).runtimeManager.context = null;
        expect(player.clearAllPartOverrides()).toBe(false);
    });
});

describe('clearAllPartOverrides', () => {
    it('clears every part in one runtime call', () => {
        const { player, calls } = makePlayer();
        expect(player.clearAllPartOverrides()).toBe(true);
        expect(calls).toEqual([{ fn: 'clear_all_part_overrides', args: [] }]);
    });
});
