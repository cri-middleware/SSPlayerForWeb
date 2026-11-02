[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi-ui

PixiJS v8 のアプリで、**SpriteStudio** のアニメーションを [`@pixi/ui`](https://github.com/pixijs/ui) のボタンにします。`SSButton` は見た目が 1 つのアニメーションの `ButtonContainer` で、ホバー・押下・キーボードのフォーカス・`enabled = false` がそれぞれアニメーションの区間を再生します。ポインタを一部のパーツでだけ受けるようにもできます。

> **対象読者:** PixiJS v8 のアプリで、ボタン・メニュー項目・トグルを SpriteStudio のアニメーションで描きたい開発者です。**インストール:** `npm install @spritestudio/ssplayer-pixi-ui @pixi/ui pixi.js`（`@pixi/ui@^2.4` と `pixi.js@^8` は peer 依存）。`@spritestudio/ssplayer-pixi` を一緒に入れて再エクスポートするので、`SSPlayer` もここから使えます。**目的が違う場合:** → ボタンにせず再生するだけなら [ssplayer-pixi](../ssplayer-pixi/README.ja.md) をどうぞ。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/ui.html)** — Ringo で描いたボタンが 2 つ。片方は選んだパーツでだけポインタを受けます。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドは [UI ボタン](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi-ui) を参照してください。このバージョンの同じページ（英語の Markdown）がパッケージの `docs/` にあり（入口は `docs/README.md`）、Agent Skill として `skills/ssplayer-pixi-ui/` にもあります。

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

`prefers-reduced-motion` のときは各状態が区間の最初のフレームで止まり、アニメーションに `reduced_motion` ラベルがあれば `normal` だけは代わりにその区間を再生します。`accessibleTitle` を渡さなければ、スクリーンリーダーには装飾として扱われます。

**次に読む:** [UI ボタン](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi-ui) · [PixiJS ガイド](https://cri-middleware.github.io/SSPlayerForWeb/ja/usage/pixi)

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
