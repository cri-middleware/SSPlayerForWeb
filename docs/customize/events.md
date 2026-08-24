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

Each of those three carries `partIndex`, `partName` and **`frameNo`** — the frame
its key is *authored* on, which is not necessarily the frame it was noticed on.
One tick can step across several frames and fires every key in between, so the
player's current frame is not where the key sits.

There is one more hook, `onFrame`, which fires on every advanced frame rather than
on an authored event — it is the point at which a part's transform is final for
that frame. See [Part tracking](/customize/part-following).

## Sound playback is the host's job

The runtime **does not play audio**. `onAudio` only hands you a reference to the
sound. Implement `IAudioManager`, assign it to `player.audioManager`, and play the
sound from your app.

```ts
player.audioManager = myAudioManager; // IAudioManager implementation
```

A sound that has started **outlives the playback that triggered it**. `pause()`,
`stop()` and a `setAnimation()` switch all leave it running — they end the
*animation*, not the sound. Only `destroy()` sweeps the manager, because after it
there is no player left to own the voices. SpriteStudio has no infinite loop
(`loopNum` is a play count), so every sound ends on its own; if one outlasts its
animation, that is the animation data's business.

Call `player.audioManager?.stopAll?.()` yourself wherever you do want silence.

## Behavior when seeking

When you seek, events between the start frame and the target frame are scanned. If
you see events firing unexpectedly, check them together with section playback
(`setAnimationSection` in [Basic playback](/usage/basic)).
