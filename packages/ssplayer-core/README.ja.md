[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-core

**SpriteStudio** プレイヤーのためのエンジン非依存な WebAssembly コアです。

> **対象読者:** 自分でレンダラーを作る開発者 / 上級インテグレーター — 新しいエンジンをバインドするための、エンジン非依存な WASM 再生コアです。**インストール:** `npm install @spritestudio/ssplayer-core@beta`
> **目的が違う場合:** → [ssplayer-pixi](../ssplayer-pixi) / [ssplayer-webgl](../ssplayer-webgl) — アニメーションを描画したいだけなら、すぐ使えるレンダラーをどうぞ。

> **beta ライン。** 7.0.0 が prerelease の間は `beta` dist-tag にのみ publish されるため、上記の `@beta` は必須です。7.0.0 が `latest` に出れば不要になります。

[SSPlayerForWeb](../../README.ja.md) monorepo の一部です。ガイドや完全なドキュメントについては [docs](../../docs/) を参照してください。

> **アニメーションを描画したいだけですか?** [パッケージ表](../../README.ja.md#-どのパッケージを使うか)からレンダラーを選んでください。`core` を直接使うことはありません。

▶️ このコアがレンダラーを駆動している様子:
**[WebGL サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** ·
**[PixiJS サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
どちらも同じ WASM 再生コアの上に薄い描画層を載せたものです（🚧 初回リリース後に公開）。

このパッケージは、`core` を直接扱う次の 2 種類の対象者のためのものです。

- **レンダラー自作者** — `core` の上にレンダラーバインディングを構築することで、プレイヤーを新しいエンジンに移植する方。[上にレンダラーを構築する](#上にレンダラーを構築する)へ直接どうぞ。
- **`core` メンテナ** — [コントリビューター向け — ソースからビルド](#コントリビューター向け--ソースからビルド)および [CONTRIBUTING.md](../../CONTRIBUTING.md)を参照してください。

## ✨ なぜこのコアの上にレンダラーを構築するのか?

`core` の上にレンダラーバインディングを構築すれば、*すべての* SpriteStudio Player for Web レンダラーが共有する強みを継承できます。それらの強みは、このコアと、それがラップする `#![no_std]` の Rust SDK に由来します。

- **1 つのコア、あらゆるエンジンで一貫したビジュアル。** 重い状態計算のすべて（ボーン行列、メッシュ変形、階層的なカラー/不透明度）はここで一度だけ行われ、単一のクロスエンジンなドロープランとして出力されます。PixiJS v8、スタンドアロンの WebGL、RPG ツクール MZ の各レンダラーはすべて*同じ*プランを消費するため、どこで描画してもアニメーションは同一に見え、エンジン固有の見た目のブレは生じません。
- **コンパクトなアセット、ゼロコピー、SIMD。** アニメーションは列指向の `.ssab` FlatBuffers バイナリとして配布されます（ロード時のパースはゼロ）。再生中、トランスフォームとジオメトリは WASM メモリに直接マップされた `Float32Array` ビューを通じて読み取られ（フレームごとのコピーなし）、Rust コアは SIMD（f32x4）を使用して、最小の CPU / メモリコストで最大のスループットを実現します。
- **参照アセット*と*埋め込み(embedded)アセットの両方に対応。** `core` は両方の `.ssab` バリアントをロードします。一方は外部のテクスチャファイルを**参照**するもの、もう一方は `--embedded` で変換されテクスチャを**インライン化**したものです。埋め込みにより、ロードは 1 つの `.ssab` **とテクスチャごとに 1 つの HTTP リクエスト**から、**自己完結の単一リクエスト**へと集約されます。ラウンドトリップが減り、キャッシュとデプロイがシンプルになり、さらにアセットは兄弟ファイルなしで `ArrayBuffer` としてインラインで配布することさえできます。あなたのレンダラーは、バイナリから埋め込みテクスチャをデコードするオプションの `loadTextureFromBytes` を実装するだけです。省略すればすべて URL ロードにフォールバックします。どちらの経路も無償で継承されます。
- **ブラウザが動くところならどこでも動く。** コアは SDK の `#![no_std]` の Rust を WebAssembly にコンパイルしたものであり、OS や DOM を前提としないため、メモリ制約のあるモバイルブラウザからデスクトップまで、再生は安定し、アロケーションフリーに保たれます。

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

> ドローバッチを直接発行するのではなく、既存のシーングラフ / `Sprite` ツリーへ描画したいエンジン向けの `SceneGraphInternalPlayer` ファサードは**対応予定**です。当面は
> `DirectInternalPlayer` の上に構築してください。

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
