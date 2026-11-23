[**English**](./README.md) | [**日本語**](./README.ja.md)

# SpriteStudio Player for Web

**Web のためのプロ品質 2D アニメーション。アーティストが作った動きを、どのページやアプリでも。**

**[SpriteStudio](https://www.webtech.co.jp/spritestudio/)** で制作したアニメーション (`.ssab`) を Web ブラウザ上で再生する高性能プレイヤーです。

## ✨ SpriteStudio を Web で使うメリット

- **キャラクターもシーン全体も“生きる”。** 呼吸・まばたき、なびく髪や衣装、斬撃・魔法のエフェクトまで——動きは専用エディタ（SpriteStudio）でボーン・メッシュ変形・パーティクルを使ってビジュアルに作り込み、ブラウザは書き出された `.ssab` を再生するだけです。キャラクター・背景・エフェクト・UI を 1 つのタイムラインで組み上げれば、バナーやスプラッシュ、カットシーンも 1 つのアニメーションとして再生できます。
- **`<video>` より軽く、操作に反応する。** お手持ちのラスター素材（PNG / WebP）を動かすので、描き込んだキャラクターが描いたとおりに動きます。`.gif` や `.mp4` と違って自由に拡大縮小でき、シームレスにループし、ユーザー操作にも反応します。**サブフレーム補間**（既定で有効）により、動画に焼き込まれたフレームレートではなくディスプレイのリフレッシュレートで滑らかに描画します。
- **お使いの環境に合わせて——HTML タグから PixiJS、ゲームエンジンまで。** 依存ゼロの `<ss-player>` タグをページに置くだけでも、PixiJS v8 のステージとバッチ描画する `SSPlayer` コンテナや、アニメーションで描く `@pixi/ui` のボタンとしても、ゲームエンジンのエディタで設定するコード不要なプラグインとしても使えます。環境に合うパッケージは下の表から選べます。
- **タイムラインからアプリやゲームへ直結。** アーティストがタイムラインに置いたキー（ユーザーデータ・シグナル・オーディオキュー）がコールバックで届き、実行時のパーツ単位オーバーライド（色・セル・表示の差し替え）や、トラック間のクロスフェード・重ね合わせにも対応します。
- **単一の WebAssembly コア、パース不要の読み込み、ブラウザ完結の変換。** `.ssab` は FlatBuffers バイナリをパースなしでそのまま読み、ポーズは WebAssembly にビルドした SDK の SIMD 最適化 Rust コアが計算します。全公式プレイヤーと同じコアです。さらに [`ssconverter-core`](./packages/ssconverter-core)（WASM）により、ネイティブのツールチェーンなしでブラウザ・Node・エディタプラグイン内で `.sspj` → `.ssab` を変換できます。

## 🌐 ブラウザで試す

インストール不要、すべてブラウザ上で動作します:

- 🛠️ **[ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)** — `.sspj` → `.ssab` をブラウザ内で変換（まずはここから）
- ▶️ **[単体 WebGL サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/webgl/)** — 依存ゼロの単体レンダラー（`<ss-player>` Web コンポーネント）。※`.ssab` のD&D再生に対応
- ▶️ **[PixiJS サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/pixi/)** — PixiJS v8 アプリ向け。※`.ssab` のD&D再生に対応
- ▶️ **[RPG ツクール MZ サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/rmmz/)** — サンプル MZ プロジェクト（SpriteStudio ピクチャ）
- ▶️ **[TyranoScript サンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** — `[ss_*]` タグで動かすヴィジュアルノベルのシーン
- 🎨 **[パーツ上書きサンプル](https://cri-middleware.github.io/SSPlayerForWeb/examples/override/)** — パーツの色 / セル / 表示を実行時に差し替え（PixiJS）
- 📂 **[.sspj プレビュー](https://cri-middleware.github.io/SSPlayerForWeb/examples/sspj-preview/)** — `.sspj` フォルダをドロップして同じタブ内で変換・再生。シークバーとイベントマーカー付き（WebGL / PixiJS 切替可）

## 📚 ドキュメント

詳細なドキュメントは `docs/` フォルダ内で提供しています（VitePress にてホスティング）。読者の目的に応じて段階的に読み進められる構成です。

- [**ドキュメントサイト (ホスト版)**](https://cri-middleware.github.io/SSPlayerForWeb/ja/)
- [**日本語ドキュメント**](./docs/ja/index.md) · [**English docs**](./docs/index.md)
- [**AI アシスタント向け**](https://cri-middleware.github.io/SSPlayerForWeb/llms.txt) — このドキュメントを Markdown で提供します。`llms.txt`（ページの目次）と `llms-full.txt`（全ページを 1 ファイルに）は英語版のページを集めたもので、日本語の各ページは `ja/` 配下の `.md` で取れます。各 npm パッケージは同じページを `docs/` に、Agent Skill として `skills/` にも持っています（[skill の入れ方](https://cri-middleware.github.io/SpriteStudio-Docs/ja/ai/docs/)）
- [**SpriteStudio Docs（ポータル）**](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と全公式 Player の入口。コーディングアシスタントに SpriteStudio を教える[プラグイン](https://cri-middleware.github.io/SpriteStudio-Docs/ja/ai/)もあります

## 🎯 どのパッケージを使うか

各レンダラーは WASM コアを同梱しているので、インストールするのは1つだけ — 環境に合う行を選んでください。**そのスタック（PixiJS / 素の WebGL …）で SpriteStudio を選ぶ理由**は各パッケージの README に記載しています。

| あなたの環境 | パッケージ | 実行できるサンプル |
|---|---|---|
| **単体 / フレームワーク非依存**（`<ss-player>` Web Component） | [`@spritestudio/ssplayer-webgl`](./packages/ssplayer-webgl) | [examples/webgl-example](./examples/webgl-example) |
| **PixiJS v8 アプリ** | [`@spritestudio/ssplayer-pixi`](./packages/ssplayer-pixi) | [examples/pixi-example](./examples/pixi-example) |
| **PixiJS v8 アプリで、アニメーションで描くボタン**（`@pixi/ui`） | [`@spritestudio/ssplayer-pixi-ui`](./packages/ssplayer-pixi-ui) | [examples/pixi-example](./examples/pixi-example)（`ui.html`） |
| **自作レンダラーを実装する** | [`@spritestudio/ssplayer-core`](./packages/ssplayer-core) | — |
| **`.sspj` → `.ssab` を変換する** | [`ssconverter-web`](./packages/ssconverter-web)（Web ツール + Node CLI） | — |
| **変換機能を自作アプリ/サービスに組み込む** | [`@spritestudio/ssconverter-core`](./packages/ssconverter-core) | — |

**ゲームエンジン統合** — npm ではなく GitHub Releases から入れるプラグインで、エンジンのエディタで設定し、コードは書きません。手順は各パッケージの README のクイックスタートにあります。

| あなたの環境 | パッケージ | 実行できるサンプル |
|---|---|---|
| **RPG ツクール MZ**（PixiJS v5） | [`@spritestudio/ssplayer-rmmz`](./packages/ssplayer-rmmz) | [examples/rmmz-example](./examples/rmmz-example) |
| **TyranoScript**（ノベルエンジン） | [`@spritestudio/ssplayer-tyranoscript`](./packages/ssplayer-tyranoscript) | [examples/tyranoscript-example](./examples/tyranoscript-example) |
| **ティラノビルダー**（ノベル制作エディタ） | [`@spritestudio/ssplayer-tyranobuilder`](./packages/ssplayer-tyranobuilder) | [examples/tyranobuilderexample](./examples/tyranobuilderexample) |

## 🚀 クイックスタート

**自分のプロジェクトで使う場合**はこのまま下へ。レンダラーを入れる → `.sspj` を変換する → 再生する、の順です。最初の 1 体から先（イベント、パーツ単位の上書き、テクスチャ差し替え）も同じ道の続きで、[カスタマイズ](./docs/ja/customize/events.md)にあります。
**SSPlayerForWeb 自体を開発する場合**は [CONTRIBUTING.md](./CONTRIBUTING.md) と[ビルドガイド](./docs/ja/development/build.md)（変更した版を自分のアプリやゲームで使う方法と、RPG ツクール MZ・Tyrano 系のホストでの確かめ方を含む）へ。パッケージの組み合わせとその理由は[プレイヤーの構成](./docs/ja/development/architecture.md)にあります。

Rust / WASM ツールチェーンは不要です（WASM は各レンダラーパッケージに同梱）。対応するのは **SpriteStudio 7.6 以上**で作成されたプロジェクトです（PixiJS・RPG ツクール MZ・TyranoScript・ティラノビルダーをお使いの場合は、上の表から各パッケージの README のクイックスタートを参照してください）。

1. **導入**: 単体レンダラーをインストールします（バンドラーを使わない場合は [CDN](./docs/ja/usage/webgl.md#バンドラーを使わないcdn-without-a-bundler-cdn) から読み込めます）:

   ```bash
   npm install @spritestudio/ssplayer-webgl
   ```

2. **変換**: `.sspj` フォルダをブラウザ上の [ssconverter-web](https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/)（またはデスクトップの [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI)）で変換し、出力されたフォルダをアプリがそのまま配信するディレクトリ（`public/` など）に配置します:

   ```
   public/
   └── Ringo/            ← 変換ツールの出力フォルダ
       ├── Ringo.ssab
       ├── Ringo.png
       └── …
   ```

3. **再生**: `<ss-player>` 要素で配置します（`SSSurface` / `SSPlayer` の JS API からコードで操作することもできます）:

   ```ts
   import { defineSSPlayerElement } from '@spritestudio/ssplayer-webgl/element';
   defineSSPlayerElement();   // <ss-player> タグを登録（アプリ全体で一度）
   ```

   ```html
   <ss-player src="/Ringo/Ringo.ssab" animation="wait1" autoplay style="width:640px;height:480px"></ss-player>
   ```

SpriteStudio のデータが手元に無くても始められます。[公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら [パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) が手頃です。自分のアニメーションを作るには SpriteStudio 本体を使います（[製品サイト](https://www.webtech.co.jp/spritestudio/)）。

**次に読む:** [インストール](./docs/ja/setup/install.md) · [クイックスタート](./docs/ja/setup/quickstart.md) · [アセットの準備（`.sspj` → `.ssab`）](./docs/ja/usage/assets.md) · [制約と適用範囲](./docs/ja/limitations.md) · [SS6Player for Web からの移行](./docs/ja/migration_from_ss6.md)

## 🎬 サンプル

すぐ動かせるサンプルアプリは [`examples/`](./examples/) にあります（レンダラーごとに1つ。上の環境別テーブルからリンクしています）。レンダラーに紐づかないものも 3 つあり、[`examples/sspj-preview`](./examples/sspj-preview) は `.sspj` のフォルダをドロップするとその場で変換して再生するサンプルで、シークバーとイベントのマーカー（クリックでその位置へシーク）付き（`ssconverter-core` + `ssplayer-webgl` または `ssplayer-pixi`、ページ上で切り替え。サーバもビルドも不要）、[`examples/part-follow`](./examples/part-follow) はパーツの実トランスフォームに HTML 要素を追従させるサンプル、[`examples/cdn`](./examples/cdn) はバンドラーも `npm install` も使わず CDN から直接読み込む 1 ファイル完結のページ 3 種です。

いくつかは上の[ブラウザで試す](#-ブラウザで試す)からそのまま動かせます。チェックアウトから動かす方法は [CONTRIBUTING.md](./CONTRIBUTING.md#開発環境のセットアップ) にあります。

PixiJS および WebGL のサンプルでは、`.ssab` ファイル（およびテクスチャ）を含むフォルダ、または embedded な `.ssab` ファイルをブラウザにドラッグ＆ドロップすることで、手元のアセットを再生できる機能が備わっています。

## 🔗 関連リポジトリ

- [SpriteStudio Docs](https://cri-middleware.github.io/SpriteStudio-Docs/ja/) — SDK と全公式 Player のドキュメントポータル
- [SpriteStudio-SDK](https://github.com/cri-middleware/SpriteStudio-SDK) — `libssruntime` および `libssconverter` を提供するコア SDK
- [SSConverterGUI](https://github.com/cri-middleware/SSConverterGUI) — Player なしで `.sspj` から `.ssab` へ変換できるデスクトップ GUI ツール

## 📄 ライセンス

このプロジェクトは BSD-3-Clause License の下でライセンスされています。詳細は [LICENSE.md](./LICENSE.md) ファイルを参照してください。参考訳は [LICENSE.ja.md](./LICENSE.ja.md) にあります。

同梱の `SpriteStudio-SDK` およびその他のサードパーティライブラリのライセンスは [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。困ったときは [SUPPORT.md](./SUPPORT.md) を、参加にあたっては [行動規範（Code of Conduct）](./CODE_OF_CONDUCT.md) をご覧ください。
