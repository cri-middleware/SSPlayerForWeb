---
description: レンダラーパッケージの選び方、インストール、前提条件。
---

# インストール

## どのパッケージを選ぶか

使う環境に合わせてパッケージを 1 つ選びます。

| 環境 | パッケージ |
|---|---|
| フレームワーク非依存 / ドロップイン（`<ss-player>` Web Component を含む） | [`@spritestudio/ssplayer-webgl`](/ja/usage/webgl) |
| **PixiJS v8** で構築済みのアプリ | [`@spritestudio/ssplayer-pixi`](/ja/usage/pixi) |
| **PixiJS v8** のアプリで、アニメーションで描くボタン（`@pixi/ui`） | [`@spritestudio/ssplayer-pixi-ui`](/ja/usage/pixi-ui) |
| 独自エンジンにレンダラーを自作する | `@spritestudio/ssplayer-core` |
| **RPG ツクール MZ** で作るゲーム | [`@spritestudio/ssplayer-rmmz`](/ja/usage/rmmz)（プラグイン） |
| **TyranoScript** のノベル | [`@spritestudio/ssplayer-tyranoscript`](/ja/usage/tyrano)（プラグイン） |
| **ティラノビルダー** で作るゲーム | [`@spritestudio/ssplayer-tyranobuilder`](/ja/usage/tyranobuilder)（`.tbp` のプラグイン） |

レンダラーパッケージは `@spritestudio/ssplayer-core` を再エクスポートしているため、コアを個別に入れる必要はありません。`@spritestudio/ssplayer-pixi-ui` も同じく `@spritestudio/ssplayer-pixi` を再エクスポートしています。

RPG ツクール MZ・TyranoScript・ティラノビルダーは npm のパッケージではなくプラグインとして入れ、コードは書きません。手順はそれぞれのページにすべてあり、未対応の範囲は [制約と適用範囲](/ja/limitations) にまとめてあります。このページのこの先は、それ以外のパッケージのインストール手順です。

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

バンドラーを使わない場合は、どちらも CDN から直接読み込めます。[WebGL](/ja/usage/webgl#without-a-bundler-cdn) と [PixiJS](/ja/usage/pixi#without-a-bundler-cdn) を参照してください。

## 前提

- ブラウザが **WebGL** に対応していること（`ssplayer-webgl` は WebGL 1 / 2、
  `ssplayer-pixi` は WebGL 2 が必要）。加えて `ssplayer-pixi` は、PixiJS v8 のバックエンド優先順位に従い、WebGPU が利用可能ならそれを使い、なければ WebGL2 にフォールバックします。
- 再生には **`.ssab`（ランタイムバイナリ）** が必要です。SpriteStudio の `.sspj`
  からの変換方法は [アセットの準備](/ja/usage/assets) を参照してください。

次は [クイックスタート](/ja/setup/quickstart) へ進みます。
