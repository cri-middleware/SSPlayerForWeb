---
layout: home

hero:
  name: SSPlayerForWeb
  text: SpriteStudio 7 player for the Web
  tagline: WebAssembly（Rust）× JavaScript のハイブリッド。PixiJS などの Web グラフィックスエンジンで SpriteStudio 7 アニメーションを高速再生します。
  actions:
    - theme: brand
      text: クイックスタート
      link: /setup/quickstart
    - theme: alt
      text: インストール
      link: /setup/install
    - theme: alt
      text: GitHub
      link: https://github.com/cri-middleware/SSPlayerForWeb

features:
  - title: まず動かす
    details: パッケージを入れて .ssab を読み込み、数行で再生。「はじめに」→「使い方」→「API リファレンス」は写経すればそのまま動きます。
    link: /setup/install
    linkText: はじめに
  - title: 作り込む
    details: イベント処理、パーツ制御、シェーダー、パフォーマンス調整。少し工夫して表現を作り込みます。
    link: /customize/events
    linkText: カスタマイズ
  - title: 拡張・貢献する
    details: 全体構成を理解した上で core や WASM / FFI を拡張・貢献します。設計原則とビルド手順は CONTRIBUTING を参照。
    link: https://github.com/cri-middleware/SSPlayerForWeb/blob/main/CONTRIBUTING.md
    linkText: コントリビューション
---

## このドキュメントの読み方

読者を 3 段階に分けて構成しています。**手前だけ読めば目的を達成できる**ように、上から順に踏み込む内容になっています。

[[toc]]

| 読者 | ゴール | 読むところ |
|---|---|---|
| **利用ユーザー** | とにかく動かす | 「はじめに」→「使い方」→「API リファレンス」 |
| **カスタマイズユーザー** | 表現を作り込む | 上記 +「カスタマイズ」 |
| **SDK / Player 開発者** | 内部を拡張・貢献する | 上記 + CONTRIBUTING |

## 概要（.sspj → 描画まで）

`.sspj` は **ビルド時に一度** `.ssab` へ変換し、**実行時**はその `.ssab` を
読み込んで描画するだけです。変換は **ブラウザツール（`ssconverter-web`）**、**GUI ツール（[`SSConverterGUI`](https://github.com/cri-middleware/SSConverterGUI/releases)）** と
**CLI（[`ssconverter-cli`](https://github.com/cri-middleware/SpriteStudio-SDK/releases)）** の 3 経路があります。

```mermaid
graph LR
    SS[".sspj / 画像"]

    subgraph Build ["① ビルド時（変換・1回だけ）"]
        WEB["ssconverter-web"]
        UNZIP["ZIP展開"]
        GUI["SSConverterGUI"]
        CLI["ssconverter-cli"]
    end

    BIN[".ssab"]

    subgraph Run ["② 実行時（ブラウザで再生）"]
        LOAD["player.load()"] --> PLAYER["SSPlayer"]
        RT("ssruntime / WASM") -. "補間" .-> PLAYER
    end

    CANVAS{{"Canvas / 画面"}}

    SS -->|"ドラッグ＆ドロップ"| WEB
    WEB -->|".zipダウンロード"| UNZIP
    UNZIP --> BIN
    
    SS -->|"GUI操作"| GUI
    GUI --> BIN
    
    SS -->|"CLI / CI"| CLI
    CLI --> BIN
    
    BIN --> LOAD
    PLAYER -->|"描画"| CANVAS

    classDef gen stroke-dasharray:5 5;
    class BIN gen;
    classDef tool fill:#eef2ff,stroke:#818cf8,color:#1e1b4b;
    class WEB,UNZIP,GUI,CLI tool;
```

図の 3 経路（`SSConverterGUI` / `ssconverter-web` / `ssconverter-cli`）の詳しい使い方は
[アセットの準備](/usage/assets) を参照してください。

## パッケージ

| パッケージ | 用途 |
|---|---|
| [`@spritestudio/ssplayer-pixi`](/usage/pixi) | PixiJS v8 レンダラー（推奨・まずはこれ） |
| [`@spritestudio/ssplayer-webgl`](/usage/webgl) | 軽量な単体 WebGL レンダラー（Web Components `<ss-player>` 含む） |
| [`@spritestudio/ssplayer-rmmz`](/usage/rmmz) | RPG Maker MZ（PixiJS v5, WIP） |
| `@spritestudio/ssplayer-core` | エンジン非依存の WASM コア（レンダラーを自作する場合） |
| [`ssconverter-web`](/usage/assets#ssconverter-web-ブラウザツール) | `.sspj` → `.ssab` 変換ツール（ブラウザ版） |
| [`@spritestudio/ssconverter-core`](/usage/assets#ssconverter-core-ライブラリ-自作アプリへの組み込み) | エンジン非依存の WASM 変換コア（変換を自作アプリに組み込む場合） |
