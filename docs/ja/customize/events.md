# イベントとユーザーデータ

タイムライン上に設定した**ユーザーデータ / シグナル / サウンド**を、発火した
フレームで受け取れます。各購読メソッドは解除用の関数（`Unsubscribe`）を返します。

```ts
const off = player.onUserData((e) => {
  console.log('userData', e.partName ?? e.partIndex);
});

player.onSignal((e) => console.log('signal', e.commandId, e.partName));
player.onAudio((e) => playSound(e.soundName ?? e.soundNameHash, e.loopNum));

player.onAnimationEnd(() => console.log('finished'));
player.onAnimationLoop(() => console.log('looped'));

off(); // 購読解除
```

`onAnimationEnd` / `onAnimationLoop` は再生状態から導出されます。ユーザーデータ /
シグナル / サウンドはランタイムがフレーム単位で発火します。

## サウンドはホスト側で再生

ランタイムは**音を鳴らしません**。`onAudio` はサウンドの参照を渡すだけです。
`IAudioManager` を実装して `player.audioManager` に割り当て、再生はアプリ側で
行います。

```ts
player.audioManager = myAudioManager; // IAudioManager 実装
```

## シーク時の扱い

シークすると、開始フレームから対象フレームまでのイベントが走査されます。想定外の
発火があるときは、区間指定（[基本的な再生](/usage/basic) の `setAnimationSection`）
と合わせて確認してください。
