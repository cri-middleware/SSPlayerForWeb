# 基本的な再生

`SSPlayer`（PixiJS v8）の再生制御 API をまとめます。読み込み〜再生の最小手順は
[クイックスタート](/setup/quickstart) を参照してください。

## 読み込みとアニメーション選択

```ts
await player.load(ssabUrl, assetBaseUrl?);   // .ssab を読み込む
await player.setAnimation(name, loop?, assetBase?);  // loop 既定は -1（無限）
player.animationName;                          // 現在のアニメーション名
```

## 再生制御

```ts
player.play(startFrame?);   // 再生開始（startFrame 省略時は先頭）
player.pause();             // 一時停止
player.resume();            // 再開
player.stop();              // 停止
```

## フレーム・速度

```ts
player.frame;               // 現在フレーム（get / set）
player.speedScale = 1.5;    // 再生速度倍率
player.fps;                 // フレームレート（get / set）
player.subframe = true;     // サブフレーム補間（スロー再生や高リフレッシュで滑らか）

player.totalFrames;         // 総フレーム数
player.startFrame;          // 開始フレーム
player.endFrame;            // 終了フレーム
player.loopCount;           // 完了したループ回数
player.isPlaying;           // 再生中か
player.isPausing;           // 一時停止中か
```

## 区間・方向

```ts
player.setAnimationSection(startFrame, endFrame);      // 再生区間を限定
player.setPlaybackDirection(direction, style);         // 方向 / スタイル
player.frameSkipEnabled = true;                        // 重いフレームのスキップ
```

## パーツ照会

```ts
player.getPartsCount();                 // パーツ数
player.getPartIndexFromName('body');    // 名前 → インデックス
```

タイムラインイベント（ユーザーデータ / シグナル / サウンド）や着せ替えなどの
作り込みは [カスタマイズ](/customize/events) を参照してください。
