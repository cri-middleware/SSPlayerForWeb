// The auto-importer the in-repo hosts share: find the SpriteStudio projects in
// a source folder, convert the ones that changed, and keep a record of what
// each conversion wrote. Hosts supply the filesystem (`HostBackend`) and decide
// where the sources, the output and the record live.

export {
  AutoImporter,
  DEFAULT_SOURCE_DIR,
  DEFAULT_STATE_FILE,
  type AutoImporterOptions,
  type ImportProgress,
  type ImportRunResult,
  type ImportState,
  type PackState,
  type PassOptions,
  type PlannedJob,
} from './autoImporter.js';
export type { Conversion, ConvertStats, Converter } from './converter.js';
export type { SchemaVersions } from './converterProtocol.js';
export { HostFs, type BinaryMode, type BridgeProbe, type WalkedFile } from './hostFs.js';
export type {
  HostBackend,
  HostFsModule,
  HostPath,
  HostShell,
  HostStats,
} from './hostTypes.js';
export { ImportLog } from './importLog.js';
