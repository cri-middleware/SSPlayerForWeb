<!--
Thanks for contributing! See CONTRIBUTING.md for the constraints this project works under
(an engine-free, DOM-free core, no per-frame allocation, every WASM allocation freed).
CONTRIBUTING.md に本プロジェクトの制約が記載されています。日本語でも英語でも構いません。
-->

## What does this change? / 変更内容

<!-- What it does and why. Link any related issue: Fixes #123 -->

## How was it verified? / 検証方法

<!--
Which checks ran, and on what. If you could not run them, say so —
that is useful information, not a problem.
実行した確認と環境。実行できなかった場合はその旨をお書きください。
-->

- [ ] `pnpm run build:wasm` (or `download:wasm`), `pnpm run build`, `pnpm test` — read the summary; the conversion suites skip without the converter WASM
- [ ] `pnpm run dev` in `examples/webgl-example` or `examples/pixi-example`
- [ ] `scripts/build-docs.sh`, if the docs changed — nothing else builds them
- [ ] Not run — see notes below / 未実行（理由は下記）

**Environment / 環境:** browser or Node.js version, rendering engine and version, OS

## Checklist

- [ ] Scoped to one thing. Unrelated fixes are easier to review as their own PR.
- [ ] Follows the style of the files it touches.
- [ ] Docs updated if behaviour changed.
- [ ] Anything that exists twice changed twice — a page and its translation, a `.sh` and its `.ps1`.
- [ ] `@spritestudio/ssplayer-core` gains no rendering-engine or DOM dependency.
- [ ] No per-frame heap allocations.
- [ ] Every WASM allocation is registered with `FinalizationRegistry`, so `free()` runs.
- [ ] `packages/ssplayer-core/src/ss/` regenerated with `scripts/generate-fbs-code.sh`, never hand-edited.

## Anything reviewers should know? / レビュー時の注意点

<!-- Trade-offs you made, alternatives you rejected, parts you are unsure about. -->
