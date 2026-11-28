#!/usr/bin/env node
// Copy the documentation into a public package, so what a user's tooling reads in
// node_modules is the documentation of the version installed -- not the site's,
// which is built from the latest release and can be ahead. English only, as the
// Markdown source, with the layout kept.
//
//   node ../../scripts/copy-docs.mjs <dest> <skill>      (from a package: its `build` script)
//
// <dest> is replaced, and gets scripts/release-docs/npm-README.md as its
// README.md: the folder's front door, standing in for the site's home page.
//
// <skill> is replaced by the same pages as an Agent Skill, named after the
// folder: the front door is its SKILL.md, under the frontmatter that names it.
// pnpm links skills/<name>/ of a direct dependency into the project's agent
// skill directories, and the npm skills CLI does the same, so a link that
// leaves the folder resolves against the agent's directory instead -- the pages
// are copied rather than pointed at.
//
// The pages link each other by relative `.md` path, and the layout is kept, so
// those resolve here as they do in the repository. Only a link to a page left
// out is rewritten as it is copied: the home page becomes the front door, and
// anything else -- a page under ja/ or development/, a section of the home
// page, which the front door stands in for without having its sections --
// becomes its URL on the site. The TypeDoc API pages, the demos and the
// converter are already linked by their URL on the site.
//
// Left out of docs/: index.md (the home page), ja/ (the site has it), api/
// (TypeDoc's output from the same comments dist/index.d.ts carries),
// development/ (working on this repository, not using the package), and
// everything that is not a page. Everything else is taken by rule, not by list,
// so a page added to docs/ ships without anyone remembering to add it here.

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://cri-middleware.github.io/SSPlayerForWeb/';
const SKILL_DESCRIPTION =
  'Documentation of SpriteStudio Player for Web, for the version installed. Use when writing, ' +
  'reviewing or debugging code that plays SpriteStudio animations (.ssab, converted from .sspj) ' +
  'in a browser with @spritestudio/ssplayer-webgl, @spritestudio/ssplayer-pixi, ' +
  '@spritestudio/ssplayer-pixi-ui or @spritestudio/ssplayer-core, or that converts .sspj with ' +
  '@spritestudio/ssconverter-core.';

const [dest, skill, ...rest] = process.argv.slice(2);
if (!dest || !skill || rest.length > 0) {
  console.error('usage: node scripts/copy-docs.mjs <dest> <skill>');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'docs');

const SKIP_DIRS = new Set(['ja', 'api', 'development', 'node_modules', 'public', '.vitepress']);
const pages = readdirSync(src, { recursive: true })
  .map((rel) => rel.split(sep).join('/'))
  .filter((rel) => rel.endsWith('.md') && rel !== 'index.md' && !SKIP_DIRS.has(rel.split('/')[0]))
  .sort();
const have = new Set(pages);

// A relative link to a page (`../usage/assets.md#anchor`) as seen from <page>,
// in a folder whose front door is <front>.
function rewritePageLink(target, page, front) {
  const [path, anchor] = target.split(/(?=#)/);
  const hash = anchor ?? '';
  const file = posix.join(posix.dirname(page), path);
  if (have.has(file)) return target;
  if (file === 'index.md') return hash ? SITE + hash : posix.relative(posix.dirname(page), front);
  return SITE + file.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '') + hash;
}

function rewrite(text, page, front) {
  return text.replace(
    /\]\(([^)\s:#]*\.md(?:#[^)\s]*)?)\)/g,
    (_, target) => `](${rewritePageLink(target, page, front)})`,
  );
}

function copyPages(out, front, frontText) {
  rmSync(out, { recursive: true, force: true });
  for (const page of pages) {
    const to = join(out, page);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, rewrite(readFileSync(join(src, page), 'utf8'), page, front));
  }
  writeFileSync(join(out, front), frontText);
  console.log(`copy-docs: ${pages.length} pages + ${front} -> ${relative(process.cwd(), out) || '.'}`);
}

const frontDoor = readFileSync(join(root, 'scripts', 'release-docs', 'npm-README.md'), 'utf8');
const skillName = basename(resolve(skill));
copyPages(resolve(dest), 'README.md', frontDoor);
copyPages(
  resolve(skill),
  'SKILL.md',
  `---\nname: ${skillName}\ndescription: ${JSON.stringify(SKILL_DESCRIPTION)}\n---\n\n${frontDoor}`,
);
