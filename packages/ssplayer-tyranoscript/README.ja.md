[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyranoscript

**TyranoScript** のシナリオに `[ss_*]` タグを書くだけで、**SpriteStudio** のアニメを表示・再生できます。プログラミングは不要です。

> **対象読者:** TyranoScript を使うシナリオ作者 — SpriteStudio アニメ用の `[ss_*]` タグを追加するドロップイン・プラグインです。
> **TyranoBuilder** をお使いの場合は [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.ja.md) を導入してください。本パッケージのランタイムを内包した上で、コンポーネントパレットからの配置と `.sspj` の自動変換に対応します。**ステータス:** beta。**目的が違う場合:** → [ssplayer-webgl](../ssplayer-webgl/README.ja.md) — このプラグインの土台になっている単体レンダラです。

> ⚠️ **beta。** シナリオ作成用のタグは揃っていますが、`7.0.0` までに名前や挙動が変わる可能性はあります。未完了の作業はリポジトリの [`ROADMAP.md`](./ROADMAP.md) にあります。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyranoscript/)** —
同梱の TyranoScript サンプルをブラウザで動かせます（🚧 初回リリース後に公開）。

## インストール

**まだリリース版はありません。** 現状で入手する唯一の方法はソースからのビルドです（[コントリビューター向け — ソースからビルド](#コントリビューター向け--ソースからビルド) を参照）。

最初のリリース以降は、プロジェクトの GitHub Releases に ZIP が添付されます。導入手順は次の通りです:

1. リリースをダウンロードして解凍すると、`ssplayer/` フォルダが入っています。
2. その `ssplayer/` フォルダを Tyrano プロジェクトの `data/others/plugin/` にコピーします。
3. シナリオから `[plugin name="ssplayer"]` で読み込みます（下記の例を参照）。

フォルダには 3 ファイルが入ります: `init.ks`（ローダ）、`main.js`（プラグイン本体）、
`ssruntime_bg.wasm`（アニメーションランタイム）。`.ssab` アニメファイルは
`data/others/ssdata/` に置きます。

> **この ZIP は TyranoScript 用です。** ティラノビルダーで制作する場合は
> [`@spritestudio/ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.ja.md) の
> `ssplayer.tbp` だけを入れてください。`.tbp` はこの 3 ファイルをそのまま内包した上で、エディタ側を追加したものです。**どちらか一方だけを入れてください。** 展開先はどちらも同じ
> `data/others/plugin/ssplayer/` で、重ねて入れるとエディタ側とランタイム側でバージョンがずれます。

## アニメを変換する（.sspj → .ssab）

`.sspj` は SpriteStudio で編集するプロジェクトファイル、`.ssab` はプラグインが実際に再生する変換済み（プリビルド）のランタイムファイルです。`[ss_new storage="..."]` で読み込むのはこの
`.ssab` です。`.sspj` を次のいずれかで変換してください。

- **Web（インストール不要）：** ホスト版コンバータ
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>**（🚧 初回リリース後に利用可能）を開き、`.sspj`
  プロジェクトが入ったフォルダ（ディレクトリ）をドロップすると `.ssab`（＋テクスチャ）が
  zip ファイルでダウンロードできます。
- **デスクトップ：** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases) を使います。

変換して出てきた `.ssab`（＋テクスチャ）は、Tyrano プロジェクトの `data/others/ssdata/` に置きます。プロジェクトごとにサブフォルダ（例: `data/others/ssdata/Ringo/`）へまとめておくとテクスチャが混ざらず、`[ss_new]` からは `storage="others/ssdata/Ringo/Ringo.ssab"` のように参照できます。

## クイックスタート

ループするキャラを 1 体表示する最小シナリオ:

プラグインの読み込みは、ゲーム冒頭で 1 回だけです:

```
; first.ks
[plugin name="ssplayer"]
```

キャラの表示は、出したい場面で行います:

```
; scene1.ks
[ss_new name="chr" storage="others/ssdata/Chara.ssab" layer="0" x="640" y="480" loop="true"]
[ss_play name="chr"]
```

- `[plugin]` はプラグインの読み込みとランタイムの起動をまとめて行います。`first.ks` に書くのはこの 1 行だけで、準備はこれで終わりです（`[ss_init]` も `make.ks` への追記も不要です）。
- `[ss_new]` は名前付きプレイヤーを生成し、`.ssab` をロードしてレイヤーに置き、再生します。
- `[ss_play]` は既存プレイヤーで再生／アニメ切替を行います。

動く最小プロジェクトは [`examples/tyranoscript-example`](../../examples/tyranoscript-example/README.md) を参照してください。

## レシピ（よくある操作）

1 つの `.ssab` に複数アニメ（待機／笑顔／ジャンプ…）を含められます。`anime=` で切り替えます（空欄なら先頭）。

**表情・アニメを切り替える**（同じ `.ssab`・再ロードなし）

```
[ss_play name="akane" anime="smile"]
```

**一度だけ再生して、終わってから次へ進む**

```
[ss_play name="akane" anime="jump" loop="false"]   ; 1 回だけ再生
[ss_wait name="akane"]                              ; 再生完了まで待つ
[ss_play name="akane" anime="wait" loop="true"]     ; 待機ループへ戻す
```

**シナリオを止めずに同じことをする**（テキストは進み続ける）

```
[ss_play name="akane" anime="jump" next="wait"]     ; 1 回再生 → 自動で待機ループへ
```

> 登場・移動（`[ss_move]` / `[ss_pos]`）、`[anim]` フェード、複数レイヤー、セーブ/ロード復元などの実例は、コメント付きの同梱サンプル [`first.ks`](../../examples/tyranoscript-example/data/scenario/first.ks) を参照してください。

## 提供タグ

| タグ | 役割 | 主な属性 |
| --- | --- | --- |
| `[ss_init]` | **音声設定**。ランタイムは `[plugin name="ssplayer"]` が起動済みなので、このタグは音声設定を変える用途だけです | `audio=`, `sounddir=`, `soundext=`, `sevolume=`（`wasm=` はプラグインが指定） |
| `[ss_new]` | プレイヤー生成 → ssab ロード → レイヤーへ挿入 → 再生 | `name=`(必須) `storage=`(必須) `anime=` `layer=` `page=` `x=` `y=` `scale=` `loop=` `visible=` `zindex=` |
| `[ss_play]` | 再生 / アニメ切替（続けて再生するアニメも指定可） | `name=`(必須) `anime=` `loop=` `start=` `next=` `nextloop=` `atframe=` |
| `[ss_show]` | プレイヤーを表示（位置指定・登場アニメ・フェード） | `name=`(必須) `x=` `y=` `scale=` `zindex=` `anime=` `loop=` `next=` `time=` `wait=` |
| `[ss_hide]` | 破棄せずに非表示にする（ロード状態は維持） | `name=`(必須) `time=` `wait=` |
| `[ss_fadein]` / `[ss_fadeout]` | 全プレイヤーを一括フェード（シーン切替向け） | `time=` `wait=` |
| `[ss_chara]` | 話者と連動し、発話中はトークアニメを再生 | `name=`(必須) `jname=` `talk=` `idle=` |
| `[ss_stop]` / `[ss_pause]` / `[ss_resume]` | 個別プレイヤーの停止 / 一時停止 / 再開 | `name=`(必須) |
| `[ss_stop_audio]` | プレイヤーが鳴らした音をすぐ止める | `name=`(必須) |
| `[ss_speed]` | 再生速度（`1` = 等速） | `name=`(必須) `speed=`(必須) |
| `[ss_seek]` | 指定フレームへ移動 | `name=`(必須) `frame=`(必須) |
| `[ss_section]` | 指定範囲のフレームだけを再生（両端とも省略で解除） | `name=`(必須) `start=` `end=` |
| `[ss_direction]` | 順再生 / 逆再生、1 回 / 往復 | `name=`(必須) `direction=` `style=` |
| `[ss_wait]` | アニメ終了（ループ時は1周）までシナリオを待つ | `name=`(必須) |
| `[ss_wait_signal]` | アニメがシグナル（`command=` 指定時はそのコマンド）を出すまでシナリオを待つ | `name=`(必須) `command=` `var=` |
| `[ss_pos]` | 瞬間移動/スケール/重なり順（アンカー基準・絶対） | `name=`(必須) `x=` `y=` `scale=` `zindex=` |
| `[ss_move]` | 補間移動/スケール（easeOut, 既定は非ブロッキング） | `name=`(必須) `x=` `y=` `scale=` `time=` `wait=` |
| `[ss_part_color]` | パーツの色をアニメより優先して上書き（通常パーツのみ） | `name=`(必須) `part=`(必須) `color=`(必須) `blend=` `priority=` |
| `[ss_part_visible]` | パーツを強制的に非表示 / 解除。`cascade=` で子孫にも波及 | `name=`(必須) `part=`(必須) `hide=` `cascade=` |
| `[ss_part_cell]` | パーツが描くセルを差し替え（通常 / マスクパーツのみ） | `name=`(必須) `part=`(必須) `cellmap=`(必須) `cell=`(必須) `priority=` |
| `[ss_part_clear]` | パーツ上書きを解除（`part=` 省略で全パーツ） | `name=`(必須) `part=` |
| `[ss_free]` | 1 プレイヤーを解放 | `name=`(必須) |
| `[ss_free_all]` | 全プレイヤー解放（シーン遷移 / レイヤークリア時） | — |
| `[ss_pause_all]` / `[ss_resume_all]` | 全プレイヤー一時停止 / 再開（メニュー等で使用） | — |
| `[ss_restore]` | セーブから全プレイヤーを再構築。**通常は不要**（ロード時に自動復元されます）。ロード完了まで待たせたい場合や、イベント機構の無い古いエンジンでのみ使います | — |

座標は他の画面要素と同じく、Tyrano の通常の左上原点ピクセル（`config.scWidth × scHeight`）を使います。[^coords] `loop` は `true`→無限 / `false`→1 回 / 数値→回数。

[^coords]: 内部的には canvas は HiDPI 対応です。ピクセル倍率の詳細はコントリビューター向けセクションを参照してください。

**属性の補足:**

- `loop`: `true`＝無限ループ（既定）／`false`＝1 回／数値＝回数。
- `layer`: Tyrano のレイヤー番号（**大きいほど手前**。既定 `0`）。`page` は `fore`（前景・既定）/`back`（背景）。
- `x` / `y`: Tyrano と同じ左上原点ピクセル（既定 `0,0`）。指定した位置にアニメの**アンカー**が合います。
- `scale`: 拡大率（既定 `1`）。
- `anime`: `.ssab` 内のアニメ名。空欄なら**先頭アニメ**を自動採用します。
- `[ss_play]` の `start`: 再生開始フレーム（既定 `-1`＝現在フレームから）。
- `visible`: `false` で**表示せずにロードだけ**行います（先読み）。後から `[ss_show]` で表示します。
- `zindex`: **同じレイヤー内**での重なり順。未指定だと生成順に重なります。
- `time`: フェード時間（ms）。`[ss_show]` / `[ss_hide]` は既定 `0`（瞬時）、`[ss_fadein]` / `[ss_fadeout]` は既定 `1000`。
- `wait`: `true` で演出の完了までシナリオを止めます。フェード系は既定 `true`、`[ss_move]` は既定 `false`。
- `next` / `nextloop` / `atframe`: [アニメの連鎖](#アニメの連鎖シナリオを止めない) を参照。
- `command` / `var`: [シグナルを待つ](#シグナルを待つ) を参照。
- `[ss_speed]` / `[ss_seek]` / `[ss_section]` / `[ss_direction]`: [速度・シーク・区間](#速度シーク区間) を参照。

## 先読み・表示・非表示

`[ss_new]` はロードが終わり次第そのまま表示します。サイズの大きい `.ssab` では、登場より**早い段階でロードを済ませて**おき、場面が来たら即座に出すのが定石です:

```
[ss_new name="akane" storage="others/ssdata/Akane.ssab" visible="false"]  ; ここでロード
...
[ss_show name="akane" x="640" y="480" time="800"]   ; ここで登場（待たされない）
[ss_hide name="akane" time="500"]                   ; 画面から消す（ロードは維持）
[ss_show name="akane"]                              ; 再ロードなしで復帰
```

`[ss_hide]` は `[ss_free]` とは別物です。アニメはロードされたまま（＝ `[ss_show]` が即時）で、画面外なので GPU も消費しません。そのキャラをもう使わない場合は `[ss_free]` を使ってください。

`[ss_fadeout]` / `[ss_fadein]` は**全プレイヤー**を一括でフェードします（シーン切替の定番）。一括フェードアウトは個別に非表示にしていたプレイヤーを覚えているので、続くフェードインでは**元々表示されていたものだけ**が戻ります。

## アニメの連鎖（シナリオを止めない）

`[ss_wait]` はアニメ終了までシナリオを止めます。「攻撃が当たるまで待ってから進む」には正しいのですが、「登場して待機ループに落ち着く」ではテキストを進めたいはずです。`next=` は連鎖をプレイヤー側に予約するので、シナリオは止まりません:

```
[ss_play name="akane" anime="appear" next="wait"]    ; 登場を1回 → 待機ループへ
[ss_play name="akane" anime="attack" next="wait" atframe="20"]  ; 20フレーム目で切替
```

- `next=` を指定して `loop=` を省略した場合は**1回再生**になります（無限ループには終わりが来ないため、連鎖が永久に発火しなくなるのを防ぎます）。
- `nextloop=` は連鎖先のループ回数（既定は無限）。
- `atframe=` は終了を待たずにそのフレームで切り替えます。前のアニメの余韻と次の出だしを重ねたいときに使います。そのフレームに届く前にアニメが終わった場合は、終了時に切り替えます。
- 予約された連鎖は、次の `[ss_play]` / `[ss_show anime=]` で取り消されます。

## 速度・シーク・区間

```
[ss_speed name="akane" speed="0.5"]             ; 半分の速度
[ss_seek name="akane" frame="12"]               ; 12 フレーム目へ
[ss_section name="akane" start="10" end="30"]   ; 10〜30 フレームだけをループ
[ss_direction name="akane" direction="backward" style="pingpong"]
```

フレーム番号は SpriteStudio の表示と同じく 0 から数えます。`[ss_seek]` は、再生中なら再生を続け、一時停止中なら一時停止のままです。`[ss_section]` は再生位置を区間の先頭へ移します。`start=` か `end=` を省略するとその側はアニメの端になり、両方省略するとアニメ全体に戻ります。`direction=` は `forward`（順）か `backward`（逆）、`style=` は `normal`（1 回）か `pingpong`（往復）です。

速度と方向はアニメを切り替えても残ります。区間は残りません。フレーム番号は別のアニメでは意味を持たないためで、`[ss_play anime=]` でも `next=` の続きでも解除されます。3 つともセーブに含まれます。

## シグナルを待つ

シグナルは、アニメーターが SpriteStudio 上でフレームに置く目印で、コマンド ID と任意のパラメータを持ちます。`[ss_wait_signal]` はアニメがシグナルを出すまでシナリオを止めるので、「攻撃が当たった瞬間」をシナリオに書けます:

```
[ss_play name="akane" anime="attack" loop="false"]
[ss_wait_signal name="akane" command="hit"]   ; 攻撃が当たるまで待つ
[quake count="3" time="300" hmax="20"]
```

`command=` は SpriteStudio で設定したコマンド ID です。省略するとどのシグナルでも進みます。`var="f.sig"` を指定すると待ちを終えたシグナルのコマンド ID が入るので、`[if]` でどれだったかを分岐できます。`next=` で予約した続きのアニメも待つ対象に含まれます。シグナルが出ないままアニメが終わるか 1 周ループした場合は待ちを終え、ほかのタグの失敗と同じように原因を表示します。多くはコマンド ID の書き間違いです。シグナルのパラメータは受け渡しません。

## 話者と連動したトークアニメ

`[ss_chara]` はプレイヤーをキャラクター名に紐づけ、そのキャラの台詞が表示されている間だけトークアニメを再生し、台詞が終わると待機アニメへ戻します。台詞ごとにタグを書く必要はありません:

```
[chara_new name="akane" jname="あかね" storage="chara/akane/normal.png"]
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
はじめまして。[p]      ; ここで talk が再生され、[p] で wait に戻る
```

- `jname=` はシナリオに書く `#名前` でも、Tyrano のキャラ ID でも一致します。省略するとプレイヤー名がそのまま使われます。
- `idle=` は台詞後に戻るアニメです。空にすると `[ss_play]` で最後に指定したアニメへ戻るので、表情変更が次の台詞に持ち越されます。
- トーク／待機の切替は**意図的にセーブに含めていません**。台詞の途中でセーブしても、ロード後は通常のアニメで復元されます。
- `talk=""` で解除します。スキップ / `[nowait]` 中はエンジンが一括表示するため、トークアニメが一瞬だけちらつくことはありません。
- SpriteStudio はフレームベースなので、Live2D の `lip=` のように口のパラメータを動かすのではなく**アニメごと切り替えます**。SpriteStudio 側で喋るアニメを作り、その名前を指定してください。

## 移動・エフェクトは `[anim]` / `[kanim]` で

各 SS プレイヤーはレイヤー内の実要素で、生成時に**プレイヤー名を識別子として付与**します。そのため他のキャラと同じように、Tyrano 標準の `[anim]` / `[kanim]` でそのまま動かせます:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; フェードアウト（消える）
[anim name="ringo" time="800" opacity="255"]      ; フェードイン（現れる）
[anim name="ringo" time="600" left="120" top="0"] ; スライド
[kanim name="ringo" time="500" ...]               ; キーフレームも可
```

> ⚠️ TyranoScript の `[anim]` の **`opacity` は 0〜255**（0〜1 ではない）。`opacity="1"`
> はほぼ透明（約 0.4%）になります。**完全表示は `255`**。

> [!WARNING]
> **`scale` / `rotate` はアニメに効きません。** これらはキャラの*要素*に CSS 変形を掛けますが、レイヤー上の SS キャラは要素の中ではなくレイヤー共有の canvas 1 枚に描かれます。そのため
> CSS 変形は「キャラが座る位置と大きさ」を動かすだけで、描かれている絵は拡縮も回転もしません。拡縮には `[ss_pos]` / `[ss_move]` を使ってください（アニメ自体を、そのアンカーを軸に拡縮します）。
> `[anim]` の `scale`/`rotate` は元々画面中心が軸だったため、この用途には正確ではありませんでした。

**使い分け:**

- **フェード（opacity）／スライド・シェイク／キーフレーム**は `[anim]` / `[kanim]`。
- **正確な位置やスケール**が要るときは `[ss_pos]`（瞬間）/ `[ss_move]`（補間）。
  `[anim]` の `left`/`top` は初期位置からの**相対**移動である点にも注意してください。

## セーブ / ロードとライフサイクル

- **通常のテキスト待ち（`[l]` / `[p]`）中も再生は継続します** — これが期待挙動です。メニューやセーブ画面で止めたい場合は `[ss_pause_all]` / `[ss_resume_all]` を使います。画面外・タブ非表示では自動的に一時停止します。
- **セーブ / ロード**: プレイヤーはロード時に自動で復元されます（`make.ks` への追記は不要です）。セーブした時点のフレームから再開します。
- **シーン切替**: レイヤーをクリアすると（`[freeimage]` など、原因を問わず）そのレイヤー上のプレイヤーは自動的に解放されます。`[ss_free]` / `[ss_free_all]` は、レイヤーに触れずに個別に解放したい場合に使います。
- **スキップ**: `data/system/Config.tjs` の `skipEffectIgnore = true`（既定）のままスキップしている間は、`[chara_show]` と同じく SS の演出も短縮されます。`[ss_show]` / `[ss_hide]` / `[ss_fadein]` / `[ss_fadeout]` / `[ss_move]` の `time=` はエンジンのスキップ時の長さになり、`[ss_wait]` は待ちません。アニメ自体は再生を続けます。`[ss_wait_signal]` は、続く処理がシグナルで分岐しうるため、スキップ中も待ちます。
- 表示状態・重なり順・予約中の `next=` 連鎖・`[ss_chara]` の紐づけ・速度・方向・区間はいずれもセーブに含まれ、`[ss_restore]` で元の画面が復元されます。

## 音声

SpriteStudio のサウンドイベントは TyranoScript 同梱の音声（howler）で、ゲームの SE 音量で再生されます。コンフィグ画面のスライダー（`[seopt]`）は、再生中の音にも反映されます。音声ファイルは `data/sound/` 前提で、SS のサウンド名はほかのファイル指定と同じ方法で `data/<dir>/<name>.<ext>` に解決されます（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。

音はキーに指定された回数だけ鳴って止まります。SpriteStudio の音声に無限ループはありません。アニメの停止・一時停止・切り替えでは、鳴っている音は止めません。プレイヤーが鳴らした音は `[ss_stop_audio]` ですぐ止まり、`[ss_free]` でもプレイヤーの解放と一緒に止まります。どちらもほかの音には触れません。`[stopse]` はこれらの音には効きません。

既知の制限は[制限事項](https://cri-middleware.github.io/SSPlayerForWeb/ja/limitations#tyranoscript-tyranobuilder)の TyranoScript / ティラノビルダーの節に、残課題は [`ROADMAP.md`](./ROADMAP.md) にまとめています。

## うまく表示されないとき

タグは失敗してもシナリオを止めません。エンジンのデバッグ設定（`data/system/Config.tjs` の `;debugMenu.visible = true`）が有効なら、原因は**エンジン自身のエラーダイアログ**に、シナリオのファイル名と行番号付きで表示されます。タグ名を書き間違えたときと同じダイアログです。リリース時は、同ファイルの指示どおりこの設定をオフにしてください。スタックを含む詳細は、常にブラウザのコンソール（開発者ツール）に出力されます。

- **何も出ない / エラーになる**: `[plugin name="ssplayer"]` を `[ss_new]` より前に置いているか確認してください。ランタイムを起動するのはこの行です（未実行なら
  `call [ss_init] before creating players` などのメッセージが出ます）。
- **`.ssab` が読み込めない**: `storage=` は `data/` 基準の相対パスです（例: `others/ssdata/Ringo/Ringo.ssab`）。テクスチャ PNG は `.ssab` と同じフォルダに置いてください。
- **WASM が初期化されない**: `ssruntime_bg.wasm` が `main.js` と同じ
  `data/others/plugin/ssplayer/` にあるか確認してください（`init.ks` がそこから読みます）。
  TyranoScript が動く WebGL 対応ブラウザが前提です。
- **`[anim]` で薄くしか表示されない**: `opacity` は **0〜255**（0〜1 ではありません）。完全表示は `255`。
- **アニメ名が受け付けられない**: SpriteStudio 上のアニメ名と照らし合わせてください。大文字と小文字は区別されます。`anime=` を空欄にすると先頭のアニメになります。
- **ロード後にキャラが消える**: 復元は自動なので通常は起きません。起きる場合はエンジンにイベント機構が無い版なので、`make.ks` に `[ss_restore]` を置いてください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

本パッケージは TyranoScript 向けの薄いアダプタです。描画は
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.ja.md) の `SSPlayer`
（WebGL1 必須 + WebGL2 自動昇格 / 依存ゼロ）が担います。このパッケージは **GPU 処理を持たず**、レイヤーへのキャラクター用 `<div>` の追加（描画はレイヤー共有の canvas）・座標マッピング・再生制御といった
**TyranoScript 固有のグルー**に徹します。実装済み範囲は実 TyranoScript で確認済みで、残タスクは [`ROADMAP.md`](./ROADMAP.md) にあります。

### しくみ

- **ランタイムは Tyrano 系ホストで共通**。TyranoBuilder も TyranoStudio も
  TyranoScript を内包しているので、単一の `main.js`（`master_tag` へ `[ss_*]` を自己登録する IIFE バンドル）が全てで動きます。ビルダーの**エディタ側**は別パッケージ
  [`ssplayer-tyranobuilder`](../ssplayer-tyranobuilder/README.ja.md) です。
- ビルド成果物は 2 種類:
  - `dist/index.js`（ESM）— バンドラ／テスト用。副作用なし（`registerSSTags()` を公開します）。
  - `dist/browser/main.js`（IIFE, 自己登録, minify）— `data/others/plugin/ssplayer/main.js`
    に置く**ドロップイン**。WebGL レンダラ＋ core の JS を内包し、**WASM バイナリだけ外部**（`ssruntime_bg.wasm` を同梱し、プラグインの `init.ks` が `[ss_init wasm=...]` で指します）。

### 内部仕様（座標・ライフサイクル）

- **座標**: Tyrano の左上原点・論理ピクセル（`config.scWidth × scHeight`）を、
  `SSPlayer`（Y-down）の描画バッファ座標へマップします。HiDPI は `devicePixelRatio`
  をバッファ倍率に反映し、`maxDPR` で上限を設けます。
- **`[anim]` 用の命名**: 生成時にキャラクターの `<div>` へプレイヤー名を CSS クラスとして付与します（`$.setName`＝`addClass(name)`。TyranoScript のキャラ識別と同じ仕組み）。`ss-player`
  クラスも付くので `$(".ss-player")` で一括選択できます。絶対座標指定はレンダラ内部の
  `setTransform`（Spine の `[spine_mod]` 相当）を経由するため、`[anim]` とは別に
  `[ss_pos]` / `[ss_move]` が存在します。
- **セーブ対象**: 各プレイヤーの復元情報を `TYRANO.kag.stat.f.__ssplayers` へミラーします。ロード時はエンジンの `load-beforemaking` イベント（セーブ変数が戻り、シナリオが再開する直前＝`make.ks` と同じ隙間）でプラグインが自動的に再構築します。`[ss_restore]` は同じ処理を明示的に行うタグで、自動復元が実行中ならそれを待ち合わせて二重実行を避けます。
- **解放**: `[ss_free]` / `[ss_free_all]` が `destroy()` を呼びます。`FinalizationRegistry`
  任せにしないでください。
- **音声**: SS の `onAudio` イベントは `TyranoAudioManager` 経由で howler（`window.Howl`）へ流します。`[playse]` ではなく howler を直接使うのは、KAG タグだと `nextOrder` でシナリオが進んでしまうためです。プレイヤーの破棄はそのマネージャーの音をすべて止めるので、マネージャーはプレイヤーごとに 1 つ持ちます。`TyranoAudioManager` はプログラムから直接利用も可能です。

### 配布（GitHub Releases）

npm には**公開しません**（`private`）。TyranoScript 作者はプラグイン一式を使います:

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run pack    # dist/pack/ssplayer-tyranoscript-plugin-<ver>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` を zip 化します。これを
**GitHub Releases のアセットに添付**し、利用者は `ssplayer/` を `data/others/plugin/` に展開します。配布テンプレは [`plugin/`](./plugin/README.md) にあります。

ディスク上のプラグイン配置:

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # このパッケージの dist/browser/main.js
  ssruntime_bg.wasm    # @spritestudio/ssplayer-core の runtime バイナリ
data/others/ssdata/<ssae名>.ssab      # プロジェクトの .ssae 1 つにつき 1 つ、同じ名前
```

### API（ESM）

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyranoscript';

// TyranoScript ランタイム起動後に呼ぶと [ss_*] を登録する。
// 省略時はグローバル TYRANO を使用。Tyrano 不在なら false を返す no-op。
registerSSTags();
```

### 開発

```bash
pnpm --filter @spritestudio/ssplayer-tyranoscript run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyranoscript run test    # vitest (モック TYRANO ハーネス, 実エンジン不要)
```

## ライセンス

BSD-3-Clause © CRI Middleware Co., Ltd. — [LICENSE.md](./LICENSE.md) を参照してください。
