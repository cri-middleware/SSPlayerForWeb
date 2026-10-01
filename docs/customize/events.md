---
description: Receiving the user data, signals and sounds placed on the timeline on the frame they fire, and what happens when you seek.
---

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

player.onAnimationStarted(() => console.log('started'));
player.onAnimationFinished(() => console.log('finished'));
player.onAnimationLooped(() => console.log('looped'));

off(); // unsubscribe
```

`onAnimationStarted` / `onAnimationFinished` / `onAnimationLooped` are derived from
playback state. User data, signals, and sounds are fired frame-by-frame by the
runtime.

A listener added while an event is being dispatched — from inside another listener —
hears the next event, not the one in flight, and a listener removed during a dispatch
is not called for it. This is how DOM `EventTarget` behaves, and it is what lets a
callback that ends one wait start the next.

`onAnimationStarted` fires when playback **heads out** — a `play()`, including one
the `autoplay` attribute or a host script issued rather than your own code. A
`resume()` does not fire it: lifting a pause carries on, it does not start.

`onAnimationFinished` is the **edge** — it fires once, on the tick playback completed.
If what you want is the standing state, read `player.isFinished`: it latches on
completion and stays true until the next `play()` / `setAnimation()`, so a caller
that was not subscribed when the edge went by can still ask whether the run is
over. Neither is raised by `stop()`, which is what separates them from
`!isPlaying`.

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
