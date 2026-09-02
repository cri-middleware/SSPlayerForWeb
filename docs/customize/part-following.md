# Part tracking (following a specified part)

A feature that makes a user-provided display object (a weapon, effect, hitbox, etc.) follow a specified part every frame. The player neither creates nor destroys the object; it only drives the one you hand it (constraint style), and you own the target's lifecycle.

What is offered differs per renderer: a **pull API shared by every player**, with **managed following** layered on top for the players that have a scene graph.

| Player | How to follow |
|---|---|
| `SSPlayer` (PixiJS) | Managed following via `attachToPart()` + the pull API |
| `SSPlayer` (RPG Maker MZ) | Managed following via `attachToPart()` + the pull API |
| `SSPlayer` (WebGL) | **Pull API only** (`getPartTransform()` + `onFrame()`) — this player has no scene graph |

::: warning Mesh (skinned) parts cannot be followed directly
A **bone-bound mesh part** (a deforming part such as a hand or a face) has its vertices drawn by bone skinning, while the part's own transform stays at its setup node position — usually near the character root. So targeting such a part with `attachToPart()` (or reading it with `getPartTransform()`) makes the follower snap near the root rather than onto the visible art.

To follow the position of a mesh part, add a **NULL part** (a bone-point / empty part) at that spot in SpriteStudio and target that part's name instead. A bone (armature) or joint part works the same way.

A **rigid** mesh — one with no bone binding, deformed only by its own mesh keys — follows correctly; only skinned parts are affected. Call `isPartSkinnedMesh(part)` to detect one (for example, to dim it in a follow-target picker). It does not block following.
:::

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
| `getPartTransform(part, out?)` | The part's transform for the current frame, as a 2D affine `[m00, m01, m10, m11, tx, ty]`, with the player's `flipX` / `flipY` / `offsetX` / `offsetY` applied. `null` if the part is unknown |
| `isPartHidden(part)` | Whether the part is hidden on the current frame. `null` if the part is unknown |
| `isPartSkinnedMesh(part)` | Whether the part is a **skinned (bone-bound) mesh** — a poor follow target (see the warning above). `null` if the part is unknown |
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
| `scale` | `false` | Drive the target's scale. **Off by default** — a follower is placed *at* the part, not sized by it |
| `onHide` | `'follow'` | Behaviour on frames where the part is hidden. `'follow'` (keep following) / `'hide'` (hide the target too) |
| `addAsChild` | `true` | Parent the target under the player. As a child it inherits the player's own transform through the hierarchy and lands exactly on the part |

When all three axes (`position` / `rotation` / `scale`) are on, the affine is applied as-is, so **skew and flip are reproduced exactly**. When only some are on, the affine is decomposed into TRS (translate × rotate × scale) and only the enabled axes are written; the target keeps its own value for the rest.

> The decomposition assumes a TRS composition with no skew. Following a skewed part on a subset of axes is therefore an approximation — enable all three axes, or use the raw affine transformation matrix from `getPartTransform()`, when it has to be exact.

## Combining it with flip (`flipX` / `flipY`)

The player's [flip and offset](/usage/basic#flip-and-offset) work with following rather than against it. `getPartTransform()` reports the part's mirrored pose, so **a target stays pinned to its part across a flip**.

With the default of all three axes on, the affine is written as-is and **the match is exact, mirroring included** — which also means **the target's own artwork is mirrored** (the mirror arrives as a negative scale). That is usually what you want from something meant to match the part exactly, but text or an asymmetric icon on the target will come out backwards.

To keep the target upright, either:

- turn `scale: false` off — at the cost of the 180-degree residual described below, or
- wrap the target in one `Container`: follow with the outer one, put the artwork in the inner one, and cancel the mirror there with `scale.x = -1`.

Under the default options this is the same result `player.scale.x = -1` would give, so the flip is no advantage here. Where it does pay off is `addAsChild: false` — see below.

> **With `scale: false`, `flipX` leaves a 180-degree difference in the orientation** (`flipY` does not). A mirror cannot be expressed as a rotation — only as a negative scale — so it never reaches a target whose scale is not driven. The two axes differ because `decomposePartAffine()` puts the sign on the Y axis when it splits a mirror into rotation plus negative scale; a horizontal mirror needs an extra 180-degree rotation to fit that form, and it is the rotation that keeps it.
> **The position is exact regardless of the determinant.**

`flipX` / `flipY` are not the only way a part ends up mirrored: a part or an ancestor carrying a negative scale in SpriteStudio is mirrored without any flip at all. And the two **multiply, so an even number of them cancels** — flipping an already-mirrored part brings the determinant back to **positive**. Never infer the sign from "the flip is on"; read the determinant of the matrix in hand when you need to know.

**`addAsChild: false` is where the flip earns its keep.** Because it is folded into the geometry rather than onto the player's display object, the affine this reports carries it, so a target living outside the player lands correctly with no extra work — as long as it shares the player's coordinate space. Mirror with `player.scale.x = -1` instead and the reported affine knows nothing about it, so every consumer outside the player's own subtree (that target, a DOM overlay, a hitbox) is left at the unmirrored position until the host applies the mirror itself.

## Timing and accuracy

Following is driven after that frame's world matrices are final, so the target updates **within the same frame** — it never lags by one.

| Player | When it is driven |
|---|---|
| `SSPlayer` (PixiJS) | At the end of `renderFrame()`, **after** the frame's meshes are placed, so targets draw above the animation |
| `SSPlayer` (MZ) | In `update()`, after the events are dispatched |
| `SSPlayer` (WebGL) | No managed following (`onFrame` fires once the world matrices are final) |

`getPartTransform()` returns an affine transformation matrix in **animation-local, Y-down** space — the space the parts themselves are drawn in. How exactly the target matches depends on where you place it.

- With `addAsChild: true` (the default) the target becomes a child of the player, inherits the player's own transform through the hierarchy, and **matches the part exactly**.
- With `addAsChild: false` the target is driven where it already lives. It only matches while it shares the player's coordinate space.
- To follow with a DOM element or a second canvas on the WebGL player, compose this affine with the display-side transform (`transformMatrix` and the projection) yourself.

### Behaviour per playback state

Following rides on the playback drive.

- **Stopped (`stop()`)** — `SSPlayer` (PixiJS / MZ) early-returns out of `update()`, so **both the following and `onFrame` stop**. Seeking with `player.frameNo` while stopped does not update the following either.
- **Paused (`pause()`)** — `SSPlayer` (PixiJS / MZ) keeps both the following and `onFrame` running. `SSPlayer` (WebGL) does not fire `onFrame`.

## Following by hand (the pull API)

On `SSPlayer` (WebGL), which has no scene graph, and whenever the follower is not a display object (a DOM overlay, hit-detection coordinates, …), drive it yourself by combining `onFrame()` with `getPartTransform()`.

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

## Building a follow-target picker

If you build UI that lets someone choose which part to follow, mirror what the SpriteStudio, Unity and Godot editors do: **list every part, but keep skinned mesh parts out of reach** so they can't be chosen by accident — while still accepting a name typed by hand, since following one is occasionally deliberate.

```ts
const select = document.querySelector('select')!;
for (const name of player.getPartNames()) {
  if (!name) continue;
  const opt = document.createElement('option');
  opt.value = name;
  // A skinned mesh is a poor target — offer it, but disabled (dimmed).
  opt.disabled = player.isPartSkinnedMesh(name) === true;
  opt.textContent = opt.disabled ? `${name} (skinned mesh)` : name;
  select.append(opt);
}
```

Keep it a **soft** filter, not a hard block: a name typed by hand (or set from code) should still go through, exactly as the Unity and Godot inspectors allow. When one does, flag it rather than refuse it — `isPartSkinnedMesh()` is the same test, so a warning beside the field is enough.

The `examples/part-follow` demo does exactly this: the Ringo character's skinned parts (`hand_r`, `hand_l`, the legs, ears and tail) are dimmed in the dropdown, and typing one in by hand shows the non-blocking warning.

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

- **`<ss-player>` Web Component** — the element deliberately carries only the playback verbs, so reach the pull API through `el.player` (the `SSPlayer` underneath). See [WebGL & Web Components](/usage/webgl).
- **RPG Maker MZ** — there are no plugin commands for part tracking. Get the `SSPlayer` instance from a script and call `attachToPart()`. See [RPG Maker MZ](/usage/rmmz).
- **TyranoScript / TyranoBuilder** — no tags are provided at this time.

## What this feature is not for

These are easy to confuse with part tracking, but belong elsewhere.

| What you want | Where it belongs |
|---|---|
| Changing a part's own colour / cell / visibility | The override API in [Part control (visibility / cell / color)](/customize/part-overrides) |
| Following a part in screen coordinates | Compose the player's display transform yourself for now (no API returns the screen transform yet) |
| Following a part inside an Instance part | Its child animation runs as its own player — get the child player and target the part there |
