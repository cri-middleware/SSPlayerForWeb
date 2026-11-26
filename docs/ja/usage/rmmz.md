---
description: RPG ツクール MZ 向けの ssplayer-rmmz プラグイン。インストール、変換、デプロイ、音声、既知の制限。
---

# RPG ツクール MZ で使う

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

このプラグインを使うと、**RPG ツクール MZ** のゲームで **SpriteStudio**（`.ssab`）のアニメーションを再生できます。操作はプラグインコマンドで行い、コードは書きません。アニメーションはピクチャに載り、キャラクターやピクチャと正しい Z 順で重なります。**SpriteStudio 7.6 以上**で作成したプロジェクトが必要です。

▶️ **<a href="../../examples/rmmz/" target="_blank" rel="noreferrer">ライブデモ</a>** —
同梱のサンプル MZ プロジェクトをブラウザーで実行できます。

## 1. インストール

1. [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-rmmz&expanded=true) から `ssplayer-rmmz-plugin-<version>.zip` をダウンロードします。`@spritestudio/ssplayer-rmmz <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。中身は `ssplayer-rpgmakermz.js`・`ssruntime_bg.wasm`・`ssconverter_bg.wasm` の 3 つです。
2. ZIP を展開し、3 つのファイルそのものを（フォルダごとではなく）プロジェクトの `js/plugins/` にコピーします（WASM は `.js` と同じ場所に置く必要があります）。
3. **ツール → プラグイン管理** で **ssplayer-rpgmakermz** を有効化します。パラメーターはありません。WASM はプラグイン `.js` と同じフォルダーから自動で読み込まれます。

## 2. アニメーションの変換（.sspj → .ssab） {#_2-convert-your-animation}

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はプラグインが実際に再生するコンパクトなランタイムファイルです。変換はテストプレイのときに、`js/plugins/` の `ssconverter_bg.wasm` が行います。

### 基本の使い方 {#basic-use}

1. プロジェクト直下（`js/` や `img/` と並ぶ位置）に `SpriteStudio_Source/` フォルダを作り、SpriteStudio のプロジェクトを置きます。アニメーションは複数のファイルで構成されるので、**`.sspj` だけでなくフォルダーごと**置いてください。サブフォルダーに入れても構いません。
2. テストプレイを開始します。タイトルの前に、前回の変換から変更のあったプロジェクトがすべて `spritestudio/<project>/` へ変換されます。

```
MyGame/
├── img/
├── js/plugins/
│   ├── ssplayer-rpgmakermz.js
│   ├── ssruntime_bg.wasm
│   └── ssconverter_bg.wasm     ← テストプレイで変換する
├── SpriteStudio_Source/        ← プロジェクトはここに置く
│   └── Ringo/
│       ├── Ringo.sspj
│       ├── Ringo.png
│       └── …
└── spritestudio/               ← 変換結果はここに書かれる
    └── Ringo/
        ├── Ringo.ssab
        └── Ringo.png
```

::: tip 手元に `.sspj` がまだ無いときは
[SpriteStudio 公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら [パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) が手頃です。ダウンロードしたプロジェクトは、上と同じ手順で `SpriteStudio_Source/` に置いてください。
:::

フォルダー名は `.sspj` の名前で、中の `.ssab` の名前はプロジェクト名ではなくアニメーションファイル（`.ssae`）の名前です（`Ringo.ssae` → `Ringo.ssab`）。そのため「SS表示」の `SSABファイル` は `spritestudio/<project>/<アニメーションファイル名>.ssab` になります。

### 変更を取り込む {#picking-up-a-change}

SpriteStudio で保存したら、テストプレイ中に **F5** を押します。ゲームが再起動し、その途中で変更が変換されます。変換するのはテストプレイのときだけで、デプロイしたゲームでは変換しません。

### 何が「変更」か {#what-counts-as-a-change}

テストプレイの開始時に、プロジェクトのフォルダーごとに**中で一番新しい更新時刻**（`.sspj`・`.ssae`・`.ssce`・テクスチャのすべて）を、前回**成功した**変換の記録と比べ、新しいものだけを変換し直します。プラグインを更新すると、ソースが変わっていないパックも作り直されます。出力フォルダー（たとえば `spritestudio/Ringo/`）が無い場合も作り直されます。

変換し直すときは、前回の変換が書き出して今回は書き出さなかったファイルを消します。そのため、SpriteStudio で消したアニメーションは `spritestudio/` からも、デプロイしたゲームからも消えます。フォルダーに自分で置いたファイルには触れません。音声は変換しません（[5. 音声](#_5-sound) を参照）。

記録は `SpriteStudio_Source/.ss_import_state.json` です。すべてを作り直すには、これ（または出力フォルダー）を消してテストプレイを開始してください。

### 置き場所 {#where-things-go}

| パス | 中身 | デプロイしたゲームに入るか |
| --- | --- | --- |
| `SpriteStudio_Source/` | `.sspj` のプロジェクト（変換の入力） | 入れない（[4. デプロイ](#_4-deployment) で除外） |
| `spritestudio/<project>/` | 変換した `.ssab` とテクスチャ | **入る**（ゲームが再生するのはこれ） |
| `SpriteStudio_Source/.ss_import_state.json` | 前回成功した変換の記録 | 入らない（ソースのフォルダーの中にある） |
| `js/plugins/ssconverter_bg.wasm` | コンバーター（これがあるとテストプレイで変換する） | 入れない（[4. デプロイ](#_4-deployment) で除外） |

`spritestudio/` は `img/` の中ではなく、`img/` と並ぶ位置です。デプロイの「未使用ファイルを除外する」は `img/` の中の未使用ファイルを削除するので、そこから出しておくことで素材が残ります（[4. デプロイ](#_4-deployment) を参照）。

### 変換に失敗したとき {#when-a-conversion-fails}

変換に失敗したプロジェクトがあると、起動が MZ のエラー画面で止まり、プロジェクト名と理由が表示されます。SpriteStudio で直して保存し、**Retry** を押してください。同じファイル名のプロジェクトが 2 つある場合も止まります（`chara/hero.sspj` と `enemy/hero.sspj` はどちらも `spritestudio/hero/` に書き出すため）。どちらかの名前を変えてください。詳しい内容はコンソール（F8）に出ます。ログファイルには書きません。

### 自分で変換する場合 {#converting-it-yourself}

[アセットの準備](/ja/usage/assets) のツール（ssconverter-web など）で変換した場合は、出力されたプロジェクト名のフォルダーを `spritestudio/` に置きます（`spritestudio/Ringo/Ringo.ssab`）。この場合 `ssconverter_bg.wasm` と `SpriteStudio_Source/` は要りません。

## 3. プラグインコマンド {#_3-plugin-commands}

プラグインコマンド（MZ のエディタでの表示名・引数・動作）は [RPG ツクール MZ のプラグインコマンド](/ja/usage/rmmz-commands) にあります。

## 4. デプロイ {#_4-deployment}

**SS 素材を `img/` の外に置けば、「未使用ファイルを除外する」は ON のままで構いません。**
公式ヘルプの通り、このオプションが削除対象にするのは次の 3 フォルダーの中だけです。

```
img/   audio/   effects/
```

`.ssab` とテクスチャは本プラグインが動的に読み込むため、ツクールからは未使用に見えます。
`img/` の中に置けば削除されますが、プロジェクト直下の `spritestudio/` はそもそも対象外です。プラグイン `.js` と `ssruntime_bg.wasm` が `js/plugins/` で無事なのと同じ理屈で、登録作業も追加設定も要りません。

例外は音声ファイルです。ツクールは効果音を `audio/se/` からしか再生しないため、このオプションの対象内に置くことになります（[5. 音声](#_5-sound) を参照）。

**ソースを除外する。** デプロイメントはプロジェクトフォルダーを丸ごと書き出すため、編集用の SpriteStudio プロジェクトが入った `SpriteStudio_Source/` もそのままゲームに含まれます。デプロイメントのオプション **［除外するファイル/フォルダ］** に `SpriteStudio_Source,ssconverter_bg.wasm` を入力してください。どちらもゲームの実行には不要です。

**トレードオフ — 暗号化。** MZ の *画像ファイルの暗号化* も対象は `img/` だけのため、`img/` の外に置いたテクスチャは暗号化されません。テクスチャを暗号化したい場合は、
`.ssab` とテクスチャを分けるのではなく、**`spritestudio/` フォルダーごと `img/` の下（`img/spritestudio/`）へ戻して**ください。`.ssab` は画像ではないので暗号化されませんが、同じフォルダーにあるテクスチャは暗号化され、プラグインが `ImageManager` 経由で読み込むため復号は自動です。ただしその場合は **「未使用ファイルを除外する」を OFF にする** か、デプロイ後に **`img/spritestudio/` フォルダーを出力先へコピーする** 必要があります。

なお `.ssab` やテクスチャが見つからない場合は、ピクチャの画像が見つからないときと同じく、ツクールの「Failed to load」画面にそのファイルのパスを表示してゲームが止まります。ファイルを置き直して Retry を押すと、その場から再開します。

## 5. 音声 {#_5-sound}

サウンドキーは MZ の `AudioManager` を通じて効果音として、ゲームの SE 音量で再生されます。キーのサウンド名（SpriteStudio のサウンドリストでの名前）が、ファイル `audio/se/<名前>.ogg` を指します。元のファイルは、ほかの SE と同じように Ogg Vorbis に変換して置いてください。*音声ファイルの暗号化* もほかの SE と同じく適用されます。

音はキーに指定された回数だけ続けて鳴り、止まります。SpriteStudio の音声に無限ループはありません。ピクチャを消去すると、そのピクチャが鳴らした音だけが止まります。イベントコマンド「SEの停止」は、ほかの SE と一緒にこれらの音も止めます。

**デプロイ。** ツクールは `.ssab` の中身を読めないため、「未使用ファイルを除外する」はアニメーションだけが鳴らす音声ファイルを削除します。公式プラグイン MaterialBase.js の「音声素材のリスト」に 1 つずつ登録するか、このオプションを OFF にしてデプロイしてください。MaterialBase.js は、必要な PluginCommonBase.js と一緒に MZ 本体の `dlc/BasicResources/plugins/official/` にあります。

## しくみ {#how-it-works}

- アニメーションは MZ の画面へ直接描画されます（MZ のタイルマップや標準のアニメーション効果と同じ方式です）。上に別の画面を重ねないので、キャラクターやピクチャと正しい Z 順で表示されます。
- マスク・エフェクト・SpriteStudio の連携シェーダー（13 種）・インスタンスパーツは、ブラウザ向けの WebGL 版と同じように描画されます。
- 再生はピクチャと一緒に進むため、メニューやメッセージ待ちではゲームと一緒に止まります。メニュー・戦闘・ロードのあとは、ピクチャのアニメが止まっていた位置から続きます。一時停止したものも、再生し終えたものもそのままです。トラックは先頭からになり、途中の **SSワンショット再生** と、末尾に入る前の **SS連続再生** は、ピクチャのアニメの先頭に戻ります。
- MZ 同梱の NW.js でそのまま動き、起動オプションの追加は要りません。初期化に失敗した場合は SS アニメーションが無効になるだけで、ゲームは起動します。理由はコンソール（F8）に出ます。

## 既知の制限 {#known-limitations}

- ピクチャの **色調とブレンドモードは SS アニメーションに適用されません**。*不透明度*・*移動*・*拡大縮小* は適用されます。
- 一部の画面効果は通常のピクチャと挙動が異なります（一部の PIXI フィルターは位置がずれる、など）。MZ 自身のフラッシュ / 色調オーバーレイには影響しません。

技術的な理由と今後の対応予定は、プラグインの [README](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/README.ja.md#しくみ) と [ROADMAP.md](https://github.com/cri-middleware/SSPlayerForWeb/blob/main/packages/ssplayer-rmmz/ROADMAP.md) にあります。
