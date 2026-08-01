[**English**](./README.md) | [**日本語**](./README.ja.md)

# SSPlayerForWeb

**Professional 2D animation for the Web — one WebAssembly-powered core, rendered through modern PixiJS or a zero-dependency standalone WebGL engine.**

A high-performance player for **[OPTPiX SpriteStudio 7](https://www.webtech.co.jp/spritestudio/)** animations (`.ssab`) on the Web. Animate the sprite art you already have (PNG / WebP) in a dedicated editor, then play it back in the browser through the rendering engine of your choice — no video files, no re-authoring.

## 🌐 Try it live

No install — these run entirely in your browser (🚧 live once the first release is published):

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — convert `.sspj` → `.ssab` entirely client-side (start here)
- ▶️ **[Standalone WebGL example](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — zero-dependency standalone renderer (the `<ss-player>` Web Component). *Supports D&D of `.ssab` files.*
- ▶️ **[PixiJS example](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — for PixiJS v8 apps. *Supports D&D of `.ssab` files.*
- ▶️ **[RPG Maker MZ example](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — a sample MZ project (SpriteStudio pictures)
- ▶️ **[TyranoScript example](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** — a visual-novel scene driven by `[ss_*]` tags (beta)
- 🎨 **[Part override example](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** — swap a part's colour, cell or visibility at runtime (PixiJS)

## 📚 Documentation

Comprehensive documentation lives in the `docs/` folder (hosted via VitePress) and is structured step-by-step according to what you want to do:

- [**Documentation site (hosted)**](https://cri-middleware.github.io/SSPlayerForWeb/) — 🚧 live after the first release
- [**Documentation (English)**](./docs/index.md) · [**日本語ドキュメント**](./docs/ja/index.md)

### Quick Links
- [Installation](./docs/setup/install.md)
- [Quick Start](./docs/setup/quickstart.md)
- [Basic Usage](./docs/usage/basic.md)
- [Asset Preparation](./docs/usage/assets.md)
- [WebGL Standalone & Web Components](./docs/usage/webgl.md)
- [PixiJS Integration](./docs/usage/pixi.md)
- [Migrating from SS6Player for Web](./docs/migration_from_ss6.md)

### Where to read, by goal
You only need to read as far as your goal requires:

| You are… | Your goal | Where to read |
|---|---|---|
| **A general user** | Just get animations running | [Quick Start](./docs/setup/quickstart.md) → [Basic Usage](./docs/usage/basic.md) |
| **A customization user** | Polish expressions and add logic | Above + [Customization](./docs/customize/events.md) |
| **An SDK / player developer** | Extend or contribute to the core | Above + [CONTRIBUTING.md](./CONTRIBUTING.md) |

## 🎯 Which Package Should I Use?

Each renderer bundles the WASM core, so you install just one package — pick the row that matches your environment. Each package's README explains **why you'd choose SpriteStudio for that specific stack** (PixiJS, plain WebGL, …).

| Your environment | Package | Runnable example |
|---|---|---|
| **Standalone / no framework** (`<ss-player>` Web Component) | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **PixiJS v8 app** | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **Building your own renderer** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **Converting `.sspj` → `.ssab`** | [`ssconverter-web`](./packages/ssconverter-web) (Web tool + Node CLI) | — |
| **Embedding conversion in your own app/service** | [`@spritestudio/ssconverter-core`](./packages/ssconverter-core) | — |

**Game-engine integrations** — thin adapters on top of `ssplayer-webgl`, installed as plugin bundles rather than from npm. RPG Maker MZ is **alpha**; the two Tyrano integrations are **beta**:

| Your environment | Package | Runnable example |
|---|---|---|
| **RPG Maker MZ** (PixiJS v5) | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **TyranoScript** (visual-novel engine) | [`@spritestudio/ssplayer-tyranoscript`](./packages/ssplayer-tyranoscript) | [examples/tyranoscript-example](./examples/tyranoscript-example) |
| **TyranoBuilder** (visual-novel editor) | [`@spritestudio/ssplayer-tyranobuilder`](./packages/ssplayer-tyranobuilder) | — |

## 🚀 Quick Start

There are two ways in — pick the one that matches you:

- **A. Run the examples from this repo** — to evaluate SSPlayerForWeb or work on it locally.
- **B. Use it in your own project** — to install the packages into an app you're building.

### A. Run the examples from this repo

**Prerequisites:** [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) (this repo uses pnpm workspaces). The steps below fetch the **pre-built** WASM core, so no Rust toolchain is required.

```bash
git clone https://github.com/cri-middleware/SSPlayerForWeb.git
cd SSPlayerForWeb
git submodule update --init --recursive  # SpriteStudio-SDK (sample source + core)
pnpm install                             # install deps & initialize the workspace
pnpm run download:wasm                   # fetch the pre-built WASM (macOS & Windows alike)
pnpm run build                           # build all TypeScript packages
pnpm run deploy-examples                 # generate the .ssab assets the examples load
cd examples/webgl-example
pnpm run dev                             # open the dev server and see the animation
```
The examples consume the **built** packages via workspace references — re-run `pnpm run build` whenever you change TypeScript under `packages/`, and `pnpm run deploy-examples` if you edit the sample projects.

**Building the WASM core from source** (only if you modify the Rust core): replace `pnpm run download:wasm` with `pnpm run build:wasm` — everything else is identical. This additionally needs **Rust** (via [rustup](https://rustup.rs/)) and **wasm-pack** (`cargo install wasm-pack`). Contributing the change back? [CONTRIBUTING.md](./CONTRIBUTING.md) covers the coding standards and WASM FFI rules.

### B. Use it in your own project

> 🚧 The packages are **not published to npm yet** — this path opens up after the first release. Until then, use **Track A** to try things locally.

No Rust or WASM toolchain needed — the WASM ships inside each renderer package. Install the renderer for your environment (see the table above), convert your `.sspj` → `.ssab`, and play it in a few lines. The full walkthrough lives in the docs:

**[Installation](./docs/setup/install.md)** · **[Quick Start](./docs/setup/quickstart.md)** · **[Preparing assets (.sspj → .ssab)](./docs/usage/assets.md)**

## 💡 Overview

### Monorepo Structure

This project uses `pnpm` workspaces, layered so that rendering stays fully decoupled from the animation logic:

```mermaid
flowchart TD
    subgraph conv ["Conversion (author-time)"]
        direction LR
        sspj[".sspj"] --> convcore["ssconverter-core<br/>(WASM)"] --> ssab[".ssab"]
        convweb["ssconverter-web<br/>browser UI + Node CLI"] -. wraps .-> convcore
        tyranob["ssplayer-tyranobuilder<br/>TyranoBuilder editor (beta)"] -. wraps .-> convcore
    end

    subgraph play ["Playback (run-time)"]
        core["ssplayer-core<br/>(WASM, engine-agnostic)"]
        webgl["ssplayer-webgl<br/>standalone WebGL + &lt;ss-player&gt;"]
        pixi["ssplayer-pixi<br/>PixiJS v8"]
        rmmz["ssplayer-rmmz<br/>RPG Maker MZ (alpha)"]
        tyrano["ssplayer-tyranoscript<br/>TyranoScript (beta)"]
        core --> webgl
        core --> pixi
        webgl --> rmmz
        webgl --> tyrano
    end

    tyranob -. ships .-> tyrano
    ssab ==>|feeds| core
```

- **[`ssplayer-core`](./packages/ssplayer-core)** does the timeline and WASM work, then hands each frame to a renderer as plain draw data — no DOM, no engine assumptions. Every renderer is a thin binding on top of it, so adding one (see the [ROADMAP](./ROADMAP.md)) touches only that package; `ssplayer-rmmz` and `ssplayer-tyranoscript` further build on `ssplayer-webgl`, and `ssplayer-tyranobuilder` is author-time tooling that ships the TyranoScript runtime and converts `.sspj` inside the editor.
- **[`ssconverter-core`](./packages/ssconverter-core)** is a separate WASM core (a build of the Rust `libssconverter`) with the same bytes-in / bytes-out design, so the same converter runs in the browser, Node, a Worker, or an edge runtime — the desktop [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI/releases) covers the same step outside a build.

Per-package details live in each package's README, linked from the tables above.

## 🎬 Samples

Ready-to-run example apps live under [`examples/`](./examples/) — one per renderer, each linked from the per-environment tables above. Build the packages first ([Quick Start](#a-run-the-examples-from-this-repo)), then start any example's dev server. For the PixiJS and WebGL examples, you can drag and drop a folder containing an `.ssab` file (and its textures) or an embedded `.ssab` file directly into the browser to play your own assets.

## 🔗 Related Repositories

- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the core SDK providing `libssruntime` and `libssconverter`.
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — desktop GUI tool for converting `.sspj` to `.ssab`.

## 🚢 Releasing (maintainers)

Packages are versioned **independently** with [Changesets](https://github.com/changesets/changesets) and published by the **Release** GitHub Action — a manual, one-shot workflow ([`release.yml`](./.github/workflows/release.yml)) that runs only from `main`.

**Published to npm** (public): `ssplayer-core`, `ssplayer-pixi`, `ssplayer-webgl`, `ssconverter-core`. `ssplayer-rmmz`, `ssplayer-tyranoscript`, `ssplayer-tyranobuilder` and `ssconverter-web` are `private` — distributed via GitHub Releases, not npm.

### One-time setup

- **`SS_NPM_TOKEN`** — add an npm **automation** token as a repository secret (Settings → Secrets and variables → Actions). Required: the Release workflow authenticates with it.
- **npm access** — the publisher must be a member of the `@spritestudio` org with publish rights.
- **[changeset-bot](https://github.com/apps/changeset-bot)** — install the app on the repo so every PR gets an advisory "is there a changeset?" comment (non-blocking).

### Everyday: add a changeset per change

In any PR that should affect a released package, record the intent and commit the generated file with your PR:

```bash
pnpm changeset          # pick packages + bump type (patch/minor/major), write a summary
```

Changes that don't need a release (docs, CI, refactors) need no changeset — use `pnpm changeset --empty` only if you want an explicit "no release" marker.

### Cut a release

1. Merge the PRs (each carrying its changeset) to `main`.
2. Run **Actions → Release → Run workflow** on `main`.

The workflow then, in one shot:

- builds and tests everything up front — an npm version is immutable, so a red build must stop the release before anything is versioned or uploaded,
- consumes the accumulated changesets → bumps each package's version + `CHANGELOG.md`,
- rewrites the version-pinned CDN snippets in the READMEs / docs / `examples/cdn` to match (`scripts/sync-doc-versions.mjs`), and commits that together with the bump,
- fetches the WASM and builds every package (the per-package `prepack` guard refuses to publish a package whose `dist`/`wasm` is missing),
- publishes the public packages to npm and pushes the per-package git tags (`@spritestudio/…@x.y.z`).

**No changesets pending is not a no-op.** `changeset publish` compares every package against the registry and ships whatever is missing, so a dispatch with nothing to version still performs the *first* release of the current versions — and recovers a run that died between publishing and pushing. Only "everything already on npm" is a true no-op.

Afterwards the docs/demo site rebuilds automatically ([`pages.yml`](./.github/workflows/pages.yml) chains on the Release run).

### Prerelease (beta) line

`.changeset/pre.json` puts the repo in Changesets **pre mode**: `changeset version` produces `X.Y.Z-beta.N` and publishes under the `beta` dist-tag. There is therefore **no `latest` tag** while the line is open — `npm install @spritestudio/ssplayer-webgl` fails and consumers must ask for `@beta`, which is what the package READMEs say. End the line with `pnpm changeset pre exit`, then release: that ships `X.Y.Z` to `latest`, and the `@beta` in the install instructions can drop away.

> **Provenance is off** while the repository is private — npm rejects an attested publish from a private repo. Flip `NPM_CONFIG_PROVENANCE` back to `'true'` in `release.yml` the moment it goes public.

> **CDN version pairs are not required to be equal.** The `.wasm` and its JS glue share an ABI, so both URLs need an exact version — but packages release independently, so `ssplayer-webgl@7.0.1` may legitimately pair with `ssplayer-core@7.0.0`. Don't hand-edit these pins; `pnpm run sync:docs` derives them from the manifests (and `pnpm run check:docs` reports drift without writing).

### Manual fallback

Publishing normally goes through the Action. To publish from a clean `main` locally: `pnpm changeset version` → commit → `pnpm run ci:publish` (runs `download:wasm` → `build` → `changeset publish`) → push the commit and tags.

## 📄 License

This project is licensed under the BSD-3-Clause License. See [LICENSE.md](./LICENSE.md) for details.

For the licenses of the bundled `SpriteStudio-SDK` and other third-party libraries, see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Need help? See [SUPPORT.md](./SUPPORT.md); participation is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
