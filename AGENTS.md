# SSPlayerForWeb — AI Agent Guide

## Operating rules

*   **Unrequested hardening is a suggestion, not a commit.** A defect you hit in code you touched is not:
    fix it, or say why you did not.
*   **Anything that exists twice changes twice** — a page and its translation, a `.sh` and its `.ps1`.
    Missing one half is this family's most common defect.
*   **Never break a line between two Japanese characters**; Chrome renders the break as a space.
*   **Finish with this repository's checks**: the commands in [CONTRIBUTING.md](./CONTRIBUTING.md), and
    `pnpm run build` again before checking an example, since examples consume the **built** packages. Read
    what a run says it verified, not its exit code — several checks pass, or skip themselves, without a
    prerequisite.
*   **Do not restate what another file owns**; the table below says which file. A fact no file owns goes
    where its staleness will be noticed.
*   **Never commit inside the `SpriteStudio-SDK` submodule.** A core change is an SDK pull request, then a
    submodule bump here.
*   **Playback and rendering semantics are the SDK's**: its [AGENTS.md](./SpriteStudio-SDK/AGENTS.md) and
    the porting guide in `SpriteStudio-SDK/libs/ssruntime/docs/`. Where the guide is silent,
    SSPlayerForWgpu decides. Do not reimplement either.
*   **Code comments never cite the porting guide** (sections, paths, quotes): it moves, and nothing checks
    the citation. Say what breaks instead.

## What this repo is

A pnpm workspace of browser packages over the Rust core (the `SpriteStudio-SDK` submodule) compiled to
WebAssembly: `ssplayer-core` wraps the runtime, renderer packages bind it to PixiJS, WebGL, RPG Maker MZ
and TyranoScript, and the `ssconverter-*` packages convert `.sspj` in the browser, in Node and inside
editor plugins.

## Where each answer is written

| Question | File |
|---|---|
| Each package, and the architecture diagram | [README.md](./README.md), the [docs site](./docs/) |
| Constraints, setup, build, test, code generation, the docs site | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Releases, maintainers only | [RELEASING.md](./RELEASING.md) |
| Plans and non-goals | [ROADMAP.md](./ROADMAP.md) |
| What a script takes | its `--help` |

## Invariants

*   **No per-frame allocations in the playback hot path.** Typed arrays view `wasmMemory.buffer` directly
    rather than copying out of it.
*   **The player facades are split by rendering strategy**: `DirectInternalPlayer` draws directly (PixiJS v8
    through its BatchRenderer), `SceneGraphInternalPlayer` through a hierarchy (RPG Maker MZ, PixiJS v5).
    Add a renderer by choosing one, not by widening the other.
*   **Anything exposed from `ssruntime` must be a C-API that `wasm-bindgen` can bind.**
