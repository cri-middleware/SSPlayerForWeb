# RPG Maker MZ で使う

::: warning WIP / プレースホルダ
`@spritestudio/ssplayer-rmmz` は現在バージョン定数（`RMMZ_RENDERER_VERSION`）のみを
公開するプレースホルダです。RPG Maker MZ（固定 PixiJS v5 環境）向けレンダラーは
未実装です。
:::

モダンな PixiJS アプリを対象とする場合は [PixiJS で使う](/usage/pixi)（PixiJS v8）を
利用してください。

## 想定するアプローチ

`ssplayer-pixi`（Direct / バッチ描画）と異なり、本パッケージは **SceneGraph 描画** —
SpriteStudio のパーツを PixiJS v5 の `Sprite` ツリーへマッピングし、RPG Maker MZ の
既存レンダリング階層に統合する方針です。`@spritestudio/ssplayer-core` の
`SceneGraphInternalPlayer` ファサードを土台にします。

進捗は [ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md) を参照してください。
