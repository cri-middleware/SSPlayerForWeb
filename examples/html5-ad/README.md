# HTML5 ad bundle (Google Ads)

Builds a Google Ads HTML5 ad — a display ad or an App campaign playable — from one `.ssab`
whose textures are embedded. What the bundle depends on, and why the runtime travels inside the
script as base64, is on the docs page
[HTML5 ads](https://cri-middleware.github.io/SSPlayerForWeb/usage/html5-ads).

## Run it

From the repository root:

```bash
pnpm run build:wasm && pnpm run build   # the player bundle and the runtime the script packs
pnpm run deploy-examples                # converts the sample assets, Ringo_embedded.ssab among them
node examples/html5-ad/build.mjs ssab=examples/pixi-example/public/Ringo/Ringo_embedded.ssab animation=wait1
```

It writes `examples/html5-ad/out/Ringo_embedded/` (`index.html` and `ad.js`) and
`examples/html5-ad/out/Ringo_embedded.zip`. Check the ZIP with Google's
[HTML5 Validator](https://h5validator.appspot.com/adwords/asset) before uploading it to Google Ads.

`node examples/html5-ad/build.mjs --help` lists the options: the slot size, the output folder, and
`player=` / `wasm=` for a player bundle and runtime installed from npm rather than built here.

## Preview it

Serve the output folder and open `index.html`; the ad fetches nothing over the network but
Google's `exitapi.js`.

```bash
npx serve examples/html5-ad/out   # then open http://localhost:3000/Ringo_embedded/
```
