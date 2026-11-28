---
layout: home

hero:
  name: SpriteStudio Player for Web
  tagline: WebAssembly（Rust）× JavaScript のハイブリッド。WebGL や PixiJS などの Web グラフィックスで SpriteStudio アニメーションを高速に再生します。
  actions:
    - theme: brand
      text: クイックスタート
      link: /ja/setup/quickstart
    - theme: alt
      text: インストール
      link: /ja/setup/install
    - theme: alt
      text: GitHub
      link: https://github.com/cri-middleware/SSPlayerForWeb

# See the English index.md for what the cards and the table are for, and why
# the details are written in HTML.
features:
  - title: 動きはコードでなくアーティストが作る
    details: ボーン・メッシュ変形・パーティクルは、手持ちのラスター素材（PNG / WebP）の上に SpriteStudio で目で見ながら付けます。キャラクター・背景・エフェクト・UI を 1 つのタイムラインに組めば、バナーやスプラッシュ画面、カットシーンを 1 つのアニメーションとして再生できます。
    link: /ja/setup/quickstart
    linkText: クイックスタート
  - title: 切り替えずにブレンドする
    details: 次のアニメーションへクロスフェードし、歩きの上に照準のポーズやリアクションを別のトラックで重ね（混ぜるか、上に足すか）、実行時に重みでアニメーションを混ぜられます。コードからも、RPG ツクール MZ のプラグインコマンドや TyranoScript のタグからも使えます。
    link: /ja/customize/motion-blending
    linkText: モーションブレンド
  - title: アニメーションで描くボタン
    details: <code>SSButton</code> は SpriteStudio のアニメーションを <code>@pixi/ui</code> のボタンにします。ホバー・押下・無効・フォーカスの各状態をラベルで再生し、形が不規則なボタンは絵の上でだけポインタを受けられます。
    link: /ja/usage/pixi-ui
    linkText: UI ボタン
  - title: アプリやゲームとつながる
    details: アーティストがタイムラインに置いたユーザーデータ・シグナル・サウンドのキーが、そのフレームでコールバックとして届きます。パーツの色・セル・表示の上書き、セルマップのテクスチャ差し替えによる着せ替え、指定パーツへの追従もコードからできます。
    link: /ja/customize/events
    linkText: カスタマイズ
  - title: HTML のタグ 1 つからゲームエンジンまで
    details: どのページにも <code>&lt;ss-player&gt;</code> タグを書くだけで置けるほか、PixiJS v8 のステージに <code>SSPlayer</code> を足す、Google 広告の HTML5 広告に入れる、RPG ツクール MZ・TyranoScript・ティラノビルダーにプラグインを入れてコードを書かずに使う、のいずれもできます。
    link: '#where-to-start'
    linkText: どこから始めるか
  - title: 動画より軽く、操作に反応する
    details: .gif や .mp4 と違って自由に拡大縮小でき、シームレスにループし、ユーザー操作にも反応します。サブフレーム補間（既定で有効）により、焼き込まれたフレームレートではなくディスプレイのリフレッシュレートで描き、.ssab はパースせずに読み込みます。
    link: /ja/customize/performance
    linkText: パフォーマンスチューニング
---

[SpriteStudio](https://www.webtech.co.jp/spritestudio/) は、手持ちのイラストにボーン・メッシュ・エフェクトを付けて動かす 2D アニメーションツールです。このプレイヤーは、その結果を Web ページやアプリで再生します。

::: tip SpriteStudio のデータが手元に無くても始められます
[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら [パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) が手頃です。自分のアニメーションを作るには SpriteStudio 本体を使います（[製品サイト](https://www.webtech.co.jp/spritestudio/)）。
:::

## どこから始めるか {#where-to-start}

自分の環境の行を選んでください。各ガイドで、インストールから画面にアニメーションを出すところまで進めます。プレイヤーが再生するのは、SpriteStudio の `.sspj` を変換した `.ssab` です。RPG ツクール MZ とティラノビルダーではプラグインがエディタの中で変換し、それ以外では自分で変換します（[アセットの準備](./usage/assets.md)）。

| 環境 | パッケージ | `.sspj` → `.ssab` | ガイド | ライブデモ |
|---|---|---|---|---|
| フレームワークの無い Web ページ（HTML のタグ 1 つ、またはコードから WebGL） | `@spritestudio/ssplayer-webgl` | 自分で変換 | [WebGL・Web Components](./usage/webgl.md) | [WebGL](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/) |
| PixiJS v8 のアプリ | `@spritestudio/ssplayer-pixi` | 自分で変換 | [PixiJS](./usage/pixi.md) | [PixiJS](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/) |
| PixiJS v8 のアプリで、アニメーションで描くボタン | `@spritestudio/ssplayer-pixi-ui` | 自分で変換 | [UI ボタン](./usage/pixi-ui.md) | [ボタン](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/ui.html) |
| Google 広告の HTML5 広告・アプリキャンペーンのプレイアブル | `@spritestudio/ssplayer-webgl` | 自分で変換 | [HTML5 広告](./usage/html5-ads.md) | — |
| RPG ツクール MZ | プラグイン | プラグインがテストプレイで | [RPG ツクール MZ](./usage/rmmz.md) | [RPG ツクール MZ](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/) |
| TyranoScript | プラグイン | 自分で変換 | [TyranoScript](./usage/tyrano.md) | [TyranoScript](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/) |
| ティラノビルダー | プラグイン | プラグインがプロジェクトを開くときに | [ティラノビルダー](./usage/tyranobuilder.md) | [TyranoScript](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)（プラグインが組み込むのと同じランタイム） |
| 自前のレンダラー | `@spritestudio/ssplayer-core` | 自分で変換 | [API リファレンス：どこから見るか](./api-guide.md) | — |

::: tip 旧プレイヤーからの移行をお探しの方へ
旧 **[SS6Player for Web](https://github.com/SpriteStudio/SS6PlayerForWeb)**（`ss6player-pixi`）から移行する場合は、**[SS6Player からの移行](./migration_from_ss6.md)** で旧→新の API 対応とアセット再変換（`.ssfb` → `.ssab`）の手順を確認してください。
:::

## ブラウザで試す

インストール不要、すべてブラウザ上で動作します:

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — `.sspj` → `.ssab` をブラウザ内で変換
- 📂 **[.sspj を落として再生する](https://cri-middleware.github.io/SSPlayerForWeb/examples/sspj-preview/)** — **手元のプロジェクト**をタブ内で変換して再生・シーク。ユーザーデータ／シグナル／サウンドのキーをタイムライン上に表示。プレイヤーは WebGL と PixiJS を切り替え可能
- 🎨 **[パーツ上書きサンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** — 実行時の色 / セル / 表示の上書き（PixiJS）

## 関連リポジトリ

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と公式 Player のドキュメントポータル。
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` / `libssconverter` を提供する SDK 本体。
- [SSConverter GUI](https://github.com/cri-middleware/SSConverterGUI) — Player を介さず `.sspj` を変換するデスクトップ GUI。
