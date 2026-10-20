import { describe, expect, it, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// stepInstanceSlots only reaches the runtime through the slot and the two
// contexts, so it runs against fakes without booting WASM. What is pinned is
// what happens to the child's playhead on the tick its slot transitions.

interface Step {
    transitioned: boolean;
    independent: boolean;
    childFrameNo: number;
    speed?: number;
}

function makeParent(step: Step) {
    // The child's playhead as the runtime keeps it: the slot's step leaves it on
    // `childFrameNo`, and play() puts a synced child on its section's first frame.
    const child = { frame: 0 };
    const childContext = {
        play: vi.fn(() => { child.frame = 0; }),
        set_frame_no: vi.fn((f: number) => { child.frame = f; }),
    };
    const slot = {
        raw: {
            step: vi.fn(() => { child.frame = step.childFrameNo; return true; }),
            transitioned: () => step.transitioned,
            independent: () => step.independent,
            child_frame_no: () => step.childFrameNo,
            child_looped: () => false,
            get_speed: () => step.speed ?? 1,
        },
    };
    const childPlayer = {
        runtimeManager: { context: childContext },
        stepEffectSlots: vi.fn(),
        stepInstanceSlots: vi.fn(),
    };
    const parent = Object.create(InternalPlayerBase.prototype) as InternalPlayerBase<never>;
    Object.assign(parent, {
        runtimeManager: {
            context: { get_frame_no: () => 10, get_active_event_instance: () => ({ speed: 1 }) },
        },
        _instanceChildren: new Map([[0, { slot, player: childPlayer, visible: false }]]),
    });
    return { parent, child, childContext, childPlayer };
}

const stepParent = (parent: InternalPlayerBase<never>) =>
    (parent as unknown as { stepInstanceSlots(dt: number, looped: boolean): void }).stepInstanceSlots(1 / 60, false);

describe('an instance child on the tick its slot transitions', () => {
    it('is drawn at the slot\'s frame when it is synced, not back at its section start', () => {
        const { parent, child, childContext } = makeParent({ transitioned: true, independent: false, childFrameNo: 12.5 });
        stepParent(parent);
        expect(childContext.play).toHaveBeenCalledTimes(1);
        expect(child.frame).toBe(12.5);
    });

    it('is left where play() puts it when it plays on its own', () => {
        const { parent, child, childContext } = makeParent({ transitioned: true, independent: true, childFrameNo: 0 });
        stepParent(parent);
        expect(childContext.play).toHaveBeenCalledTimes(1);
        expect(childContext.set_frame_no).not.toHaveBeenCalled();
        expect(child.frame).toBe(0);
    });

    it('is not touched on a tick without a transition', () => {
        const { parent, childContext } = makeParent({ transitioned: false, independent: false, childFrameNo: 12.5 });
        stepParent(parent);
        expect(childContext.play).not.toHaveBeenCalled();
        expect(childContext.set_frame_no).not.toHaveBeenCalled();
    });
});

describe('the time an instance child hands its own effects and instances', () => {
    it('is scaled by the speed the slot stepped the child at, not the event\'s', () => {
        // The event is the implicit key at speed 1 while the slot keeps running
        // the child at its last real key's 1.5.
        const { parent, childPlayer } = makeParent({ transitioned: false, independent: true, childFrameNo: 0, speed: -1.5 });
        stepParent(parent);
        expect(childPlayer.stepEffectSlots).toHaveBeenCalledWith(1.5 / 60, false);
        expect(childPlayer.stepInstanceSlots).toHaveBeenCalledWith(1.5 / 60, false);
    });
});
