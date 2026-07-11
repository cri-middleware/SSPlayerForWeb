# PixiJS で使う

`@spritestudio/ssplayer-pixi` は PixiJS v8 向けのレンダラーです。**Direct Drawing
（バッチ描画）** により多数のキャラクターを高速に描画します。

## インストール

```bash
pnpm add @spritestudio/ssplayer-pixi pixi.js
```

`pixi.js@^8.19` は peer dependency です。

## ポイント

- `SSPlayer` は PixiJS の `Container` を継承します。`position` / `scale` /
  `eventMode` など通常の Pixi の API がそのまま使えます。
- `Ticker.shared` に自動登録されるため、**毎フレームの `update()` は不要**です。
- 破棄は `player.destroy()`。WASM 側リソースも解放されます。

最小コードは [クイックスタート](/setup/quickstart)、再生制御は
[基本的な再生](/usage/basic) を参照してください。

## ブレンドモードと背景

SpriteStudio の「背景を読み取る」ブレンドモード（Screen / Exclusion / Invert）は
実際のフレームバッファを読む固定機能 GPU ブレンドとして実装されています。つまり
`Application` の `backgroundColor` が合成対象の背景になります。詳細は
[シェーダーとブレンドモード](/customize/shaders) を参照。
