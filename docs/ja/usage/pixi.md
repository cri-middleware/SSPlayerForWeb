# PixiJS で使う

`@spritestudio/ssplayer-pixi` は、すでに **PixiJS v8** を採用しているアプリ向けのレンダラーです。**Direct Drawing（バッチ描画）** を使い、多数のキャラクターをまとめて描画します。

## インストール

```bash
pnpm add @spritestudio/ssplayer-pixi@beta pixi.js
```

`pixi.js@^8.19` は peer dependency です。

## ポイント

- `SSPlayer` は PixiJS の `Container` を継承します。`position` / `scale` /
  `eventMode` など通常の Pixi の API がそのまま使えます。
- `Ticker.shared` へ自動登録されるため、**毎フレームの `update()` は不要**です。
- 破棄は `player.destroy()` で行い、WASM 側リソースも解放されます。

最小コードは [クイックスタート](/ja/setup/quickstart)、再生制御は
[基本的な再生](/ja/usage/basic) を参照してください。

## ブレンドモードと背景

SpriteStudio の「背景を読み取る」ブレンドモード（Screen / Exclusion / Invert）は、
実際のフレームバッファを読む固定機能 GPU ブレンドとして実装されています。つまり
`Application` の `backgroundColor` が合成対象の背景になります。詳細は
[シェーダーとブレンドモード](/ja/customize/shaders) を参照してください。
