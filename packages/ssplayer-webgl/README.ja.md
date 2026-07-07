[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-webgl

**SpriteStudio 7** プレイヤー向けの、軽量で依存ゼロの **WebGL1/2** レンダラー。Rust/WebAssembly コアで駆動し、宣言的で JavaScript 不要な利用を可能にするドロップインの **`<ss-player>` カスタム要素** を備えています。

[SSPlayerForWeb](../../README.ja.md) モノレポの一部です。ガイドや完全なドキュメントについては [docs](../../docs/) を参照してください。

## ✨ なぜ素の WebGL で SpriteStudio なのか?

- **HTML タグ 1 つでドロップイン。** 組み込みの **`<ss-player>` カスタム要素** は
  `.ssab` を宣言的に再生します — `<ss-player src="chara.ssab"
  animation="idle" autoplay>` — ビルドステップも JavaScript も不要で、どんな
  フレームワークでも素の HTML でも動作します。コードを書きたい場合は、`SSCanvasPlayer`
  クラスが同じレンダラーに対する完全な命令的コントロールを提供します。
- **キャラクターだけでなく、シーン全体を。** SpriteStudio はキャラクター、背景、
  エフェクト、UI を単一のタイムライン上に合成するため、1 つの `.ssab` が完結した
  アニメーション作品になり得ます — 単一のスプライトではなく、完全なバナー、
  スプラッシュ、カットインです。
- **エンジンを同梱できない(したくない)ときに。** 埋め込み可能なウィジェット、
  ランディングページのヒーロー、あるいは厳しいバイト予算のあらゆる配置 — フル
  フレームワークを引き込むには重すぎ、さもなければ WebGL アニメーションシステムを
  自作するか、動画にフォールバックするしかない場面です。エディターで作り込んだ
  ボーン / メッシュ / パーティクルアニメーションを **依存ゼロ** かつ極小の
  フットプリントで、素の `<canvas>` に描画します。
- **`<video>` よりも軽く、そしてより滑らか。** 実行時に自由にスケールし、
  シームレスにループし、入力に反応します — 固定サイズのクリップがただ再生される
  のとは違います。しかも再生は **サブフレーム補間** される(デフォルトで有効)ため、
  モーションはディスプレイの正確なリフレッシュレートで描画されます — 固定フレーム
  レートで焼き込まれたクリップのようなカクつきがありません。
- **使った分だけ。** ツリーシェイク可能なエントリーポイント: `./lite` ビルドは
  サイズが予算となる場面で最も小さなバンドルのために Normal + blend に絞り込み、
  オーディオアダプターはサウンドを含むアニメーションが設定されたときにのみ読み込まれます。

これらを合わせると、まさに **最も厳しくサンドボックス化された埋め込み枠** が求める
ものになります — 依存ゼロ、自己完結した単一の `.ssab`(embedded)、1 つのドロップイン
HTML タグ、そしてバイト予算に収まる `./lite` ビルド — これによって、より重い
プレイヤーでは収まらない、サイズやサンドボックスの制約がある配置にもフィットします。

## クイックスタート

```ts
import { SSCanvasPlayer } from '@spritestudio/ssplayer-webgl';

// 1. Load the WASM runtime once for the whole app.
await SSCanvasPlayer.initialize();

// 2. Create a player on a canvas, load a .ssab, and pick an animation.
const canvas = document.querySelector('canvas')!;
const player = new SSCanvasPlayer(canvas, {
  maxDPR: 2,                 // cap devicePixelRatio for fill-rate control
  powerPreference: 'low-power',
  pauseWhenHidden: true,     // pause when the tab/element is not visible
  backgroundColor: 0x1a1a2e, // opaque backdrop; omit for a transparent canvas
});

await player.load('/Ringo.ssab');   // optional 2nd arg: assetBaseUrl for textures
await player.setAnimation('run');

player.play();                       // drives itself via requestAnimationFrame
```

`SSCanvasPlayer` はターゲットとして `HTMLCanvasElement` または既存の `WebGL(2)RenderingContext` のいずれかを受け付けるため、独自のレンダラーとコンテキストを共有できます。

> **参照 ssab と 埋め込み(embedded) ssab の両方が動作します。** `load()`(および
> 要素の `src`)はどちらのバリアントも受け付けます。`--embedded` ssab はインライン化
> されたテクスチャから描画され、兄弟ファイルのフェッチは発生しません — アニメーション
> 全体が自己完結の単一リクエストとして読み込まれます。`examples/webgl-example` で
> 両方に対して検証済みです。

## エントリーポイント

必要なものだけをインポートしてください — 3 つすべてがツリーシェイク可能です(`sideEffects: false`):

| Import | 内容 |
|---|---|
| `@spritestudio/ssplayer-webgl` | フルレンダラー: すべてのブレンドモード + 遅延ロードされる Web Audio アダプター。 |
| `@spritestudio/ssplayer-webgl/lite` | 最小構成のビルド — **Normal + blend のみ**、特殊なブレンドモードなし、最小のバンドル。 |
| `@spritestudio/ssplayer-webgl/element` | `<ss-player>` カスタム要素(下記参照)。 |

## `<ss-player>` Web Component

`SSCanvasPlayer` の薄い宣言的なラッパーです。自動登録は **されません**(`sideEffects: false` を保つため)ので、`defineSSPlayerElement()` を一度呼び出してタグを登録してください。

```ts
import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
defineSSPlayerElement();
```

```html
<ss-player src="chara.ssab" animation="idle" autoplay
           max-dpr="2" power-preference="low-power"
           style="width:320px;height:480px"></ss-player>
```

インライン / `ArrayBuffer` アセットの場合(属性はバッファを運べません)、命令的に駆動してください:

```ts
const el = document.querySelector('ss-player')!;
await el.ready;
await el.loadBuffer(ssabArrayBuffer, new Map([[0x1234abcd, imageBitmap]]));
el.play();
```

監視される属性(`src`、`animation`、`speed`)はライブで反応します。構築時のオプション(`max-dpr`、`power-preference`、`antialias`、`stencil`、`pause-when-hidden`)は接続時に一度だけ読み取られます。プレイヤーのイベントは DOM の `CustomEvent` として再ディスパッチされます。

## 再生とイベント

`SSCanvasPlayer` は他のレンダラーと同じファサードを公開します:

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

// Timeline events — each subscription returns an unsubscribe function.
const off = player.onUserData((e) => console.log('userData', e.partName));
player.onSignal((e) => console.log('signal', e.commandId));
player.onAudio((e) => console.log('audio', e.soundName));  // notification hook — audio plays by default (see below)
player.onAnimationEnd(() => {});
player.onAnimationLoop(() => {});
off();
```

サウンドは「そのまま動きます」: 読み込んだ `.ssab` がオーディオを参照しており、`audioManager` が設定されていない場合、デフォルトの `SSWebAudioManager` が遅延インポートされて接続されます(必要なときにのみフェッチされる別チャンク)。完全に手動でコントロールするには `autoAudio: false` を設定してください。

> **加算系ブレンドモードに関する注意:** 加算 / バックドロップ参照モード(Add、Screen、Mul、…)はフレームバッファに対して合成されるため、アニメーションがそれらを使用する場合は不透明な `backgroundColor` を設定してください。透明なキャンバス上では、黒地に焼き込まれたグローが不透明なブロックとして描画されることがあります — これは乗算済みアルファ合成に固有の挙動です。

## ソースからのビルド

WASM バイナリは **git で管理されていません**。リポジトリのルートから WASM を取得し、
その後にパッケージをビルドしてください:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

## 変更を試す

同梱の WebGL サンプルを実行して、レンダラー(および `<ss-player>` 要素)の動作を
確認してください — ソースをカスタマイズしたり、修正を検証したりする際に便利です:

```bash
cd examples/webgl-example
pnpm run dev             # start the dev server
```

サンプルはワークスペース参照を通じて **ビルド済み** のパッケージを利用するため、
ここで `src/` を編集した後はリポジトリのルートから `pnpm run build` を再実行してください。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。
