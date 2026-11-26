---
description: "The SpriteStudio components the TyranoBuilder plugin adds to the palette, what each one does, and the fields it has."
---

# TyranoBuilder components

The SpriteStudio components the TyranoBuilder plugin adds to the palette. Installing the plugin and
bringing your animations in are on [TyranoBuilder](/usage/tyranobuilder).

Under **Plugins** in the palette:

| | |
| --- | --- |
| **SpriteStudio: show** | Load an animation and put it on a layer |
| **SpriteStudio: fade in / fade out** | Show or hide one |
| **SpriteStudio: change animation** | Switch to another animation in the same pack |
| **SpriteStudio: stop / pause / resume** | Playback control |
| **SpriteStudio: stop sound** | Cut the sounds an animation started |
| **SpriteStudio: wait** | Hold the story until the animation finishes |
| **SpriteStudio: wait for signal** | Hold the story until the animation fires a signal, such as the moment an attack lands |
| **SpriteStudio: speed / jump to frame** | Change the playback speed, or move to a frame |
| **SpriteStudio: play a section / direction** | Loop a range of frames; play forwards, backwards or back and forth |
| **SpriteStudio: talk animation** | Play a talk animation while a character's lines are shown |
| **SpriteStudio: part colour / hide part / part image** | Change one part: tint it, hide it, or swap the cell it draws |
| **SpriteStudio: reset parts** | Undo those part changes |
| **SpriteStudio: place / move** | Place it, or slide it over time |
| **SpriteStudio: remove / remove all** | Unload one, or all of them |
| **SpriteStudio: fade out all / fade in all** | All of them at once, for a scene change |
| **SpriteStudio: pause all / resume all** | All of them at once, for a menu screen |
| **SpriteStudio: sound settings** | Only if you want something other than the defaults |

The names follow TyranoBuilder's own language, which it takes from
`<TyranoBuilder>/lang/lang.txt`, so a Japanese editor shows 「SpriteStudio 表示」and so on.

A few things the fields do that are worth knowing:

- **Player name** is how the other components find the animation. You choose one on *show*;
  everywhere else it is a dropdown of the names already placed in the scene.
- **Animation pack** lists every `.ssab` in the project, converted or hand-copied.
- **Animation** lists what is actually inside the selected pack, read from the `.ssab`.
- **Then play** hands over to another animation when this one ends — an entrance into an idle
  loop, say. It needs *loop forever* off, because an animation that loops forever never ends.
- **Part**, **Cell map** and **Cell** list what is in that player's pack, and **Part** offers only
  the parts the change applies to: a colour takes normal parts, an image normal and mask parts.

Each component writes the matching `[ss_*]` tag verbatim, so the
[tag reference](/usage/tyrano-tags) describes exactly what they do. There is no component for
tracks (`[ss_track]`, `[ss_track_fade]`, `[ss_track_clear]`); those are for TyranoScript scenarios.
