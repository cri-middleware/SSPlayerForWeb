// A log the user can actually read.
//
// TyranoBuilder's main window is created with `removeMenu()` and exposes no
// DevTools shortcut, so `console.log` is close to invisible to an author. Every
// line therefore also lands in a plain text file at the project root (outside
// `data/`, so it does not end up in an exported game), and the run summary is
// shown with the builder's own alertify dialog.

import type { HostFs } from './hostFs.js';

const PREFIX = '[ssplayer-tyranobuilder]';

export class ImportLog {
  private readonly lines: string[] = [];
  private readonly fs: HostFs | null;
  private readonly path: string | null;

  constructor(fs: HostFs | null, path: string | null) {
    this.fs = fs;
    this.path = path;
  }

  /**
   * Writes through on every line. The interesting events — a background
   * reconversion, minutes after the editor was opened — happen long after any
   * boot-time flush would have run, and the file is the only channel an author
   * can see them on. It is a few KB, so rewriting it per line costs nothing.
   */
  line(message: string): void {
    this.lines.push(`${new Date().toISOString()}  ${message}`);
    console.log(PREFIX, message);
    this.flush();
  }

  /** Rewrites the file with everything logged so far. */
  flush(): void {
    if (!this.fs || !this.path) return;
    try {
      this.fs.writeText(this.path, this.lines.join('\n') + '\n');
    } catch (e) {
      console.warn(PREFIX, 'could not write the import log:', e);
    }
  }
}
