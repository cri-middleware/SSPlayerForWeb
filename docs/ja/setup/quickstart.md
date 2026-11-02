---
description: ssplayer-webgl または ssplayer-pixi で .ssab を再生する最小限のコードと、よくある落とし穴。
---

# クイックスタート

`.ssab` を再生する最小コードです。依存の要らない `ssplayer-webgl` と、
PixiJS v8 アプリ向けの `ssplayer-pixi` の両方を示します。使う環境に合う方を選んでください。

以下の import はバンドラー（Vite、webpack など）を使う前提です。バンドラーを使わない場合は CDN 版を使います。[WebGL](/ja/usage/webgl#without-a-bundler-cdn)、[PixiJS](/ja/usage/pixi#without-a-bundler-cdn) を参照してください。

::: tip SpriteStudio のデータが手元に無くても始められます
[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら[パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample)が手頃です。
:::

## ssplayer-webgl（依存なし）

もっとも手軽な方法は Web Component の `<ss-player>` です。JavaScript をほとんど書かずに再生できます。

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  // <ss-player> タグをブラウザに登録します
  defineSSPlayerElement();
</script>

<!-- src に ssab ファイル、animation に再生するアニメーション名を指定 -->
<ss-player
  src="/Ringo/Ringo.ssab"
  animation="run"
  autoplay
  style="width: 640px; height: 480px;">
</ss-player>
```

Canvas を自分で用意して制御したい場合は、`SSSurface` と、そこから作る `SSPlayer` を使います。

```ts
import { SSSurface } from '@spritestudio/ssplayer-webgl';

async function main() {
  // WASM ランタイムをアプリ全体で一度だけ初期化
  await SSSurface.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  const surface = new SSSurface(canvas, { autoStart: true });
  const player = surface.createPlayer();
  await player.load('/Ringo/Ringo.ssab');   // テクスチャは .ssab と同じディレクトリから読み込まれます
  player.setAnimation('run');    // loopCount の既定値は -1（無限ループ）
  player.setPlacement({});       // アニメーションのキャンバスをサーフェスに収めます
  player.play();
}

main().catch(console.error);
```

## ssplayer-pixi（PixiJS v8）

`SSPlayer` は PixiJS の `Container` を継承し、`Ticker.shared` から**自動更新**されます。ステージに追加して `play()` を呼ぶだけで、毎フレームの `update()` は不要です。

```ts
import { Application } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';

async function main() {
  // 1. WASM ランタイムをアプリ全体で一度だけ初期化
  await SSPlayer.initialize();

  const app = new Application();
  await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
  document.body.appendChild(app.canvas);

  // 2. プレイヤーを生成し、.ssab を読み込んでアニメーションを選択
  const player = new SSPlayer();
  await player.load('/Ringo/Ringo.ssab');   // テクスチャは .ssab と同じディレクトリから読み込まれます
  player.setAnimation('run');    // loopCount の既定値は -1（無限ループ）

  player.position.set(640, 730);   // Ringo の原点は足元
  app.stage.addChild(player);

  // 3. 再生開始
  player.play();
}

main().catch(console.error);
```

## つまずきやすい点

- **`initialize()` は一度だけ**：WASM ランタイムはアプリ起動時に 1 回初期化すれば十分です（`SSSurface.initialize()` / `SSPlayer.initialize()`）。
- **Pixi では `update()` を呼ばない**：`SSPlayer` は `Ticker.shared` に自動登録されます。
- **`.ssab` が無い**：`.sspj` からの変換は [アセットの準備](/ja/usage/assets) を参照してください。
- **テクスチャが表示されない**：テクスチャは `.ssab` と同じディレクトリから読み込まれます。テクスチャファイルを `.ssab` の隣に置くか、`--embedded` の `.ssab` を使ってください。

次は [基本的な再生](/ja/usage/basic) で再生制御 API を見ていきます。
