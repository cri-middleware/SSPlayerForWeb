# Basic playback

This page collects the playback-control API shared by `SSCanvasPlayer` (WebGL) and `SSPlayer` (PixiJS v8). Most of the API is common to both. For the minimal load-and-play steps, see the [Quick start](/setup/quickstart).

## Loading and selecting an animation

```ts
await player.load(ssabUrl); // textures load from the .ssab's own directory
```

WebGL (`SSCanvasPlayer`):
```ts
await player.setAnimation(name);                       // select an animation
```

PixiJS (`SSPlayer`):
```ts
await player.setAnimation(name); // 2nd arg: loop count (default -1)
player.animationName;            // current animation name
```

## Playback control

```ts
player.play();              // start playback (pass a startFrame as an argument)
player.pause();             // pause
player.resume();            // resume
player.stop();              // stop
```

## Frame and speed

**Common properties:**
```ts
player.frame;               // current frame (get / set)
player.speedScale = 1.5;    // playback speed multiplier
player.subFrameEnabled;     // sub-frame interpolation (on by default; smooth in slow-motion / high-refresh)
player.isPlaying;           // whether playback is running
```

**PixiJS (`SSPlayer`)-only extended properties:**
```ts
player.fps;                 // frame rate (get / set)
player.totalFrames;         // total frame count
player.startFrame;          // start frame
player.endFrame;            // end frame
player.loopCount;           // number of completed loops
player.isPausing;           // whether playback is paused
```

## Section and direction (PixiJS `SSPlayer` only)

```ts
player.setAnimationSection(startFrame, endFrame);      // limit the playback range
player.setPlaybackDirection(direction, style);         // direction / style
player.subframe = false;                               // turn off together with frameSkip
player.frameSkipEnabled = false;                       // stop skipping frames; also needs subframe off, or timing drifts
```

## Part lookup (PixiJS `SSPlayer` only)

```ts
player.getPartsCount();                 // number of parts
player.getPartIndexFromName('body');    // name → index
```

---

## Web Components (`<ss-player>`)

The WebGL package also ships a Custom Element (`<ss-player>`) that you can use just by writing it in HTML.

```html
<script type="module">
  import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
  defineSSPlayerElement(); // register <ss-player>
</script>

<!-- src: path to the ssab, animation: animation name -->
<ss-player src="/assets/Ringo.ssab" animation="run" autoplay speed="1.5" style="width: 640px; height: 480px;"></ss-player>
```

You can also grab the DOM element from JavaScript and call methods such as `play()` / `pause()`.

---
For timeline events (user data / signals / sound) and other advanced work such as costume swapping, see [Customize](/customize/events).
