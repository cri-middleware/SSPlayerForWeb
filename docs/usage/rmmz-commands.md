---
description: "The ssplayer-rmmz plugin commands for RPG Maker MZ: showing an animation, animation control, tracks, part overrides and part tracking, playback, and lip-sync."
---

# RPG Maker MZ plugin commands

The plugin commands the RPG Maker MZ plugin adds. Installing the plugin, converting your animation
and deploying the game are on [RPG Maker MZ](./rmmz.md).

Run these from an event's **Plugin Command** → `ssplayer-rpgmakermz`. An SS animation
rides on an MZ **picture**, so *Move Picture* / scale / Z-order / save-load all apply for
free.

The bold names below are the labels shown in the MZ editor; the value in parentheses is
the internal command ID.

## Show / attach

- **Show SS** (`showSS`) — create a picture and attach an animation in one step. Its
  arguments are `Picture Id`, `SSAB File` (e.g. `spritestudio/Ringo/Ringo.ssab`),
  `Animation Name`, `X`, `Y`, `Scale (%)`, `Loop Count`, `Signal -> Switch` and
  `Wait for Completion`. `Loop Count` is `-1` (or `0`) to loop forever, `1` to play once, or the number
  of plays (default `-1`). `Signal -> Switch` is a game switch that turns ON when the animation fires a
  signal — a marker placed on a frame in SpriteStudio — and does not turn OFF by itself; `0` means none.
  Use a `Loop Count` of `1` or more with `Wait for Completion`: an endless animation never finishes.
- **Set SS As Picture** (`setSSAsPicture`) — attach SS to a picture you have **already**
  shown with the native *Show Picture* command. From there, position and erase it with
  the standard *Move / Erase Picture* commands. Don't drive one picture id with both a
  raw *Show Picture* and SS.

## Animation control

- **Change SS Animation** (`changeSSAnimation`) — switch to another animation **within
  the same `.ssab`** (no reload).
- **Play SS Once (return to loop)** (`playSSOnce`) — play an animation a set number of times, then
  **auto-return to the current loop** (idle → expression → idle).
- **Play SS Sequence** (`playSSSequence`) — a comma-separated list where each entry plays
  once except the **last, which loops** (e.g. `attack1,attack2,wait1`). Once the last
  starts, it is the picture's animation.
- **Set SS Speed** (`setSSSpeed`) — a playback-speed multiplier (subframe-interpolated,
  smooth even when slow).

*Change SS Animation*, *Play SS Once*, *Play SS Sequence* and *Set SS Talk* take a
`Transition (ms)`: above 0 the switch crossfades from what is on screen over that time,
and 0 (the default) cuts.

## Tracks (layering animations)

Lay more animations over the picture's own one (track 0), on tracks numbered 1 and up — a
gesture over a walk, an expression over a pose. Tracks are saved with the picture. A change of the picture's animation **without** a
crossfade empties them, as it does in the player itself; a crossfade keeps them.

- **Set SS Track** (`setSSTrack`) — lay an animation on a track, with its `Alpha` (how
  strongly it applies), `Blend` (*Mix*, or *Additive* to add its offset from the setup
  pose), `Loop Count` and `Transition (ms)`.
- **Fade SS Track** (`fadeSSTrack`) — fade a track's alpha to `Target Alpha` over
  `Duration (ms)`; `Wait for Completion` holds the event until it completes.
- **Clear SS Track** (`clearSSTrack`) — empty a track. Fade it to 0 first to take it off
  gradually.

## Part overrides (colour / cell / visibility)

Replace how one part looks at run time, **winning over the animation's keyframes**. The
settings are stored on the picture, so they **survive save/load**.

- **Set SS Part Color** (`setSSPartColor`) — tint one part. The colour is hex
  (`#RRGGBB` / `#RRGGBBAA`) because MZ has no colour parameter type; the four blend
  operations are the authored Parts Color ones. **Normal parts only.**
- **Set SS Part Visibility** (`setSSPartVisibility`) — force-hide one part. Turn on
  `Cascade to descendants` to hide its descendants too: an authored hide never cascades, so this is the
  way to hide a whole body part.
- **Set SS Part Cell** (`setSSPartCell`) — make a part draw a different cell (swapping
  equipment, for instance). The cell-map name carries no `.ssce` extension. **Normal and
  mask parts only.**
- **Clear SS Part Overrides** (`clearSSPartOverrides`) — leave `Part Name` blank to clear every
  part on that picture.

**Priority** (colour / cell only) is one of *Yield to the next keyframe* / *Hold until the
animation changes* (default) / *Permanent (survives animation changes)*. Changing the animation clears everything but
the **permanent** ones — the saved copy is pruned at the same time, so nothing the runtime
discarded comes back on load. Visibility has no priority mode and is always cleared by an
animation change. A crossfade (`Transition (ms)` above 0) is the exception: it keeps every
override.

## Part tracking (script only)

Making a display object of your own follow a part has **no plugin command**. Get the
`SSPlayer` from a script and call `attachToPart()` — see
[Part tracking](../customize/part-following.md).

## Playback / lifecycle

- **Play / Pause / Stop / Remove SS** (`playSS` / `pauseSS` / `stopSS` / `removeSS`), and
  **Wait for SS** (`waitForSS`) — by `Picture Id`. *Wait for SS* holds the event until
  the picture has played every loop of its `Loop Count` (keep that finite: `0` is a synonym
  for infinite, so it waits forever).

## Lip-sync (talking portrait — advanced) {#lip-sync-talking-portrait-advanced}

- **Set SS Talk (lip-sync)** (`setSSTalk`) — bind a picture to a `Speaker Name` (the
  message name box): it plays the `Talk Animation` while that speaker's message is on screen
  and the `Idle Animation` otherwise.
- **Clear SS Talk** (`clearSSTalk`) — unbind it (do this when the conversation ends).

Leave `Animation Name` empty in *Show SS* and *Set SS As Picture* to play the first animation in the
`.ssab`; in *Change SS Animation* it keeps the current one, and *Play SS Once*, *Play SS Sequence* and
*Set SS Track* need a name. A name that is not in the `.ssab` warns in the console and lists the real names (the MZ editor can't read a `.ssab` to build a dropdown).
