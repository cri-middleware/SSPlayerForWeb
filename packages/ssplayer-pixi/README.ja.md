[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi

**SpriteStudio 7** プレイヤー向けの PixiJS v8 レンダラー。Rust/WebAssembly コアが駆動する高性能な**ダイレクト描画**（バッチ化メッシュ）を提供します。

> **対象読者:** すでに PixiJS v8 でアプリを構築していて、SpriteStudio の `.ssab` アニメーションを組み込みたい開発者です。
> **インストール:** `npm install @spritestudio/ssplayer-pixi pixi.js`（`pixi.js@^8` を peer 依存として必要とします）
> **目的が違う場合:** → Pixi を使っていないなら [ssplayer-webgl](../ssplayer-webgl/README.ja.md)、自作レンダラーを組むなら [ssplayer-core](../ssplayer-core/README.ja.md) をどうぞ。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドや完全なドキュメントについては [docs](../../docs/) を参照してください。

## ✨ なぜ PixiJS で SpriteStudio を使うのか？

- **Pixi は描画を担うが、アニメーションの制作はしない。** `AnimatedSprite` と
  スプライトシートを超えるもの（ボーンリグ、メッシュ変形、パーティクルエフェクト）は、
  アニメーションシステムを自前で組み上げるか、別のランタイムに頼ることを意味します。
  SpriteStudio 7 はまさにその専用 2D エディターであり、このプレイヤーは完成した
  アニメーションをそのままステージへ載せます。
- **キャラクター単体ではなく、シーン全体。** エディター上でキャラクター、背景、
  エフェクト、UI を 1 つのタイムラインに構成し、カットシーンや全画面シーケンス全体を、
  単なるリグ付きスプライト 1 つではなく、1 つのアニメーションとして Pixi ステージへ
  取り込めます。
- **摩擦ゼロの統合。** `SSPlayer` は Pixi の `Container` **そのもの**であり、
  `Ticker.shared` から自己駆動します。フレームごとの専用 `update()` は不要です。
  Pixi 自身の BatchRenderer（ダイレクト描画／バッチ化メッシュ）を通じて描画するため、
  シーンの他の要素と並んでバッチ処理され、フルパフォーマンスを発揮します。
- **既存のアートに、ゲーム連携のフックを。** すでにお持ちの PNG / WebP アートは
  そのままアニメーションし、タイムラインイベント（`onUserData` / `onSignal` /
  `onAudio`）はコールバックとして表出し、ゲームロジックへ直接配線できます。
- **どのリフレッシュレートでも滑らか。** 再生は**サブフレーム補間**（既定で有効）
  されており、各フレームを正確な表示時刻でレンダリングします。そのため、整数フレームへ
  スナップすることなく、120Hz 以上のディスプレイやスローモーションでも動きが滑らかに
  保たれます。

## インストール

```bash
npm install @spritestudio/ssplayer-pixi pixi.js
```

`pixi.js`（v8）は **peer 依存**です。アプリがまだ依存していない場合は、プレイヤーと
一緒にインストールしてください。

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
await player.load('/Ringo.ssab');   // optional 2nd arg: assetBaseUrl for textures
await player.setAnimation('run');   // loop = -1 (infinite) by default

player.position.set(640, 480);
app.stage.addChild(player);

player.play();
```

> **参照（ssab）と埋め込み(embedded) ssab のどちらも動作します。** `load()` は
> いずれの形式も扱います。外部テクスチャファイルを参照する ssab（兄弟階層の PNG として
> フェッチされる）でも、`--embedded` で変換され、テクスチャがインライン化されバイナリから
> 直接デコードされる ssab でも構いません。後者では兄弟ファイルのフェッチが発生しないため、
> アニメーション全体が自己完結の単一リクエストとして読み込まれます。いずれも
> `examples/pixi-example` で検証済みです。

## 再生 API（抜粋）

```ts
player.play(startFrame?);  player.pause();  player.resume();  player.stop();

player.frame;                       // get/set the current frame
player.speedScale = 1.5;            // playback speed multiplier
player.loopCount;                   // number of completed loops
player.totalFrames; player.startFrame; player.endFrame; player.fps;
player.isPlaying; player.isPausing;

player.setAnimationSection(start, end);
player.setPlaybackDirection(direction, style);
player.getPartsCount();
player.getPartIndexFromName('body');
```

## イベント

タイムラインイベントは、ランタイムがフレームごとに発火します。すべての購読は、購読解除用の
関数を返します。

```ts
const off = player.onUserData((e) => console.log('userData', e.partName));
player.onSignal((e) => console.log('signal', e.commandId));
player.onAudio((e) => console.log('audio', e.soundName));  // notification hook — audio also plays by default (see below)
player.onAnimationEnd(() => {});
player.onAnimationLoop(() => {});

off(); // stop listening
```

**音声は既定で再生されます。** 読み込んだ `.ssab` にサウンドが含まれ、かつ
`player.audioManager` を設定していない場合、`load()` はそれらを再生する既定の
`SSWebAudioManager` を自動的にアタッチします。利用側のコードは一切不要です。再生を
カスタマイズまたは差し替えるには、`load()` の**前に**独自の `IAudioManager` を
`player.audioManager` へ割り当ててください（既定のものは未設定のときにのみアタッチされます）。
`onAudio` はいずれの場合でも発火するため、サウンドを完全に自分で駆動することもできます。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

### ソースからのビルド

WASM バイナリは **git で管理されていません**。リポジトリのルートから、まず WASM を取得し、
続いてパッケージをビルドします。

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```

### 変更を試す

バンドルされた PixiJS のサンプルを実行して、レンダラーの動作を確認できます。ソースを
カスタマイズしたり修正を検証したりする際に便利です。

```bash
cd examples/pixi-example
pnpm run dev             # start the dev server
```

このサンプルは、ワークスペース参照を通じて**ビルド済み**パッケージを利用します。そのため、
ここで `src/` を編集した後は、リポジトリのルートから `pnpm run build` を再実行してください。
