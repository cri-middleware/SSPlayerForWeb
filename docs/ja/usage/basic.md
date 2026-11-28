---
description: WebGL と PixiJS のプレイヤーに共通する再生制御 API。読み込み、再生・一時停止、フレームと速度、方向、反転、パーツ照会。
---

# 基本的な再生

`SSPlayer`（WebGL）および `SSPlayer`（PixiJS v8）の共通の再生制御 API をまとめます。API の多くは両者で共通しています。読み込み〜再生の最小手順は [クイックスタート](../setup/quickstart.md) を参照してください。

▶️ **[WebGL デモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** ·
**[PixiJS デモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** —
このページの API が動いている状態をバックエンド別に見られます。どちらも `.ssab` のドロップ再生に対応しています。

## 読み込みとアニメーション選択

```ts
await player.load(ssabUrl); // テクスチャ・インスタンスパック・サウンドは .ssab と同じディレクトリから読み込まれます
// または: await player.loadBuffer(ssabBytes, new Map()); // メモリ上の .ssab（ドロップ、インライン）。Map はセルマップのハッシュ別テクスチャで、embedded の .ssab なら空
```

```ts
player.setAnimation(name);  // アニメーションを選択（WebGL / PixiJS 共通）
player.currentAnimation;       // 現在のアニメーション名
```

再生設定は引数ではなくプロパティです（[再生制御](#playback-control)）。これらはアニメーションではなく呼び出し側のものなので、`setAnimation` を跨いで保持されます。`loopCount = 3` は切り替え後も
3 回のままです。

`setAnimation` は同期です。`.ssab` が必要とするアセットはアニメーション単位ではなくパック単位なので`load()` で全て読み込まれ、切り替えはランタイムのリセットのみ — 待つべき読み込みはありません。

有効なのは最後の `load()` だけです。追い越された `load()` は何もバインドせずに解決するので、パックを素早く切り替えるページは、続ける前に `player.internalPlayer.ssabUrl` と求めた URL を比べてください。

すでに選んでいるアニメーションをもう一度選んでも何も起きません。再生位置・区間・上書きはそのままです。最初から再生し直すには `play()` を呼びます。区間と `isFinished` が戻るのは、実際に別のアニメーションへ切り替えたときだけです。

## 再生制御 {#playback-control}

```ts
player.play();              // 再生開始（引数で startFrame を指定可）
player.pause();             // 一時停止
player.resume();            // 再開
player.stop();              // 停止 — 再生ヘッドはその場に留まる（先頭に戻すのは play()）
```

## フレーム・速度

```ts
player.frameNo;             // 現在フレーム。小数（get / set）
player.speedScale = 1.5;    // 再生速度倍率
player.isPlaying;           // 再生セッションが有効か（一時停止中も true。isPlaying && !isPausing で「実際に進行中」）
player.isPausing;           // 一時停止中か
player.isFinished;          // 設定したループを全て再生し終えたか。次の play() / setAnimation() まで貼り付き、
                            // 無限ループでは立たず、stop() でも立たない（＝自然に終わったのか止めたのかを区別できる）
player.frameRate;                 // フレームレート（get / set）
player.totalFrames;         // 現在の再生範囲のフレーム数
player.startFrame;          // 範囲の開始フレーム
player.endFrame;            // 範囲の終了フレーム
player.loopCount;           // 設定したループ回数（-1 = 無限。0 も無限を意味します）
player.currentAnimation;       // 現在設定されているアニメーション名
player.subFrameEnabled;     // サブフレーム補間（既定 on。スロー再生や高リフレッシュで滑らか）
```

`subFrameEnabled` を off にすると変わるのは **描画される** フレーム（レンダラは floor したフレームを表示します）で、`frameNo` が返す値ではありません。再生ヘッドはどちらでも小数を保つので、off のまま行ったシークは on に戻したときもそのままの位置にあります。

## 区間・方向

```ts
player.setAnimationSection(startFrame, endFrame);      // 再生区間を限定
player.setPlaybackDirection(WebPlaybackDirection.Backward, WebPlaybackStyle.PingPong);  // 方向（Forward | Backward）/ スタイル（Normal | PingPong）
player.frameSkipEnabled = false;                       // フレームスキップを止める（サブフレームも off にしないとタイミングが崩れる）
```

区間を設定すると `startFrame` / `endFrame` / `totalFrames` はいずれもその区間に追従します。

両端を含むので、`setAnimationSection(10, 10)` は 10 フレームで止まります。アニメーションの外の端（`-1`）は、その側のアニメーションの端になります。両端がアニメーションの中で、終わりが始まりより前の区間は受け付けません。`setAnimationSection` は `false` を返してコンソールに 1 度だけ知らせ、区間と再生位置はそのままにします。

区間の両端は、今のアニメーションのラベルで指定することもできます。それぞれにフレーム数のオフセットを足せます。

```ts
player.setAnimation('attack');
player.setAnimationSectionByLabel('windup', 'hit', 0, -1); // `hit` の 1 フレーム手前まで
```

`_start` と `_end` は SpriteStudio と同じくアニメーションの最初と最後のフレームを指します。アニメーションに無いラベルを渡したときと、ラベルとオフセットから出たフレームが `setAnimationSection` の受け付けない区間になったときは、`false` を返してコンソールに 1 度だけ知らせ、区間はそのままにします。`setAnimationSection` と同じく再生は始めず、別のアニメーションに切り替えると消えます。

## 反転とオフセット {#flip-and-offset}

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

`player.scale.x = -1`（WebGL なら `setTransform({ scaleX: -1 })`）でも絵は同じように反転します。違うのは **反転したことを誰が知っているか** です。

| | `flipX` | `scale.x = -1` |
|---|---|---|
| アニメーションの絵 | 反転する | 反転する |
| `getPartTransform()` の戻り値 | **反転を含む**（実際に描かれている位置を返す） | 含まない（反転は表示オブジェクト側にあるため） |
| プレイヤーの `scale` | 大きさ専用のまま使える | 向きと大きさを兼ねるので、拡縮と併用するなら符号を自分で掛ける |
| プレイヤーにぶら下げた子（MZ のネームプレート等） | **そのまま** | 一緒に反転する |

`flipX` の利点は、**プレイヤーの外側にいるものが反転を知らずに済む**ことです。DOM オーバーレイ、当たり判定の座標、別コンテナに置いたオブジェクト、`attachToPart(..., { addAsChild: false })` のターゲット — いずれも `getPartTransform()` を読むだけで正しい位置に付いてきます。`scale.x = -1` の場合は、これらすべてにホスト側で反転を掛け直す必要があります。

逆に、`attachToPart()` で 3 軸すべてを駆動している（`scale: true`）場合は**両者に見た目の差はありません**。どちらのやり方でもターゲットは反転後のパーツに乗り、ターゲット自身の絵も裏返ります。既定の `scale: false` では差が出ます。`scale.x = -1` は子のターゲットを階層ごと裏返しますが、`flipX` ではターゲットの向きに 180 度の差が残ります（詳しくは [パーツトラッキング](../customize/part-following.md)）。

補足:

- **オフセットは反転の後に適用されます**（`p' = S*p + O`）。`flipX` を立ててもオフセットの向きは裏返りません。
- 単位は**アニメーションローカルのピクセル**です。表示オブジェクトの変換の下に入るので、プレイヤーを拡大縮小していればオフセットもその分だけ拡大縮小されます。
  WebGL の `setTransform({ x, y })` とは別物で、あちらはプレイヤーそのものを動かします。
- インスタンスパーツの子アニメーションは、親の反転を階層で受け継ぎます。子に対して個別に設定する必要はありません（設定しても効果はありません）。
- `getPartTransform()` が返す変換にも反映されます。詳しくは [パーツトラッキング](../customize/part-following.md) を参照してください。

TyranoScript / TyranoBuilder のタグは用意していません。スクリプトからプレイヤーを取得して設定してください。

## パーツ照会

```ts
player.getPartNames();          // 全パーツ名（インデックス順。個数は .length）
player.findPartIndex('body');    // 名前 → インデックス（不明なら -1）
```

パーツ単位で色 / セル / 表示を実行時に上書きするには[パーツ制御（表示 / セル / 色）](../customize/part-overrides.md) を参照してください（こちらは PixiJS・WebGL 共通です）。

---

## Web Components (`<ss-player>`)

WebGL 版パッケージでは、HTML に記述するだけで簡単に利用できる Custom Element (`<ss-player>`) も提供しています。

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  defineSSPlayerElement(); // <ss-player> を登録
</script>

<!-- src に ssab のパス、animation にアニメーション名を指定 -->
<ss-player src="/assets/Ringo.ssab" animation="run" autoplay speed-scale="1.5" style="width: 640px; height: 480px;"></ss-player>
```

JavaScript から DOM 要素を取得して、`play()` / `pause()` などのメソッドを呼ぶことも可能です。

---
タイムラインイベント（ユーザーデータ / シグナル / サウンド）や着せ替えなどの作り込みは [カスタマイズ](../customize/events.md) を参照してください。
