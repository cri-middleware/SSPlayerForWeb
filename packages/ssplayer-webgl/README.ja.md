[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-webgl

**[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** プレイヤー向けの、軽量で依存ゼロの **WebGL1/2** レンダラー。Rust/WebAssembly コアで駆動し、宣言的で JavaScript 不要な利用を可能にするドロップインの **`<ss-player>` カスタム要素** を備えています。SpriteStudio は、手持ちのイラストにボーン・メッシュ・エフェクトを付けて動かす 2D アニメーションツールです。

> **対象読者:** フレームワークを使わない Web 開発者 — SpriteStudio プレイヤーを任意のページに、`<ss-player>` という HTML タグ 1 つ、または `SSPlayer` の JS API で、ランタイム依存ゼロで組み込めます。**インストール:** `npm install @spritestudio/ssplayer-webgl`
> **目的が違う場合:** → [パッケージ表](../../README.ja.md#-どのパッケージを使うか) — すでに PixiJS や RPG ツクール MZ を使っていますか? それ専用のレンダラーがあります。

- 📖 **[ドキュメント](https://cri-middleware.github.io/SSPlayerForWeb/ja/)** — 環境ごとのガイド、API リファレンス、制約と適用範囲
- ▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — `<ss-player>` 要素をブラウザで動かせます。手元の `.ssab` をページにドラッグ&ドロップして再生することもできます
- 📦 **[リポジトリ](../../README.ja.md)** — SSPlayerForWeb monorepo。すべてのパッケージと、動かせるサンプル

## ✨ なぜ素の WebGL で SpriteStudio なのか?

- **アーティストが作ったアニメーションを、コードなしで。** 呼吸するキャラクター、髪の揺れ、斬撃や魔法のエフェクト——お手持ちの PNG / WebP 素材に、アーティストが専用の 2D エディタ（SpriteStudio）でボーン・メッシュ変形・パーティクルを付けて作り込みます。このプレイヤーは、書き出された `.ssab` を再生するだけです。
- **HTML タグ 1 つでも、JS から自在に制御しても。** `<ss-player src="chara.ssab" animation="idle" autoplay>` と書くだけで、ビルドステップも JavaScript もなしに再生できます。素の HTML でも、どのフレームワークの中でも動きます。コードからは `SSPlayer` クラスで同じレンダラーを操作でき、タイムラインのイベント通知、実行時のパーツ単位オーバーライド、アニメーション間のクロスフェードやトラック重ね合わせにも対応します。
- **バナー、スプラッシュ、カットインまで丸ごと。** キャラクター・背景・エフェクト・UI を 1 つのタイムラインで組み上げ、1 つの `.ssab` から 1 つのアニメーションとして再生します。
- **`<video>` より軽い代替に。** 自由に拡大縮小でき、シームレスにループし、入力に反応します。**サブフレーム補間**（既定で有効）により、クリップに焼き込まれたフレームレートではなく、ディスプレイのリフレッシュレートで描画します。
- **厳しい埋め込み枠にも収まる。** 依存ゼロで素の `<canvas>` に描画し、テクスチャを埋め込んだ自己完結の `.ssab` 1 ファイルで動きます。サイズが最優先なら、`SSOverlay`・共有テクスチャキャッシュ・オーディオアダプタを外した `./lite` ビルドが使えます。通常のビルドでも、オーディオアダプタは音を含むアニメーションのときだけ読み込まれます。

## クイックスタート

**アプリで使う場合**はこのまま下へ。入れる → 変換する → 再生する、の順です。その先（イベント、パーツ単位の上書き、テクスチャ）も同じ道の続きで、[WebGL ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/webgl)にあります。**レンダラー自体を変更する場合**は下の[コントリビューター向け](#コントリビューター向け--ソースからビルド)、その後 [CONTRIBUTING.md](../../CONTRIBUTING.md) へ。

1. **導入**: `npm install @spritestudio/ssplayer-webgl`。バンドラーを使わない場合は CDN から読み込めます（[スニペット](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/webgl#without-a-bundler-cdn)）。
2. **変換**: `.sspj`（SpriteStudio 7.6 以上）をブラウザ上の [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) で変換します。プロジェクトのフォルダをドロップし、ダウンロードされた ZIP を、アプリがそのまま配信するフォルダ（Vite の `public/` など）に展開します。`.ssab` はテクスチャを隣から読み込みます。**Embedded Assets** にチェックを入れて変換すれば、テクスチャは `.ssab` の中に入ります（[アセットの準備](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/assets)）。

   ```
   public/
   └── Ringo/            ← ZIP の中のフォルダ
       ├── Ringo.ssab
       └── Ringo.png
   ```

3. **再生**: `<ss-player>` 要素で再生するか、

   ```ts
   import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
   defineSSPlayerElement();   // <ss-player> タグを登録（アプリごとに一度）
   ```

   ```html
   <ss-player src="/Ringo/Ringo.ssab" animation="run" autoplay style="width:640px;height:480px"></ss-player>
   ```

   自前の Canvas にコードで描きます。

   ```ts
   import { SSSurface } from '@spritestudio/ssplayer-webgl';

   await SSSurface.initialize();   // アプリ全体で一度
   const surface = new SSSurface(document.querySelector('canvas')!, { autoStart: true });
   const player = surface.createPlayer();
   await player.load('/Ringo/Ringo.ssab');   // テクスチャは .ssab と同じディレクトリから読み込まれる
   player.setAnimation('run');
   player.setPlacement({});   // アニメーションのキャンバスをサーフェスに収める
   player.play();
   ```

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) が手頃です。自分のアニメーションを作るには SpriteStudio 本体を使います（[製品サイト](https://www.webtech.co.jp/spritestudio/)）。

**次に読む:** [WebGL ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/webgl) · [基本的な再生](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/basic) ·
[制約と適用範囲](https://cri-middleware.github.io/SSPlayerForWeb/ja/limitations)

このバージョンの同じページ（英語の Markdown）は、パッケージにも入っています。`docs/` はオフラインで読め（入口は `docs/README.md`）、`skills/ssplayer-webgl/` は Agent Skill です。パッケージマネージャーでコーディングエージェントの skills ディレクトリにリンクする方法は [アシスタントに渡すドキュメント](https://cri-middleware.github.io/SpriteStudio-Docs/ja/ai/docs/#-agent-skill-として) にあります。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

### ソースからのビルド

WASM バイナリは **git で管理されていません**。リポジトリのルートから WASM を取得し、その後にパッケージをビルドしてください:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

### 変更を試す

同梱の WebGL サンプルを実行して、レンダラー(および `<ss-player>` 要素)の動作を確認してください — ソースをカスタマイズしたり、修正を検証したりする際に便利です:

```bash
pnpm run deploy-examples   # 初回のみ: SDK のサンプルプロジェクトを examples/*/public に変換（git 管理外）
cd examples/webgl-example
pnpm run dev             # start the dev server
```

（`pnpm run example` は、ここまでの手順もまとめて実行します。）

サンプルはワークスペース参照を通じて **ビルド済み** のパッケージを利用するため、ここで `src/` を編集した後はリポジトリのルートから `pnpm run build` を再実行してください。
