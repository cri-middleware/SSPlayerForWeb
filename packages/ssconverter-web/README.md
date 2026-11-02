[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssconverter-web

Convert SpriteStudio project files (`.sspj`) into the runtime binary format
(`.ssab`) the players load — in your browser or from the command line.

> **Who this is for:** you have a SpriteStudio project (`.sspj`) and need the
> runtime `.ssab` — convert it via a drag-and-drop browser tool or a scriptable CLI.
> Not an npm package — the browser tool is hosted on GitHub Pages
> and the CLI ships with the monorepo (see [Get the tool](#get-the-tool) below).
> **Not what you need?** → [ssconverter-core](../ssconverter-core) — the
> environment-agnostic converter engine to embed in your own app.

Part of the [SSPlayerForWeb](../../README.md) monorepo.

## Choose how to run it

Both modes run the **same** `.sspj → .ssab` conversion — pick by workflow:

| | **Browser tool** | **CLI** |
|---|---|---|
| Best for | one-off conversions, non-technical users | **developers**: scripting, CI, batch jobs |
| How | open the hosted page, drag/drop the `.sspj` project **folder**, download the `.ssab` | `node packages/ssconverter-web/scripts/cli.js -o ./out project.sspj` |
| Output | ZIP download from the browser | files written to an output directory |
| Jump to | [Browser tool](#browser-tool) | [CLI](#cli) |

## Get the tool

The **browser tool** needs nothing installed — open
**[ssconverter-web (hosted)](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)**.

The **CLI** — and serving the browser tool from source — needs the monorepo cloned
and installed once:

```bash
git clone https://github.com/cri-middleware/SSPlayerForWeb.git
cd SSPlayerForWeb
pnpm install
pnpm run download:wasm   # fetch the pre-built converter WASM (no toolchain needed)
pnpm run build           # builds @spritestudio/ssconverter-core, which the CLI and the dev server import
```

`download:wasm` fetches `@spritestudio/ssconverter-core`'s
`wasm/ssconverter_bg.wasm`, which is **not tracked in git**, and `build` builds that package,
which both the CLI and the dev server import. Run the two once; then use either mode below
(all commands are run from the repo root).

## Browser tool

Hosted on GitHub Pages at
**[/ssconverter/](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)**.
From a clone, a Vite **dev server** serves the same tool at the URL it prints:

```bash
pnpm --filter @spritestudio/ssconverter-web dev
```

Drop the **folder** containing your `.sspj` project into the page, and download the
converted `.ssab`. Best for a quick one-off or a non-technical user — no command line
involved.

## CLI

**A developer tool** — scriptable conversion for CI / batch jobs with a chosen
output directory. Needs Node and the cloned repo (commands run from the repo root):

```bash
# Output goes next to the .sspj unless -o is given:
node packages/ssconverter-web/scripts/cli.js -o ./out path/to/project.sspj
```

The CLI reads the `.sspj` directory recursively, converts it, and writes the
generated `.ssab` (plus any referenced textures) into the output directory.

```
Usage: node packages/ssconverter-web/scripts/cli.js [-o output_dir] [-e|--embedded] [--suffix <s>] [--stem-dir] <project.sspj>
```

> The package declares a bin, `ssconverter-web-cli` (→ `scripts/cli.js`), but nothing
> links it onto your `PATH` — it is a workspace-only package, so no `npm install -g`
> ever runs for it. Invoke the script by path as shown above.

## How this compares to the native SDK tools

*Decision help if you're choosing across SpriteStudio's converter tools — skip if
you're just here to convert.*

This is the same `.sspj → .ssab` conversion as the SDK's native `ssconverter-cli`
— the identical `libssconverter` engine — but compiled to **WebAssembly**, which
changes how you run it:

- **No per-platform binary — deployable as a no-install web page.**
  `ssconverter-cli` is a native binary you fetch from the [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK)
  releases for your specific OS. This converter is WASM, so the browser tool runs
  entirely client-side and can be served as a plain web page — cross-platform by
  construction, with no matching-binary hunt.
- **Native to JS / TS pipelines.** The Node CLI is plain JavaScript over the same
  WASM, so it slots into your existing pnpm / CI scripts without shipping a
  separate native executable alongside them.

Reach for `ssconverter-cli` when you specifically want a standalone native
binary, or the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases)
when you want a native app.

## For library integrators

Want to embed `.sspj → .ssab` conversion in your own app rather than run a tool?
Depend on [`@spritestudio/ssconverter-core`](../ssconverter-core) directly — the
environment-agnostic engine. Both interfaces here are thin **hosts** on top of it:
this package supplies the I/O (browser: folder picker and drop + ZIP download; CLI:
filesystem), while the core does the conversion.

## License

BSD-3-Clause — see [LICENSE.md](../../LICENSE.md).

---

## For contributors — building from source

*Consumers can stop here — everything below is for hacking on this package.*

Building the converter WASM from source instead of downloading it (SDK / player
developers) needs the Rust / wasm-pack toolchain:

```bash
pnpm run build:wasm   # build the WASM from source (requires Rust / wasm-pack)
```

See [Development Environment](../../CONTRIBUTING.md#development-environment) in CONTRIBUTING for the full toolchain setup.
