# @spritestudio/ssconverter-core

Environment-agnostic WebAssembly core that converts OPTPiX SpriteStudio 7
projects (`.sspj`) to runtime binaries (`.ssab` / `.ssqb`).

This package is the wasm build of the Rust [`libssconverter`] crate plus a small
ergonomic TypeScript layer. It has **no filesystem or DOM dependencies** — bytes
in, bytes out — so the same core runs in the browser, Node, a Worker, or an edge
runtime. Hosts such as [`ssconverter-web`] (web UI) and its Node CLI supply the
I/O around it.

[`libssconverter`]: https://github.com/cri-middleware/SpriteStudio-SDK
[`ssconverter-web`]: ../ssconverter-web

## Install

```sh
npm i @spritestudio/ssconverter-core
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

The wasm is **not** tracked in git. It is fetched from the SpriteStudio-SDK
Releases via `pnpm download:wasm`, or built from source with `pnpm build:wasm`,
at the repo root.

## License

BSD-3-Clause. See [LICENSE.md](./LICENSE.md).
