/** A live GPU texture and the size it was uploaded at. */
export interface SSTextureEntry {
  tex: WebGLTexture;
  width: number;
  height: number;
}

/**
 * Surface-scoped texture cache: one GPU upload per URL, shared by every player
 * on the same {@link SSSurface}.
 *
 * A `WebGLTexture` belongs to the context that created it, so the cache is
 * per-context — exactly the scope a Surface owns. Two characters using the same
 * atlas on one surface then cost one upload instead of two, which for a cast of
 * the same character is most of the texture memory they would otherwise take.
 *
 * **Keyed by URL, deliberately not by cell-map hash.** The hash the core passes
 * around comes from the cell-map *name*, so two unrelated `.ssab` files that both
 * contain a cell map of that name collide on it — and sharing on that key would
 * hand one character another character's atlas. That is not hypothetical at
 * surface scope: `ssplayer-tyranoscript` puts unrelated characters on one
 * surface, and an overlay puts unrelated *projects* on one. The URL is the real
 * identity, and the core builds it from the owning `.ssab`'s own directory.
 *
 * Nothing is refcounted. Cached textures live until the Surface is destroyed, so
 * one player tearing down can never pull a texture out from under another — the
 * trap `ssplayer-pixi` hit by calling `Assets.unload()` from `destroy()`.
 * Embedded (`--embedded`) and caller-supplied textures never reach the cache;
 * they stay private to their player.
 */
export class SSWebGLTextureCache {
  private entries = new Map<string, SSTextureEntry>();
  // In-flight uploads, so N players asking for the same URL in the same frame
  // produce one fetch and one upload rather than N.
  private pending = new Map<string, Promise<SSTextureEntry>>();

  constructor(private gl: WebGLRenderingContext | WebGL2RenderingContext) {}

  /** Upload `url` once via `upload`, and reuse it for every later request. */
  public acquire(url: string, upload: (url: string) => Promise<SSTextureEntry>): Promise<SSTextureEntry> {
    const hit = this.entries.get(url);
    if (hit) return Promise.resolve(hit);

    const inFlight = this.pending.get(url);
    if (inFlight) return inFlight;

    const task = upload(url).then(
      (entry) => {
        this.entries.set(url, entry);
        this.pending.delete(url);
        return entry;
      },
      (err) => {
        // Keep failures retryable: a transient network error must not poison the
        // URL for the rest of the surface's lifetime.
        this.pending.delete(url);
        throw err;
      },
    );
    this.pending.set(url, task);
    return task;
  }

  /**
   * Forget everything after a context loss. The handles died with the context so
   * there is nothing to delete — players re-acquire during their own restore, and
   * whichever asks first re-uploads on behalf of the rest.
   */
  public invalidate(): void {
    this.entries.clear();
    this.pending.clear();
  }

  /** Delete every cached texture. Only the owning Surface may call this. */
  public destroy(): void {
    for (const { tex } of this.entries.values()) this.gl.deleteTexture(tex);
    this.entries.clear();
    this.pending.clear();
  }
}
