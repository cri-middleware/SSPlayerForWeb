# Basic playback

This page collects the playback-control API shared by `SSPlayer` (both the WebGL and PixiJS v8 backends). Most of the API is common to both. For the minimal load-and-play steps, see the [Quick start](/setup/quickstart).

## Loading and selecting an animation

```ts
await player.load(ssabUrl); // textures, instance packs and sounds load from the .ssab's own directory
```

```ts
player.setAnimation(name);  // select an animation (WebGL and PixiJS alike)
player.animationName;       // current animation name
```

Playback settings are properties, not arguments — set `loopCount`, `speedScale` and the rest after
selecting the animation (see [Playback control](#playback-control)).

`setAnimation` is synchronous: `load()` brings in everything the `.ssab` needs — those assets belong to
the pack, not to one animation — so switching is only a runtime reset, with no loading to wait for.

## Playback control

```ts
player.play();              // start playback (pass a startFrame as an argument)
player.pause();             // pause
player.resume();            // resume
player.stop();              // stop
```

## Frame and speed

```ts
player.frame;               // current frame (get / set)
player.speedScale = 1.5;    // playback speed multiplier
player.isPlaying;           // whether playback is running
player.isPausing;           // whether playback is paused
player.fps;                 // frame rate (get / set)
player.totalFrames;         // frames in the current playback range
player.startFrame;          // first frame of the range
player.endFrame;            // last frame of the range
player.loopCount;           // configured loop count (-1 = infinite)
player.animationName;       // the animation currently set up
player.subFrameEnabled;     // sub-frame interpolation (on by default; smooth in slow motion / high-refresh)
```

## Section and direction

```ts
player.setAnimationSection(startFrame, endFrame);      // limit the playback range
player.setPlaybackDirection(direction, style);         // direction / style
player.frameSkipEnabled = false;                       // stop skipping frames; also turn sub-frame off, or timing drifts
```

`startFrame` / `endFrame` / `totalFrames` all follow the section once one is set.

## Part lookup

```ts
player.getPartsCount();          // number of parts
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
<ss-player src="/assets/Ringo.ssab" animation="run" autoplay speed="1.5" style="width: 640px; height: 480px;"></ss-player>
```

You can also grab the DOM element from JavaScript and call methods such as `play()` / `pause()`.

---
For timeline events (user data / signals / sound) and other advanced work such as costume swapping, see [Customize](/customize/events).
