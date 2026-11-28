---
description: SSButton, a @pixi/ui button drawn by a SpriteStudio animation whose labels play its states and whose parts can take the pointer.
---

# UI buttons (PixiJS)

`@spritestudio/ssplayer-pixi-ui` makes a SpriteStudio animation a [`@pixi/ui`](https://github.com/pixijs/ui)
button and has it show what the button is doing — hovered, pressed, disabled, focused — and, for an
irregular shape, take the pointer on the artwork only. It is a package of its own, so an app that only
plays animations pays nothing for it.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/ui.html)** — two buttons
drawn by Ringo, one taking the pointer only on the parts you pick.

```bash
pnpm add @spritestudio/ssplayer-pixi-ui @pixi/ui pixi.js
```

`@pixi/ui@^2.4` and `pixi.js@^8.19` are peer dependencies. The package brings
`@spritestudio/ssplayer-pixi` with it and re-exports it, so `SSPlayer` and the rest are imported from
here too.

```ts
import { SSButton, SSPlayer } from '@spritestudio/ssplayer-pixi-ui';

await SSPlayer.initialize();

const start = new SSButton({ hitParts: ['face'], accessibleTitle: 'Start' });
await start.player.load('/ui/start/start.ssab');
start.position.set(640, 360);
start.onPress.connect(() => startGame());
app.stage.addChild(start);
```

`SSButton` is a `ButtonContainer`: `enabled`, and the signals `onPress`, `onDown`, `onUp`, `onUpOut`,
`onOut` and `onHover`, are `@pixi/ui`'s own. Its `player` is an `SSPlayer` it made, a child of it; pass
`player` to use one of your own. Move, scale and turn the button, not its player.

## Authoring the states

In one animation, put a label named after each state: `normal`, `hover`, `pressed`, `disabled`,
`focused` — lower case, matched exactly. A state plays from its label to the frame before the next
label (or to the end of the animation), looping.

| What happens | Plays | Without that label |
|---|---|---|
| nothing below | `normal` | the whole animation |
| the mouse is over it | `hover` | `normal` |
| a press, until it is released | `pressed` | `hover`, then `normal` |
| `enabled = false` | `disabled` | `normal` |
| keyboard focus, through Pixi's accessibility layer | `focused` | `normal` |

When several hold at once, one is shown: `disabled`, then `pressed`, `hover`, `focused`, and `normal`
when none does. A change shows at once: the new section starts from its first frame, and the section
that was playing is dropped. On a touch screen there is no hover, so a release goes back to `normal`.

The labels are read from the animation the player has selected when the button first shows a state, or
from the pack's first animation; name another with `animation`.

## Using animations you already have

`clips` replaces the label of a state. States that fall back to it take the replacement too.

```ts
new SSButton({
  clips: {
    normal: { animation: 'idle' },                // the whole animation
    hover: { label: 'over' },                     // a label of the animation
    pressed: { animation: 'push', label: 'down' }, // a label of another one
  },
});
```

A section a clip names runs to the frame before the next label as well. A clip naming an animation or a
label the pack does not have is reported once in the console, and the state plays as if it had no clip.

## Reduced motion

`reducedMotion` follows the platform's `prefers-reduced-motion` unless you set it. While it is on, each
state holds the first frame of its section, and no user data, signal or audio event fires.

If the animation has a `reduced_motion` label, `normal` — and the states that fall back to it — plays
that section instead, looping and with its events: a calm idle in place of a still one.

## Taking the pointer on the artwork only

Without `hitParts`, the button takes the pointer anywhere on the canvas of the animation it plays, flip
and offset included. `hitParts` narrows that to the parts named (names or indices), and `hitOnArtwork`,
with no `hitParts`, to any part the player draws. Both can be changed at any time.

```ts
start.hitParts = ['face', 'ribbon'];
```

What counts as a part's area is its outline as drawn — see
[A part's outline](../customize/part-following.md#a-parts-outline). The button answers through its
`hitArea`, so the cursor turns into a hand only over those parts, and a pointer around the artwork
reaches whatever is behind the button. Only the pointer is narrowed: keyboard focus and a screen reader
reach the button as before.

## Screen readers

Without `accessibleTitle` or `accessibleHint` the button is decoration: it is not `accessible`, and a
screen reader does not see it. Pass either and it is made `accessible`, and Pixi's accessibility layer
lays a `<button>` over the canvas with that title or `aria-label`, placed on the area the button takes
the pointer on. `Tab` turns that layer on, moves the focus between buttons, and `Enter` presses the
focused one, which fires `onPress`. Focus arrives as its own event, so `focused` is shown apart from
`hover`, and a button disabled and enabled again keeps the focus it had.

By default Pixi turns the layer off as soon as the mouse moves (`deactivateOnMouseMove`), and the focus
goes with it. To keep the focus while the mouse is used too, turn that off and keep the layer's
elements from taking the pointer, so the button still answers it on its parts:

```ts
await app.init({ accessibilityOptions: { deactivateOnMouseMove: false } });
const start = new SSButton({ accessibleTitle: 'Start', accessiblePointerEvents: 'none' });
```

## The player

The button takes its player's playback over: it selects animations, sets the section and the loop
count, and plays and stops. Give each button a player of its own. Load the player as usual: the button
shows its state on the tick after the pack is in, and again after the player loads another one.

`SSUiStateDriver` is the same rule without the button, for a player in a host of your own:

```ts
import { SSUiStateDriver, uiStateOf } from '@spritestudio/ssplayer-pixi-ui';

const driver = new SSUiStateDriver(player, { clips });
driver.show(uiStateOf({ hovered: true }));
driver.show('normal', true); // under reduced motion
```

## See also

- [Part tracking](../customize/part-following.md) — the outlines the hit test uses, and the transforms beside them
- [Basic playback](./basic.md) — playback sections, by frame and by label
- [PixiJS](./pixi.md) — the player the button is drawn with
