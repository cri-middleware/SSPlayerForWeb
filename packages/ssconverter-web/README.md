# ssconverter-web

WebAssembly-powered converter that turns SpriteStudio project files (`.sspj`)
into the runtime binary format (`.ssab`) consumed by the players. Ships as both
a **browser tool** (Vite app) and a **Node.js CLI**.

Part of the [SSPlayerForWeb](../../README.md) monorepo.

> This package is `private` — it is a tool within the monorepo and is **not
> published to npm**.

## Browser tool (dev server)

```bash
pnpm --filter ssconverter-web dev
```

Opens a Vite dev server where you can drop a `.sspj` project and download the
converted `.ssab`.

## CLI

```bash
# 1. Build the converter WASM first (not tracked in git, requires rustup and `cargo install wasm-pack`):
pnpm run build:wasm

# 2. Convert a project. Output goes next to the .sspj unless -o is given:
node packages/ssconverter-web/scripts/cli.js -o ./out path/to/project.sspj
```

The CLI reads the `.sspj` directory recursively, converts it, and writes the
generated `.ssab` (plus any referenced textures) into the output directory.

```
Usage: node scripts/cli.js [-o output_dir] <project.sspj>
```

## Requirements

- The converter WASM (`wasm/ssconverter_bg.wasm`) must be built via
  `pnpm run build:wasm`. WASM binaries are not tracked in git.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
