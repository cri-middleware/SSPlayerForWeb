import { describe, it, expect } from 'vitest';
import { SSPartFollower, type SSPartFollowHost, type SSPartFollowSource } from '../src/PartTransform.js';

// The follower is the bookkeeping ssplayer-pixi and ssplayer-rmmz used to each
// carry: which target follows which part, whether the hide on screen is one the
// follower imposed, and what detaching has to undo. Both the player it reads and
// the display objects it writes are injected, so all of that is testable here
// without a runtime, a GL context or a scene graph.

interface Target {
    name: string;
    visible: boolean;
    parented: boolean;
    affine: number[] | null;
    decomposed: { x: number; y: number; rotation: number; scaleX: number; scaleY: number } | null;
    axes: { position: boolean; rotation: boolean; scale: boolean } | null;
}

function target(name: string): Target {
    return { name, visible: true, parented: false, affine: null, decomposed: null, axes: null };
}

/** A stand-in player: parts by name, each with a transform and a hidden flag. */
class FakeSource implements SSPartSourceShape {
    parts = new Map<string, { index: number; hidden: boolean; affine: number[] }>();

    add(name: string, index: number, affine: number[], hidden = false): this {
        this.parts.set(name, { index, hidden, affine });
        return this;
    }

    private byIndex(index: number) {
        for (const p of this.parts.values()) if (p.index === index) return p;
        return undefined;
    }

    findPartIndex(partName: string): number {
        return this.parts.get(partName)?.index ?? -1;
    }
    isPartHidden(part: number | string): boolean | null {
        const p = typeof part === 'string' ? this.parts.get(part) : this.byIndex(part);
        return p ? p.hidden : null;
    }
    getPartTransform(part: number | string, out?: Float32Array): Float32Array | null {
        const p = typeof part === 'string' ? this.parts.get(part) : this.byIndex(part);
        if (!p) return null;
        const dst = out ?? new Float32Array(6);
        dst.set(p.affine);
        return dst;
    }
}
type SSPartSourceShape = SSPartFollowSource;

const host: SSPartFollowHost<Target> = {
    addChild: (t) => { t.parented = true; },
    removeChild: (t) => { t.parented = false; },
    setVisible: (t, v) => { t.visible = v; },
    applyAffine: (t, a) => { t.affine = [...a]; },
    applyDecomposed: (t, d, axes) => { t.decomposed = { ...d }; t.axes = { ...axes }; },
};

/** Identity affine translated to (tx, ty). */
const at = (tx: number, ty: number) => [1, 0, 0, 1, tx, ty];

describe('SSPartFollower', () => {
    it('drives a target to its part and parents it by default', () => {
        const source = new FakeSource().add('hand', 3, at(10, 20));
        const f = new SSPartFollower<Target>(source, host);
        const t = target('sword');

        f.attach('hand', t, { scale: true });
        expect(t.parented).toBe(true);

        f.update();
        // All three axes on → the exact affine, so skew and mirroring survive.
        // `scale` has to be asked for: it is off by default, because a follower
        // is placed at the part rather than sized by it.
        expect(t.affine).toEqual(at(10, 20));
        expect(t.decomposed).toBeNull();
    });

    it('writes only the enabled axes when not following all three', () => {
        const source = new FakeSource().add('hand', 3, at(10, 20));
        const f = new SSPartFollower<Target>(source, host);
        const t = target('sword');

        f.attach('hand', t, { rotation: false, scale: true });
        f.update();

        expect(t.affine).toBeNull();
        expect(t.axes).toEqual({ position: true, rotation: false, scale: true });
        expect(t.decomposed?.x).toBe(10);
    });

    it('hides a target whose part is absent, and restores it when the part returns', () => {
        const source = new FakeSource();
        const f = new SSPartFollower<Target>(source, host);
        const t = target('effect');

        f.attach('muzzle', t);
        f.update();
        expect(t.visible).toBe(false); // part not in this animation

        source.add('muzzle', 7, at(1, 2));
        f.update();
        expect(t.visible).toBe(true);
        expect(t.decomposed?.x).toBe(1);
        expect(t.decomposed?.y).toBe(2);
    });

    it('only hides for a hidden part when asked to, and keeps following otherwise', () => {
        const source = new FakeSource().add('hand', 3, at(5, 5), true);
        const follow = new SSPartFollower<Target>(source, host);
        const hide = new SSPartFollower<Target>(source, host);
        const a = target('follows');
        const b = target('hides');

        follow.attach('hand', a); // onHide defaults to 'follow'
        hide.attach('hand', b, { onHide: 'hide' });
        follow.update();
        hide.update();

        expect(a.visible).toBe(true);
        expect(a.decomposed?.x).toBe(5);
        expect(a.decomposed?.y).toBe(5);
        expect(b.visible).toBe(false);
    });

    it('detach undoes only the visibility IT took away', () => {
        const source = new FakeSource();
        const f = new SSPartFollower<Target>(source, host);
        const ours = target('ours');
        const theirs = target('theirs');

        // `ours` gets hidden by the follower (unknown part).
        f.attach('nope', ours);
        f.update();
        expect(ours.visible).toBe(false);
        f.detach(ours);
        expect(ours.visible).toBe(true);

        // `theirs` was hidden by the host before attaching, and stays hidden:
        // the follower never hid it, so it has nothing to restore.
        theirs.visible = false;
        source.add('hand', 1, at(0, 0));
        f.attach('hand', theirs);
        f.update();
        f.detach(theirs);
        expect(theirs.visible).toBe(false);
    });

    it('re-attaching the same target replaces rather than stacks', () => {
        const source = new FakeSource().add('a', 1, at(1, 1)).add('b', 2, at(2, 2));
        const f = new SSPartFollower<Target>(source, host);
        const t = target('t');

        f.attach('a', t);
        f.attach('b', t);
        expect(f.size).toBe(1);

        f.update();
        expect(t.decomposed?.x).toBe(2);
        expect(t.decomposed?.y).toBe(2); // the newer part won
    });

    it('detachAll clears everything, so teardown leaves no target hidden or parented', () => {
        const source = new FakeSource();
        const f = new SSPartFollower<Target>(source, host);
        const a = target('a');
        const b = target('b');

        f.attach('missing1', a);
        f.attach('missing2', b);
        f.update(); // both hidden: their parts do not exist
        f.detachAll();

        expect(f.size).toBe(0);
        expect([a.visible, b.visible]).toEqual([true, true]);
        expect([a.parented, b.parented]).toEqual([false, false]);
    });

    it('leaves a target alone when addAsChild is off', () => {
        const source = new FakeSource().add('hand', 1, at(3, 4));
        const f = new SSPartFollower<Target>(source, host);
        const t = target('t');

        f.attach('hand', t, { addAsChild: false });
        expect(t.parented).toBe(false);

        f.update();
        expect(t.decomposed?.x).toBe(3);
        expect(t.decomposed?.y).toBe(4); // still driven, just not re-parented
        f.detach(t);
        expect(t.parented).toBe(false);
    });

    it('accepts a part index as well as a name', () => {
        const source = new FakeSource().add('hand', 9, at(7, 8));
        const f = new SSPartFollower<Target>(source, host);
        const t = target('t');

        f.attach(9, t);
        f.update();

        expect(t.decomposed?.x).toBe(7);
        expect(t.decomposed?.y).toBe(8);
    });
});
