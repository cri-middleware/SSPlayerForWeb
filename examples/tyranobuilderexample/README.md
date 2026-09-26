# TyranoBuilder example

[日本語](./README.ja.md)

A TyranoBuilder project that plays a SpriteStudio animation with the
`@spritestudio/ssplayer-tyranobuilder` components. Its one scene,
`data/scenario/scene1.ks`, shows Ringo, switches its animation, waits for one to
finish, and moves it.

## What is committed

Only what this example authors: the project settings (`builder_config.json`) and
the scene. The rest of the project is put in place by `setup`:

| Part | Where it comes from |
| --- | --- |
| The TyranoScript engine and the builder's project template | A new project made by your own copy of TyranoBuilder. The builder is a commercial product, so its template is never committed here. |
| The plugin | This repository's build, through `packages/ssplayer-tyranobuilder/scripts/install.mjs` |
| Ringo's SpriteStudio source | The `SpriteStudio-SDK` submodule (`tests/Ringo`) |
| The converted packs (`data/others/ssdata/`) | The plugin, when the project is opened |

`.gitignore` lists exactly what is kept.

## Setup

You need TyranoBuilder, the SDK submodule, and a build of the packages
([CONTRIBUTING.md](../../CONTRIBUTING.md)).

1. In TyranoBuilder, create a new project. Any name will do: it is only where
   the template comes from, and you can delete it afterwards.
2. Run setup with that project's name:

   ```sh
   pnpm --filter tyranobuilderexample run setup <that project>
   ```

3. Restart TyranoBuilder and open **tyranobuilderexample**. The first open
   converts Ringo; ▶ on `scene1.ks` plays the scene.

Setup links `~/TyranoBuilder/myproject/tyranobuilderexample` to this folder (a
junction on Windows), so the builder lists it and saves into the checkout: an
edit to the scene shows up in `git diff`. If a project of that name is already
there, setup stops rather than touch it.

After rebuilding the plugin, run setup again without a project name to install
the new build. Pass `--builder <dir>` when TyranoBuilder is not in
`~/TyranoBuilder`.
