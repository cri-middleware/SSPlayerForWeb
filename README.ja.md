[**English**](./README.md) | [**日本語**](./README.ja.md)

# SSPlayerForWeb

**Web のためのプロ品質 2D アニメーション。WebAssembly 製の単一コアを、モダンな PixiJS や依存ゼロの単体 WebGL エンジンで描画する。**

**[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** で制作したアニメーション (`.ssab`) を Web ブラウザ上で再生する高性能プレイヤーです。すでにお持ちのスプライト素材 (PNG / WebP) を専用エディタでアニメーションさせ、動画ファイルも作り直しも不要で、お好みのレンダリングエンジンからブラウザで再生できます。

## 🌐 ブラウザで試す

インストール不要、すべてブラウザ上で動作します（🚧 初回リリースの公開後に有効になります）:

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — `.sspj` → `.ssab` をブラウザ内で変換（まずはここから）
- ▶️ **[単体 WebGL サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — 依存ゼロの単体レンダラー（`<ss-player>` Web コンポーネント）
- ▶️ **[PixiJS サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — PixiJS v8 アプリ向け
- ▶️ **[RPG ツクール MZ サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — サンプル MZ プロジェクト（SpriteStudio ピクチャ）

## 📚 ドキュメント

詳細なドキュメントは `docs/` フォルダ内で提供しています（VitePress にてホスティング）。読者の目的に応じて段階的に読み進められる構成です。

- [**ドキュメントサイト (ホスト版)**](https://cri-middleware.github.io/SSPlayerForWeb/) — 🚧 初回リリース後に公開
- [**ドキュメント (日本語)**](./docs/index.md) — 全ドキュメント（英語ドキュメントは現在準備中です）。

### クイックリンク (日本語)
- [インストール](./docs/setup/install.md)
- [クイックスタート](./docs/setup/quickstart.md)
- [基本的な使い方](./docs/usage/basic.md)
- [アセットの準備](./docs/usage/assets.md)
- [WebGL・Web Components で使う](./docs/usage/webgl.md)
- [PixiJS で使う](./docs/usage/pixi.md)

### 目的別・どこから読むか
目的の達成に必要な範囲だけを読んで利用できます。

| あなたは… | ゴール | 読むところ |
|---|---|---|
| **利用ユーザー** | とにかくアニメーションを動かしたい | [クイックスタート](./docs/setup/quickstart.md) → [基本的な再生](./docs/usage/basic.md) |
| **カスタマイズユーザー** | 表現を作り込み、ロジックを追加したい | 上記 + [カスタマイズ](./docs/customize/events.md) |
| **SDK / Player 開発者** | 内部の拡張やコアに貢献したい | 上記 + [CONTRIBUTING.md](./CONTRIBUTING.md) |

## 🎯 どのパッケージを使うか

各レンダラーは WASM コアを同梱しているので、インストールするのは1つだけ — 環境に合う行を選んでください。**そのスタック（PixiJS / 素の WebGL …）で SpriteStudio を選ぶ理由**は各パッケージの README に記載しています。

| あなたの環境 | パッケージ | 実行できるサンプル |
|---|---|---|
| **単体 / フレームワーク非依存**（`<ss-player>` Web Component） | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **PixiJS v8 アプリ** | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **自作レンダラーを実装する** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **`.sspj` → `.ssab` を変換する** | [`ssconverter-web`](./packages/ssconverter-web)（Web ツール + Node CLI） | — |
| **変換機能を自作アプリ/サービスに組み込む** | [`@spritestudio/ssconverter-core`](./packages/ssconverter-core) | — |

**ゲームエンジン統合** — `ssplayer-webgl` の上に載る薄いアダプターです。いずれも **実験的**（`alpha`、npm 未公開）です:

| あなたの環境 | パッケージ | 実行できるサンプル |
|---|---|---|
| **RPG ツクール MZ**（PixiJS v5） | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **TyranoScript / TyranoBuilder**（ノベル） | [`@spritestudio/ssplayer-tyrano`](./packages/ssplayer-tyrano) | [examples/tyrano-example](./examples/tyrano-example) |

## 🚀 クイックスタート

入口は2つあります。自分に合うほうを選んでください:

- **A. このリポジトリでサンプルを動かす** — SSPlayerForWeb を評価する、またはローカルで開発する人向け。
- **B. 自分のプロジェクトで使う** — 制作中のアプリにパッケージを導入する人向け。

### A. このリポジトリでサンプルを動かす

**前提条件:** [Node.js](https://nodejs.org/) と [pnpm](https://pnpm.io/)（本リポジトリは pnpm workspaces を使用します）。以下の手順は **プリビルド** の WASM コアを取得するため、Rust ツールチェーンは不要です。

```bash
git clone https://github.com/cri-middleware/SSPlayerForWeb.git
cd SSPlayerForWeb
git submodule update --init --recursive  # SpriteStudio-SDK（サンプル素材＋コア）を取得
pnpm install                             # 依存関係のインストール & ワークスペースの初期化
pnpm run download:wasm                   # プリビルド WASM を取得（macOS・Windows 共通）
pnpm run build                           # すべての TypeScript パッケージをビルド
pnpm run deploy-examples                 # examples が読み込む .ssab アセットを生成
cd examples/webgl-example
pnpm run dev                             # 開発サーバを起動してアニメーションを確認
```
examples は **ビルド済み** のパッケージをワークスペース参照で利用します。`packages/` 配下の TypeScript を変更したら `pnpm run build` を、サンプルプロジェクトを編集したら `pnpm run deploy-examples` を再実行してください。

**WASM コアをソースからビルド**（Rust コアを変更する場合のみ）: `pnpm run download:wasm` を `pnpm run build:wasm` に置き換えるだけで、他の手順は同じです。追加で **Rust（[rustup](https://rustup.rs/) 経由）** と **wasm-pack**（`cargo install wasm-pack`）が必要です。変更を貢献する場合は、[CONTRIBUTING.md](./CONTRIBUTING.md) にコーディング規約と WASM FFI のルールがあります。

### B. 自分のプロジェクトで使う

> 🚧 パッケージは **まだ npm に公開されていません**。この導線は初回リリース後に利用できます。それまでは **トラック A** でローカルにお試しください。

こちらでは Rust / WASM ツールチェーンは不要です。WASM は各レンダラーパッケージに同梱されています。

1. **変換**: [`ssconverter-web`](./docs/usage/assets.md) またはデスクトップの [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) で `.sspj` を `.ssab` に変換します。
2. **インストール**: `npm install @spritestudio/ssplayer-pixi pixi.js`（または環境に合ったレンダラー。上の表を参照）。
3. **再生**: `.ssab` を読み込み、`SSPlayer` コンテナにアタッチして再生します。

より高度なセットアップについては、[インストールガイド](./docs/setup/install.md) を参照してください。

## 💡 概要

### monorepo 構成

`pnpm` ワークスペースで構成し、描画をアニメーションロジックから完全に分離しています:

```
変換（オーサリング時）
  .sspj  ──▶  ssconverter-core (WASM)  ──▶  .ssab
                └─ ssconverter-web — ブラウザ UI + Node CLI

再生（ランタイム）
  .ssab  ──▶  ssplayer-core (WASM・エンジン非依存)
                ├─ ssplayer-webgl   → 単体 WebGL + <ss-player>
                │    ├─ ssplayer-rmmz     → RPG ツクール MZ   （実験的）
                │    └─ ssplayer-tyrano   → TyranoScript      （実験的）
                └─ ssplayer-pixi    → PixiJS v8
```

- **[`ssplayer-core`](./packages/ssplayer-core)** がタイムラインと WASM 処理をすべて担い、各フレームを素の描画データとしてレンダラーへ渡します（DOM・エンジンに非依存）。各レンダラーはその上に載る薄いバインディングなので、新規レンダラーの追加（[ROADMAP](./ROADMAP.md) 参照）はそのパッケージだけで完結します。`ssplayer-rmmz` / `ssplayer-tyrano` はさらに `ssplayer-webgl` を再利用します。
- **[`ssconverter-core`](./packages/ssconverter-core)** は独立した変換用 WASM コア（Rust `libssconverter` のビルド）で、バイト入力・バイト出力の設計は同じ。ブラウザ・Node・Worker・エッジランタイムのいずれでも同じ変換器が動きます。ビルド環境の外では、デスクトップの [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) が同じ工程を担います。

各パッケージの詳細（API・オプション）は上の表からリンクした各 README を参照してください。

## 🎬 サンプル

すぐ動かせるサンプルアプリは [`examples/`](./examples/) にあります（レンダラーごとに1つ。上の環境別テーブルからリンクしています）。先にパッケージをビルドし（[クイックスタート](#a-このリポジトリでサンプルを動かす)参照）、各サンプルの開発サーバを起動してください。

## 🔗 関連リポジトリ

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` および `libssconverter` を提供するコア SDK です。
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — `.sspj` から `.ssab` へ変換するためのデスクトップ GUI ツールです。

## ライセンス

このプロジェクトは BSD-3-Clause License の下でライセンスされています。詳細は [LICENSE.md](./LICENSE.md) ファイルを参照してください。

同梱の `SpriteStudio-SDK` およびその他のサードパーティライブラリのライセンスは [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。困ったときは [SUPPORT.md](./SUPPORT.md) を、参加にあたっては [行動規範（Code of Conduct）](./CODE_OF_CONDUCT.md) をご覧ください。
