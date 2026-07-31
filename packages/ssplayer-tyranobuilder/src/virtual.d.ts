/**
 * The conversion Worker's own bundle, handed over as a string by the
 * `inline-converter-worker` plugin in `tsdown.config.ts`.
 *
 * It is a string and not a file because a Worker in a `file://` document can
 * only be started from a Blob URL, and because the plugin folder lives under
 * `data/`, which a TyranoBuilder export copies wholesale into the shipped game.
 */
declare module 'virtual:converter-worker' {
  const source: string;
  export default source;
}
