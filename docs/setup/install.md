# インストール

## どのパッケージを選ぶか

まずは使う環境に合わせてレンダラーパッケージを 1 つ選びます。

| 環境 | パッケージ |
|---|---|
| モダンな PixiJS v8 アプリ | [`@spritestudio/ssplayer-pixi`](/usage/pixi)（推奨） |
| RPG Maker MZ（PixiJS v5） | [`@spritestudio/ssplayer-rmmz`](/usage/rmmz)（WIP） |
| 独自エンジンにレンダラーを自作 | `@spritestudio/ssplayer-core` |

レンダラーパッケージは `@spritestudio/ssplayer-core` を再エクスポートしているため、
コアを個別に入れる必要はありません。

## インストール

::: code-group

```bash [pnpm]
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

```bash [npm]
npm install @spritestudio/ssplayer-pixi pixi.js
```

:::

`pixi.js@^8.19` は **peer dependency** です。アプリ側に入れてください。

## 前提

- ブラウザは **WebGL2 / WebGPU** に対応していること。
- 再生には **`.ssab`（ランタイムバイナリ）** が必要です。SpriteStudio の `.sspj`
  からの変換方法は [アセットの準備](/usage/assets) を参照してください。

次は [クイックスタート](/setup/quickstart) へ。
