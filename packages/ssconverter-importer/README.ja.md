[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssconverter-importer

このリポジトリのエディタ用プラグインが共有する取り込み処理です。ソースフォルダにある SpriteStudio のプロジェクト（`.sspj`）を探し、前回の取り込みが成功してから変わったものだけを変換し、それぞれの変換が書き出したファイルを記録します。

> **対象読者:** ホストの中で SpriteStudio のプロジェクトを取り込むプラグインを開発する方（プロジェクトを開いたときに取り込む [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder) と、テストプレイで取り込む [`ssplayer-rmmz`](../ssplayer-rmmz)）。private パッケージなので公開はせず、プラグインが自分のビルドに取り込みます。

SSPlayerForRenPy の取り込み処理と同じ形で、変換には [`@spritestudio/ssconverter-core`](../ssconverter-core) を使います。

- **ホストが `runOnce()` を呼んだときに 1 回だけ**変換します。それ以外に自分から動くことはありません。
- **更新の判定はプロジェクトフォルダ全体の最新の更新時刻**で、変換に成功したときだけ記録します。SpriteStudio は変更したファイルしか保存しないため、`.sspj` だけを見るとアニメの編集を見落とします。
- **前回の変換が書き出し、今回は書き出さなかったファイル**を消します。それ以外のファイルには触れません。
- **同じ名前のプロジェクトが 2 つある**場合、同じフォルダに両方を書き出しません。先に見つかった方だけを変換し、もう一方は報告します。
- **変換は Worker で行います。** ホストが Blob URL から Worker を起動できない場合は、呼び出し元のスレッドで変換します。

## ホストが用意するもの

- **ファイルシステム**（`HostBackend`）。Node の `fs` に `copySync` / `removeSync` を加えたもの、`node:path`、再帰的な mkdir です。TyranoBuilder はちょうどこの形を `window.studio_api` として公開しています。`require()` が使えるホスト（MZ の NW.js）は Node から組み立てます。どちらも `HostFs` で包んで渡します。
- **置き場所**（プロジェクトルートからの相対パス）。ソースフォルダ（既定は `SpriteStudio_Source`）、出力フォルダ、状態ファイルです。出力フォルダと状態ファイルは、ホストの書き出しで扱いたいとおりになる場所に置いてください。
- **コンバータの wasm**（`ssconverter-core` の `ssconverter_bg.wasm`）のパス。
- **Worker**（任意）。`import workerSource from '@spritestudio/ssconverter-importer/worker-source'` を `workerSource` に渡します。

## ビルドとテスト

```sh
pnpm --filter @spritestudio/ssconverter-importer build   # Worker を先に、続けて各エントリ
pnpm --filter @spritestudio/ssconverter-importer test
```

テストは `SpriteStudio-SDK` サブモジュールの実プロジェクトを、コンバータの wasm で変換します。どちらかが無いときは skipped として報告されます。

## ライセンス

BSD-3-Clause — [LICENSE.md](./LICENSE.md) を参照してください。
