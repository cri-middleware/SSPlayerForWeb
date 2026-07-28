// Filesystem access from inside the TyranoBuilder renderer.
//
// The builder runs with `contextIsolation: true`, so the plugin never gets
// `require()`. What it does get is `window.studio_api`, which the preload
// publishes through `contextBridge` — including `fs-extra`. Functions come
// across as proxies and arguments/return values are structured-cloned.
//
// That clone step is the one thing on this path that is NOT documented and NOT
// guaranteed: a Node `Buffer` (a `Uint8Array` subclass) may arrive as a real
// `Uint8Array`, as a `{type:'Buffer',data:[...]}` husk, or as something else
// entirely, and a `Uint8Array` passed *into* `writeFileSync` may or may not be
// written verbatim. So every binary op here has a base64 fallback: encodings
// are plain strings, which always survive the bridge. `probeBinaryBridge()`
// decides which mode to use once, at startup, by round-tripping a real file.

import type { HostStats, StudioApi } from './builderTypes.js';

/** How binary payloads cross the contextBridge. */
export type BinaryMode = 'buffer' | 'base64';

const B64_CHUNK = 0x8000;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(bin);
}

/**
 * Coerce whatever `readFileSync` handed back into a `Uint8Array`, covering the
 * shapes a structured clone of a `Buffer` can plausibly take. Returns `null`
 * when the value is not byte-like, which is the signal to fall back to base64.
 */
function coerceBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);

  if (value && typeof value === 'object') {
    // `JSON.parse(JSON.stringify(buffer))` shape.
    const data = (value as { data?: unknown }).data;
    if (Array.isArray(data)) return Uint8Array.from(data as number[]);

    // Array-like proxy: indexable with a numeric `length`.
    const len = (value as { length?: unknown }).length;
    if (typeof len === 'number' && len >= 0) {
      const indexed = value as Record<number, unknown>;
      // An empty file is legitimately zero-length; anything longer must expose
      // a numeric first byte or it is not really byte-like.
      if (len === 0) return new Uint8Array(0);
      if (typeof indexed[0] === 'number') {
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) out[i] = Number(indexed[i]) & 0xff;
        return out;
      }
    }
  }
  return null;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Result of the startup round-trip test, surfaced in the import log. */
export interface BridgeProbe {
  mode: BinaryMode;
  readAsBuffer: boolean;
  writeAsBuffer: boolean;
  detail: string;
}

export class HostFs {
  readonly api: StudioApi;
  /** Chosen by `probeBinaryBridge()`; `buffer` until proven otherwise. */
  binaryMode: BinaryMode = 'buffer';

  constructor(api: StudioApi) {
    this.api = api;
  }

  /** Throws unless the builder actually exposed its filesystem bridge. */
  static fromWindow(): HostFs {
    const api = window.studio_api;
    if (!api?.fs || !api.path) {
      throw new Error(
        'window.studio_api is unavailable — this plugin only runs inside the TyranoBuilder editor.',
      );
    }
    return new HostFs(api);
  }

  get path() {
    return this.api.path;
  }

  exists(p: string): boolean {
    return this.api.fs.existsSync(p);
  }

  mkdirp(dir: string): void {
    // Mirrors the builder's own `io.mkdir` (`mkdirp.sync(dir, '0777')`).
    this.api.mkdirp.sync(dir, '0777');
  }

  readText(p: string): string {
    return String(this.api.fs.readFileSync(p, 'utf8'));
  }

  writeText(p: string, text: string): void {
    this.api.fs.writeFileSync(p, text, 'utf8');
  }

  /** Node-side recursive copy — no bytes cross the bridge. */
  copy(src: string, dest: string): void {
    this.api.fs.copySync(src, dest);
  }

  remove(p: string): void {
    try {
      this.api.fs.removeSync(p);
    } catch {
      // Best effort; a leftover temp file is not worth surfacing.
    }
  }

  readBinary(p: string): Uint8Array {
    if (this.binaryMode === 'buffer') {
      const bytes = coerceBytes(this.api.fs.readFileSync(p));
      if (bytes) return bytes;
      // One-way switch: if a read did not survive, writes will not either.
      this.binaryMode = 'base64';
    }
    return base64ToBytes(String(this.api.fs.readFileSync(p, 'base64')));
  }

  writeBinary(p: string, data: Uint8Array): void {
    this.mkdirp(this.path.dirname(p));
    if (this.binaryMode === 'buffer') {
      this.api.fs.writeFileSync(p, data);
      return;
    }
    this.api.fs.writeFileSync(p, bytesToBase64(data), 'base64');
  }

  /**
   * `fs.Stats` normalised to plain data. The bridge may or may not carry the
   * `isDirectory()` method across, so fall back to the POSIX mode bits.
   */
  statOf(p: string): { isDir: boolean; size: number; mtimeMs: number } | null {
    let st: HostStats;
    try {
      st = this.api.fs.statSync(p);
    } catch {
      return null;
    }
    const isDir =
      typeof st.isDirectory === 'function'
        ? st.isDirectory()
        : typeof st.mode === 'number'
          ? (st.mode & 0o170000) === 0o040000
          : false;
    const mtimeMs =
      typeof st.mtimeMs === 'number' ? st.mtimeMs : new Date(st.mtime as string).getTime() || 0;
    return { isDir, size: typeof st.size === 'number' ? st.size : 0, mtimeMs };
  }

  /** Absolute paths of every file under `dir`, recursively. Never throws. */
  walkFiles(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = this.api.fs.readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of entries) {
      if (name === '.DS_Store' || name === 'Thumbs.db') continue;
      const full = this.path.join(dir, name);
      const st = this.statOf(full);
      if (!st) continue;
      if (st.isDir) this.walkFiles(full, out);
      else out.push(full);
    }
    return out;
  }

  /**
   * Decide how binaries cross the bridge, by writing a known byte pattern,
   * reading it back and comparing. Run once at startup, before any conversion:
   * an undetected failure here would silently produce corrupt `.ssab` files.
   */
  probeBinaryBridge(scratchPath: string): BridgeProbe {
    const pattern = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0xff, 0x7f, 0x80, 0x01, 0xfe, 0x00]);

    let writeAsBuffer = false;
    let readAsBuffer = false;
    let detail = '';

    this.mkdirp(this.path.dirname(scratchPath));

    // 1. Write a Uint8Array straight through the bridge.
    try {
      this.api.fs.writeFileSync(scratchPath, pattern);
      const st = this.statOf(scratchPath);
      writeAsBuffer = st?.size === pattern.length;
      if (!writeAsBuffer) detail += `write-as-buffer produced ${st?.size ?? 'no'} bytes; `;
    } catch (e) {
      detail += `write-as-buffer threw (${(e as Error).message}); `;
    }

    // 2. Read it back and see what shape comes over.
    if (writeAsBuffer) {
      try {
        const raw = this.api.fs.readFileSync(scratchPath);
        const bytes = coerceBytes(raw);
        readAsBuffer = !!bytes && bytesEqual(bytes, pattern);
        if (!readAsBuffer) {
          const kind = raw === null || raw === undefined ? String(raw) : typeof raw;
          detail += `read-as-buffer returned ${kind} (${(raw as object)?.constructor?.name ?? '?'}); `;
        }
      } catch (e) {
        detail += `read-as-buffer threw (${(e as Error).message}); `;
      }
    }

    // 3. Prove the base64 fallback before relying on it.
    const bufferOk = writeAsBuffer && readAsBuffer;
    if (!bufferOk) {
      try {
        this.api.fs.writeFileSync(scratchPath, bytesToBase64(pattern), 'base64');
        const back = base64ToBytes(String(this.api.fs.readFileSync(scratchPath, 'base64')));
        if (!bytesEqual(back, pattern)) {
          detail += 'base64 fallback also mismatched; ';
        }
      } catch (e) {
        detail += `base64 fallback threw (${(e as Error).message}); `;
      }
    }

    // Don't leave the probe behind: this folder ships inside an exported game.
    this.remove(scratchPath);

    this.binaryMode = bufferOk ? 'buffer' : 'base64';
    return {
      mode: this.binaryMode,
      readAsBuffer,
      writeAsBuffer,
      detail: detail || 'clean round-trip',
    };
  }

  /**
   * Resolve `target` under `baseDir` and refuse anything that escapes it.
   * Output names come from a (potentially untrusted) `.sspj`, so a crafted
   * project yielding `../…` entries must not write outside the asset folder —
   * same guard as `ssconverter-web`'s CLI.
   */
  resolveWithin(baseDir: string, target: string, label: string): string {
    const base = this.path.resolve(baseDir);
    const resolved = this.path.resolve(base, target);
    if (resolved !== base && !resolved.startsWith(base + this.path.sep)) {
      throw new Error(`${label} escapes the target directory: ${target}`);
    }
    return resolved;
  }
}
