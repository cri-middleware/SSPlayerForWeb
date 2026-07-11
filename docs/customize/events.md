# Events and User Data

**User data / signals / sounds** placed on the timeline are delivered to you on the
frame they fire. Each subscription method returns an unsubscribe function
(`Unsubscribe`).

```ts
const off = player.onUserData((e) => {
  console.log('userData', e.partName ?? e.partIndex);
});

player.onSignal((e) => console.log('signal', e.commandId, e.partName));
player.onAudio((e) => playSound(e.soundName ?? e.soundNameHash, e.loopNum));

player.onAnimationEnd(() => console.log('finished'));
player.onAnimationLoop(() => console.log('looped'));

off(); // unsubscribe
```

`onAnimationEnd` / `onAnimationLoop` are derived from playback state. User data,
signals, and sounds are fired frame-by-frame by the runtime.

## Sound playback is the host's job

The runtime **does not play audio**. `onAudio` only hands you a reference to the
sound. Implement `IAudioManager`, assign it to `player.audioManager`, and play the
sound from your app.

```ts
player.audioManager = myAudioManager; // IAudioManager implementation
```

## Behavior when seeking

When you seek, events between the start frame and the target frame are scanned. If
you see events firing unexpectedly, check them together with section playback
(`setAnimationSection` in [Basic playback](/usage/basic)).
