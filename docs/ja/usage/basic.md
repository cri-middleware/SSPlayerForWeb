# 基本的な再生

`SSPlayer`（WebGL）および `SSPlayer`（PixiJS v8）の共通の再生制御 API をまとめます。API の多くは両者で共通しています。読み込み〜再生の最小手順は [クイックスタート](/ja/setup/quickstart) を参照してください。

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
```

サブフレーム補間は既定で on です（スロー再生や高リフレッシュ環境で滑らかになります）。
プロパティ名は WebGL プレイヤーが `subFrameEnabled`、PixiJS プレイヤーが `subframe` です。

## 区間・方向

```ts
player.setAnimationSection(startFrame, endFrame);      // 再生区間を限定
player.setPlaybackDirection(direction, style);         // 方向 / スタイル
player.frameSkipEnabled = false;                       // フレームスキップを止める（サブフレームも off にしないとタイミングが崩れる）
```

区間を設定すると `startFrame` / `endFrame` / `totalFrames` はいずれもその区間に追従します。

## パーツ照会

```ts
player.getPartsCount();          // パーツ数
player.findPartIndex('body');    // 名前 → インデックス（不明なら -1）
```

PixiJS プレイヤーには同じ照会の旧名 `getPartIndexFromName()` もあります。

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
