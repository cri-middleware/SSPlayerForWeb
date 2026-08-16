[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssconverter-web

SpriteStudio のプロジェクトファイル（`.sspj`）を、プレイヤーが読み込むランタイム
バイナリ形式（`.ssab`）へ変換します。ブラウザでも、コマンドラインでも実行できます。

> **対象読者:** SpriteStudio のプロジェクト（`.sspj`）を持っていて、ランタイム用の
> `.ssab` が必要な方 — ドラッグ＆ドロップのブラウザツール、またはスクリプト可能な
> CLI で変換できます。
> **ステータス:** beta。npm パッケージではありません — ブラウザツールは GitHub Pages で
> ホストし、CLI は monorepo に同梱しています（下記[ツールの入手](#ツールの入手)を参照）。
> **目的が違う場合:** → [ssconverter-core](../ssconverter-core) — 自作アプリに
> 組み込むための、環境非依存の変換エンジンです。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。

## 実行方法を選ぶ

どちらのモードも **同じ** `.sspj → .ssab` 変換を行います。ワークフローで選んでください。

| | **ブラウザツール** | **CLI** |
|---|---|---|
| 向いている用途 | 単発の変換、非技術者 | **開発者**: スクリプト、CI、バッチ処理 |
| 方法 | ホスト版のページを開き、`.sspj` プロジェクトが入ったフォルダをドロップして `.ssab` をダウンロード | `node scripts/cli.js -o ./out project.sspj` |
| 出力 | ブラウザからの ZIP ダウンロード | 出力ディレクトリへのファイル書き出し |
| 参照先 | [ブラウザツール](#ブラウザツール) | [CLI](#cli) |

## ツールの入手

**ブラウザツール**はインストール不要です。
**[ssconverter-web（ホスト版）](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)**
を開いてください（🚧 初回リリース後に公開）。

**CLI**（およびブラウザツールをソースから起動する場合）は、monorepo を clone して
一度インストールする必要があります。

```bash
git clone https://github.com/cri-middleware/SSPlayerForWeb.git
cd SSPlayerForWeb
pnpm install
pnpm run download:wasm   # ビルド済みの変換 WASM を取得（ツールチェーン不要）
```

`download:wasm` は、**git で管理されていない**
`@spritestudio/ssconverter-core` の `wasm/ssconverter_bg.wasm` を取得します。
一度実行すれば、以下のどちらのモードも使えます（すべてのコマンドはリポジトリ
ルートで実行します）。

## ブラウザツール

GitHub Pages の **[/ssconverter/](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)**
でホストしています（🚧 初回リリース後に公開）。clone 済みであれば、Vite **開発サーバー**
でも同じツールを起動できます（表示された URL を開いてください）。

```bash
pnpm --filter @spritestudio/ssconverter-web dev
```

`.sspj` プロジェクトが入ったフォルダをページにドロップして、変換された
`.ssab` をダウンロードします。単発の変換や非技術者に最適です — コマンドライン操作は
不要です。

## CLI

**開発者向けツールです** — CI / バッチ処理向けに、出力先を指定できるスクリプト可能な
変換を行います。Node とクローン済みリポジトリが必要です（コマンドはリポジトリルートで実行）。

```bash
# -o を指定しない場合、出力は .sspj の隣に置かれます:
node packages/ssconverter-web/scripts/cli.js -o ./out path/to/project.sspj
```

CLI は `.sspj` ディレクトリを再帰的に読み込んで変換し、生成された `.ssab`（および参照
されているテクスチャ）を出力ディレクトリに書き出します。

```
Usage: node scripts/cli.js [-o output_dir] [-e|--embedded] [--suffix <s>] [--stem-dir] <project.sspj>
```

> 本パッケージは bin（`ssconverter-web-cli` → `scripts/cli.js`）を宣言していますが、
> workspace 専用パッケージで `npm install -g` されることがないため、`PATH` には
> リンクされません。したがって上記のようにスクリプトをパス指定で実行してください。

## ネイティブ版 SDK ツールとの比較

*SpriteStudio の各コンバータツールから選ぶ際の判断材料です。変換したいだけなら
読み飛ばしてかまいません。*

これは SDK のネイティブ版 `ssconverter-cli` と同じ `.sspj → .ssab` 変換を、まったく
同一の `libssconverter` エンジンで行いますが、**WebAssembly** にコンパイルされている
点が異なり、実行方法が変わります。

- **プラットフォーム別バイナリが不要 — インストール不要の Web ページとしてデプロイ可能。**
  `ssconverter-cli` は、特定の OS 向けに [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK)
  のリリースから取得するネイティブバイナリです。このコンバータは WASM なので、ブラウザ
  ツールは完全にクライアントサイドで動作し、単なる Web ページとして配信できます。
  構造上クロスプラットフォームであり、対応バイナリを探し回る必要もありません。
- **JS / TS パイプラインにネイティブに適合。** Node CLI は同じ WASM 上で動作する純粋な
  JavaScript なので、別途ネイティブ実行ファイルを同梱することなく、既存の pnpm / CI
  スクリプトに組み込めます。

スタンドアロンのネイティブバイナリが特に必要な場合は `ssconverter-cli` を、ネイティブ
アプリが欲しい場合はデスクトップ版の [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases)
を選んでください。

## ライブラリに組み込む方は

ツールを実行するのではなく、`.sspj → .ssab` 変換を自作アプリに組み込みたい場合は、
環境非依存のエンジン [`@spritestudio/ssconverter-core`](../ssconverter-core) を直接
依存に加えてください。ここにある 2 つのインターフェースは、いずれもその上に載る薄い
**ホスト**です。本パッケージは I/O（ブラウザ: File System Access API + ZIP ダウンロード、
CLI: ファイルシステム）を担い、変換そのものはコアが行います。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

WASM をダウンロードせずソースからビルドする場合（SDK / プレイヤー開発者向け）は、
Rust / wasm-pack ツールチェーンが必要です。

```bash
pnpm run build:wasm   # ソースから WASM をビルド（Rust / wasm-pack が必要）
```

ツールチェーンのセットアップ全体は
[リポジトリ README](../../README.ja.md#-クイックスタート) を参照してください。
