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
- **Player Facades (Render Modes)**: The architecture is divided by rendering strategies. `DirectInternalPlayer` handles high-performance direct drawing (e.g., PixiJS v8 via BatchRenderer). `SceneGraphInternalPlayer` (future/WIP) handles hierarchy-based drawing (e.g., RPG Maker MZ using PixiJS v5).
- **Architecture Reference**: Always refer to `README.md` for the most up-to-date architecture diagram (Mermaid) and design concepts.

## 2. Monorepo Guidelines

- The project uses `pnpm` workspaces. Ensure any dependency modifications are made correctly within the context of a monorepo (e.g., `pnpm add <pkg> --filter <workspace>`).
- **Packages (`packages/`)**:
  - `ssplayer-core`: Engine-agnostic WebAssembly wrapper (runtime).
  - `ssplayer-pixi`: PixiJS v8 renderer bindings.
  - `ssplayer-webgl`: Standalone WebGL1/2 renderer + `<ss-player>` Web Component.
  - `ssplayer-rmmz`: RPG Maker MZ renderer bindings.
  - `ssconverter-core`: Engine-agnostic WebAssembly converter core (`.sspj` → `.ssab`/`.ssqb`; wasm build of Rust `libssconverter`). No fs/DOM. The wasm glue is kept **external** (`deps.neverBundle`) so it never desyncs from the wasm binary in `wasm/`.
  - `ssconverter-web`: Host built on `ssconverter-core` — browser converter UI + Node CLI (`ssconverter-web-cli`).
- **Examples (`examples/`)**:
  - `pixi-example`: Vite-based test server for PixiJS.
  - `rmmz-example`: Test environment for RPG Maker MZ.
- **Rust Core**: Located in the `SpriteStudio-SDK` Git submodule. Do not alter the submodule structure without explicit instruction.

## 3. Development & Tooling Rules

- **User Global Rules**: The user has configured `rtk` (Rust Token Killer) as a CLI proxy. All command-line operations should ideally respect this hook-based usage implicitly, but keep in mind that `rtk` handles token-saving analytics.
- **TypeScript**: Use strict typing. Avoid `any` where possible. The examples consume built packages, so ensure you run `pnpm run build` from the root whenever modifying `packages/`.
- **Rust & WASM Builds**: Generated WASM binaries are **not tracked in git**. When checking out the project freshly or modifying Rust code, WASM must be built using `pnpm run build:wasm` (or `pnpm run build:wasm:win` on Windows). This requires `rustup` and `cargo install wasm-pack`.
- **Rust FFI**: Ensure any modifications to the `ssruntime` expose a C-API/FFI compatible with `wasm-bindgen`.
- **Docs site build**: `scripts/prepare-docs.sh` (pnpm install + the SDK wasm) then `scripts/build-docs.sh` (TypeDoc, then VitePress → `docs/.vitepress/dist`); `.ps1` twins on Windows, `key=value` options and `--help` like the other scripts here. `pages.yml` runs `build-docs.sh` too, so CI and the local build cannot drift. Two options earn their keep: `api=no` skips TypeDoc when only prose changed, and `base=/SSPlayerForWeb/` sets `DOCS_BASE` the way the project site needs it. **Building the docs is the only gate there is** — nothing builds them on a pull request, and a dead link fails the build (VitePress checks by default; the config does not set `ignoreDeadLinks`). Note this is *one* build for both locales, VitePress resolving `docs/ja` itself — the Zensical player repos need one build per locale, which is why their `build-docs` takes `locale=` and this one does not. The wasm is not optional: TypeDoc parses `packages/*/src`, which import the bindings. Every repository in the family spells this pair the same way; the `-docs` suffix keeps it apart from the scripts that build the player.
- **Pages site build**: `scripts/build-pages.sh` builds the *whole* published site into one directory (`_site` by default) — the docs at the root, `ssconverter-web` (every schema version in `versions.json`) under `/ssconverter/`, and the five examples under `/examples/`. `pages.yml` runs this same script, so CI and a local build cannot drift; the workflow keeps only what is GitHub's — the checkout (SDK submodule, `fetch-depth: 0`), the pnpm/Node toolchain, the artifact upload and the deploy. `.ps1` twins on Windows, `key=value` options and `--help` like the other scripts here: `base=` (default `/<repo>/`, because a project site is served under it — a site built for `/` looks fine locally and 404s once deployed), `out=`, `api=no` (passed to `build-docs.*`), `sdk=`, `skip=<stages>` and `clean=`. `skip=` is what makes it usable while iterating — `skip=install,wasm,packages,assets,rmmz,tyranoscript,ssconverter` rebuilds the docs alone — and a skipped stage leaves its part out of the site with a warning, while a stage that ran and produced nothing is an error. `sdk=download` (the default) takes the pre-built wasm for `scripts/SDK_VERSION.txt`; `sdk=build` compiles it from the submodule's Rust source in release mode, which is the way through when that SDK release does not exist yet. It reaches the `ssconverter` stage too, but **only as far as the one schema version whose `sdk` tag matches `SDK_VERSION.txt`** (`SDK_WASM=build`, which `build-pages.*` passes down to `build-ssconverter-pages.*`) — every other version still downloads the release it pins, which is the point of pinning it and which no local build can stand in for. Each version logs which of the two it took, so add a schema version and the split is visible in the run. Three things it needs that `pnpm install` does not: the **SpriteStudio-SDK submodule** (`deploy-examples` compiles its `tests/*.sspj`, so `download:wasm` is no substitute; `sdk=build` compiles its Rust runtime), network access, and — for the `.sh` path only — `jq`, which the `.ps1` twin does without (`ConvertFrom-Json`). `build-ssconverter-pages.*` gained a `.ps1` twin for the same reason: `build-pages.ps1` has to drive it.
- **Docs site metadata**: `docs/.vitepress/config.mts` builds the Open Graph / Twitter Card tags in `transformHead`, from the title and description VitePress has already resolved (frontmatter > locale > site). **One code path serves both locales** — Japanese cards come from `locales.ja.description`, so localize by adding a per-locale config value, never by branching on the locale inside `transformHead`. `og:url` is built from `SITE_URL`, deliberately not from `base`, which is `/` during local dev. There is no `og:image` and no favicon yet: no SpriteStudio artwork exists to point at, and the sibling player repos are holding off for the same reason so one mark can be adopted everywhere at once. Build with `pnpm --filter docs exec vitepress build` and check the emitted tags before changing any of this. **There is deliberately no `editLink`**, matching the five MkDocs player repos, which dropped their `edit_uri` for the same reason: it hardcodes a branch name that nothing validates, and it had already drifted wrong in three of them. Do not reintroduce it.
