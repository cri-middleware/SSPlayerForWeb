# SSPlayerForWeb

SSPlayerForWeb is a Web-based runtime for **OPTPiX SpriteStudio 7** animations. It leverages a high-performance Rust/WebAssembly core to evaluate animations and provides TypeScript packages for seamless integration with WebGL renderers like PixiJS.

## Project Structure

The project is structured as a monorepo containing the following key components:

- **`SpriteStudio7-SDK/libs/ssruntime`**: The core Rust implementation. It handles the parsing of SSAB (SpriteStudio Animation Binary) files, flatbuffer decoding, frame state evaluation, geometry computation, and interpolation. It is compiled to WebAssembly (WASM).
- **`packages/ssplayer-core`**: The core TypeScript library. It wraps the WASM module and provides a high-level API for loading SSAB data, advancing time, and extracting the computed draw batches (Vertices, Indices, UVs).
- **`packages/ssplayer-pixi`**: A PixiJS integration layer. It provides the `SSPlayer` class, which extends a PixiJS container, enabling you to directly add SpriteStudio animations to your PixiJS scene graph. It handles custom WebGL shaders for SpriteStudio's `PartsColor` blending and `DrawBatchKind` geometry rendering.
- **`examples/pixi-example`**: A minimal Vite + PixiJS example application demonstrating how to load and play an animation using `ssplayer-pixi`.

## Requirements

- Node.js (v18 or newer recommended)
- Rust (Cargo)
- `wasm-pack` (for building the Rust core)

## Build Instructions

1. **Build the WASM Core**:
   Navigate to `SpriteStudio7-SDK/libs/ssruntime` and use `wasm-pack` or your preferred WASM build tool to compile the Rust codebase.
   
2. **Build the TypeScript Packages**:
   At the repository root (or inside the packages), run:
   ```bash
   npm install
   
   # Build core first
   cd packages/ssplayer-core
   npm run build
   
   # Build PixiJS wrapper
   cd ../ssplayer-pixi
   npm run build
   ```

3. **Run the Example**:
   ```bash
   cd examples/pixi-example
   npm install
   npm run dev
   ```
   This will start a local development server on `http://localhost:5173`.

## Current Status

- Core animation playback, transformations, and hierarchical rendering are fully functional.
- `DrawBatchKind.Normal`, `DrawBatchKind.Mesh`, and `DrawBatchKind.Shape` are supported.
- Custom PixiJS Shaders (`PartsColorShader`) have been implemented to support SpriteStudio's advanced vertex color blending (`Mix`, `Mul`, `Add`, `Sub`).

## License
Refer to the individual packages for licensing information.
