# Instructions for AI Agents

This file contains rules, context, and guidelines for AI agents working on the **SSPlayerForWeb** repository. When performing tasks in this workspace, strictly adhere to the following principles.

## Operating rules

- Keep changes scoped to the requested task.
- Do not commit unless the user explicitly asks.
- Before editing, read enough surrounding context to understand callers and invariants; if the read tool truncated the file, read the remaining ranges before making non-trivial changes.
- Follow existing code style in touched files (naming, type usage, control flow, error handling).

## 1. Core Architectural Constraints

- **Absolute Decoupling in Core**: The `@spritestudio/ssplayer-core` package MUST remain completely decoupled from any rendering engine (e.g., PixiJS, Three.js) or browser-specific DOM APIs. It acts solely as a wrapper for the Rust WebAssembly logic.
- **Zero-Copy Memory Management**: When transferring data between WebAssembly and JavaScript, prioritize zero-copy techniques. Use `Float32Array` or similar TypedArrays referencing the `wasmMemory.buffer` directly to prevent unnecessary memory allocation and Garbage Collection (GC) pauses.
- **Memory Safety**: WASM memory is not automatically garbage-collected by JS. Implement safeguards using JS `FinalizationRegistry` to automatically call WASM `free()` when objects are garbage-collected, preventing memory leaks.
- **Render Modes**: Understand the difference between `RenderMode::Direct` (used for high-performance batching in PixiJS v8) and `RenderMode::SceneGraph` (used for hierarchy-based rendering in RPG Maker MZ).

## 2. Monorepo Guidelines

- The project uses `pnpm` workspaces. Ensure any dependency modifications are made correctly within the context of a monorepo (e.g., `pnpm add <pkg> --filter <workspace>`).
- **Packages**: Located in `packages/`.
- **Examples/Testing**: Located in `examples/`.
- **Rust Core**: Located in the `SpriteStudio7-SDK` Git submodule. Do not alter the submodule structure without explicit instruction.

## 3. Development & Tooling Rules

- **User Global Rules**: The user has configured `rtk` (Rust Token Killer) as a CLI proxy. All command-line operations should ideally respect this hook-based usage implicitly, but keep in mind that `rtk` handles token-saving analytics.
- **TypeScript**: Use strict typing. Avoid `any` where possible.
- **Rust**: Ensure any modifications to the `ssruntime` expose a C-API/FFI compatible with `wasm-bindgen`.
