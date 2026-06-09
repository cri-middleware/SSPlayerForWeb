# SSPlayerForWeb - Developer & AI Agent Guide

Welcome, Agent. This file contains critical technical context, architectural overviews, and debugging history for `SSPlayerForWeb`. If you are picking up this project from a cold start, read this carefully.

## Architecture

1. **WASM Core (`SpriteStudio7-SDK/libs/ssruntime`)**:
   - Built in Rust. It evaluates SpriteStudio FlatBuffers (`.ssab`) per frame.
   - It outputs transformed geometry into continuous `f32` memory buffers: `get_local_uvs_ptr`, `get_shape_vertices_buf`, `get_shape_vertex_box_coords_buf`, etc.
   - It handles all hierarchical inheritance (Transforms, Alpha, etc.) and evaluates `PartsColor` animation data.

2. **TypeScript Core (`packages/ssplayer-core`)**:
   - A pure TypeScript wrapper (`SSRuntimeManager.ts`) around the WASM module.
   - Decodes FlatBuffers using `flatbuffers.js` to inspect `PartState` without bridging heavy JS <-> Rust calls.

3. **PixiJS Renderer (`packages/ssplayer-pixi`)**:
   - Implements `SSPlayer.ts` which consumes `SSRuntimeManager`.
   - Renders geometry using PixiJS `Mesh` objects. We pool meshes (`this.activeMeshes`) to reduce garbage collection.
   - Includes a custom `PartsColorShader` to emulate SpriteStudio's 4-corner `PartsColor` blending (Mix, Mul, Add, Sub).

## Memory Layouts & Strides

- **Shape Parts (`DrawBatchKind.Shape`)**:
  - `SHAPE_VERTICES_STRIDE` is `24` (floats), representing up to `12` vertices per shape.
  - `shapeVertices` provides local `(x, y)` coordinates. They MUST be multiplied by the WASM output `matrices` (16 floats per part) to get world positions.
  - `shapeVertexBoxCoords` provides local bounding box coords `(fx, fy)` from `0.0` to `1.0`. These are used to bilinearly interpolate 4-corner `PartsColor` and `UV` values.
  
- **Normal Parts (`DrawBatchKind.Normal`)**:
  - Already transformed into world space by WASM (`getMeshVerticesX`, `getMeshVerticesY`).

## Custom PixiJS Shader (`PartsColorShader`)

- PixiJS handles texture sampling. `PartsColorShader` receives:
  - `aPosition` (vec2)
  - `aUV` (vec2)
  - `aColor` (vec4) - Pre-interpolated 4-corner `PartsColor`
  - `aVarg` (vec4) - `[rate, isMix, isMul, isAddSub]`
- The shader reads the base texture, then blends `aColor` on top of it according to the `rate` and blending flag.

## Current Debugging Context / Known Issues

### The "3rd Row Green Rectangle" Issue
In the `pixi-example`, we are rendering a test animation. The expected output (`currect.png`) contains:
- 1st Row: 4 arrows with solid colored backgrounds.
- 2nd Row: 4 arrows with gradient backgrounds.
- 3rd Row: **A single solid Green rectangle**.
- 4th Row: 4 gradient squares.

Currently (`pixi4.png`), the 3rd Row renders as four distinct squares (`Light Green, Green, White, Magenta`). 
**What we know:**
- The 3rd row parts are `DrawBatchKind.Shape`.
- My recent updates mapped the UVs of the Shape correctly, but it still outputs four distinct colors instead of solid green.
- `PartsColor` is evaluating to `Light Green, Green, White, Magenta` for the 3rd row parts because those values *are* present in the animation binary (`ssab`).
- The official SpriteStudio engine (`currect.png`) ignores those `PartsColors` or overrides them for the 3rd row, resulting in pure Green.

**Your Next Steps:**
1. Investigate how SpriteStudio evaluates "Color" for `Shape` parts. There might be a native Fill Color or Cell Color that overrides `PartsColor` under specific blend modes.
2. Check if the 3rd row is actually pointing to a specific `textureHash` (Green Cell map) and why `mixRate` might be `0` or effectively ignored in the official player.
3. Review `part-state.ts` and `framedata.rs` to see if there is an undocumented flag (e.g. `ColorBlend`) or if `PartsColor` evaluation needs to check an inheritance flag.

## Useful Commands

```bash
# Build WASM core
cd SpriteStudio7-SDK/libs/ssruntime
wasm-pack build --target web

# Build TypeScript packages
npm run build --prefix packages/ssplayer-core
npm run build --prefix packages/ssplayer-pixi

# Run the dev server
npm run dev --prefix examples/pixi-example
```
