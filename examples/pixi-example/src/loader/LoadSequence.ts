/**
 * Every drop and every ssab pick is a new load, and the newest one wins: one
 * that is still reading files when the next begins stops at its next
 * `isCurrent` check, before it touches the player. Left to run on, the two bind
 * each other's packs, and the older one goes on to pick its own animation on the
 * newer pack.
 *
 * The player calls themselves go through `inTurn`, one at a time, each only if
 * its load is still the newest. `load()` binds once its fetch is back, so one
 * still fetching could otherwise bind over a newer pack that got there first.
 */
export class LoadSequence {
    private latest = 0;
    private turn: Promise<unknown> = Promise.resolve();

    /** Start a load. Every load begun before it is now stale. */
    public begin(): number {
        return ++this.latest;
    }

    public isCurrent(seq: number): boolean {
        return seq === this.latest;
    }

    /** Run a player call after the previous one, unless a newer load has begun by then. */
    public inTurn(seq: number, load: () => Promise<void>): Promise<void> {
        const run = this.turn.then(() => (this.isCurrent(seq) ? load() : undefined));
        this.turn = run.catch(() => {});
        return run;
    }
}
