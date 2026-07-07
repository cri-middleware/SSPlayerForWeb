[**English**](./README.md) | [**日本語**](./README.ja.md)

# ssconverter-web

WebAssembly-powered converter that turns SpriteStudio project files (`.sspj`)
into the runtime binary format (`.ssab`) consumed by the players. Ships as both
a **browser tool** (Vite app) and a **Node.js CLI**.

Part of the [SSPlayerForWeb](../../README.md) monorepo.

> This package is `private` — it is a tool within the monorepo and is **not
> published to npm**.

## ✨ Why ssconverter-web?

Same `.sspj → .ssab` conversion as the SDK's native `ssconverter-cli` — the
identical `libssconverter` engine — but compiled to **WebAssembly**, which
changes how you run it:

- **No per-platform binary — deployable as a no-install web page.**
  `ssconverter-cli` is a native binary you fetch from the [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK)
  releases for your specific OS. This converter is WASM, so the browser tool runs
  entirely client-side and can be served as a plain web page — end users just
  open it, drop a `.sspj`, and download the `.ssab`. Cross-platform by
  construction, with no matching-binary hunt.
- **Native to JS / TS pipelines.** The Node CLI is plain JavaScript over the same
  WASM, so it slots into your existing pnpm / CI scripts without shipping a
  separate native executable alongside them.

Reach for `ssconverter-cli` when you specifically want a standalone native
binary, or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases)
when you want a native app.

## Setup

The converter WASM (`wasm/ssconverter_bg.wasm`) is **not tracked in git**, so
obtain it once from the repo root before using either interface below:

```bash
pnpm run download:wasm   # fetch the pre-built WASM (no toolchain needed)
```

> Building from source instead (SDK / player developers)? Run `pnpm run build:wasm`
> — this needs the Rust / wasm-pack toolchain. See the
> [repo README](../../README.md#-quick-start).

## Browser tool (dev server)

```bash
pnpm --filter ssconverter-web dev
```

Opens a Vite dev server where you can drop a `.sspj` project and download the
converted `.ssab`.

## CLI

```bash
# Output goes next to the .sspj unless -o is given:
node packages/ssconverter-web/scripts/cli.js -o ./out path/to/project.sspj
```

The CLI reads the `.sspj` directory recursively, converts it, and writes the
generated `.ssab` (plus any referenced textures) into the output directory.

```
Usage: node scripts/cli.js [-o output_dir] <project.sspj>
```

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).
