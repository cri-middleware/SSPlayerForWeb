[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-pixi-ui

A **SpriteStudio** animation as a [`@pixi/ui`](https://github.com/pixijs/ui) button in a PixiJS v8 app.
`SSButton` is a `ButtonContainer` whose look is one animation: hover, press, keyboard focus and
`enabled = false` each play a section of it, and a pointer can be made to count only on some of its
parts.

> **Who this is for:** apps on PixiJS v8 that want a button, a menu item or a toggle drawn by a
> SpriteStudio animation.
> **Install:** `npm install @spritestudio/ssplayer-pixi-ui @pixi/ui pixi.js` (`@pixi/ui@^2.4` and
> `pixi.js@^8.19` are peer dependencies). It brings `@spritestudio/ssplayer-pixi` with it and
> re-exports it, so `SSPlayer` comes from here too.
> **Not what you need?** → [ssplayer-pixi](../ssplayer-pixi/README.md) to play animations without
> the button.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/ui.html)** — two
buttons drawn by Ringo, one taking a pointer only on the parts you pick.

Part of the [SSPlayerForWeb](../../README.md) monorepo. For the guide, see
[UI buttons](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi-ui); the same pages for this
version are in this package's `docs/` (start at `docs/README.md`), and in `skills/ssplayer-pixi-ui/` as
an Agent Skill.

## Quick start

1. **Author the states** in one animation: a label named after each state —
   `normal`, `hover`, `pressed`, `disabled`, `focused` — where that state's loop starts. Each runs to
   the frame before the next label. A state without a label falls back (`pressed` to `hover`, the rest
   to `normal`), and with no labels at all the whole animation plays.
2. **Convert** the `.sspj` as for any animation
   ([Preparing assets](https://cri-middleware.github.io/SSPlayerForWeb/usage/assets)).
3. **Make the button:**

   ```ts
   import { Application } from 'pixi.js';
   import { SSButton, SSPlayer } from '@spritestudio/ssplayer-pixi-ui';

   await SSPlayer.initialize();   // once for the whole app

   const app = new Application();
   await app.init({ width: 1280, height: 720 });
   document.body.appendChild(app.canvas);

   const start = new SSButton({ hitParts: ['face'], accessibleTitle: 'Start' });
   await start.player.load('/ui/start/start.ssab');
   start.position.set(640, 360);
   start.onPress.connect(() => console.log('start'));
   app.stage.addChild(start);
   ```

Under `prefers-reduced-motion` each state holds its first frame; `normal`, and the states that fall back
to it, play a `reduced_motion` label instead when the animation has one. Without `accessibleTitle` the button is
decoration to a screen reader.

**Read next:** [UI buttons](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi-ui) ·
[PixiJS guide](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi)

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

From the repo root, after the WASM is in place (see
[ssplayer-pixi](../ssplayer-pixi/README.md#working-from-source)):

```bash
pnpm run build                                   # build all TS packages
pnpm --filter @spritestudio/ssplayer-pixi-ui test
pnpm run deploy-examples                         # once: the sample assets (not tracked in git)
pnpm --filter pixi-example dev                   # then open /ui.html
```
