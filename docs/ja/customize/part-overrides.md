# パーツ制御（表示 / セル / 色）

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

パーツ単位のランタイムオーバーライドは、「このパーツを**今**この色に / このセルに / 非表示に」とスクリプトから指示する機能です。オーバーライドはキーフレームやアニメーションのブレンドよりも優先されるので、アニメーションと取り合いになりません。

`SSPlayer`（PixiJS・WebGL の両バックエンド）の両方で、同じメソッド名で使えます。

▶️ **<a href="../../examples/override/" target="_blank" rel="noreferrer">ライブデモ</a>** — 色 / 表示 / セルの 3 種類を順に切り替えるサンプル（ソースは `examples/override-example`）

## 基本的な使い方

```ts
import { SSBlendOp, SSOverridePriority } from '@spritestudio/ssplayer-pixi';

// パーツを赤く着色（乗算）。通常（画像）パーツに適用されます。
player.setPartColorOverride('body', 0xff0000ff, SSBlendOp.Mul);

// 別のセルを描画させる（セルマップ名は ".ssce" を付けずに指定）。
player.setPartCellOverride('body', 'Ringo', 'effect3');

// パーツを強制非表示にする（子孫にもカスケード）。
player.setPartVisibilityOverride('body', true, true);

// 解除
player.clearPartColorOverride('body');
player.clearAllPartOverrides();
```

## API 一覧

| メソッド | 説明 |
|---|---|
| `findPartIndex(partName)` | パーツインデックス。現在のアニメーションに無ければ `-1` |
| `setPartColorOverride(part, rgba, blendOp?, priority?)` | パーツカラーオーバーライド（単色を 4 隅すべてに適用） |
| `setPartColorOverrideCorners(part, corners, blendOp?, priority?)` | 4 隅を個別に指定（グラデーション） |
| `setPartCellOverride(part, cellmapName, cellName, priority?)` | 別のセルで描画する |
| `setPartVisibilityOverride(part, hide, cascade?)` | 強制非表示（`hide = false` でアニメーションに戻す） |
| `clearPartColorOverride` / `clearPartCellOverride` / `clearPartVisibilityOverride` | 1 パーツの 1 オーバーライドを解除 |
| `clearAllPartOverrides()` | そのプレイヤーの全オーバーライドを解除 |
| `getCellmapNames()` / `getCellNames(cellmapName)` | セルオーバーライドに指定できるセルマップ名 / セル名の列挙 |

各メソッドの `part` は**パーツ名**と**パーツインデックス**のどちらでも渡せます（`number | string`）。パーツが不明な場合やランタイムが受け付けなかった場合は `false` を返します。

`priority` の既定は `HoldUntilNextAnimation`、`cascade` の既定は `false` です。

> **パーツインデックスの使い方について**: パーツインデックスは同一アセット（同じ `.ssab`）内では安定しているので、頻繁にオーバーライドするなら `findPartIndex()` で一度パーツ名をパーツインデックスに解決して、そのインデックスを使い回すことを推奨します。

セルオーバーライドに指定できる名前は、プレイヤーから列挙できます。

```ts
player.getCellmapNames();          // → ["Ringo", ...]
player.getCellNames('Ringo');      // → ["effect3", ...]
```

## 色の指定

色は **`0xRRGGBBAA` にパックした数値**で渡します。ランタイムが受け取る形式そのままです。

```ts
player.setPartColorOverride('body', 0x0033ffbf, SSBlendOp.Mix);  // 半透明の青

// 4 隅を個別に指定する場合の順序は「左上・右上・左下・右下」です。
player.setPartColorOverrideCorners('body', [
  0xff0000ff, // 左上
  0x00ff00ff, // 右上
  0x0000ffff, // 左下
  0xffffffff, // 右下
], SSBlendOp.Mix);
```

> **アルファを二重に適用しないでください**: 指定した色のアルファは、そのパーツの合成済みアルファとランタイム側で自動的に pre-multiply されます。オーサリングされたパーツカラーとまったく同じ規則なので、`player.alpha` などを自前で掛け合わせないでください。

> **4 隅の順序**を取り違えると、グラデーションの方向が狂った状態になります。

## 合成モード（`SSBlendOp`）

`blendOp` は、キーフレームのパーツカラーと同じ 4 種です。

| 値 | 合成モード |
|---|---|
| `SSBlendOp.Mix`（`0`） | ミックス |
| `SSBlendOp.Mul`（`1`） | 乗算 |
| `SSBlendOp.Add`（`2`） | 加算 |
| `SSBlendOp.Sub`（`3`） | 減算 |

範囲外の値を渡した場合は設定に失敗し、`false` を返します。

## 優先モード（`SSOverridePriority`）

パーツカラーとセルのオーバーライドはアニメーションと競合するため、`priority` を取ります（表示指定にはありません。単なる強制非表示フラグで、アニメーションを設定し直すと必ずクリアされます）。

| 値 | 優先モード | 挙動 |
|---|---|---|
| `0` | `OverwriteOnNextKeyframe` | アニメーションデータが当該アトリビュートを更新するまで、オーバーライドが適用される |
| `1` | `HoldUntilNextAnimation`（既定） | 現在のアニメーション中は勝ち続け、新しいアニメーションを設定するとオーバーライドが解除される |
| `2` | `Permanent` | 同じアニメーションデータ（`.ssab`）である間、オーバーライドが適用される（アニメーション変更をまたいでも持続） |

## 注意点

- **カラー**は通常パーツ、**セル**は通常パーツとマスクパーツに適用されます。それ以外の種別のパーツでは黙って無視されます（呼び出し自体は `true` を返します）。
- 色はオーサリングされたパーツカラーと同じ 8bit sRGB 空間として解釈されます。自前で linear 変換などをせず、オーサリングどおりの色を渡してください。
- セルオーバーライドは設定時に解決されるため、存在しないセルマップ名 / セル名はその場で失敗します（`false` を返します）。毎フレームの探索は発生しません。
- 差し替え先のセルが別テクスチャの場合、そのパーツは別の `DrawBatch` に切り出されます。通常どおり描画されますが、「バッチ数が固定である」ことを前提にした最適化を自前で書いている場合は注意してください。
- オーバーライドはランタイムが保持し、そのライフサイクルもランタイムが管理します。**アニメーション変更後に再適用する必要はありません**。毎フレーム設定し直す実装にはしないでください。意図に合った優先モードを選んでください。
- 別の `.ssab` をバインドすると、パーツの同一性が失われるため全オーバーライドが解除されます。
- インスタンスパーツ**配下**のパーツには届きません（子アニメーションは別のプレイヤーとして動作するためです）。配下のパーツを操作したい場合は、子プレイヤーに対して呼んでください。

## 描画への反映について

オーバーライドは**フレーム番号を変えずに出力を変えます**。そのため「フレームが進まないと再描画しない」実装では、設定しても画面に反映されないことがあります。ForWeb の各プレイヤーは、これを内部で吸収済みです。

| プレイヤー | 挙動 |
|---|---|
| `SSPlayer`（PixiJS） | 停止中は ticker が早期 return しますが、オーバーライドの適用に成功すると現在フレームを自動で再描画します |
| `SSPlayer`（WebGL） | 内蔵の RAF ループが毎フレーム無条件に `draw()` するため、そのまま反映されます。**フレームを自前で駆動している場合**のみ、`draw()` を呼んでください |
| RPG ツクール MZ | MZ が毎フレーム描画するため、そのまま反映されます |

## 各ホストからの使い方

コードを書かないホスト向けには、それぞれの流儀のオーサリング面を用意しています。

- **`<ss-player>` Web Component** — 要素自体は再生系のメソッドだけを持つ薄い皮なので、オーバーライドは `el.player`（下層の `SSPlayer`）経由で呼び出します。詳しくは [WebGL・Web Components で使う](/ja/usage/webgl) を参照してください。
- **RPG ツクール MZ** — イベントの**プラグインコマンド**（SSパーツ色変更 / SSパーツ表示切替 / SSパーツセル差替 / SSパーツ上書き解除）から操作できます。設定内容はピクチャに保存され、**セーブ・ロードをまたいでも復元されます**。詳しくは [RPG ツクール MZ で使う](/ja/usage/rmmz) を参照してください。
- **TyranoScript** — シナリオに `[ss_part_color]` / `[ss_part_visible]` / `[ss_part_cell]` / `[ss_part_clear]` タグを書いて操作できます。設定内容はセーブに含まれ、`[ss_restore]` で復元されます。詳しくは [TyranoScript で使う](/ja/usage/tyrano) を参照してください。
- **ティラノビルダー** — 同じ 4 つのタグを、エディタの「ティラノスクリプト」コンポーネントから記述します（専用のパレット項目はまだありません）。詳しくは [ティラノビルダーで使う](/ja/usage/tyranobuilder) を参照してください。

## この機能で扱わないもの

以下は目的が近く混同しやすいのですが、オーバーライドの担当範囲ではありません。

| やりたいこと | 正しい方法 |
|---|---|
| テクスチャ / セルマップまるごとの差し替え | [テクスチャ差し替え（着せ替え）](/ja/customize/texture-replacement) — セルマップにバインドされたテクスチャまるごとを差し替えます。こちらは**パーツ 1 つ単位**でセルを差し替える機能です |
| 反転（フリップ） | プレイヤー側の変換（スケール反転）で表現します |
| オブジェクト全体の色 / 不透明度 / 描画順 | プレイヤー（`SSPlayer` / コンテナ）側のプロパティで指定します。パーツ単位の関心事ではありません |
| インスタンスパーツの差し替え | 将来対応予定です（SDK の Instance Lifecycle API 待ち） |
