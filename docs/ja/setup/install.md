# インストール

## どのパッケージを選ぶか

使う環境に合わせてレンダラーパッケージを 1 つ選びます。

| 環境 | パッケージ |
|---|---|
| フレームワーク非依存 / ドロップイン（`<ss-player>` Web Component を含む） | [`@spritestudio/ssplayer-webgl`](/ja/usage/webgl) |
| **PixiJS v8** で構築済みのアプリ | [`@spritestudio/ssplayer-pixi`](/ja/usage/pixi) |
| 独自エンジンにレンダラーを自作する | `@spritestudio/ssplayer-core` |

レンダラーパッケージは `@spritestudio/ssplayer-core` を再エクスポートしているため、
コアを個別に入れる必要はありません。

::: tip フレームワーク連携
ゲーム/ノベルフレームワーク向けの連携は `ssplayer-webgl` を土台とし、各フレームワークの
プラグイン機構で読み込む **IIFE バンドル**として提供されます（npm からインストールするのではなく
プラグインとして利用）:

- **RPG ツクール MZ**（`@spritestudio/ssplayer-rmmz`）— **実験的（alpha）**。[RPG ツクール MZ で使う](/ja/usage/rmmz) を参照。
- **TyranoScript**（`@spritestudio/ssplayer-tyranoscript`）— beta。[TyranoScript で使う](/ja/usage/tyrano) を参照。
- **ティラノビルダー**（`@spritestudio/ssplayer-tyranobuilder`）— beta。`.tbp` として配布されます。[ティラノビルダーで使う](/ja/usage/tyranobuilder) を参照。

それぞれの未対応範囲は [制約と適用範囲](/ja/limitations) にまとめてあります。
:::

## インストール

::: code-group

```bash [pnpm]
# 依存なしの単体レンダラー
pnpm add @spritestudio/ssplayer-webgl@beta

# PixiJS v8 アプリに組み込む場合（pixi.js は peer dependency）
pnpm add @spritestudio/ssplayer-pixi@beta pixi.js
```

```bash [npm]
# 依存なしの単体レンダラー
npm install @spritestudio/ssplayer-webgl@beta

# PixiJS v8 アプリに組み込む場合（pixi.js は peer dependency）
npm install @spritestudio/ssplayer-pixi@beta pixi.js
```

:::

`ssplayer-webgl` は追加の依存を必要としません。`ssplayer-pixi` を使う場合は、
`pixi.js@^8.19` が **peer dependency** となるため、アプリ側に導入してください。

## 前提

- ブラウザが **WebGL** に対応していること（`ssplayer-webgl` は WebGL 1 / 2、
  `ssplayer-pixi` は WebGL 2 が必要）。加えて `ssplayer-pixi` は、PixiJS v8 の
  バックエンド優先順位に従い、WebGPU が利用可能ならそれを使い、なければ WebGL2 に
  フォールバックします。
- 再生には **`.ssab`（ランタイムバイナリ）** が必要です。SpriteStudio の `.sspj`
  からの変換方法は [アセットの準備](/ja/usage/assets) を参照してください。

次は [クイックスタート](/ja/setup/quickstart) へ進みます。
