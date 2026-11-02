# CDN samples — zero build step

Three self-contained HTML pages that load the players **straight from a CDN**, with no
bundler and no `npm install`:

| File | Package | Loads via | Peer deps |
| --- | --- | --- | --- |
| [`ss-player.html`](./ss-player.html) | `@spritestudio/ssplayer-webgl` | declarative `<ss-player>` element — **no JS** | none |
| [`pixi.html`](./pixi.html) | `@spritestudio/ssplayer-pixi` | global `SSPixiPlayer` (code-driven) | `pixi.js` (loaded first, as `window.PIXI`) |
| [`webgl.html`](./webgl.html) | `@spritestudio/ssplayer-webgl` | global `SSWebGLPlayer` (code-driven) | none |

`ss-player.html` is the most direct: drop one `<script>` and the `<ss-player>` element
registers itself, then plays straight from markup. A classic `<script>` has no
`import.meta.url`, so the runtime can't self-locate — but you only give it the WASM URL
**once for the whole page** (not per element), via `data-wasm` on the script tag:

```html
<script src="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-webgl@7.0.0-beta.1/dist/browser/ss-player.element.min.js"
        data-wasm="https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm"></script>

<ss-player src="chara.ssab" animation="run" autoplay></ss-player>
<ss-player src="boss.ssab"  animation="idle" autoplay></ss-player>
```

Three ways to point at the WASM (a `wasm` attribute on an element wins over the page-wide default that 1 or 2 sets):

1. **`data-wasm` on the script tag** — once for the page (above). Simplest, no JS.
2. **`SSWebGLPlayerElement.setSSPlayerWasmUrl(url)`** — once in JS, before the elements connect.
3. **`wasm="…"` on an individual `<ss-player>`** — overrides the default for that one element.

## The one thing that isn't automatic: the WASM URL

The Rust runtime ships as a **separate `.wasm` file**. Inside a bundler, the glue code
locates it automatically. In a classic `<script>` (or any CDN context) that automatic
resolution isn't available — `import.meta.url` doesn't exist — so you **must pass the
WASM URL explicitly**:

```js
await SSPlayer.initialize('https://cdn.jsdelivr.net/npm/@spritestudio/ssplayer-core@7.0.0-beta.1/wasm/ssruntime_bg.wasm');
```

> **Copy the URL pair as printed.** The `.wasm` and its JS glue share an ABI, so both
> URLs need an exact version — a floating `@latest` on one can desync it from the other.
> The two versions are **not** necessarily identical: packages release independently, so
> `ssplayer-webgl@7.0.1` may pair with `ssplayer-core@7.0.0`. These pages are rewritten
> from the actual manifests on every release (`scripts/sync-doc-versions.mjs`).

## Run it

All three pages `fetch()` an `.ssab`, so they must be served over **http(s)** — opening the
file directly (`file://`) will fail on CORS.

1. **Supply an `.ssab`.** Use an *embedded* one (textures inlined → single self-contained
   file, no sibling PNGs). Convert your own with `--embedded`, or reuse a sample asset:

   ```bash
   pnpm run download:wasm && pnpm run build   # once: deploy-examples runs the converter CLI
   pnpm run deploy-examples   # populates examples/*/public with converted assets
   cp examples/pixi-example/public/Ringo/Ringo_embedded.ssab examples/cdn/
   ```

2. **Serve this folder** and open a page:

   ```bash
   npx serve examples/cdn        # or: python3 -m http.server -d examples/cdn 8080
   # then open http://localhost:3000/pixi.html  (or webgl.html, ss-player.html; :8080 with the python server)
   ```

Override the asset or animation via query string:
`pixi.html?ssab=./MyAnim_embedded.ssab&anim=idle`

## Against the locally-built bundles

The CDN URLs (`cdn.jsdelivr.net/npm/@spritestudio/...`) load the published packages. To try
the samples against your **locally-built** bundles instead — a change that is not released
yet, say:

1. Build the packages from the repo root:

   ```bash
   pnpm run build   # builds ssplayer-core, ssplayer-pixi, ssplayer-webgl, … (writes dist/browser + wasm/)
   ```

2. In the HTML, keep `pixi.js` on the CDN but repoint the
   **player bundle** and the **WASM URL** at the local files:

   | In the page | Change from | Change to |
   | --- | --- | --- |
   | `ss-player.html` `<script src>` | `…/npm/@spritestudio/ssplayer-webgl@…/dist/browser/ss-player.element.min.js` | `../../packages/ssplayer-webgl/dist/browser/ss-player.element.min.js` |
   | `ss-player.html` `data-wasm` attribute on the `<script>` | `…/npm/@spritestudio/ssplayer-core@…/wasm/ssruntime_bg.wasm` | `../../packages/ssplayer-core/wasm/ssruntime_bg.wasm` |
   | pixi `<script src>` | `…/npm/@spritestudio/ssplayer-pixi@…/dist/browser/ssplayer-pixi.browser.min.js` | `../../packages/ssplayer-pixi/dist/browser/ssplayer-pixi.browser.min.js` |
   | webgl `<script src>` | `…/npm/@spritestudio/ssplayer-webgl@…/dist/browser/ssplayer-webgl.browser.min.js` | `../../packages/ssplayer-webgl/dist/browser/ssplayer-webgl.browser.min.js` |
   | `pixi.html` / `webgl.html` `WASM_URL` | `…/npm/@spritestudio/ssplayer-core@…/wasm/ssruntime_bg.wasm` | `../../packages/ssplayer-core/wasm/ssruntime_bg.wasm` |

3. Serve the **repo root** (so `../../packages/…` resolves) and open the page under it:

   ```bash
   npx serve .   # then open http://localhost:3000/examples/cdn/pixi.html
   ```

The same snippets in prose, including the `<script type="module">` (ESM-from-CDN) variant, are in
the guides: [WebGL](https://cri-middleware.github.io/SSPlayerForWeb/usage/webgl#without-a-bundler-cdn)
and [PixiJS](https://cri-middleware.github.io/SSPlayerForWeb/usage/pixi#without-a-bundler-cdn).
