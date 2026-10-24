---
description: SpriteStudio のアニメーションで描く @pixi/ui のボタン SSButton。ラベルで状態を再生し、パーツでポインタを受けます。
---

# UI ボタン（PixiJS）

`@spritestudio/ssplayer-pixi-ui` は、SpriteStudio のアニメーションを [`@pixi/ui`](https://github.com/pixijs/ui) のボタンにして、ボタンの状態（ホバー・押下・無効・フォーカス）を見せます。形が不規則なボタンでは、ポインタを絵の上でだけ受けるようにもできます。別のパッケージなので、アニメーションを再生するだけのアプリは何も負担しません。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/pixi/ui.html" target="_blank" rel="noreferrer">ライブデモ</a>** — Ringo で描いたボタンが 2 つ。片方は選んだパーツでだけポインタを受けます。

```bash
pnpm add @spritestudio/ssplayer-pixi-ui @pixi/ui pixi.js
```

`@pixi/ui@^2.4` と `pixi.js@^8.19` は peer dependency です。パッケージは `@spritestudio/ssplayer-pixi` を一緒に入れて再エクスポートするので、`SSPlayer` などもここから import できます。

```ts
import { SSButton, SSPlayer } from '@spritestudio/ssplayer-pixi-ui';

await SSPlayer.initialize();

const start = new SSButton({ hitParts: ['face'], accessibleTitle: 'Start' });
await start.player.load('/ui/start/start.ssab');
start.position.set(640, 360);
start.onPress.connect(() => startGame());
app.stage.addChild(start);
```

`SSButton` は `ButtonContainer` で、`enabled` とシグナル（`onPress`・`onDown`・`onUp`・`onUpOut`・`onOut`・`onHover`）は `@pixi/ui` のものです。`player` はボタンが作った `SSPlayer` で、ボタンの子です。自分の player を使うときは `player` に渡します。動かす・拡大する・回すのはボタンで、player ではありません。

## 状態を作る

1 つのアニメーションに、状態と同じ名前のラベル（`normal`・`hover`・`pressed`・`disabled`・`focused`。小文字で完全一致）を置きます。状態は、そのラベルのフレームから次のラベルの 1 フレーム手前まで（次が無ければアニメーションの終わりまで）をループ再生します。

| 起きていること | 再生するラベル | そのラベルが無いとき |
|---|---|---|
| 下のどれでもない | `normal` | アニメーション全体 |
| マウスが上にある | `hover` | `normal` |
| 押してから離すまで | `pressed` | `hover`、それも無ければ `normal` |
| `enabled = false` | `disabled` | `normal` |
| キーボードのフォーカス（Pixi のアクセシビリティ層を通る） | `focused` | `normal` |

いくつかが同時に成り立つときは 1 つを選びます。`disabled`、`pressed`、`hover`、`focused` の順で、どれでもなければ `normal` です。切り替えは即時で、新しい区間は最初のフレームから始まり、再生中だった区間は捨てます。タッチ画面にはホバーが無いので、離すと `normal` に戻ります。

ラベルを読むのは、ボタンが最初に状態を見せるときに player が選んでいるアニメーション、無ければパックの最初のアニメーションです。別のアニメーションは `animation` で指定します。

## 手持ちのアニメーションを使う

`clips` は状態のラベルを差し替えます。その状態に落ちてくる状態にも効きます。

```ts
new SSButton({
  clips: {
    normal: { animation: 'idle' },                // アニメーション全体
    hover: { label: 'over' },                     // 同じアニメーションのラベル
    pressed: { animation: 'push', label: 'down' }, // 別のアニメーションのラベル
  },
});
```

clip で指定した区間も、次のラベルの 1 フレーム手前までです。パックに無いアニメーションやラベルを指す clip は、コンソールに 1 度だけ知らせ、その状態は clip が無いものとして再生します。

## 動きを減らす

`reducedMotion` は、設定しなければプラットフォームの `prefers-reduced-motion` に従います。有効な間は、各状態が区間の最初のフレームで止まり、ユーザーデータ・シグナル・サウンドのイベントは出ません。

アニメーションに `reduced_motion` ラベルがあれば、`normal`（と `normal` に落ちてくる状態）だけは代わりにその区間をループ再生し、イベントも出します。止まった待機の代わりに、穏やかな待機を見せられます。

## ポインタを絵の上でだけ受ける

`hitParts` を渡さなければ、ボタンは再生しているアニメーションのキャンバス全体でポインタを受けます（反転とオフセットを含みます）。`hitParts` は名前を挙げたパーツ（名前かインデックス）に絞り、`hitParts` が無いときの `hitOnArtwork` は player が描く全パーツに絞ります。どちらもいつでも変えられます。

```ts
start.hitParts = ['face', 'ribbon'];
```

パーツの範囲は描いた輪郭です（[パーツの輪郭](/ja/customize/part-following#a-parts-outline) を参照）。ボタンは `hitArea` で答えるので、カーソルが手の形になるのはそのパーツの上だけで、絵の周りのポインタはボタンの後ろにあるものに届きます。絞るのはポインタだけで、キーボードのフォーカスとスクリーンリーダーはこれまでどおりボタンに届きます。

## スクリーンリーダー

`accessibleTitle` も `accessibleHint` も渡さなければ、ボタンは装飾です。`accessible` にならず、スクリーンリーダーからは見えません。どちらかを渡すと `accessible` になり、Pixi のアクセシビリティ層が、その title か `aria-label` を持つ `<button>` を canvas の上に重ねます。位置はボタンがポインタを受ける範囲です。`Tab` でこの層が有効になってボタンの間をフォーカスが移り、`Enter` でフォーカスのあるボタンを押すと `onPress` が出ます。フォーカスは専用のイベントで届くので、`focused` は `hover` と区別して見せます。無効にしてから有効に戻したボタンも、持っていたフォーカスを保ちます。

Pixi は既定で、マウスが動いた時点でこの層を外し（`deactivateOnMouseMove`）、フォーカスもそこで外れます。マウスを使っている間もフォーカスを保つには、これを止め、層の要素がポインタを受けないようにします。こうするとボタンは引き続きパーツでポインタを受けます。

```ts
await app.init({ accessibilityOptions: { deactivateOnMouseMove: false } });
const start = new SSButton({ accessibleTitle: 'Start', accessiblePointerEvents: 'none' });
```

## player について

ボタンは player の再生を引き受けます。アニメーションの選択、区間とループ回数の設定、再生と停止はボタンが行います。ボタンごとに別の player を使ってください。player はいつもどおり読み込みます。ボタンは、パックが入った次の tick と、player が別のパックを読み込んだあとに、状態を見せます。

`SSUiStateDriver` はボタンを使わずに同じ規則を当てるもので、独自のホストに置いた player に使えます。

```ts
import { SSUiStateDriver, uiStateOf } from '@spritestudio/ssplayer-pixi-ui';

const driver = new SSUiStateDriver(player, { clips });
driver.show(uiStateOf({ hovered: true }));
driver.show('normal', true); // 動きを減らすとき
```

## 関連

- [パーツトラッキング](/ja/customize/part-following) — 当たり判定が使う輪郭と、その隣の変換
- [基本的な再生](/ja/usage/basic) — フレームとラベルで指定する再生区間
- [PixiJS で使う](/ja/usage/pixi) — ボタンを描く player
