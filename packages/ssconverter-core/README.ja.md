[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssconverter-core

SpriteStudio のプロジェクト（`.sspj`）をランタイムバイナリ（`.ssab` / `.ssqb`）へ変換する、エンジン非依存な WebAssembly コアです。

> **対象読者:** 自作のアプリ・サービス・Worker・ビルドパイプラインに `.sspj → .ssab` 変換を組み込みたい開発者 — bytes-in / bytes-out のエンジンで、ファイルシステムや DOM を前提としません。**インストール:** `npm install @spritestudio/ssconverter-core`
> **目的が違う場合:** → [ssconverter-web](../ssconverter-web/README.ja.md) — ファイルを変換したいだけなら、ブラウザツール + CLI をそのまま使ってください。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** —
[`ssconverter-web`] はこのコアをブラウザ上で動かしたものです。`.sspj` を投げ込むと、このコアが何を出力するかを確認できます。

ガイドや完全なドキュメントについては [docs](https://cri-middleware.github.io/SSPlayerForWeb/ja/) を参照してください。このバージョンの同じページ（英語の Markdown）がパッケージの `docs/` にあり、オフラインで読めます（入口は `docs/README.md`）。同じページは Agent Skill として `skills/ssconverter-core/` にもあり、pnpm 12.11 以降では `pnpm approve @spritestudio/ssconverter-core` のあと、コーディングエージェントの skills ディレクトリにリンクされます。

このパッケージは、Rust の [`libssconverter`] クレートを wasm ビルドしたものに、小さく使いやすい TypeScript レイヤーを添えたものです。**ファイルシステムや DOM への依存はありません**（bytes in, bytes out）。そのため、同じコアがブラウザ・Node・Worker・エッジランタイムのいずれでも動作します。[`ssconverter-web`]（Web UI）やその Node CLI といったホストが、周囲の I/O を受け持ちます。

[`libssconverter`]: https://github.com/cri-middleware/SpriteStudio-SDK
[`ssconverter-web`]: ../ssconverter-web

## このパッケージと ssconverter-web の使い分け

- **ファイルを変換したいだけ** — 手元の `.sspj` から `.ssab` を出力したい場合。
  [`ssconverter-web`](../ssconverter-web/README.ja.md) を使ってください。すぐ使える**ブラウザツール**と **Node CLI** が用意されており、コードを書く必要はありません。
- **自作コードの中で変換したい** — プロジェクトのバイトをランタイムのバイトへ変換するアプリ・バックエンドサービス・Worker・ビルドステップを作る場合。**このパッケージ**を使ってください。I/O はあなたが供給し、コアが `.sspj → .ssab` の変換を担います。

## インストール

```sh
npm install @spritestudio/ssconverter-core
```

## 使い方

```ts
import {
  init,
  convertProject,
  locateProject,
  version,
  ssabSchemaVersion,
} from '@spritestudio/ssconverter-core';

// Browser: fetch the bundled wasm by URL.
import wasmUrl from '@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm?url';
await init(wasmUrl);

// Node: read the wasm bytes yourself and pass them in.
// import { readFile } from 'node:fs/promises';
// const wasmPath = new URL(
//   import.meta.resolve('@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm'),
// );
// await init(await readFile(wasmPath));

console.log(`converter ${version()} (ssab v${ssabSchemaVersion()})`);

// `files` maps every path in the project directory (incl. the .sspj) to bytes.
const { stem } = locateProject(files.keys());
const result = convertProject(files, { embedded: false });

for (const [name, bytes] of result.output) {
  /* write `${stem}/${name}` */
}
for (const [dest, src] of result.assets) {
  /* copy source asset `src` -> `dest` (non-embedded only) */
}
```

## API

| エクスポート | 説明 |
| --- | --- |
| `init(source?)` | wasm モジュールを初期化する。`source` は `URL` / `Response`、wasm の `BufferSource`、または `WebAssembly.Module`。 |
| `convertProject(files, opts?)` | プロジェクトを変換する。`opts`: `{ embedded=false, debug=false, split=false, optimize=true }`。`ConvertResult` を返す。 |
| `ConvertResult` | `.output: Map<name, bytes>`（生成されたファイル）と `.assets: Map<dest, src>`（コピーすべき外部アセット。embedded 時は空）。 |
| `locateProject(paths)` | 単一の `.sspj` を見つけ、`{ sspjPath, stem, dir }` を導出する。0 個または複数の場合は例外を投げる。 |
| `applySuffix(output, suffix)` | 各 `.ssab` のベース名に `suffix` を付与し、`.ssab` 以外の出力を落とす（embedded バリアントを併存させて出力するため）。 |
| `version()` | コンバーターのビルドバージョン文字列。 |
| `ssabSchemaVersion()` / `ssqbSchemaVersion()` | 出力されるスキーマのバージョン。 |

## ライセンス

BSD-3-Clause。[LICENSE.md](./LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。公開 npm パッケージには wasm が同梱済みです。*

monorepo で作業する場合、wasm は git で**追跡していません**。リポジトリルートで `pnpm download:wasm` により SpriteStudio-SDK の Releases から取得するか、`pnpm build:wasm` でソースからビルドします。
