[**English**](./README.md) | [**日本語**](./README.ja.md)

# @spritestudio/ssplayer-tyrano

**TyranoScript / TyranoBuilder** のシナリオに `[ss_*]` タグを書くだけで、
**SpriteStudio 7** のアニメを表示・再生できます。プログラミングは不要です。

> **対象読者:** TyranoScript / TyranoBuilder を使うヴィジュアルノベルのシナリオ作者 — SpriteStudio アニメ用の `[ss_*]` シナリオタグを追加するドロップイン・プラグインです。
> **ステータス:** beta。
> **目的が違う場合:** → [ssplayer-webgl](../ssplayer-webgl/README.ja.md) — このプラグインの土台になっている単体レンダラです。

> ⚠️ **beta。** シナリオ作成用のタグは揃っていますが、`7.0.0` までに名前や挙動が変わる
> 可能性はあります。設計ロードマップはリポジトリの [`ROADMAP.md`](./ROADMAP.md) にあります。

▶️ **[オンラインデモ](https://cri-middleware.github.io/SSPlayerForWeb/examples/tyrano/)** —
同梱の TyranoScript サンプルをブラウザで動かせます（🚧 初回リリース後に公開）。

## インストール

**まだリリース版はありません。** 現状で入手する唯一の方法はソースからのビルドです
（[コントリビューター向け — ソースからビルド](#コントリビューター向け--ソースからビルド) を参照）。

最初のリリース以降は、プロジェクトの GitHub Releases に ZIP が添付されます。導入手順は
次の通りです:

1. リリースをダウンロードして解凍すると、`ssplayer/` フォルダが入っています。
2. その `ssplayer/` フォルダを Tyrano プロジェクトの `data/others/plugin/` にコピーします。
3. シナリオから `[plugin name="ssplayer"]` で読み込みます（下記の例を参照）。

フォルダには 3 ファイルが入ります: `init.ks`（ローダ）、`main.js`（プラグイン本体）、
`ssruntime_bg.wasm`（アニメーションランタイム）。`.ssab` アニメファイルは
`data/others/ssdata/` に置きます。

## アニメを変換する（.sspj → .ssab）

`.sspj` は SpriteStudio で編集するプロジェクトファイル、`.ssab` はプラグインが実際に再生する
変換済み（プリビルド）のランタイムファイルです。`[ss_new storage="..."]` で読み込むのはこの
`.ssab` です。`.sspj` を次のいずれかで変換してください。

- **Web（インストール不要）：** ホスト版コンバータ
  **<https://cri-middleware.github.io/SSPlayerForWeb/ssconverter/>**（🚧 初回リリース後に利用可能）を開き、`.sspj`
  プロジェクトが入ったフォルダ（ディレクトリ）をドロップすると `.ssab`（＋テクスチャ）が
  zip ファイルでダウンロードできます。
- **デスクトップ：** [**SSConverterGUI**](https://github.com/cri-middleware/SSConverterGUI/releases) を使います。

変換して出てきた `.ssab`（＋テクスチャ）は、Tyrano プロジェクトの `data/others/ssdata/` に
置きます。プロジェクトごとにサブフォルダ（例: `data/others/ssdata/Ringo/`）へまとめておくと
テクスチャが混ざらず、`[ss_new]` からは `storage="others/ssdata/Ringo/Ringo.ssab"` のように
参照できます。

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

- `[plugin]` はプラグインの読み込みとランタイムの起動をまとめて行います。`first.ks` に
  書くのはこの 1 行だけで、準備はこれで終わりです（`[ss_init]` も `make.ks` への追記も
  不要です）。
- `[ss_new]` は名前付きプレイヤーを生成し、`.ssab` をロードしてレイヤーに置き、再生します。
- `[ss_play]` は既存プレイヤーで再生／アニメ切替を行います。

動く最小プロジェクトは [`examples/tyrano-example`](../../examples/tyrano-example/README.md) を参照してください。

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

> 登場・移動（`[ss_move]` / `[ss_pos]`）、`[anim]` フェード、複数レイヤー、セーブ/ロード復元などの
> 実例は、コメント付きの同梱サンプル [`first.ks`](../../examples/tyrano-example/data/scenario/first.ks) を参照してください。

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
| `[ss_wait]` | アニメ終了（ループ時は1周）までシナリオを待つ | `name=`(必須) |
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

座標は他の画面要素と同じく、Tyrano の通常の左上原点ピクセル（`config.scWidth × scHeight`）
を使います。[^coords] `loop` は `true`→無限 / `false`→1 回 / 数値→回数。

[^coords]: 内部的には canvas は HiDPI 対応です。ピクセル倍率の詳細はコントリビューター
向けセクションを参照してください。

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

## 先読み・表示・非表示

`[ss_new]` はロードが終わり次第そのまま表示します。サイズの大きい `.ssab` では、登場より
**早い段階でロードを済ませて**おき、場面が来たら即座に出すのが定石です:

```
[ss_new name="akane" storage="others/ssdata/Akane.ssab" visible="false"]  ; ここでロード
...
[ss_show name="akane" x="640" y="480" time="800"]   ; ここで登場（待たされない）
[ss_hide name="akane" time="500"]                   ; 画面から消す（ロードは維持）
[ss_show name="akane"]                              ; 再ロードなしで復帰
```

`[ss_hide]` は `[ss_free]` とは別物です。アニメはロードされたまま（＝ `[ss_show]` が即時）で、
画面外なので GPU も消費しません。そのキャラをもう使わない場合は `[ss_free]` を使ってください。

`[ss_fadeout]` / `[ss_fadein]` は**全プレイヤー**を一括でフェードします（シーン切替の定番）。
一括フェードアウトは個別に非表示にしていたプレイヤーを覚えているので、続くフェードインでは
**元々表示されていたものだけ**が戻ります。

## アニメの連鎖（シナリオを止めない）

`[ss_wait]` はアニメ終了までシナリオを止めます。「攻撃が当たるまで待ってから進む」には
正しいのですが、「登場して待機ループに落ち着く」ではテキストを進めたいはずです。`next=` は
連鎖をプレイヤー側に予約するので、シナリオは止まりません:

```
[ss_play name="akane" anime="appear" next="wait"]    ; 登場を1回 → 待機ループへ
[ss_play name="akane" anime="attack" next="wait" atframe="20"]  ; 20フレーム目で切替
```

- `next=` を指定して `loop=` を省略した場合は**1回再生**になります（無限ループには終わりが
  来ないため、連鎖が永久に発火しなくなるのを防ぎます）。
- `nextloop=` は連鎖先のループ回数（既定は無限）。
- `atframe=` は終了を待たずにそのフレームで切り替えます。前のアニメの余韻と次の出だしを
  重ねたいときに使います。
- 予約された連鎖は、次の `[ss_play]` / `[ss_show anime=]` で取り消されます。

## 話者と連動したトークアニメ

`[ss_chara]` はプレイヤーをキャラクター名に紐づけ、そのキャラの台詞が表示されている間だけ
トークアニメを再生し、台詞が終わると待機アニメへ戻します。台詞ごとにタグを書く必要はありません:

```
[chara_new name="akane" jname="あかね" storage="chara/akane/normal.png"]
[ss_chara name="akane_ss" jname="あかね" talk="talk" idle="wait"]

#あかね
はじめまして。[p]      ; ここで talk が再生され、[p] で wait に戻る
```

- `jname=` はシナリオに書く `#名前` でも、Tyrano のキャラ ID でも一致します。省略すると
  プレイヤー名がそのまま使われます。
- `idle=` は台詞後に戻るアニメです。空にすると `[ss_play]` で最後に指定したアニメへ戻るので、
  表情変更が次の台詞に持ち越されます。
- トーク／待機の切替は**意図的にセーブに含めていません**。台詞の途中でセーブしても、
  ロード後は通常のアニメで復元されます。
- `talk=""` で解除します。スキップ / `[nowait]` 中はエンジンが一括表示するため、
  トークアニメが一瞬だけちらつくことはありません。
- SpriteStudio はフレームベースなので、Live2D の `lip=` のように口のパラメータを動かすのではなく
  **アニメごと切り替えます**。SpriteStudio 側で喋るアニメを作り、その名前を指定してください。

## 移動・エフェクトは `[anim]` / `[kanim]` で

各 SS プレイヤーはレイヤー内の実要素で、生成時に**プレイヤー名を識別子として付与**します。
そのため他のキャラと同じように、Tyrano 標準の `[anim]` / `[kanim]` でそのまま動かせます:

```
[ss_new name="ringo" storage="others/ssdata/ringo.ssab" layer="0" x="640" y="480"]
[anim name="ringo" time="800" opacity="0"]        ; フェードアウト（消える）
[anim name="ringo" time="800" opacity="255"]      ; フェードイン（現れる）
[anim name="ringo" time="600" left="120" top="0"] ; スライド
[kanim name="ringo" time="500" ...]               ; キーフレームも可
```

> ⚠️ TyranoScript の `[anim]` の **`opacity` は 0〜255**（0〜1 ではない）。`opacity="1"`
> はほぼ透明（約 0.4%）になります。**完全表示は `255`**。

**使い分け:**

- **フェード（opacity）／単純なスライド・シェイク**は `[anim]` / `[kanim]` が最適です。
- **絶対座標・アンカー基準**の位置やスケールが要る場合は、代わりに **`[ss_pos]`**（瞬間）
  または **`[ss_move]`**（補間）を使ってください。`[anim]` では `left`/`top` は初期位置からの
  **相対**移動になり、`scale`/`rotate` はアニメのアンカーではなく画面中心を軸に回ります。

## セーブ / ロードとライフサイクル

- **通常のテキスト待ち（`[l]` / `[p]`）中も再生は継続します** — これが期待挙動です。
  メニューやセーブ画面で止めたい場合は `[ss_pause_all]` / `[ss_resume_all]` を使います。
  画面外・タブ非表示では自動的に一時停止します。
- **セーブ / ロード**: プレイヤーはロード時に自動で復元されます（`make.ks` への追記は
  不要です）。正確なセーブ frame ではなくアニメ先頭から再開します。
- **シーン切替**: シーン遷移やレイヤークリア時は `[ss_free]` / `[ss_free_all]` を呼び、
  不要になったプレイヤーを除去してください。
- 表示状態・重なり順・予約中の `next=` 連鎖・`[ss_chara]` の紐づけはいずれもセーブに含まれ、
  `[ss_restore]` で元の画面が復元されます。

## 音声

SpriteStudio のサウンドイベントは TyranoScript 同梱の音声（howler）で再生されます。音声
ファイルは `data/sound/` 前提で、SS のサウンド名 → `data/<dir>/<name>.<ext>` に解決します
（`[ss_init sounddir= soundext= sevolume=]` で調整、`audio="false"` で無効化）。

ティラノビルダー `.tbp` 対応・`[cm]` / `[clearfix]` 自動フック・frame 精密復元・Tyrano 音量
スライダー連動は [`ROADMAP.md`](./ROADMAP.md) の残課題です。

## うまく表示されないとき

タグは失敗してもシナリオを止めず、**原因をブラウザのコンソール（開発者ツール）に出力**します。
まずはコンソールを確認してください。

- **何も出ない / エラーになる**: `[plugin name="ssplayer"]` を `[ss_new]` より前に置いているか
  確認してください。ランタイムを起動するのはこの行です（未実行なら
  `call [ss_init] before creating players` などのメッセージが出ます）。
- **`.ssab` が読み込めない**: `storage=` は `data/` 基準の相対パスです
  （例: `others/ssdata/Ringo/Ringo.ssab`）。テクスチャ PNG は `.ssab` と同じフォルダに置いてください。
- **WASM が初期化されない**: `ssruntime_bg.wasm` が `main.js` と同じ
  `data/others/plugin/ssplayer/` にあるか確認してください（`init.ks` がそこから読みます）。
  TyranoScript が動く WebGL 対応ブラウザが前提です。
- **`[anim]` で薄くしか表示されない**: `opacity` は **0〜255**（0〜1 ではありません）。完全表示は `255`。
- **アニメが切り替わらない**: `anime=` の名前が `.ssab` 内に存在するか確認してください（空欄なら先頭アニメ）。
- **ロード後にキャラが消える**: 復元は自動なので通常は起きません。起きる場合はエンジンにイベント機構が無い版なので、`make.ks` に `[ss_restore]` を置いてください。

---

## コントリビューター向け — ソースからビルド

*利用者はここまで。以下はこのパッケージを開発する人向けです。*

本パッケージは TyranoScript / TyranoBuilder 向けの薄いアダプタです。描画は
[`@spritestudio/ssplayer-webgl`](../ssplayer-webgl/README.ja.md) の `SSCanvasPlayer`
（WebGL1 必須 + WebGL2 自動昇格 / 依存ゼロ）が担います。このパッケージは **GPU 処理を
持たず**、レイヤー `div` への `<canvas>` 挿入・座標マッピング・再生制御といった
**TyranoScript 固有のグルー**に徹します。実装済み範囲は実 TyranoScript で確認済みで、
残タスク（ビルダー対応、変換取り込み等）は [`ROADMAP.md`](./ROADMAP.md) にあります。

### しくみ

- **ランタイムは TyranoScript／ビルダー／スタジオで共通**。単一の `main.js`
  （`master_tag` へ `[ss_*]` を自己登録する IIFE バンドル）が全てで動きます。
- ビルド成果物は 2 種類:
  - `dist/index.js`（ESM）— バンドラ／テスト用。副作用なし（`registerSSTags()` を公開します）。
  - `dist/browser/main.js`（IIFE, 自己登録, minify）— `data/others/plugin/ssplayer/main.js`
    に置く**ドロップイン**。WebGL レンダラ＋ core の JS を内包し、**WASM バイナリだけ外部**
    （`ssruntime_bg.wasm` を同梱し、プラグインの `init.ks` が `[ss_init wasm=...]` で指します）。

### 内部仕様（座標・ライフサイクル）

- **座標**: Tyrano の左上原点・論理ピクセル（`config.scWidth × scHeight`）を、
  `SSCanvasPlayer`（Y-down）の描画バッファ座標へマップします。HiDPI は `devicePixelRatio`
  をバッファ倍率に反映し、`maxDPR` で上限を設けます。
- **`[anim]` 用の命名**: 生成時に canvas へプレイヤー名を CSS クラスとして付与します
  （`$.setName`＝`addClass(name)`。TyranoScript のキャラ識別と同じ仕組み）。`ss-player`
  クラスも付くので `$(".ss-player")` で一括選択できます。絶対座標指定はレンダラ内部の
  `setTransform`（Spine の `[spine_mod]` 相当）を経由するため、`[anim]` とは別に
  `[ss_pos]` / `[ss_move]` が存在します。
- **セーブ対象**: 各プレイヤーの復元情報を `TYRANO.kag.stat.f.__ssplayers` へミラーします。
  ロード時はエンジンの `load-beforemaking` イベント（セーブ変数が戻り、シナリオが再開する
  直前＝`make.ks` と同じ隙間）でプラグインが自動的に再構築します。`[ss_restore]` は同じ処理を
  明示的に行うタグで、自動復元が実行中ならそれを待ち合わせて二重実行を避けます。
- **解放**: `[ss_free]` / `[ss_free_all]` が `destroy()` を呼びます。`FinalizationRegistry`
  任せにしないでください。
- **音声**: SS の `onAudio` イベントは `TyranoAudioManager` 経由で howler（`window.Howl`）
  へ流します。`[playse]` ではなく howler を直接使うのは、KAG タグだと `nextOrder` で
  シナリオが進んでしまうためです。`TyranoAudioManager` はプログラムから直接利用も可能です。

### 配布（GitHub Releases）

npm には**公開しません**（`private`）。TyranoScript 作者はプラグイン一式を使います:

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run pack    # dist/pack/ssplayer-tyrano-plugin-<ver>.zip
```

`pack` は `ssplayer/{init.ks, main.js, ssruntime_bg.wasm}` を zip 化します。これを
**GitHub Releases のアセットに添付**し、利用者は `ssplayer/` を `data/others/plugin/` に展開します。
配布テンプレは [`plugin/`](./plugin/README.md) にあります。

ディスク上のプラグイン配置:

```
data/others/plugin/ssplayer/
  init.ks              # [loadjs storage="plugin/ssplayer/main.js"] → [return]
  main.js              # このパッケージの dist/browser/main.js
  ssruntime_bg.wasm    # @spritestudio/ssplayer-core の runtime バイナリ
data/others/ssdata/<project>.ssab
```

### API（ESM）

```ts
import { registerSSTags } from '@spritestudio/ssplayer-tyrano';

// TyranoScript ランタイム起動後に呼ぶと [ss_*] を登録する。
// 省略時はグローバル TYRANO を使用。Tyrano 不在なら false を返す no-op。
registerSSTags();
```

### 開発

```bash
pnpm --filter @spritestudio/ssplayer-tyrano run build   # dist/index.js + dist/browser/main.js
pnpm --filter @spritestudio/ssplayer-tyrano run test    # vitest (モック TYRANO ハーネス, 実エンジン不要)
```

## ライセンス

BSD-3-Clause © CRI Middleware Co., Ltd. — [LICENSE.md](./LICENSE.md) を参照してください。
