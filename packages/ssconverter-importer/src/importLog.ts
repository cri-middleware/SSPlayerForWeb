// A log the user can actually read.
//
// `console.log` is close to invisible to an author: TyranoBuilder's main window
// is created with `removeMenu()` and exposes no DevTools shortcut at all. Every
// line therefore also lands in a plain text file, which the host places where
// its export does not reach.

import type { HostFs } from './hostFs.js';

/** Past this, the log is started over. Roughly a few hundred sessions. */
const MAX_BYTES = 256 * 1024;

export class ImportLog {
  private readonly fs: HostFs | null;
  private readonly path: string | null;
  /** What each console line starts with, e.g. `[ssplayer-tyranobuilder]`. */
  private readonly prefix: string;

  constructor(fs: HostFs | null, path: string | null, prefix: string) {
    this.fs = fs;
    this.path = path;
    this.prefix = prefix;

    // A host may construct its plugin more than once per session — in
    // TyranoBuilder, opening a project, installing a `.tbp`, adding or removing
    // another plugin all call `loadPlugins()` — so rewriting the file per boot
    // would throw away the run that actually did something and leave whichever
    // no-op ran last. Append, and start over only once the file gets
    // unreasonable.
    if (fs && path) {
      try {
        if ((fs.statOf(path)?.size ?? 0) > MAX_BYTES) fs.writeText(path, '');
      } catch {
        // Not being able to trim is not a reason to stop logging.
      }
    }
    this.line('--- session start ---');
  }

  /**
   * Writes through on every line. The interesting events — a background
   * reconversion, minutes after the editor was opened — happen long after any
   * boot-time flush would have run, and this file is the only channel an author
   * can see them on.
   */
  line(message: string): void {
    const text = `${new Date().toISOString()}  ${message}\n`;
    console.log(this.prefix, message);
    if (!this.fs || !this.path) return;
    try {
      this.fs.appendText(this.path, text);
    } catch (e) {
      console.warn(this.prefix, 'could not write the import log:', e);
    }
  }
}
