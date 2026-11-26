import type { DefaultTheme } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForWeb'

// Canonical production origin, used only for `og:url`. Deliberately not derived from
// `base` below: that is '/' during local dev, and a card must always advertise the
// published address rather than wherever the page happened to be built.
const SITE_URL = 'https://cri-middleware.github.io/SSPlayerForWeb'

// The nav's Demo menu points at ssconverter-web and the examples, which are built
// *beside* this site rather than by VitePress (pages.yml -> scripts/build-pages.sh
// assembles them around it), so they are not pages of this site. Two consequences,
// both handled here:
//   - the link stays base-relative and is left to VitePress's withBase(), so it is
//     correct on every deployment of the site (the project Pages site, a fork, a
//     root-served `base=/` preview) instead of hardcoding one origin;
//   - `target: '_blank'` is what stops the SPA router from intercepting the click
//     and landing on the 404 page -- the same reason index.md links them with raw
//     <a target="_blank"> tags.
// They therefore 404 under a docs-only `vitepress dev`: the targets exist only in a
// full `scripts/build-pages.sh` build.
const demo = (text: string, link: string) => ({ text, link, target: '_blank', rel: 'noreferrer' })

// The sidebar is ordered as a difficulty gradient — reader personas are the
// design driver but are intentionally NOT surfaced as section labels. Reading
// top-to-bottom, the effort required rises naturally:
//   1. Getting started / Usage / API  … copy-paste and it runs
//   2. Customize            … a little effort to polish expression
//   3. For Player & SDK Developers … understand the whole, then touch core / WASM
const DEVELOPERS = 'For Player & SDK Developers'
const enSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Getting started',
    items: [
      { text: 'Installation', link: '/setup/install' },
      { text: 'Quick Start', link: '/setup/quickstart' },
    ],
  },
  {
    text: 'Usage',
    items: [
      { text: 'Basic playback', link: '/usage/basic' },
      { text: 'Preparing assets (.sspj → .ssab)', link: '/usage/assets' },
      { text: 'WebGL & Web Components', link: '/usage/webgl' },
      { text: 'HTML5 ads (Google Ads)', link: '/usage/html5-ads' },
      { text: 'PixiJS', link: '/usage/pixi' },
      { text: 'UI buttons (PixiJS)', link: '/usage/pixi-ui' },
      { text: 'RPG Maker MZ', link: '/usage/rmmz', items: [{ text: 'Plugin commands', link: '/usage/rmmz-commands' }] },
      { text: 'TyranoScript', link: '/usage/tyrano', items: [{ text: 'Tags', link: '/usage/tyrano-tags' }] },
      { text: 'TyranoBuilder', link: '/usage/tyranobuilder', items: [{ text: 'Components', link: '/usage/tyranobuilder-components' }] },
      { text: 'Migrating from SS6Player', link: '/migration_from_ss6' },
    ],
  },
  {
    text: 'API Reference',
    items: [
      { text: 'Where to start', link: '/api-guide' },
      { text: 'Generated reference', link: '/api/' },
    ],
  },
  {
    text: 'Customize',
    items: [
      { text: 'Events & user data', link: '/customize/events' },
      { text: 'Part control (visibility / cell / color)', link: '/customize/part-overrides' },
      { text: 'Runtime texture replacement (costume changes)', link: '/customize/texture-replacement' },
      { text: 'Part tracking (following a part)', link: '/customize/part-following' },
      { text: 'Motion blending (tracks and crossfade)', link: '/customize/motion-blending' },
      { text: 'Shaders & blend modes', link: '/customize/shaders' },
      { text: 'Resources & lifecycle', link: '/customize/resources' },
      { text: 'Performance tuning', link: '/customize/performance' },
    ],
  },
  {
    text: 'Limitations & Scope',
    items: [
      { text: 'Limitations & Scope', link: '/limitations' },
    ],
  },
  {
    text: DEVELOPERS,
    items: [
      { text: 'Build Guide', link: '/development/build' },
      { text: 'How the Player Is Put Together', link: '/development/architecture' },
      { text: 'Contributing', link: `${GITHUB}/blob/main/CONTRIBUTING.md` },
    ],
  },
]

// What llms.txt lists: two sections by audience, since a file an assistant reads has no
// difficulty gradient to follow. The first holds every other section's pages in sidebar
// order, the second is the developer section as it stands. Derived from `enSidebar`, so a
// page added there is listed here without a second edit.
const llmsSidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Using the Player',
    items: enSidebar.filter(({ text }) => text !== DEVELOPERS).flatMap(({ items }) => items ?? []),
  },
  ...enSidebar.filter(({ text }) => text === DEVELOPERS),
]

// English is the default (root) locale; Japanese lives under /ja/. The API
// reference (docs/api/, TypeDoc-generated) is language-neutral and shared by both
// locales at /api/.
//
// **Every linked Japanese heading carries an explicit ASCII id**, the same one its
// English page uses -- `## 3. プラグインコマンド {#_3-plugin-commands}`. VitePress
// slugifies through NFKD, which *decomposes* voiced kana, so the id it emits for
// `3. プラグインコマンド` holds ト+U+3099. Links inside the site go through the same
// slugify and land, but one written from outside it -- the portal, another
// repository's README -- carries the composed form and never matches. The dead-link
// check does not look at anchors, so nothing catches it.
export default withMermaid({
  title: 'SpriteStudio Player for Web',
  description: 'A player for SpriteStudio animations in the browser (WebAssembly + PixiJS / WebGL)',
  lastUpdated: true,
  cleanUrls: true,
  lang: 'en',

  // A GitHub Pages project site is served under a subpath (e.g. /SSPlayerForWeb/).
  // CI passes DOCS_BASE to match; local dev/build stays at '/'. Env-driven because
  // VitePress build has no --base CLI flag.
  base: process.env.DOCS_BASE || '/',

  // mermaid 12 defaults to the ELK layout and the redux-color theme, which draw a flowchart as a
  // thin strip with text too small to read, and wraps labels at 120px. In dark mode the plugin
  // swaps the theme for `dark` itself, so `default` here is the light one only.
  mermaid: { layout: 'dagre', theme: 'default', flowchart: { wrappingWidth: 200 } },

  // VitePress puts no `base` in front of a `head` href, so the icon's spells it out.
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${process.env.DOCS_BASE || '/'}favicon.svg` }]],

  // `llms.txt` and `llms-full.txt` for readers who hand the docs to an AI assistant, plus a
  // Markdown copy of every page beside its HTML. The two aggregates leave out the Japanese
  // pages (the plugin writes one pair for the whole site) and the TypeDoc symbol pages, which
  // are hundreds of files. Both keep their own `.md`, so the discovery link in every page
  // resolves. `ja.md` is what the plugin calls the Japanese home page, which `ja/**` misses.
  // `llms.txt` lists the pages under one heading per audience, each entry with its page's
  // frontmatter `description`. The plugin reads only a top-level `themeConfig.sidebar`, and
  // this site's sidebars are per locale, so `sidebar` below hands it `llmsSidebar`; without
  // that the list is flat and sorted by title. A page the sidebar does not list falls under
  // Other, and `llms-full.txt` follows the same order.
  vite: {
    // mermaid imports CommonJS packages (elkjs's browser build among them), and nothing
    // pre-bundles it: the plugin imports it from inside node_modules, where Vite's scan does not
    // look. Left out, `vitepress dev` hands the browser the raw CJS file, the import finds no
    // default export, and every diagram renders as "Syntax error in text". `vitepress build` is
    // unaffected. Name mermaid, not its dependencies: pnpm does not hoist them, so they do not
    // resolve from docs/.
    optimizeDeps: { include: ['mermaid'] },
    plugins: [
      llmstxt({
        domain: new URL(SITE_URL).origin,
        sidebar: llmsSidebar,
        ignoreFilesPerOutput: {
          llmsTxt: ['ja.md', 'ja/**', 'api/@spritestudio/*/*/**'],
          llmsFullTxt: ['ja.md', 'ja/**', 'api/@spritestudio/*/*/**'],
        },
        customTemplateVariables: {
          title: 'SpriteStudio Player for Web',
          description: 'A player for SpriteStudio animations in the browser (WebAssembly + PixiJS / WebGL)',
          details: [
            'Browser players for SpriteStudio over one WebAssembly core: `@spritestudio/ssplayer-core`, with',
            'renderers for WebGL and Web Components (`ssplayer-webgl`) and PixiJS (`ssplayer-pixi`), and',
            'integrations for RPG Maker MZ, TyranoScript and TyranoBuilder. The generated reference keeps',
            'one index page per package in this file; each class, interface, function and type has its own',
            'page at `api/@spritestudio/<package>/<kind>/<Name>.md`, where `<kind>` is `classes`,',
            '`interfaces`, `functions`, `type-aliases`, `enumerations` or `namespaces`. This file is the',
            'English pages only; each Japanese page is the same path under `ja/` with `.md` appended.',
          ].join(' '),
        },
      }),
    ],
  },

  // The Copy as Markdown button, inserted after each page's first heading. The component
  // itself is registered in theme/index.ts.
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons)
    },
  },

  // Open Graph / Twitter Card metadata. VitePress emits none of it on its own, so a link
  // shared into Slack, X, or Discord previews as a bare URL. Built per page from the title
  // and description VitePress has already resolved (frontmatter > locale > site), which is
  // also how the ja pages get Japanese cards without a second code path.
  //
  // No og:image: the only SpriteStudio artwork in this repository is the SVG favicon, link
  // previews do not show SVG, and `summary_large_image` without an image renders as nothing.
  transformHead({ pageData, siteData, title, description }) {
    const path = pageData.relativePath
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '')
    return [
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: siteData.title }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: `${SITE_URL}/${path}` }],
      ['meta', { property: 'og:locale', content: pageData.relativePath.startsWith('ja/') ? 'ja_JP' : 'en_US' }],
      ['meta', { name: 'twitter:card', content: 'summary' }],
      ['meta', { name: 'twitter:site', content: '@spritestudio' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
    ]
  },

  // Shared across locales.
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        // The API reference goes into the index by page title alone. TypeDoc
        // writes a heading per member, and ssplayer-webgl and ssplayer-pixi
        // re-export the core, so indexed whole it outweighs every other page
        // thirty times over -- an index of megabytes that the search box
        // downloads the first time it opens. The title still finds a class or
        // function by name. Replacing _render drops VitePress's own handling
        // of `search: false` frontmatter, so that is kept here.
        async _render(src, env, md) {
          if (env.relativePath.startsWith('api/')) {
            const title = /^# (.+)$/m.exec(src)
            return title ? await md.renderAsync(`# ${title[1]}`) : ''
          }
          const html = await md.renderAsync(src, env)
          return env.frontmatter?.search === false ? '' : html
        },
      },
    },
    socialLinks: [
      { icon: 'github', link: GITHUB },
      { icon: 'x', link: 'https://x.com/spritestudio' },
    ],
  },

  locales: {
    // English — default locale, served at the root path.
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        outline: { level: [2, 3], label: 'On this page' },
        nav: [
          { text: 'Getting started', link: '/setup/install' },
          { text: 'Usage', link: '/usage/basic' },
          { text: 'Customize', link: '/customize/events' },
          { text: 'API', link: '/api-guide' },
          {
            text: 'Demo',
            items: [
              demo('ssconverter-web (.sspj → .ssab)', '/ssconverter/'),
              {
                text: 'Examples',
                items: [
                  demo('WebGL (ss-player)', '/examples/webgl/'),
                  demo('PixiJS', '/examples/pixi/'),
                  demo('Part override', '/examples/override/'),
                  demo('RPG Maker MZ', '/examples/rmmz/'),
                  demo('TyranoScript', '/examples/tyranoscript/'),
                ],
              },
            ],
          },
          // The way back to the portal for a reader who arrives from a search.
          { text: 'SpriteStudio Docs', link: 'https://cri-middleware.github.io/SpriteStudio-Docs/' },
        ],
        sidebar: enSidebar,
      },
    },

    // Japanese — served under /ja/.
    ja: {
      label: '日本語',
      lang: 'ja',
      link: '/ja/',
      // Feeds <meta name="description"> and the Open Graph tags on every ja page; without
      // it they inherit the top-level English description.
      description: 'SpriteStudio のアニメーションをブラウザーで再生するプレイヤー（WebAssembly + PixiJS / WebGL）',
      themeConfig: {
        outline: { level: [2, 3], label: '目次' },
        llms: {
          copyText: 'ページをコピー',
          copiedText: 'コピーしました',
          viewMarkdownText: 'Markdown で表示',
          openInAIText: '{provider} で開く',
        },
        nav: [
          { text: 'はじめに', link: '/ja/setup/install' },
          { text: '使い方', link: '/ja/usage/basic' },
          { text: 'カスタマイズ', link: '/ja/customize/events' },
          { text: 'API', link: '/ja/api-guide' },
          // The demos themselves are language-neutral (one build, linked from both
          // locales); only the labels differ.
          {
            text: 'デモ',
            items: [
              demo('ssconverter-web（.sspj → .ssab）', '/ssconverter/'),
              {
                text: 'サンプル',
                items: [
                  demo('WebGL（ss-player）', '/examples/webgl/'),
                  demo('PixiJS', '/examples/pixi/'),
                  demo('パーツ上書き', '/examples/override/'),
                  demo('RPG ツクール MZ', '/examples/rmmz/'),
                  demo('TyranoScript', '/examples/tyranoscript/'),
                ],
              },
            ],
          },
          // The way back to the portal; it must point at the Japanese locale (/ja/).
          { text: 'SpriteStudio Docs', link: 'https://cri-middleware.github.io/SpriteStudio-Docs/ja/' },
        ],
        sidebar: [
          {
            text: 'はじめに',
            items: [
              { text: 'インストール', link: '/ja/setup/install' },
              { text: 'クイックスタート', link: '/ja/setup/quickstart' },
            ],
          },
          {
            text: '使い方',
            items: [
              { text: '基本的な再生', link: '/ja/usage/basic' },
              { text: 'アセットの準備（.sspj → .ssab）', link: '/ja/usage/assets' },
              { text: 'WebGL・Web Components で使う', link: '/ja/usage/webgl' },
              { text: 'HTML5 広告（Google 広告）で使う', link: '/ja/usage/html5-ads' },
              { text: 'PixiJS で使う', link: '/ja/usage/pixi' },
              { text: 'UI ボタン（PixiJS）', link: '/ja/usage/pixi-ui' },
              { text: 'RPG ツクール MZ で使う', link: '/ja/usage/rmmz', items: [{ text: 'プラグインコマンド', link: '/ja/usage/rmmz-commands' }] },
              { text: 'TyranoScript で使う', link: '/ja/usage/tyrano', items: [{ text: 'タグ', link: '/ja/usage/tyrano-tags' }] },
              { text: 'ティラノビルダーで使う', link: '/ja/usage/tyranobuilder', items: [{ text: 'コンポーネント', link: '/ja/usage/tyranobuilder-components' }] },
              { text: 'SS6Player からの移行', link: '/ja/migration_from_ss6' },
            ],
          },
          {
            text: 'API リファレンス',
            items: [
              { text: 'どこから見るか', link: '/ja/api-guide' },
              { text: '生成リファレンス', link: '/api/' },
            ],
          },
          {
            text: 'カスタマイズ',
            items: [
              { text: 'イベントとユーザーデータ', link: '/ja/customize/events' },
              { text: 'パーツ制御（表示 / セル / 色）', link: '/ja/customize/part-overrides' },
              { text: 'テクスチャ差し替え（着せ替え）', link: '/ja/customize/texture-replacement' },
              { text: 'パーツトラッキング（指定パーツへの追従）', link: '/ja/customize/part-following' },
              { text: 'モーションブレンド（トラックとクロスフェード）', link: '/ja/customize/motion-blending' },
              { text: 'シェーダーとブレンドモード', link: '/ja/customize/shaders' },
              { text: 'リソースとライフサイクル', link: '/ja/customize/resources' },
              { text: 'パフォーマンスチューニング', link: '/ja/customize/performance' },
            ],
          },
          {
            text: '制約と適用範囲',
            items: [
              { text: '制約と適用範囲', link: '/ja/limitations' },
            ],
          },
          {
            text: 'Player・SDK 開発者向けガイド',
            items: [
              { text: 'ビルドガイド', link: '/ja/development/build' },
              { text: 'プレイヤーの構成', link: '/ja/development/architecture' },
              { text: 'コントリビューション', link: `${GITHUB}/blob/main/CONTRIBUTING.md` },
            ],
          },
        ],
      },
    },
  },
})
