# パーツ制御（表示 / セル / 色）

::: warning 実装予定（SDK 依存）
実行時にパーツ単位で**表示・セル参照・カラー**を上書きする API
（`setPartVisible` / `setPartCell` / `setPartTint` など）は、`SpriteStudio-SDK`
側の **Override Layer API** 実装後に追加予定です。進捗は
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md)
を参照してください。
:::

## 現状で使える照会系

現時点ではパーツの**照会**のみ利用できます。

```ts
player.getPartsCount();                 // パーツ数
player.getPartIndexFromName('body');    // パーツ名 → インデックス
```

着せ替え（セルマップ差し替え）やインスタンスアニメの動的差し替えも SDK 側の
API 実装待ちです。
