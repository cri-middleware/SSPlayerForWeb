[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi-ui

PixiJS v8 のアプリで、**[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** のアニメーションを [`@pixi/ui`](https://github.com/pixijs/ui) のボタンにします。SpriteStudio は、手持ちのイラストにボーン・メッシュ・エフェクトを付けて動かす 2D アニメーションツールです。`SSButton` は見た目が 1 つのアニメーションの `ButtonContainer` で、ホバー・押下・キーボードのフォーカス・`enabled = false` がそれぞれアニメーションの区間を再生します。ポインタを一部のパーツでだけ受けるようにもできます。

> **対象読者:** PixiJS v8 のアプリで、ボタン・メニュー項目・トグルを SpriteStudio のアニメーションで描きたい開発者です。**インストール:** `npm install @spritestudio/ssplayer-pixi-ui @pixi/ui pixi.js`（`@pixi/ui@^2.4` と `pixi.js@^8.19` は peer 依存）。`@spritestudio/ssplayer-pixi` を一緒に入れて再エクスポートするので、`SSPlayer` もここから使えます。**目的が違う場合:** → ボタンにせず再生するだけなら [ssplayer-pixi](../ssplayer-pixi/README.ja.md) をどうぞ。

- 📖 **[UI ボタンのガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi-ui)** — 状態の作り方、絵の上でだけポインタを受ける方法、スクリーンリーダー。再生については[ドキュメント](https://cri-middleware.github.io/SSPlayerForWeb/ja/)のほかのページにあります
- ▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/ui.html)** — Ringo で描いたボタンが 2 つ。片方は選んだパーツでだけポインタを受けます
- 📦 **[リポジトリ](../../README.ja.md)** — SSPlayerForWeb monorepo。すべてのパッケージと、動かせるサンプル

## クイックスタート

1. **状態を作る**: 1 つのアニメーションに、状態と同じ名前のラベル（`normal`・`hover`・`pressed`・`disabled`・`focused`）を、その状態のループが始まるフレームに置きます。各状態は次のラベルの 1 フレーム手前まで流れます。ラベルの無い状態は別の状態に落ち（`pressed` は `hover` へ、ほかは `normal` へ）、ラベルが 1 つも無ければアニメーション全体を再生します。
2. **変換する**: ほかのアニメーションと同じく `.sspj` を変換します（[アセットの準備](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/assets)）。
3. **ボタンを作る**:

   ```ts
   import { Application } from 'pixi.js';
   import { SSButton, SSPlayer } from '@spritestudio/ssplayer-pixi-ui';

   await SSPlayer.initialize();   // アプリ全体で 1 回

   const app = new Application();
   await app.init({ width: 1280, height: 720 });
   document.body.appendChild(app.canvas);

   const start = new SSButton({ hitParts: ['face'], accessibleTitle: 'Start' });
   await start.player.load('/ui/start/start.ssab');
   start.position.set(640, 360);
   start.onPress.connect(() => console.log('start'));
   app.stage.addChild(start);
   ```

`prefers-reduced-motion` のときは各状態が区間の最初のフレームで止まり、アニメーションに `reduced_motion` ラベルがあれば、`normal` と `normal` に落ちてくる状態は代わりにその区間を再生します。`accessibleTitle` を渡さなければ、スクリーンリーダーには装飾として扱われます。

**次に読む:** [UI ボタン](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi-ui) · [PixiJS ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi)

このバージョンの同じページ（英語の Markdown）は、パッケージにも入っています。`docs/` はオフラインで読め（入口は `docs/README.md`）、`skills/ssplayer-pixi-ui/` は Agent Skill です。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

WASM を用意したあと（[ssplayer-pixi](../ssplayer-pixi/README.ja.md#ソースからのビルド) を参照）、リポジトリのルートから:

```bash
pnpm run build                                   # build all TS packages
pnpm --filter @spritestudio/ssplayer-pixi-ui test
pnpm run deploy-examples                         # 初回のみ: サンプルのアセット（git 管理外）
pnpm --filter pixi-example dev                   # then open /ui.html
```
