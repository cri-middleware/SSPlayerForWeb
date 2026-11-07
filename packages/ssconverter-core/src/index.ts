import __wbg_init, {
  convert,
  version as wasmVersion,
  ssab_schema_version,
  ssqb_schema_version,
  ConvertResult,
  type InitInput,
  type InitOutput,
} from '../wasm/ssconverter.js';

export { ConvertResult };
export type { InitInput, InitOutput };

/**
 * Initialize the bundled `ssconverter` WebAssembly module. Call once before
 * {@link convertProject}.
 *
 * The host supplies the wasm source: a `URL`/`Response` (browser fetch), a
 * `BufferSource` of the wasm bytes (Node — read the file yourself), or a
 * precompiled `WebAssembly.Module`. This core is environment-agnostic — it
 * touches neither the filesystem nor the DOM.
 */
export function init(source?: InitInput | Promise<InitInput>): Promise<InitOutput> {
  return __wbg_init(source === undefined ? undefined : { module_or_path: source });
}

/** Options for {@link convertProject}. */
export interface ConvertOptions {
  /** Inline each texture's bytes into the `.ssab` (no sibling image files). Default `false`. */
  embedded?: boolean;
  /** Share identical tables within the output, for a smaller file. Default `true`. */
  optimize?: boolean;
}

/**
 * Convert a SpriteStudio project to `.ssab`/`.ssqb`.
 *
 * `files` maps every path in the project directory to its bytes, and must hold
 * exactly one `.sspj`: the converter takes no name, so leave out any other
 * `.sspj` in that directory ({@link locateProject} throws on more than one). Pure — no
 * fs, no DOM. Call {@link init} first.
 */
export function convertProject(
  files: Map<string, Uint8Array>,
  options: ConvertOptions = {},
): ConvertResult {
  const { embedded = false, optimize = true } = options;
  // The converter matches names byte for byte, and a disk can hold in NFD a name
  // the project's own files write in NFC.
  const normalized = new Map<string, Uint8Array>();
  for (const [path, bytes] of files) normalized.set(path.normalize('NFC'), bytes);
  // The two in the middle are the converter's `debug` and `split`, which nothing reads.
  return convert(normalized, embedded, false, false, optimize);
}

/** Converter build version string (`CARGO_PKG_VERSION` + short git sha). */
export function version(): string {
  return wasmVersion();
}

/** `.ssab` schema version emitted by this build (distinct from {@link version}). */
export function ssabSchemaVersion(): number {
  return ssab_schema_version();
}

/** `.ssqb` schema version emitted by this build (distinct from {@link version}). */
export function ssqbSchemaVersion(): number {
  return ssqb_schema_version();
}

/** A located project's `.sspj` and its derived stem/directory. */
export interface ProjectLocation {
  /** The `.sspj` path exactly as it appears in the input paths. */
  sspjPath: string;
  /** Basename of the `.sspj` without its extension (e.g. `"character"`). */
  stem: string;
  /** Directory segments containing the `.sspj` (empty when it sits at the root). */
  dir: string[];
}

/**
 * Find the single `.sspj` among `paths` and derive its stem and directory.
 * Throws when zero or more than one `.sspj` is present (an ambiguous conversion).
 */
export function locateProject(paths: Iterable<string>): ProjectLocation {
  const sspjs: string[] = [];
  for (const p of paths) {
    if (p.toLowerCase().endsWith('.sspj')) sspjs.push(p);
  }
  if (sspjs.length === 0) {
    throw new Error('No .sspj file found in the project.');
  }
  if (sspjs.length > 1) {
    throw new Error(
      `Found ${sspjs.length} .sspj files. Exactly one .sspj is allowed per conversion to prevent ambiguity.`,
    );
  }
  const sspjPath = sspjs[0];
  const parts = sspjPath.split('/');
  const filename = parts[parts.length - 1];
  const stem = filename.slice(0, -'.sspj'.length);
  const dir = parts.slice(0, -1);
  return { sspjPath, stem, dir };
}

/**
 * Rename generated `.ssab` files by appending `suffix` to each basename and
 * drop every non-`.ssab` output. Lets a host emit an embedded variant next to
 * the normal external outputs (e.g. `foo.ssab` + `foo_embedded.ssab`) without
 * name clashes.
 */
export function applySuffix(
  output: Map<string, Uint8Array>,
  suffix: string,
): Map<string, Uint8Array> {
  const renamed = new Map<string, Uint8Array>();
  for (const [filename, data] of output) {
    if (!filename.toLowerCase().endsWith('.ssab')) continue;
    renamed.set(filename.slice(0, -'.ssab'.length) + suffix + '.ssab', data);
  }
  return renamed;
}
