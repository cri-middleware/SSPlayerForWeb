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
completion and stays true until the next `play()` / `setAnimation()` (or a
`crossfade` on track 0), so a caller that was not subscribed when the edge went by
can still ask whether the run is over. Neither is raised by `stop()`, which is what
separates them from `!isPlaying`.

Each of those three carries `partIndex`, `partName` and **`frameNo`** — the frame
its key is *authored* on, which is not necessarily the frame it was noticed on.
One tick can step across several frames and fires every key in between, so the
player's current frame is not where the key sits. They also carry **`source`**,
the handle of the animation that fired it — see below.

There is one more hook, `onFrame`, which fires on every advanced frame rather than
on an authored event — it is the point at which a part's transform is final for
that frame. See [Part tracking](/customize/part-following).

## With several animations playing

With [motion blending](/customize/motion-blending) one player can run more than one
animation at once, and by default **only track 0's main animation fires events**.
An overlay on another track, or a second animation mixed into a track, fires only
once you lower its threshold to its weight or below:

```ts
const run = player.addTrackSource(0, 'run', 0.3);
player.setSourceEventThreshold(run, 0.3); // fires while its weight is at least 0.3
```

A `crossfade` on track 0 hands the events over **when it begins**: the incoming
animation fires from the first frame of the fade, and the outgoing one stops. To
keep the outgoing side firing for part of the fade, set the track's own threshold —
the outgoing side fires while its share of the track, `1 - progress`, is at least
that much:

```ts
player.setTrackOutgoingEventThreshold(0, 0.5); // the outgoing side fires for the first half
```

Every user-data, signal and sound event carries **`source`**, the handle of the
animation that fired it. Compare it with `getTrackMainSource(track)` or with what
`addTrackSource` returned to tell track 0's animation from an overlay or from the
outgoing side of a crossfade. The payload is read from the table of the animation
that fired it, so an event fired after a crossfade is the incoming animation's
event.

## Sound playback

The runtime **does not play audio**; `onAudio` hands you a reference to the sound. The players
do, by default: when a loaded `.ssab` has sounds and no `player.audioManager` is set, `load()`
attaches a `SSWebAudioManager` that plays them through Web Audio. `onAudio` fires either way.
`ssplayer-webgl` fetches that adapter as a separate chunk, only for a pack with sound.

To play the sounds through your own audio engine, implement `IAudioManager` and assign it
**before** `load()` — the default is attached only when none is set. On `ssplayer-webgl`,
`surface.createPlayer({ autoAudio: false })` turns the default off altogether.

```ts
player.audioManager = myAudioManager; // IAudioManager implementation, before load()
```

A sound that has started **outlives the playback that triggered it**. `pause()`,
`stop()` and a `setAnimation()` switch all leave it running — they end the
*animation*, not the sound. Only `destroy()` sweeps the manager, because after it
there is no player left to own the voices. SpriteStudio has no infinite loop
(`loopNum` is a play count), so every sound ends on its own; if one outlasts its
animation, that is the animation data's business.

Call `player.audioManager?.stopAll?.()` yourself wherever you do want silence.

## Behavior when seeking

Seeking does not fire the events it skips over — only the destination frame's user data, signals
and sounds fire. To receive every key in a span, let playback pass through it instead of seeking
(`setAnimationSection` in [Basic playback](/usage/basic)).
