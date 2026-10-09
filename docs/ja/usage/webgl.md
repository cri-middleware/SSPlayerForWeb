---
description: エンジンに依存しない単体の WebGL レンダラー。ss-player Web Component として、または SSSurface と SSPlayer を直接使う方法。
---

# WebGL・Web Components で使う

`@spritestudio/ssplayer-webgl` は、外部のレンダリングエンジン（PixiJS など）に依存しない単体の WebGL 1/2 レンダラーです。依存関係やファイルサイズを抑えたい構成に向いており、広告バナーやシンプルな Web ページにそのまま組み込めます。フレームワークを使わないドロップイン用途を想定しています。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/webgl/" target="_blank" rel="noreferrer">ライブデモ</a>** —
フレームワークなしのページで `<ss-player>` を動かす例です。`.ssab` をドロップすれば手元のデータも再生できます。

## インストール

npm で公開されています。

```bash
pnpm add @spritestudio/ssplayer-webgl@beta
```

## ポイント

- **依存なし**: PixiJS や Three.js などの外部ライブラリを必要とせず、単体で動作します。
- **Web Components 対応**: JavaScript を書かずに、HTML へ `<ss-player>` を記述するだけで利用できる Custom Element を内包しています。
- 描画と更新を自動で行う `SSSurface` と `SSPlayer`、独自のレンダリングループへ組み込める `SSWebGLRenderer` を提供します。

## Web Components (`<ss-player>`) の使い方

もっとも手軽な利用方法は Custom Element です。

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  // <ss-player> タグをブラウザに登録します
  defineSSPlayerElement();
</script>

<!-- src に ssab ファイル、animation に再生するアニメーション名を指定 -->
<ss-player 
  src="/assets/Ringo.ssab" 
  animation="run" 
  autoplay 
  speed-scale="1.0" 
  style="width: 640px; height: 480px;">
</ss-player>
```

### 属性

| 属性 | |
|---|---|
| `src` | 読み込む `.ssab`。もう一度設定すると別のパックを読み込みます。 |
| `animation` | 開始するアニメーション。省略するとパックの先頭のものです。 |
| `autoplay` | アニメーションを設定したらすぐに再生します。省略すると最初のフレームで止まったままです。 |
| `speed-scale` | 再生速度を、オーサリングされた速度の倍率で指定します。 |
| `fit` | アニメーションを要素の箱に合わせる拡縮の方法。`contain`(既定)、`cover`、`none`。`none` はオーサリングされた大きさのまま、原点を箱の中心に置いて描きます。 |
| `align` | アニメーションのキャンバスのどの点を、箱の対応する点に置くか。`center`(既定)、`top`、`bottom`、`left`、`right`、`top-left`、`top-right`、`bottom-left`、`bottom-right`。 |
| `flip-x`、`flip-y` | アニメーションを反転します。`align` は反転に追従します。 |
| `standalone` | 要素自身のキャンバスと WebGL コンテキストに描画します。下記を参照してください。 |
| `max-dpr`、`power-preference`、`antialias`、`background`、`pause-when-hidden` | `standalone` の要素のコンテキストを設定します。接続時に一度だけ読み取られます。 |

`src`、`animation`、`speed-scale`、`fit`、`align`、`flip-x`、`flip-y` は変更に反応します。`hidden` 属性を持つ要素は表示されません。

**大きさとフィット。** アニメーションを合わせる箱は、パックを読み込んだときのアニメーションのオーサリング上のキャンバス(SpriteStudio で設定したキャンバスサイズ)です。`animation` を切り替えても箱は変わらないので、同じパックのアニメーション間でキャラクターの大きさは変わりません。ページが大きさを指定していない要素は、そのキャンバスと同じ大きさになります(キャンバスの 1 単位が CSS の 1px)。幅だけを指定した場合は、高さがキャンバスの縦横比で決まります。

読み込みの失敗 — 読み込めない `src`、パックに存在しない `animation`、起動しないランタイム — は要素の `error` イベント(`detail` がエラー)として発火され、`console.error` にも出力されます。

**オーバーレイか standalone か。** ブラウザはページが持てる WebGL コンテキストの数に上限を設けているため、既定ではすべての `<ss-player>` がページに重ねた **1 枚のオーバーレイキャンバス** を共有し、要素はアニメーションを描く箱でしかありません。これで何個並べても軽く済みますが、要素自身の CSS はアニメーションの形に影響しません。要素の `transform`、`filter`、`clip-path`、`border-radius` は届かず、重なり順も要素のものとは別です。`standalone` を付けると要素が自前のキャンバスを持ち、これらがすべて効きます。CSS の効果や不透明な背景、独自の重なり順が必要な要素向けの指定です。上の表のコンテキスト用オプションはこの専用コンテキストの設定なので、オーバーレイの要素には効きません。共有オーバーレイのオプションは `SSOverlay.getOrCreate(id, options)` で渡します。

JavaScript から制御する場合は、対象の DOM 要素を取得して `play()` や `stop()` を呼び出します。詳細な API は [基本的な再生](/ja/usage/basic) を参照してください。

この要素は意図的に再生系の動詞だけを持つ薄い皮です。それ以外 — パーツ単位の上書きを含む — は、下層の `SSPlayer` である `el.player` 経由で呼び出します:

```js
const el = document.querySelector('ss-player');
await el.ready;
el.player.setPartColorOverride('apple', 0x0033ffbf);
```

パーツ変換の読み出しも同じ経路です。このプレイヤーはシーングラフを持たないため、パーツへの追従は `onFrame()` から `el.player.getPartTransform()` を読んで自前の要素を配置する形になります。詳しくは [パーツトラッキング](/ja/customize/part-following) を参照してください。

## SSSurface と SSPlayer を直接使う場合

TypeScript / JavaScript から直接 Canvas を指定して初期化することもできます。

```ts
import { SSSurface } from '@spritestudio/ssplayer-webgl';

async function main() {
  await SSSurface.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  document.body.appendChild(canvas);

  // オプションで自動再生や WebGL コンテキストの設定が可能です
  const surface = new SSSurface(canvas, { autoStart: true });
  const player = surface.createPlayer();
  await player.load('/assets/Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // アニメーションのキャンバスをサーフェスに収めます
  player.play();
}

main().catch(console.error);
```

### 箱に合わせる

プレイヤーは `box`(設定しなければサーフェス全体)に描きます。配置を設定しない間は、オーサリングされた大きさのまま、原点を箱の中心に置いて描きます。`setPlacement` を使うと、代わりに箱へ合わせて描き、箱が動いたりリサイズされたりしても合った状態を保ちます。

```ts
player.setPlacement({ fit: 'cover', align: 'bottom' }); // {} は contain と center
player.setTransform({ x: 8 });                          // フィットの後に加算。scale はフィットの倍率に掛かります
player.setPlacement(null);                              // オーサリングされた大きさに戻す
```

合わせる箱は、再生中のアニメーションのオーサリング上のキャンバスなので、アニメーションごとにそのキャンバスで合わせます。パック全体で 1 つの倍率にしたいときは、最初の `setAnimation` の後で `player.canvasRect` を一度読み、`frame` として渡します: `player.setPlacement({ frame: player.canvasRect })`。
