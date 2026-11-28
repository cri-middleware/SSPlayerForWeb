---
description: レンダラーパッケージの選び方、インストール、前提条件。
---

# インストール

## どのパッケージを選ぶか

使う環境に合わせてパッケージを 1 つ選びます。

| 環境 | パッケージ |
|---|---|
| フレームワーク非依存 / ドロップイン（`<ss-player>` Web Component を含む） | [`@spritestudio/ssplayer-webgl`](../usage/webgl.md) |
| **PixiJS v8** で構築済みのアプリ | [`@spritestudio/ssplayer-pixi`](../usage/pixi.md) |
| **PixiJS v8** のアプリで、アニメーションで描くボタン（`@pixi/ui`） | [`@spritestudio/ssplayer-pixi-ui`](../usage/pixi-ui.md) |
| 独自エンジンにレンダラーを自作する | `@spritestudio/ssplayer-core` |
| **RPG ツクール MZ** で作るゲーム | [`@spritestudio/ssplayer-rmmz`](../usage/rmmz.md)（プラグイン） |
| **TyranoScript** のノベル | [`@spritestudio/ssplayer-tyranoscript`](../usage/tyrano.md)（プラグイン） |
| **ティラノビルダー** で作るゲーム | [`@spritestudio/ssplayer-tyranobuilder`](../usage/tyranobuilder.md)（`.tbp` のプラグイン） |

レンダラーパッケージは `@spritestudio/ssplayer-core` を再エクスポートしているため、コアを個別に入れる必要はありません。`@spritestudio/ssplayer-pixi-ui` も同じく `@spritestudio/ssplayer-pixi` を再エクスポートしています。

RPG ツクール MZ・TyranoScript・ティラノビルダーは npm のパッケージではなくプラグインとして入れ、コードは書きません。手順はそれぞれのページにすべてあり、未対応の範囲は [制約と適用範囲](../limitations.md) にまとめてあります。このページのこの先は、それ以外のパッケージのインストール手順です。

## インストール

::: code-group

```bash [pnpm]
# 依存なしの単体レンダラー
pnpm add @spritestudio/ssplayer-webgl

# PixiJS v8 アプリに組み込む場合（pixi.js は peer dependency）
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

```bash [npm]
# 依存なしの単体レンダラー
npm install @spritestudio/ssplayer-webgl

# PixiJS v8 アプリに組み込む場合（pixi.js は peer dependency）
npm install @spritestudio/ssplayer-pixi pixi.js
```

:::

`ssplayer-webgl` は追加の依存を必要としません。`ssplayer-pixi` を使う場合は、
`pixi.js@^8.19` が **peer dependency** となるため、アプリ側に導入してください。

バンドラーを使わない場合は、どちらも CDN から直接読み込めます。[WebGL](../usage/webgl.md#without-a-bundler-cdn) と [PixiJS](../usage/pixi.md#without-a-bundler-cdn) を参照してください。

## 前提

- ブラウザが **WebGL** に対応していること（`ssplayer-webgl` は WebGL 1 / 2、`ssplayer-pixi` は WebGL 2 が必要）。`ssplayer-pixi` は WebGPU でも動きます。PixiJS v8 は既定で WebGL を使うので、WebGPU を使うには `app.init()` に `preference: 'webgpu'` を渡します。WebGPU が無いブラウザでは WebGL にフォールバックします。
- ブラウザが **WebAssembly SIMD** に対応していること（[制約と適用範囲](../limitations.md#ブラウザ要件) を参照）。
- プロジェクトは **SpriteStudio 7.6 以上**で作成されていること。
- 再生には **`.ssab`（ランタイムバイナリ）** が必要です。SpriteStudio の `.sspj`
  からの変換方法は [アセットの準備](../usage/assets.md) を参照してください。

次は [クイックスタート](./quickstart.md) へ進みます。
