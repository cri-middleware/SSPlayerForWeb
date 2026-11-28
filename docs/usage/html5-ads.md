---
description: Package an animation as a Google Ads HTML5 ad or App campaign playable — one ZIP with the WebAssembly runtime and the .ssab inside the script.
---

# HTML5 ads (Google Ads)

A Google Ads HTML5 ad is a ZIP of HTML, CSS, JavaScript and images that references nothing
outside itself. `.wasm` and `.ssab` are not among the file types it accepts, so the runtime and
the animation travel inside the script as base64.
[`examples/html5-ad`](https://github.com/cri-middleware/SSPlayerForWeb/tree/main/examples/html5-ad)
builds that ZIP from one `.ssab`, and the result passes Google's
[HTML5 Validator](https://h5validator.appspot.com/adwords/asset).

## Build the bundle

1. Convert the project with its textures embedded: the **Embedded** option of the converters in
   [Preparing assets](./assets.md), `--embedded` on the command line.
2. From the repository root, install and build, then run the script. Get the runtime with
   `pnpm run download:wasm` (prebuilt) or `pnpm run build:wasm` (from source; needs Rust and wasm-pack):

   ```bash
   pnpm install
   pnpm run download:wasm && pnpm run build
   node examples/html5-ad/build.mjs ssab=path/to/chara.ssab animation=idle size=300x250
   ```

It writes `index.html` and `ad.js` under `examples/html5-ad/out/<name>/`, and
`examples/html5-ad/out/<name>.zip` to upload. `--help` lists the options, including `player=` and
`wasm=` for a player bundle and runtime installed from npm.

The bundle is the `SSSurface` setup of [WebGL & Web Components](./webgl.md) with its inputs
inlined: `SSSurface.initialize` takes the runtime's bytes, `loadBuffer` takes the pack's, and the
surface is created with `autoStart: true`.

## What the bundle depends on

- **Textures inside the `.ssab`.** An ad can be served in a sandboxed iframe whose origin is
  `null`. There a texture loaded as a separate file is a cross-origin request, and it fails unless
  the server answers with CORS headers, which an ad server does not promise. An embedded `.ssab`
  loads nothing else.
- **A Content-Security-Policy that lets WebAssembly compile.** Where the serving frame sets a CSP,
  `script-src` needs `'wasm-unsafe-eval'` (or `'unsafe-eval'`); without it `WebAssembly.compile`
  throws and nothing draws.
- **Clicks through the Exit API.** The bundle loads Google's `exitapi.js` and calls
  `ExitApi.exit()` when the ad is clicked; the destination is set on the ad in Google Ads, not in
  the bundle. The Validator reports an error for a bundle without an `ExitApi.exit()` call.
- **An account allowed to upload HTML5.** Google Ads accepts HTML5 ads only from accounts that meet
  its requirements ([About restricted ad formats and features](https://support.google.com/adspolicy/answer/9481382)).

## Size

A display ad's ZIP may be 600 KB and 40 files
([Uploaded display ads specifications](https://support.google.com/google-ads/answer/1722096)); an
App campaign playable's, 5 MB
([About HTML5/Playable ads for App campaigns](https://support.google.com/google-ads/answer/9981650)).
The player and the runtime take about 210 KB of it: base64 adds a third to the runtime, and the
ZIP's compression takes most of that back. With Ringo, 24 animations on a 1024×512 atlas, the
whole ZIP is about 383 KB.
