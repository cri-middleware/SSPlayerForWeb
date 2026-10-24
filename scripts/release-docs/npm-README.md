# SpriteStudio Player for Web — documentation

This folder is the documentation of SpriteStudio Player for Web, as Markdown, from the release the package it sits in came from, so it describes the API that version provides. The online documentation is built from the latest release and can be ahead of this copy.

Every npm package of SpriteStudio Player for Web carries these same pages.

## Where to look

| To find out | Read |
| --- | --- |
| Which package to use, and how to install it | [setup/install.md](setup/install.md) |
| How to play the first animation | [setup/quickstart.md](setup/quickstart.md) |
| How to load, select, play, seek and loop an animation | [usage/basic.md](usage/basic.md) |
| How to use the `<ss-player>` element, or `SSSurface` and `SSPlayer` on plain WebGL | [usage/webgl.md](usage/webgl.md) |
| How to use the player in a PixiJS v8 app | [usage/pixi.md](usage/pixi.md) |
| How to make an animation a `@pixi/ui` button with `@spritestudio/ssplayer-pixi-ui` | [usage/pixi-ui.md](usage/pixi-ui.md) |
| Which class to start from, and the types you touch (each package's `dist/index.d.ts` carries the full API) | [api-guide.md](api-guide.md) |
| How to produce `.ssab` files, including converting in your own app with `@spritestudio/ssconverter-core` | [usage/assets.md](usage/assets.md) |
| How to react to events and user data | [customize/events.md](customize/events.md) |
| How to hide parts, swap their cells or tint them, and how to follow a part | [customize/part-overrides.md](customize/part-overrides.md), [customize/part-following.md](customize/part-following.md) |
| How to layer animations and crossfade between them | [customize/motion-blending.md](customize/motion-blending.md) |
| What is not supported | [limitations.md](limitations.md) |
| How a program written for SS6Player for Web maps onto this one | [migration_from_ss6.md](migration_from_ss6.md) |

The other pages cover texture replacement, shaders and blend modes, resources and their lifecycle, performance, and the RPG Maker MZ and TyranoScript / TyranoBuilder plugins. Links between the pages work offline. Links to the API reference pages and the live demos go to the online documentation, <https://cri-middleware.github.io/SSPlayerForWeb/> (Japanese: <https://cri-middleware.github.io/SSPlayerForWeb/ja/>).
