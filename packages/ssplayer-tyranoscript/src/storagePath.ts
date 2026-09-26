/**
 * Resolve a `storage=` value the way TyranoScript resolves every other one.
 *
 * `$.parseStorage(path, folder)` is the engine's own resolver — the same call
 * behind `[image]`, `[bg]` and the rest. Passing `data` as the folder keeps the
 * meaning this adapter has always had (a bare path hangs off `data/`), while
 * handing the engine the parts that are easy to get subtly wrong: `..` and `.`
 * segments, doubled slashes, and http(s) pass-through.
 *
 * The early exits come first because `parseStorage` would rewrite them: it
 * treats its result as project-relative, so a root-absolute or protocol-relative
 * URL must not go through it. Older engines have no `parseStorage`, hence the
 * fallback.
 */
export function resolveDataPath(p: string): string {
  if (/^(https?:)?\/\//.test(p) || p.startsWith('/')) return p;

  const parse = (globalThis as { $?: { parseStorage?: (s: string, folder?: string) => string } }).$
    ?.parseStorage;
  if (typeof parse === 'function') return parse(p, 'data');

  if (p.startsWith('./') || p.startsWith('data/')) return p;
  return `data/${p}`;
}
