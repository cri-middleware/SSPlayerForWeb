---
description: アニメーションを Google 広告の HTML5 広告やアプリキャンペーンのプレイアブルにまとめる。WebAssembly のランタイムと .ssab をスクリプトに入れた 1 つの ZIP。
---

# HTML5 広告（Google 広告）で使う

Google 広告の HTML5 広告は、HTML・CSS・JavaScript・画像を入れた ZIP で、外のものを参照しません。受け付けるファイルの種類に `.wasm` も `.ssab` も無いので、ランタイムとアニメーションは base64 にしてスクリプトの中に入れます。[`examples/html5-ad`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/examples/html5-ad) が `.ssab` 1 つからその ZIP を作り、できたものは Google の [HTML5 Validator](https://h5validator.appspot.com/adwords/asset) を通ります。

## バンドルを作る

1. テクスチャを埋め込んで変換します。[アセットの準備](/ja/usage/assets)にある変換ツールの **Embedded** オプション、コマンドラインなら `--embedded` です。
2. リポジトリのルートでインストールとビルドをし、スクリプトを実行します。ランタイムは `pnpm run download:wasm`（ビルド済みを取得）か `pnpm run build:wasm`（ソースからビルド。Rust と wasm-pack が必要）で用意します。

   ```bash
   pnpm install
   pnpm run download:wasm && pnpm run build
   node examples/html5-ad/build.mjs ssab=path/to/chara.ssab animation=idle size=300x250
   ```

`examples/html5-ad/out/<name>/` に `index.html` と `ad.js` を、入稿用に `examples/html5-ad/out/<name>.zip` を書き出します。オプションは `--help` で確認できます。npm から入れたプレイヤーのバンドルとランタイムを使うときは `player=` と `wasm=` で指定します。

中身は [WebGL・Web Components で使う](/ja/usage/webgl)の `SSSurface` の使い方を、入力ごとスクリプトに入れたものです。`SSSurface.initialize` にランタイムのバイト列を、`loadBuffer` にパックのバイト列を渡し、サーフェスは `autoStart: true` で作ります。

## バンドルが前提にしていること

- **テクスチャが `.ssab` の中にあること。** 広告は、オリジンが `null` になる sandbox 付きの iframe で配信されることがあります。そこでは別ファイルのテクスチャの読み込みはクロスオリジンの要求になり、サーバが CORS のヘッダを返さないと失敗します。広告の配信サーバがそれを返す保証はありません。埋め込み版の `.ssab` なら、ほかに何も読み込みません。
- **Content-Security-Policy が WebAssembly のコンパイルを許すこと。** 配信先のフレームが CSP を設定している場合、`script-src` に `'wasm-unsafe-eval'`（か `'unsafe-eval'`）が要ります。無いと `WebAssembly.compile` が例外を投げ、何も描画されません。
- **クリックを Exit API で受けること。** バンドルは Google の `exitapi.js` を読み込み、広告がクリックされると `ExitApi.exit()` を呼びます。遷移先はバンドルではなく、Google 広告の広告側で設定します。`ExitApi.exit()` の呼び出しが無いバンドルは、Validator がエラーにします。
- **HTML5 を入稿できるアカウントであること。** Google 広告が HTML5 広告を受け付けるのは、条件を満たすアカウントだけです（[About restricted ad formats and features](https://support.google.com/adspolicy/answer/9481382)）。

## サイズ

ディスプレイ広告の ZIP は 600 KB・40 ファイルまで（[Uploaded display ads specifications](https://support.google.com/google-ads/answer/1722096)）、アプリキャンペーンのプレイアブルは 5 MB までです（[About HTML5/Playable ads for App campaigns](https://support.google.com/google-ads/answer/9981650)）。そのうちプレイヤーとランタイムが約 210 KB を占めます。base64 でランタイムは 3 分の 1 増えますが、ZIP の圧縮でその大半が戻ります。Ringo（24 アニメーション・1024×512 のアトラス）を入れると、ZIP 全体で約 383 KB です。
