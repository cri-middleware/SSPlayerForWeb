// `.sspj` -> `.ssab` inside a host, via `@spritestudio/ssconverter-core`.
//
// The core is environment-agnostic on purpose: it never touches a filesystem or
// the DOM, it takes the wasm bytes and a `Map<path, bytes>` of the project and
// hands back a `Map<name, bytes>`. That is exactly the shape a host needs,
// because the *host* is the only thing that can read files (in TyranoBuilder,
// via `studio_api`), and wasm cannot `fetch()` a `file://` URL anyway.
//
// It is also what lets the wasm run in a Worker. The call is synchronous and
// long enough to be seen — on the machine this was measured on, a TyranoBuilder
// project open with 20 sample projects froze the editor for 1.2 s, 680 ms of it
// in one project — so it runs off the UI thread, and this file keeps only the
// halves a Worker cannot do: reading the sources and writing the results, both
// of which need the host's filesystem, which only its UI thread holds.
//
// The Worker is not assumed to exist. It is started from a Blob URL — a
// `file://` document cannot load a worker script from another `file://` URL,
// and no vendor documents what a given host build allows — so it is proven
// at startup and falls back to converting in-thread, which is exactly what
// `probeBinaryBridge()` does for the binary bridge. The fallback is the old
// behaviour, not a degraded one: the host freezes, as it always did.

import {
  convertProject,
  init,
  ssabSchemaVersion,
  ssqbSchemaVersion,
  version as converterVersion,
} from '@spritestudio/ssconverter-core';

import {
  CONVERT_OPTIONS,
  type FromWorker,
  type SchemaVersions,
  type ToWorker,
} from './converterProtocol.js';
import type { HostFs } from './hostFs.js';

/** One conversion's results, as they leave the converter. */
export interface Conversion {
  /** Generated file name -> contents. */
  output: Map<string, Uint8Array>;
  /** Referenced textures: destination path -> path within the source project. */
  assets: Map<string, string>;
}

export interface Converter {
  /** Converter build version; what a pack's import record is stamped with. */
  readonly version: string;
  /** The formats this build emits, for the version line in the panel. */
  readonly schema: SchemaVersions;
  /** Whether conversions block the host. Logged once, at startup. */
  readonly mode: 'worker' | 'inline';
  /** Why the Worker was not used; empty when it was. */
  readonly detail: string;
  convert(files: Map<string, Uint8Array>): Promise<Conversion>;
  dispose(): void;
}

export interface ConverterOptions {
  /** Absolute path of `ssconverter_bg.wasm`. */
  wasmPath: string;
  /**
   * The Worker's own bundle, as source (`./worker-source`), inlined into the
   * host's plugin at build time because a Blob URL is the only way to start a
   * Worker from a `file://` document. Omitted — as it is in the tests —
   * conversion runs on the calling thread.
   */
  workerSource?: string;
}

/**
 * How long to wait for a Worker to report itself ready before giving up on it.
 *
 * A Worker that cannot load normally fires `onerror`, which is faster than any
 * timeout; this is the backstop for the case that stays silent. Generous,
 * because it is paid once per session and only ever by a host that was going
 * to fall back anyway — instantiating the wasm on a slow machine must not
 * be mistaken for a Worker that never started.
 */
const WORKER_START_TIMEOUT_MS = 20_000;

/**
 * Instantiate the converter wasm on this thread. Once per session, because a
 * host may convert repeatedly.
 */
let inlineInit: Promise<{ version: string; schema: SchemaVersions }> | null = null;

function startInline(fs: HostFs, wasmPath: string, detail: string): Promise<Converter> {
  inlineInit ??= (async () => {
    if (!fs.exists(wasmPath)) {
      throw new Error(`converter wasm not found: ${wasmPath}`);
    }
    // `init` takes a BufferSource — the host reads the bytes itself, so the
    // usual `fetch(import.meta.url)` path (blocked for file://) is not used.
    await init(fs.readBinary(wasmPath));
    return {
      version: converterVersion(),
      schema: { ssab: ssabSchemaVersion(), ssqb: ssqbSchemaVersion() },
    };
  })();

  return inlineInit.then(({ version, schema }) => ({
    version,
    schema,
    mode: 'inline' as const,
    detail,
    convert(files: Map<string, Uint8Array>): Promise<Conversion> {
      const result = convertProject(files, CONVERT_OPTIONS);
      try {
        return Promise.resolve({
          output: result.output as Map<string, Uint8Array>,
          assets: result.assets as unknown as Map<string, string>,
        });
      } finally {
        // Release the wasm-side result now rather than waiting for the
        // FinalizationRegistry — a host may convert repeatedly and stay alive
        // for as long as its editor is open. The byte arrays above are
        // copies out of the wasm heap, so they outlive it.
        result.free();
      }
    },
    dispose() {},
  }));
}

/**
 * Start the Worker and wait for it to say the wasm is up. Rejects for every
 * reason a Worker can fail to be one, which is the signal to fall back.
 */
async function startWorker(
  fs: HostFs,
  wasmPath: string,
  source: string,
  /** Called if the Worker dies after it was working, so it can be replaced. */
  onDeath: () => void,
): Promise<Converter> {
  if (typeof Worker !== 'function' || typeof Blob !== 'function') {
    throw new Error('no Worker in this runtime');
  }
  if (!fs.exists(wasmPath)) {
    throw new Error(`converter wasm not found: ${wasmPath}`);
  }

  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }

  const pending = new Map<
    number,
    { resolve: (value: Conversion) => void; reject: (error: Error) => void }
  >();
  let nextId = 1;
  let onReady: (ready: { version: string; schema: SchemaVersions }) => void = () => {};
  let onFailed: (error: Error) => void = () => {};
  const ready = new Promise<{ version: string; schema: SchemaVersions }>((resolve, reject) => {
    onReady = resolve;
    onFailed = reject;
  });

  worker.onmessage = (event: MessageEvent<FromWorker>) => {
    const reply = event.data;
    switch (reply.kind) {
      case 'ready':
        onReady({ version: reply.version, schema: reply.schema });
        return;
      case 'unavailable':
        onFailed(new Error(reply.message));
        return;
      case 'converted':
        pending.get(reply.id)?.resolve({ output: reply.output, assets: reply.assets });
        pending.delete(reply.id);
        return;
      case 'failed':
        pending.get(reply.id)?.reject(new Error(reply.message));
        pending.delete(reply.id);
        return;
    }
  };

  // Covers the script failing to load at all, and anything the Worker throws
  // outside a request. Without this a rejected conversion would simply never
  // settle, and the import pass behind it would wait forever.
  let started = false;
  let dead: Error | null = null;
  worker.onerror = (event: ErrorEvent) => {
    dead = new Error(event.message || 'the conversion worker stopped');
    onFailed(dead);
    for (const request of pending.values()) request.reject(dead);
    pending.clear();
    // Before it was ready this is just a failed start, and the caller is
    // already falling back. After that it has to be replaced, or every later
    // conversion would post into nothing.
    if (started) onDeath();
  };

  const timer = setTimeout(
    () => onFailed(new Error(`worker did not start within ${WORKER_START_TIMEOUT_MS} ms`)),
    WORKER_START_TIMEOUT_MS,
  );
  worker.postMessage({ kind: 'init', wasm: fs.readBinary(wasmPath) } satisfies ToWorker);

  let handshake: { version: string; schema: SchemaVersions };
  try {
    handshake = await ready;
  } catch (e) {
    worker.terminate();
    URL.revokeObjectURL(url);
    throw e;
  } finally {
    clearTimeout(timer);
  }
  // Held until now: revoking straight after `new Worker()` can outrun the
  // fetch of the script it was given.
  URL.revokeObjectURL(url);
  started = true;

  return {
    version: handshake.version,
    schema: handshake.schema,
    mode: 'worker',
    detail: '',
    convert(files: Map<string, Uint8Array>): Promise<Conversion> {
      // A dead Worker takes messages and never answers, so say so instead:
      // the pass reports a failed project, rather than waiting forever.
      if (dead) return Promise.reject(dead);
      const id = nextId++;
      return new Promise<Conversion>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ kind: 'convert', id, files } satisfies ToWorker);
      });
    },
    dispose() {
      worker.terminate();
    },
  };
}

/**
 * One converter per host session, not per importer: TyranoBuilder's
 * `loadPlugins()` rebuilds every plugin whenever any one of them is added,
 * removed or installed, and a Worker started in each of those constructors
 * would leak one wasm instance per rebuild. Keyed by the wasm it was built
 * from, so opening a different project — which moves it — replaces the Worker
 * rather than reusing one holding the previous project's converter.
 */
let current: { key: string; converter: Promise<Converter> } | null = null;

export function ensureConverter(fs: HostFs, opts: ConverterOptions): Promise<Converter> {
  const key = opts.wasmPath;
  if (current?.key === key) return current.converter;

  current?.converter.then(
    (previous) => previous.dispose(),
    () => {},
  );

  const source = opts.workerSource;
  const converter = (async () => {
    if (!source) {
      return startInline(fs, opts.wasmPath, 'no worker bundle supplied');
    }
    try {
      return await startWorker(fs, opts.wasmPath, source, () => {
        // Drop it from the cache so the next pass starts a fresh Worker, or
        // falls back. A dead one would otherwise be handed out all session.
        if (current?.key === key) current = null;
      });
    } catch (e) {
      return startInline(fs, opts.wasmPath, (e as Error).message);
    }
  })();

  current = { key, converter };
  return converter;
}

export interface ConvertStats {
  /** Files read out of the source project directory. */
  inputFiles: number;
  /** Files written into the output directory. */
  outputFiles: number;
  /** Referenced textures copied alongside the `.ssab`. */
  copiedAssets: number;
  /** Names of the generated `.ssab` files. */
  ssab: string[];
  /**
   * Everything this conversion wrote, relative to `outDir` and with `/`
   * separators — the generated files and the textures copied beside them.
   *
   * Recorded in the import state so the next conversion of the same folder can
   * remove what it no longer produces. It is the list of files this importer
   * put there, and nothing else is ever a candidate for removal.
   */
  written: string[];
  elapsedMs: number;
}

/**
 * Convert one `.sspj` into `outDir`.
 *
 * Mirrors `packages/ssconverter-web/scripts/cli.js`: keys in the input map are
 * paths relative to the `.sspj`'s own directory, and non-embedded output ships
 * the textures as sibling files (`result.assets` maps destination -> source).
 *
 * The middle of this — the wasm — is where the time goes and is the part that
 * runs elsewhere. The reads and writes around it go through the host's
 * filesystem, so they stay on the UI thread whatever `converter.mode` says.
 */
export async function convertProjectAt(
  fs: HostFs,
  converter: Converter,
  sspjPath: string,
  outDir: string,
  now: () => number,
): Promise<ConvertStats> {
  const started = now();
  const sourceDir = fs.path.dirname(sspjPath);

  // The converter is told which project to convert only by being handed
  // exactly one `.sspj`, so any other under this folder — a backup beside it,
  // a project in a subfolder — stays out of the map.
  const sspjName = fs.path.basename(sspjPath);
  const files = new Map<string, Uint8Array>();
  for (const full of fs.walkFiles(sourceDir)) {
    const rel = fs.path.relative(sourceDir, full).replace(/\\/g, '/');
    if (rel !== sspjName && rel.toLowerCase().endsWith('.sspj')) continue;
    files.set(rel, fs.readBinary(full));
  }
  if (files.size === 0) {
    throw new Error(`no readable files under ${sourceDir}`);
  }

  const { output, assets } = await converter.convert(files);

  const stats: ConvertStats = {
    inputFiles: files.size,
    outputFiles: 0,
    copiedAssets: 0,
    ssab: [],
    written: [],
    elapsedMs: 0,
  };

  fs.mkdirp(outDir);

  for (const [name, data] of output) {
    const dest = fs.resolveWithin(outDir, name, 'output path');
    fs.writeBinary(dest, data);
    stats.outputFiles++;
    stats.written.push(name.replace(/\\/g, '/'));
    if (name.toLowerCase().endsWith('.ssab')) stats.ssab.push(name);
  }

  // Textures: a Node-side `copySync`, so these bytes never cross the bridge.
  for (const [destPath, srcPath] of assets) {
    const src = fs.resolveWithin(sourceDir, srcPath, 'asset source path');
    const dest = fs.resolveWithin(outDir, destPath, 'asset output path');
    if (!fs.exists(src)) continue;
    fs.mkdirp(fs.path.dirname(dest));
    fs.copy(src, dest);
    stats.written.push(destPath.replace(/\\/g, '/'));
    stats.copiedAssets++;
  }

  stats.elapsedMs = Math.round(now() - started);
  return stats;
}
