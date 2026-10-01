---
description: PixiJS v8 で作られたアプリ向けのレンダラー。バッチ描画の Direct Drawing で多数のキャラクターをまとめて描画。
---

# PixiJS で使う

`@spritestudio/ssplayer-pixi` は、すでに **PixiJS v8** を採用しているアプリ向けのレンダラーです。**Direct Drawing（バッチ描画）** を使い、多数のキャラクターをまとめて描画します。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/pixi/" target="_blank" rel="noreferrer">ライブデモ</a>** —
PixiJS v8 アプリで複数のアニメを再生する例です。`.ssab` をドロップすれば手元のデータも再生できます（最初のリリース公開後に有効化されます 🚧）。

🎨 **<a href="../../examples/override/" target="_blank" rel="noreferrer">パーツ上書きデモ</a>** —
同じレンダラーでパーツの色 / セル / 表示を実行時に差し替える例です（[パーツ制御](/ja/customize/part-overrides)）。

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
[基本的な再生](/ja/usage/basic) を参照してください。自前の表示オブジェクト（武器・エフェクト・当たり判定など）を毎フレームパーツに追従させる方法は
[パーツトラッキング](/ja/customize/part-following) を参照してください。実行時に特定パーツの色・表示・セルを差し替えるには [パーツ制御](/ja/customize/part-overrides) を参照してください。
`SSPlayer` は WebGL 版と同じ上書きメソッドを持ち、停止中に上書きした場合は現在のフレームを描画し直します。

## ブレンドモードと背景

SpriteStudio の「背景を読み取る」ブレンドモード（Screen / Exclusion / Invert）は、実際のフレームバッファを読む固定機能 GPU ブレンドとして実装されています。つまり
`Application` の `backgroundColor` が合成対象の背景になります。詳細は
[シェーダーとブレンドモード](/ja/customize/shaders) を参照してください。
