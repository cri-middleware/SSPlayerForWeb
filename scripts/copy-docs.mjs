#!/usr/bin/env node
// Copy the documentation into a public package, so what a user's tooling reads in
// node_modules is the documentation of the version installed -- not the site's,
// which is built from the latest release and can be ahead. English only, as the
// Markdown source, with the layout kept.
//
//   node ../../scripts/copy-docs.mjs <dest>      (from a package: its `build` script)
//
// <dest> is replaced, and gets scripts/release-docs/npm-README.md as its
// README.md: the folder's front door, standing in for the site's home page.
//
// The pages are VitePress's, which links between them by site path
// (`/usage/assets`). Those are rewritten as they are copied, so they resolve
// as files: a page this folder has becomes a relative `.md` link, `/` becomes
// the front door, and anything else -- the TypeDoc API pages, the demos, the
// converter -- becomes its URL on the site, as does an HTML `href`.
//
// Left out of docs/: index.md (the home page), ja/ (the site has it), api/
// (TypeDoc's output from the same comments dist/index.d.ts carries), and
// everything that is not a page. Everything else is taken by rule, not by list,
// so a page added to docs/ ships without anyone remembering to add it here.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://cri-middleware.github.io/SSPlayerForWeb/';

const [dest, ...rest] = process.argv.slice(2);
if (!dest || rest.length > 0) {
  console.error('usage: node scripts/copy-docs.mjs <dest>');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs');
const out = resolve(dest);

const SKIP_DIRS = new Set(['ja', 'api', 'node_modules', 'public', '.vitepress']);
const pages = readdirSync(src, { recursive: true })
  .map((rel) => rel.split(sep).join('/'))
  .filter((rel) => rel.endsWith('.md') && rel !== 'index.md' && !SKIP_DIRS.has(rel.split('/')[0]))
  .sort();
const have = new Set(pages);

// A site path (`/usage/assets#anchor`) as seen from <page>.
function rewriteSitePath(target, page) {
  const [path, anchor] = target.split(/(?=#)/);
  const hash = anchor ?? '';
  if (path === '/') return posix.relative(posix.dirname(page), 'README.md') + hash;
  const bare = path.slice(1).replace(/\.md$/, '').replace(/\/$/, '');
  for (const file of [`${bare}.md`, `${bare}/index.md`]) {
    if (have.has(file)) return posix.relative(posix.dirname(page), file) + hash;
  }
  return SITE + path.slice(1).replace(/\.md$/, '') + hash;
}

function rewrite(text, page) {
  // The URL the site serves this page at (cleanUrls), for HTML's relative hrefs.
  const pageUrl = SITE + page.replace(/\.md$/, '');
  return text
    .replace(/\]\((\/[^)\s]*)\)/g, (_, target) => `](${rewriteSitePath(target, page)})`)
    .replace(/href="([^"#:]*)"/g, (whole, target) => {
      if (target === '') return whole;
      return `href="${target.startsWith('/') ? SITE + target.slice(1) : new URL(target, pageUrl).href}"`;
    });
}

rmSync(out, { recursive: true, force: true });
for (const page of pages) {
  const to = join(out, page);
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, rewrite(readFileSync(join(src, page), 'utf8'), page));
}
writeFileSync(join(out, 'README.md'), readFileSync(join(root, 'scripts', 'release-docs', 'npm-README.md'), 'utf8'));

console.log(`copy-docs: ${pages.length} pages + README.md -> ${relative(process.cwd(), out) || '.'}`);
