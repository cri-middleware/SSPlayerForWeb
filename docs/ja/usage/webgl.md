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
pnpm add @spritestudio/ssplayer-webgl
```

## ポイント

- **依存なし**: PixiJS などの外部ライブラリを必要とせず、単体で動作します。
- **Web Components 対応**: JavaScript を書かずに、HTML へ `<ss-player>` を記述するだけで利用できる Custom Element を内包しています。
- 描画と更新を自動で行う `SSSurface` と `SSPlayer`、独自のレンダリングループへ組み込める `SSWebGLRenderer` を提供します。

## エントリーポイント

3 つともツリーシェイク可能（`sideEffects: false`）なので、バンドルには import したものだけが入ります。

| Import | 内容 |
|---|---|
| `@spritestudio/ssplayer-webgl` | すべて。`SSOverlay`、共有テクスチャキャッシュ、音のあるパックのときだけ取得する Web Audio アダプターを含みます。 |
| `@spritestudio/ssplayer-webgl/lite` | 同じ `SSSurface`・`SSPlayer`・`SSWebGLRenderer` を、`SSOverlay`・`SSWebGLTextureCache`・`SSWebAudioManager` を除いて export します。 |
| `@spritestudio/ssplayer-webgl/element` | `<ss-player>` カスタム要素。 |

`/element` を import してもタグは登録されません（副作用になるため）。`defineSSPlayerElement()` を一度呼んでください。import しないアプリには含まれません。

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

`src`、`animation`、`speed-scale`、`fit`、`align`、`flip-x`、`flip-y` は変更に反応します。`hidden` 属性を持つ要素は表示されません。`standalone` の要素では `pause-when-hidden` が既定で有効で、キャンバスが画面外にある間やタブが裏にある間は再生を止め、`pause-when-hidden="false"` で止めずに動かし続けます。オーバーレイの要素は、要素が画面外にある間はつねに止まります。

**大きさとフィット。** アニメーションを合わせる箱は、パックを読み込んだときのアニメーションのオーサリング上のキャンバス(SpriteStudio で設定したキャンバスサイズ)です。`animation` を切り替えても箱は変わらないので、同じパックのアニメーション間でキャラクターの大きさは変わりません。ページが大きさを指定していない要素は、そのキャンバスと同じ大きさになります(キャンバスの 1 単位が CSS の 1px)。幅だけを指定した場合は、高さがキャンバスの縦横比で決まります。

読み込みの失敗 — 読み込めない `src`、パックに存在しない `animation`、起動しないランタイム — は要素の `error` イベント(`detail` がエラー)として発火され、`console.error` にも出力されます。

プレイヤーのイベントは要素の DOM `CustomEvent` として発火されるので、`addEventListener` で受け取れます。名前は `animationstarted`・`animationfinished`・`animationlooped`・`userdata`・`signal`・`audio`（中身は `detail`）で、ほかにパックの設定が済むと `load` が届きます。どれもプレイヤーの `onAnimationStarted`・`onUserData` などの名前を小文字にしたものです。

**オーバーレイか standalone か。** ブラウザはページが持てる WebGL コンテキストの数に上限を設けているため、既定ではすべての `<ss-player>` がページに重ねた **1 枚のオーバーレイキャンバス** を共有し、要素はアニメーションを描く箱でしかありません。これで何個並べても軽く済みますが、要素自身の CSS はアニメーションの形に影響しません。要素の `transform`、`filter`、`clip-path`、`border-radius` は届かず、重なり順も要素のものとは別です。`standalone` を付けると要素が自前のキャンバスを持ち、これらがすべて効きます。CSS の効果や不透明な背景、独自の重なり順が必要な要素向けの指定です。上の表のコンテキスト用オプションはこの専用コンテキストの設定なので、オーバーレイの要素には効きません。共有オーバーレイのオプションは `SSOverlay.getOrCreate('default', options)` で渡します（`SSOverlay` は `@spritestudio/ssplayer-webgl` から import できます）。最初の `<ss-player>` が接続する前に呼んでください。最初に接続した要素が、オプションなしでオーバーレイを作るためです。要素の `overlay="<id>"` 属性で別のオーバーレイを指定できますが、WebGL コンテキストが 1 つ増えます。

JavaScript から制御するには、`await el.ready` のあとで、要素の `play()`・`pause()`・`resume()`・`stop()`・`setAnimation(name)` を呼びます。[基本的な再生](/ja/usage/basic) にあるそれ以外の再生 API は、下層の `SSPlayer` である `el.player` にあります。

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

  // autoStart はサーフェスの描画ループを回します（アニメーションの再生は下の play()）。ほかのオプションは WebGL コンテキストの設定です
  const surface = new SSSurface(canvas, { autoStart: true });
  const player = surface.createPlayer();
  await player.load('/assets/Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // アニメーションのキャンバスをサーフェスに収めます
  player.play();
}

main().catch(console.error);
```

`SSSurface` には Canvas の代わりに既存の `WebGLRenderingContext` / `WebGL2RenderingContext` も渡せるので、自前のレンダラーが持つコンテキストに描けます。

### 箱に合わせる

プレイヤーは `box`(設定しなければサーフェス全体)に描きます。配置を設定しない間は、オーサリングされた大きさのまま、原点を箱の中心に置いて描きます。`setPlacement` を使うと、代わりに箱へ合わせて描き、箱が動いたりリサイズされたりしても合った状態を保ちます。

```ts
player.setPlacement({ fit: 'cover', align: 'bottom' }); // {} は contain と center
player.setTransform({ x: 8 });                          // フィットの後に加算。scale はフィットの倍率に掛かります
player.setPlacement(null);                              // オーサリングされた大きさに戻す
```

合わせる箱は、再生中のアニメーションのオーサリング上のキャンバスなので、アニメーションごとにそのキャンバスで合わせます。パック全体で 1 つの倍率にしたいときは、最初の `setAnimation` の後で `player.canvasRect` を一度読み、`frame` として渡します: `const frame = player.canvasRect; if (frame) player.setPlacement({ frame });`（`canvasRect` はアニメーションを設定するまで `null` です）。

## バンドラーを使わない（CDN） {#without-a-bundler-cdn}

ブラウザーで直接読み込めるビルドも同梱しているので、CDN からそのまま使えます。**手でやることは 1 つだけ、WASM バイナリの場所を教えることです。** ランタイムは別ファイルの `.wasm` で、バンドラーの外ではパスを自動で解決してくれるものがありません。

::: warning URL の組は書いてあるとおりにコピーする
`.wasm` とそれを読み込む JS は ABI を共有するので、どちらの URL にも正確なバージョンを書きます。片方だけ `@latest` にすると食い違うことがあります。2 つのバージョンは一致するとは限りません。パッケージは別々にリリースされるため、`ssplayer-webgl@7.0.1` が `ssplayer-core@7.0.0` と組むこともあります。下のスニペットはリリースのたびに公開したパッケージから書き換えているので、書いてある組は必ず一緒に動きます。
:::

### JavaScript を書かない `<ss-player>`

自己登録するバンドルを読み込むと `<ss-player>` がその場で定義され、マークアップだけでアニメーションが再生されます。クラシックな `<script>` はランタイムの場所を自分で見つけられないので、WASM の URL をページに 1 回だけ `data-wasm` で渡します。2 行まとめてコピーしてください。

```html
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ss-player.element.min.js"
        data-wasm="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm"></script>

<ss-player src="chara.ssab" animation="run"  autoplay style="width:640px;height:480px"></ss-player>
<ss-player src="boss.ssab"  animation="idle" autoplay style="width:640px;height:480px"></ss-player>
```

WASM の URL の渡し方は 3 通りあります。ランタイムはページごとに 1 回だけ起動し、最初に接続した `<ss-player>` が見つけた URL を使います。その要素自身の `wasm="…"` があればそれ、なければ 1 か 2 で決めたページの既定値です（後から呼んだ方が前のものを置き換えます）。あとから接続する要素は、`wasm` に何と書いてあっても起動済みのランタイムを使います。

1. **script タグの `data-wasm`** — ページの既定値を 1 回（上の例）。
2. **`SSWebGLPlayerElement.setSSPlayerWasmUrl(url)`** — ページの既定値を、要素が接続される前に JavaScript で 1 回。
3. **`<ss-player>` の `wasm="…"`** — その要素が最初に接続するときだけ、ページの既定値より優先されます。

渡し忘れると何も描画されませんが、黙ってはいません。コンソールに `[ss-player] WebAssembly runtime failed to initialise` と、必要な URL が出ます。バンドラーを使う場合はこのバンドルは要りません。`/element` を import して `defineSSPlayerElement()` を呼んでください。

### クラシック `<script>` — グローバル `SSWebGLPlayer`

先に読み込むピア依存はありません。サーフェスのクラスは `SSWebGLPlayer.SSSurface` です。

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ssplayer-webgl.browser.min.js"></script>
<script>
  const { SSSurface } = SSWebGLPlayer;
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm';

  (async () => {
    // WASM の URL を明示的に渡す（バンドラーが無いので自動解決されない）
    await SSSurface.initialize(WASM_URL);

    const surface = new SSSurface(document.getElementById('stage'), {
      autoStart: true,
      backgroundColor: 0x1a1a2e,
    });
    const player = surface.createPlayer();
    await player.load('./Ringo.ssab');   // file:// ではなく http(s) で配信する
    player.setAnimation('run');
    player.setPlacement({});   // アニメーションのキャンバスをサーフェスに収める
    player.play();
  })();
</script>
```

### ESM を CDN から — `<script type="module">`

ビルドなしでネイティブモジュールを使う場合は、ESM の CDN（ここでは esm.sh）から import します。WASM の URL を渡すのは同じです。

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script type="module">
  import { SSSurface } from 'https://esm.sh/@spritestudio/ssplayer-webgl@7.0.0-beta.1';

  await SSSurface.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const surface = new SSSurface(document.getElementById('stage'), { autoStart: true, backgroundColor: 0x1a1a2e });
  const player = surface.createPlayer();
  await player.load('./Ringo.ssab');
  player.setAnimation('run');
  player.setPlacement({});   // アニメーションのキャンバスをサーフェスに収める
  player.play();
</script>
```

`<ss-player>` 版とクラシック `<script>` 版の動くサンプルが [`examples/cdn`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/examples/cdn) にあります（`ss-player.html` と `webgl.html`）。
