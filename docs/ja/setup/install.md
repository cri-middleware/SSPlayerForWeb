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

::: tip RPG ツクール MZ 向け
RPG ツクール MZ 向けレンダラー（`@spritestudio/ssplayer-rmmz`）は**実験的（alpha）かつ非公開**で、
npm では配布していません。`ssplayer-webgl` を土台にしています。詳細は
[RPG ツクール MZ で使う](/ja/usage/rmmz) を参照してください。
:::

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

## 前提

- ブラウザが **WebGL 1 / 2** に対応していること。`ssplayer-pixi` は PixiJS v8 が
  必要とする **WebGL2 / WebGPU** に依存します。
- 再生には **`.ssab`（ランタイムバイナリ）** が必要です。SpriteStudio の `.sspj`
  からの変換方法は [アセットの準備](/ja/usage/assets) を参照してください。

次は [クイックスタート](/ja/setup/quickstart) へ進みます。
