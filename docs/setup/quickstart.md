# クイックスタート

PixiJS v8 で `.ssab` を再生する最小コードです。`SSPlayer` は PixiJS の
`Container` を継承し、`Ticker.shared` から**自動更新**されます。ステージに
追加して `play()` を呼ぶだけで、毎フレームの `update()` は不要です。

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
  await player.load('/Ringo.ssab');   // 第 2 引数でテクスチャの assetBaseUrl を指定可
  await player.setAnimation('run');    // loop 既定値は -1（無限ループ）

  player.position.set(640, 480);
  app.stage.addChild(player);

  // 3. 再生開始
  player.play();
}

main().catch(console.error);
```

## つまずきやすい点

- **`initialize()` は一度だけ**：アプリ起動時に 1 回呼べば十分です。
- **`update()` は呼ばない**：`Ticker.shared` に自動登録されます。
- **`.ssab` が無い**：`.sspj` からの変換は [アセットの準備](/usage/assets) を参照。
- **テクスチャが表示されない**：`load(url, assetBaseUrl)` の第 2 引数でテクスチャ
  の基準 URL を確認してください。

次は [基本的な再生](/usage/basic) で再生制御 API を見ていきます。
