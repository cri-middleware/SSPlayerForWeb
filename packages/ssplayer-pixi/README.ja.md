[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi

**SpriteStudio** プレイヤー向けの PixiJS v8 レンダラー。Rust/WebAssembly コアが駆動する高性能な**ダイレクト描画**（バッチ化メッシュ）を提供します。

> **対象読者:** すでに PixiJS v8 でアプリを構築していて、SpriteStudio の `.ssab` アニメーションを組み込みたい開発者です。**インストール:** `npm install @spritestudio/ssplayer-pixi pixi.js`（`pixi.js@^8.19` を peer 依存として必要とします）**目的が違う場合:** → Pixi を使っていないなら [ssplayer-webgl](../ssplayer-webgl/README.ja.md)、自作レンダラーを組むなら [ssplayer-core](../ssplayer-core/README.ja.md) をどうぞ。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
`.ssab` を再生する PixiJS v8 アプリ。手元のファイルをドラッグ&ドロップして再生できます。

🎨 **[パーツ上書きデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** —
実行時にパーツ単位で色 / セル / 表示を上書きするサンプル（ソースは `examples/override-example`）。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドや完全なドキュメントについては [docs](https://cri-middleware.github.io/SSPlayerForWeb/ja/) を参照してください。このバージョンの同じページ（英語の Markdown）がパッケージの `docs/` にあり、オフラインで読めます（入口は `docs/README.md`）。同じページは Agent Skill として `skills/ssplayer-pixi/` にもあり、パッケージマネージャーでコーディングエージェントの skills ディレクトリにリンクする方法は [アシスタントに渡すドキュメント](https://cri-middleware.github.io/SpriteStudio-Docs/ja/ai/docs/#-agent-skill-として) にあります。

## ✨ なぜ PixiJS で SpriteStudio を使うのか？

- **描画は Pixi、アニメーションは SpriteStudio。** `AnimatedSprite` とスプライトシートの先——ボーン・メッシュ変形・パーティクル——に進むと、アニメーションシステムを自前で組むことになります。SpriteStudio は、お手持ちの PNG / WebP 素材にアーティストがその動きを作り込む専用の 2D エディタで、このプレイヤーは完成したアニメーションをそのままステージへ載せます。
- **キャラクター単体ではなく、シーン全体を。** キャラクター・背景・エフェクト・UI を 1 つのタイムラインで組み上げたカットシーンや全画面の演出が、1 つのアニメーションとしてステージに載ります。
- **ただの Pixi `Container`。** `SSPlayer` は `Ticker.shared` で自分から進むので、フレームごとの `update()` を書く必要はありません。描画は Pixi 自身のバッチ処理を通り、シーンの他の要素と一緒に描かれます。
- **タイムラインからゲームへのフック、パーツ上書き、モーションブレンド。** アーティストが置いたイベントがコールバック（`onUserData` / `onSignal` / `onAudio`）で届き、そのままゲームロジックにつなげられます。実行時のパーツ単位オーバーライド（色・セル・表示の差し替え）や、トラック間のクロスフェード・重ね合わせにも対応します。
- **どのリフレッシュレートでも滑らか。** **サブフレーム補間**（既定で有効）が各フレームを正確な表示時刻で描画するので、120 Hz 以上のディスプレイでもスローモーションでも動きが滑らかです。

## クイックスタート

**アプリで使う場合**はこのまま下へ。入れる → 変換する → 再生する、の順です。その先（イベント、パーツ単位の上書き、テクスチャ）も同じ道の続きで、[PixiJS ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi)にあります。**レンダラー自体を変更する場合**は下の[コントリビューター向け](#コントリビューター向け--ソースからビルド)、その後 [CONTRIBUTING.md](../../CONTRIBUTING.md) へ。

1. **導入**: `npm install @spritestudio/ssplayer-pixi pixi.js`。`pixi.js` v8 は peer dependency です。バンドラーを使わない場合は、どちらも CDN から読み込めます（[スニペット](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi#without-a-bundler-cdn)）。
2. **変換**: `.sspj`（SpriteStudio 7.6 以上）をブラウザ上の [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/) で変換します。プロジェクトのフォルダをドロップし、ダウンロードされた ZIP を、アプリがそのまま配信するフォルダ（Vite の `public/` など）に展開します。`.ssab` はテクスチャを隣から読み込みます。**Embedded Assets** にチェックを入れて変換すれば、テクスチャは `.ssab` の中に入ります（[アセットの準備](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/assets)）。

   ```
   public/
   └── Ringo/            ← ZIP の中のフォルダ
       ├── Ringo.ssab
       └── Ringo.png
   ```

3. **再生**: `SSPlayer` は `Ticker.shared` で自分を動かす Pixi の `Container` です。

   ```ts
   import { Application } from 'pixi.js';
   import { SSPlayer } from '@spritestudio/ssplayer-pixi';

   await SSPlayer.initialize();   // アプリ全体で一度

   const app = new Application();
   await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
   document.body.appendChild(app.canvas);

   const player = new SSPlayer();
   player.attachRenderer(app.renderer);   // 任意: 1 フレーム目からマスクを正しく
   await player.load('/Ringo/Ringo.ssab');      // テクスチャは .ssab と同じディレクトリから読み込まれる
   player.setAnimation('run');
   player.position.set(640, 730);         // Ringo の原点は足元
   app.stage.addChild(player);
   player.play();
   ```

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) が手頃です。

**次に読む:** [PixiJS ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi) · [基本的な再生](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/basic) ·
[制約と適用範囲](https://cri-middleware.github.io/SSPlayerForWeb/ja/limitations)

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

### ソースからのビルド

WASM バイナリは **git で管理されていません**。リポジトリのルートから、まず WASM を取得し、続いてパッケージをビルドします。

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

### 変更を試す

バンドルされた PixiJS のサンプルを実行して、レンダラーの動作を確認できます。ソースをカスタマイズしたり修正を検証したりする際に便利です。

```bash
pnpm run deploy-examples   # 初回のみ: SDK のサンプルプロジェクトを examples/*/public に変換（git 管理外）
cd examples/pixi-example
pnpm run dev             # start the dev server
```

（`pnpm run example` は、ここまでの手順もまとめて実行します。）

このサンプルは、ワークスペース参照を通じて**ビルド済み**パッケージを利用します。そのため、ここで `src/` を編集した後は、リポジトリのルートから `pnpm run build` を再実行してください。
