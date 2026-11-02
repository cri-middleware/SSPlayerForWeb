# tyranoscript-example — a minimal hand-written scenario for ssplayer-tyranoscript

[日本語](./README.ja.md)

A minimal sample that shows and plays `@spritestudio/ssplayer-tyranoscript`'s `[ss_*]` custom
tags in a real **TyranoScript** project.

> **TyranoScript itself is not in this repository.**
> The engine is free and allows commercial use, but this repository distributes only its own work,
> as a plugin, so you **place the engine yourself during development**. The sample commits only
> the *authored* parts: `data/scenario/first.ks` / `data/scenario/make.ks` and the helper scripts in
> `scripts/`. `sync:plugin` places the plugin (including `init.ks`), and `deploy-examples` the
> assets under `data/others/ssdata/`.

## What the sample contains

```
examples/tyranoscript-example/
  data/
    scenario/first.ks                     # the scenario using [plugin]/[ss_new]/[ss_play]
    scenario/make.ks                      # the file TyranoScript calls on load
    others/
      plugin/ssplayer/init.ks             # ← copied from the plugin template by sync:plugin
      plugin/ssplayer/main.js             # ← generated (sync:plugin, .gitignore)
      plugin/ssplayer/ssruntime_bg.wasm   # ← generated (sync:plugin, .gitignore)
      ssdata/Ringo/…                      # ← generated assets (deploy-examples, .gitignore)
  scripts/fetch-tyrano.mjs                # fetches the TyranoScript engine (fetch:engine)
  scripts/sync-plugin.mjs                 # copies the build output into plugin/
  scripts/serve.mjs                       # a dependency-free static server (serves the wasm MIME type)
```

## Setup and running

### 1. Fetch the TyranoScript engine (development only, once)

This fetches the official repository [ShikemokuMK/tyranoscript](https://github.com/ShikemokuMK/tyranoscript)
(**the browser version**). The ref it fetches is in `TYRANO_VERSION.txt` (default `master`; a tag
such as `v514` works too). Upstream no longer tags releases, and the newest tag, `v514`, is far older
than `master`, so the default `master` is recommended.

```bash
pnpm --filter tyranoscript-example run fetch:engine
# optional, a ref:  pnpm --filter tyranoscript-example run fetch:engine v514
```

This places `index.html`, `tyrano/` and `data/system/` (all in .gitignore) and sets
**`configSave = webstorage`** and a unique **`projectID`** in `Config.tjs` (see Troubleshooting
below). The sample's own `data/scenario/first.ks`, `others/plugin/ssplayer` and `others/ssdata`
are kept.

> **Why fetch rather than copy by hand**: TyranoScript's **desktop (nw.js) export** runs with
> `configSave = file` (which depends on `require('fs')`), so it **crashes at startup when opened in a
> browser** (`init_game` reads `_system_config_bgm_volume` from null). The official repository is the
> browser version, and the script forces `webstorage`, so this always works.

> Tools needed: `curl` and `tar` (included in macOS / Linux and Windows 10+). To place the engine by
> hand, put the three items above directly under `examples/tyranoscript-example/` and set
> `;configSave = webstorage;` and a unique `projectID` in Config.tjs (Config.tjs reads only the
> lines that start with `;` as settings).

The layout once placed (`index.html`, `tyrano/` and `data/system/` are in .gitignore):

```
examples/tyranoscript-example/
  index.html        ← fetched by fetch:engine (not committed)
  tyrano/           ← the engine (not committed)
  TYRANO_VERSION.txt        ← the pinned ref to fetch (committed)
  data/
    system/ …       ← fetched and patched automatically (not committed)
    scenario/first.ks, make.ks  ← this sample
    others/plugin/ssplayer/…    ← generated (sync:plugin, not committed)
    others/ssdata/Ringo/…       ← generated assets (deploy-examples, not committed)
```

> The sample assumes TyranoScript's default resolution, **1280×720** (`x=640 y=480` in `first.ks` are
> logical coordinates in it). If you change `scWidth` / `scHeight` in `data/system/Config.tjs`,
> change the coordinates to match.

### 2. Prepare the plugin and the SpriteStudio assets

```bash
# 1) build the package (produces dist/browser/main.js)
pnpm --filter @spritestudio/ssplayer-tyranoscript run build

# 2) sync the output (main.js + wasm) into data/others/plugin/ssplayer/
#    ★ run this after every change to the package: it is the basic loop
pnpm --filter tyranoscript-example run sync:plugin

# 3) the SpriteStudio assets (Ringo.ssab with separate textures + Ringo.png) into data/others/ssdata/Ringo/
#    deploy-examples at the repository root converts SpriteStudio-SDK/tests and hands the result
#    to every example (including the copy into this sample's ssdata: assets come only from it)
pnpm deploy-examples
```

### 3. Start it and check

```bash
pnpm --filter tyranoscript-example run dev
# → open http://localhost:5847/ (a port of its own, to keep its origin apart from other Tyrano projects)
```

It works when `[ss_new]` shows the Ringo animation on layer 0 and loops it. To check that it
**looks right**, compare it side by side with the SpriteStudio editor or `examples/webgl-example`
(they share one renderer, so they should match).

## The development loop

```
edit packages/ssplayer-tyranoscript/src/*
  → pnpm --filter @spritestudio/ssplayer-tyranoscript run build
  → pnpm --filter tyranoscript-example run sync:plugin
  → reload the dev server's page (no server restart needed; force-reload to skip the cache)
```

The fast inner loop on the logic runs on vitest mocks, with no real engine:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run test
```

## Troubleshooting

### `Cannot read properties of null (reading '_system_config_bgm_volume')` at startup

The engine's `init_game` fails when parsing `<projectID>_sf` (the system variables) from
localStorage with `JSON.parse` gives `null` (the string `"null"` is stored). **Left unset, `projectID`
falls back to `tyranoproject`**, so its localStorage collides with that of any other TyranoScript
project on the same domain (`localhost`), and the leftovers get in.

**What prevents it** (done in this sample, two ways):

1. **Served on a port of its own, `5847`** (`serve.mjs`). localStorage and service workers are per
   **origin (scheme + host + port)**, so this isolates it from what other Tyrano projects left on a
   shared port (3000 / 8000).
2. A **unique `projectID`** in `data/system/Config.tjs` (`ssplayer_tyrano_example`).

```tjs
;projectID = ssplayer_tyrano_example;
```

> If it still fails (localStorage dirtied by an earlier run on the same origin, say), **open it in a
> private window**: localStorage, service workers, caches and extensions are all clean there. Or use
> DevTools ▸ Application ▸ **Clear site data**, then reload.
>
> `Failed to fetch` for `polyfills.js` / `vendor-3rdparty.js` comes from **browser extensions** and
> has nothing to do with the sample (it disappears in a private window).
>
> `Config.tjs` comes with the engine and is not tracked in git. After placing the engine yourself,
> **always set a unique `projectID`**.

## The tags used

| Tag | Role |
| --- | --- |
| `[plugin name="ssplayer"]` | Loads the plugin and starts the runtime (the only line a scenario needs) |
| `[ss_init audio= sounddir= soundext= sevolume=]` | Sound settings (`[plugin]` has already started the runtime) |
| `[ss_new name= storage= layer= page= x= y= scale= loop= anime=]` | Create a player → load the ssab → add an element (`<div>`) to the layer → play |
| `[ss_play name= anime= loop= start=]` | Play / switch the animation |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` `name=` | Stop / pause / resume one player |
| `[ss_stop_audio name=]` | Stop at once the sounds that player started |
| `[ss_wait name=]` | Wait until the animation ends (one cycle when it loops) |
| `[ss_pos name= x= y= scale=]` / `[ss_move name= x= y= scale= time=]` | Move instantly / over time with the internal transform (anchor-based, absolute) |
| `[ss_free name=]` / `[ss_free_all]` | Release (`destroy()` + remove the element) |
| `[ss_pause_all]` / `[ss_resume_all]` | Pause / resume everything (for menus and the like) |
| `[ss_restore]` | Rebuild from a save (**normally not needed** — restored automatically on load) |

### Save / load restore

`[ss_new]` and the others mirror each player's restore information into `stat.f.__ssplayers` (which
is saved) as they go. On load, the plugin rebuilds them on the engine's `load-beforemaking` event
(after the save variables come back and just before the scenario resumes — the same gap in which
TyranoScript calls **`data/scenario/make.ks`**). **Nothing needs writing in `make.ks`.**

To check it: start, save from the menu while Ringo shows, go back to the title, and load. It works
when Ringo resumes from the frame it was saved on.

> ⚠️ **Do not write bracketed tag syntax such as `[ss_xxx]` in the displayed text.**
> TyranoScript runs a `[...]` in text as a tag too (write `ss_play` without brackets).

### Movement and effects use the standard tags

A character's element (`<div>`) carries the player's name as a CSS class, so **fades and simple
movement work with TyranoScript's own `[anim]` / `[kanim]`** (the sample shows a fade with
`[anim ... opacity=]`). For **anchor-based, absolute** movement and scaling, use **`[ss_pos]`
(instant) / `[ss_move]` (over time)**, which drive the internal `setTransform` (the sample shows them).
See the package README for details.

### Sound

SpriteStudio's sound events play through the howler bundled with TyranoScript. Put the sound files
in `data/sound/`; a SpriteStudio sound name resolves to `data/sound/<name>.ogg` (adjust with
`[ss_init sounddir= soundext= sevolume=]`, turn it off with `audio="false"`). The sample's Ringo has
no sound, so nothing plays.

TyranoBuilder's `.tbp` is covered by [ssplayer-tyranobuilder](../../packages/ssplayer-tyranobuilder/README.md).
