// A failed asset load that knows which file it was.
//
// The picture bridge reports load failures through MZ's own "Failed to load"
// screen, which names one URL. A pack load touches the .ssab and every texture
// beside it, so the URL has to travel with the error from wherever the fetch
// failed; without it the screen could only name the .ssab, even when the file
// missing is a texture.

export class SSLoadError extends Error {
  constructor(
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'SSLoadError';
  }
}
