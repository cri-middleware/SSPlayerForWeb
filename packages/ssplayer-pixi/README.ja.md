[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi

**SpriteStudio** プレイヤー向けの PixiJS v8 レンダラー。Rust/WebAssembly コアが駆動する高性能な**ダイレクト描画**（バッチ化メッシュ）を提供します。

> **対象読者:** すでに PixiJS v8 でアプリを構築していて、SpriteStudio の `.ssab` アニメーションを組み込みたい開発者です。**インストール:** `npm install @spritestudio/ssplayer-pixi@beta pixi.js`（`pixi.js@^8` を peer 依存として必要とします）**目的が違う場合:** → Pixi を使っていないなら [ssplayer-webgl](../ssplayer-webgl/README.ja.md)、自作レンダラーを組むなら [ssplayer-core](../ssplayer-core/README.ja.md) をどうぞ。

> **beta ライン。** 7.0.0 が prerelease の間は `beta` dist-tag にのみ publish されるため、上記の `@beta` は必須です。7.0.0 が `latest` に出れば不要になります。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
`.ssab` を再生する PixiJS v8 アプリ。手元のファイルをドラッグ&ドロップして再生できます。

🎨 **[パーツ上書きデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** —
実行時にパーツ単位で色 / セル / 表示を上書きするサンプル（ソースは `examples/override-example`）。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドや完全なドキュメントについては [docs](https://cri-middleware.github.io/SSPlayerForWeb/ja/) を参照してください。このバージョンの同じページ（英語の Markdown）がパッケージの `docs/` にあり、オフラインで読めます（入口は `docs/README.md`）。

## ✨ なぜ PixiJS で SpriteStudio を使うのか？

- **描画は Pixi、アニメーションは SpriteStudio。** `AnimatedSprite` とスプライトシートの先——ボーン・メッシュ変形・パーティクル——に進むと、アニメーションシステムを自前で組むことになります。SpriteStudio は、お手持ちの PNG / WebP 素材にアーティストがその動きを作り込む専用の 2D エディタで、このプレイヤーは完成したアニメーションをそのままステージへ載せます。
- **キャラクター単体ではなく、シーン全体を。** キャラクター・背景・エフェクト・UI を 1 つのタイムラインで組み上げたカットシーンや全画面の演出が、1 つのアニメーションとしてステージに載ります。
- **ただの Pixi `Container`。** `SSPlayer` は `Ticker.shared` で自分から進むので、フレームごとの `update()` を書く必要はありません。描画は Pixi 自身のバッチ処理を通り、シーンの他の要素と一緒に描かれます。
- **タイムラインからゲームへのフック。** アーティストが置いたイベントがコールバック（`onUserData` / `onSignal` / `onAudio`）で届き、そのままゲームロジックにつなげられます。
- **どのリフレッシュレートでも滑らか。** **サブフレーム補間**（既定で有効）が各フレームを正確な表示時刻で描画するので、120 Hz 以上のディスプレイでもスローモーションでも動きが滑らかです。

## インストール

```bash
npm install @spritestudio/ssplayer-pixi@beta pixi.js
```

`pixi.js`（v8）は **peer 依存**です。アプリがまだ依存していない場合は、プレイヤーと一緒にインストールしてください。

## クイックスタート

WASM を一度読み込み、`SSPlayer` を生成してステージに追加し、`play()` を呼び出します。

```ts
import { Application } from 'pixi.js';
import { SSPlayer } from '@spritestudio/ssplayer-pixi';

// 1. Load the WASM runtime once for the whole app.
await SSPlayer.initialize();

const app = new Application();
await app.init({ width: 1280, height: 960, backgroundColor: 0x1a1a2e });
document.body.appendChild(app.canvas);

// 2. Create a player, load a .ssab, and pick an animation.
const player = new SSPlayer();
player.attachRenderer(app.renderer); // 任意 — 下のマスクの注意を参照
await player.load('/Ringo.ssab');   // textures load from the .ssab's own directory
player.setAnimation('run');

player.position.set(640, 730);   // Ringo の原点は足元
app.stage.addChild(player);

player.play();
```

> **`attachRenderer` とマスクについて。** マスク／クリッピングパーツはオフスクリーンのカバレッジパスを経由して描画されるため renderer が必要ですが、プレイヤーが renderer を受け取るのは最初に描画された時です。`attachRenderer` を呼ばない場合、マスクの対象となるパーツは最初の1フレームだけ描画を保留し（マスク無しで描かれることはありません）、
> 2フレーム目から正しく表示されます。あらかじめ renderer を渡しておけば1フレーム目から正しくなります。マスクを含まないアニメーションの表示はどちらでも同一なので、マスクを使う場合にのみ意味があります。

> **参照（ssab）と埋め込み(embedded) ssab のどちらも動作します。** `load()` はいずれの形式も扱います。外部テクスチャファイルを参照する ssab（兄弟階層の PNG としてフェッチされる）でも、`--embedded` で変換され、テクスチャがインライン化されバイナリから直接デコードされる ssab でも構いません。後者では兄弟ファイルのフェッチが発生しないため、アニメーション全体が自己完結の単一リクエストとして読み込まれます。いずれも
> `examples/pixi-example` で検証済みです。

## CDN から使う（ビルド不要）

バンドラを使いたくない場合、本パッケージはブラウザ直読み用のビルドも同梱しており、CDN
からそのまま読み込めます。**手動でやることは1つだけ — WASM バイナリの場所を明示する**ことです。ランタイムは別ファイルの `.wasm` で、バンドラの外（クラシックな `<script>` や
CDN 経由）ではバンドラが行う自動パス解決が効きません。そのため URL を
`SSPlayer.initialize(wasmUrl)` に渡してください。

> **WASM は読み込むプレイヤーと同じバージョンに固定してください。** `.wasm` と JS グルーは ABI を共有するため、片方だけ `@latest` にすると不整合が起こり得ます。`ssplayer-pixi`
> のバンドルと `ssplayer-core` の `.wasm` の **両方** で正確なバージョン（例:
> `@7.0.0-beta.1`）を指定してください。

### クラシック `<script>` — グローバル `SSPixiPlayer`

`pixi.js` はピア依存なので、先に Pixi 本体のグローバルビルドを読み込みます（バンドルは
`window.PIXI` を参照します）。レンダラークラスは `SSPixiPlayer.SSPlayer` です。

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

ビルド無しでネイティブモジュールを使いたい場合は ESM CDN（下記は esm.sh）から import
します。ルールは同じで、WASM の URL を明示的に渡します。

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

クラシック `<script>` 版の実行可能なサンプルが [`examples/cdn`](../../examples/cdn/) にあります（`pixi.html`）。

## 再生 API（抜粋）

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

player.frameNo;                       // get/set the current frame
player.speedScale = 1.5;            // playback speed multiplier
player.loopCount;                   // 設定したループ回数（-1 = 無限）
player.totalFrames; player.startFrame; player.endFrame; player.fps;
player.isPlaying; player.isPausing;

player.setAnimationSection(start, end);
player.setPlaybackDirection(direction, style);
player.getPartNames();
player.getPartIndexFromName('body');
```

## イベント

タイムラインイベントは、ランタイムがフレームごとに発火します。すべての購読は、購読解除用の関数を返します。

```ts
const off = player.onUserData((e) => console.log('userData', e.partName));
player.onSignal((e) => console.log('signal', e.commandId));
player.onAudio((e) => console.log('audio', e.soundName));  // notification hook — audio also plays by default (see below)
player.onAnimationFinished(() => {});
player.onAnimationLooped(() => {});

off(); // stop listening
```

**音声は既定で再生されます。** 読み込んだ `.ssab` にサウンドが含まれ、かつ
`player.audioManager` を設定していない場合、`load()` はそれらを再生する既定の
`SSWebAudioManager` を自動的にアタッチします。利用側のコードは一切不要です。再生をカスタマイズまたは差し替えるには、`load()` の**前に**独自の `IAudioManager` を
`player.audioManager` へ割り当ててください（既定のものは未設定のときにのみアタッチされます）。
`onAudio` はいずれの場合でも発火するため、サウンドを完全に自分で駆動することもできます。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

### ソースからのビルド

WASM バイナリは **git で管理されていません**。リポジトリのルートから、まず WASM を取得し、続いてパッケージをビルドします。

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

### 変更を試す

バンドルされた PixiJS のサンプルを実行して、レンダラーの動作を確認できます。ソースをカスタマイズしたり修正を検証したりする際に便利です。

```bash
cd examples/pixi-example
pnpm run dev             # start the dev server
```

このサンプルは、ワークスペース参照を通じて**ビルド済み**パッケージを利用します。そのため、ここで `src/` を編集した後は、リポジトリのルートから `pnpm run build` を再実行してください。
