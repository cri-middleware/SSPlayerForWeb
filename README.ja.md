[**日本語**](./README.ja.md) | [**English**](./README.md)

# SSPlayerForWeb

Webブラウザ上で [OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/) のアニメーションを再生するための、WebAssembly を活用した高性能プレイヤーです。

モダンな PixiJS から、RPG Maker MZ (PixiJS v5) のようなレガシー環境、さらには単体の WebGL 環境まで、様々な Web グラフィックスエンジンに高い適応力でデプロイできるように設計されています。

## ドキュメント

詳細なドキュメントは `docs/` フォルダ内で提供しています（VitePress にてホスティング）：

- [**ドキュメント (日本語)**](./docs/index.md) (英語ドキュメントは現在準備中です)

### クイックリンク (日本語)
- [インストール](./docs/setup/install.md)
- [クイックスタート](./docs/setup/quickstart.md)
- [基本的な使い方](./docs/usage/basic.md)
- [アセットの準備](./docs/usage/assets.md)
- [PixiJS で使う](./docs/usage/pixi.md)
- [WebGL・Web Components で使う](./docs/usage/webgl.md)

## クイックスタート

### 1. サンプルを動かしてみる
1. **リポジトリの取得**: このリポジトリをクローンまたはダウンロードします。
2. **WASM のビルド**: `pnpm run build:wasm` を実行します（Rust コードを変更した場合や、未ビルドの場合に必要です。事前に `rustup` 環境の構築と `cargo install wasm-pack` によるインストールが必要です）。
3. **パッケージのビルド**: プロジェクトのルートで `pnpm install` に続いて `pnpm run build` を実行します。
4. **実行**: `examples/pixi-example` に移動し、`pnpm run dev` を実行します。

### 2. プロジェクトに導入する
1. **変換**: [`ssconverter-web`](./docs/usage/assets.md) または [`SSConverterGUI`](https://github.com/cri-middleware/SSConverterGUI/releases) を使って `.sspj` を `.ssab` に変換します。
2. **インストール**: `npm install @spritestudio/ssplayer-pixi pixi.js` を実行します。
3. **再生**: `.ssab` を読み込み、`SSPlayer` コンテナをアタッチして再生します！

ソースからのコンパイルなどのより高度なセットアップについては、[インストールガイド](./docs/setup/install.md) を参照してください。

## 概要

### モノレポ構成

このプロジェクトはパッケージ管理に `pnpm` ワークスペースを使用しています。

**コア (Core)**
- **`@spritestudio/ssplayer-core`**: エンジンに依存しないコアロジック層です。WASM の初期化、時間の更新、ゼロコピーでのデータ抽出を管理します。DOM API や特定のレンダリングエンジンへの依存は一切ありません。

**レンダラー (Renderers / Engine Bindings)**
- **`@spritestudio/ssplayer-pixi`**: PixiJS v8 向けに最適化されています。最大のパフォーマンスを引き出すため、Direct Drawing (BatchRenderer) を使用します。
- **`@spritestudio/ssplayer-webgl`**: 軽量な単体 WebGL レンダラーです。`<ss-player>` Web Components も含まれています。
- **`@spritestudio/ssplayer-rmmz`**: RPG Maker MZ (PixiJS v5) 向けに設計されています。エンジンの Sprite ツリーとシームレスに統合するため、SceneGraph 描画を使用します。

**ツール (Tools)**
- **[`SSConverterGUI`](https://github.com/cri-middleware/SSConverterGUI/releases)**: `.sspj` から `.ssab` へ変換するためのデスクトップ GUI ツールです。
- **`ssconverter-web`**: WebAssembly を使用して `.sspj` から `.ssab` に変換する Web 版変換ツールおよび Node.js 用 CLI スクリプトです。

## 読者ペルソナ

ドキュメントとリポジトリ構成は、以下のような3段階のユーザー層を想定して設計されています。目的の達成に必要な範囲だけを読んで利用できます。

| ペルソナ | ゴール | 読むところ |
|---|---|---|
| **利用ユーザー** | とにかくアニメーションを動かしたい | [クイックスタート](./docs/setup/quickstart.md) → [基本的な再生](./docs/usage/basic.md) |
| **カスタマイズユーザー** | 表現を作り込み、ロジックを追加したい | 上記 + [カスタマイズ](./docs/customize/events.md) |
| **SDK / Player 開発者** | 内部の拡張やコアに貢献したい | 上記 + [CONTRIBUTING.md](./CONTRIBUTING.md) |

## 関連リポジトリ

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` および `libssconverter` を提供するコア SDK です。
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — `.sspj` から `.ssab` へ変換するためのデスクトップ GUI ツールです。

## ライセンス

このプロジェクトは BSD-3-Clause License の下でライセンスされています。詳細は [LICENSE.md](./LICENSE.md) ファイルを参照してください。
