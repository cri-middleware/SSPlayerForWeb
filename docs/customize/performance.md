# Performance tuning

## Playback options

```ts
player.subframe = false;  // disable subframe interpolation (on by default); use to reduce load
```

- **`subframe`**: **on by default**. Smooths motion on high refresh rates and during
  slow-motion effects. Set it to `false` when running many players at once makes the
  per-frame computation too expensive.
- **`frameSkipEnabled`**: **on by default**. Skips frames to keep playback timing when
  rendering can't keep up — no action needed for performance.

::: warning
`subframe` and `frameSkipEnabled` work as a pair. If you turn one off, turn off the
other too — disabling only one leaves playback timing inconsistent.
:::

## Built-in speedups

- **Direct Drawing (batched rendering)**: `ssplayer-pixi` batches draw operations so
  that many characters are drawn with few draw calls.
- **Zero-Copy**: transforms and geometry are passed as `Float32Array` views that
  reference WASM memory directly, avoiding a per-frame copy.
- **Resource sharing**: when the same `.ssab` is used by multiple players, the parsed
  resources are cached and share the asset's WASM memory footprint.

## Measurement tips

The quickest path is to place many instances of the target asset in
`examples/pixi-example` and check the draw-call count and frame time in your
browser's performance panel.
