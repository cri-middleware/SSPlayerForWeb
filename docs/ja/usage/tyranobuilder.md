---
description: ティラノビルダー向けの ssplayer-tyranobuilder プラグイン。インストール、自動インポート、うまくいかないとき。
---

# ティラノビルダーで使う

**SpriteStudio** のアニメを、ティラノビルダーのコンポーネントパレットから配置できます。シナリオを書く必要はありません。SpriteStudio のプロジェクトをゲーム内のフォルダに置いておけば、プロジェクトを開いたときにエディタ側が自動で変換し、以降は指示したときに変換し直します。動作確認は **TyranoBuilder Ver 3.00** で行っています。**SpriteStudio 7.6 以上**で作成したプロジェクトが必要です。

シナリオを手書きする場合は [TyranoScript で使う](/ja/usage/tyrano) を参照してください。同じアニメを
`[ss_*]` タグで扱えます。

<!-- Relative path on a raw <a target="_blank">, not a markdown link -- see
     docs/index.md for why. -->

▶️ **<a href="../../examples/tyranoscript/" target="_blank" rel="noreferrer">ライブデモ</a>** —
TyranoScript 版のサンプルシーンです。ランタイムは同じなのでビルダー専用のデモはありません。コンポーネントで配置した結果もここと同じ見た目になります。

## 1. インストール

1. [GitHub Releases](https://github.com/cri-middleware/SSPlayerForWeb/releases?q=ssplayer-tyranobuilder&expanded=true) から `ssplayer.tbp` をダウンロードします。`@spritestudio/ssplayer-tyranobuilder <version>` という名前の Release を開き、**Assets** にあるファイルを取ってください（*Source code* のアーカイブではありません）。必要なのはこのファイルだけです（TyranoScript 用プラグインの `init.ks`・`main.js`・`ssruntime_bg.wasm` も入っています）。
2. ティラノビルダーでメニューの **プロジェクト → プラグイン** を開き、**プラグインを追加** でそのファイルを選びます。

**ファイル名は `ssplayer.tbp` のまま使います。** ティラノビルダーはファイル名からプラグインを探すので、`ssplayer-1.2.0.tbp` のように名前が変わると何もインストールされません。版は Release の名前で分かります。

これ以外の準備は不要です。プラグイン読み込みのタグも、ランタイムの初期化も要りません。

## 自動インポート {#the-auto-importer}

`.sspj` は編集用の SpriteStudio プロジェクト、`.ssab` はゲームが実際に再生する軽量なランタイムファイルです。このプラグインは、ゲームのフォルダに置いた SpriteStudio のプロジェクトを、エディタの中で `.ssab` に変換します。

自動変換したものも手動で入れたものも置き場所は同じで、コンポーネントのプルダウンには両方が並びます（[自分で変換した .ssab を使う](#bringing-in-a-pack-you-converted-yourself)を参照）。

### 基本の使い方

1. SpriteStudio のプロジェクトを、**`.sspj` とそのフォルダ一式**（アニメは複数ファイルで構成されるため）でプロジェクトフォルダ内の **`SpriteStudio_Source/`** に置きます。このフォルダは初回起動時にプラグインが作成するので、すでに用意されています。**プロジェクト → プラグイン** → **SpriteStudio** の **SpriteStudio_Source を開く** で、そのフォルダが開きます。
2. ティラノビルダーでプロジェクトを開きます。
3. 変換の結果がメッセージで表示されます。アニメは **SpriteStudio 表示** コンポーネントのプルダウンから選べる状態になっています。変換に失敗したときは、理由がダイアログで表示されます。

`.sspj` ごとに、その名前のフォルダが `data/others/ssdata/` 以下に作られます。

```
SpriteStudio_Source/Ringo/Ringo.sspj   →   data/others/ssdata/Ringo/Ringo.ssab
                                                                 （+ テクスチャ）
```

サブフォルダも検索対象なので、ソースの整理は好きな形で構いません。出力フォルダ名は `.sspj` のファイル名だけで決まります。

::: tip 手元に `.sspj` がまだ無いときは
[SpriteStudio 公式のサンプルデータ](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/)がそのまま使えます。キャラクターなら [Ringo](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#ringo)、エフェクトを含むものなら [パーティクル](https://www.webtech.co.jp/help/ja/spritestudio7/download/sample/#Perticle_sample) が手頃です。ダウンロードしたプロジェクトは、上と同じ手順で `SpriteStudio_Source/` に置いてください。
:::

### 変更を取り込む

変換が走るのは**プロジェクトを開いたとき**で、それ以降は指示したときだけです。エディタを開いている間、裏で変換が走ることはありません。SpriteStudio で保存したあとの戻り道は 2 つあります。

| | 場所 | 動作 |
| --- | --- | --- |
| **今すぐ再変換** | そのアニメを再生している **SpriteStudio 表示** コンポーネント | 記録に関わらず、そのアニメデータ 1 つを変換し直す |
| **今すぐ取り込む** | **プロジェクト → プラグイン** → **SpriteStudio** | プロジェクトを開いた後に追加・編集されたものをすべて変換する |

普段使うのは **今すぐ再変換** です。**今すぐ取り込む** は、プロジェクトを開いたまま `SpriteStudio_Source/` に**新しく**置いたプロジェクトのためのものです。まだどのコンポーネントからも指定できないので、こちらで変換します。

同じ画面に **SpriteStudio_Source を開く** と **変換ログを開く** があり、動いているコンバータのバージョン（`converter <version> (ssab v1, ssqb v1)`）も表示されます。不具合を報告するときは、この行を添えてください。

### 「変更された」の判定

プロジェクトを開いたときは、プロジェクトごとに**そのフォルダ内で最も新しい更新時刻**（`.sspj` / `.ssae` / `.ssce` / テクスチャなど、すべて）を、**成功した**最後の変換と比べ、ソースの方が新しいものだけを変換し直します。プラグインを更新したときは、ソースが変わっていないものも作り直します。出力フォルダ（`data/others/ssdata/Ringo/` など）が無くなっていれば、それも作り直します。

変換し直すと、前回書き出して今回は書き出さなかったファイルを削除します。SpriteStudio 側でアニメを削除すれば、プルダウンからも消え、書き出したゲームにも入らなくなります。自分で置いたファイルはそのまま残ります。

この記録はプロジェクト直下の `.ss_import_state.json` です。すべて作り直したいときは、このファイル（または出力フォルダ）を削除してプロジェクトを開き直してください。

### 生成されるファイルの置き場所

| パス | 内容 | 書き出したゲームに含まれる？ |
| --- | --- | --- |
| `SpriteStudio_Source/` | 入力となる `.sspj` プロジェクト | 含まれない |
| `data/others/ssdata/<名前>/` | 変換後の `.ssab` + テクスチャ | **含まれる**（ゲームが再生するデータ） |
| `.ss_import_state.json` | 成功した最後の変換の記録と、各フォルダの変換元 `.sspj` | 含まれない |
| `ss_import_log.txt` | 変換の記録と失敗理由 | 含まれない |
| `.ss_tools/ssconverter_bg.wasm` | プラグインのフォルダから移したコンバータ本体 | 含まれない |

書き出したゲームには `data/` 以下がすべて入るので、制作時のファイルは `data/` の外に置いています。

### 変換に失敗したとき {#when-a-conversion-fails}

変換に失敗したプロジェクトや、同じ名前の別のプロジェクトに出力フォルダを取られたプロジェクトは、理由とともにダイアログに表示されます。SpriteStudio で直して保存し、**今すぐ再変換**（または **今すぐ取り込む**）を使ってください。変換できたプロジェクトは、短い通知で知らされます。

エディタにはコンソールが無いので、変換の記録はプロジェクト直下の **`ss_import_log.txt`** に 1 行ずつ書き込まれます。セッションをまたいで追記されます（256 KB を超えると書き直します）。

```
2026-07-29T04:15:02.118Z  --- session start ---
2026-07-29T04:15:02.140Z  sources: /Users/you/TyranoBuilder/mygame/SpriteStudio_Source
2026-07-29T04:15:02.141Z  output:   /Users/you/TyranoBuilder/mygame/data/others/ssdata
2026-07-29T04:15:02.150Z  converter: worker — converter <version> (ssab v1, ssqb v1)
2026-07-29T04:15:02.219Z  converted Ringo: 14 in -> 2 out (+1 textures) in 78ms -> …/ssdata/Ringo
2026-07-29T04:15:02.220Z  first pass: 1 converted, 0 up to date, 0 failed, 0 dropped
```

`converter:` の行が `inline` のときは、変換のあいだエディタの操作が止まります。理由は同じ行に出ます。

起動時に検出したホスト環境も記録されるので、プラグインが動いていないように見えるときは、まずここを見てください。

### 自分で変換した .ssab を使う {#bringing-in-a-pack-you-converted-yourself}

**アニメデータ**のプルダウンには、**`data/` 以下のすべての `.ssab`** が並びます（自動変換したものが先、残りはアルファベット順）。

[`ssconverter-web` / SSConverter GUI / `ssconverter-cli`](/ja/usage/assets) で変換して手動でコピーしたデータも、同じように選べます。シーンの画像の隣に置くなど、プロジェクトの都合で構いません。**アニメーション**のプルダウンは `.ssab` そのものから読むので、手動で入れたデータでも正確です。

自動で同期されるのは `SpriteStudio_Source/` に置いたものだけです。ただし `data/others/ssdata/` から**コピーした**データなら **今すぐ再変換** が使え、生成元のフォルダではなく今ある場所へ書き直します。まったく別の場所で変換したデータには変換元のプロジェクトがないため、その旨を表示します。

### 現在の制限

- **フォルダは固定です。** `SpriteStudio_Source/` と `data/others/ssdata/` は変更できません。
- **テクスチャは埋め込みではなくコピーです。** 各データは画像を `.ssab` の兄弟ファイルとして持ちます。手動で移動するときは一緒に移動してください。
- **拾うのは `.sspj` だけです。** `SpriteStudio_Source/` 内のそれ以外のファイルは対象になりません（プロジェクトが変更されたかどうかの判定では、フォルダ内の一部として参照されます）。

## コンポーネント {#the-components}

各コンポーネントの働きと設定項目は [ティラノビルダーのコンポーネント](/ja/usage/tyranobuilder-components) にあります。

## うまくいかないとき {#troubleshooting}

変換に失敗した場合は、その理由がダイアログに表示されます。それ以外の記録はプロジェクト直下の `ss_import_log.txt` にあります（[変換に失敗したとき](#when-a-conversion-fails)を参照）。

プレビュー中にコンポーネントが役目を果たせないとき（「表示」で作っていない管理名や、アニメデータに無くなったアニメーションを指定したときなど）は、その理由がシーンのファイル名と行番号付きのダイアログで表示されます。書き出したゲームでは表示されません。書き出し時にエンジンのデバッグ設定がオフになるためです。

- **アニメがプルダウンに出ない** — `.sspj` がフォルダ一式で `SpriteStudio_Source/` に入っているかを確認し、ログに `FAILED` の行がないか見てください。
- **パレットに SpriteStudio のコンポーネントが無い** — プラグインが読み込まれていません。`.tbp` を入れ直し、スタンダード版のプラグイン 2 個制限を超えていないか確認してください。
- **変換はできたのにゲームに出ない** — 「表示」がそれを参照するコンポーネントより前にあるか、レイヤー番号がゲームで使っているものかを確認してください。
- **2 つのうち片方がいつまでも変換されない** — 同じファイル名の `.sspj` は同じ
  `data/others/ssdata/<名前>/` に変換されるため、先に見つかった方だけを変換し、ぶつかった 2 つの名前を表示します。どちらかの名前を変えてください。
- **SpriteStudio での変更が反映されない** — プロジェクトを開いたあとは自動では走りません。コンポーネントの **今すぐ再変換** を使ってください。まだコンポーネントが無いプロジェクトはプラグイン画面の **今すぐ取り込む** です。どちらでも反映されない場合は
  `.ss_import_state.json` を削除してプロジェクトを開き直してください。

