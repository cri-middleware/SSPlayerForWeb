# 基本的な再生

`SSPlayer`（WebGL）および `SSPlayer`（PixiJS v8）の共通の再生制御 API をまとめます。API の多くは両者で共通しています。読み込み〜再生の最小手順は [クイックスタート](/ja/setup/quickstart) を参照してください。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/webgl/" target="_blank" rel="noreferrer">WebGL デモ</a>** ·
**<a href="../../examples/pixi/" target="_blank" rel="noreferrer">PixiJS デモ</a>** —
このページの API が動いている状態をバックエンド別に見られます。どちらも `.ssab` のドロップ再生に対応しています（最初のリリース公開後に有効化されます 🚧）。

## 読み込みとアニメーション選択

```ts
await player.load(ssabUrl); // テクスチャ・インスタンスパック・サウンドは .ssab と同じディレクトリから読み込まれます
```

```ts
player.setAnimation(name);  // アニメーションを選択（WebGL / PixiJS 共通）
player.animationName;       // 現在のアニメーション名
```

再生設定は引数ではなくプロパティです。`loopCount` や `speedScale` などはアニメーション選択後に
設定してください（[再生制御](#再生制御)）。

`setAnimation` は同期です。`.ssab` が必要とするアセットはアニメーション単位ではなくパック単位なので
`load()` で全て読み込まれ、切り替えはランタイムのリセットのみ — 待つべき読み込みはありません。

## 再生制御

```ts
player.play();              // 再生開始（引数で startFrame を指定可）
player.pause();             // 一時停止
player.resume();            // 再開
player.stop();              // 停止
```

## フレーム・速度

```ts
player.frame;               // 現在フレーム（get / set）
player.speedScale = 1.5;    // 再生速度倍率
player.isPlaying;           // 再生中か
player.isPausing;           // 一時停止中か
player.fps;                 // フレームレート（get / set）
player.totalFrames;         // 現在の再生範囲のフレーム数
player.startFrame;          // 範囲の開始フレーム
player.endFrame;            // 範囲の終了フレーム
player.loopCount;           // 設定したループ回数（-1 = 無限）
player.animationName;       // 現在設定されているアニメーション名
player.subFrameEnabled;     // サブフレーム補間（既定 on。スロー再生や高リフレッシュで滑らか）
```

## 区間・方向

```ts
player.setAnimationSection(startFrame, endFrame);      // 再生区間を限定
player.setPlaybackDirection(direction, style);         // 方向 / スタイル
player.frameSkipEnabled = false;                       // フレームスキップを止める（サブフレームも off にしないとタイミングが崩れる）
```

区間を設定すると `startFrame` / `endFrame` / `totalFrames` はいずれもその区間に追従します。

## 反転とオフセット

```ts
player.flipX = true;        // 左右反転
player.flipY = true;        // 上下反転
player.offsetX = 20;        // 描画位置をずらす（アニメーションローカルのピクセル）
player.offsetY = -10;
```

4 つとも変えるのは **そのプレイヤーが描くものだけ** で、表示オブジェクト自身の変換には触れません。

```ts
// 進行方向を向く
player.flipX = velocityX < 0;
```

`player.scale.x = -1`（WebGL なら `setTransform({ scaleX: -1 })`）でも絵は同じように反転します。
違うのは **反転したことを誰が知っているか** です。

| | `flipX` | `scale.x = -1` |
|---|---|---|
| アニメーションの絵 | 反転する | 反転する |
| `getPartTransform()` の戻り値 | **反転を含む**（実際に描かれている位置を返す） | 含まない（反転は表示オブジェクト側にあるため） |
| プレイヤーの `scale` | 大きさ専用のまま使える | 向きと大きさを兼ねるので、拡縮と併用するなら符号を自分で掛ける |
| プレイヤーにぶら下げた子（MZ のネームプレート等） | **そのまま** | 一緒に反転する |

`flipX` の利点は、**プレイヤーの外側にいるものが反転を知らずに済む**ことです。DOM オーバーレイ、当たり判定の座標、別コンテナに置いたオブジェクト、`attachToPart(..., { addAsChild: false })` のターゲット — いずれも `getPartTransform()` を読むだけで正しい位置に付いてきます。`scale.x = -1` の場合は、これらすべてにホスト側で反転を掛け直す必要があります。

逆に、`attachToPart()` を既定オプションで使っている分には**両者に見た目の差はありません**。既定は3 軸すべて駆動なので、どちらのやり方でもターゲットは反転後のパーツに乗り、ターゲット自身の絵も裏返ります（詳しくは [パーツトラッキング](/ja/customize/part-following)）。

> **PixiJS 版の注意**: `SSPlayer`（PixiJS）はフレームごとに自身の子を組み直すため、ホストが`player.addChild()` したものは次のフレームで消えます。プレイヤーの隣（兄弟）に置くか、`attachToPart()` を使ってください。RPG ツクール MZ 版は生の GL で描くのでこの制限がなく、子をそのまま保持できます。

補足:

- **オフセットは反転の後に適用されます**（`p' = S*p + O`）。`flipX` を立ててもオフセットの向きは裏返りません。
- 単位は**アニメーションローカルのピクセル**です。表示オブジェクトの変換の下に入るので、プレイヤーを拡大縮小していればオフセットもその分だけ拡大縮小されます。
  WebGL の `setTransform({ x, y })` とは別物で、あちらはプレイヤーそのものを動かします。
- インスタンスパーツの子アニメーションは、親の反転を階層で受け継ぎます。子に対して個別に設定する必要はありません（設定しても効果はありません）。
- `getPartTransform()` が返す変換にも反映されます。詳しくは [パーツトラッキング](/ja/customize/part-following) を参照してください。

TyranoScript / TyranoBuilder のタグは用意していません。スクリプトからプレイヤーを取得して設定してください。

## パーツ照会

```ts
player.getPartsCount();          // パーツ数
player.findPartIndex('body');    // 名前 → インデックス（不明なら -1）
```

パーツ単位で色 / セル / 表示を実行時に上書きするには
[パーツ制御（表示 / セル / 色）](/ja/customize/part-overrides) を参照してください
（こちらは PixiJS・WebGL 共通です）。

---

## Web Components (`<ss-player>`)

WebGL 版パッケージでは、HTML に記述するだけで簡単に利用できる Custom Element (`<ss-player>`) も提供しています。

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  defineSSPlayerElement(); // <ss-player> を登録
</script>

<!-- src に ssab のパス、animation にアニメーション名を指定 -->
<ss-player src="/assets/Ringo.ssab" animation="run" autoplay speed="1.5" style="width: 640px; height: 480px;"></ss-player>
```

JavaScript から DOM 要素を取得して、`play()` / `pause()` などのメソッドを呼ぶことも可能です。

---
タイムラインイベント（ユーザーデータ / シグナル / サウンド）や着せ替えなどの作り込みは [カスタマイズ](/ja/customize/events) を参照してください。
