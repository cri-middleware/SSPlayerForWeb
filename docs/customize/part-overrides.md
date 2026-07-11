# Part control (visibility / cell / color)

::: warning Planned (SDK-dependent)
APIs for overriding a part's **visibility, cell reference, and color** at runtime
(`setPartVisible` / `setPartCell` / `setPartTint`, etc.) are planned once the
**Override Layer API** lands on the `SpriteStudio-SDK` side. Track progress in
[ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/ROADMAP.md).
:::

## Query APIs available today

For now, only **querying** parts is available.

```ts
player.getPartsCount();                 // number of parts
player.getPartIndexFromName('body');    // part name -> index
```

Costume swapping (cell-map replacement) and dynamic instance-animation swapping
also await the SDK-side API.
