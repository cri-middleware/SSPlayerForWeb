# Contributing to SSPlayerForWeb

Thank you for your interest in contributing to SSPlayerForWeb! We welcome all
kinds of contributions, including bug reports, feature requests, documentation
improvements, and code contributions.

## Table of Contents
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Environment](#development-environment)
- [Coding Standards](#coding-standards)

## How Can I Contribute?

### Technical Constraints & Guiding Principles
To keep the player fast and portable across web rendering engines, please adhere
to the following principles:

- **Absolute decoupling in the core:** `@spritestudio/ssplayer-core` MUST stay
  free of any rendering engine (PixiJS, Three.js, …) and browser DOM APIs. It is
  purely a wrapper around the Rust/WASM logic. Engine-specific code belongs in a
  renderer package (`ssplayer-pixi`, `ssplayer-rmmz`).
- **Zero-copy in the hot path:** avoid per-frame heap allocations during
  playback. Transfer transforms/geometry via `Float32Array` views mapped
  directly onto the WASM memory buffer rather than copying.
- **Memory safety:** WASM memory is not garbage-collected by JS. Use
  `FinalizationRegistry` to call the WASM `free()` when a JS wrapper is
  collected, so we don't leak.
- **SDK separation:** the core animation logic lives in the `SpriteStudio-SDK`
  submodule (Rust). Algorithm / core-logic changes go to the SDK repository;
  the TypeScript wrappers and renderer integrations belong here.

### Reporting Bugs
If you find a bug, please open an issue including:
- A clear, descriptive title.
- Steps to reproduce.
- Your environment (browser / Node.js version, rendering engine + version, OS).
- Expected vs. actual behavior.

*Note: if reproducing a bug requires proprietary `.sspj` project data, please do
not attach it to a public issue — contact the maintainers privately instead.*

### Pull Requests
1. Fork the repository and create your branch from `main`.
2. Follow the existing code style and the constraints above.
3. Run `pnpm test`, then check the change in the example for the renderer you touched (see
   [Development Environment](#development-environment)).
4. Submit a Pull Request targeting `main` with a clear description of the change.

### Branching & releases
This repo is **trunk-based**: `main` is the single long-lived branch and is always
releasable. Use short-lived feature branches off `main`; for large, long-running
work (e.g. an `.ssab` schema change), use a longer-lived `epic/*` branch and merge
it back when it's coherent, so `main` stays deployable.

There is **no `develop` branch here** — and that's intentional. Packages are
versioned **independently** (via [Changesets](https://github.com/changesets/changesets)),
so there is no single "promote develop → main = the release" moment that a
Git-Flow `develop` branch would model; a release is simply a maintainer running the
**Release** workflow on `main` once the accumulated changesets are worth shipping.
Add a changeset to any PR that should trigger a version
bump. Note this differs from other SpriteStudio repositories (e.g. the
lockstep-versioned SDK, which uses a `develop` branch): the branch model follows
the versioning model, not the other way around.

Running that workflow, and the preflight that goes with it, is maintainer work —
see [RELEASING.md](./RELEASING.md).

## Development Environment

Prerequisites (Node.js, pnpm, and — only for building the WASM — Rust / wasm-pack)
and the full build steps live in the **[Quick Start](./README.md#-quick-start)**
section of the README. In short, from the repo root:

```bash
pnpm install
pnpm run build:wasm   # builds the Rust core to WASM (needs Rust + wasm-pack)
pnpm run build
pnpm test             # every workspace's vitest suite
```

The generated WASM binaries are **not tracked in git**, so a fresh checkout must
build them first. `pnpm test` needs both steps above it: the core's tests import
the built WASM, and `examples/sspj-preview` imports the other packages' `dist/`.
Without the converter WASM or the `SpriteStudio-SDK` submodule, the conversion
suites are reported as **skipped**, not passed — read the summary line. The
examples consume the **built** packages via workspace references, so re-run
`pnpm run build` after changing any TypeScript under `packages/`, then check the
change in the example for the renderer you touched — `examples/webgl-example`
for the core and WebGL, `examples/pixi-example` for PixiJS — with `pnpm run dev`.

### Regenerating the FlatBuffers accessors

`packages/ssplayer-core/src/ss/` is flatc output over the SDK's `.fbs` schemas,
and unlike the WASM it **is** tracked — a normal checkout builds without flatc.
Regenerate and commit it after a schema change in SpriteStudio-SDK; `flatc` has
to be on your PATH.

```bash
# macOS / Linux
./scripts/generate-fbs-code.sh

# Windows (PowerShell)
.\scripts\generate-fbs-code.ps1
```

The script also rewrites the namespace entrypoints `src/ss/runtime.ts` and
`src/ss/format.ts`: run file by file, flatc leaves each of them holding only the
last schema's exports. It is deliberately not part of `build:wasm` or
`download:wasm` — run it only when a schema changes.

## Coding Standards

### TypeScript
- Use **strict typing**; avoid `any` where possible.
- Match the existing style of the file you touch (naming, control flow, error
  handling).
- Keep changes scoped to the task at hand.

### Rust / WASM FFI
- Any additions to `ssruntime` must expose a C-API / FFI compatible with
  `wasm-bindgen`.
- Do not alter the `SpriteStudio-SDK` submodule structure without explicit
  agreement.

---
By contributing to this project, you agree that your contributions will be
licensed under the project's [LICENSE.md](./LICENSE.md).

<br>
<br>

---

# SSPlayerForWeb への貢献について

SSPlayerForWeb にご関心をお寄せいただき、ありがとうございます！ バグ報告、機能提案、ドキュメントの改善、コードの提供など、あらゆる形での貢献を歓迎します。

## 目次
- [貢献する方法](#貢献する方法)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [コーディング規約](#コーディング規約)

## 貢献する方法

### 技術的制約と設計原則
Web の各レンダリングエンジン間で高速かつ移植性の高いプレイヤーを維持するため、以下の原則に従ってください。

- **コアの完全な分離:** `@spritestudio/ssplayer-core` は、レンダリングエンジン
  (PixiJS, Three.js など) やブラウザの DOM API に一切依存してはいけません。
  Rust/WASM ロジックの純粋なラッパーです。エンジン固有のコードは、レンダラーパッケージ (`ssplayer-pixi`, `ssplayer-rmmz`) に配置してください。
- **ホットパスでの Zero-Copy:** 再生中の毎フレームごとのヒープアロケーションは避けてください。トランスフォームやジオメトリは、コピーせずに WASM メモリバッファを直接参照する `Float32Array` ビュー経由で受け渡します。
- **メモリ安全性:** WASM メモリは JS の GC 対象外です。リークを防ぐため、JS ラッパーが回収される際に WASM の `free()` を呼ぶよう `FinalizationRegistry` を使用します。
- **SDK の分離:** コアのアニメーション計算ロジックは `SpriteStudio-SDK` サブモジュール
  (Rust) に存在します。アルゴリズムやコアロジックの修正は SDK 側リポジトリへ、
  TypeScript ラッパーとレンダラー統合は本リポジトリへ行ってください。

### バグの報告
バグを発見した場合は、Issue に以下の情報を含めてください。
- 簡潔で分かりやすいタイトル
- 再現手順
- 利用環境 (ブラウザ / Node.js のバージョン、レンダリングエンジンとそのバージョン、OS)
- 期待される動作と実際の動作

*注: バグ再現のために非公開の `.sspj` プロジェクトデータが必要な場合は、公開 Issue には添付せず、メンテナへ個別にご連絡ください。*

### プルリクエスト
1. リポジトリをフォークし、`main` ブランチから作業用ブランチを作成してください。
2. 既存のコードスタイルと上記の制約に従ってください。
3. `pnpm test` を実行し、触ったレンダラーのサンプルで変更内容を確認してください（[開発環境のセットアップ](#開発環境のセットアップ)を参照）。
4. `main` ブランチに向けて、変更内容を明確に記載したプルリクエストを送信してください。

### ブランチとリリース
本リポジトリは **トランクベース** です。`main` が唯一の長寿命ブランチで、常にリリース可能な状態を保ちます。通常は `main` から短命の作業ブランチを切ってください。`.ssab` スキーマ改修のような大規模・長期の作業は、`main` を汚さないよう長寿命の `epic/*` ブランチで進め、まとまった段階で `main` へマージします。

**`develop` ブランチは設けていません**（意図的です）。パッケージは
[Changesets](https://github.com/changesets/changesets) で**独立にバージョニング**しており、
Git-Flow の `develop` が表す「develop→main 昇格＝リリース」という単一の瞬間が存在しません。リリースは、蓄積された changeset が出せる状態になった時点でメンテナが `main` 上で
**Release ワークフローを実行すること**そのものです。バージョンを上げたい PR には changeset を1枚添えてください。この点は他の SpriteStudio リポジトリ（例: lockstep でバージョンを統一し `develop` 運用の SDK）とは異なります — **ブランチモデルはバージョニングモデルに従う**、という方針です。

実行前に、`scripts/build-release.sh`（Windows は `.ps1`）でリリースがアップロードするもの一式 — public パッケージの npm tarball と private パッケージのプラグインアーカイブ — を
`release-dist/` にビルドできます。publish は一切行いません。GitHub Releases に添付されるプラグインアーカイブは、ワークフローもこの同じスクリプトで作ります（＝ここで確認したものがそのまま出ます）。npm tarball の方はワークフローでは使えません（`changeset publish` がワークスペースから直接固めるため）が、npm のバージョンは一度公開すると差し替えられないので、成果物をまだ直せるうちに確認できる唯一の機会がここです。バージョンは作業ツリーのままで、
bump は行いません。未消費の changeset がある場合は、リリース後に実際に何番になるかを表示します。オプションは `scripts/build-release.sh --help` を参照してください。

## 開発環境のセットアップ

前提条件（Node.js・pnpm、および WASM を再ビルドする場合のみ Rust / wasm-pack）と完全なビルド手順は、README の **[クイックスタート](./README.ja.md#-クイックスタート)**
に記載しています。リポジトリのルートで手短には:

```bash
pnpm install
pnpm run build:wasm   # Rust コアを WASM へビルド（Rust / wasm-pack が必要）
pnpm run build
pnpm test             # 全ワークスペースの vitest スイート
```

生成される WASM バイナリは **git で管理されていません**。新規チェックアウト時はまずビルドが必要です。`pnpm test` には上の 2 つのビルドが両方要ります。core のテストはビルド済みの WASM を import し、`examples/sspj-preview` は他パッケージの `dist/` を import するためです。コンバーターの WASM か `SpriteStudio-SDK` サブモジュールが無いと、変換のスイートは成功ではなく **skipped** として報告されます。最後の集計行を読んでください。examples は **ビルド済み** のパッケージをワークスペース参照で利用するため、`packages/` 配下の TypeScript を変更したら `pnpm run build` を再実行し、触ったレンダラーのサンプルで確認してください。core と WebGL は `examples/webgl-example`、PixiJS は `examples/pixi-example` で、どちらも `pnpm run dev` で起動します。

### FlatBuffers アクセサの再生成

`packages/ssplayer-core/src/ss/` は SDK の `.fbs` スキーマに flatc をかけた出力で、
WASM とは違い **git で管理しています** — 通常のチェックアウトは flatc なしでビルドできます。SpriteStudio-SDK 側でスキーマが変わったら再生成してコミットしてください。
`flatc` に PATH が通っている必要があります。

```bash
# macOS / Linux
./scripts/generate-fbs-code.sh

# Windows (PowerShell)
.\scripts\generate-fbs-code.ps1
```

このスクリプトは名前空間のエントリポイント `src/ss/runtime.ts` と
`src/ss/format.ts` も書き直します。flatc をファイルごとに走らせると、どちらも最後のスキーマの export だけになってしまうためです。`build:wasm` や
`download:wasm` には意図的に含めていません。スキーマが変わったときだけ実行します。

## コーディング規約

### TypeScript
- **strict な型付け** を使用し、可能な限り `any` を避けてください。
- 変更するファイルの既存スタイル (命名、制御フロー、エラーハンドリング) に合わせてください。
- 変更は依頼されたタスクの範囲に留めてください。

### Rust / WASM FFI
- `ssruntime` への追加は、`wasm-bindgen` と互換性のある C-API / FFI を公開してください。
- 明示的な合意なしに `SpriteStudio-SDK` サブモジュールの構造を変更しないでください。

---
本プロジェクトへの貢献は、プロジェクトの [LICENSE.md](./LICENSE.md) に同意したものとみなされます。
