# ssplayer-tyranoscript — Roadmap

This file lists unfinished work that is specific to the TyranoScript plugin; work for the Web Player as a whole is in the [root ROADMAP](../../ROADMAP.md), and the editor side is in the [ssplayer-tyranobuilder roadmap](../ssplayer-tyranobuilder/ROADMAP.md). Technical constraints live in [Limitations & Scope](https://cri-middleware.github.io/SSPlayerForWeb/limitations), and work in the underlying Rust / WebAssembly engine lives in the [SDK ROADMAP](https://github.com/cri-middleware/SpriteStudio-SDK/blob/HEAD/ROADMAP.md).

## Playback & rendering

- [ ] **Crossfade tag** — A `[ss_play]` option or an `[ss_crossfade]` tag, the counterpart of the Spine plugin's `[spine_mix_anim]`, with the track state carried through save and restore. Blocked on: the root roadmap's Animation blending / crossfade item, since no package exposes the runtime's track calls yet.

## Distribution & verification

- [ ] **Submit to the Tyrano plugin library** — `plugin/README.md` is laid out for the plugin.tyrano.jp listing; the submission itself is not made. Blocked on: the first release.

## Backlog

- [ ] **Signal parameters and user data in the scenario** — `[ss_wait_signal var=]` stores the command ID only, while `SSSignalEvent.params` and `onUserData` already deliver the rest from `ssplayer-webgl`; what is missing is the tags. Waits for a request (`ssplayer-rmmz` passes less).

## Deliberate non-goals

- **Spine and Live2D tags with no SpriteStudio counterpart** — `skin=` and `[live2d_expression]` are covered by `[ss_part_*]`; `lip_time`, `lip_sound_level` and `breath` are parameter-rig specifics (`[ss_chara]` swaps a whole animation instead); `bgimage` is Tyrano's own background layer.
