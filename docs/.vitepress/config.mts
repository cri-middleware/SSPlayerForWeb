import { withMermaid } from 'vitepress-plugin-mermaid'

const GITHUB = 'https://github.com/cri-middleware/SSPlayerForWeb'

// The sidebar is ordered as a difficulty gradient — reader personas are the
// design driver but are intentionally NOT surfaced as section labels. Reading
// top-to-bottom, the effort required rises naturally:
//   1. はじめに / 使い方 / API … 写経すれば動く（負担なく読める）
//   2. カスタマイズ            … 少し工夫して作り込む
//   3. 開発・拡張              … 全体構成を理解した上で core / WASM を触る
export default withMermaid({
  title: 'SSPlayerForWeb',
  description: 'SpriteStudio 7 player for the Web (WebAssembly + PixiJS)',
  lastUpdated: true,
  cleanUrls: true,

  // A GitHub Pages project site is served under a subpath (e.g. /SSPlayerForWeb/).
  // CI passes DOCS_BASE to match; local dev/build stays at '/'. Env-driven because
  // VitePress build has no --base CLI flag.
  base: process.env.DOCS_BASE || '/',

  // ja-first. English lives under docs/en/ and can be enabled later by adding
  // an `en` locale here that mirrors the sidebar below.
  locales: {
    root: {
      label: '日本語',
      lang: 'ja',
      themeConfig: {
        outline: {
          level: [2, 3],
          label: '目次'
        },
        nav: [
          { text: 'はじめに', link: '/setup/install' },
          { text: '使い方', link: '/usage/basic' },
          { text: 'カスタマイズ', link: '/customize/events' },
          { text: 'API', link: '/api/' },
          { text: 'ROADMAP', link: `${GITHUB}/blob/main/ROADMAP.md` },
        ],
        sidebar: [
          {
            text: 'はじめに',
            items: [
              { text: 'インストール', link: '/setup/install' },
              { text: 'クイックスタート', link: '/setup/quickstart' },
            ],
          },
          {
            text: '使い方',
            items: [
              { text: '基本的な再生', link: '/usage/basic' },
              { text: 'アセットの準備（.sspj → .ssab）', link: '/usage/assets' },
              { text: 'PixiJS で使う', link: '/usage/pixi' },
              { text: 'WebGL で使う', link: '/usage/webgl' },
              { text: 'RPG Maker MZ で使う', link: '/usage/rmmz' },
            ],
          },
          {
            text: 'API リファレンス',
            items: [
              { text: '概要', link: '/api/' },
            ],
          },
          {
            text: 'カスタマイズ',
            items: [
              { text: 'イベントとユーザーデータ', link: '/customize/events' },
              { text: 'パーツ制御（表示 / セル / 色）', link: '/customize/part-overrides' },
              { text: 'シェーダーとブレンドモード', link: '/customize/shaders' },
              { text: 'パフォーマンスチューニング', link: '/customize/performance' },
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

  themeConfig: {
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: GITHUB }],
    editLink: {
      pattern: `${GITHUB}/edit/main/docs/:path`,
      text: 'このページを編集',
    },
  },
})
