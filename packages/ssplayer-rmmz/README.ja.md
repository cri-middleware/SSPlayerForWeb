[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-rmmz

**SpriteStudio 7** プレーヤー向けの RPG Maker MZ (PixiJS v5) レンダラーです。

[SSPlayerForWeb](../../README.ja.md) モノレポの一部です。

> ⚠️ **作業中 / プレースホルダ。** このパッケージは現在、バージョン定数
> (`RMMZ_RENDERER_VERSION`) をエクスポートするのみです。RPG Maker MZ の
> PixiJS v5 固定環境向けのレンダラーはまだ実装されていません。
>
> モダンな PixiJS アプリを対象としていますか？ その場合は代わりに
> [`@spritestudio/ssplayer-pixi`](../ssplayer-pixi) (PixiJS v8) を使用してください。

## ✨ なぜ RPG Maker MZ で SpriteStudio なのか？

- **MZ 標準のアニメーションを超えて。** RPG Maker MZ のアニメーションは
  スプライトシートによるエフェクトに限定されており、リッチなキャラクターモーション、
  カットシーン、全画面演出を実現しようとすると、エディターと格闘するか動画を
  事前レンダリングするしかありません。SpriteStudio 7 は、プロ品質のボーン / メッシュ /
  パーティクルによる 2D アニメーションを MZ に持ち込み、既存の PNG アートを
  そのまま再生します。
- **MZ ネイティブな手段 — そして唯一適合する手段。** MZ は **PixiJS v5** に
  固定されているため、モダンな [`ssplayer-pixi`](../ssplayer-pixi) (v8) レンダラーは
  そこでは動作しません。このパッケージはその PixiJS v5 固定環境を専用に対象とし、
  SceneGraph 描画を用いることで、SpriteStudio のパーツを MZ の既存の `Sprite`
  ツリーを回避するのではなく、その中に組み込みます。

## 計画中のアプローチ

`ssplayer-pixi`（直接描画 / バッチ描画）とは異なり、このパッケージは
**SceneGraph 描画** を使用します。SpriteStudio のパーツを PixiJS v5 の `Sprite`
ツリーにマッピングすることで、RPG Maker MZ の既存のレンダリング階層に統合します。
これは [`@spritestudio/ssplayer-core`](../ssplayer-core) の
`SceneGraphInternalPlayer` ファサードの上に構築されます。

ステータスについてはリポジトリの [ROADMAP.md](../../ROADMAP.md) を参照してください。

## ライセンス

BSD-3-Clause — [LICENSE.md](../../LICENSE.md) を参照してください。
