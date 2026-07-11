import { withMermaid } from 'vitepress-plugin-mermaid'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForWeb'

// English is the default (root) locale; Japanese lives under /ja/. The API
// reference (docs/api/, TypeDoc-generated) is language-neutral and shared by both
// locales at /api/.
//
// The sidebar is ordered as a difficulty gradient — reader personas are the
// design driver but are intentionally NOT surfaced as section labels. Reading
// top-to-bottom, the effort required rises naturally:
//   1. Setup / Usage / API  … copy-paste and it runs
//   2. Customize            … a little effort to polish expression
//   3. Development           … understand the whole, then touch core / WASM
export default withMermaid({
  title: 'SSPlayerForWeb',
  description: 'SpriteStudio 7 player for the Web (WebAssembly + PixiJS / WebGL)',
  lastUpdated: true,
  cleanUrls: true,
  lang: 'en',

  // A GitHub Pages project site is served under a subpath (e.g. /SSPlayerForWeb/).
  // CI passes DOCS_BASE to match; local dev/build stays at '/'. Env-driven because
  // VitePress build has no --base CLI flag.
  base: process.env.DOCS_BASE || '/',

  // Shared across locales.
  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: GITHUB }],
  },

  locales: {
    // English — default locale, served at the root path.
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        outline: { level: [2, 3], label: 'On this page' },
        editLink: {
          pattern: `${GITHUB}/edit/main/docs/:path`,
          text: 'Edit this page',
        },
        nav: [
          { text: 'Setup', link: '/setup/install' },
          { text: 'Usage', link: '/usage/basic' },
          { text: 'Customize', link: '/customize/events' },
          { text: 'API', link: '/api/' },
          { text: 'ROADMAP', link: `${GITHUB}/blob/main/ROADMAP.md` },
        ],
        sidebar: [
          {
            text: 'Setup',
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
              { text: 'PixiJS', link: '/usage/pixi' },
              { text: 'RPG Maker MZ (experimental)', link: '/usage/rmmz' },
              { text: 'TyranoScript / TyranoBuilder (experimental)', link: '/usage/tyrano' },
            ],
          },
          {
            text: 'API Reference',
            items: [{ text: 'Overview', link: '/api/' }],
          },
          {
            text: 'Customize',
            items: [
              { text: 'Events & user data', link: '/customize/events' },
              { text: 'Part control (visibility / cell / color)', link: '/customize/part-overrides' },
              { text: 'Shaders & blend modes', link: '/customize/shaders' },
              { text: 'Performance tuning', link: '/customize/performance' },
            ],
          },
          {
            text: 'Development',
            items: [
              { text: 'Contributing', link: `${GITHUB}/blob/main/CONTRIBUTING.md` },
            ],
          },
        ],
      },
    },

    // Japanese — served under /ja/.
    ja: {
      label: '日本語',
      lang: 'ja',
      link: '/ja/',
      themeConfig: {
        outline: { level: [2, 3], label: '目次' },
        editLink: {
          pattern: `${GITHUB}/edit/main/docs/:path`,
          text: 'このページを編集',
        },
        nav: [
          { text: 'はじめに', link: '/ja/setup/install' },
          { text: '使い方', link: '/ja/usage/basic' },
          { text: 'カスタマイズ', link: '/ja/customize/events' },
          { text: 'API', link: '/api/' },
          { text: 'ROADMAP', link: `${GITHUB}/blob/main/ROADMAP.md` },
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
              { text: 'PixiJS で使う', link: '/ja/usage/pixi' },
              { text: 'RPG ツクール MZ で使う（実験的）', link: '/ja/usage/rmmz' },
              { text: 'TyranoScript / TyranoBuilder で使う（実験的）', link: '/ja/usage/tyrano' },
            ],
          },
          {
            text: 'API リファレンス',
            items: [{ text: '概要', link: '/api/' }],
          },
          {
            text: 'カスタマイズ',
            items: [
              { text: 'イベントとユーザーデータ', link: '/ja/customize/events' },
              { text: 'パーツ制御（表示 / セル / 色）', link: '/ja/customize/part-overrides' },
              { text: 'シェーダーとブレンドモード', link: '/ja/customize/shaders' },
              { text: 'パフォーマンスチューニング', link: '/ja/customize/performance' },
            ],
          },
          {
            text: '開発・拡張',
            items: [
              { text: 'コントリビューション', link: `${GITHUB}/blob/main/CONTRIBUTING.md` },
            ],
          },
        ],
      },
    },
  },
})
