import { describe, it, expect, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// `frameNo` is the playhead and it is fractional (SDK:
// 20_design/40_api_conventions §3). The frame that gets DRAWN is a separate
// question, and turning sub-frame off is the whole of the difference between
// them.
//
// These used to be one accessor. `getFrameNo()` floored, because the renderers
// read it to decide which frame to ask the runtime for — so the public read-back
// reported 12 where every sibling Player reports 12.4, and `setFrame` threw the
// fraction away on the way in as well, which made the sub-frame toggle one-way.
//
// Fake context rather than booting WASM, the same trick the neighbouring suites
// use.

function makePlayer(subFrame: boolean) {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    let frame = 0;
    const set_frame_no = vi.fn((f: number) => { frame = f; });
    const player = Object.create(InternalPlayerBase.prototype) as any;
    player.runtimeManager = {
        context: {
            get_frame_no: () => frame,
            set_frame_no,
        },
    };
    player._subFrameEnabled = subFrame;
    player._effectChildren = new Map();
    player._instanceChildren = new Map();
    return player as InternalPlayerBase & { runtimeManager: any };
}

describe('the playhead and the drawn frame are different questions', () => {
    it('reports the playhead fractionally even with sub-frame off', () => {
        const player = makePlayer(false);
        player.setFrameNo(12.4);
        // What every sibling Player reports here: the playhead, untouched.
        expect(player.getFrameNo()).toBeCloseTo(12.4);
    });

    it('draws the floored frame with sub-frame off', () => {
        const player = makePlayer(false);
        player.setFrameNo(12.4);
        expect(player.getDrawFrame()).toBe(12);
    });

    it('draws the playhead itself with sub-frame on', () => {
        const player = makePlayer(true);
        player.setFrameNo(12.4);
        expect(player.getDrawFrame()).toBeCloseTo(12.4);
        expect(player.getDrawFrame()).toBeCloseTo(player.getFrameNo());
    });

    it('keeps the fraction across a sub-frame toggle', () => {
        // The reason the floor cannot live on the way in: a seek taken while
        // sub-frame is off must still be there when it is turned back on.
        const player = makePlayer(false);
        player.setFrameNo(12.4);
        expect(player.getDrawFrame()).toBe(12);

        player.subFrameEnabled = true;
        expect(player.getDrawFrame()).toBeCloseTo(12.4);
    });

    it('stores what the caller asked for, not a rounded copy of it', () => {
        const player = makePlayer(false);
        player.setFrameNo(12.4);
        expect(player.runtimeManager.context.set_frame_no).toHaveBeenCalledWith(12.4);
    });
});
