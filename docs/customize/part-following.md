# Part tracking (following a specified part)

A feature that makes a user-provided display object (a weapon, effect, hitbox, etc.) follow a specified part every frame. The player neither creates nor destroys the object; it only drives the one you hand it (constraint style), and you own the target's lifecycle.

What is offered differs per renderer: a **pull API shared by every player**, with **managed following** layered on top for the players that have a scene graph.

| Player | How to follow |
|---|---|
| `SSPlayer` (PixiJS) | Managed following via `attachToPart()` + the pull API |
| `SSPlayer` (RPG Maker MZ) | Managed following via `attachToPart()` + the pull API |
| `SSCanvasPlayer` (WebGL) | **Pull API only** (`getPartTransform()` + `onFrame()`) — this player has no scene graph |

## Basic usage

```ts
import { Container } from 'pixi.js';

const sword = new Container();  // the target is yours

// Follow the "FrontHand" part (position, rotation and scale by default).
const attachment = player.attachToPart('FrontHand', sword);

// Follow position and rotation only, and hide the target on hidden frames.
player.attachToPart('effect_root', effect, {
  scale: false,
  onHide: 'hide',
});

// Stop following
attachment.detach();
// or
player.detachFromPart(sword);
```

## API reference

| Method | Description |
|---|---|
| `attachToPart(part, target, options?)` | Makes the target follow the part. Returns an `SSPartAttachment` (a handle carrying `target` and `detach()`). **PixiJS / MZ only** |
| `detachFromPart(target)` | Stops following for that `target`. **PixiJS / MZ only** |
| `getPartTransform(part, out?)` | The part's transform for the current frame, as a 2D affine `[m00, m01, m10, m11, tx, ty]`. `null` if the part is unknown |
| `isPartHidden(part)` | Whether the part is hidden on the current frame. `null` if the part is unknown |
| `onFrame(cb)` | Fires on each advanced frame, after the world matrices are final. Returns an unsubscribe function (`Unsubscribe`) |
| `findPartIndex(partName)` | Part index, or `-1` if it isn't in the current animation |

Every `part` argument takes either a **part name** or a **part index** (`number | string`).

> **On part indices**: an index is stable within one asset (the same `.ssab`), so if you read a part every frame yourself, resolve the name once with `findPartIndex()` and reuse the index.

> When you only need the part's position at a single moment (a projectile spawn point, for example) rather than continuous following, calling `getPartTransform()` directly is simpler than setting up an attachment.

## Follow options (`SSPartFollowOptions`)

| Option | Default | Description |
|---|---|---|
| `position` | `true` | Drive the target's position |
| `rotation` | `true` | Drive the target's rotation |
| `scale` | `true` | Drive the target's scale |
| `onHide` | `'follow'` | Behaviour on frames where the part is hidden. `'follow'` (keep following) / `'hide'` (hide the target too) |
| `addAsChild` | `true` | Parent the target under the player. As a child it inherits the player's own transform through the hierarchy and lands exactly on the part |

When all three axes (`position` / `rotation` / `scale`) are on, the affine is applied as-is, so **skew and flip are reproduced exactly**. When only some are on, the affine is decomposed into TRS (translate × rotate × scale) and only the enabled axes are written; the target keeps its own value for the rest.

> The decomposition assumes a TRS composition with no skew. Following a skewed part on a subset of axes is therefore an approximation — enable all three axes, or use the raw affine transformation matrix from `getPartTransform()`, when it has to be exact.

## Timing and accuracy

Following is driven after that frame's world matrices are final, so the target updates **within the same frame** — it never lags by one.

| Player | When it is driven |
|---|---|
| `SSPlayer` (PixiJS) | At the end of `renderFrame()`, **after** the frame's meshes are placed, so targets draw above the animation |
| `SSPlayer` (MZ) | In `update()`, after the events are dispatched |
| `SSCanvasPlayer` (WebGL) | No managed following (`onFrame` fires once the world matrices are final) |

`getPartTransform()` returns an affine transformation matrix in **animation-local, Y-down** space — the space the parts themselves are drawn in. How exactly the target matches depends on where you place it.

- With `addAsChild: true` (the default) the target becomes a child of the player, inherits the player's own transform through the hierarchy, and **matches the part exactly**.
- With `addAsChild: false` the target is driven where it already lives. It only matches while it shares the player's coordinate space.
- To follow with a DOM element or a second canvas on the WebGL player, compose this affine with the display-side transform (`transformMatrix` and the projection) yourself.

### Behaviour per playback state

Following rides on the playback drive.

- **Stopped (`stop()`)** — `SSPlayer` (PixiJS / MZ) early-returns out of `update()`, so **both the following and `onFrame` stop**. Seeking with `player.frame` while stopped does not update the following either.
- **Paused (`pause()`)** — `SSPlayer` (PixiJS / MZ) keeps both the following and `onFrame` running. `SSCanvasPlayer` (WebGL) does not fire `onFrame`.

## Following by hand (the pull API)

On `SSCanvasPlayer` (WebGL), which has no scene graph, and whenever the follower is not a display object (a DOM overlay, hit-detection coordinates, …), drive it yourself by combining `onFrame()` with `getPartTransform()`.

```ts
const affine = new Float32Array(6);   // reuse it to avoid allocating

const off = player.onFrame(() => {
  const m = player.getPartTransform('FrontHand', affine);
  if (!m) return;                     // part not in the current animation

  // m = [m00, m01, m10, m11, tx, ty] (animation-local, Y-down)
  //   x' = m00 * x + m01 * y + tx
  //   y' = m10 * x + m11 * y + ty
  myObject.position.set(m[4], m[5]);
});

off();  // unsubscribe
```

Passing `out` (a `Float32Array(6)`) writes into that array and avoids a per-frame allocation. The array you get back is copied out of WASM memory, so it is safe to retain past the frame.

When you want the individual components, the core exports a decomposition helper.

```ts
import { decomposePartAffine } from '@spritestudio/ssplayer-pixi';

const { x, y, rotation, scaleX, scaleY } = decomposePartAffine(m);
```

> For a mirrored part, the sign of the determinant is folded into `scaleY` (it comes back negative).

## Notes

- **The player controls the target's `visible`.** It is hidden automatically in the two cases below, and restored automatically once the condition clears.
    - The part name does not exist in the current animation (always hidden, regardless of the `onHide` setting)
    - The part is hidden on this frame and `onHide` is `'hide'`
- It only restores a hide **it imposed itself**, though. A target you hid with `visible = false` stays hidden, including through a detach.
- `isPartHidden()` reads the animation's **`hide` keyframe** — not a force-hide from `setPartVisibilityOverride()` (see [Part control](/customize/part-overrides)).
- A part's world matrix is computed every frame regardless of `hide`, so with `onHide: 'follow'` (the default) **a hidden part is still followed**.
- Part names resolve against the parts of the animation the player itself is running. **Parts inside an Instance part (the child animation) cannot be specified** (the Instance part itself can).
- Calling `attachToPart()` twice with the same target replaces the earlier attachment.
- Changing animation re-resolves part names automatically, so nothing has to be attached again. **Following also survives a swap to a different `.ssab` that shares the same rig.**
- Destroying the player detaches every target automatically, so it never destroys or leaves hidden a target the host still owns.
- An attachment holds a reference to its target. Detach before destroying a target of your own.

## Using it from each host

- **`<ss-player>` Web Component** — the element deliberately carries only the playback verbs, so reach the pull API through `el.player` (the `SSCanvasPlayer` underneath). See [WebGL & Web Components](/usage/webgl).
- **RPG Maker MZ** — there are no plugin commands for part tracking. Get the `SSPlayer` instance from a script and call `attachToPart()`. See [RPG Maker MZ](/usage/rmmz).
- **TyranoScript / TyranoBuilder** — no tags are provided at this time.

## What this feature is not for

These are easy to confuse with part tracking, but belong elsewhere.

| What you want | Where it belongs |
|---|---|
| Changing a part's own colour / cell / visibility | The override API in [Part control (visibility / cell / color)](/customize/part-overrides) |
| Following a part in screen coordinates | Compose the player's display transform yourself for now (no API returns the screen transform yet) |
| Following a part inside an Instance part | Its child animation runs as its own player — get the child player and target the part there |
