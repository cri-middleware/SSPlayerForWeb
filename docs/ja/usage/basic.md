# 基本的な再生

`SSCanvasPlayer`（WebGL）および `SSPlayer`（PixiJS v8）の共通の再生制御 API をまとめます。API の多くは両者で共通しています。読み込み〜再生の最小手順は [クイックスタート](/ja/setup/quickstart) を参照してください。

## 読み込みとアニメーション選択

```ts
await player.load(ssabUrl); // テクスチャは .ssab と同じディレクトリから読み込まれます
```

WebGL (`SSCanvasPlayer`):
```ts
await player.setAnimation(name);                       // アニメーションを選択
```

PixiJS (`SSPlayer`):
```ts
await player.setAnimation(name); // 第2引数: loop回数(既定-1)
player.animationName;            // 現在のアニメーション名
```

## 再生制御

```ts
player.play();              // 再生開始（引数で startFrame を指定可）
player.pause();             // 一時停止
player.resume();            // 再開
player.stop();              // 停止
```

## フレーム・速度

**共通プロパティ:**
```ts
player.frame;               // 現在フレーム（get / set）
player.speedScale = 1.5;    // 再生速度倍率
player.subFrameEnabled;     // サブフレーム補間（既定 on。スロー再生や高リフレッシュで滑らか）
player.isPlaying;           // 再生中か
```

**PixiJS (`SSPlayer`) 固有の拡張プロパティ:**
```ts
player.fps;                 // フレームレート（get / set）
player.totalFrames;         // 総フレーム数
player.startFrame;          // 開始フレーム
player.endFrame;            // 終了フレーム
player.loopCount;           // 設定したループ回数（-1 = 無限）
player.isPausing;           // 一時停止中か
```

## 区間・方向 (PixiJS `SSPlayer` 固有)

```ts
player.setAnimationSection(startFrame, endFrame);      // 再生区間を限定
player.setPlaybackDirection(direction, style);         // 方向 / スタイル
player.subframe = false;                               // frameSkip と一緒に off にする
player.frameSkipEnabled = false;                       // フレームスキップを止める（subframe も off にしないとタイミングが崩れる）
```

## パーツ照会 (PixiJS `SSPlayer` 固有)

```ts
player.getPartsCount();                 // パーツ数
player.getPartIndexFromName('body');    // 名前 → インデックス
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
