# Basic playback

This page collects the playback-control API shared by `SSPlayer` (both the WebGL and PixiJS v8 backends). Most of the API is common to both. For the minimal load-and-play steps, see the [Quick start](/setup/quickstart).

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../examples/webgl/" target="_blank" rel="noreferrer">WebGL demo</a>** ·
**<a href="../examples/pixi/" target="_blank" rel="noreferrer">PixiJS demo</a>** — this API on a
running player, one per backend; both play a `.ssab` dropped onto the page (they go live once
the first release is published 🚧).

## Loading and selecting an animation

```ts
await player.load(ssabUrl); // textures, instance packs and sounds load from the .ssab's own directory
```

```ts
player.setAnimation(name);  // select an animation (WebGL and PixiJS alike)
player.currentAnimation;       // current animation name
```

Playback settings are properties, not arguments — set `loopCount`, `speedScale` and the rest
(see [Playback control](#playback-control)). They are yours rather than the animation's, so they
hold across a `setAnimation`: a `loopCount` of 3 still means three cycles after a switch.

`setAnimation` is synchronous: `load()` brings in everything the `.ssab` needs — those assets belong to
the pack, not to one animation — so switching is only a runtime reset, with no loading to wait for.

## Playback control

```ts
player.play();              // start playback (pass a startFrame as an argument)
player.pause();             // pause
player.resume();            // resume
player.stop();              // stop — the playhead stays where it stands (play() rewinds)
```

## Frame and speed

```ts
player.frameNo;             // current frame, fractional (get / set)
player.speedScale = 1.5;    // playback speed multiplier
player.isPlaying;           // a playback session is live — true even while paused (isPlaying && !isPausing = advancing)
player.isPausing;           // whether playback is paused
player.isFinished;          // whether every configured loop has played — sticky until the next play()/setAnimation(),
                            // never true on an infinite loop, and NOT raised by stop(), so it tells a run that ended
                            // on its own apart from one you stopped
player.frameRate;                 // frame rate (get / set)
player.totalFrames;         // frames in the current playback range
player.startFrame;          // first frame of the range
player.endFrame;            // last frame of the range
player.loopCount;           // configured loop count (-1 = infinite; 0 asks for the same)
player.currentAnimation;       // the animation currently set up
player.subFrameEnabled;     // sub-frame interpolation (on by default; smooth in slow motion / high-refresh)
```

Turning `subFrameEnabled` off changes what is **drawn** — the renderer shows the
floored frame — and not what `frameNo` reports. The playhead keeps its fraction
either way, so a seek taken with sub-frame off is still exactly where you put it
when you turn it back on. Every sibling Player reports it the same way.

## Section and direction

```ts
player.setAnimationSection(startFrame, endFrame);      // limit the playback range
player.setPlaybackDirection(direction, style);         // direction / style
player.frameSkipEnabled = false;                       // stop skipping frames; also turn sub-frame off, or timing drifts
```

`startFrame` / `endFrame` / `totalFrames` all follow the section once one is set.

## Flip and offset

```ts
player.flipX = true;        // mirror horizontally
player.flipY = true;        // mirror vertically
player.offsetX = 20;        // shift the drawing (animation-local pixels)
player.offsetY = -10;
```

All four change **only what this player draws** — the display object's own transform is untouched.

```ts
// Face the way we are moving.
player.flipX = velocityX < 0;
```

`player.scale.x = -1` (or `setTransform({ scaleX: -1 })` on WebGL) mirrors the artwork just as well.
What differs is **who knows the player was mirrored**.

| | `flipX` | `scale.x = -1` |
|---|---|---|
| The animation's artwork | mirrored | mirrored |
| What `getPartTransform()` returns | **includes the flip** — where the part is actually drawn | does not; the flip lives on the display object |
| The player's `scale` | stays free to mean size | means size *and* facing, so combining it with scaling needs the sign applied by hand |
| Children parented onto the player (an MZ nameplate, …) | **left alone** | mirrored too |

The value of `flipX` is that **things outside the player do not have to know about the flip**: a DOM overlay, a hitbox coordinate, an object in another container, a target from `attachToPart(..., { addAsChild: false })` — each of them lands correctly just by reading `getPartTransform()`. With `scale.x = -1` the host has to re-apply the mirror to every one of them.

Conversely, for `attachToPart()` with all three axes driven (`scale: true`) **there is no visible difference**: either way the target sits on the mirrored part and the target's own artwork is mirrored with it. Under the default `scale: false` they do differ — `scale.x = -1` still mirrors a child target through the hierarchy, while `flipX` leaves it a 180-degree difference in orientation (see [part tracking](/customize/part-following)).

Notes:

- **The offset is applied after the flip** (`p' = S*p + O`), so turning `flipX` on does not send the offset the other way.
- The unit is **animation-local pixels**. It rides under the display object's transform, so scaling the player scales the offset with it. This is not the same as WebGL's `setTransform({ x, y })`, which moves the player itself.
- An instance part's child animation inherits the parent's flip through the hierarchy. There is no need to set it on the child (and doing so has no effect).
- It is included in what `getPartTransform()` reports — see [part tracking](/customize/part-following).

There are no TyranoScript / TyranoBuilder tags for these; reach the player from script instead.

## Part lookup

```ts
player.getPartNames();          // all part names, in index order (count = .length)
player.findPartIndex('body');    // name → index (-1 if unknown)
```

To override a part's colour, cell or visibility at run time, see
[Part control (visibility / cell / color)](/customize/part-overrides) — that API is
shared by the PixiJS and WebGL players.

---

## Web Components (`<ss-player>`)

The WebGL package also ships a Custom Element (`<ss-player>`) that you can use just by writing it in HTML.

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  defineSSPlayerElement(); // register <ss-player>
</script>

<!-- src: path to the ssab, animation: animation name -->
<ss-player src="/assets/Ringo.ssab" animation="run" autoplay speed-scale="1.5" style="width: 640px; height: 480px;"></ss-player>
```

You can also grab the DOM element from JavaScript and call methods such as `play()` / `pause()`.

---
For timeline events (user data / signals / sound) and other advanced work such as costume swapping, see [Customize](/customize/events).
