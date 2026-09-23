# SSPlayerForWeb — AI Agent Guide

## Operating rules

*   Keep changes scoped to the requested task. Unrequested hardening is a suggestion, not a commit; a defect
    you actually hit in the code you touched is not — fix it, or say plainly why you did not.
*   Do not commit, push, or open PRs unless the user explicitly asks.
*   Before editing, read enough surrounding context to understand callers and invariants, the ones below
    included. If the read tool truncated a file, read the remaining ranges first.
*   Follow the existing style of the file you touch (naming, type usage, control flow, error handling).
*   **Anything that exists twice changes twice** — a page and its translation, a `.sh` and its `.ps1`. A
    change that lands in one half is the defect this family produces most.
*   **Never break a line between two Japanese characters**: Chrome draws that break as a visible space.
*   **Finish by running this repository's checks**: the commands in [CONTRIBUTING.md](./CONTRIBUTING.md),
    and `pnpm run build` again before checking an example, which consumes the **built** packages. Read what
    a run says it verified rather than its exit code — several checks here pass, or skip themselves, when a
    prerequisite is missing.
*   **Do not restate here what another file owns.** The table below says which file that is; a fact that
    belongs to none of them goes where it will be seen to go stale.
*   **Never commit inside the `SpriteStudio-SDK` submodule.** A change the core needs is a pull request in
    the SDK repository, followed by a submodule bump here.
*   **Playback semantics are the SDK's** — the Rust core is the submodule; do not reimplement the rules it
    owns. Do not alter that submodule's structure without explicit instruction.
*   **Code comments do not cite the SDK's porting guide** — no section numbers, page paths or quotes.
    Its sections move as it is revised and nothing checks a citation inside a comment; say what breaks
    if the code changes, and leave the rule to the guide.

## What this repo is

A pnpm workspace of browser packages over the Rust core, compiled to WebAssembly.

| Package | Role |
|---|---|
| `ssplayer-core` | Engine-agnostic WebAssembly wrapper (runtime). |
| `ssplayer-pixi` | PixiJS v8 renderer bindings. |
| `ssplayer-webgl` | Standalone WebGL1/2 renderer and the `<ss-player>` Web Component. |
| `ssplayer-rmmz` | RPG Maker MZ renderer bindings. |
| `ssconverter-core` | Engine-agnostic WebAssembly converter core (`.sspj` → `.ssab` / `.ssqb`). |
| `ssconverter-web` | A host over it: the browser converter UI and the Node CLI. |

`examples/` holds a Vite test server per renderer. The Rust core is the `SpriteStudio-SDK`
submodule.

## Where each answer is written

| Question | File |
|---|---|
| What each package does, and the architecture diagram | [README.md](./README.md), the [docs site](./docs/) |
| How to set up, build, test and regenerate code | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| How the site is built and a release is cut | [RELEASING.md](./RELEASING.md), maintainers only |
| What to build next, and what is out of scope | [ROADMAP.md](./ROADMAP.md) |
| What each script does and takes | that script's `--help` |

## Invariants

- **`@spritestudio/ssplayer-core` stays decoupled** from every rendering engine and from
  browser-specific DOM APIs. It is the wrapper around the Rust WebAssembly logic and nothing else;
  engine bindings are their own packages.
- **Transfer between WebAssembly and JavaScript is zero-copy.** Use typed arrays that view
  `wasmMemory.buffer` directly rather than copying out of it, so playback allocates nothing per
  frame and gives the collector nothing to pause for.
- **WASM memory is not collected for you.** Every object holding a WASM allocation registers with
  a `FinalizationRegistry` that calls its `free()`, so a dropped reference cannot leak.
- **The player facades are split by rendering strategy**, and that split is the architecture:
  `DirectInternalPlayer` draws directly (PixiJS v8 through its BatchRenderer),
  `SceneGraphInternalPlayer` draws through a hierarchy (RPG Maker MZ, PixiJS v5). Add a renderer
  by choosing one of them, not by widening the other.
- **Generated WASM is not tracked in git**, so a fresh checkout has to build or download it before
  anything else works. The FlatBuffers accessors under `packages/ssplayer-core/src/ss/` **are**
  tracked: regenerate and commit them after a schema change, and never hand-edit them.
- **Anything exposed from `ssruntime` must be a C-API compatible with `wasm-bindgen`.**
- **Dependencies are added per workspace** (`pnpm add <pkg> --filter <workspace>`), never to the
  root by reflex.
- **`ssconverter-core` keeps its wasm glue external** (`deps.neverBundle`), so the glue can never
  desync from the wasm binary in `wasm/`.
- **TypeScript is strict; avoid `any`.**
