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
3. Verify your changes against the sample app in `examples/pixi-example`.
4. Submit a Pull Request targeting `main` with a clear description of the change.

## Development Environment

Prerequisites (Node.js, pnpm, and — only for building the WASM — Rust / wasm-pack)
and the full build steps live in the **[Quick Start](./README.md#-quick-start)**
section of the README. In short, from the repo root:

```bash
pnpm install
pnpm run build:wasm   # Windows: pnpm run build:wasm:win
pnpm run build
```

The generated WASM binaries are **not tracked in git**, so a fresh checkout must
build them first. The examples consume the **built** packages via workspace
references, so re-run `pnpm run build` after changing any TypeScript under
`packages/`. Verify your changes against `examples/pixi-example` (`pnpm run dev`).

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

SSPlayerForWeb にご関心をお寄せいただき、ありがとうございます！ バグ報告、機能提案、
ドキュメントの改善、コードの提供など、あらゆる形での貢献を歓迎します。

## 目次
- [貢献する方法](#貢献する方法-1)
- [開発環境のセットアップ](#開発環境のセットアップ-1)
- [コーディング規約](#コーディング規約-1)

## 貢献する方法

### 技術的制約と設計原則
Web の各レンダリングエンジン間で高速かつ移植性の高いプレイヤーを維持するため、
以下の原則に従ってください。

- **コアの完全な分離:** `@spritestudio/ssplayer-core` は、レンダリングエンジン
  (PixiJS, Three.js など) やブラウザの DOM API に一切依存してはいけません。
  Rust/WASM ロジックの純粋なラッパーです。エンジン固有のコードは、レンダラー
  パッケージ (`ssplayer-pixi`, `ssplayer-rmmz`) に配置してください。
- **ホットパスでの Zero-Copy:** 再生中の毎フレームごとのヒープアロケーションは
  避けてください。トランスフォームやジオメトリは、コピーせずに WASM メモリバッファ
  を直接参照する `Float32Array` ビュー経由で受け渡します。
- **メモリ安全性:** WASM メモリは JS の GC 対象外です。リークを防ぐため、JS ラッパー
  が回収される際に WASM の `free()` を呼ぶよう `FinalizationRegistry` を使用します。
- **SDK の分離:** コアのアニメーション計算ロジックは `SpriteStudio-SDK` サブモジュール
  (Rust) に存在します。アルゴリズムやコアロジックの修正は SDK 側リポジトリへ、
  TypeScript ラッパーとレンダラー統合は本リポジトリへ行ってください。

### バグの報告
バグを発見した場合は、Issue に以下の情報を含めてください。
- 簡潔で分かりやすいタイトル
- 再現手順
- 利用環境 (ブラウザ / Node.js のバージョン、レンダリングエンジンとそのバージョン、OS)
- 期待される動作と実際の動作

*注: バグ再現のために非公開の `.sspj` プロジェクトデータが必要な場合は、公開 Issue には
添付せず、メンテナへ個別にご連絡ください。*

### プルリクエスト
1. リポジトリをフォークし、`main` ブランチから作業用ブランチを作成してください。
2. 既存のコードスタイルと上記の制約に従ってください。
3. `examples/pixi-example` のサンプルアプリで変更内容を確認してください。
4. `main` ブランチに向けて、変更内容を明確に記載したプルリクエストを送信してください。

## 開発環境のセットアップ

### 前提条件
- **Node.js** および **pnpm** (本リポジトリは pnpm workspaces を使用します)。
- **Rust (rustup)** および **wasm-pack** / `wasm-bindgen` (WASM を再ビルドする場合のみ必要。`cargo install wasm-pack` でインストール)。

### ビルド方法
生成される WASM バイナリは **git で管理されていません**。新規チェックアウト時は
まず WASM をビルドしてください。

**macOS / Linux:**
```bash
# 0. 依存関係のインストール (ワークスペースの初期化も兼ねます)
pnpm install

# 1. Rust ランタイムとコンバータを WASM へビルド (rustup 環境および `cargo install wasm-pack` が必要)
pnpm run build:wasm

# 2. すべての TypeScript パッケージをビルド
pnpm run build
```

**Windows:**
```powershell
pnpm install
pnpm run build:wasm:win
pnpm run build
```

### サンプルの実行
examples は **ビルド済み** のパッケージをワークスペース参照で利用します。そのため
`packages/` 配下の TypeScript を変更したら、都度ルートで `pnpm run build` を
再実行してください。

```bash
cd examples/pixi-example
pnpm run dev
```

## コーディング規約

### TypeScript
- **strict な型付け** を使用し、可能な限り `any` を避けてください。
- 変更するファイルの既存スタイル (命名、制御フロー、エラーハンドリング) に合わせてください。
- 変更は依頼されたタスクの範囲に留めてください。

### Rust / WASM FFI
- `ssruntime` への追加は、`wasm-bindgen` と互換性のある C-API / FFI を公開してください。
- 明示的な合意なしに `SpriteStudio-SDK` サブモジュールの構造を変更しないでください。

---
本プロジェクトへの貢献は、プロジェクトの [LICENSE.md](./LICENSE.md) に同意したものと
みなされます。
