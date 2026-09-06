# Preparing assets (.sspj → .ssab)

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

The player does not play SpriteStudio's `.sspj` directly; it plays **`.ssab`**, a
parse-free runtime binary. A converter reads the `.sspj` and its referenced files
(`.ssae` / `.ssee` / `.ssqe` / `.ssce`) and produces `.ssab` (animations) plus, when
needed, `.ssqb` (sequence packs).

There are three conversion tool routes — pick by how you work. In addition, if you
want to embed conversion itself into your own app, use the library
**`@spritestudio/ssconverter-core`**.

::: tip No `.sspj` of your own yet?
The [official SpriteStudio sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)
works as-is — that page is only available in Japanese, but the downloads
themselves are language-neutral. [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)
is a good character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one
if you want effects. The downloaded project feeds any of the tools below as-is.
:::

| Tool | Best for | Getting it |
|---|---|---|
| [`ssconverter-web`](#ssconverter-web-browser-tool) | Converting a few projects by hand | Open it in your browser at <a href="../ssconverter/" target="_blank" rel="noreferrer">/ssconverter/</a> (🚧 live once the first release is published) |
| [`SSConverterGUI`](#ssconvertergui-desktop-gui-tool) | A simple desktop GUI | Download a binary from [Releases](https://github.com/cri-middleware/SSConverterGUI/releases) |
| [`ssconverter-cli`](#ssconverter-cli-cli-ci-for-developers) | CI / batch / reproducibility | Download a binary from [SDK Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases) |
| [`@spritestudio/ssconverter-core@beta`](#ssconverter-core-library-embedding-in-your-own-app) | Embedding conversion in your own app/service | `npm i @spritestudio/ssconverter-core@beta` |

For the overall flow, see the [overview diagram on the home page](/#overview-from-sspj-to-rendering).

## ssconverter-web (browser tool)

A tool that converts a `.sspj` project in the browser and downloads the result as a
**ZIP**. It runs the WASM build of the converter directly in the browser.

It is hosted beside these docs at
<a href="../ssconverter/" target="_blank" rel="noreferrer">/ssconverter/</a>, so there is
nothing to install (🚧 live once the first release is published). The bundled Node CLI
is a developer tool.

::: warning Supported browsers
Folder selection uses the **File System Access API** (`showDirectoryPicker` /
directory drag-and-drop), so a **Chromium-based browser (Chrome / Edge, etc.)** is
required. It does not work in Firefox / Safari.
:::

### Steps

1. Open <a href="../ssconverter/" target="_blank" rel="noreferrer">the converter</a>.
   From a clone of the repository, this serves the same tool:

   ```bash
   pnpm --filter @spritestudio/ssconverter-web dev
   ```

2. Drag and drop a **project folder** onto the drop zone, or pick one with `Browse...`.
   - The folder must contain **exactly one** `.sspj` (zero or multiple is an error).
   - Hidden files such as `.DS_Store` are ignored.
3. Check **Embedded Assets** if needed (embed textures into the `.ssab`; see below).
4. Press **⚡ Convert & Download** to convert and auto-download the ZIP.

WASM initialization and conversion progress show up in the status badge, with details
in the log pane (which also reports the converter version and ssab schema version).

### Output (inside the ZIP)

| Mode | ZIP name | Root folder | Contents |
|---|---|---|---|
| Normal | `<name>_<timestamp>.zip` | `<name>/` | `.ssab` (+ `.ssqb`) + referenced textures |
| Embedded | `<name>_emb_<timestamp>.zip` | `<name>_emb/` | textures embedded in the `.ssab` (no separate files) |

Extract the downloaded ZIP and place the `.ssab` (and, in Normal mode, its textures)
where you serve them ([Placement and texture resolution](#placement-and-texture-resolution)).

## SSConverterGUI (desktop GUI tool)

A desktop GUI tool for converting `.sspj` to `.ssab`. Download the binary for your OS
from **[SSConverterGUI Releases](https://github.com/cri-middleware/SSConverterGUI/releases)** and run it.

## ssconverter-cli (CLI / CI, for developers)

A **native build-time CLI** distributed by the SpriteStudio-SDK (a wrapper around
`libssconverter`, using the same conversion pipeline as the SDK's release artifacts).
It fits CI, batch conversion, and cases that need reproducibility.

### Getting it

- **Prebuilt binary**: download the Windows / macOS / Linux build from the
  **[SpriteStudio-SDK Releases](https://github.com/cri-middleware/SpriteStudio-SDK/releases)**.
  No build environment required.
- **Build from source**: with a Rust toolchain, run `cargo install --path cli` at the
  root of the SDK repository.

### Single mode (one project)

You can set the output directory with `-o`.

```bash
# Convert (with an output directory)
ssconverter-cli project.sspj -o ./public/assets

# Embed referenced assets (images, etc.) into the .ssab
ssconverter-cli project.sspj --embedded
```

| Option | Description |
|---|---|
| `-o`, `--out-dir <dir>` | Output directory (Single mode only) |
| `-e`, `--embedded` | Embed referenced assets into the `.ssab` |
| `-h`, `--help` | Show help |

### Batch mode (multiple / whole directory)

Pass multiple file paths, or a directory containing `.sspj` files (recursive).
**In this mode `--out-dir` is ignored**, and each output is written next to its source
as `<name>/`.

```bash
# Multiple files
ssconverter-cli project1.sspj project2.sspj

# Convert every .sspj in a directory (recursive)
ssconverter-cli ./assets/projects ./extra_assets
```

### Output

| Mode | Output directory | Contents |
|---|---|---|
| Normal | `<name>/` | `.ssab` (per animation) + `.ssqb` (when `.ssqe` is referenced) + copies of referenced textures |
| `--embedded` | `<name>_emb/` | Same as above, but referenced assets are embedded in each `.ssab` (no separate texture copies) |

For details, see the SDK's
[ssconverter-cli README](https://github.com/cri-middleware/SpriteStudio-SDK/blob/main/cli/README.md).

## ssconverter-core (library / embedding in your own app)

If, instead of the tools above, you want to **embed conversion itself into your own
JavaScript/TypeScript app or service**, use
**[`@spritestudio/ssconverter-core`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssconverter-core)**,
which provides the conversion engine as an npm library. It wraps the WebAssembly build
of Rust's `libssconverter` with an ergonomic TypeScript API, and this library on its
own is published on npm.

It is **bytes in, bytes out** and depends on neither the file system nor the DOM, so
the same core runs in the browser, Node, a Web Worker, or an edge runtime
(`ssconverter-web`'s browser UI and Node CLI both sit on top of this core).

```bash
npm i @spritestudio/ssconverter-core@beta
```

```ts
import {
  init,
  convertProject,
  locateProject,
  version,
  ssabSchemaVersion,
} from '@spritestudio/ssconverter-core';

// Browser: load the bundled wasm by URL
import wasmUrl from '@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm?url';
await init(wasmUrl);

// Node: read the wasm bytes yourself and pass them in
// import { readFile } from 'node:fs/promises';
// const wasmPath = new URL(
//   import.meta.resolve('@spritestudio/ssconverter-core/wasm/ssconverter_bg.wasm'),
// );
// await init(await readFile(wasmPath));

console.log(`converter ${version()} (ssab v${ssabSchemaVersion()})`);

// files: every path inside the project directory (including the .sspj) → bytes
const { stem } = locateProject(files.keys());
const result = convertProject(files, { embedded: false });

for (const [name, bytes] of result.output) {
  /* write as `${stem}/${name}` */
}
for (const [dest, src] of result.assets) {
  /* copy referenced texture src to dest (non-embedded only) */
}
```

I/O (reading/writing files, zipping, downloading) is the caller's (host's)
responsibility. For the full API, see the
[`ssconverter-core` README](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/packages/ssconverter-core#api).

## Placement and texture resolution

::: info Which file becomes which
The roles of `.sspj` / `.ssae` / `.ssce` / `.ssqe` and how they map to the output are the same for
every Player, so they are documented in the portal —
[Asset Conversion — How a project's files map to the output](https://cri-middleware.github.io/SpriteStudio-Docs/overview/conversion/#how-a-projects-files-map-to-the-output).

Two points matter. **One `.ssae` becomes one `.ssab`**, and **cell positions are baked from the
`.ssce` into the `.ssab`**. Because of the latter, whenever you add, move or resize cells, or change
the image size, **re-deploy the `.ssab` as well as the image** — serving a new image alone leaves the
old source rectangles in place and the artwork shifts.
:::

- Place the generated `.ssab` and the texture images output alongside it somewhere your web server can serve as the application's static assets.
- Texture images are loaded from the same directory as the `.ssab` (the structure ssconverter emits). Keep them next to the `.ssab`, or in a subdirectory the `.ssab` references — there is no option to point them at an unrelated directory.
- An `.ssab` converted in **Embedded** mode contains its textures inside the file, so no separate image placement is needed. Having everything in a single file makes the asset convenient to manage.

### Caching and replacement

The `.ssab` and its textures are **separate HTTP requests**. A texture's URL is nothing more than
the `.ssab`'s URL directory joined with the path inside the pack — no version query, no hash. Which
of them updates, and when, is therefore **whatever your cache configuration decides**.

This is where the baked-in cell rectangles start to matter. When the atlas layout or the image size
changes, the `.ssab` and the `.png` have to become visible **together**. If one arrives first, new
artwork is drawn against old source rectangles and it shifts. The load succeeds and nothing errors,
so you only notice by looking at the screen.

::: warning Do not fingerprint only one of them
The usual ways in: content-hashing the `.png` filename but not the `.ssab`, or serving the two with
different `Cache-Control` lifetimes. Check that your bundler or CDN is not set up to fingerprint
images alone.
:::

Any of these avoids it:

| Approach | What it means |
|---|---|
| **Version the set** | Change the URL a folder at a time — `/assets/v3/<name>/`. Moving the `.ssab`'s URL moves its textures' URLs with it, so the pair cannot come apart |
| **One cache policy for the folder** | Serve everything under `<name>/` with the same `Cache-Control` |
| **Convert with embedded** | The textures live inside the `.ssab`, so there is one request and the pair cannot come apart. It suits a self-contained asset, though — see below |

::: warning Embedded is the wrong tool for differential delivery
Embedding welds the **large, rarely-changing atlas** into the same file as the **small, frequently-changing
keyframes**. Fixing one frame of an animation re-downloads the atlas with it — exactly backwards from
what a differential update is for.

Sharing stops working too. Embedded textures are deliberately kept out of the shared cache and are
decoded per `SSPlayer` ([Resources and lifecycle](/customize/resources)). Five characters using one
atlas cost one download and one GPU texture in reference mode, and five of each when embedded.

It is a good fit for a one-off banner, or a single character that shares its atlas with nothing. For
**a set of characters sharing an atlas that you keep updating**, stay on reference textures and
version the folder instead.
:::

Note that embedding covers **textures only**. The packs an Instance part plays are still fetched
separately, as `<base URL>/<pack name>.ssab`, so embedding does not reduce the request to one — ship
a parent and its referenced packs as a set. The choice is also made per *texture*, not per pack: any
texture without embedded bytes is still fetched by URL, so in a partly embedded pack everything in
this section still applies to the rest.

Versioning the set also lines up with the runtime caches: both Pixi's `Assets` cache and the WebGL
backend's texture cache are **keyed by URL**, so a changed URL cannot keep handing you the old
texture ([Resources and lifecycle](/customize/resources)).

For load-and-play steps, see the [Quick start](/setup/quickstart).
