---
description: .ssab を変えずに、セルマップが結びつけるテクスチャをコードから差し替える方法。色違いや着せ替えに使う。
---

# テクスチャ差し替え（着せ替え）

セルマップにバインドされたテクスチャを、`.ssab` を触らずに**コードから**差し替える機能です。カラーバリエーション、衣装の着せ替え、動的な表情差分などに使えます。**セルマップ名**をキーにするので、1 回の呼び出しでそのセルマップを描画する全パーツにまとめて効きます。

これは Player 側の責務であり、[パーツ制御](/ja/customize/part-overrides)（Override Layer）とは**別機能**です。あちらは*パーツ 1 つ*が描画するセルを差し替えますが、こちらはセルマップにバインドされた*テクスチャそのもの*を差し替えます。

`SSPlayer`（PixiJS・WebGL の両バックエンド）と RPG ツクール MZ で、同じメソッド名で使えます。各エンジンのテクスチャオブジェクトを渡します。

## 基本的な使い方

```ts
// PixiJS — PIXI.Texture を渡す
import { Assets, Texture } from 'pixi.js';

const costume = await Assets.load<Texture>('/assets/sailor_uniform.png');
player.setCellmapTexture('Clothes', costume);

// 元に戻す（再ロードなし。元テクスチャは破棄していない）
player.setCellmapTexture('Clothes', null);
```

```ts
// WebGL — 画像ソース（ImageBitmap / HTMLImageElement / <canvas> / <video>）を渡す
const img = new Image();
img.src = '/assets/sailor_uniform.png';
await img.decode();
player.setCellmapTexture('Clothes', img);
```

```js
// RPG ツクール MZ — Bitmap を渡す（読み込み方法は任意）
const bmp = ImageManager.loadBitmap('spritestudio/', 'sailor_uniform');
player.setCellmapTexture('Clothes', bmp); // ビットマップの準備完了まで自動で遅延適用
```

パーツごと・パターンごとにアトラスを用意しておけば、テクスチャの差し替え 1 回でキャラクター全体の着せ替えが完了します。これが効率的なアバターシステムになります。

## 差し替え対象の列挙

差し替えできる名前は、プレイヤーから列挙できます。

```ts
player.getReplaceableTextureNames(); // → ["Clothes", "common", "common.png", ...]
```

列挙されるのは、セルマップ名（`Clothes`・`common` — `.ssce` は付かない）**と**、オーサリングされた TextureChange（`TCHG`）が指定できるテクスチャ*ファイル*名（`common.png`）です。バッチがバインドするテクスチャは 2 つのハッシュ空間からキーが引かれる（通常はセルマップ名、テクスチャチェンジが効くフレームだけはファイル名）ため、どちらも正当な差し替え対象です（下記の注意点を参照）。

## `setCellmapTexture` と `setPartCellOverride` の使い分け

名前が似ていますが、やることは別です。取り違えないでください。

| | `setCellmapTexture(name, texture)` | `setPartCellOverride(part, cellmap, cell)` |
|---|---|---|
| 単位 | **セルマップ**（テクスチャ）まるごと | **パーツ 1 つ** |
| 効果 | そのセルマップを描画する全パーツ | そのパーツだけ |
| 差し替える対象 | 名前にバインドされた**テクスチャオブジェクト** | パーツが描画する**セル**（矩形＋テクスチャ） |
| 担当 | 本ページ（Player 側のテクスチャ差し替え） | [パーツ制御](/ja/customize/part-overrides)（Override Layer） |

着せ替え（衣装・パレット変更）なら `setCellmapTexture`、同じアトラス内で 1 パーツだけ別の絵を出すなら `setPartCellOverride` を使ってください。

## API 一覧

| メソッド | 説明 |
|---|---|
| `setCellmapTexture(cellmapName, texture)` | セルマップ名 / 外部テクスチャ名に `texture` をバインド。`null` で元に戻す |
| `getCellmapTexture(cellmapName)` | 現在のオーバーライド（元テクスチャは返さない）。未設定なら `undefined` |
| `getReplaceableTextureNames()` | 差し替え対象にできる名前の列挙（セルマップ名＋テクスチャチェンジ対象） |

`texture` はエンジン固有の型です。PixiJS は `Texture`、WebGL は画像ソース（または低レベルの `SSTextureEntry`）、RPG ツクール MZ は `Bitmap` を渡します。

## 注意点

- **同サイズ・同レイアウト前提。** UV・セル矩形は*元*セルマップのピクセル空間のまま返り、実際にバインドしたテクスチャのサイズで正規化されます。解像度が違うと、同じ矩形が別の領域をサンプルします。同サイズ・同レイアウトのアトラスを差し込んでください。
- **テクスチャチェンジ中のフレームは別の名前でバインドされます。** オーサリングされた `TCHG` が効くフレームでは、パーツはセルマップ名ではなくテクスチャ*ファイル*名のハッシュでバインドします。そのため、そのフレームにはセルマップ名の差し替えは効きません。そのフレームも着せ替えたい場合は、そのファイル名（`getReplaceableTextureNames()` に出る `xxx.png`）を対象にしてください。
- **復元は再ロードしません。** オーバーライドは読み込み済みテクスチャを*上書き*するのではなく*上に重ねる*ので、`null` で重ねを外すだけで元テクスチャが戻ります。フェッチは発生せず、埋め込み（`--embedded`）テクスチャでも動きます。
- **所有権。** 渡した `Texture`（PixiJS）や `SSTextureEntry`（WebGL）は呼び出し側の所有物で、プレイヤーは解放しません。生の画像ソース（WebGL）や `Bitmap`（MZ）は*プレイヤー*が所有する GPU テクスチャにアップロードされ、復元・再差し替え・破棄時にプレイヤーが解放します。
- **インスタンスの子はこのプレイヤーのテクスチャを共有します。** そのため、子のサブアニメーションが使っている名前を差し替えると子にも効きます。オーバーライドがインスタンス境界で止まる Override Layer とは異なります。
- **別の `.ssab` をバインドすると全オーバーライドが解除されます**（セルマップのハッシュは古いパックに属するため）。
- **WebGL のコンテキストロストでオーバーライドは破棄されます。** 元テクスチャは自動で再アップロードされます（[リソースとライフサイクル](/ja/customize/resources) 参照）が、ランタイムのオーバーライドは復元されません。コンテキストロスト後は再適用してください。

## 描画への反映について

パーツオーバーライドと同様、テクスチャ差し替えは**フレーム番号を変えずに出力を変えます**。そのため「フレームが進まないと再描画しない」実装では反映されないことがあります。ForWeb の各プレイヤーの挙動は次のとおりです。

| プレイヤー | 挙動 |
|---|---|
| `SSPlayer`（PixiJS） | 停止中は ticker が早期 return しますが、オーバーライドと同じく、差し替えると現在フレームを自動で再描画します |
| `SSPlayer`（WebGL） | 内蔵の RAF ループが毎フレーム無条件に `draw()` するため、そのまま反映されます。**フレームを自前で駆動している場合**のみ `draw()` を呼んでください |
| RPG ツクール MZ | MZ が毎フレーム描画するため、そのまま反映されます |

## Web Component からの使い方

`<ss-player>` 要素は再生系のメソッドだけを持つため、差し替えは `el.player`（下層の `SSPlayer`）経由で呼び出します。詳しくは [WebGL・Web Components で使う](/ja/usage/webgl) を参照してください。テクスチャ差し替えには、プラグインコマンドや TyranoScript タグのオーサリング面はまだありません。現時点ではコードから使う機能です。
