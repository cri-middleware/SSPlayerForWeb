# ssplayer-tyranobuilder — Roadmap

This file lists unfinished work that is specific to the TyranoBuilder plugin; work for the Web Player as a whole is in the [root ROADMAP](../../ROADMAP.md), and the runtime tags are in the [ssplayer-tyranoscript roadmap](../ssplayer-tyranoscript/ROADMAP.md). Technical constraints are under [Current limits](https://cri-middleware.github.io/SSPlayerForWeb/usage/tyranobuilder#current-limits).

## Distribution & verification

- [ ] **Windows** — The plugin has not been tried in the Windows builder (the importer is shared with `ssplayer-rmmz`, which has been checked on macOS only). Blocked on: a Windows TyranoBuilder install to test on.

## Backlog

- [ ] **File I/O off the editor thread** — A plugin reaches the filesystem only through `window.studio_api`, so the reads and writes around each conversion run on the editor's thread. Overlapping the next project's reads with the current conversion would hide most of it, at the cost of a pipeline in `importPass`; not obviously worth it at the current pause size.
- [ ] **Cheaper pack scan** — `listPacks()` walks all of `data/` over the bridge and is shared only within one task. The host's `getAllFilesUnderDirectory` (one `ipcRenderer.sendSync`, with the main process walking in Node) would make it a single round trip, but it returns no mtime or size and is undocumented, so it could serve only this scan and would need proving first.

## Deliberate non-goals

- **Background watching of the source folder** — The editor could notice a save, but a pass costs a synchronous bridge hop per source file on the UI thread, and the Ren'Py and Godot Players do not watch either; use Import now or Reconvert.
