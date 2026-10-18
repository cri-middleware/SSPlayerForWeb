---
description: Web 版 Player がまだ対応していないこと、ブラウザ要件、各パッケージの入手方法、再生機能の制約。
---

# 制約と適用範囲

現行の SpriteStudio Player for Web で配信する際に把握しておくべき制約をまとめています。対応している機能については [基本的な再生](/ja/usage/basic) と各使い方ガイドを参照してください。

本リポジトリは monorepo のため、制約は 3 つの階層のいずれかに属します。各セクションでどの階層の話かを明示しています。

## 未実装の機能 — すべてのレンダラー共通

`ssplayer-webgl`・`ssplayer-pixi`、およびそれらの上に構築されたすべてのフレームワーク連携に適用されます。

::: warning
- **テキストパーツ** — 描画されません。ランタイムは描画プラン上の位置を確保しますが、グリフは提供しません（グリフのレイアウトとラスタライズは Player 側の責務です）。本リポジトリのどのレンダラーにもテキスト描画パスがまだありません。
- **9 スライスパーツ** — 描画されません。ランタイムはグリッド全体を専用の `Nines` バッファに構築しますが、どのレンダラーもまだそれを読んでいないため、セルが引き伸ばされた状態ではなく何も表示されません。
:::

どちらのパーツ種別も描画順序上の位置は保持されるため、これらを使ったアニメーションはエラーにならず、該当パーツが欠けた状態で再生されます。出荷するアニメーションでは、作画時に通常パーツへ置き換えてください。

## マスク

マスクの扱いは、次の点で 2 つのレンダラーが異なります。フレームワーク連携はどれも `ssplayer-webgl` で描画するため、連携には `ssplayer-webgl` 側の記述が当てはまります。

::: warning
- **`ssplayer-webgl` はステンシルバッファでマスクします**（`stencil` オプション。既定で有効です）。ステンシルバッファの無いコンテキストではマスクを書き込めないため、マスクの外側に描くパーツはマスクされずに描かれ、マスクの内側にだけ描く設定のパーツは描かれません。
- **マスクを書き込むパーツの数には上限があります。** マスクパーツとクリッピングパーツが対象で、アニメーション自身のものに加え、呼び出すすべてのインスタンスのものを、インスタンスを配置した回数だけ数えます。そのフレームで無効なもの（マスク値が 0、または非表示）は数えません。1 つのアニメーションが自前で持てるのは 24 個までで、インスタンスツリー全体では `ssplayer-pixi` が 96 個、`ssplayer-webgl` が 256 個までです。上限を超えた分は無視されます（`ssplayer-pixi` は警告を 1 度だけ出します）。`ssplayer-pixi` では、24 個を超えるツリーは 1 枚のカバレッジテクスチャをタイルに分けて共有します。そのため、テクスチャが最大サイズに達すると、マスクの解像度が下がります。
:::

## ブラウザ要件

::: warning WebAssembly SIMD が必須
ランタイムは WebAssembly SIMD 命令を使用してビルドされており、**SIMD 非対応のブラウザでは動作しません**。本リポジトリのすべてのパッケージが対象です（RPG Maker MZ プラグインは、MZ の NW.js 向けに SIMD なしのビルドを同梱しているため対象外です）。配信先のブラウザ要件として扱ってください。
:::

ブラウザ版コンバーター `ssconverter-web` はさらに、フォルダー選択に **File System Access API**
（`showDirectoryPicker` / ディレクトリのドラッグ＆ドロップ）を使用するため、**Chromium 系ブラウザ**（Chrome / Edge など）が必要です。Firefox・Safari では動作しません。
[アセットの準備](/ja/usage/assets) を参照してください。

## 各パッケージの入手方法

レンダラーは npm パッケージですが、フレームワーク連携はホスト側のプラグイン機構が読み込む
IIFE バンドルとして提供されるため、**npm からはインストールできません**。

| パッケージ | 入手方法 |
|---|---|
| `@spritestudio/ssplayer-core` | npm |
| `@spritestudio/ssplayer-webgl` | npm |
| `@spritestudio/ssplayer-pixi` | npm |
| `@spritestudio/ssconverter-core` | npm |
| `@spritestudio/ssplayer-rmmz` | プラグイン ZIP、または[ソースからビルド](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/README.ja.md#コントリビューター向け--ソースからビルド) |
| `@spritestudio/ssplayer-tyranoscript` | プラグイン ZIP、または[ソースからビルド](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranoscript/README.ja.md#コントリビューター向け--ソースからビルド) |
| `@spritestudio/ssplayer-tyranobuilder` | `ssplayer.tbp` をティラノビルダーのプラグイン設定から追加、または[ソースからビルド](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-tyranobuilder/README.ja.md#開発者向け) |
| `@spritestudio/ssconverter-web` | GitHub Pages（`/ssconverter/`）でホスト、リポジトリ同梱の Node CLI |

## RPG ツクール MZ（beta）

`@spritestudio/ssplayer-rmmz` は **beta** です。
[RPG ツクール MZ で使う](/ja/usage/rmmz) を参照してください。

::: warning
- **ピクチャの色調とブレンドモードは SS アニメーションに影響しません。** *不透明度*・*移動*・*拡大縮小*は反映されます。
- **一部の画面エフェクトは通常のピクチャと挙動が異なります。** 一部の PIXI フィルターはアニメーションの位置をずらすことがあります。ツクール本体のフラッシュ・色調変更は影響を受けません。
- **デプロイ時の「未使用ファイルを含まない」は `img/` に置いたものを削除します。**
  `.ssab` とテクスチャは動的に読み込まれるためツクールからは未使用と判定されますが、このオプションの対象は `img/`・`audio/`・`effects/` だけです。プロジェクト直下の `spritestudio/`
  フォルダに置けば削除されません。代わりに、同じく `img/` だけが対象の画像暗号化も掛からなくなります。
- **同じオプションは、アニメーションだけが鳴らす音声ファイルも削除します。** 音声はこのオプションの対象である `audio/se/` から再生されるため、公式プラグイン MaterialBase.js で登録してください（[音声](/ja/usage/rmmz#_5-sound)）。
:::

## TyranoScript / ティラノビルダー {#tyranoscript-tyranobuilder}

どちらも **beta** です。[TyranoScript で使う](/ja/usage/tyrano) および
[ティラノビルダーで使う](/ja/usage/tyranobuilder) を参照してください。

::: warning ティラノビルダー
- **無料版が読み込めるプラグインは 2 つまで**で、本プラグインはその 1 つを消費します。
- **`ssplayer.tbp` はリネームしないでください。** ティラノビルダーはファイル名からプラグイン名を取得します。
:::

## 再生機能の制約

以下は共通コア `libssruntime` に由来するため、本リポジトリのすべてのパッケージに適用されます。すべての公式 Player にも共通するため、詳しい説明と、その他の共通制約（embedded モード、`.ssab` の入力検証を行わない件など）はポータルにまとめてあります:
**[共通の制限事項](https://cri-middleware.github.io/SpriteStudio-Docs/ja/sdk/limitations/)**

::: warning
- **`independent = true` のパーツ（インスタンス／エフェクト）は逆再生・シークで正しく動作しません。**
  正しいのは順方向の再生（順方向のフレームスキップを含む）のみです。
- **シークは通過したフレームのイベントを発火しません。** 発火するのは移動先フレームの
  `UserData` / `Signal` / `Audio` のみです。
- **オーディオは逆再生できません。** 実質的な進行方向が逆向き（逆再生、ピンポンの復路）の場合、サウンドはスキップされます。負の再生速度はこれに該当しません。速度は倍率であり、負値は再生ヘッドの向きを変えるのではなく停止させます（`0` も同様）。
- **ランタイムは音声を再生しません。** `onAudio` はサウンドの参照とタイミングを通知するのみで、実際の再生はアプリ側の責務です（フレームワーク連携では各プラグインが実装済みです）。
:::
