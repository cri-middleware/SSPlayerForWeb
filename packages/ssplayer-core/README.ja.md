[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-core

**SpriteStudio** プレイヤーのためのエンジン非依存な WebAssembly コアです。

> **対象読者:** 自分でレンダラーを作る開発者 / 上級インテグレーター — 新しいエンジンをバインドするための、エンジン非依存な WASM 再生コアです。**インストール:** `npm install @spritestudio/ssplayer-core`
> **目的が違う場合:** → [ssplayer-pixi](../ssplayer-pixi) / [ssplayer-webgl](../ssplayer-webgl) — アニメーションを描画したいだけなら、すぐ使えるレンダラーをどうぞ。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドや完全なドキュメントについては [docs](https://cri-middleware.github.io/SSPlayerForWeb/ja/) を参照してください。このバージョンの同じページ（英語の Markdown）がパッケージの `docs/` にあり、オフラインで読めます（入口は `docs/README.md`）。

> **アニメーションを描画したいだけですか?** [パッケージ表](../../README.ja.md#-どのパッケージを使うか)からレンダラーを選んでください。`core` を直接使うことはありません。

▶️ このコアがレンダラーを駆動している様子:
**[WebGL サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** ·
**[PixiJS サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
どちらも同じ WASM 再生コアの上に薄い描画層を載せたものです。

このパッケージは、`core` を直接扱う次の 2 種類の対象者のためのものです。

- **レンダラー自作者** — `core` の上にレンダラーバインディングを構築することで、プレイヤーを新しいエンジンに移植する方。[上にレンダラーを構築する](#上にレンダラーを構築する)へ直接どうぞ。
- **`core` メンテナ** — [コントリビューター向け — ソースからビルド](#コントリビューター向け--ソースからビルド)および [CONTRIBUTING.md](../../CONTRIBUTING.md)を参照してください。

## ✨ なぜこのコアの上にレンダラーを構築するのか?

`core` の上にレンダラーバインディングを構築すれば、SpriteStudio Player for Web のすべてのレンダラーが共有しているものをそのまま受け継げます。

- **動きの計算はコアが済ませる。** ボーン行列・メッシュ変形・階層的なカラー / 不透明度はここで計算され、1 つのドロープランとして出力されます。PixiJS・単体 WebGL・RPG ツクール MZ の各レンダラーは同じプランを使うので、ポーズ・変形・描画順はレンダラー間で一致します。レンダラーの仕事は描画で、ブレンドモードとパーツカラーは「意図」として渡され、エンジンの機能で再現します。
- **パース不要の読み込み、ゼロコピーのフレーム、SIMD。** `.ssab` は FlatBuffers のバイナリをそのまま読みます。毎フレームのトランスフォームとジオメトリは WASM メモリ上の `Float32Array` ビューで、フレームごとのコピーはありません。計算は Rust コアが SIMD（f32x4）で行います。
- **参照テクスチャも埋め込みテクスチャも。** `core` は、テクスチャファイルを参照する `.ssab` と、`--embedded` で変換してテクスチャを中に持つ `.ssab` の両方を読み込めます。埋め込みならテクスチャごとのリクエストが 1 回にまとまり、バイト列を `ArrayBuffer` で渡せばリクエスト自体が要りません。埋め込みテクスチャのデコードはオプションの `loadTextureFromBytes` を実装するだけで、省略すれば URL からの読み込みにフォールバックします。
- **ブラウザが動くところならどこでも。** コアは SDK の `#![no_std]` の Rust を WebAssembly にコンパイルしたもので、OS も DOM も前提にしません。

## このパッケージとは何か

`ssplayer-core` は Rust/WASM の `ssruntime` をラップし、エンジン非依存な再生ロジック（WASM 初期化、時間更新、ジオメトリ / 状態の抽出）を公開します。**いかなるレンダリングエンジンや DOM にも依存しない**ため、レンダラーパッケージが上に載る土台のレイヤーとなります。

## 主要なエクスポート

| エクスポート | 役割 |
|---|---|
| `initializeWasm(wasmUrl?)` | `ssruntime` WASM モジュールをロードしてインスタンス化する（1 回だけ呼び出す）。 |
| `getWasmMemory()` | ゼロコピーの `TypedArray` ビュー用の WASM `WebAssembly.Memory`。 |
| `SSRuntimeManager` | ロード済みの `.ssab` をラップする。パーツ / アニメーションのイントロスペクション。 |
| `DirectInternalPlayer` | 高性能な直接描画プレイヤーのファサード。 |
| `GeometryBuilder` | ランタイムのドローバッチから頂点 / インデックスバッファを構築する。 |
| `IResourceManager` / `IAudioManager` | レンダラーが実装するインターフェース（テクスチャ、オーディオ）。 |
| `SSWebAudioManager` | 既製の `IAudioManager`（Web Audio）。`./audio` サブパスからインポート。 |
| `ssFormat` / `ssRuntime` | SSAB / SSQB FlatBuffers のイントロスペクションアクセサ。 |
| `WebPlaybackDirection` / `WebPlaybackStyle` | 再生用の列挙型。 |

## 上にレンダラーを構築する

1. あなたのエンジン向けにテクスチャを解決する `IResourceManager` を実装します。`--embedded` の ssab（テクスチャがバイナリにインライン化されたもの）も描画するには、オプションの `loadTextureFromBytes` を追加します。これがなければ、埋め込みアセットは URL ロードにフォールバックします。
2. フレームごとに 1 回 `DirectInternalPlayer.update(deltaMs)` を駆動します。
3. 出力されたドローバッチを `GeometryBuilder` を通して GPU パスへ送ります。

[`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) がリファレンス実装です。

## メモリモデル

- **ゼロコピー:** トランスフォーム行列とジオメトリは、`getWasmMemory().buffer` に直接マップされた `Float32Array` ビューを通じて読み取られます。フレームごとのコピーはありません。
- **メモリ安全性:** WASM メモリは JS によって GC されません。ラッパーは `FinalizationRegistry` を使用して、JS オブジェクトが回収されたときに WASM の `free()` を呼び出します。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md)を参照してください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

対象読者: `core` メンテナ。npm パッケージを利用するレンダラー自作者はここを読み飛ばして構いません。

WASM バイナリは **git で管理されていません**。リポジトリのルートから WASM を取得し、その後パッケージをビルドします。

```bash
pnpm run download:wasm   # fetch pre-built WASM (or build from source: pnpm run build:wasm — needs rustup + wasm-pack)
pnpm run build           # build all TS packages
```
