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

[SpriteStudio](https://www.webtech.co.jp/eng/spritestudio/) is a 2D animation tool: an artist adds bones, mesh deformation and effects to
their own illustrations, and this player plays the result in a web page or app.

::: tip No SpriteStudio data of your own yet?
The [official sample data](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/) works as-is — that page is
Japanese only, but the downloads themselves are language-neutral.
[Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo) is a good character sample, and
[Particle](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) is a good one if you want effects.
To make your own, you use SpriteStudio itself — see [its site](https://www.webtech.co.jp/eng/spritestudio/).
:::

## Where to start

Find your environment. Its guide takes you from installing to an animation on screen. The player
plays `.ssab`, converted from SpriteStudio's `.sspj`: in RPG Maker MZ and TyranoBuilder the plugin
converts it inside the editor, and everywhere else you convert it yourself
([Preparing assets](./usage/assets.md)).

| Your environment | Package | `.sspj` → `.ssab` | Guide | Live demo |
|---|---|---|---|---|
| Any web page, no framework — one HTML tag, or WebGL from code | `@spritestudio/ssplayer-webgl` | You convert it | [WebGL & Web Components](./usage/webgl.md) | [WebGL](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/) |
| A PixiJS v8 app | `@spritestudio/ssplayer-pixi` | You convert it | [PixiJS](./usage/pixi.md) | [PixiJS](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/) |
| Buttons drawn by animations in a PixiJS v8 app | `@spritestudio/ssplayer-pixi-ui` | You convert it | [UI buttons](./usage/pixi-ui.md) | [Buttons](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/ui.html) |
| A Google Ads HTML5 ad or App campaign playable | `@spritestudio/ssplayer-webgl` | You convert it | [HTML5 ads](./usage/html5-ads.md) | — |
| RPG Maker MZ | Plugin | The plugin, on test play | [RPG Maker MZ](./usage/rmmz.md) | [RPG Maker MZ](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/) |
| TyranoScript | Plugin | You convert it | [TyranoScript](./usage/tyrano.md) | [TyranoScript](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/) |
| TyranoBuilder | Plugin | The plugin, when the project opens | [TyranoBuilder](./usage/tyranobuilder.md) | [TyranoScript](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/) (the runtime the plugin embeds) |
| A renderer of your own | `@spritestudio/ssplayer-core` | You convert it | [API reference: where to start](./api-guide.md) | — |

::: tip Coming from an older player?
Migrating from the older **[SS6Player for Web](https://github.com/SpriteStudio/SS6PlayerForWeb)** (`ss6player-pixi`)? See **[Migrating from SS6Player](./migration_from_ss6.md)** for the old→new API mapping and the asset re-conversion (`.ssfb` → `.ssab`) steps.
:::

## Try it live

No install — these run entirely in your browser:

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — convert `.sspj` → `.ssab` in the browser
- 📂 **[Drop a `.sspj` and play it](https://cri-middleware.github.io/SSPlayerForWeb/examples/sspj-preview/)** — convert **your own** project in the tab and scrub it, user-data / signal / sound keys marked on the timeline, in the WebGL or the PixiJS player
- 🎨 **[Part override example](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** — runtime colour / cell / visibility overrides (PixiJS)

## Related Repositories

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/) — the documentation portal for the SDK and its official players.
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — the SDK itself, providing `libssruntime` / `libssconverter`.
- [SSConverter GUI](https://github.com/cri-middleware/SSConverterGUI) — a standalone desktop GUI for converting `.sspj` without a player.
