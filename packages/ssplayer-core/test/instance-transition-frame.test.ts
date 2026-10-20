import { describe, expect, it, vi } from 'vitest';
import { InternalPlayerBase } from '../src/InternalPlayerBase.js';

// stepInstanceSlots only reaches the runtime through the slot and the two
// contexts, so it runs against fakes without booting WASM. What is pinned is
// what happens to the child's playhead and its own slots on the tick its slot
// transitions, and the time the child hands those slots.

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
            reset: vi.fn(),
        },
    };
    const childPlayer = {
        runtimeManager: { context: childContext },
        stepEffectSlots: vi.fn(),
        stepInstanceSlots: vi.fn(),
        resetSlots: vi.fn(),
    };
    const parent = Object.create(InternalPlayerBase.prototype) as InternalPlayerBase<never>;
    Object.assign(parent, {
        runtimeManager: {
            context: { get_frame_no: () => 10, get_active_event_instance: () => ({ speed: 1 }) },
        },
        _instanceChildren: new Map([[0, { slot, player: childPlayer, visible: false }]]),
    });
    return { parent, child, childContext, childPlayer, slot };
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

    it('starts its own slots over, before they step, and leaves the slot that started it alone', () => {
        const { parent, childPlayer, slot } = makeParent({ transitioned: true, independent: true, childFrameNo: 0 });
        stepParent(parent);
        expect(childPlayer.resetSlots).toHaveBeenCalledTimes(1);
        expect(childPlayer.resetSlots.mock.invocationCallOrder[0])
            .toBeLessThan(childPlayer.stepEffectSlots.mock.invocationCallOrder[0]);
        expect(childPlayer.resetSlots.mock.invocationCallOrder[0])
            .toBeLessThan(childPlayer.stepInstanceSlots.mock.invocationCallOrder[0]);
        expect(slot.raw.reset).not.toHaveBeenCalled();
    });

    it('keeps its own slots running on a tick without a transition', () => {
        const { parent, childPlayer } = makeParent({ transitioned: false, independent: true, childFrameNo: 0 });
        stepParent(parent);
        expect(childPlayer.resetSlots).not.toHaveBeenCalled();
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

describe('resetting a player\'s slots', () => {
    // An effect mid-play, with a step whose draw plan is still unbuilt.
    const makeEffect = () => ({
        slot: { raw: { reset: vi.fn() } },
        visible: true,
        ev: { free: vi.fn() } as { free: ReturnType<typeof vi.fn> } | null,
        frame: 3,
        drawn: false,
    });

    // A player holding one effect and one instance child, whose child holds an effect.
    function makeTree() {
        const player = (children: Map<number, unknown>) => {
            const p = Object.create(InternalPlayerBase.prototype) as InternalPlayerBase<never>;
            Object.assign(p, { _effectChildren: new Map([[0, makeEffect()]]), _instanceChildren: children, _prevFinished: true });
            return p;
        };
        const grandchild = player(new Map());
        const instance = { slot: { raw: { reset: vi.fn() } }, visible: true, player: grandchild };
        const root = player(new Map([[1, instance]]));
        return { root, instance, grandchild };
    }
    const reset = (p: InternalPlayerBase<never>) => (p as unknown as { resetSlots(): void }).resetSlots();
    const effectOf = (p: InternalPlayerBase<never>) =>
        (p as unknown as { _effectChildren: Map<number, ReturnType<typeof makeEffect>> })._effectChildren.get(0)!;

    it('resets every effect and instance slot, at every depth, in place', () => {
        const { root, instance, grandchild } = makeTree();
        const rootEffect = effectOf(root);
        const grandEffect = effectOf(grandchild);
        const pendingEv = rootEffect.ev!;
        reset(root);
        expect(rootEffect.slot.raw.reset).toHaveBeenCalledTimes(1);
        expect(instance.slot.raw.reset).toHaveBeenCalledTimes(1);
        expect(grandEffect.slot.raw.reset).toHaveBeenCalledTimes(1);
        // The same slots, not new ones.
        expect(effectOf(root)).toBe(rootEffect);
        expect(pendingEv.free).toHaveBeenCalledTimes(1);
        expect(rootEffect).toMatchObject({ visible: false, ev: null, drawn: true });
        expect(instance.visible).toBe(false);
        expect((grandchild as unknown as { _prevFinished: boolean })._prevFinished).toBe(false);
    });
});
