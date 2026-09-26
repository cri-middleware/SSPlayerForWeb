/**
 * The listeners of one player event, dispatched the way DOM `EventTarget`
 * dispatches: a dispatch calls the listeners registered when it began and
 * still registered when their turn comes.
 *
 * A plain `Set` visits a listener added during its own `forEach`, so a
 * callback that reacts to an event by subscribing for the next one is handed
 * the event it is reacting to. Dispatching over a snapshot fixes
 * that, but the frame event fires every frame, and a copy per dispatch is an
 * allocation per frame. So the array is copied on `add` and `delete` instead,
 * and a dispatch walks whichever array was current when it began.
 */
export class ListenerSet<T = void> {
  private readonly _live = new Set<(event: T) => void>();
  private _order: ReadonlyArray<(event: T) => void> = [];

  /** Number of registered listeners. */
  public get size(): number {
    return this._live.size;
  }

  /** Register `listener` (once, however often it is added). Returns its unsubscribe. */
  public add(listener: (event: T) => void): () => void {
    if (!this._live.has(listener)) {
      this._live.add(listener);
      this._order = [...this._order, listener];
    }
    return () => this.delete(listener);
  }

  /** Unregister `listener`. A dispatch in progress skips it from here on. */
  public delete(listener: (event: T) => void): void {
    if (!this._live.delete(listener)) return;
    this._order = this._order.filter((l) => l !== listener);
  }

  /** Call every listener registered now, in registration order. */
  public emit(event: T): void {
    const order = this._order;
    for (let i = 0; i < order.length; i++) {
      const listener = order[i];
      if (this._live.has(listener)) listener(event);
    }
  }
}
