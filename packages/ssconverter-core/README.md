[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssconverter-core

Engine-agnostic WebAssembly core that converts OPTPiX SpriteStudio 7 projects (`.sspj`) to runtime binaries (`.ssab` / `.ssqb`).

> **Who this is for:** developers embedding `.sspj → .ssab` conversion into their own app, service, worker, or build pipeline — a bytes-in/bytes-out engine, no filesystem or DOM required.
> **Install:** `npm install @spritestudio/ssconverter-core@beta`
> **Not what you need?** → [ssconverter-web](../ssconverter-web) — just want to convert a file? Use the browser tool + CLI instead.

> **Beta line.** While 7.0.0 is in prerelease the packages publish under the `beta` dist-tag only, so the `@beta` above is required; it becomes optional once 7.0.0 ships to `latest`.

▶️ **[Live demo](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** —
[`ssconverter-web`] is this core running in the browser; drop a `.sspj` in to see what
it produces (🚧 live once the first release is published).

This package is the wasm build of the Rust [`libssconverter`] crate plus a small
ergonomic TypeScript layer. It has **no filesystem or DOM dependencies** — bytes
in, bytes out — so the same core runs in the browser, Node, a Worker, or an edge
runtime. Hosts such as [`ssconverter-web`] (web UI) and its Node CLI supply the
I/O around it.

[`libssconverter`]: https://github.com/cri-middleware/SpriteStudio-SDK
[`ssconverter-web`]: ../ssconverter-web

## When to use this vs ssconverter-web

- **You just want to convert a file** — you have a `.sspj` and want a `.ssab` out.
  Use [`ssconverter-web`](../ssconverter-web): a ready-made **browser tool** and
  **Node CLI**. You do not write any code.
- **You want conversion inside your own code** — an app, backend service, Worker,
  or build step that turns project bytes into runtime bytes. Use **this package**:
  you supply the I/O, the core does the `.sspj → .ssab` conversion.

## Install

```sh
npm install @spritestudio/ssconverter-core@beta
```

## Usage

```ts
import {
  init,
  convertProject,
  locateProject,
  version,
  ssabSchemaVersion,
} from '@spritestudio/ssconverter-core';

// Browser: fetch the bundled wasm by URL.
import wasmUrl from '@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm?url';
await init(wasmUrl);

// Node: read the wasm bytes yourself and pass them in.
// import { readFile } from 'node:fs/promises';
// const wasmPath = new URL(
//   import.meta.resolve('@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm'),
// );
// await init(await readFile(wasmPath));

console.log(`converter ${version()} (ssab v${ssabSchemaVersion()})`);

// `files` maps every path in the project directory (incl. the .sspj) to bytes.
const { stem } = locateProject(files.keys());
const result = convertProject(files, { embedded: false });

for (const [name, bytes] of result.output) {
  /* write `${stem}/${name}` */
}
for (const [dest, src] of result.assets) {
  /* copy source asset `src` -> `dest` (non-embedded only) */
}
```

## API

| Export | Description |
| --- | --- |
| `init(source?)` | Initialize the wasm module. `source` is a `URL`/`Response`, wasm `BufferSource`, or `WebAssembly.Module`. |
| `convertProject(files, opts?)` | Convert a project. `opts`: `{ embedded=false, debug=false, split=false, optimize=true }`. Returns `ConvertResult`. |
| `ConvertResult` | `.output: Map<name, bytes>` (generated files) and `.assets: Map<dest, src>` (external assets to copy; empty when embedded). |
| `locateProject(paths)` | Find the single `.sspj` and derive `{ sspjPath, stem, dir }`. Throws on zero/multiple. |
| `applySuffix(output, suffix)` | Append `suffix` to each `.ssab` basename and drop non-`.ssab` output (for emitting embedded variants side by side). |
| `version()` | Converter build version string. |
| `ssabSchemaVersion()` / `ssqbSchemaVersion()` | Emitted schema versions. |

## License

BSD-3-Clause. See [LICENSE.md](./LICENSE.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package. The published npm package already bundles the wasm.*

Working in the monorepo, the wasm is **not** tracked in git. From the repo root, fetch it from the SpriteStudio-SDK Releases via `pnpm download:wasm`, or build it from source with `pnpm build:wasm`.
