import { describe, it, expect } from 'vitest';
import { ListenerSet } from '../src/ListenerSet.js';

// A player's events are dispatched to host callbacks that often react by
// subscribing again — "wait for the next signal" started from inside the one
// that ended the previous wait. The event being dispatched must not reach them.

describe('ListenerSet', () => {
    it('calls each listener once, in registration order', () => {
        const set = new ListenerSet<number>();
        const seen: string[] = [];
        const a = (n: number) => seen.push(`a${n}`);
        set.add(a);
        set.add((n) => seen.push(`b${n}`));
        set.add(a); // already registered

        set.emit(1);

        expect(seen).toEqual(['a1', 'b1']);
        expect(set.size).toBe(2);
    });

    it('does not hand the event in flight to a listener added during it', () => {
        const set = new ListenerSet<string>();
        const seen: string[] = [];
        const off = set.add((e) => {
            seen.push(`first:${e}`);
            off();
            set.add((next) => seen.push(`second:${next}`));
        });

        set.emit('hit');
        expect(seen).toEqual(['first:hit']);

        set.emit('step');
        expect(seen).toEqual(['first:hit', 'second:step']);
    });

    it('skips a listener removed earlier in the same dispatch', () => {
        const set = new ListenerSet();
        const seen: string[] = [];
        let offB = () => {};
        set.add(() => { seen.push('a'); offB(); });
        offB = set.add(() => seen.push('b'));

        set.emit();

        expect(seen).toEqual(['a']);
        expect(set.size).toBe(1);
    });

    it('unsubscribes idempotently', () => {
        const set = new ListenerSet();
        const off = set.add(() => {});
        off();
        off();
        expect(set.size).toBe(0);
    });
});
