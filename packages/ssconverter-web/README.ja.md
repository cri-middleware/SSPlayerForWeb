[**English**](./README.md) | [**日本語**](./README.ja.md)

# ssconverter-web

SpriteStudio のプロジェクトファイル（`.sspj`）を、プレイヤーが読み込むランタイム
バイナリ形式（`.ssab`）へ変換する、WebAssembly ベースのコンバータです。
**ブラウザツール**（Vite アプリ）と **Node.js CLI** の両方として提供されます。

[SSPlayerForWeb](../../README.ja.md) モノレポの一部です。

> このパッケージは `private` です。モノレポ内のツールであり、**npm には公開されません**。

## ✨ なぜ ssconverter-web なのか？

SDK のネイティブ版 `ssconverter-cli` と同じ `.sspj → .ssab` 変換を、まったく同一の
`libssconverter` エンジンで行いますが、**WebAssembly** にコンパイルされている点が
異なり、実行方法が変わります。

- **プラットフォーム別バイナリが不要 — インストール不要の Web ページとしてデプロイ可能。**
  `ssconverter-cli` は、特定の OS 向けに [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK)
  のリリースから取得するネイティブバイナリです。このコンバータは WASM なので、ブラウザ
  ツールは完全にクライアントサイドで動作し、単なる Web ページとして配信できます。
  エンドユーザーはページを開いて `.sspj` をドロップし、`.ssab` をダウンロードするだけです。
  構造上クロスプラットフォームであり、対応バイナリを探し回る必要もありません。
- **JS / TS パイプラインにネイティブに適合。** Node CLI は同じ WASM 上で動作する純粋な
  JavaScript なので、別途ネイティブ実行ファイルを同梱することなく、既存の pnpm / CI
  スクリプトに組み込めます。

スタンドアロンのネイティブバイナリが特に必要な場合は `ssconverter-cli` を、ネイティブ
アプリが欲しい場合はデスクトップ版の [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases)
を選んでください。

## セットアップ

コンバータの WASM（`wasm/ssconverter_bg.wasm`）は **git で管理されていない** ため、
以下のいずれかのインターフェースを使う前に、リポジトリルートから一度取得してください。

```bash
pnpm run download:wasm   # fetch the pre-built WASM (no toolchain needed)
```

> 代わりにソースからビルドしますか（SDK / プレイヤー開発者向け）？ `pnpm run build:wasm`
> を実行してください。これには Rust / wasm-pack ツールチェーンが必要です。
> [リポジトリ README](../../README.ja.md#-クイックスタート) を参照してください。

## ブラウザツール（開発サーバー）

```bash
pnpm --filter ssconverter-web dev
```

`.sspj` プロジェクトをドロップして、変換された `.ssab` をダウンロードできる Vite 開発
サーバーが起動します。

## CLI

```bash
# Output goes next to the .sspj unless -o is given:
node packages/ssconverter-web/scripts/cli.js -o ./out path/to/project.sspj
```

CLI は `.sspj` ディレクトリを再帰的に読み込んで変換し、生成された `.ssab`（および参照
されているテクスチャ）を出力ディレクトリに書き出します。

```
Usage: node scripts/cli.js [-o output_dir] <project.sspj>
```

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。
