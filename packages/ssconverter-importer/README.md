[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssconverter-importer

The auto-importer the editor plugins in this repository share: it finds the SpriteStudio
projects (`.sspj`) in a source folder, converts the ones that changed since their last
successful import, and records what each conversion wrote.

> **Who this is for:** contributors working on a plugin that imports SpriteStudio projects
> inside its host — [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder) on project
> open, [`ssplayer-rmmz`](../ssplayer-rmmz) on test play. It is
> private: nothing is published, and a plugin bundles it into its own build.

It is the shape of SSPlayerForRenPy's auto-importer, run through
[`@spritestudio/ssconverter-core`](../ssconverter-core):

- **One pass when the host calls `runOnce()`**, and nothing on its own after that.
- **Freshness is the newest mtime across the project folder**, recorded only after a
  successful conversion — SpriteStudio saves only the files that changed, so the `.sspj`
  alone would miss an edited animation.
- **A conversion removes what the previous one wrote and this one did not**, and nothing
  else.
- **Two projects of the same name** do not both write one folder: the first keeps it and
  the other is reported.
- **Conversion runs in a Worker** when the host can start one from a Blob URL, and on the
  calling thread otherwise.

## What a host supplies

- **A filesystem**, as `HostBackend`: Node's `fs` plus `copySync` / `removeSync`,
  `node:path`, and a recursive mkdir. TyranoBuilder publishes exactly this as
  `window.studio_api`; a host with `require()` (MZ's NW.js) builds it from Node. Wrap
  it in `HostFs`.
- **Where things live**, relative to the project root: the source folder
  (`SpriteStudio_Source` by default), the output folder, and the state file — put the last
  two where the host's export does what you want with them.
- **The converter wasm** (`ssconverter_bg.wasm`, from `ssconverter-core`), as a path.
- **The Worker**, optionally: `import workerSource from '@spritestudio/ssconverter-importer/worker-source'`
  and pass it as `workerSource`.

## Build and test

```sh
pnpm --filter @spritestudio/ssconverter-importer build   # the Worker first, then the entries
pnpm --filter @spritestudio/ssconverter-importer test
```

The tests convert a real project from the `SpriteStudio-SDK` submodule with the converter
wasm; without either, they are reported as skipped.

## License

BSD-3-Clause — see [LICENSE.md](./LICENSE.md).
