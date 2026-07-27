# パーツトラッキング（指定パーツへの追従）

指定したパーツに、ユーザーが用意した表示オブジェクト（武器・エフェクト・当たり判定など）を毎フレーム追従させる機能です。プレイヤーはオブジェクトを生成も破棄もせず、渡されたオブジェクトを駆動するだけの連動（Constraint）方式で、ターゲットのライフサイクルはユーザーが所有します。

提供の形はレンダラごとに異なり、**全プレイヤー共通のプル API** と、シーングラフを持つプレイヤーだけの**自動追従**の 2 層構成になっています。

| プレイヤー | 追従の方法 |
|---|---|
| `SSPlayer`（PixiJS） | `attachToPart()` による自動追従 ＋ プル API |
| `SSPlayer`（RPG ツクール MZ） | `attachToPart()` による自動追従 ＋ プル API |
| `SSCanvasPlayer`（WebGL） | シーングラフを持たないため**プル API のみ**（`getPartTransform()` ＋ `onFrame()`） |

## 基本的な使い方

```ts
import { Container } from 'pixi.js';

const sword = new Container();  // ターゲットはユーザーが所有する

// "FrontHand" パーツに追従させる（既定は位置・回転・スケールすべて）
const attachment = player.attachToPart('FrontHand', sword);

// 位置と回転だけ追従させ、パーツが hide のフレームではターゲットも隠す
player.attachToPart('effect_root', effect, {
  scale: false,
  onHide: 'hide',
});

// 解除
attachment.detach();
// または
player.detachFromPart(sword);
```

## API 一覧

| メソッド | 説明 |
|---|---|
| `attachToPart(part, target, options?)` | ターゲットをパーツに追従させる。`SSPartAttachment`（`target` と `detach()` を持つハンドル）を返す。**PixiJS / MZ のみ** |
| `detachFromPart(target)` | その `target` の追従を解除する。**PixiJS / MZ のみ** |
| `getPartTransform(part, out?)` | そのパーツの現在フレームの変換行列（2D アフィン `[m00, m01, m10, m11, tx, ty]`）。パーツが不明なら `null` |
| `isPartHidden(part)` | そのパーツが現在フレームで hide かどうか。パーツが不明なら `null` |
| `onFrame(cb)` | フレームが進むたびに発火する（ワールド行列が確定した後）。解除用の関数（`Unsubscribe`）を返す |
| `findPartIndex(partName)` | パーツインデックス。現在のアニメーションに無ければ `-1` |

各メソッドの `part` は**パーツ名**と**パーツインデックス**のどちらでも渡せます（`number | string`）。

> **パーツインデックスの使い方について**: パーツインデックスは同一アセット（同じ `.ssab`）内では安定しているので、毎フレーム自前で読み出すなら `findPartIndex()` で一度パーツ名を解決して、そのインデックスを使い回すことを推奨します。

> オブジェクトを常時追従させるまでもなく「その瞬間のパーツ位置だけ知りたい」場合（弾の発射位置を取るなど）は、`attachToPart()` を使わず `getPartTransform()` を直接呼ぶ方が簡潔です。

## 追従オプション（`SSPartFollowOptions`）

| オプション | 既定 | 説明 |
|---|---|---|
| `position` | `true` | 位置を駆動する |
| `rotation` | `true` | 回転を駆動する |
| `scale` | `true` | スケールを駆動する |
| `onHide` | `'follow'` | パーツが hide のフレームでの挙動。`'follow'`（追従を継続）/ `'hide'`（ターゲットも隠す） |
| `addAsChild` | `true` | ターゲットをプレイヤーの子として追加する。子にするとプレイヤー自身の変換を階層継承し、パーツと完全に一致する |

3 軸（`position` / `rotation` / `scale`）がすべて ON の場合はアフィン行列をそのまま適用するため、**せん断（Skew）や反転（Flip）も含めて厳密に一致**します。一部だけ ON の場合は行列を TRS（平行移動 × 回転 × スケール）に分解して有効な軸だけを書き込み、無効な軸はターゲット自身の値を保持します。

> 分解は「せん断を含まない TRS の合成」を前提とします。せん断のあるパーツを一部の軸だけ追従させると近似になるため、厳密さが必要な場合は 3 軸すべてを ON にするか、`getPartTransform()` の生アフィン変換行列を直接使ってください。

## 追従のタイミングと精度

追従の駆動は、そのフレームのワールド行列が確定した後に行われます。ターゲットは**同じフレーム内**で更新されるため、1 フレーム遅れることはありません。

| プレイヤー | 駆動のタイミング |
|---|---|
| `SSPlayer`（PixiJS） | `renderFrame()` の末尾。そのフレームのメッシュを配置した**後**なので、ターゲットはアニメーションより手前に描画されます |
| `SSPlayer`（MZ） | `update()` 内、イベント配信の後 |
| `SSCanvasPlayer`（WebGL） | 自動追従はありません（`onFrame` がワールド行列の確定後に発火します） |

`getPartTransform()` が返すのは**アニメーションローカル・Y-down**（パーツが描画される空間そのもの）のアフィン変換行列です。ターゲットをどこに置くかで、一致の度合いが変わります。

- `addAsChild: true`（既定）ならターゲットはプレイヤーの子になるため、プレイヤー自身の変換を階層継承し、**パーツと完全に一致**します。
- `addAsChild: false` の場合、ターゲットは元々いる場所のまま駆動されます。一致するのは、ターゲットがプレイヤーと同じ座標空間を共有している間だけです。
- WebGL プレイヤーで DOM 要素や別 canvas を追従させる場合は、このアフィンに表示側の変換（`transformMatrix` とプロジェクション）を自前で合成する必要があります。

### 再生状態による違い

追従は再生の駆動に乗って動きます。

- **停止中（`stop()`）** — `SSPlayer`（PixiJS / MZ）は `update()` が早期 return するため、**追従も `onFrame` も止まります**。停止したまま `player.frame` でシークしても追従は更新されません。
- **一時停止中（`pause()`）** — `SSPlayer`（PixiJS / MZ）は追従・`onFrame` とも継続します。`SSCanvasPlayer`（WebGL）は `onFrame` を発火しません。

## 手動で追従する（プル API）

シーングラフを持たない `SSCanvasPlayer`（WebGL）や、追従先が表示オブジェクトでない場合（DOM オーバーレイ、当たり判定の座標など）は、`onFrame()` と `getPartTransform()` を組み合わせて自前で駆動します。

```ts
const affine = new Float32Array(6);   // 使い回してアロケーションを避ける

const off = player.onFrame(() => {
  const m = player.getPartTransform('FrontHand', affine);
  if (!m) return;                     // 現在のアニメーションに無いパーツ

  // m = [m00, m01, m10, m11, tx, ty]（アニメーションローカル・Y-down）
  //   x' = m00 * x + m01 * y + tx
  //   y' = m10 * x + m11 * y + ty
  myObject.position.set(m[4], m[5]);
});

off();  // 購読解除
```

`out` 引数（`Float32Array(6)`）を渡すとその配列に書き込まれ、毎フレームのアロケーションを避けられます。返る配列は WASM メモリからコピー済みなので、フレームをまたいで保持しても安全です。

位置・回転・スケールの成分が欲しい場合は、コアが公開している分解ヘルパを使えます。

```ts
import { decomposePartAffine } from '@spritestudio/ssplayer-pixi';

const { x, y, rotation, scaleX, scaleY } = decomposePartAffine(m);
```

> 反転（ミラー）したパーツでは、行列式の符号が `scaleY` に折り込まれて返ります（`scaleY` が負になります）。

## 注意点

- **ターゲットの `visible` はプレイヤーが操作します。** 次の 2 つの場合に自動で非表示化され、条件が解消すると自動で復帰します。
    - パーツ名が現在のアニメーションに存在しない（`onHide` の設定に関係なく常に非表示）
    - パーツが hide のフレームで、かつ `onHide` が `'hide'`
- ただし復帰させるのは**プレイヤー自身が隠した分だけ**です。ユーザーが自分で `visible = false` にしたターゲットは、detach してもそのまま維持されます。
- `isPartHidden()` が見るのは**アニメーションの hide キーフレーム**であり、[パーツ制御](/ja/customize/part-overrides) の `setPartVisibilityOverride()` による強制非表示ではありません。
- パーツのワールド行列は hide に関係なく毎フレーム計算されるため、`onHide: 'follow'`（既定）では**非表示のパーツも追従し続けます**。
- パーツ名は、そのプレイヤー自身が再生しているアニメーションのパーツから解決されます。**インスタンスパーツの内部（子アニメーション）のパーツは指定できません**（インスタンスパーツ自体は指定できます）。
- 同じターゲットを 2 回 `attachToPart()` すると、後の登録が前の登録を置き換えます。
- アニメーションを切り替えるとパーツ名は自動で再解決されるため、登録し直す必要はありません。**同じリグを共有する別の `.ssab` に差し替えた場合も追従は継続します**。
- プレイヤーを `destroy()` すると、全ターゲットが自動で detach されます。ホストが所有するターゲットが破棄されたり、非表示のまま残されたりすることはありません。
- アタッチメントはターゲットへの参照を保持します。ターゲットを先に破棄する場合は、`detach()` してから破棄してください。

## 各ホストからの使い方

- **`<ss-player>` Web Component** — 要素自体は再生系のメソッドだけを持つ薄い皮なので、`el.player`（下層の `SSCanvasPlayer`）経由でプル API を呼び出します。詳しくは [WebGL・Web Components で使う](/ja/usage/webgl) を参照してください。
- **RPG ツクール MZ** — パーツトラッキングに対応するプラグインコマンドはありません。スクリプトから `SSPlayer` のインスタンスを取得して `attachToPart()` を呼んでください。詳しくは [RPG ツクール MZ で使う](/ja/usage/rmmz) を参照してください。
- **TyranoScript / TyranoBuilder** — 現時点ではタグを用意していません。

## この機能で扱わないもの

以下は目的が近く混同しやすいのですが、パーツトラッキングの担当範囲ではありません。

| やりたいこと | 正しい方法 |
|---|---|
| パーツ自体の色 / セル / 表示を変える | [パーツ制御（表示 / セル / 色）](/ja/customize/part-overrides) のオーバーライド API を使います |
| パーツをスクリーン座標で追従させる | 現時点ではプレイヤー側の表示変換を自前で合成してください（スクリーン変換まで返す API は未提供です） |
| インスタンスパーツ配下のパーツに追従させる | 子アニメーションは別のプレイヤーとして動作します。子プレイヤーを取得して、そちらに対して指定してください |
