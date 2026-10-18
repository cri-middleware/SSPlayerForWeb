---
description: タイムライン上のユーザーデータ・シグナル・サウンドを発火したフレームで受け取る方法と、シーク時の扱い。
---

# イベントとユーザーデータ

タイムライン上に設定した**ユーザーデータ / シグナル / サウンド**を、発火したフレームで受け取れます。各購読メソッドは解除用の関数（`Unsubscribe`）を返します。

```ts
const off = player.onUserData((e) => {
  console.log('userData', e.partName ?? e.partIndex);
});

player.onSignal((e) => console.log('signal', e.commandId, e.partName));
player.onAudio((e) => playSound(e.soundName ?? e.soundNameHash, e.loopNum));

player.onAnimationStarted(() => console.log('started'));
player.onAnimationFinished(() => console.log('finished'));
player.onAnimationLooped(() => console.log('looped'));

off(); // 購読解除
```

`onAnimationStarted` / `onAnimationFinished` / `onAnimationLooped` は再生状態から導出されます。ユーザーデータ / シグナル / サウンドはランタイムがフレーム単位で発火します。

イベントの配信中に（別のリスナーの中から）追加したリスナーは、配信中のイベントではなく次のイベントから受け取ります。配信中に解除したリスナーは、そのイベントでは呼ばれません。DOM の `EventTarget` と同じ動作で、1 つの待ちを終えたコールバックの中から次の待ちを始められるのはこのためです。

`onAnimationStarted` は再生が **head-out** したときに発火します。自分のコードからの `play()` に限らず、`autoplay` 属性やホスト側スクリプトが呼んだものも含みます。`resume()` では発火しません —
一時停止の解除は続行であって開始ではないからです。

`onAnimationFinished` は**エッジ**で、再生が完了したティックに 1 回だけ発火します。状態のほうが欲しい場合は `player.isFinished` を読んでください。完了時に latch され、次の `play()` / `setAnimation()`（またはトラック 0 への `crossfade`）まで貼り付くので、エッジが過ぎた後に接続した呼び出し側でも「終わったか」を問えます。どちらも `stop()` では立たず、そこが `!isPlaying` との違いです。

この 3 つはいずれも `partIndex` / `partName` と **`frameNo`** を持ちます。`frameNo` はキーが *置かれている* フレームであって、検出されたフレームとは限りません。1 ティックで複数フレームをまたぐことがあり、その間のキーはすべてそのティックで発火するため、プレイヤーの現在フレームとキーの位置は一致しません。また、発火したアニメーションのハンドルである **`source`** も持ちます（下の説明を参照）。

このほかに、オーサリングされたイベントではなく**フレームが進むたび**に発火する
`onFrame` があります。そのフレームのパーツ変換が確定するタイミングです。詳しくは
[パーツトラッキング](/ja/customize/part-following) を参照してください。

## 複数のアニメーションを再生しているとき

[モーションブレンド](/ja/customize/motion-blending)では 1 つのプレーヤーで複数のアニメーションを同時に再生できますが、既定では**トラック 0 の主アニメーションだけがイベントを発火します**。ほかのトラックのオーバーレイや、トラックに混ぜたもう 1 本のアニメーションは、しきい値をその weight 以下に下げたときだけ発火します。

```ts
const run = player.addTrackSource(0, 'run', 0.3);
player.setSourceEventThreshold(run, 0.3); // weight が 0.3 以上のあいだ発火する
```

トラック 0 の `crossfade` は、イベントを**フェードの開始時に**引き渡します。入ってくる側はフェードの最初のフレームから発火し、出ていく側は止まります。フェードの途中まで出ていく側にも発火させたい場合は、トラックの出ていく側のしきい値を設定します。出ていく側は、その側がトラックに占める割合 `1 - progress` がしきい値以上のあいだ発火します。

```ts
player.setTrackOutgoingEventThreshold(0, 0.5); // 出ていく側はフェードの前半だけ発火する
```

ユーザーデータ・シグナル・サウンドのイベントは、どれも発火したアニメーションのハンドル **`source`** を持ちます。`getTrackMainSource(track)` や `addTrackSource` の戻り値と比べると、トラック 0 のアニメーションか、オーバーレイか、クロスフェードの出ていく側かを区別できます。中身は発火したアニメーションの表から読むので、クロスフェードの後に発火したイベントは入ってくる側のイベントです。

## サウンドの再生

ランタイムは**音を鳴らしません**。`onAudio` はサウンドの参照を渡すだけです。鳴らすのはプレイヤーで、既定で鳴ります。読み込んだ `.ssab` に音があり、`player.audioManager` が設定されていなければ、`load()` が `SSWebAudioManager` を付けて Web Audio で鳴らします。`onAudio` はどちらの場合も発火します。`ssplayer-webgl` は、このアダプターを音のあるパックのときだけ別チャンクとして取得します。

自前のオーディオエンジンで鳴らすには、`IAudioManager` を実装して `load()` より**前に**割り当てます（既定のものは、何も設定されていないときだけ付きます）。`ssplayer-webgl` では、`surface.createPlayer({ autoAudio: false })` で既定のものを付けないようにできます。

```ts
player.audioManager = myAudioManager; // IAudioManager 実装（load() の前に）
```

一度鳴り始めた音は、**それを発火させた再生よりも長く生き残ります**。`pause()` /
`stop()` や `setAnimation()` による切り替えは、いずれも音には触れません（終わらせるのは*アニメーション* であって音ではありません）。マネージャを一掃するのは `destroy()` だけで、その後は voice を持ち主のいない状態にしないためです。SpriteStudio に無限ループの音はなく（`loopNum` は再生回数）、すべての音はいつか自然に終わります。アニメーションの尺より長く鳴る音があるなら、それはアニメーションデータ側の問題です。

音を止めたい箇所では `player.audioManager?.stopAll?.()` を自分で呼んでください。

## シーク時の扱い

シークは通過したフレームのイベントを発火しません。発火するのは移動先フレームのユーザーデータ・シグナル・サウンドだけです。区間内のキーをすべて受け取りたい場合は、シークせずに再生で通過させてください（[基本的な再生](/ja/usage/basic) の `setAnimationSection`）。
