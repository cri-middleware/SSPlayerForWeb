---
layout: home

hero:
  name: SpriteStudio Player for Web
  tagline: A WebAssembly (Rust) × JavaScript hybrid. Play SpriteStudio animations at speed with WebGL, PixiJS, and other web graphics engines.
  actions:
    - theme: brand
      text: Quick start
      link: /setup/quickstart
    - theme: alt
      text: Install
      link: /setup/install
    - theme: alt
      text: GitHub
      link: https://github.com/cri-middleware/SSPlayerForWeb

# The cards say what the player does, each linked to the page that shows it; the
# table under "Where to start" sends each environment to its guide. The details
# are rendered as HTML, not Markdown, so code is <code> and a tag is escaped.
features:
  - title: Motion made by an artist, not in code
    details: Bones, mesh deformation and particles are built visually in SpriteStudio over the raster (PNG / WebP) art you already have. Characters, backgrounds, effects and UI composed on one timeline play back as a single animation — a banner, a splash screen, a cutscene.
    link: /setup/quickstart
    linkText: Quick start
  - title: Blend animations instead of cutting
    details: Crossfade into the next animation, layer an aiming pose or a reaction over a walk on another track — mixed in or added on top — and mix animations by weight at runtime. From code, from RPG Maker MZ's plugin commands, or from TyranoScript's tags.
    link: /customize/motion-blending
    linkText: Motion blending
  - title: Buttons drawn by animations
    details: <code>SSButton</code> makes a SpriteStudio animation a <code>@pixi/ui</code> button. Its labels play the states — hovered, pressed, disabled, focused — and an irregular shape can take the pointer on the artwork only.
    link: /usage/pixi-ui
    linkText: UI buttons
  - title: Wired into your app or game
    details: User data, signals and sound keys the artist placed arrive as callbacks on the frame they fire. Override a part's colour, cell or visibility, swap a cell map's texture for a costume change, or make your own object follow a part.
    link: /customize/events
    linkText: Customize
  - title: From one HTML tag to game engines
    details: Write an <code>&lt;ss-player&gt;</code> tag in any page, add an <code>SSPlayer</code> to a PixiJS v8 stage, ship it inside a Google Ads HTML5 ad, or add a plugin to RPG Maker MZ, TyranoScript or TyranoBuilder and write no code at all.
    link: '#where-to-start'
    linkText: Where to start
  - title: A lighter, interactive alternative to video
    details: Unlike a .gif or an .mp4, it scales freely, loops seamlessly and reacts to input, and sub-frame interpolation (on by default) draws at the display's refresh rate rather than a baked-in frame rate. A .ssab loads with no parsing.
    link: /customize/performance
    linkText: Performance tuning
---

<!-- The converter and the examples are built beside this site, not by VitePress
     (pages.yml -> scripts/build-pages.sh assembles them around it), so they are
     linked by relative path rather than by absolute URL: a hardcoded
     cri-middleware.github.io link is wrong on every other deployment of this
     site -- a local `scripts/build-pages.sh` preview, a fork's Pages. VitePress
     URLs mirror the file tree, so the number of `../` is simply this file's
     directory depth.

     Raw <a> rather than markdown links, deliberately, for two reasons: VitePress
     checks markdown links against its own pages and would fail the build over
     these (they are not pages of this site), and its router would try to resolve
     them client-side and land on the 404 page. target="_blank" both keeps the
     reader's place in the docs and is what stops the router intercepting. -->

[SpriteStudio](https://www.webtech.co.jp/eng/spritestudio/) is a 2D animation tool: an artist adds bones, mesh deformation and effects to
their own illustrations, and this player plays the result in a web page or app.

::: tip No SpriteStudio data of your own yet?
The [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — that page is
Japanese only, but the downloads themselves are language-neutral.
[Ringo](https://www.webtech.co.jp/spritestudio/ss6user/download/OPTPiX_SpriteStudio_Ringo_Sample_20220121.zip) is a good character sample, and
[Particle](https://www.webtech.co.jp/spritestudio/ss6user/download/OPTPiX_SpriteStudio_ParticleEffect_Sample_20191025.zip) is a good one if you want effects.
To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).
:::

## Where to start

Find your environment. Its guide takes you from installing to an animation on screen. The player
plays `.ssab`, converted from SpriteStudio's `.sspj`: in RPG Maker MZ and TyranoBuilder the plugin
converts it inside the editor, and everywhere else you convert it yourself
([Preparing assets](/usage/assets)).

| Your environment | Package | `.sspj` → `.ssab` | Guide | Live demo |
|---|---|---|---|---|
| Any web page, no framework — one HTML tag, or WebGL from code | `@spritestudio/ssplayer-webgl` | You convert it | [WebGL & Web Components](/usage/webgl) | <a href="./examples/webgl/" target="_blank" rel="noreferrer">WebGL</a> |
| A PixiJS v8 app | `@spritestudio/ssplayer-pixi` | You convert it | [PixiJS](/usage/pixi) | <a href="./examples/pixi/" target="_blank" rel="noreferrer">PixiJS</a> |
| Buttons drawn by animations in a PixiJS v8 app | `@spritestudio/ssplayer-pixi-ui` | You convert it | [UI buttons](/usage/pixi-ui) | <a href="./examples/pixi/ui.html" target="_blank" rel="noreferrer">Buttons</a> |
| A Google Ads HTML5 ad or App campaign playable | `@spritestudio/ssplayer-webgl` | You convert it | [HTML5 ads](/usage/html5-ads) | — |
| RPG Maker MZ | Plugin | The plugin, on test play | [RPG Maker MZ](/usage/rmmz) | <a href="./examples/rmmz/" target="_blank" rel="noreferrer">RPG Maker MZ</a> |
| TyranoScript | Plugin | You convert it | [TyranoScript](/usage/tyrano) | <a href="./examples/tyranoscript/" target="_blank" rel="noreferrer">TyranoScript</a> |
| TyranoBuilder | Plugin | The plugin, when the project opens | [TyranoBuilder](/usage/tyranobuilder) | <a href="./examples/tyranoscript/" target="_blank" rel="noreferrer">TyranoScript</a> (the runtime the plugin embeds) |
| A renderer of your own | `@spritestudio/ssplayer-core` | You convert it | [API reference: where to start](/api-guide) | — |

::: tip Coming from an older player?
Migrating from the older **[SS6Player for Web](https://github.com/SpriteStudio/SS6PlayerForWeb)** (`ss6player-pixi`)? See **[Migrating from SS6Player](/migration_from_ss6)** for the old→new API mapping and the asset re-conversion (`.ssfb` → `.ssab`) steps.
:::

## Try it live

No install — these run entirely in your browser:

- 🛠️ **<a href="./ssconverter/" target="_blank" rel="noreferrer">ssconverter-web</a>** — convert `.sspj` → `.ssab` in the browser
- 📂 **<a href="./examples/sspj-preview/" target="_blank" rel="noreferrer">Drop a `.sspj` and play it</a>** — convert **your own** project in the tab and scrub it, user-data / signal / sound keys marked on the timeline, in the WebGL or the PixiJS player
- 🎨 **<a href="./examples/override/" target="_blank" rel="noreferrer">Part override example</a>** — runtime colour / cell / visibility overrides (PixiJS)

## Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the documentation portal for the SDK and its official players.
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the SDK itself, providing `libssruntime` / `libssconverter`.
- [SSConverter GUI](https://github.com/cri-middleware/SSConverterGUI) — a standalone desktop GUI for converting `.sspj` without a player.
