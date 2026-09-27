/**
 * The conversion Worker's own bundle, handed over as a string by the
 * `inline-converter-worker` plugin in `tsdown.config.ts`.
 *
 * It is a string and not a file because a Worker in a `file://` document can
 * only be started from a Blob URL, and because a host's plugin folder may sit
 * where an export copies it wholesale — TyranoBuilder's lives under `data/`.
 */
declare module 'virtual:converter-worker' {
  const source: string;
  export default source;
}
