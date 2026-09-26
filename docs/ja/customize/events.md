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

`onAnimationFinished` は**エッジ**で、再生が完了したティックに 1 回だけ発火します。状態のほうが欲しい場合は `player.isFinished` を読んでください。完了時に latch され、次の `play()` /
`setAnimation()` まで貼り付くので、エッジが過ぎた後に接続した呼び出し側でも「終わったか」を問えます。どちらも `stop()` では立たず、そこが `!isPlaying` との違いです。

この 3 つはいずれも `partIndex` / `partName` と **`frameNo`** を持ちます。`frameNo` はキーが *置かれている* フレームであって、検出されたフレームとは限りません。1 ティックで複数フレームをまたぐことがあり、その間のキーはすべてそのティックで発火するため、プレイヤーの現在フレームとキーの位置は一致しません。

このほかに、オーサリングされたイベントではなく**フレームが進むたび**に発火する
`onFrame` があります。そのフレームのパーツ変換が確定するタイミングです。詳しくは
[パーツトラッキング](/ja/customize/part-following) を参照してください。

## サウンドはホスト側で再生

ランタイムは**音を鳴らしません**。`onAudio` はサウンドの参照を渡すだけです。
`IAudioManager` を実装して `player.audioManager` に割り当て、再生はアプリ側で行います。

```ts
player.audioManager = myAudioManager; // IAudioManager 実装
```

一度鳴り始めた音は、**それを発火させた再生よりも長く生き残ります**。`pause()` /
`stop()` や `setAnimation()` による切り替えは、いずれも音には触れません（終わらせるのは*アニメーション* であって音ではありません）。マネージャを一掃するのは `destroy()` だけで、その後は voice を持ち主のいない状態にしないためです。SpriteStudio に無限ループの音はなく（`loopNum` は再生回数）、すべての音はいつか自然に終わります。アニメーションの尺より長く鳴る音があるなら、それはアニメーションデータ側の問題です。

音を止めたい箇所では `player.audioManager?.stopAll?.()` を自分で呼んでください。

## シーク時の扱い

シークすると、開始フレームから対象フレームまでのイベントが走査されます。想定外の発火があるときは、区間指定（[基本的な再生](/ja/usage/basic) の `setAnimationSection`）と合わせて確認してください。
