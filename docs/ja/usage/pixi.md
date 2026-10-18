---
description: PixiJS v8 で作られたアプリ向けのレンダラー。バッチ描画の Direct Drawing で多数のキャラクターをまとめて描画。
---

# PixiJS で使う

`@spritestudio/ssplayer-pixi` は、すでに **PixiJS v8** を採用しているアプリ向けのレンダラーです。**Direct Drawing（バッチ描画）** を使い、多数のキャラクターをまとめて描画します。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/pixi/" target="_blank" rel="noreferrer">ライブデモ</a>** —
PixiJS v8 アプリで複数のアニメを再生する例です。`.ssab` をドロップすれば手元のデータも再生できます。

🎨 **<a href="../../examples/override/" target="_blank" rel="noreferrer">パーツ上書きデモ</a>** —
同じレンダラーでパーツの色 / セル / 表示を実行時に差し替える例です（[パーツ制御](/ja/customize/part-overrides)）。

## インストール

```bash
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

`pixi.js@^8.19` は peer dependency です。

## ポイント

- `SSPlayer` は PixiJS の `Container` を継承します。`position` / `scale` /
  `eventMode` など通常の Pixi の API がそのまま使えます。
- `Ticker.shared` へ自動登録されるため、**毎フレームの `update()` は不要**です。
- 破棄は `player.destroy()` で行い、WASM 側リソースも解放されます。

最小コードは [クイックスタート](/ja/setup/quickstart)、再生制御は
[基本的な再生](/ja/usage/basic) を参照してください。自前の表示オブジェクト（武器・エフェクト・当たり判定など）を毎フレームパーツに追従させる方法は
[パーツトラッキング](/ja/customize/part-following) を参照してください。実行時に特定パーツの色・表示・セルを差し替えるには [パーツ制御](/ja/customize/part-overrides) を参照してください。
`SSPlayer` は WebGL 版と同じ上書きメソッドを持ち、停止中に上書きした場合は現在のフレームを描画し直します。

## 1 フレーム目のマスク

マスク / クリッピングパーツは renderer を使うオフスクリーンのパスで描かれますが、プレイヤーが renderer を受け取るのは最初に描画されたときです。それまでの 1 フレームは、マスクの対象のパーツを描かずにおき（マスクなしで描かれることはありません）、2 フレーム目から正しくマスクされます。1 フレーム目から正しくするには、読み込む前に renderer を渡します。

```ts
player.attachRenderer(app.renderer);
```

マスクを含まないアニメーションは、どちらでも同じに描かれます。

## ブレンドモードと背景

SpriteStudio の「背景を読み取る」ブレンドモード（Screen / Exclusion / Invert）は、実際のフレームバッファを読む固定機能 GPU ブレンドとして実装されています。つまり
`Application` の `backgroundColor` が合成対象の背景になります。詳細は
[シェーダーとブレンドモード](/ja/customize/shaders) を参照してください。

## バンドラーを使わない（CDN） {#without-a-bundler-cdn}

ブラウザーで直接読み込めるビルドも同梱しているので、CDN からそのまま使えます。**手でやることは 1 つだけ、`SSPlayer.initialize(wasmUrl)` で WASM バイナリの場所を教えることです。** ランタイムは別ファイルの `.wasm` で、バンドラーの外ではパスを自動で解決してくれるものがありません。

::: warning URL の組は書いてあるとおりにコピーする
`.wasm` とそれを読み込む JS は ABI を共有するので、`ssplayer-pixi` のバンドルと `ssplayer-core` の `.wasm` のどちらにも正確なバージョンを書きます。片方だけ `@latest` にすると食い違うことがあります。2 つのバージョンは一致するとは限りません（パッケージは別々にリリースされます）。書いてある組は必ず一緒に動きます。
:::

### クラシック `<script>` — グローバル `SSPixiPlayer`

`pixi.js` は peer dependency なので、先に Pixi 自身のグローバルビルドを読み込みます。プレイヤーのバンドルは `window.PIXI` を読みます。プレイヤーのクラスは `SSPixiPlayer.SSPlayer` です。

```html
<script src="https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-pixi@7.0.0-beta.1/dist/browser/ssplayer-pixi.browser.min.js"></script>
<script>
  const { SSPlayer } = SSPixiPlayer;
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm';

  (async () => {
    // WASM の URL を明示的に渡す（バンドラが無いので自動解決されない）。
    await SSPlayer.initialize(WASM_URL);

    const app = new PIXI.Application();
    await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
    document.body.appendChild(app.canvas);

    const player = new SSPlayer();
    await player.load('./Ringo.ssab');   // file:// ではなく http(s) で配信すること
    player.setAnimation('run');
    player.position.set(640, 730);   // Ringo の原点は足元
    app.stage.addChild(player);
    player.play();
  })();
</script>
```

### ESM を CDN から — `<script type="module">`

ビルドなしでネイティブモジュールを使う場合は、ESM の CDN（ここでは esm.sh）から import します。WASM の URL を渡すのは同じです。

```html
<script type="module">
  import { Application } from 'https://esm.sh/pixi.js@8';
  import { SSPlayer } from 'https://esm.sh/@spritestudio/ssplayer-pixi@7.0.0-beta.1';

  await SSPlayer.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const app = new Application();
  await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
  document.body.appendChild(app.canvas);

  const player = new SSPlayer();
  await player.load('./Ringo.ssab');
  player.setAnimation('run');
  player.position.set(640, 730);   // Ringo の原点は足元
  app.stage.addChild(player);
  player.play();
</script>
```

クラシック `<script>` 版の動くサンプルが [`examples/cdn/pixi.html`](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/examples/cdn/pixi.html) にあります。
