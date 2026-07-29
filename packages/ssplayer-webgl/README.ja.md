[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-webgl

**SpriteStudio 7** プレイヤー向けの、軽量で依存ゼロの **WebGL1/2** レンダラー。Rust/WebAssembly コアで駆動し、宣言的で JavaScript 不要な利用を可能にするドロップインの **`<ss-player>` カスタム要素** を備えています。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドや完全なドキュメントについては [docs](../../docs/) を参照してください。

> **対象読者:** フレームワークを使わない Web 開発者 — SpriteStudio プレイヤーを任意のページに、`<ss-player>` という HTML タグ 1 つ、または `SSPlayer` の JS API で、ランタイム依存ゼロで組み込めます。
> **インストール:** `npm install @spritestudio/ssplayer-webgl@beta`
> **目的が違う場合:** → [パッケージ表](../../README.ja.md#-どのパッケージを使うか) — すでに PixiJS や RPG ツクール MZ を使っていますか? それ専用のレンダラーがあります。

> **beta ライン。** 7.0.0 が prerelease の間は `beta` dist-tag にのみ publish されるため、上記の `@beta` は必須です。7.0.0 が `latest` に出れば不要になります。

## ✨ なぜ素の WebGL で SpriteStudio なのか?

- **HTML タグ 1 つでドロップイン。** 組み込みの **`<ss-player>` カスタム要素** は
  `.ssab` を宣言的に再生します — `<ss-player src="chara.ssab"
  animation="idle" autoplay>` — ビルドステップも JavaScript も不要で、どんな
  フレームワークでも素の HTML でも動作します。コードを書きたい場合は、`SSPlayer`
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

## 使い方

使い方は 2 通り — どちらかを選んでください。いずれの場合も、同じ[タイムラインイベント](#再生とイベント)
が利用できます。JS API では直接購読し、`<ss-player>` 要素はそれらを DOM の
`CustomEvent` として再ディスパッチします。

### ドロップイン — `<ss-player>` Web Component(JS ほぼ不要)

ページに載せる最速の方法: `SSPlayer` をラップした宣言的なカスタム要素です。
タグを一度登録すれば、あとは HTML のどこでも使えます。

```ts
import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
defineSSPlayerElement();   // <ss-player> タグを登録(アプリごとに一度)
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

`pause-when-hidden` は **既定で有効** です(キャンバスが画面外にある間やタブが非アクティブな間はティッカーを停止します)。無効にするには `pause-when-hidden="false"` を指定してください。

> **なぜ `defineSSPlayerElement()` を自分で呼ぶのか?** この要素はインポート時に
> 意図的に **自動登録されません**。これにより、パッケージの `sideEffects: false`
> というツリーシェイク契約が保たれます([エントリーポイント](#エントリーポイント)参照)。
> 一度呼べばタグが登録され、インポートしなければバンドルから取り除かれます。

### コード駆動 — `SSPlayer`(JS API)

完全な命令的コントロールが必要ですか? `SSPlayer` クラスを `<canvas>` に対して直接使用してください。

```ts
import { SSSurface } from '@spritestudio/ssplayer-webgl';

// 1. Load the WASM runtime once for the whole app.
await SSSurface.initialize();

// 2. Create a player on a canvas, load a .ssab, and pick an animation.
const canvas = document.querySelector('canvas')!;
const surface = new SSSurface(canvas, {
  maxDPR: 2,                 // cap devicePixelRatio for fill-rate control
  powerPreference: 'low-power',
  pauseWhenHidden: true,     // pause when the tab/element is not visible
  backgroundColor: 0x1a1a2e, // opaque backdrop; omit for a transparent canvas
});
const player = surface.createPlayer();

await player.load('/Ringo.ssab');   // textures load from the .ssab's own directory
await player.setAnimation('run');

player.play();                       // drives itself via requestAnimationFrame
```

`SSPlayer` はターゲットとして `HTMLCanvasElement` または既存の `WebGL(2)RenderingContext` のいずれかを受け付けるため、独自のレンダラーとコンテキストを共有できます。

> **参照 ssab と 埋め込み(embedded) ssab の両方が動作します。** `load()`(および
> 要素の `src`)はどちらのバリアントも受け付けます。`--embedded` ssab はインライン化
> されたテクスチャから描画され、兄弟ファイルのフェッチは発生しません — アニメーション
> 全体が自己完結の単一リクエストとして読み込まれます。`examples/webgl-example` で
> 両方に対して検証済みです。

## CDN から使う（ビルド不要）

本パッケージはゼロ依存のブラウザ直読み用ビルドを同梱しており、CDN からそのまま読み込め
ます。**手動でやることは1つだけ — WASM バイナリの場所を明示する**ことです。ランタイムは
別ファイルの `.wasm` で、バンドラの外（クラシックな `<script>` や CDN 経由）ではバンドラが
行う自動パス解決が効きません。そのため URL を `SSSurface.initialize(wasm)` に渡して
ください。

> **URL のペアは下記スニペットからそのままコピーし、手で組み立てないでください。**
> `.wasm` と JS グルーは ABI を共有するため、両方の URL で正確なバージョンを指定する
> 必要があります（片方だけ `@latest` にすると不整合が起こり得ます）。2つのバージョンは
> **一致するとは限りません** — パッケージは独立してリリースされるため、
> `ssplayer-webgl@7.0.1` が `ssplayer-core@7.0.0` と組むこともあります。本ドキュメントの
> スニペットはリリースのたびに実際のマニフェストから書き換えられる
> （`scripts/sync-doc-versions.mjs`）ので、記載のペアは常に有効な組み合わせです。
> URL が未指定・到達不能な場合はプレイヤーが明示的なエラーをログに出し、
> `<ss-player>` は描画されません。

### 宣言的 `<ss-player>` 要素 — JS 不要

最も直接的な方法です。自己登録する専用バンドルを読み込むと `<ss-player>` カスタム要素が
その場で定義され、マークアップだけでアニメーションが再生されます。クラシックな
`<script>` ではランタイムを自動解決できないため、WASM の URL は **ページに1回だけ**
`data-wasm`(script タグ)で指定します — 各 `<ss-player>` は省略できます。2行まとめて
コピーしてください（2つのバージョンは独立しており、一致するとは限りません）。

```html
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ss-player.element.min.js"
        data-wasm="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm"></script>

<ss-player src="chara.ssab" animation="run"  autoplay style="width:640px;height:480px"></ss-player>
<ss-player src="boss.ssab"  animation="idle" autoplay style="width:640px;height:480px"></ss-player>
```

WASM URL の指定方法は3通り（要素ごとに最初に見つかったものが優先）:

1. **script タグの `data-wasm`** — ページに1回（上記）。JS 不要。
2. **`SSWebGLPlayerElement.setSSPlayerWasmUrl(url)`** — 要素が接続される前に JS で1回。
3. **個々の `<ss-player>` の `wasm="…"`** — その要素だけ既定値を上書き。

指定を忘れると描画されませんが、無言ではありません。console に
`[ss-player] WebAssembly runtime failed to initialise` と、渡すべき URL を示す
メッセージが出ます。

> ビルドツールを使う場合はこのバンドルは不要です — `import { defineSSPlayerElement }
> from '@spritestudio/ssplayer-webgl/element'` して呼び出してください（tree-shaking 維持）。
> [エントリーポイント](#エントリーポイント)を参照。

### クラシック `<script>` — グローバル `SSWebGLPlayer`

先に読み込むピア依存はありません。プレイヤークラスは `SSWebGLPlayer.SSSurface` です。

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ssplayer-webgl.browser.min.js"></script>
<script>
  const { SSSurface } = SSWebGLPlayer;
  const WASM_URL = 'https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm';

  (async () => {
    // WASM の URL を明示的に渡す（バンドラが無いので自動解決されない）。
    await SSSurface.initialize(WASM_URL);

    const surface = new SSSurface(document.getElementById('stage'), {
      backgroundColor: 0x1a1a2e,
    });
    const player = surface.createPlayer();
    await player.load('./Ringo.ssab');   // file:// ではなく http(s) で配信すること
    await player.setAnimation('run');
    player.play();
  })();
</script>
```

### ESM を CDN から — `<script type="module">`

ビルド無しでネイティブモジュールを使いたい場合は ESM CDN（下記は esm.sh）から import
します。ルールは同じで、WASM の URL を明示的に渡します。

```html
<canvas id="stage" width="1280" height="960"></canvas>
<script type="module">
  import { SSSurface } from 'https://esm.sh/@spritestudio/ssplayer-webgl@7.0.0-beta.1';

  await SSSurface.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');

  const surface = new SSSurface(document.getElementById('stage'), { backgroundColor: 0x1a1a2e });
  const player = surface.createPlayer();
  await player.load('./Ringo.ssab');
  await player.setAnimation('run');
  player.play();
</script>
```

両方の実行可能なサンプルが [`examples/cdn`](../../examples/cdn/) にあります。

## エントリーポイント

必要なものだけをインポートしてください — 3 つすべてがツリーシェイク可能です(`sideEffects: false`):

| Import | 内容 |
|---|---|
| `@spritestudio/ssplayer-webgl` | フルレンダラー: すべてのブレンドモード + 遅延ロードされる Web Audio アダプター。 |
| `@spritestudio/ssplayer-webgl/lite` | 最小構成のビルド — **Normal + blend のみ**、特殊なブレンドモードなし、最小のバンドル。 |
| `@spritestudio/ssplayer-webgl/element` | `<ss-player>` カスタム要素([ドロップイン](#ドロップイン--ss-player-web-componentjs-ほぼ不要)参照)。 |

## 再生とイベント

タイムラインイベントは上記の **両方** の使い方に適用されます。`SSPlayer` は他のレンダラーと同じファサードを公開します:

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

`<ss-player>` 要素では、これらと同じイベントが DOM の `CustomEvent` として再ディスパッチされるため、`addEventListener` で受け取ることもできます。

パーツ単位の上書き（色 / セル / 表示）も同じファサード上にあります（`setPartColorOverride` / `setPartCellOverride` / `setPartVisibilityOverride` / `clearAllPartOverrides`）。`<ss-player>` 要素自体は再生系の動詞だけを持つ薄い皮なので、これらは `el.player` 経由で呼んでください（先に `await el.ready`）。

サウンドは「そのまま動きます」: 読み込んだ `.ssab` がオーディオを参照しており、`audioManager` が設定されていない場合、デフォルトの `SSWebAudioManager` が遅延インポートされて接続されます(必要なときにのみフェッチされる別チャンク)。完全に手動でコントロールするには `autoAudio: false` を設定してください。

> **加算系ブレンドモードに関する注意:** 加算 / バックドロップ参照モード(Add、Screen、Mul、…)はフレームバッファに対して合成されるため、アニメーションがそれらを使用する場合は不透明な `backgroundColor` を設定してください。透明なキャンバス上では、黒地に焼き込まれたグローが不透明なブロックとして描画されることがあります — これは乗算済みアルファ合成に固有の挙動です。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

### ソースからのビルド

WASM バイナリは **git で管理されていません**。リポジトリのルートから WASM を取得し、
その後にパッケージをビルドしてください:

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

### 変更を試す

同梱の WebGL サンプルを実行して、レンダラー(および `<ss-player>` 要素)の動作を
確認してください — ソースをカスタマイズしたり、修正を検証したりする際に便利です:

```bash
cd examples/webgl-example
pnpm run dev             # start the dev server
```

サンプルはワークスペース参照を通じて **ビルド済み** のパッケージを利用するため、
ここで `src/` を編集した後はリポジトリのルートから `pnpm run build` を再実行してください。
