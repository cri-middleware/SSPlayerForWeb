[**English**](./README.md) | [**日本語**](./README.ja.md)

# SSPlayerForWeb

**Web のためのプロ品質 2D アニメーション。WebAssembly 製の単一コアで、モダンな PixiJS からレガシーな RPG Maker MZ、単体 WebGL まで動かす。**

**[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** で制作したアニメーション (`.ssab`) を Web ブラウザ上で再生する高性能プレイヤーです。すでにお持ちのスプライト素材 (PNG / WebP) を専用エディタでアニメーションさせ、動画ファイルも作り直しも不要で、お好みのレンダリングエンジンからブラウザで再生できます。

## 📚 ドキュメント

詳細なドキュメントは `docs/` フォルダ内で提供しています（VitePress にてホスティング）。読者の目的に応じて段階的に読み進められる構成です。

- [**ドキュメント (日本語)**](./docs/index.md) — 全ドキュメント（英語ドキュメントは現在準備中です）。

### クイックリンク (日本語)
- [インストール](./docs/setup/install.md)
- [クイックスタート](./docs/setup/quickstart.md)
- [基本的な使い方](./docs/usage/basic.md)
- [アセットの準備](./docs/usage/assets.md)
- [PixiJS で使う](./docs/usage/pixi.md)
- [WebGL・Web Components で使う](./docs/usage/webgl.md)

### 目的別・どこから読むか
目的の達成に必要な範囲だけを読んで利用できます。

| あなたは… | ゴール | 読むところ |
|---|---|---|
| **利用ユーザー** | とにかくアニメーションを動かしたい | [クイックスタート](./docs/setup/quickstart.md) → [基本的な再生](./docs/usage/basic.md) |
| **カスタマイズユーザー** | 表現を作り込み、ロジックを追加したい | 上記 + [カスタマイズ](./docs/customize/events.md) |
| **SDK / Player 開発者** | 内部の拡張やコアに貢献したい | 上記 + [CONTRIBUTING.md](./CONTRIBUTING.md) |

## 🎯 どのパッケージを使うか

本リポジトリは、役割ごとに分かれたパッケージの `pnpm` モノレポです。環境に合ったレンダラーをインストールしてください。各レンダラーは WASM コアを同梱しているため、コアを別途取り込む必要はありません。**そのスタック（PixiJS / 素の WebGL / RPG Maker MZ …）で SpriteStudio を選ぶ理由**は、各パッケージの README に記載しています。

| あなたの環境 | パッケージ | 実行できるサンプル |
|---|---|---|
| **PixiJS v8**（推奨・最速） | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **単体 WebGL / `<ss-player>` Web Component** | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **RPG Maker MZ**（PixiJS v5） | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **自作レンダラーを実装する** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **`.sspj` → `.ssab` を変換する** | [`ssconverter-web`](./packages/ssconverter-web)（Web ツール + Node CLI） | — |

## 🚀 クイックスタート

### 前提条件
- **Node.js** および **pnpm**（本リポジトリは pnpm workspaces を使用します）。
- WASM コアは **git で管理されていない** ため、新規クローン時に一度だけ取得する必要があります。方法は目的によって分かれます:
  - **利用ユーザー・カスタマイズユーザー** — プリビルドのバイナリを**ダウンロード**します。追加のツールチェーンは不要です。
  - **SDK / Player 開発者**（Rust コアを変更する人）— **ソースからビルド**します。追加で **Rust（[rustup](https://rustup.rs/) 経由）** と **wasm-pack**（`cargo install wasm-pack`）が必要です。

> 公開済みの npm パッケージを利用するだけなら、これらは **一切不要** です。WASM は各レンダラーパッケージに同梱されています。

### 1. サンプルを動かしてみる
```bash
# リポジトリのルートで実行
pnpm install               # 依存関係のインストール & ワークスペースの初期化
./scripts/download-sdk.sh  # プリビルド WASM を取得（Windows は scripts\download-sdk.ps1）
pnpm run build             # すべての TypeScript パッケージをビルド

cd examples/pixi-example
pnpm run dev               # 開発サーバを起動してアニメーションを確認
```
`pnpm run download:wasm` でも同じダウンロードをクロスプラットフォームに実行できます。examples は **ビルド済み** のパッケージをワークスペース参照で利用します。そのため `packages/` 配下の TypeScript を変更したら、都度ルートで `pnpm run build` を再実行してください。

> **SDK / Player 開発者**（Rust コアを変更する人）は、代わりに WASM をソースからビルドします: `download-sdk` の代わりに `pnpm run build:wasm`（Windows は `build:wasm:win`）を実行してください。Rust / wasm-pack のツールチェーンが必要です。詳細は [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

### 2. プロジェクトに導入する
1. **変換**: [`ssconverter-web`](./docs/usage/assets.md) またはデスクトップの [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) で `.sspj` を `.ssab` に変換します。
2. **インストール**: `npm install @spritestudio/ssplayer-pixi pixi.js`（または環境に合ったレンダラー。上の表を参照）。
3. **再生**: `.ssab` を読み込み、`SSPlayer` コンテナにアタッチして再生します。

より高度なセットアップについては、[インストールガイド](./docs/setup/install.md) を参照してください。

## 💡 概要

### モノレポ構成

このプロジェクトは `pnpm` ワークスペースを使用しています。コアはあらゆるレンダリングエンジンから意図的に分離されており、各レンダラーは同じ WASM ロジックの上に載る薄いバインディングです。

**コア (Core)**
- **[`@spritestudio/ssplayer-core`](./packages/ssplayer-core)**: エンジンに依存しないコアです。WASM の初期化、時間の更新、ゼロコピーでのデータ抽出を管理し、DOM や特定のレンダリングエンジンへの依存を一切持ちません。

**レンダラー (Renderers / Engine Bindings)**
- **[`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi)**: PixiJS v8 向けに最適化。最大のパフォーマンスのため Direct Drawing (BatchRenderer) を使用します。
- **[`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl)**: 依存ゼロの単体 WebGL1/2 レンダラー。`<ss-player>` Web Component を含みます。
- **[`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz)**: RPG Maker MZ (PixiJS v5) 向け。エンジンの Sprite ツリーとシームレスに統合するため SceneGraph 描画を使用します。

**ツール (Tools)**
- **[`ssconverter-web`](./packages/ssconverter-web)**: WebAssembly を使って `.sspj` を `.ssab` に変換する Web 版ツールおよび Node.js CLI。
- **[SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases)**: 同じ `.sspj` → `.ssab` 変換を行うデスクトップ GUI ツール。

## 🎬 サンプル

すぐ動かせるサンプルアプリは [examples フォルダ](./examples/) にあります。先にパッケージをビルドし（[クイックスタート](#1-サンプルを動かしてみる)参照）、各サンプルの開発サーバを起動してください。

- [pixi-example](./examples/pixi-example) — PixiJS v8 レンダラー (`@spritestudio/ssplayer-pixi`)。
- [webgl-example](./examples/webgl-example) — 単体 WebGL レンダラーと `<ss-player>` Web Component (`@spritestudio/ssplayer-webgl`)。
- [rmmz-example](./examples/rmmz-example) — RPG Maker MZ / PixiJS v5 との統合 (`@spritestudio/ssplayer-rmmz`)。

## 🔗 関連リポジトリ

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` および `libssconverter` を提供するコア SDK です。
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — `.sspj` から `.ssab` へ変換するためのデスクトップ GUI ツールです。

## ライセンス

このプロジェクトは BSD-3-Clause License の下でライセンスされています。詳細は [LICENSE.md](./LICENSE.md) ファイルを参照してください。
